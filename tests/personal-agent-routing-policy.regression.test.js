'use strict';

/**
 * Regression tests: blueprint routing/synthesis policy metadata does not
 * break blueprint-management validate/test/promote, and the municipal precheck
 * session intent is retained across follow-up turns (no drift to prosumer workflows).
 */

const { ServiceBroker } = require('moleculer');
const BlueprintManagementService = require('../services/blueprint-management.service');
const { loadBlueprint, _resetCache } = require('../src/blueprint-registry');
const {
  checkStickinessRetain,
  buildSynthesisPolicyDirectives,
  extractBlueprintPolicy,
} = require('../src/blueprint-policy-interpreter');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeBlueprintWithPolicy(overrides = {}) {
  return {
    $schema: 'https://cernion.ai/schemas/blueprint.v1.json',
    id: 'test-municipal-policy-v1',
    version: '1.0.0',
    meta: {
      title: 'Test Municipal Policy Blueprint',
      description: 'Unit-test blueprint that includes routingPolicy and synthesisPolicy.',
      targetAudience: 'end_user',
    },
    routing: {
      intentSignals: ['gemeinde', 'bürgermeister', 'standortprüfung'],
      negativeSignals: ['mieterstrom'],
      priorityBoost: 4,
    },
    inputs: {
      postalCode: {
        type: 'string',
        required: true,
        semanticType: 'OEO:PostalCode',
        resolveStrategy: { method: 'llm_extraction', prompt: 'PLZ?' },
      },
    },
    execution: {
      steps: [
        {
          id: 'osm_context',
          action: 'osm-geo.infrastructureNearby',
          params: { location: '{{inputs.postalCode}}', radiusMeters: 5000 },
        },
      ],
    },
    postProcessing: { calculations: {}, mappings: {} },
    synthesis: {
      evidenceRequired: ['steps.osm_context.output'],
      templates: { success: 'Standort analysiert.', error: 'Fehler.' },
    },
    routingPolicy: {
      sessionIntent: 'municipal_energy_site_precheck',
      priority: 90,
      stickiness: {
        retainForTurns: 6,
        unlessNegativeSignals: ['nap wallet', 'prosumer onboarding', 'mieterstrom'],
      },
      llmSelectable: true,
    },
    synthesisPolicy: {
      audience: 'municipal_official',
      responseFrame: 'meeting_preparation',
      leadWith: ['location_resolution', 'known_context', 'limitations'],
      deprioritize: ['tool_failure_as_main_answer'],
      mustMention: ['municipality_level_only', 'vnb_not_authoritative'],
      askFor: ['concrete_site_or_coordinates', 'connection_power_mw'],
    },
    persistence: { l3_facts: {} },
    ...overrides,
  };
}

// ─── RP-001: blueprint-management validate passes with policy metadata ─────────

describe('blueprint-management: routingPolicy/synthesisPolicy metadata is accepted', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(BlueprintManagementService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('RP-001: createDraft + validate accepts blueprint with routingPolicy/synthesisPolicy', async () => {
    const bp = makeBlueprintWithPolicy();

    const createResult = await broker.call('blueprint-management.createDraft', {
      blueprint: bp,
      createdBy: 'test-regression',
    });

    expect(createResult.success).toBe(true);
    expect(createResult.validationStatus).toBe('valid');
    expect(createResult.validationErrors).toHaveLength(0);

    const validateResult = await broker.call('blueprint-management.validate', {
      id: createResult.draftId,
    });

    expect(validateResult.validationStatus).toBe('valid');
    expect(validateResult.validationErrors).toHaveLength(0);
  });

  it('RP-002: test action passes for blueprint with policy metadata', async () => {
    const bp = makeBlueprintWithPolicy();

    const createResult = await broker.call('blueprint-management.createDraft', {
      blueprint: bp,
      createdBy: 'test-regression',
    });

    expect(createResult.validationStatus).toBe('valid');

    const testResult = await broker.call('blueprint-management.test', {
      id: createResult.draftId,
    });

    expect(testResult.testStatus).toBe('passed');
  });

  it('RP-003: promote succeeds for blueprint with policy metadata', async () => {
    const bp = makeBlueprintWithPolicy({ id: 'test-municipal-policy-promote-v1' });

    const createResult = await broker.call('blueprint-management.createDraft', {
      blueprint: bp,
      createdBy: 'test-regression',
    });

    expect(createResult.validationStatus).toBe('valid');

    const promoteResult = await broker.call('blueprint-management.promote', {
      id: createResult.draftId,
      promotedBy: 'test-regression',
    });

    expect(promoteResult.success).toBe(true);
    expect(promoteResult.blueprintId).toBe('test-municipal-policy-promote-v1');
  });
});

// ─── RP-004: injection guard rejects unsafe policy values ─────────────────────

describe('blueprint-management: injection guard covers routingPolicy/synthesisPolicy', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(BlueprintManagementService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('RP-004: blueprint with injection attempt in routingPolicy is rejected', async () => {
    const bp = makeBlueprintWithPolicy({
      id: 'test-injection-routing-v1',
      routingPolicy: {
        sessionIntent: 'safe_intent',
        malicious: 'eval(process.env.SECRET)',
      },
    });

    const result = await broker.call('blueprint-management.createDraft', {
      blueprint: bp,
      createdBy: 'test',
    });

    expect(result.validationStatus).toBe('invalid');
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });

  it('RP-005: blueprint with injection attempt in synthesisPolicy is rejected', async () => {
    const bp = makeBlueprintWithPolicy({
      id: 'test-injection-synthesis-v1',
      synthesisPolicy: {
        audience: 'municipal_official',
        malicious: '../../../etc/passwd',
      },
    });

    const result = await broker.call('blueprint-management.createDraft', {
      blueprint: bp,
      createdBy: 'test',
    });

    expect(result.validationStatus).toBe('invalid');
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });
});

// ─── RP-006: second-turn follow-up must not ask for NAP-Wallet-DID ────────────

describe('Regression: second-turn municipal follow-up stays in context', () => {
  it('RP-006: stickiness is active on turn 2 with Gesprächsvorbereitung follow-up', () => {
    const policy = {
      sessionIntent: 'municipal_energy_site_precheck',
      stickiness: {
        retainForTurns: 6,
        unlessNegativeSignals: ['nap wallet', 'prosumer onboarding', 'mieterstrom'],
      },
    };

    // Turn 2: user asks for meeting preparation — must retain municipal context
    const result = checkStickinessRetain(
      policy,
      'Können Sie das als Gesprächsvorbereitung für den Stadtrat aufbereiten?',
      1
    );

    expect(result.retain).toBe(true);
    expect(result.reason).toBe('stickiness_active');
  });

  it('RP-007: stickiness breaks when user switches to prosumer NAP-wallet topic', () => {
    const policy = {
      sessionIntent: 'municipal_energy_site_precheck',
      stickiness: {
        retainForTurns: 6,
        unlessNegativeSignals: ['nap wallet', 'prosumer onboarding', 'mieterstrom'],
      },
    };

    const result = checkStickinessRetain(
      policy,
      'Jetzt möchte ich lieber über prosumer onboarding sprechen',
      2
    );

    expect(result.retain).toBe(false);
    expect(result.reason).toMatch(/negative_signal/);
  });

  it('RP-008: synthesis directives for municipal precheck do not reference NAP-Wallet-DID fields', () => {
    const bp = loadBlueprint('municipal-energy-site-precheck-v1');
    expect(bp).not.toBeNull();

    const { synthesisPolicy, routingPolicy } = extractBlueprintPolicy(bp);
    expect(synthesisPolicy).not.toBeNull();
    expect(routingPolicy).not.toBeNull();

    const directives = buildSynthesisPolicyDirectives(synthesisPolicy, routingPolicy);
    const joined = directives.join('\n').toLowerCase();

    // Must not ask for DID or NAP-Wallet
    expect(joined).not.toMatch(/\bdid\b|nap.?wallet/);
    // Must not mention prosumer_nap_wallet_onboarding workflow
    expect(joined).not.toContain('prosumer_nap_wallet_onboarding');
    // Must generate stickiness note
    expect(joined).toContain('municipal_energy_site_precheck');
  });
});

// ─── RP-009: file blueprint is still valid after policy fields added ───────────

describe('Regression: municipal-energy-site-precheck-v1.json validity', () => {
  beforeAll(() => {
    _resetCache();
  });

  it('RP-009: blueprint loads and has both routingPolicy and synthesisPolicy', () => {
    const bp = loadBlueprint('municipal-energy-site-precheck-v1');
    expect(bp).not.toBeNull();
    expect(bp.routingPolicy).not.toBeNull();
    expect(bp.routingPolicy.sessionIntent).toBe('municipal_energy_site_precheck');
    expect(bp.routingPolicy.stickiness.retainForTurns).toBe(6);
    expect(bp.synthesisPolicy).not.toBeNull();
    expect(bp.synthesisPolicy.deprioritize).toContain('tool_failure_as_main_answer');
  });
});
