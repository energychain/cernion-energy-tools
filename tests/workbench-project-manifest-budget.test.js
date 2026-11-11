'use strict';

jest.mock('../src/project-skill-turn', () => ({
  projectSkillTurn: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/workbench-tenant-evidence', () => ({
  correctSelection: jest.fn().mockResolvedValue(null),
  caseProposal: jest.fn().mockReturnValue(null),
}));
jest.mock('../src/project-manifest-evidence', () => ({ projectManifestAnswer: jest.fn() }));
jest.mock('../src/project-manifest-prose', () => ({
  projectManifestProse: jest.fn().mockResolvedValue({ responseText: 'Antwort' }),
}));
jest.mock('../src/workbench-conversation', () => ({ saveTurn: jest.fn().mockResolvedValue({}) }));

const evidence = require('../src/project-manifest-evidence');
const conversation = require('../src/workbench-conversation');
const { projectManifestTurn } = require('../src/workbench-project-manifest');

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  jest.clearAllMocks();
});

test('the direct path gives way to the regular turn after its budget and stores nothing late', async () => {
  process.env.WORKBENCH_TENANT_EVIDENCE_BUDGET_MS = '30';
  let finish;
  evidence.projectManifestAnswer.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = { logger, conversationsDb: {}, settings: {} };
  const ctx = { broker: { getLocalService: () => ({}) }, call: jest.fn() };
  const reply = await projectManifestTurn(service, ctx, {
    p: { tenantId: 't', actorId: 'a' },
    envelope: { userRequest: 'Was ergibt sich aus den Unterlagen?', conversationId: 'c' },
    pending: {},
    meta: {},
  });
  expect(reply).toBeNull();
  expect(logger.info).toHaveBeenCalledWith('Tenant evidence budget exceeded', { budgetMs: 30 });
  finish({ evidence: [], trace: [], gaps: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(conversation.saveTurn).not.toHaveBeenCalled();
});
