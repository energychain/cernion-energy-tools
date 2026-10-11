'use strict';

const { normalizePhrase } = require('./function-resolver');
const { loadDocuments } = require('./workbench-document');
const { rawContentAllowed } = require('./case-linking');
const memory = require('./tenant-memory-store');

function matches(value, terms) {
  const content = normalizePhrase(value);
  return terms.some((term) => content.includes(normalizePhrase(term)));
}
async function searchKnowledge(service, ctx, p, situation) {
  const terms = [situation.selfKnowledge.query, ...(situation.retrievalTerms || [])].filter(
    Boolean
  );
  const evidence = [],
    trace = [];
  const read = async (source, task) => {
    const started = performance.now();
    try {
      const hits = await require('./workbench-capability-loop').withinToolBudget(task, 2000);
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
  const hit = (source, title, value) => ({
    source,
    retrievalSource: source,
    value: value.slice(0, 1200),
    metadata: { name: title },
  });
  const router = ctx.broker.getLocalService('domain-router');
  let states = [];
  await read('cases', async () => {
    if (!router) throw new Error('Cases unavailable');
    states = (await router.visibleStates(p)).filter((state) => rawContentAllowed(p, state));
    const hits = [];
    for (const state of states) {
      const summary = await router.readCaseSummary(p, state);
      if (matches(JSON.stringify(summary), terms)) {
        const ref = await service.store.caseDisplayRef({
          tenantId: p.tenantId,
          caseId: state.cetCaseId,
        });
        hits.push(hit('cases', `Fall ${ref}`, `Fall ${ref}: ${summary.summary}`));
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
        .map((fact) => hit('tenant-memory', 'Tenant-Gedächtnis', memory.factText(fact)));
    }),
    read('documents', async () => {
      if (
        !router ||
        trace.some((entry) => entry.source === 'cases' && entry.status === 'unavailable')
      )
        throw new Error('Documents unavailable');
      const hits = [];
      for (const state of states.filter((state) => rawContentAllowed(p, state))) {
        const docs = await loadDocuments(service.store, { ...p, caseId: state.cetCaseId });
        for (const doc of docs)
          if (matches(doc.name + '\n' + doc.text, terms)) {
            const term = terms.find((value) => matches(doc.text, [value]));
            const offset = term ? normalizePhrase(doc.text).indexOf(normalizePhrase(term)) : 0;
            hits.push(
              hit(
                'documents',
                doc.name,
                `${doc.name}: ${doc.text.slice(Math.max(0, offset - 100), Math.max(0, offset - 100) + 900)}`
              )
            );
          }
      }
      return hits;
    }),
    read('datasets', async () => {
      if (!ctx.broker.getLocalService('datapoint')) throw new Error('Datasets unavailable');
      const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
      return records
        .filter((record) =>
          matches(JSON.stringify([record.title, record.description, record.anchors]), terms)
        )
        .map((record) =>
          hit(
            'datasets',
            record.title,
            `Datensatz ${record.title}: ${record.description || ''}; ${record.provenance?.at || ''}`
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
  };
  return (
    'Nachgesehen: ' +
    trace
      .map(
        (entry) =>
          `${labels[entry.source]} (${entry.status === 'unavailable' ? 'gerade nicht erreichbar' : entry.hitCount ? `${entry.hitCount} Treffer` : 'keine Treffer'})`
      )
      .join(', ') +
    '.'
  );
}
module.exports = { searchKnowledge, searchSummary };
