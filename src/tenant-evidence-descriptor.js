'use strict';

const { createHash } = require('node:crypto');
const { generateManifest, validateManifest } = require('./project-manifest');
const { minimalContent, assembleManifest } = require('./project-manifest-generation');
const jobs = new Map();
const bounded = (value) => String(value || '').slice(0, 1000);

// Source-owned manifests: no additional catalog or tenant-derived content identity.
function descriptorInput(kind, row) {
  const nodeId = `${kind}:${row.id}`;
  const columns = (row.columns || []).map(({ name, type }) => ({ name, type }));
  const names = [
    ...new Set(
      [
        row.title,
        row.sourceName || row.name,
        row.sheet,
        ...(row.sectionNames || []),
        ...(kind === 'document'
          ? [
              ...new Set(
                require('./workbench-document')
                  .documentSections(row.text || '')
                  .flatMap((section) => section.locations || [section])
                  .map((section) => section.chapter)
              ),
            ]
          : []),
      ]
        .filter(Boolean)
        .map(bounded)
    ),
  ].slice(0, 32);
  const observed =
    row.evidenceAnchors ||
    (row.evidenceDescriptor?.sourceHash === row.hash
      ? row.evidenceDescriptor?.observedAnchors
      : null) ||
    (kind === 'document' ? require('./tenant-evidence-anchors').documentSourceAnchors(row) : []);
  const anchors = [
    ...(row.semantic?.anchors || [])
      .filter((name) => typeof name === 'string')
      .slice(0, 32)
      .map((name) => ({ nodeId, name: bounded(name), origin: 'metadata' })),
    ...observed.map((anchor) => ({ ...anchor, nodeId })),
  ].slice(0, 64);
  const nodes = [
    {
      recordType: 'node',
      nodeId,
      kind: kind === 'dataset' ? 'dataset' : 'section',
      ref: row.id,
      labels: names,
      attributes: { columns, period: row.period, ...(row.status ? { status: row.status } : {}) },
    },
    ...anchors.map((anchor, index) => ({
      recordType: 'node',
      nodeId: `${nodeId}:anchor:${index}`,
      kind: 'entity',
      labels: [anchor.name],
    })),
  ];
  const project = {
    projectId: nodeId,
    tenantId: row.tenantId,
    title: bounded(row.title || row.name),
  };
  const datasets = kind === 'dataset' ? [{ ...row, provenance: { projectId: nodeId } }] : [];
  const routingSources = [
    {
      nodeId,
      nodeIds: nodes.map((node) => node.nodeId),
      kind: nodes[0].kind,
      names,
      columns,
      units: row.semantic?.units || {},
      period: row.period,
      anchors,
    },
  ];
  const metadata = { title: project.title, nodes, units: routingSources[0].units };
  const fingerprint = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  return { project, nodes, datasets, routingSources, fingerprint };
}

function minimalDescriptor(kind, row) {
  const input = descriptorInput(kind, row);
  return {
    schemaVersion: 1,
    fingerprint: input.fingerprint,
    sourceHash: row.hash,
    observedAnchors: input.routingSources[0].anchors.filter(
      (anchor) => anchor.origin === 'observed'
    ),
    manifest: assembleManifest(
      minimalContent(input.project, input.nodes, input.datasets),
      input.project,
      input.nodes,
      row.version || 1
    ),
  };
}

async function ensureDescriptor(kind, row, options = {}) {
  const input = options.metadata || descriptorInput(kind, row);
  if (row.evidenceDescriptor?.fingerprint === input.fingerprint) {
    try {
      validateManifest(row.evidenceDescriptor.manifest, input.nodes);
      if (!options.enrich || row.evidenceDescriptor.generation) return row.evidenceDescriptor;
    } catch (_error) {
      /* Repair invalid legacy metadata when needed. */
    }
  }
  const key = JSON.stringify([row.tenantId, kind, row.id, input.fingerprint]);
  if (jobs.has(key)) return jobs.get(key);
  const job = (async () => {
    let generation;
    const manifest = await generateManifest(
      input.project,
      input.nodes,
      input.datasets,
      row.version || 1,
      {
        ...options,
        onDiagnostics: (value) => {
          generation = value;
        },
      }
    );
    return {
      schemaVersion: 1,
      fingerprint: input.fingerprint,
      sourceHash: row.hash,
      observedAnchors: input.routingSources[0].anchors.filter(
        (anchor) => anchor.origin === 'observed'
      ),
      manifest,
      generation,
    };
  })().finally(() => jobs.delete(key));
  jobs.set(key, job);
  return job;
}

function evidenceCandidate(kind, row, actorId) {
  const input = descriptorInput(kind, row);
  const descriptor =
    row.evidenceDescriptor?.fingerprint === input.fingerprint
      ? row.evidenceDescriptor
      : minimalDescriptor(kind, row);
  try {
    validateManifest(descriptor.manifest, input.nodes);
  } catch (_error) {
    return evidenceCandidate(kind, { ...row, evidenceDescriptor: null }, actorId);
  }
  return {
    id: `${kind}:${row.id}`,
    projectId: `${kind}:${row.id}`,
    sourceType: kind,
    sourceId: row.id,
    descriptorFingerprint: input.fingerprint,
    title: input.project.title,
    manifest: descriptor.manifest,
    generation: descriptor.generation,
    routingSources: input.routingSources,
    corrections: (row.evidenceCorrections || []).filter((item) => item.actorId === actorId),
    provenance: {
      filename: row.sourceName || row.name,
      sheet: row.sheet,
      hash: row.hash,
      location: row.sourceLocation,
      refs: row.refs || [],
      ...row.provenance,
    },
    sensitivity: {
      level: row.sensitivityLevel || 'tenant_internal',
      requiredClearance: row.requiredClearance || row.sensitivityFlags || [],
    },
  };
}

function needsDescriptor(kind, row, question, actorId) {
  const input = descriptorInput(kind, row);
  if (row.evidenceDescriptor?.fingerprint === input.fingerprint) {
    try {
      validateManifest(row.evidenceDescriptor.manifest, input.nodes);
      if (row.evidenceDescriptor.generation) return false;
    } catch (_error) {
      /* Invalid stored descriptors use the same lazy repair. */
    }
  }
  return (
    require('./project-manifest-routing').selectProjectCandidates(
      [evidenceCandidate(kind, row, actorId)],
      question,
      { minMargin: 0 }
    ).length > 0
  );
}

function validateEvidenceCorrection(correction) {
  const { deny } = require('./domain-router-policy');
  if (
    !correction ||
    Object.keys(correction).some((key) => !['sourceType', 'sourceId', 'kind'].includes(key)) ||
    !require('./tenant-evidence-sources').evidenceCorrectionAction(correction.sourceType) ||
    typeof correction.sourceId !== 'string' ||
    !correction.sourceId.trim() ||
    correction.sourceId.length > 256 ||
    !['reject', 'confirm'].includes(correction.kind)
  )
    deny('Invalid tenant evidence correction');
  return { ...correction };
}

function correctedEvidence(row, event) {
  const correction = validateEvidenceCorrection(event.correction);
  const previous = (row.evidenceCorrections || []).find((item) => item.actorId === event.actorId);
  if (
    previous &&
    (previous.correctionId === event.correctionId ||
      (previous.sequence !== undefined && event.sequence !== undefined
        ? previous.sequence > event.sequence
        : previous.at > event.at))
  )
    return row;
  return {
    ...row,
    evidenceCorrections: [
      ...(row.evidenceCorrections || []).filter((item) => item.actorId !== event.actorId),
      {
        kind: correction.kind,
        actorId: event.actorId,
        correctionId: event.correctionId,
        at: event.at,
        ...(event.sequence !== undefined ? { sequence: event.sequence } : {}),
      },
    ],
  };
}

// A later quality/semantic write must retain a correction from a newer source snapshot.
function mergeEvidenceCorrections(previous = [], incoming = []) {
  const latest = new Map();
  for (const correction of [...previous, ...incoming]) {
    const current = latest.get(correction.actorId);
    const rank = correction.sequence ?? -1;
    const currentRank = current?.sequence ?? -1;
    if (!current || rank > currentRank || (rank === currentRank && current.at < correction.at))
      latest.set(correction.actorId, correction);
  }
  return [...latest.values()].sort((a, b) => a.actorId.localeCompare(b.actorId));
}
module.exports = {
  descriptorInput,
  minimalDescriptor,
  ensureDescriptor,
  evidenceCandidate,
  needsDescriptor,
  validateEvidenceCorrection,
  correctedEvidence,
  mergeEvidenceCorrections,
};
