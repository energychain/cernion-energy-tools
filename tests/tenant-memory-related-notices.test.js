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

  test("work on an anchor recalls others' notices, never one's own earlier ones", async () => {
    const found = await memory.related(ctx(), p, { turnKind: 'work' }, 'Plane Nachberechnungen.');
    expect(found.evidence).toHaveLength(2);
    expect(found.text).toContain('Relation rel-other');
    expect(found.text).toContain('Einschätzung other');
    expect(found.text).not.toContain('Relation rel-own');
    expect(found.text).not.toContain('Einschätzung own');
  });

  test("a question gets others' statements as evidence only, without their notices", async () => {
    const found = await memory.related(
      ctx(),
      p,
      { turnKind: 'knowledge' },
      'Welche Nachberechnungen?'
    );
    expect(found.evidence).toHaveLength(2);
    expect(found.text).toBe('');
  });

  test('a statement made in this turn shows its relation notice', async () => {
    const found = await memory.related(ctx(['own']), p, {}, 'Plane Nachberechnungen.');
    expect(found.text).toContain('Relation rel-own');
  });

  test('statements of this conversation lead and are marked even when an anchor matched them', async () => {
    store.query.mockResolvedValue([
      { ...fact('old', 'actor-a', []), conversationId: 'c-0', at: '2026-11-03T10:00:00.000Z' },
      fact('other', 'actor-b', []),
      { ...fact('now', 'actor-a', []), conversationId: 'c-9', at: '2026-11-04T12:00:00.000Z' },
    ]);
    const found = await memory.related(ctx(), p, {}, 'Welche Nachberechnungen?', {
      conversationId: 'c-9',
      channel: 'api',
    });
    expect(found.evidence[0].metadata).toMatchObject({ key: 'now', ownConversation: true });
    expect(found.evidence.filter((hit) => hit.metadata.ownConversation)).toHaveLength(1);
  });

  test('a work turn matching many statements gets a bounded set of notices', async () => {
    store.query.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        ...fact(`other-${index}`, 'actor-b', [`rel-${index}`]),
        at: `2026-11-0${index + 1}T10:00:00.000Z`,
        plausibility: [`Einschätzung ${index} `.padEnd(400, '.')],
      }))
    );
    const found = await memory.related(ctx(), p, { turnKind: 'work' }, 'Plane Nachberechnungen.');
    expect(found.evidence).toHaveLength(6);
    expect(found.text.length).toBeLessThanOrEqual(1500 + 2 * 6);
    // The newest statements contribute first; the oldest ones do not.
    expect(found.text).toContain('Einschätzung 5');
    expect(found.text).not.toContain('Einschätzung 0');
  });
});
