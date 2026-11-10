'use strict';

const store = require('./tenant-memory-store');
const { exactToken } = require('./workbench-codes');

const MAX_MEANING = 300;

// Like a lesson in the cross-case gate: a digit-bearing token (case reference, marker, date) in a
// foreign definition is case content, not a term's meaning, and the entry fails closed.
const carriesIdentifiers = (value) =>
  /[\p{L}\p{N}][\p{L}\p{N}./-]*\p{N}/u.test(String(value || ''));

// A definition is shared tenant knowledge; the verbatim message it was taken from is not. Entries
// from another conversation keep term and meaning only (semantic probe: the defining message
// quoted a whole case description into later answers of other chats).
async function loadTenantGlossary(ctx, p, message, meta, { conversationId } = {}) {
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
        ((conversationId && fact.conversationId === conversationId) ||
          !carriesIdentifiers(fact.glossary.meaning)) &&
        exactToken(store.normalizeAnchor(message), store.normalizeAnchor(fact.glossary.term))
    )
    .slice(0, 20)
    .map((fact) => ({
      ...fact.glossary,
      meaning: String(fact.glossary.meaning || '').slice(0, MAX_MEANING),
      ...(conversationId && fact.conversationId === conversationId ? { basis: fact.basis } : {}),
      factId: fact.id,
    }));
}

module.exports = { loadTenantGlossary };
