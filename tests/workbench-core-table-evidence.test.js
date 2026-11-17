'use strict';

// REG-01 T03: in a running case of a core tenant, a table attached with a question that relates it
// to the case is evidence of the case answer, not a separate table answer without the case.
jest.mock('../src/workbench-capability-loop', () => ({
  ...jest.requireActual('../src/workbench-capability-loop'),
  allowsDataRead: jest.fn(() => true),
}));
jest.mock('../src/dataset-routing', () => ({
  ...jest.requireActual('../src/dataset-routing'),
  selectDatasetCandidates: jest.fn(async (records) => records),
}));
jest.mock('../src/workbench-project-manifest', () => ({
  ...jest.requireActual('../src/workbench-project-manifest'),
  supplementDatasetAnswer: jest.fn(async () => null),
}));
const conversation = require('../src/workbench-conversation');
const { incomingDatasetReply } = require('../src/workbench-content-turn');

const record = {
  id: 'ds-register',
  title: 'register.csv',
  version: 1,
  rowCount: 3,
  columns: [{ name: 'reference' }],
  semantic: {},
  quality: { controls: [] },
};
const call = jest.fn(async (name) => {
  if (name === 'datapoint.datasetCatalog') return [record];
  if (name === 'dataset.analyze')
    return { answer: 'REQ-A am 14.04.; REQ-B am 10.04.', provenance: 'Herkunft: register.csv' };
  throw new Error(`unexpected ${name}`);
});
const run = (pending) => {
  const envelope = {
    userRequest: 'Gleiche den Registerauszug mit dem bisherigen Stand ab. Was ist belastbar?',
    conversationId: 'c',
    datasetIds: ['ds-register'],
    datasetConfirmations: ['Hab ich abgelegt: register.csv, Version 1.'],
  };
  return incomingDatasetReply(
    { conversationsDb: {}, logger: { info: jest.fn() } },
    { call, broker: { getLocalService: () => ({}), logger: { warn: jest.fn() } } },
    { p: { tenantId: 'tenant-core', actorId: 'a' }, envelope, pending, meta: {} }
  ).then((reply) => ({ reply, envelope }));
};

beforeEach(() => jest.spyOn(conversation, 'saveTurn').mockResolvedValue({}));
afterEach(() => {
  delete process.env.WORKBENCH_CONVERSATION_CORE;
  jest.restoreAllMocks();
});

test('in a running case of a core tenant the table read becomes evidence of the case answer', async () => {
  process.env.WORKBENCH_CONVERSATION_CORE = 'tenant-core';
  const { reply, envelope } = await run({ caseState: { turn: 2 } });
  expect(reply).toBeNull();
  expect(envelope.tableEvidence.map((hit) => hit.value).join(' ')).toContain('REQ-B am 10.04.');
  expect(conversation.saveTurn).toHaveBeenCalledWith(
    {},
    expect.anything(),
    envelope,
    expect.objectContaining({
      datasetContext: expect.objectContaining({ datasetIds: ['ds-register'] }),
    })
  );
});

test('without a running case or the core the table answers as before', async () => {
  process.env.WORKBENCH_CONVERSATION_CORE = 'tenant-core';
  expect((await run({})).reply.responseText).toContain('REQ-B am 10.04.');
  delete process.env.WORKBENCH_CONVERSATION_CORE;
  expect((await run({ caseState: { turn: 2 } })).reply.responseText).toContain('REQ-B am 10.04.');
});
