'use strict';

// Relation notices accompany a recalled statement only when it is someone else's or was made in
// this turn; one's own earlier statement is recalled without repeating its assessment.
const store = require('../src/tenant-memory-store');
const memory = require('../src/tenant-memory');

const anchor = { value: 'Nachberechnungen', qualifier: '', aliases: [] };
const fact = (id, actorId, relationIds) => ({
  id,
  status: 'valid',
  text: `Aussage ${id} zu Nachberechnungen.`,
  anchors: [anchor],
  person: { actorId, name: actorId, functionLabel: '' },
  conversationId: 'c-1',
  channel: 'api',
  at: '2026-11-04T10:00:00.000Z',
  relationIds,
  plausibility: [`Einschätzung ${id}`],
});

describe('related() relation notices', () => {
  const p = { tenantId: 'tenant-a', actorId: 'actor-a' };
  const ctx = (current = []) => ({
    broker: { getLocalService: () => ({}) },
    meta: { tenantMemoryCurrentFacts: current },
  });
  beforeEach(() => {
    jest
      .spyOn(store, 'query')
      .mockResolvedValue([
        fact('own', 'actor-a', ['rel-own']),
        fact('other', 'actor-b', ['rel-other']),
      ]);
    jest.spyOn(store, 'relationText').mockImplementation(async (_ctx, _p, id) => `Relation ${id}`);
  });
  afterEach(() => jest.restoreAllMocks());

  test("an earlier own statement is recalled without its relation notice; others' keep theirs", async () => {
    const found = await memory.related(ctx(), p, {}, 'Welche Nachberechnungen?');
    expect(found.evidence).toHaveLength(2);
    expect(found.text).toContain('Relation rel-other');
    expect(found.text).toContain('Einschätzung other');
    expect(found.text).not.toContain('Relation rel-own');
    expect(found.text).not.toContain('Einschätzung own');
  });

  test('a statement made in this turn shows its relation notice', async () => {
    const found = await memory.related(ctx(['own']), p, {}, 'Plane Nachberechnungen.');
    expect(found.text).toContain('Relation rel-own');
  });
});
