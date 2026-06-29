'use strict';

const scenario = require('../fixtures/rest-usecases/messkonzept-conflict.reference.json');
const {
  checkServerAvailableSync,
  createPersonalAgentRestClient,
  extractReply,
} = require('./helpers/personal-agent-rest-client');

const RUN_REST_USECASES = process.env.RUN_REST_USECASES !== 'false';
const BASE_URL = process.env.REST_USECASE_BASE_URL || 'http://127.0.0.1:3000';
const serverAvailable = RUN_REST_USECASES ? checkServerAvailableSync(BASE_URL) : false;
const describeRest = RUN_REST_USECASES && serverAvailable ? describe : describe.skip;

function collectValuesByKey(value, key, acc = []) {
  if (!value || typeof value !== 'object') {
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectValuesByKey(entry, key, acc));
    return acc;
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) {
      acc.push(entryValue);
    }
    collectValuesByKey(entryValue, key, acc);
  }
  return acc;
}

function collectFindingCodes(payload) {
  return collectValuesByKey(payload, 'code')
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function collectActionNames(payload) {
  return collectValuesByKey(payload, 'action')
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function expectPrimaryIntent(payload, expectedIntent) {
  const primaryIntent =
    payload?.routing?.primaryIntent ||
    payload?.agentTrace?.routing?.primaryIntent ||
    payload?.plan?.primaryIntent ||
    null;
  expect(primaryIntent).toBe(expectedIntent);
}

function expectStatus(payload, allowedStatuses) {
  const status = payload?.execution?.status || payload?.status || null;
  expect(allowedStatuses).toContain(status);
}

describeRest(`${scenario.scenarioId}: ${scenario.title}`, () => {
  jest.setTimeout(Number(process.env.REST_USECASE_TEST_TIMEOUT_MS || 120000));

  const client = createPersonalAgentRestClient({
    baseUrl: BASE_URL,
    tenantId: scenario.tenantId,
  });
  let sessionId = `${scenario.sessionId}-${Date.now()}`;

  afterAll(() => {
    client.clear();
  });

  test('turn 1 asks for missing postal-code evidence without leaving REST', async () => {
    const turn = scenario.turns[0];
    const { response, payload } = await client.chat({
      message: turn.message,
      sessionId,
      knownContext: turn.knownContext,
    });

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    sessionId = payload.sessionId || sessionId;

    expectPrimaryIntent(payload, turn.expected.primaryIntent);
    expectStatus(payload, turn.expected.status);

    const bodyText = JSON.stringify(payload).toLowerCase();
    for (const missingInput of turn.expected.missingInputs) {
      expect(bodyText).toContain(missingInput.toLowerCase());
    }
  });

  test('turn 2 produces structured MK40 findings and facts', async () => {
    const turn = scenario.turns[1];
    const { response, payload } = await client.chat({
      message: turn.message,
      sessionId,
      knownContext: turn.knownContext,
    });

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);

    expectPrimaryIntent(payload, turn.expected.primaryIntent);
    expectStatus(payload, turn.expected.status);
    expect(collectActionNames(payload)).toContain(turn.expected.action);

    const findingCodes = collectFindingCodes(payload);
    for (const expectedFinding of turn.expected.findings) {
      expect(findingCodes).toContain(expectedFinding);
    }

    const bodyText = JSON.stringify(payload);
    expect(bodyText).toContain(turn.expected.facts.sollMesskonzept);
    expect(bodyText).toContain(turn.expected.facts.legacyPvStatus);

    const reply = extractReply(payload);
    expect(reply).not.toMatch(/OBJECT_NOT_FOUND|INVALID_[A-Z_]+|ERR_[A-Z_]+|MOLECULER/i);
    for (const fragment of turn.expected.replyFragments) {
      expect(bodyText).toMatch(new RegExp(fragment, 'i'));
    }
  });
});

if (RUN_REST_USECASES && !serverAvailable) {
  console.warn(
    `[REST usecases] Skipping ${scenario.scenarioId}: no server reachable at ${BASE_URL}.`
  );
}
