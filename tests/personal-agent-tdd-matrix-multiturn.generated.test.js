'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const ObjectStoreService = require('../services/object-store.service');
const PersonalAgentService = require('../services/personal-agent.service');

const {
  DEFAULT_MATRIX_FILE,
  parseTddMatrixFile,
} = require('../src/personal-agent-tdd-matrix-parser');
const {
  MATRIX_NORMALIZATION_VERSION,
  normalizeMatrixTestCase,
} = require('../src/personal-agent-tdd-matrix-normalizer');

const ARTIFACT_PATH = path.join(__dirname, '..', 'tmp', 'tdd-matrix-pass-results.json');

function buildScenarioMap(cases) {
  const scenarios = new Map();

  for (const testCase of cases) {
    if (!testCase.id.startsWith('MT-')) {
      continue;
    }

    const scenarioKey = testCase.scenarioKey || testCase.id.replace(/-\d{2}$/, '');
    if (!scenarios.has(scenarioKey)) {
      scenarios.set(scenarioKey, testCase.turns || [testCase]);
    }
  }

  return Array.from(scenarios.entries()).map(([scenarioKey, turns]) => ({
    scenarioKey,
    turns: turns.slice().sort((left, right) => (left.turnNumber || 0) - (right.turnNumber || 0)),
  }));
}

function mergeCoverageArtifact(requiredIds, passedIds) {
  let existing = {};
  if (fs.existsSync(ARTIFACT_PATH)) {
    existing = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  }

  const mergedRequiredIds = Array.from(
    new Set([...(existing.requiredIds || []), ...requiredIds])
  ).sort();
  const mergedPassedIds = Array.from(
    new Set([...(existing.passedIds || []), ...passedIds])
  ).sort();

  const payload = {
    generatedAt: new Date().toISOString(),
    normalizationVersion: MATRIX_NORMALIZATION_VERSION,
    requiredIds: mergedRequiredIds,
    passedIds: mergedPassedIds,
    passedCount: mergedPassedIds.length,
    requiredCount: mergedRequiredIds.length,
  };

  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function createBroker(objectStorePath) {
  const broker = new ServiceBroker({ logger: false });
  broker.createService({
    ...ObjectStoreService,
    settings: {
      ...ObjectStoreService.settings,
      dbPath: objectStorePath,
    },
  });
  broker.createService(PersonalAgentService);
  return broker;
}

function expectReplyKeywords(reply, keywords) {
  const lowerReply = String(reply || '').toLowerCase();
  for (const keyword of keywords) {
    expect(lowerReply).toContain(String(keyword).toLowerCase());
  }
}

describe('v0.52.5 TDD matrix multi-turn executable coverage', () => {
  const cases = parseTddMatrixFile(DEFAULT_MATRIX_FILE).filter((testCase) => testCase.id.startsWith('MT-'));
  const scenarios = buildScenarioMap(cases);
  const requiredIds = cases.map((testCase) => testCase.id).sort();
  const passedIds = [];

  afterAll(() => {
    mergeCoverageArtifact(requiredIds, passedIds);
  });

  it('parses exactly 12 executable multi-turn matrix turns in 3 scenarios', () => {
    expect(cases).toHaveLength(12);
    expect(scenarios).toHaveLength(3);
    expect(scenarios.map((scenario) => scenario.scenarioKey).sort()).toEqual(['MT-INV', 'MT-JOU', 'MT-VOR']);
  });

  test.each(scenarios)('$scenarioKey runs through personal-agent.chat with one persistent session', async ({ turns }) => {
    const objectStorePath = path.join(
      os.tmpdir(),
      `personal-agent-tdd-mt-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    const broker = createBroker(objectStorePath);
    let sessionId = null;
    let previousHistoryCount = 0;

    try {
      await broker.start();

      for (const turn of turns) {
        const normalized = normalizeMatrixTestCase(turn);
        const result = await broker.call(
          'personal-agent.chat',
          {
            message: turn.prompt,
            sessionId,
            executionMode: normalized.executionMode || 'hitl',
            knownContext: normalized.knownContext || {},
          },
          { meta: { tenantId: 'tenant-mt', authUser: { userId: 'matrix-user' } } }
        );

        expect(result.success).toBe(true);
        expect(result.execution.status).toBe('skipped');
        expect(typeof result.reply).toBe('string');
        expect(result.reply.length).toBeGreaterThan(20);
        expectReplyKeywords(result.reply, normalized.expectedReplyKeywords || []);

        for (const forbiddenKeyword of normalized.forbiddenReplyKeywords || []) {
          expect(result.reply.toLowerCase()).not.toContain(String(forbiddenKeyword).toLowerCase());
        }

        if (sessionId) {
          expect(result.sessionId).toBe(sessionId);
        }
        sessionId = result.sessionId;

        expect(result.historyCount).toBeGreaterThan(previousHistoryCount);
        previousHistoryCount = result.historyCount;

        const persistedSession = await broker.call(
          'personal-agent.getSession',
          { sessionId },
          { meta: { tenantId: 'tenant-mt', authUser: { userId: 'matrix-user' } } }
        );

        expect(persistedSession.success).toBe(true);
        expect(persistedSession.l3.history.length).toBe(result.historyCount);
        expect(persistedSession.l3.history.some((entry) => entry.role === 'assistant')).toBe(true);

        passedIds.push(turn.id);
      }
    } finally {
      await broker.stop();
      fs.rmSync(objectStorePath, { recursive: true, force: true });
    }
  });
});
