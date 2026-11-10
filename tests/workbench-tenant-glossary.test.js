'use strict';

const store = require('../src/tenant-memory-store');
const { loadTenantGlossary } = require('../src/workbench-tenant-glossary');

const fact = (id, conversationId) => ({
  id,
  type: 'tenant_memory_fact',
  statementKind: 'glossary',
  status: 'valid',
  conversationId,
  glossary: { term: 'Fixture-Metadaten', meaning: 'Angaben zum Testaufbau', kind: 'other' },
  basis: 'Synthetischer Fall: Fixture-Metadaten … Spur Kormoran … Strukturhalterin Ilvana',
});

afterEach(() => jest.restoreAllMocks());

test("another conversation's definition reaches the prompt without its original message", async () => {
  jest.spyOn(store, 'query').mockResolvedValue([fact('g1', 'chat-a'), fact('g2', 'chat-b')]);
  jest.spyOn(store, 'active').mockReturnValue(true);
  const ctx = { broker: { getLocalService: () => ({}) }, call: jest.fn() };
  const entries = await loadTenantGlossary(
    ctx,
    { tenantId: 't' },
    'Welche Fixture-Metadaten liegen vor?',
    {},
    { conversationId: 'chat-b' }
  );
  expect(entries.find((entry) => entry.factId === 'g1')).not.toHaveProperty('basis');
  expect(entries.find((entry) => entry.factId === 'g1').meaning).toBe('Angaben zum Testaufbau');
  expect(entries.find((entry) => entry.factId === 'g2').basis).toContain('Kormoran');
});

test("another conversation's definition carrying identifiers is not passed on", async () => {
  const marked = {
    ...fact('g3', 'chat-a'),
    glossary: {
      term: 'Isolationstest',
      meaning: 'Projekt Südwind-E97793, Marker ISO-P2-E97793',
      kind: 'other',
    },
  };
  const own = { ...marked, id: 'g4', conversationId: 'chat-b' };
  jest.spyOn(store, 'query').mockResolvedValue([marked, own]);
  jest.spyOn(store, 'active').mockReturnValue(true);
  const ctx = { broker: { getLocalService: () => ({}) }, call: jest.fn() };
  const entries = await loadTenantGlossary(
    ctx,
    { tenantId: 't' },
    'Synthetischer Isolationstest für Projekt Nordlicht',
    {},
    { conversationId: 'chat-b' }
  );
  expect(entries.map((entry) => entry.factId)).toEqual(['g4']);
});
