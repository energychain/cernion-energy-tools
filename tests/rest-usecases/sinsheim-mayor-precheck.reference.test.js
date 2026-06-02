'use strict';

/**
 * REST Reference Test: Bürgermeister Sinsheim — kommunaler Energie-Precheck
 *
 * Reproduces the dev-server E2E finding from session pa-mayor-sinsheim-location-1780393783.
 *
 * Root issue: "74889 Sinsheim" in the user message was not extracted into structured
 * context, causing the BESS_SCREENING evidence gate to report "location_missing" even
 * though a valid Gemeinde/PLZ was present.
 *
 * Expected after fix:
 * - agentTrace.locationResolution.postalCode = "74889"
 * - agentTrace.locationResolution.municipality = "Sinsheim"
 * - agentTrace.locationResolution.municipalityResolved = true
 * - No evidence gate with blockedBy = "location_missing" in executionReadiness
 * - May still show site_coordinates_missing (non-blocking) for exact area
 */

const scenario = require('../fixtures/rest-usecases/sinsheim-mayor-precheck.reference.json');
const {
  checkServerAvailableSync,
  createPersonalAgentRestClient,
} = require('./helpers/personal-agent-rest-client');

const RUN_REST_USECASES = process.env.RUN_REST_USECASES !== 'false';
const BASE_URL = process.env.REST_USECASE_BASE_URL || 'http://127.0.0.1:3000';
const serverAvailable = RUN_REST_USECASES ? checkServerAvailableSync(BASE_URL) : false;
const describeRest = RUN_REST_USECASES && serverAvailable ? describe : describe.skip;

describeRest(`${scenario.scenarioId}: ${scenario.title}`, () => {
  jest.setTimeout(Number(process.env.REST_USECASE_TEST_TIMEOUT_MS || 120000));

  let client;
  let sessionId;

  beforeAll(() => {
    client = createPersonalAgentRestClient({
      baseUrl: BASE_URL,
      tenantId: 'tenant-sinsheim-precheck-rest',
    });
    sessionId = `pa-sinsheim-precheck-${Date.now()}`;
  });

  it('Turn 1: Location is resolved from message text — no location_missing gate', async () => {
    const turn = scenario.turns[0];

    const payload = await client.chat({
      message: turn.message,
      sessionId,
      chatMode: 'consultation',
      executionMode: 'auto',
      knownContext: {},
    });

    // Status must be one of the expected values
    const status = payload?.execution?.status || payload?.status || null;
    expect(turn.expected.status).toContain(status);

    // Location resolution must be present in agentTrace
    const locTrace = payload?.agentTrace?.locationResolution;
    expect(locTrace).toBeTruthy();
    expect(locTrace.municipalityResolved).toBe(true);
    expect(locTrace.postalCode).toBe('74889');
    expect(locTrace.municipality).toMatch(/Sinsheim/i);
    expect(locTrace.precision).toBe('municipality_resolved');

    // Evidence gates must NOT report location_missing for Gemeinde/PLZ
    const allGates = [
      ...(payload?.executionReadiness?.evidenceGates || []),
      ...(payload?.consultation?.executionReadiness?.evidenceGates || []),
    ];
    const locationMissingGate = allGates.find(
      (g) => g?.blockedBy === 'location_missing' && g?.required === true
    );
    expect(locationMissingGate).toBeUndefined();

    // May still have site_coordinates_missing (non-blocking) — that's OK
    const coordsMissingGate = allGates.find((g) => g?.blockedBy === 'site_coordinates_missing');
    if (coordsMissingGate) {
      expect(coordsMissingGate.required).toBe(false);
    }

    // Reply must not contain the old "location_missing" signal verbatim in German
    const reply = String(payload?.reply || '').toLowerCase();
    expect(reply).not.toMatch(/standortanalyse.*fehlt|ort.*nicht.*erkannt|keine.*standortangabe/i);
  });
});
