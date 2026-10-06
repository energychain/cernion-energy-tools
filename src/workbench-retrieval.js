'use strict';

const defaults = require('./workbench-knowledge-sources.json');
const { getFunctionModel } = require('./function-model');
const { createHash } = require('node:crypto');
const { normalizePhrase } = require('./function-resolver');
const { readKinds } = require('./shared-service-agent-policy');

function selectSources(
  situation,
  { catalog = defaults, access = {}, model = getFunctionModel() } = {}
) {
  const hypotheses = (situation.hypotheses || []).filter(
    (entry) => entry.confidence >= catalog.minimumConfidence
  );
  return catalog.sources
    .filter((source) => {
      if (source.requiresMapping && access[source.id] !== true) return false;
      return (
        hypotheses.some((hypothesis) => {
          const values = hypothesis.kind === 'function' ? source.functions : source.domains;
          const relatedDomains =
            hypothesis.kind === 'function'
              ? model.functions.find((fn) => fn.functionId === hypothesis.id)?.domains || []
              : [];
          if (
            relatedDomains.some((domain) =>
              source.domains.some((value) => normalizePhrase(value) === normalizePhrase(domain))
            )
          )
            return true;
          return (
            values.includes('*') ||
            values.some((value) => normalizePhrase(value) === normalizePhrase(hypothesis.id))
          );
        }) ||
        (!source.requiresMapping && source.domains.includes('*'))
      );
    })
    .map((source) => source.id);
}

function terms(text, catalog) {
  const stops = new Set(catalog.stopWords);
  return new Set(
    String(text || '')
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]{4,}/gu)
      ?.filter((word) => !stops.has(word)) || []
  );
}

function filterEvidence(
  hits,
  situation,
  { catalog = defaults, source = defaults.defaultSource } = {}
) {
  const wanted = terms(
    [situation.concern, situation.situation, ...(situation.retrievalTerms || [])].join(' '),
    catalog
  );
  const seen = new Set();
  const accepted = [],
    rejected = [];
  for (const hit of hits) {
    const metadata = hit.metadata || {};
    const identity = [
      metadata.sourceId || metadata.hitId || metadata.name || hit.url || hit.source,
      metadata.sectionId ||
        createHash('sha256')
          .update(hit.value || hit.summary || '')
          .digest('hex'),
    ].join(':');
    const score = metadata.score ?? hit.score;
    const scale = catalog.sources.find((entry) => entry.id === source)?.scoreScale;
    const found = terms(hit.value || hit.summary, catalog);
    const overlap = [...wanted].filter((word) => found.has(word)).length;
    const domainMatch = (metadata.domains || []).some((domain) =>
      (situation.hypotheses || []).some(
        (hypothesis) =>
          hypothesis.kind === 'domain' &&
          hypothesis.confidence >= catalog.minimumConfidence &&
          normalizePhrase(hypothesis.id) === normalizePhrase(domain)
      )
    );
    const reason = seen.has(identity)
      ? 'duplicate'
      : scale === 'unit' &&
          score != null &&
          (!Number.isFinite(Number(score)) || Number(score) < catalog.minimumScore)
        ? 'below_score_threshold'
        : !domainMatch && overlap < catalog.minimumOverlap
          ? 'situation_mismatch'
          : null;
    seen.add(identity);
    if (reason) rejected.push({ ...hit, reason, overlap });
    else accepted.push(hit);
  }
  return { hits: accepted, rejected };
}

async function collectReadCapabilities(ctx, situation) {
  const signals = ctx.broker?.getLocalService('signals');
  const selected = ctx.meta.workbenchSelectedCapabilities || [];
  const caseId = ctx.meta.workbenchEvidenceCaseId;
  if (!signals || !selected.length || !caseId)
    return { status: 'skipped', hits: [], trace: { calledOperations: 0 } };
  const matching = signals.model.functions.filter(
    (fn) =>
      fn.capabilities.some((id) => selected.includes(id)) &&
      (situation.hypotheses || []).some(
        (hypothesis) =>
          hypothesis.confidence >= 0.5 &&
          (hypothesis.kind === 'function'
            ? hypothesis.id === fn.functionId
            : fn.domains.some(
                (domain) => normalizePhrase(domain) === normalizePhrase(hypothesis.id)
              ))
      )
  );
  const params = Object.fromEntries(
    (situation.identifiers || []).map((entry) => [entry.kind, entry.value])
  );
  const seen = new Set(),
    hits = [],
    trace = [];
  for (const fn of matching) {
    const entries = signals
      .catalogEntries(fn.functionId)
      .filter(
        (entry) =>
          readKinds.has(
            signals.operations.find((operation) => operation.operationId === entry.operationId)
              ?.operationKind
          ) && !seen.has(entry.operationId)
      )
      .slice(0, 2 - seen.size);
    for (const entry of entries) {
      seen.add(entry.operationId);
      try {
        // signals.observe reuses assertReadObservation: caller scopes/roles, no-call
        // catalog, declared function mandate, required parameters and consequences.
        const result = await ctx.call(
          'signals.observe',
          {
            tenantId: ctx.meta.tenantId,
            functionId: fn.functionId,
            context: { kind: 'case', ref: caseId, params },
            operationIds: [entry.operationId],
          },
          { meta: ctx.meta, timeout: 1200 }
        );
        hits.push(
          ...(result.signals || []).map((signal) => ({
            source: entry.operationId,
            value:
              `${fn.label}: ${signal.label || signal.kind}: ${JSON.stringify(signal.value)}`.slice(
                0,
                1200
              ),
            metadata: {
              sourceId: entry.operationId,
              sectionId: signal.signalId,
              domains: fn.domains,
            },
          }))
        );
        trace.push({
          operationId: entry.operationId,
          calledOperations: result.calledOperations || 0,
        });
      } catch (error) {
        trace.push({
          operationId: entry.operationId,
          status: 'blocked_or_unavailable',
          error: error.type || error.name,
        });
      }
    }
    if (seen.size >= 2) break;
  }
  return { status: hits.length ? 'available' : 'missing', hits, trace: { operations: trace } };
}

// Reuse the PA collectors; this is one retrieval round, with bounded parallel reads.
async function collectEvidence(
  collector,
  ctx,
  { situation, catalog = defaults, analysisSignals } = {}
) {
  const sources = selectSources(situation, {
    catalog,
    access: ctx.meta.workbenchEvidenceAccess || {},
  });
  const question = [situation.concern, situation.situation, ...(situation.retrievalTerms || [])]
    .join(' ')
    .slice(0, 600);
  const input = {
    question,
    searchTerm: '',
    situation,
    catalog,
    maxEvidence: 5,
    selected: true,
    queryTerms: situation.retrievalTerms?.length ? situation.retrievalTerms : [question],
    context: {},
    analysisSignals: analysisSignals || { active: false },
  };
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        const config = catalog.sources.find((entry) => entry.id === source);
        const result =
          config.kind === 'capability'
            ? await collectReadCapabilities(ctx, situation)
            : await collector[config.collector](ctx, input);
        const filtered = filterEvidence(result.hits || [], situation, { catalog, source });
        return {
          ...result,
          ...filtered,
          source,
          trace: {
            ...result.trace,
            rejected: [...(result.trace?.rejected || []), ...filtered.rejected],
          },
        };
      } catch (error) {
        return {
          source,
          status: 'unavailable',
          hits: [],
          trace: { error: error.type || error.name },
        };
      }
    })
  );
  return {
    evidence: results
      .flatMap((result) => result.hits.map((hit) => ({ ...hit, retrievalSource: result.source })))
      .slice(0, 15),
    noCallBoundaries: [...new Set(results.flatMap((result) => result.noCallBoundaries || []))],
    trace: catalog.sources.map(({ id }) => {
      const result = results.find((entry) => entry.source === id);
      return result
        ? {
            source: id,
            called: result.status !== 'skipped',
            status: result.status,
            hitCount: result.hits.length,
            ...result.trace,
          }
        : { source: id, called: false, status: 'skipped', hitCount: 0 };
    }),
  };
}

module.exports = { selectSources, filterEvidence, collectEvidence, collectReadCapabilities };
