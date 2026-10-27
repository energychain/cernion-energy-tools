'use strict';

jest.mock('../src/workbench-conversation', () => ({ saveTurn: jest.fn(async () => {}) }));
const conversation = require('../src/workbench-conversation');
const { caseTransferRequested, caseTransferReply } = require('../src/table-case-transfer');

test.each([
  ['Lege für die überfälligen Einträge Fälle mit Frist und Owner-Rolle an.', true],
  ['Erstelle Vorgänge für die offenen Zeilen.', true],
  ['Lege keine Fälle an, nur zählen.', false],
  ['Wie viele Fälle sind offen?', false],
])('case transfer request: %s', (message, expected) => {
  expect(caseTransferRequested(message)).toBe(expected);
});

function context(rows) {
  const calls = [];
  let next = 0;
  const ctx = {
    call: jest.fn(async (name, params) => {
      calls.push({ name, params });
      if (name === 'dataset.analyze')
        return { result: rows, provenance: 'Herkunft: liste.csv, Version 1.' };
      if (name === 'domain-router.classify') return { cetCaseId: `case-${++next}` };
      throw new Error(`unexpected ${name}`);
    }),
  };
  const service = {
    conversationsDb: {},
    store: { caseDisplayRef: jest.fn(async ({ caseId }) => `F-${caseId.split('-')[1]}`) },
  };
  return { ctx, service, calls };
}

test('one internal case per selected row, identifiers filed once per conversation', async () => {
  const { ctx, service, calls } = context([
    { Kennung: 'A-1', Titel: 'Erste Klärung', Frist: '2026-02-27', Owner: 'Team A' },
    { kennung: 'A-2', titel: 'Zweite Klärung', frist: null, owner: '' },
    { kennung: 'A-1', titel: 'Dublette', frist: '', owner: '' },
  ]);
  const reply = await caseTransferReply(service, ctx, {
    p: { tenantId: 'synthetic-a' },
    envelope: { userRequest: 'Lege für die offenen Zeilen Fälle an.', conversationId: 'c-1' },
    pending: { tableCaseIdentifiers: ['A-2'] },
    meta: {},
    records: [{ id: `ds_${'a'.repeat(32)}` }],
  });
  const created = calls.filter((call) => call.name === 'domain-router.classify');
  expect(created).toHaveLength(1);
  const situation = created[0].params.knownContext.situation;
  expect(situation.caseWork).toMatchObject({ ownerRole: 'Team A', deadline: '2026-02-27' });
  expect(situation.requestedAction.externalEffect).toBe(false);
  expect(situation.identifiers).toEqual([{ kind: 'kennung', value: 'A-1' }]);
  expect(reply.responseText).toContain('Fall F-1: A-1 – Erste Klärung; Frist: 2026-02-27');
  expect(reply.responseText).toContain('Bereits in diesem Gespräch angelegt: A-2.');
  expect(reply.responseText).toContain('Es wurde nichts an Externe gesendet.');
  expect(conversation.saveTurn.mock.calls.at(-1)[3].tableCaseIdentifiers.sort()).toEqual([
    'A-1',
    'A-2',
  ]);
});

test('no request, no tables: the regular path answers', async () => {
  const { ctx, service } = context([]);
  const base = { p: {}, pending: {}, meta: {}, envelope: { userRequest: 'Was ist offen?' } };
  await expect(caseTransferReply(service, ctx, { ...base, records: [{ id: 'x' }] })).resolves.toBe(
    null
  );
  await expect(
    caseTransferReply(service, ctx, {
      ...base,
      envelope: { userRequest: 'Lege Fälle an.' },
      records: [],
    })
  ).resolves.toBe(null);
  expect(ctx.call).not.toHaveBeenCalled();
});
