'use strict';

const descriptor = require('./tenant-evidence-descriptor');

// Sources own persistence. The worker never retains cells, document bodies or a turn context.
function availableDescriptor(kind, row, previous) {
  const input = descriptor.descriptorInput(kind, row);
  for (const value of [row.evidenceDescriptor, previous?.evidenceDescriptor].sort(
    (a, b) => Number(Boolean(b?.generation)) - Number(Boolean(a?.generation))
  )) {
    if (value?.fingerprint !== input.fingerprint) continue;
    try {
      require('./project-manifest').validateManifest(value.manifest, input.nodes);
      return value;
    } catch (_error) {
      // Invalid legacy metadata is immediately replaced by the deterministic minimum.
    }
  }
  return descriptor.minimalDescriptor(kind, row);
}

function scheduleDescriptor(service, kind, row, persist) {
  if (row.evidenceDescriptor?.generation || service.evidenceWorkerStopped) return;
  const state = (service.evidenceWorker ||= { pending: new Map(), timer: null, running: null });
  const key = JSON.stringify([row.tenantId, kind, row.id]);
  const settings = service.settings?.tenantEvidenceEnrichment || {};
  const delayMs = settings.delayMs ?? 30000;
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('Invalid enrichment delay');
  if (!state.pending.has(key) && state.pending.size >= 64) return;
  const input = descriptor.descriptorInput(kind, row);
  if (state.active?.key === key && state.active.fingerprint === input.fingerprint) return;
  input.datasets = input.datasets.map((value) => ({
    id: value.id,
    columns: input.nodes[0].attributes.columns,
    period: value.period,
    semantic: { units: value.semantic?.units },
    provenance: value.provenance,
  }));
  try {
    const prompt = require('./project-manifest').manifestInput(
      input.project,
      input.nodes,
      input.datasets
    );
    if (Buffer.byteLength(JSON.stringify(prompt)) > 16000) return;
  } catch (_error) {
    return;
  }
  // Preserve headings/schema and locally observed anchors, but never send observed values to LLM.
  const snapshot = { id: row.id, tenantId: row.tenantId, hash: row.hash, version: row.version };
  // Document headings must survive removal of the body from the queued snapshot.
  snapshot.evidenceDescriptor = row.evidenceDescriptor;
  snapshot.evidenceMetadata = input;
  state.pending.set(key, { kind, snapshot, persist });
  if (state.timer || state.running) return;
  scheduleNext(service, delayMs);
}

function scheduleNext(service, delayMs) {
  const state = service.evidenceWorker;
  state.timer = setTimeout(() => runDescriptorJob(service), delayMs);
  state.timer.unref?.();
}

async function runDescriptorJob(service) {
  const state = service.evidenceWorker;
  if (!state || service.evidenceWorkerStopped) return;
  if (state.running) return state.running;
  clearTimeout(state.timer);
  state.timer = null;
  const next = state.pending.entries().next().value;
  if (!next) return;
  const [id, job] = next;
  state.pending.delete(id);
  state.active = { key: id, fingerprint: job.snapshot.evidenceMetadata.fingerprint };
  state.running = (async () => {
    const enriched = await descriptor.ensureDescriptor(job.kind, job.snapshot, {
      enrich: true,
      metadata: job.snapshot.evidenceMetadata,
      broker: service.broker,
      logger: service.logger,
      maxAttempts: 1,
      generationOptions: { maxTokens: 1200, timeoutMs: 5000, transientRecovery: false },
    });
    await job.persist(enriched);
  })()
    .catch((error) =>
      service.logger?.warn('Evidence enrichment pending', {
        errorClass: error.type || error.name,
      })
    )
    .finally(() => {
      state.running = null;
      state.active = null;
      if (state.pending.size && !service.evidenceWorkerStopped)
        scheduleNext(service, service.settings?.tenantEvidenceEnrichment?.delayMs ?? 30000);
    });
  await state.running;
}

async function stopDescriptorWorker(service) {
  service.evidenceWorkerStopped = true;
  const state = service.evidenceWorker;
  if (!state) return;
  clearTimeout(state.timer);
  state.pending.clear();
  await state.running;
}

module.exports = {
  availableDescriptor,
  scheduleDescriptor,
  runDescriptorJob,
  stopDescriptorWorker,
};
