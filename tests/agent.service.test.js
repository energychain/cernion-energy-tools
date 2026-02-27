/**
 * Agent Service Tests
 *
 * Tests for the AI Agent orchestration service.
 * Mocks Gemini API and Moleculer broker calls to avoid external dependencies.
 */

const { ServiceBroker } = require('moleculer');
const fs = require('fs');
const path = require('path');

// ── Mock @google/generative-ai ────────────────────────────────────────────
jest.mock('@google/generative-ai', () => {
  const mockGenerateContent = jest.fn();
  const mockGetGenerativeModel = jest.fn(() => ({
    generateContent: mockGenerateContent,
  }));
  return {
    GoogleGenerativeAI: jest.fn(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
    _mockGenerateContent: mockGenerateContent,
  };
});

const { _mockGenerateContent } = require('@google/generative-ai');

const AgentService = require('../services/agent.service');

// Helper to build a valid Gemini plan JSON response
function makePlanResponse(overrides = {}) {
  const plan = {
    summary: 'Mock strategy for testing.',
    steps: [
      {
        step: 1,
        service: 'gas-storage',
        action: 'gas-storage.countryStorage',
        description: 'Fetch current gas storage level for Germany',
        params: { country: 'de', date: null },
      },
    ],
    requiredInputs: [
      {
        name: 'date',
        label: 'Reference Date',
        type: 'date',
        description: 'The date to check storage for',
        example: '2026-02-01',
        required: false,
      },
    ],
    ...overrides,
  };
  return JSON.stringify(plan);
}

// Helper to build a valid Gemini interpretation JSON response
function makeInterpretationResponse(overrides = {}) {
  const interp = {
    summary: 'Germany gas storage is at 65%.',
    tableColumns: ['country', 'level', 'trend'],
    tableRows: [{ country: 'de', level: '65%', trend: 'stable' }],
    needsMoreInput: false,
    followUpQuestion: null,
    ...overrides,
  };
  return JSON.stringify(interp);
}

describe('Agent Service', () => {
  let broker;
  const SESSION_DIR = path.join(__dirname, '..', '.sessions');

  beforeAll(async () => {
    process.env.GEMINI_API_KEY = 'test-api-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';

    broker = new ServiceBroker({ logger: false });
    broker.createService(AgentService);

    // Mock gas-storage.countryStorage action
    broker.createService({
      name: 'gas-storage',
      actions: {
        countryStorage: jest.fn().mockResolvedValue({
          success: true,
          country: 'de',
          level: 0.65,
          trend: 'stable',
        }),
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    // Clean up test session files
    if (fs.existsSync(SESSION_DIR)) {
      const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json'));
      files.forEach((f) => {
        try {
          fs.unlinkSync(path.join(SESSION_DIR, f));
        } catch {
          /* ignore */
        }
      });
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── analyze action ────────────────────────────────────────────
  describe('analyze action', () => {
    it('should reject missing problem parameter', async () => {
      await expect(broker.call('agent.analyze', {})).rejects.toThrow();
    });

    it('should reject too-short problem parameter', async () => {
      await expect(broker.call('agent.analyze', { problem: 'hi' })).rejects.toThrow();
    });

    it('should return a session ID and plan when Gemini responds correctly', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'What is the current gas storage level in Germany?',
      });

      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.summary).toBe('Mock strategy for testing.');
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].action).toBe('gas-storage.countryStorage');
      expect(result.requiredInputs).toHaveLength(1);
      expect(result.requiredInputs[0].name).toBe('date');
    });

    it('should persist the session to disk', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Show me gas storage trends in Germany',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      expect(fs.existsSync(sessionFile)).toBe(true);

      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      expect(session.id).toBe(result.sessionId);
      expect(session.status).toBe('awaiting_inputs');
      expect(session.problem).toContain('gas storage');
    });

    it('should strip markdown fences from Gemini JSON response', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => '```json\n' + makePlanResponse() + '\n```' },
      });

      const result = await broker.call('agent.analyze', {
        problem: 'Analyse wind generation in Baden-Württemberg',
      });

      expect(result.summary).toBe('Mock strategy for testing.');
    });

    it('should throw if Gemini returns invalid JSON', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => 'This is not JSON at all.' },
      });

      await expect(
        broker.call('agent.analyze', {
          problem: 'Tell me about energy storage in Europe',
        })
      ).rejects.toThrow(/parse/i);
    });

    it('should throw if Gemini API call fails', async () => {
      _mockGenerateContent.mockRejectedValueOnce(new Error('Network timeout'));

      await expect(
        broker.call('agent.analyze', {
          problem: 'Tell me about energy storage in Europe',
        })
      ).rejects.toThrow(/Gemini API error/i);
    });
  });

  // ── getSession action ─────────────────────────────────────────
  describe('getSession action', () => {
    it('should return 404 error for unknown session', async () => {
      await expect(
        broker.call('agent.getSession', { id: 'nonexistent-uuid-1234' })
      ).rejects.toThrow(/not found/i);
    });

    it('should retrieve a previously saved session', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });

      const analyzed = await broker.call('agent.analyze', {
        problem: 'Check gas storage supply security in Germany',
      });

      const session = await broker.call('agent.getSession', { id: analyzed.sessionId });
      expect(session.id).toBe(analyzed.sessionId);
      expect(session.status).toBe('awaiting_inputs');
      expect(session.problem).toContain('gas storage');
    });
  });

  // ── execute action ────────────────────────────────────────────
  describe('execute action', () => {
    it('should reject missing sessionId', async () => {
      await expect(broker.call('agent.execute', {})).rejects.toThrow();
    });

    it('should throw for unknown session', async () => {
      await expect(broker.call('agent.execute', { sessionId: 'no-such-session' })).rejects.toThrow(
        /not found/i
      );
    });

    it('should execute the plan and return table results', async () => {
      // Step 1: create session
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'What is the current gas storage level in Germany?',
      });

      // Step 2: execute – Gemini called for interpretation summary
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeInterpretationResponse() },
      });

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { date: '2026-02-01' },
      });

      expect(result.status).toBe('completed');
      expect(result.summary).toBe('Germany gas storage is at 65%.');
      expect(result.tableColumns).toEqual(['country', 'level', 'trend']);
      expect(result.tableRows).toHaveLength(1);
      expect(result.shareUrl).toContain(analyzed.sessionId);
      expect(result.stepResults).toHaveLength(1);
      expect(result.stepResults[0].step).toBe(1);
    });

    it('should update session status to completed after execution', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Check gas storage in Germany',
      });

      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeInterpretationResponse() },
      });
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const session = await broker.call('agent.getSession', { id: analyzed.sessionId });
      expect(session.status).toBe('completed');
      expect(session.results).not.toBeNull();
    });

    it('should re-plan when refinement text is provided', async () => {
      // Analyze
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'What is the gas storage level?',
      });

      // Execute with refinement – Gemini called for re-plan
      const refinedPlan = makePlanResponse({ summary: 'Refined strategy for France.' });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => refinedPlan },
      });

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
        refinement: 'Check France instead of Germany',
      });

      expect(result.status).toBe('refined');
      expect(result.summary).toBe('Refined strategy for France.');
    });

    it('should gracefully handle step execution errors', async () => {
      // Plan that references a non-existent service action
      const badPlan = makePlanResponse({
        steps: [
          {
            step: 1,
            service: 'nonexistent',
            action: 'nonexistent.action',
            description: 'This will fail',
            params: {},
          },
        ],
      });

      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => badPlan },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'This should fail gracefully for testing purposes',
      });

      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeInterpretationResponse() },
      });

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      // Should still return results, with error captured in stepResults
      expect(result.status).toBe('completed');
      expect(result.stepResults[0].error).not.toBeNull();
    });
  });

  // ── rerun action ──────────────────────────────────────────────
  describe('rerun action', () => {
    it('should throw for unknown session', async () => {
      await expect(broker.call('agent.rerun', { sessionId: 'no-such-session' })).rejects.toThrow(
        /not found/i
      );
    });

    it('should re-execute a completed session', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Gas storage levels for rerun test',
      });

      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeInterpretationResponse() },
      });
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { date: '2026-02-01' },
      });

      // Rerun
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeInterpretationResponse() },
      });
      const rerun = await broker.call('agent.rerun', { sessionId: analyzed.sessionId });

      expect(rerun.status).toBe('completed');
      expect(rerun.tableRows).toHaveLength(1);
    });
  });
});
