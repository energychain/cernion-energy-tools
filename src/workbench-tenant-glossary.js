'use strict';

const store = require('./tenant-memory-store');
const { exactToken } = require('./workbench-codes');

async function loadTenantGlossary(ctx, p, message, meta) {
  if (!ctx.broker.getLocalService('object-store')) return [];
  const facts = await store.query(
    { ...ctx, call: (name, params) => ctx.call(name, params, { meta }) },
    p,
    {
      'payload.type': 'tenant_memory_fact',
      'payload.statementKind': 'glossary',
    }
  );
  return facts
    .filter(
      (fact) =>
        store.active(fact) &&
        fact.glossary?.term &&
        exactToken(store.normalizeAnchor(message), store.normalizeAnchor(fact.glossary.term))
    )
    .slice(0, 20)
    .map((fact) => ({ ...fact.glossary, basis: fact.basis, factId: fact.id }));
}

module.exports = { loadTenantGlossary };
