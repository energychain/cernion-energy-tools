'use strict';

const { createHash } = require('node:crypto');
const { principal, visible, deny } = require('./domain-router-policy');
const descriptor = require('./tenant-evidence-descriptor');
const background = require('./tenant-evidence-background');
const facts = require('./tenant-memory-store');
const { safeConclusion } = require('./workbench-answer-outcome');

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const serviceFor = (ctx) => ctx.broker?.getLocalService?.('workbench');
const currentConversation = (ctx) =>
  ctx.params?.conversationId ||
  ctx.params?.openWebuiConversationId ||
  ctx.params?.context?.conversationId;

async function conversationRefs(service, p) {
  const prefix = `conversation:${encodeURIComponent(p.tenantId)}:`;
  const page = await service.store.conversationsDb.allDocs({
    startkey: prefix,
    endkey: `${prefix}\uffff`,
    include_docs: true,
  });
  return page.rows
    .map(({ doc }) => ({
      ...doc,
      conversationId: doc.externalConversationId || doc.openWebuiConversationId,
    }))
    .filter((doc) => doc.tenantId === p.tenantId);
}

// Only conclusions/statements are content. Titles, routing situations and open questions are not.
function usableConclusion(value, outcome) {
  return safeConclusion(value, outcome).trim();
}

function caseRow(state, saved, refs) {
  const memory = require('./workbench-turn-memory').safeTurnMemory(saved?.memory);
  const summary = state.knownContext?.situation?.caseMemory;
  const conclusion = usableConclusion(
    memory?.lastSafeConclusion || state.lastClassification?.responseText,
    { ...state.lastClassification, knownContext: state.knownContext }
  );
  const title =
    usableConclusion(memory?.topic || summary?.topic) ||
    usableConclusion(require('./case-linking').caseDescription(state)) ||
    'Sitzung';
  if (!conclusion || conclusion === title || saved?.evidenceOrigin?.uploadBacked) return null;
  const ownRefs = refs.filter((ref) => ref.cetCaseId === state.cetCaseId);
  const origin = saved?.evidenceOrigin || {};
  const at = origin.at || memory?.memoryUpdatedAt || state.updatedAt;
  const sections = [memory?.situation || summary?.status].filter(
    (text) => text && usableConclusion(text)
  );
  return {
    id: state.cetCaseId,
    tenantId: state.tenantId,
    title: `Sitzung: ${title}`,
    topic: title,
    // Separate noun labels from projected status metadata, never from conversation bodies.
    sectionNames: [
      ...sections,
      ...sections
        .flatMap((text) => text.match(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{N}]{3,}/gu) || [])
        .slice(0, 16),
    ],
    semantic: {
      identifiers: state.typedIdentifiers || [],
      anchors: [...(state.typedIdentifiers || []).map((item) => item.value), title].filter(Boolean),
    },
    period: { from: state.createdAt || at, to: at },
    status:
      state.disposition ||
      state.status ||
      state.lastClassification?.readinessState ||
      memory?.readinessState ||
      'unknown',
    sensitivityFlags: state.sensitivityFlags || [],
    version: state.caseStateVersion,
    hash: digest([conclusion, at, origin, state.caseStateVersion]),
    evidenceDescriptor: saved?.evidenceDescriptor,
    evidenceCorrections: saved?.evidenceCorrections || [],
    refs: ownRefs.map((ref) => ({
      conversationId: ref.conversationId,
      channel: ref.client,
      caseId: state.cetCaseId,
    })),
    provenance: {
      caseId: state.cetCaseId,
      conversationId: origin.conversationId || ownRefs[0]?.conversationId,
      channel: origin.channel || ownRefs[0]?.client,
      at,
      uploadBacked: origin.uploadBacked,
    },
    conclusion,
  };
}

function memoryRow(fact) {
  if (!facts.active(fact) || fact.documentSource || !usableConclusion(fact.text)) return null;
  const names = (fact.anchors || [])
    .flatMap((anchor) => [anchor.value, ...(anchor.aliases || [])])
    .filter(Boolean);
  if (!names.length) return null;
  return {
    id: fact.id,
    tenantId: fact.tenantId,
    title: `Aussage: ${names[0]}`,
    semantic: { anchors: names },
    sectionNames: ['Festgehaltene Aussage', 'Einordnung', fact.statementKind].filter(Boolean),
    period: { from: fact.time?.from || fact.at, to: fact.time?.until || fact.at },
    status: fact.status,
    sensitivityFlags: fact.sensitivityFlags || [],
    hash: digest([fact.text, fact.basis, fact.at, fact.status, fact.anchors]),
    evidenceDescriptor: fact.evidenceDescriptor,
    evidenceCorrections: fact.evidenceCorrections,
    refs: [{ conversationId: fact.conversationId, channel: fact.channel }],
    provenance: { conversationId: fact.conversationId, channel: fact.channel, at: fact.at },
    conclusion: facts.factText(fact),
  };
}

// Routing and descriptor upkeep read metadata only; reading content as evidence is audited.
async function loadCaseRow(service, ctx, p, id, refs, { audited = false } = {}) {
  const state = audited
    ? await service.loadVisibleCase(ctx, p, id)
    : await ctx.broker.getLocalService('domain-router').loadCase(p, id, { summaryOnly: true });
  if (!visible(p, state) || state.disposition === 'discarded' || state.mergedInto) return null;
  const saved = await service.store.getTurnMemory({ tenantId: p.tenantId, caseId: id });
  const row = caseRow(state, saved, refs);
  if (!row) return null;
  const displayRef = await service.store.caseDisplayRef({ tenantId: p.tenantId, caseId: id });
  row.provenance.displayRef = displayRef;
  row.sourceRevision = saved?._rev;
  return row;
}

async function loadMemoryRow(service, ctx, p, id, refs) {
  const fact = (await facts.get(ctx, p, id)).payload;
  const row = memoryRow(fact);
  if (!row || fact.type !== 'tenant_memory_fact') return null;
  if (row.provenance.conversationId) {
    const matching = (refs || (await conversationRefs(service, p))).filter(
      (ref) =>
        ref.conversationId === row.provenance.conversationId &&
        (!row.provenance.channel || ref.client === row.provenance.channel)
    );
    row.refs.push(
      ...matching.map((ref) => ({
        caseId: ref.cetCaseId,
        conversationId: ref.conversationId,
        channel: ref.client,
      }))
    );
  }
  const origin = await require('./tenant-evidence-read').chatEvidenceOrigin(ctx, row);
  return origin.inaccessible ? null : { ...row, provenance: { ...row.provenance, ...origin } };
}

function isCurrent(row, ctx, refs) {
  const current = currentConversation(ctx);
  return Boolean(
    current &&
    (row.provenance.conversationId === current ||
      row.refs?.some((ref) => ref.conversationId === current) ||
      refs.some((ref) => ref.conversationId === current && ref.cetCaseId === row.provenance.caseId))
  );
}

// Persist in the original source, re-reading both authorization and content before every write.
async function persistDescriptor(service, ctx, p, kind, row, enriched) {
  if (kind === 'memory') {
    await facts.mutate(ctx, p, row.id, (fact) => {
      const fresh = memoryRow(fact);
      return fresh?.hash === row.hash &&
        descriptor.descriptorInput(kind, fresh).fingerprint === enriched.fingerprint
        ? { ...fact, evidenceDescriptor: enriched }
        : null;
    });
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const refs = await conversationRefs(service, p);
    const fresh = await loadCaseRow(service, ctx, p, row.id, refs);
    if (
      !fresh ||
      fresh.hash !== row.hash ||
      descriptor.descriptorInput(kind, fresh).fingerprint !== enriched.fingerprint
    )
      return;
    const saved = await service.store.getTurnMemory({ tenantId: p.tenantId, caseId: row.id });
    if (saved?._rev !== fresh.sourceRevision) continue;
    const record = saved || {
      _id: `turn-memory:${encodeURIComponent(p.tenantId)}:${encodeURIComponent(row.id)}`,
      type: 'workbench_turn_memory',
      tenantId: p.tenantId,
      caseId: row.id,
      memory: {
        topic: fresh.topic,
        situation: fresh.sectionNames[0],
        lastSafeConclusion: fresh.conclusion,
        memoryUpdatedAt: fresh.provenance.at,
      },
    };
    try {
      await service.store.turnMemoryDb.put({ ...record, evidenceDescriptor: enriched });
      return;
    } catch (error) {
      if (error.status !== 409 || attempt === 3) throw error;
    }
  }
}

async function storeDescriptor(service, ctx, p, kind, row) {
  row.evidenceDescriptor = background.availableDescriptor(kind, row);
  await persistDescriptor(service, ctx, p, kind, row, row.evidenceDescriptor);
  // Keep only authenticated identity and source keys for background writes.
  const meta = { authUser: ctx.meta?.authUser, apiToken: ctx.meta?.apiToken };
  const source = { id: row.id, hash: row.hash };
  const safe = {
    broker: ctx.broker,
    meta,
    params: {},
    call: (name, params, options) =>
      service.broker.call(name, params, { ...options, meta: { ...meta, ...options?.meta } }),
  };
  background.scheduleDescriptor(service, kind, row, (value) =>
    persistDescriptor(service, safe, p, kind, source, value)
  );
}

// Bound per-turn work: only the most recently updated sessions and statements become candidates.
async function sessionEntries(ctx, service, p, kind) {
  const limit = service.settings?.tenantEvidenceSessions?.maxCandidates ?? 64;
  const recent = (items, at) =>
    items.sort((a, b) => String(at(b) || '').localeCompare(String(at(a) || ''))).slice(0, limit);
  if (kind === 'case')
    return recent(
      await service.visibleDomainStates(p),
      (state) => state.updatedAt || state.createdAt
    ).map((state) => state.cetCaseId);
  if (!ctx.broker.getLocalService('object-store')) return [];
  return recent(
    await facts.query(ctx, p, { 'payload.type': 'tenant_memory_fact' }),
    (fact) => fact.payload?.at || fact.at
  ).map((fact) => fact.id);
}

async function sessionCandidates(ctx, question, kind) {
  const service = serviceFor(ctx);
  if (
    !service?.store?.conversationsDb ||
    typeof ctx.broker.getLocalService('domain-router')?.loadCase !== 'function'
  )
    return [];
  const p = principal(ctx),
    result = [];
  let refs, entries;
  // An optional source must never prevent the turn's answer.
  try {
    refs = await conversationRefs(service, p);
    entries = await sessionEntries(ctx, service, p, kind);
  } catch (error) {
    service.logger?.debug('Session evidence unavailable', {
      errorClass: error.type || error.name,
    });
    return [];
  }
  for (const id of entries) {
    try {
      const row =
        kind === 'case'
          ? await loadCaseRow(service, ctx, p, id, refs)
          : await loadMemoryRow(service, ctx, p, id, refs);
      if (!row || isCurrent(row, ctx, refs)) continue;
      if (descriptor.needsDescriptor(kind, row, question, p.actorId))
        await storeDescriptor(service, ctx, p, kind, row);
      result.push(descriptor.evidenceCandidate(kind, row, p.actorId));
    } catch (error) {
      service.logger?.debug('Session evidence unavailable', {
        errorClass: error.type || error.name,
      });
    }
  }
  return result;
}

async function readSessionEvidence(ctx, selected) {
  const p = principal(ctx),
    service = serviceFor(ctx);
  try {
    const refs = await conversationRefs(service, p);
    const kind = selected.sourceType;
    const row =
      kind === 'case'
        ? await loadCaseRow(service, ctx, p, selected.sourceId, refs, { audited: true })
        : await loadMemoryRow(service, ctx, p, selected.sourceId, refs);
    if (
      !row ||
      isCurrent(row, ctx, refs) ||
      row.hash !== selected.provenance.hash ||
      descriptor.descriptorInput(kind, row).fingerprint !== selected.descriptorFingerprint ||
      row.evidenceCorrections?.some(
        (entry) => entry.actorId === p.actorId && entry.kind === 'reject'
      )
    )
      throw new Error('Session evidence changed');
    const location =
      kind === 'case' ? 'Fallzusammenfassung / Turn-Memory' : 'Festgehaltene Aussage';
    const sourceLabel = row.title;
    return {
      title: row.title,
      gaps: [],
      trace: [],
      evidence: [
        {
          source: kind === 'case' ? 'workbench.turnMemory' : 'tenant-memory.statement',
          value: `${row.conclusion}\nHerkunft: ${sourceLabel}; ${row.provenance.displayRef ? `Fall ${row.provenance.displayRef}; ` : ''}Gespräch: ${row.provenance.conversationId ? 'früheres Gespräch' : 'nicht dokumentiert'}; Zeitpunkt: ${row.provenance.at}; Fundstelle: ${location}.`,
          metadata: {
            tenantId: p.tenantId,
            evidenceQuality: 'validated',
            sourceType: kind,
            sourceId: row.id,
            sourceLabel,
            location,
            hash: row.hash,
            ...row.provenance,
          },
        },
      ],
    };
  } catch (_error) {
    return {
      title: selected.title,
      evidence: [],
      gaps: [`Für „${selected.title}“ ist kein aktueller autorisierter Lesezugriff verfügbar.`],
      trace: [],
    };
  }
}

async function correctSessionEvidence(service, ctx) {
  require('./shared-service-learning').correctionPrincipal(ctx.params, ctx.meta);
  const correction = descriptor.validateEvidenceCorrection(ctx.params.correction);
  const p = principal(ctx);
  if (correction.sourceType === 'memory') {
    if (!(await loadMemoryRow(service, ctx, p, correction.sourceId)))
      deny('Evidence not accessible');
    await facts.mutate(ctx, p, correction.sourceId, (fact) =>
      descriptor.correctedEvidence(fact, ctx.params)
    );
  } else if (correction.sourceType === 'case') {
    if (
      !(await loadCaseRow(service, ctx, p, correction.sourceId, await conversationRefs(service, p)))
    )
      deny('Evidence not accessible');
    for (let attempt = 0; attempt < 4; attempt++) {
      const saved = await service.store.getTurnMemory({
        tenantId: p.tenantId,
        caseId: correction.sourceId,
      });
      if (!saved) deny('Evidence not accessible');
      try {
        await service.store.turnMemoryDb.put(descriptor.correctedEvidence(saved, ctx.params));
        return { corrected: true };
      } catch (error) {
        if (error.status !== 409 || attempt === 3) throw error;
      }
    }
  } else deny('Wrong evidence source');
  return { corrected: true };
}

async function prepareFactDescriptor(ctx, p, fact) {
  const service = serviceFor(ctx);
  const row = memoryRow(fact);
  if (service?.store && row) await storeDescriptor(service, ctx, p, 'memory', row);
}

async function prepareCaseDescriptor(service, p, saved) {
  if (!service.broker.getLocalService('domain-router')) return;
  const ctx = {
    broker: service.broker,
    params: {},
    meta: {},
    call: service.broker.call.bind(service.broker),
  };
  const row = await loadCaseRow(service, ctx, p, saved.caseId, await conversationRefs(service, p));
  if (row) await storeDescriptor(service, ctx, p, 'case', row);
}

const mixin = {
  async stopped() {
    await background.stopDescriptorWorker(this);
  },
  actions: {
    evidenceCorrect: {
      visibility: 'protected',
      params: {
        correction: 'object',
        tenantId: 'string',
        actorId: 'string',
        correctionId: 'string',
        at: 'string',
        sequence: { type: 'number', integer: true, min: 0, optional: true },
      },
      handler(ctx) {
        return correctSessionEvidence(this, ctx);
      },
    },
  },
};
module.exports = {
  sessionCandidates,
  readSessionEvidence,
  prepareCaseDescriptor,
  prepareFactDescriptor,
  caseRow,
  memoryRow,
  mixin,
};
