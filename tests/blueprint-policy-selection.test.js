'use strict';

/**
 * Acceptance tests for runtime blueprint policy selection and enforcement.
 * Covers all 7 criteria from the task spec.
 */

const {
  findBlueprintByPrimaryIntent,
  detectBlueprintIntent,
  MATCH_THRESHOLD,
  _derivePrimaryIntent,
} = require('../src/l3-broker');
const { extractPromptHints } = require('../src/personal-agent-routing');
const { listBlueprints, setRuntimeBlueprint, _resetCache } = require('../src/blueprint-registry');
const {
  extractBlueprintPolicy,
  checkStickinessRetain,
  filterSuppressedInputs,
} = require('../src/blueprint-policy-interpreter');
const {
  buildConsultationExecutionPlan,
  WORKFLOW_TYPES,
  _resolvePermittedWorkflowType,
  _filterSuppressedInputs,
} = require('../src/consultation-execution-bridge');

// ─── Runtime blueprint fixture ────────────────────────────────────────────────

const RUNTIME_BP_ID = 'municipal-energy-site-precheck-v1';
const RUNTIME_BP_VERSION = '1.0.3-runtime-sales-routing-synthesis-policy';

function makeRuntimeBlueprint(overrides = {}) {
  return {
    $schema: 'https://cernion.ai/schemas/blueprint.v1.json',
    id: RUNTIME_BP_ID,
    version: RUNTIME_BP_VERSION,
    meta: {
      title: 'Kommunaler Energie-Standort-Precheck',
      description: 'Runtime blueprint with policy.',
      targetAudience: 'municipal_official',
    },
    routing: {
      intentSignals: [
        'bürgermeister',
        'buergermeister',
        'gemeinde',
        'kommunal',
        'rechenzentrum',
        'data center',
        'ladepark',
        'ladeparks',
        'gewerbegebiet',
        'ansiedelung',
        'ansiedeln',
        'standortprüfung',
        'bess',
        'batteriespeicher',
        'photovoltaik',
        'ladeinfrastruktur',
        'vertriebler',
        'vertrieb',
        'stadtwerk vertrieb',
        'energievertrieb',
        'kundenberater',
        'vertriebsberater',
        'account manager',
        'key account',
        'gewerbekunden',
        'kommunalvertrieb',
        'vertriebsgespraech',
        'vertriebsgespräch',
      ],
      negativeSignals: ['redispatch', 'settlement', 'messkonzept', 'fnav', 'mieterstrom'],
      priorityBoost: 4,
    },
    inputs: {
      postalCode: {
        type: 'string',
        required: true,
        semanticType: 'OEO:PostalCode',
        resolveStrategy: { method: 'location_resolution', prompt: 'PLZ?' },
      },
    },
    execution: {
      steps: [
        {
          id: 'osm_spatial_context',
          action: 'osm-geo.infrastructureNearby',
          params: { location: '{{inputs.postalCode}}', radiusMeters: 5000 },
        },
      ],
    },
    postProcessing: { calculations: {}, mappings: {} },
    synthesis: { evidenceRequired: ['steps.osm_spatial_context.output'] },
    routingPolicy: {
      sessionIntent: 'municipal_energy_site_precheck',
      priority: 90,
      stickiness: {
        retainForTurns: 6,
        unlessNegativeSignals: ['nap wallet', 'prosumer onboarding', 'mieterstrom'],
      },
      avoidWorkflowTypes: ['prosumer_nap_wallet_onboarding'],
      llmSelectable: true,
    },
    synthesisPolicy: {
      audience: 'municipal_official',
      secondaryAudiences: ['stadtwerk_sales_advisor', 'municipal_account_manager'],
      responseFrame: 'meeting_preparation',
      leadWith: ['location_resolution', 'known_context', 'limitations'],
      deprioritize: ['tool_failure_as_main_answer'],
      doNotAskFor: ['nap_wallet_did', 'did', 'prosumer_wallet'],
      mustMention: ['municipality_level_only', 'vnb_not_authoritative'],
      askFor: ['concrete_site_or_coordinates', 'connection_power_mw'],
    },
    persistence: { l3_facts: {} },
    ...overrides,
  };
}

// ─── Setup/teardown ───────────────────────────────────────────────────────────

beforeAll(() => {
  _resetCache();
  setRuntimeBlueprint(RUNTIME_BP_ID, makeRuntimeBlueprint());
});

afterAll(() => {
  _resetCache();
});

// ─── AC-1: Runtime blueprint policy selection ─────────────────────────────────

describe('AC-1: Runtime blueprint policy selection', () => {
  it('BPS-001: findBlueprintByPrimaryIntent resolves runtime blueprint by intent string', () => {
    const bp = findBlueprintByPrimaryIntent('municipal_energy_site_precheck');
    expect(bp).not.toBeNull();
    expect(bp.id).toBe(RUNTIME_BP_ID);
    expect(bp.version).toBe(RUNTIME_BP_VERSION);
  });

  it('BPS-002: runtime blueprint routingPolicy and synthesisPolicy are non-null', () => {
    const bp = findBlueprintByPrimaryIntent('municipal_energy_site_precheck');
    const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);
    expect(routingPolicy).not.toBeNull();
    expect(routingPolicy.sessionIntent).toBe('municipal_energy_site_precheck');
    expect(synthesisPolicy).not.toBeNull();
    expect(synthesisPolicy.deprioritize).toContain('tool_failure_as_main_answer');
  });

  it('BPS-003: buildConsultationExecutionPlan appliedPolicy includes blueprintId and version', () => {
    const bp = findBlueprintByPrimaryIntent('municipal_energy_site_precheck');
    const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);
    const routingPolicyWithId = {
      ...routingPolicy,
      _blueprintId: bp.id,
      _blueprintVersion: bp.version,
    };

    const result = buildConsultationExecutionPlan({
      message: 'Welche Standortoptionen gibt es für ein Rechenzentrum?',
      knownContext: { municipality: 'Sinsheim', postalCode: '74889' },
      routingPolicy: routingPolicyWithId,
      synthesisPolicy,
    });

    expect(result.appliedPolicy).not.toBeNull();
    expect(result.appliedPolicy.blueprintId).toBe(RUNTIME_BP_ID);
    expect(result.appliedPolicy.blueprintVersion).toBe(RUNTIME_BP_VERSION);
    expect(result.appliedPolicy.sessionIntent).toBe('municipal_energy_site_precheck');
    expect(result.appliedPolicy.source).toBe('blueprint-policy');
  });

  it('BPS-004: findBlueprintByPrimaryIntent returns null for unknown intent', () => {
    expect(findBlueprintByPrimaryIntent('nonexistent_intent_xyz')).toBeNull();
    expect(findBlueprintByPrimaryIntent(null)).toBeNull();
    expect(findBlueprintByPrimaryIntent('')).toBeNull();
  });

  it('BPS-005: findBlueprintByPrimaryIntent works with hyphenated variant', () => {
    // "municipal-energy-site-precheck" should also resolve (hyphens → underscores)
    const bp = findBlueprintByPrimaryIntent('municipal-energy-site-precheck');
    expect(bp).not.toBeNull();
    expect(bp.id).toBe(RUNTIME_BP_ID);
  });

  it('BPS-006: enriched context (broker intent injected) reaches score threshold', () => {
    // Turn 1 message: single signal hit "bürgermeister" = score 1.4 below threshold
    // But if domainIntent = "bess_screening" adds "bess" → 2 hits → match
    const brokerEnrichedContext = {
      postalCode: '74889',
      municipality: 'Sinsheim',
      intent: null,
      domainIntent: 'bess_screening', // contains "bess" → extra signal hit
    };
    const match = detectBlueprintIntent(
      'bürgermeister von 74889 sinsheim',
      brokerEnrichedContext,
      {}
    );
    // "bürgermeister" + "bess" (from domainIntent) = 2 hits = score 2.4 ≥ threshold
    expect(match).not.toBeNull();
    expect(match.blueprintId).toBe(RUNTIME_BP_ID);
  });

  it('BPS-006b: Vertriebler prompt with inline PLZ resolves runtime blueprint policy', () => {
    const message =
      'Ich bin Vertriebler bei einem Stadtwerk und bereite einen Termin mit der Gemeinde 74889 Sinsheim vor. Der Bürgermeister fragt nach Rechenzentrum, PV, Batteriespeicher und Ladepark.';
    const promptHints = extractPromptHints(message);

    const match = detectBlueprintIntent(message, {}, promptHints);

    expect(promptHints.postalCode).toBe('74889');
    expect(match).not.toBeNull();
    expect(match.blueprintId).toBe(RUNTIME_BP_ID);
  });

  it('BPS-006c: Netzbetreiber Tübingen executive prompt resolves flexibility blueprint policy', () => {
    const message =
      'Ich bin Geschäftsführer beim Netzbetreiber der Stadtwerke Tübingen. Ich brauche das Flexibilitätspotenzial aus §14a und Redispatch 2.0, um Rückspeisespitzen zu begrenzen und Netzausbaukosten zu senken.';

    const match = detectBlueprintIntent(message, {}, {});
    const bp = findBlueprintByPrimaryIntent('netzbetreiber_flexibility_potential');
    const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);

    expect(match).not.toBeNull();
    expect(match.blueprintId).toBe('netzbetreiber-flexibility-potential-v1');
    expect(bp).not.toBeNull();
    expect(routingPolicy.sessionIntent).toBe('netzbetreiber_flexibility_potential');
    expect(synthesisPolicy.outputFormat).toBe('markdown_table_first');
  });
});

// ─── AC-2: Stickiness across follow-up turns ─────────────────────────────────

describe('AC-2: Stickiness retains session intent across turns', () => {
  const bp = makeRuntimeBlueprint();
  const { routingPolicy } = extractBlueprintPolicy(bp);

  it('BPS-007: turn 2 with neutral follow-up retains sticky policy', () => {
    const result = checkStickinessRetain(
      routingPolicy,
      'Können Sie das als Gesprächsvorbereitung aufbereiten?',
      1 // 1 turn elapsed
    );
    expect(result.retain).toBe(true);
    expect(result.reason).toBe('stickiness_active');
  });

  it('BPS-008: stickiness still active at turn 5 (within retainForTurns=6)', () => {
    const result = checkStickinessRetain(routingPolicy, 'OSM und Standortkontext?', 5);
    expect(result.retain).toBe(true);
  });

  it('BPS-009: stickiness expires at turn 6 (= retainForTurns)', () => {
    const result = checkStickinessRetain(routingPolicy, 'Nächste Frage?', 6);
    expect(result.retain).toBe(false);
    expect(result.reason).toBe('stickiness_expired');
  });
});

// ─── AC-3: Negative signals release stickiness ───────────────────────────────

describe('AC-3: Negative signals release stickiness', () => {
  const bp = makeRuntimeBlueprint();
  const { routingPolicy } = extractBlueprintPolicy(bp);

  it('BPS-010: "nap wallet" releases sticky policy', () => {
    const result = checkStickinessRetain(routingPolicy, 'Erkläre mir die NAP Wallet DID', 2);
    expect(result.retain).toBe(false);
    expect(result.reason).toMatch(/negative_signal/);
  });

  it('BPS-011: "prosumer onboarding" releases sticky policy', () => {
    const result = checkStickinessRetain(
      routingPolicy,
      'Ich möchte jetzt prosumer onboarding starten',
      1
    );
    expect(result.retain).toBe(false);
    expect(result.reason).toMatch(/negative_signal/);
  });

  it('BPS-012: "Gesprächsvorbereitung Stadtrat" does NOT trigger negative signal', () => {
    const result = checkStickinessRetain(
      routingPolicy,
      'Bitte Gesprächsvorbereitung für den Stadtrat erstellen',
      2
    );
    expect(result.retain).toBe(true);
  });
});

// ─── AC-4: avoidWorkflowTypes prevents prosumer drift ────────────────────────

describe('AC-4: avoidWorkflowTypes blocks workflow drift', () => {
  const bp = makeRuntimeBlueprint();
  const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);
  const routingPolicyWithId = {
    ...routingPolicy,
    _blueprintId: bp.id,
    _blueprintVersion: bp.version,
  };

  it('BPS-013: consultation output with "netzanschlusspunkt" prosumer signal is blocked', () => {
    // Simulates a consultation payload whose factsUsed/nextActions contain
    // "Netzanschlusspunkt" — a legitimate term that triggers prosumer classification
    const consultationWithProsumerSignals = {
      workflowType: null,
      factsUsed: [{ source: 'grid-ops', value: 'Netzanschlusspunkt verfügbar' }],
      nextActions: [
        { action: 'Prüfen', description: 'Netzanschlusspunkt und Wallet-Anbindung klären' },
      ],
    };

    const result = buildConsultationExecutionPlan({
      message: 'Gesprächsvorbereitung OSM Standortkontext',
      consultation: consultationWithProsumerSignals,
      knownContext: { municipality: 'Sinsheim', postalCode: '74889' },
      routingPolicy: routingPolicyWithId,
      synthesisPolicy,
    });

    expect(result.workflowType).not.toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
    expect(result.appliedPolicy).not.toBeNull();
  });

  it('BPS-014: _resolvePermittedWorkflowType falls back to advisory_only when semantic is also avoided', () => {
    const avoid = ['prosumer_nap_wallet_onboarding', 'bess_screening'];
    // No valid semantic type → advisory_only
    const resolved = _resolvePermittedWorkflowType(null, avoid);
    expect(resolved).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
  });

  it('BPS-015: _resolvePermittedWorkflowType uses semantic type when not avoided', () => {
    const avoid = ['prosumer_nap_wallet_onboarding'];
    const resolved = _resolvePermittedWorkflowType('bess_screening', avoid);
    expect(resolved).toBe('bess_screening');
  });
});

// ─── AC-5: doNotAskFor suppresses NAP-Wallet-DID question ───────────────────

describe('AC-5: doNotAskFor suppresses forbidden questions', () => {
  const bp = makeRuntimeBlueprint();
  const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);
  const routingPolicyWithId = { ...routingPolicy, _blueprintId: bp.id };

  it('BPS-016: nextUserQuestion does not ask for NAP-Wallet-DID when doNotAskFor is set', () => {
    // Force prosumer workflow to trigger NAP-DID question, but doNotAskFor blocks it
    const result = buildConsultationExecutionPlan({
      message: 'Netzanschlusspunkt Wallet prüfen',
      knownContext: { municipality: 'Sinsheim' },
      routingPolicy: routingPolicyWithId,
      synthesisPolicy, // has doNotAskFor: ['nap_wallet_did', 'did', 'prosumer_wallet']
    });

    const question = result.nextUserQuestion || '';
    expect(question.toLowerCase()).not.toContain('nap-wallet-did');
    expect(question.toLowerCase()).not.toContain('nap wallet');
  });

  it('BPS-017: _filterSuppressedInputs removes "did" param from missingInputs', () => {
    const missingInputs = [
      { param: 'did', label: 'NAP-Wallet-DID', priority: 'critical' },
      { param: 'location_or_melo', label: 'PLZ oder MeLo-ID', priority: 'critical' },
    ];
    const filtered = _filterSuppressedInputs(missingInputs, [
      'nap_wallet_did',
      'did',
      'prosumer_wallet',
    ]);
    expect(filtered.map((m) => m.param)).not.toContain('did');
    expect(filtered.map((m) => m.param)).toContain('location_or_melo');
  });

  it('BPS-018: filterSuppressedInputs (exported from interpreter) also works', () => {
    const inputs = [
      { param: 'did', label: 'NAP-Wallet-DID', priority: 'critical' },
      { param: 'postalCode', label: 'PLZ', priority: 'high' },
    ];
    const result = filterSuppressedInputs(inputs, ['did']);
    expect(result).toHaveLength(1);
    expect(result[0].param).toBe('postalCode');
  });
});

// ─── AC-6: Tool failure is not the lead response ─────────────────────────────

describe('AC-6: synthesisPolicy.deprioritize["tool_failure_as_main_answer"] is declared', () => {
  it('BPS-019: runtime blueprint synthesisPolicy.deprioritize includes tool_failure_as_main_answer', () => {
    const bp = findBlueprintByPrimaryIntent('municipal_energy_site_precheck');
    const { synthesisPolicy } = extractBlueprintPolicy(bp);
    expect(Array.isArray(synthesisPolicy.deprioritize)).toBe(true);
    expect(synthesisPolicy.deprioritize).toContain('tool_failure_as_main_answer');
  });
});

// ─── AC-7: Two-turn "Bürgermeister 74889 Sinsheim" regression ────────────────

describe('AC-7: Two-turn regression — Bürgermeister/Sinsheim', () => {
  it('BPS-020: findBlueprintByPrimaryIntent finds blueprint via broker intent "municipal_energy_site_precheck"', () => {
    // Simulates the broker returning the primary intent after matching the blueprint
    const brokerIntent = 'municipal_energy_site_precheck';
    const bp = findBlueprintByPrimaryIntent(brokerIntent);
    expect(bp).not.toBeNull();
    const { routingPolicy } = extractBlueprintPolicy(bp);
    expect(routingPolicy.avoidWorkflowTypes).toContain('prosumer_nap_wallet_onboarding');
  });

  it('BPS-021: turn-2 plan with active policy stays outside prosumer workflow', () => {
    const bp = findBlueprintByPrimaryIntent('municipal_energy_site_precheck');
    const { routingPolicy, synthesisPolicy } = extractBlueprintPolicy(bp);
    const rpWithId = { ...routingPolicy, _blueprintId: bp.id, _blueprintVersion: bp.version };

    // Simulate turn-2: consultation output has "Netzanschlusspunkt" (prosumer signal)
    const turn2Consultation = {
      factsUsed: [{ source: 'osm', value: 'Netzanschlusspunkt gefunden' }],
      nextActions: [{ action: 'Prüfen', description: 'Standort und Netzanschlusspunkt klären' }],
    };

    const result = buildConsultationExecutionPlan({
      message: 'Gesprächsvorbereitung und OSM Standortkontext',
      consultation: turn2Consultation,
      knownContext: { municipality: 'Sinsheim', postalCode: '74889', state: 'Baden-Württemberg' },
      routingPolicy: rpWithId,
      synthesisPolicy,
    });

    // Must NOT drift to prosumer workflow
    expect(result.workflowType).not.toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
    // Must NOT ask for NAP-Wallet-DID
    expect(result.nextUserQuestion || '').not.toMatch(/NAP-Wallet-DID/i);
    // Policy must be applied and traceable
    expect(result.appliedPolicy).not.toBeNull();
    expect(result.appliedPolicy.blueprintId).toBe(RUNTIME_BP_ID);
    // Workflow must be one of the allowed types
    const allowed = [
      WORKFLOW_TYPES.BESS_SCREENING,
      WORKFLOW_TYPES.BESS_DEVELOPMENT,
      WORKFLOW_TYPES.ADVISORY_ONLY,
      WORKFLOW_TYPES.VNB_IDENTIFICATION,
      WORKFLOW_TYPES.MUNICIPAL_ENERGY_SHARING_ASSESSMENT,
    ];
    expect(allowed).toContain(result.workflowType);
  });

  it('BPS-022: stickiness retains municipal context on turn-2 follow-up without negative signals', () => {
    const bp = findBlueprintByPrimaryIntent('municipal_energy_site_precheck');
    const { routingPolicy } = extractBlueprintPolicy(bp);

    const stickyResult = checkStickinessRetain(
      routingPolicy,
      'Können Sie das als Gesprächsvorbereitung für den Stadtrat aufbereiten?',
      1
    );
    expect(stickyResult.retain).toBe(true);
    expect(stickyResult.reason).toBe('stickiness_active');
  });
});
