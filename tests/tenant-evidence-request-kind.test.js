'use strict';

// The outer-request check also judges the conversation scope (TWL CTX-01).
jest.mock('../src/llm-client', () => ({
  ...jest.requireActual('../src/llm-client'),
  generateStructured: jest.fn(),
}));
const llm = require('../src/llm-client');
const {
  evidenceRequestKind,
  evidenceContentRequested,
} = require('../src/tenant-evidence-question');

const ctx = {
  meta: { tenantId: 't1', authUser: { id: 'a1', tenantId: 't1', roles: ['ROLE_USER'] } },
  broker: { logger: { warn() {}, info() {} } },
};

beforeEach(() => llm.generateStructured.mockReset());

test('content and conversation scope come from one check', async () => {
  llm.generateStructured.mockResolvedValue({ contentRequested: true, conversationOnly: true });
  expect(await evidenceRequestKind(ctx, 'Fasse dieses Gespräch zusammen.')).toEqual({
    contentRequested: true,
    conversationOnly: true,
  });
  const input = JSON.parse(llm.generateStructured.mock.calls[0][1]);
  expect(input.task).toBe('evidence_request_kind');
  expect(input.instruction).toContain('conversationOnly=true');
});

test('a missing or failed judgement keeps the tenant scope and denies content', async () => {
  llm.generateStructured.mockResolvedValueOnce({ contentRequested: true });
  expect(await evidenceRequestKind(ctx, 'Was gilt?')).toEqual({
    contentRequested: true,
    conversationOnly: false,
  });
  llm.generateStructured.mockRejectedValueOnce(new Error('down'));
  expect(await evidenceRequestKind(ctx, 'Was gilt?')).toEqual({
    contentRequested: false,
    conversationOnly: false,
  });
  llm.generateStructured.mockResolvedValueOnce({
    contentRequested: false,
    conversationOnly: false,
  });
  expect(await evidenceContentRequested(ctx, 'Lösche die Datei.')).toBe(false);
});
