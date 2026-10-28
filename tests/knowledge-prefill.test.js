'use strict';

const { tenantKnowledge, prefill } = require('../src/knowledge-prefill');

const schema = {
  type: 'object',
  properties: {
    gridOperatorId: { type: 'string' },
    region: { type: 'string' },
    limit: { type: 'integer' },
  },
};
const knowledge = [
  { key: 'gridOperatorId', value: 'SYN-990', needId: 'need:gridOperatorId', answerId: 'a1' },
  { key: 'region', value: 'SYN-ZONE', needId: 'need:region', answerId: 'a2' },
  { key: 'limit', value: '5', needId: 'need:limit', answerId: 'a3' },
  { key: 'other', value: 'x', needId: 'need:other', answerId: 'a4' },
];

test('only empty, declared string parameters are filled, with provenance', () => {
  const { input, filled } = prefill({ region: 'Explizit' }, schema, knowledge);
  expect(input).toEqual({ gridOperatorId: 'SYN-990', region: 'Explizit' });
  expect(filled).toEqual([
    { parameter: 'gridOperatorId', needId: 'need:gridOperatorId', answerId: 'a1' },
  ]);
});

test('without knowledge or schema nothing changes', () => {
  expect(prefill({ a: 1 }, schema, [])).toEqual({ input: { a: 1 }, filled: [] });
  expect(prefill({}, undefined, knowledge)).toEqual({ input: {}, filled: [] });
});

test('tenant knowledge uses the newest answer of answered or confirmed needs', async () => {
  const needs = [
    {
      needId: 'need:gridOperatorId',
      key: 'gridOperatorId',
      label: 'Kennung',
      kind: 'identifier',
      state: 'answered',
      answers: [
        { answerId: 'old', value: 'SYN-1', at: '2026-10-01T00:00:00.000Z' },
        { answerId: 'new', value: 'SYN-2', at: '2026-10-20T00:00:00.000Z' },
      ],
    },
    { needId: 'need:x', key: 'x', kind: 'fact', state: 'unknown', answers: [] },
    {
      needId: 'need:d',
      key: 'd',
      kind: 'dataset',
      state: 'answered',
      answers: [{ answerId: 'd1', value: 'v', at: '2026-10-01T00:00:00.000Z' }],
    },
    { needId: 'need:y', key: 'y', kind: 'fact', state: 'disputed', answers: [{ value: 'z' }] },
  ];
  const register = { answeredNeeds: jest.fn(async () => needs) };
  const ctx = { broker: { getLocalService: () => register } };
  const offered = [{ schema: { properties: { gridOperatorId: { type: 'string' } } } }];
  expect(await tenantKnowledge(ctx, 'synthetic-a', offered)).toEqual([
    {
      key: 'gridOperatorId',
      label: 'Kennung',
      value: 'SYN-2',
      needId: 'need:gridOperatorId',
      answerId: 'new',
    },
  ]);
  expect(register.answeredNeeds).toHaveBeenCalledWith('synthetic-a');
  const unavailable = { broker: { getLocalService: () => null } };
  expect(await tenantKnowledge(unavailable, 'synthetic-a', offered)).toEqual([]);
  // No offered operation declares a tenant parameter: the register is not consulted.
  register.answeredNeeds.mockClear();
  expect(
    await tenantKnowledge(ctx, 'synthetic-a', [{ schema: { properties: { limit: {} } } }])
  ).toEqual([]);
  expect(register.answeredNeeds).not.toHaveBeenCalled();
});
