'use strict';

jest.mock('../src/project-manifest-evidence', () => ({ projectManifestAnswer: jest.fn() }));
const evidence = require('../src/project-manifest-evidence');
const {
  conversationCoreEnabled,
  storedEvidence,
  wantsStoredMaterial,
} = require('../src/workbench-conversation-core');

afterEach(() => jest.clearAllMocks());

test('the switch enables all tenants or listed ones only', () => {
  expect(conversationCoreEnabled('t', {})).toBe(false);
  expect(conversationCoreEnabled('t', { WORKBENCH_CONVERSATION_CORE: 'all' })).toBe(true);
  expect(conversationCoreEnabled('t', { WORKBENCH_CONVERSATION_CORE: 'a,t' })).toBe(true);
});

test('stored material is asked for only when the understanding wants it', async () => {
  expect(wantsStoredMaterial({ contextScope: 'conversation' })).toBe(false);
  expect(wantsStoredMaterial({ selfKnowledge: { requested: true } })).toBe(true);
  const ctx = { call: jest.fn() };
  await expect(
    storedEvidence({}, ctx, { p: {}, envelope: { userRequest: 'x' }, situation: {} })
  ).resolves.toEqual([]);
  expect(evidence.projectManifestAnswer).not.toHaveBeenCalled();
});

test("another conversation's material becomes labelled evidence for the gate", async () => {
  evidence.projectManifestAnswer.mockResolvedValue({
    evidence: [
      { source: 'Akte', value: 'Eigener Bestand', metadata: {} },
      { source: 'Sitzung', value: 'Fremder Fall', metadata: { otherConversation: true } },
    ],
  });
  const result = await storedEvidence(
    { settings: {} },
    { call: jest.fn() },
    {
      p: { tenantId: 't' },
      envelope: { userRequest: 'Was wissen wir dazu?', conversationId: 'c' },
      pending: {},
      meta: {},
      situation: { selfKnowledge: { requested: true } },
    }
  );
  expect(result[0].metadata.scopeOrigin).toBeUndefined();
  expect(result[1].metadata.scopeOrigin).toBe('aus anderem Gespräch');
});

test('a failing stored-material read leaves the evidence empty', async () => {
  evidence.projectManifestAnswer.mockRejectedValue(new Error('down'));
  const logger = { warn: jest.fn() };
  await expect(
    storedEvidence(
      { logger },
      { call: jest.fn() },
      {
        p: {},
        envelope: { userRequest: 'x' },
        situation: { caseSearch: { requested: true } },
      }
    )
  ).resolves.toEqual([]);
  expect(logger.warn).toHaveBeenCalled();
});
