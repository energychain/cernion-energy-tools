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

// Helper for the suggestions Gemini call that follows every interpretation
function makeSuggestionsResponse() {
  return JSON.stringify([
    'Gas storage comparison DE vs. FR',
    'Historical gas storage trend in Germany 2024',
    'Supply security check for Germany',
  ]);
}

function makeChartSuggestionsResponse() {
  return JSON.stringify([
    { type: 'bar', title: 'Storage Level by Country', xField: 'country', yField: 'level' },
    { type: 'line', title: 'Trend Over Time', xField: 'date', yField: 'value' },
  ]);
}

// Queue all three Gemini calls (interpretation + suggestions + chart suggestions) with one helper
function mockInterpretAndSuggest(interpretOverrides = {}) {
  _mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => makeInterpretationResponse(interpretOverrides) },
  });
  _mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => makeSuggestionsResponse() },
  });
  _mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => makeChartSuggestionsResponse() },
  });
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

    // Mock business-intelligence.salesLeads — records received params for coercion tests
    const salesLeadsMock = jest.fn().mockResolvedValue({
      success: true,
      leads: [{ name: 'Test Lead', score: 80 }],
    });
    broker.createService({
      name: 'business-intelligence',
      actions: { salesLeads: salesLeadsMock },
    });
    broker._salesLeadsMock = salesLeadsMock;

    // Mock residual-load service WITH real params schema so buildParamSchemaIndex has data
    const residualLoadMock = jest.fn().mockResolvedValue({
      summary: { region: 'Kiel' },
      forecast: [{ timestamp: '2026-03-01T00:00:00Z', loadMW: 42, residualLoadMW: 38 }],
    });
    broker.createService({
      name: 'residual-load',
      actions: {
        netResidualLoad: {
          params: {
            region:              { type: 'string', optional: true },
            gridOperatorMastrId: { type: 'string', optional: true },
            forecastDays:        { type: 'number', optional: true },
            resolution:          { type: 'enum', values: ['hourly', '15min'], optional: true },
          },
          handler: residualLoadMock,
        },
      },
    });
    broker._residualLoadMock = residualLoadMock;

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

      // Step 2: execute – Gemini called for interpretation + suggestions
      mockInterpretAndSuggest();

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
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(result.suggestions).toHaveLength(3);
      expect(Array.isArray(result.chartSuggestions)).toBe(true);
      expect(result.chartSuggestions[0]).toHaveProperty('type');
      expect(result.chartSuggestions[0]).toHaveProperty('xField');
      expect(result.chartSuggestions[0]).toHaveProperty('yField');
    });

    it('should update session status to completed after execution', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Check gas storage in Germany',
      });

      mockInterpretAndSuggest();
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const session = await broker.call('agent.getSession', { id: analyzed.sessionId });
      expect(session.status).toBe('completed');
      expect(session.results).not.toBeNull();
      expect(Array.isArray(session.results.suggestions)).toBe(true);
      expect(Array.isArray(session.results.chartSuggestions)).toBe(true);
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

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      // Should still return results, with error captured in stepResults
      expect(result.status).toBe('completed');
      expect(result.stepResults[0].error).not.toBeNull();
    });

    // ── Type-coercion regression tests (GitHub issue: string inputs cause
    //    Moleculer validation errors on number/boolean params) ──────────────

    it('should coerce string userInput to number when requiredInputs declares type:number', async () => {
      // Plan with daysBack declared as number-type requiredInput (set to null in step)
      const plan = JSON.stringify({
        summary: 'Sales leads with daysBack param.',
        steps: [{
          step: 1,
          action: 'business-intelligence.salesLeads',
          description: 'Find new leads',
          params: { region: '69', installationType: 'solar', daysBack: null, limit: 50 },
        }],
        requiredInputs: [{
          name: 'daysBack', label: 'Days Back', type: 'number', default: '365', required: true,
        }],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => plan } });
      const analyzed = await broker.call('agent.analyze', { problem: 'New PV installations last year in PLZ 69xxx area' });

      mockInterpretAndSuggest();
      broker._salesLeadsMock.mockClear();
      await broker.call('agent.execute', { sessionId: analyzed.sessionId, userInputs: { daysBack: '365' } });

      // The service must have received daysBack as a number, not a string
      expect(broker._salesLeadsMock).toHaveBeenCalled();
      const receivedParams = broker._salesLeadsMock.mock.calls[0][0].params;
      expect(typeof receivedParams.daysBack).toBe('number');
      expect(receivedParams.daysBack).toBe(365);
    });

    it('should coerce string userInput to number using plan param value type hint', async () => {
      // Plan with daysBack hardcoded as a number in params (not null, no requiredInputs)
      // — type hint is inferred from the plan value itself
      const plan = JSON.stringify({
        summary: 'Sales leads with hardcoded daysBack.',
        steps: [{
          step: 1,
          action: 'business-intelligence.salesLeads',
          description: 'Find new leads',
          params: { region: '69', installationType: 'solar', daysBack: 365, limit: 50 },
        }],
        requiredInputs: [{
          name: 'daysBack', label: 'Days Back', type: 'number', default: '365', required: true,
        }],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => plan } });
      const analyzed = await broker.call('agent.analyze', { problem: 'PV installations last 90 days in region 69' });

      mockInterpretAndSuggest();
      broker._salesLeadsMock.mockClear();
      // User changes daysBack to 90 — comes in as string from HTML form
      await broker.call('agent.execute', { sessionId: analyzed.sessionId, userInputs: { daysBack: '90' } });

      expect(broker._salesLeadsMock).toHaveBeenCalled();
      const receivedParams = broker._salesLeadsMock.mock.calls[0][0].params;
      expect(typeof receivedParams.daysBack).toBe('number');
      expect(receivedParams.daysBack).toBe(90);
    });

    it('should not coerce string params that have no number type hint', async () => {
      // region: '69' is a string param — must NOT be converted to number 69
      const plan = JSON.stringify({
        summary: 'Sales leads region check.',
        steps: [{
          step: 1,
          action: 'business-intelligence.salesLeads',
          description: 'Find leads by region',
          params: { region: null, installationType: 'solar', daysBack: 30, limit: 50 },
        }],
        requiredInputs: [{
          name: 'region', label: 'Region', type: 'string', default: '69', required: true,
        }],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => plan } });
      const analyzed = await broker.call('agent.analyze', { problem: 'Leads in postal region 69 area search' });

      mockInterpretAndSuggest();
      broker._salesLeadsMock.mockClear();
      await broker.call('agent.execute', { sessionId: analyzed.sessionId, userInputs: { region: '69' } });

      expect(broker._salesLeadsMock).toHaveBeenCalled();
      const receivedParams = broker._salesLeadsMock.mock.calls[0][0].params;
      // region must stay as string '69', not be coerced to number 69
      expect(typeof receivedParams.region).toBe('string');
      expect(receivedParams.region).toBe('69');
    });
  }); // end execute action

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

      mockInterpretAndSuggest();
      await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: { date: '2026-02-01' },
      });

      // Rerun
      mockInterpretAndSuggest();
      const rerun = await broker.call('agent.rerun', { sessionId: analyzed.sessionId });

      expect(rerun.status).toBe('completed');
      expect(rerun.tableRows).toHaveLength(1);
    });
  });

  // ── schema-based proactive plan repair ────────────────────────
  describe('schema-based proactive plan repair (analyze)', () => {
    it('should rename "gemeinde" to "region" for residual-load.netResidualLoad', async () => {
      const wrongPlan = JSON.stringify({
        summary: 'Test plan with wrong param gemeinde.',
        steps: [{
          step: 1,
          action: 'residual-load.netResidualLoad',
          description: 'Calculate residual load',
          params: { gemeinde: 'Kiel', forecastDays: 2 },
        }],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => wrongPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Residuallast für das Netzgebiet Stadtwerke Kiel berechnen',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      expect(session.plan.steps[0].params.region).toBe('Kiel');
      expect(session.plan.steps[0].params.gemeinde).toBeUndefined();
      expect(session.planRepairs).toHaveLength(1);
      expect(session.planRepairs[0]).toMatchObject({
        step: 1,
        action: 'residual-load.netResidualLoad',
        original: 'gemeinde',
        corrected: 'region',
      });
    });

    it('should not rename a param that is already correct', async () => {
      const correctPlan = JSON.stringify({
        summary: 'Correct plan.',
        steps: [{
          step: 1,
          action: 'residual-load.netResidualLoad',
          description: 'Calculate residual load',
          params: { region: 'Kiel', forecastDays: 2 },
        }],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => correctPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Residuallast für Kiel für die nächsten 2 Tage',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      expect(session.plan.steps[0].params.region).toBe('Kiel');
      expect(session.planRepairs).toBeUndefined();
    });

    it('should not rename chained ref values — key is renamed but chain preserved', async () => {
      const chainedPlan = JSON.stringify({
        summary: 'Chained plan.',
        steps: [{
          step: 1,
          action: 'residual-load.netResidualLoad',
          description: 'Chained residual load',
          params: { gemeinde: '__step_0.data.city', forecastDays: 2 },
        }],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => chainedPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Chained residual load test for auto-repair',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      // Chained refs are NOT renamed — key stays as-is, chain value preserved
      const params = session.plan.steps[0].params;
      expect(params.gemeinde).toBe('__step_0.data.city');
    });

    it('should not rename params for unknown actions (not in registry)', async () => {
      const unknownActionPlan = JSON.stringify({
        summary: 'Unknown action plan.',
        steps: [{
          step: 1,
          action: 'nonexistent.someAction',
          description: 'This action is not in the registry',
          params: { gemeinde: 'Hamburg', weirdParam: 'value' },
        }],
        requiredInputs: [],
      });
      _mockGenerateContent.mockResolvedValueOnce({ response: { text: () => unknownActionPlan } });

      const result = await broker.call('agent.analyze', {
        problem: 'Test plan with unknown action should not crash',
      });

      const sessionFile = path.join(SESSION_DIR, `${result.sessionId}.json`);
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      // Params left untouched since action schema is unknown
      expect(session.plan.steps[0].params.gemeinde).toBe('Hamburg');
      expect(session.planRepairs).toBeUndefined();
    });
  }); // end schema-based plan repair

  // ── dataQualityWarning → populationOverride injection ─────────────────────
  describe('dataQualityWarning populationOverride injection', () => {
    function makeResidualLoadPlan(overrides = {}) {
      const plan = {
        summary: 'Residuallast für Stadtwerke Kiel berechnen.',
        steps: [{
          step: 1,
          service: 'residual-load',
          action: 'residual-load.netResidualLoad',
          description: 'Forecast residual load for Kiel',
          params: { region: 'Kiel', forecastDays: 2 },
        }],
        requiredInputs: [
          { name: 'query', label: 'Netzbetreiber / Stadtwerk', type: 'string', default: 'Stadtwerke Kiel' },
        ],
        ...overrides,
      };
      return JSON.stringify(plan);
    }

    it('should inject populationOverride into requiredInputs when dataQualityWarning is true', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeResidualLoadPlan() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Nettorestlast für Stadtwerke Kiel berechnen',
      });

      // Residual-load action returns dataQualityWarning=true (loadMW all zero)
      broker._residualLoadMock.mockResolvedValueOnce({
        summary: { region: 'Kiel', loadScaling: { populationUsed: '245.000' } },
        forecast: [
          { timestamp: '2026-03-01T00:00:00Z', loadMW: 0, residualLoadMW: 12 },
          { timestamp: '2026-03-01T01:00:00Z', loadMW: 0, residualLoadMW: 8 },
        ],
        dataQualityWarning: true,
        dataQualityMessage: 'SMARD population scaling returned loadMW=0 for all forecast points.',
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      expect(result.requiredInputs).toBeDefined();
      const popField = result.requiredInputs.find((ri) => ri.name === 'populationOverride');
      expect(popField).toBeDefined();
      expect(popField.type).toBe('number');
      expect(popField.default).toBe(245000);
      expect(popField.required).toBe(true);

      // Also verify the field is persisted in the saved session
      const session = await broker.call('agent.getSession', { id: analyzed.sessionId });
      const sessionPopField = (session.plan.requiredInputs || []).find(
        (ri) => ri.name === 'populationOverride'
      );
      expect(sessionPopField).toBeDefined();
    });

    it('should NOT inject populationOverride when dataQualityWarning is false', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makeResidualLoadPlan() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Nettorestlast für Kiel — Daten sind vorhanden',
      });

      // Normal successful response — no warning
      broker._residualLoadMock.mockResolvedValueOnce({
        summary: { region: 'Kiel', loadScaling: { populationUsed: '245.000' } },
        forecast: [{ timestamp: '2026-03-01T00:00:00Z', loadMW: 42, residualLoadMW: 12 }],
        dataQualityWarning: false,
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const popField = (result.requiredInputs || []).find((ri) => ri.name === 'populationOverride');
      expect(popField).toBeUndefined();
    });

    it('should not duplicate populationOverride if already present in requiredInputs', async () => {
      const planWithPop = makeResidualLoadPlan({
        requiredInputs: [
          { name: 'query', label: 'Netzbetreiber / Stadtwerk', type: 'string', default: 'Stadtwerke Kiel' },
          { name: 'populationOverride', label: 'Einwohnerzahl', type: 'number', default: 247000, required: true },
        ],
      });
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => planWithPop },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Nettorestlast für Kiel mit vorhandener Einwohnerzahl',
      });

      broker._residualLoadMock.mockResolvedValueOnce({
        summary: { region: 'Kiel', loadScaling: { populationUsed: '245.000' } },
        forecast: [{ timestamp: '2026-03-01T00:00:00Z', loadMW: 0, residualLoadMW: 8 }],
        dataQualityWarning: true,
        dataQualityMessage: 'SMARD returned 0.',
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      const popFields = (result.requiredInputs || []).filter((ri) => ri.name === 'populationOverride');
      expect(popFields).toHaveLength(1);
    });

    it('should always include requiredInputs array in the execute return value', async () => {
      _mockGenerateContent.mockResolvedValueOnce({
        response: { text: () => makePlanResponse() },
      });
      const analyzed = await broker.call('agent.analyze', {
        problem: 'Gas storage in Germany — execute return value check',
      });

      mockInterpretAndSuggest();

      const result = await broker.call('agent.execute', {
        sessionId: analyzed.sessionId,
        userInputs: {},
      });

      expect(result).toHaveProperty('requiredInputs');
      expect(Array.isArray(result.requiredInputs)).toBe(true);
    });
  }); // end dataQualityWarning populationOverride injection
}); // end Agent Service

