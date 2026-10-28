'use strict';

const { normalizePhrase } = require('./function-resolver');
const { loadDocuments } = require('./workbench-document');
const { rawContentAllowed } = require('./case-linking');
const memory = require('./tenant-memory-store');

function matches(value, terms) {
  const content = normalizePhrase(value);
  return terms.some((term) => content.includes(normalizePhrase(term)));
}
async function searchKnowledge(service, ctx, p, situation, scope = {}) {
  const semanticRequested = situation.caseSearch?.requested === true;
  const terms = [situation.selfKnowledge.query, ...(situation.retrievalTerms || [])].filter(
    Boolean
  );
  const evidence = [],
    trace = [];
  const read = async (source, task) => {
    if (source === 'datasets' && situation.dataQuestion && !situation.dataQuestion.requested) {
      trace.push({ source, called: false, status: 'skipped', hitCount: 0, ms: 0 });
      return;
    }
    const started = performance.now();
    try {
      const hits = await require('./workbench-capability-loop').withinToolBudget(
        task,
        source === 'cases' && semanticRequested
          ? require('./workbench-understanding').llmOptions(p.tenantId).timeoutMs + 1000
          : 2000
      );
      evidence.push(...hits);
      trace.push({
        source,
        called: true,
        status: hits.length ? 'available' : 'missing',
        hitCount: hits.length,
        ms: Math.round(performance.now() - started),
      });
    } catch (_error) {
      trace.push({
        source,
        called: true,
        status: 'unavailable',
        hitCount: 0,
        ms: Math.round(performance.now() - started),
      });
    }
  };
  const hit = (source, title, value, metadata = {}) => ({
    source,
    retrievalSource: source,
    value: value.slice(0, 1200),
    metadata: { name: title, ...metadata },
  });
  const router = ctx.broker.getLocalService('domain-router');
  let states = [];
  await read('cases', async () => {
    if (!router) throw new Error('Cases unavailable');
    states = (await router.visibleStates(p)).filter((state) => rawContentAllowed(p, state));
    const hits = [];
    const candidates = [];
    for (const state of states) {
      const summary = await router.readCaseSummary(p, state);
      const turnMemory = service.loadTurnMemory
        ? await service.loadTurnMemory(p, state.cetCaseId)
        : null;
      const situation = state.knownContext?.situation;
      if (
        situation?.concern ||
        situation?.situation ||
        turnMemory?.lastSafeConclusion ||
        (!service.loadTurnMemory && summary.summary)
      )
        candidates.push({
          caseId: state.cetCaseId,
          summary: summary.summary,
          topic: situation?.concern,
          situation: situation?.situation,
          memory:
            turnMemory ||
            (Object.values(state.caseWork || {}).some((value) => value?.trim())
              ? { caseWork: state.caseWork, situation: situation?.situation }
              : null),
        });
      if (!semanticRequested && matches(JSON.stringify(summary), terms)) {
        const ref = await service.store.caseDisplayRef({
          tenantId: p.tenantId,
          caseId: state.cetCaseId,
        });
        hits.push(hit('cases', `Fall ${ref}`, `Fall ${ref}: ${summary.summary}`));
      }
    }
    if (semanticRequested) {
      const selected = await require('./workbench-case-search').selectSemanticCases(
        situation.caseSearch.query || situation.selfKnowledge.query,
        candidates,
        p.tenantId
      );
      for (const item of selected) {
        if (router.loadCase) {
          try {
            const current = await router.loadCase(p, item.caseId);
            if (!rawContentAllowed(p, current)) continue;
          } catch (error) {
            if ([403, 404].includes(error.code || error.status)) continue;
            throw error;
          }
        }
        const ref = await service.store.caseDisplayRef({
          tenantId: p.tenantId,
          caseId: item.caseId,
        });
        hits.push({
          source: 'cases',
          retrievalSource: 'cases',
          value: require('./workbench-case-search').renderCaseMemory(item, ref),
          metadata: {
            name: `Fall ${ref}`,
            caseId: item.caseId,
            displayRef: ref,
            caseMemory: item.memory,
            caseTopic: item.topic,
            caseSituation: item.situation,
            caseSummary: item.summary,
          },
        });
      }
    }
    return hits;
  });
  await Promise.all([
    read('tenant-memory', async () => {
      if (!ctx.broker.getLocalService('object-store')) throw new Error('Memory unavailable');
      const facts = await memory.query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
      return facts
        .filter((fact) => memory.active(fact) && matches(memory.factText(fact), terms))
        .map((fact) =>
          hit('tenant-memory', 'Tenant-Gedächtnis', memory.factText(fact), {
            namespace: memory.namespace(p),
            key: fact.id,
            workbenchDocument: fact.documentSource?.id,
          })
        );
    }),
    read('documents', async () => {
      if (
        !router ||
        trace.some((entry) => entry.source === 'cases' && entry.status === 'unavailable')
      )
        throw new Error('Documents unavailable');
      const hits = [];
      for (const state of states.filter((state) => rawContentAllowed(p, state))) {
        const docs = await loadDocuments(
          service.store,
          { ...p, caseId: state.cetCaseId },
          { broker: service.broker, roles: p.roles }
        );
        for (const doc of docs)
          if (matches(doc.name + '\n' + doc.text, terms)) {
            const term = terms.find((value) => matches(doc.text, [value]));
            const offset = term ? normalizePhrase(doc.text).indexOf(normalizePhrase(term)) : 0;
            hits.push(
              hit(
                'documents',
                doc.name,
                `${doc.name}: ${doc.text.slice(Math.max(0, offset - 100), Math.max(0, offset - 100) + 900)}`,
                { workbenchDocument: doc.knowledgeDocumentId }
              )
            );
          }
      }
      return hits;
    }),
    // Cold start (#997): what CET knows about the organisation, what is disputed, what is open.
    read('knowledge-register', async () => {
      if (!ctx.broker.getLocalService('knowledge-needs')) throw new Error('Register unavailable');
      const needs = await ctx.call('knowledge-needs.list', { limit: 500 });
      const latest = (need) =>
        [...(need.answers || [])]
          .filter((answer) => answer.value)
          .sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
      const known = needs
        .filter((need) => ['answered', 'confirmed', 'disputed'].includes(need.state))
        .map((need) => {
          const answer = latest(need);
          return hit(
            'knowledge-register',
            need.label,
            `${need.state === 'disputed' ? 'Strittig' : need.state === 'confirmed' ? 'Bestätigt' : 'Bekannt'}: ${need.label}${answer ? ` = ${answer.value} (Angabe von ${answer.actorId || 'unbekannt'}, ${String(answer.at || '').slice(0, 10)})` : ''}`,
            { needId: need.needId, state: need.state }
          );
        });
      const open = needs.filter((need) => ['unknown', 'asked'].includes(need.state));
      return [
        ...known,
        ...(open.length
          ? [
              hit(
                'knowledge-register',
                'Offene Wissensbedarfe',
                `Noch offen (${open.length}), wichtigste: ${open
                  .slice(0, 8)
                  .map((need) => need.label)
                  .join('; ')}`,
                { openCount: open.length }
              ),
            ]
          : []),
      ];
    }),
    read('datasets', async () => {
      if (!ctx.broker.getLocalService('datapoint')) throw new Error('Datasets unavailable');
      const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
      const scoped = situation.dataQuestion
        ? require('./workbench-data-scope').scopedDatasets(
            records,
            situation.selfKnowledge.query,
            scope
          )
        : records;
      return scoped
        .filter((record) =>
          matches(JSON.stringify([record.title, record.description, record.anchors]), terms)
        )
        .map((record) =>
          hit(
            'datasets',
            record.title,
            `Datensatz ${record.title}: ${record.description || ''}; ${record.provenance?.at || ''}`,
            { datasetId: record.id, tenantId: record.tenantId }
          )
        );
    }),
  ]);
  return { evidence, trace };
}
function searchSummary(trace) {
  const labels = {
    cases: 'Fälle',
    'tenant-memory': 'Tenant-Gedächtnis',
    documents: 'Dokumente',
    datasets: 'Datensätze',
    'knowledge-register': 'Wissensbedarfe',
  };
  return (
    'Nachgesehen: ' +
    trace
      .filter((entry) => entry.called !== false)
      .map(
        (entry) =>
          `${labels[entry.source]} (${entry.status === 'unavailable' ? 'gerade nicht erreichbar' : entry.hitCount ? `${entry.hitCount} Treffer` : 'keine Treffer'})`
      )
      .join(', ') +
    '.'
  );
}
module.exports = { searchKnowledge, searchSummary };
