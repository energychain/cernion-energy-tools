'use strict';

const store = require('../src/tenant-memory-store');
const tenantMemory = require('../src/tenant-memory');

afterEach(() => jest.restoreAllMocks());

test('a named correction without a matching stored statement is left to the regular turn', async () => {
  jest.spyOn(store, 'query').mockResolvedValue([
    {
      id: 'f1',
      status: 'valid',
      text: 'Für das Objekt gilt eine andere Kapazitätsgrenze.',
      basis: 'Für das Objekt gilt eine andere Kapazitätsgrenze.',
      anchors: [],
      person: { actorId: 'a' },
      conversationId: 'c1',
      channel: 'open-webui',
    },
  ]);
  jest.spyOn(store, 'active').mockReturnValue(true);
  const message =
    'Ich muss mich korrigieren: Die Anfrage ging nicht am 05.04., sondern erst am 12.04. raus.';
  const result = await tenantMemory.correctFacts(
    {},
    { tenantId: 't', actorId: 'a' },
    { userRequest: message, conversationId: 'c1', channel: 'open-webui' },
    {},
    { kind: 'corrected', basis: 'nicht am 05.04., sondern erst am 12.04.', factId: '' }
  );
  expect(result).toBeNull();
});
