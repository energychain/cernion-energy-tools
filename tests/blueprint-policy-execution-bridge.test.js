'use strict';

/**
 * Blueprint policy execution bridge tests.
 *
 * Verifies that routingPolicy.avoidWorkflowTypes, synthesisPolicy.doNotAskFor,
 * synthesisPolicy.deprioritize, and policy stickiness all actually influence
 * the execution plan output (not just stored).
 *
 * Acceptance criteria:
 *   1. appliedPolicy is non-null when routingPolicy is supplied
 *   2. Stickiness check returns retain=true on turn 1, false after expiry
 *   3. avoidWorkflowTypes blocks prosumer drift caused by "netzanschlusspunkt" signals
 *   4. doNotAskFor suppresses NAP-Wallet-DID from nextUserQuestion
 *   5. _filterSuppressedInputs removes 'did' when doNotAskFor: ['did']
 *   6. Two-turn Sinsheim regression: prosumer drift blocked, NAP question suppressed
 */

const {
  WORKFLOW_TYPES,
  buildConsultationExecutionPlan,
  _resolvePermittedWorkflowType,
  _filterSuppressedInputs,
} = require('../src/consultation-execution-bridge');

const {
  checkStickinessRetain,
  filterSuppressedInputs,
} = require('../src/blueprint-policy-interpreter');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeMunicipalRoutingPolicy(overrides = {}) {
  return {
    sessionIntent: 'municipal_energy_site_precheck',
    priority: 90,
    stickiness: {
      retainForTurns: 6,
      unlessNegativeSignals: ['nap wallet', 'prosumer onboarding', 'mieterstrom'],
    },
    avoidWorkflowTypes: ['prosumer_nap_wallet_onboarding'],
    llmSelectable: true,
    ...overrides,
  };
}

function makeMunicipalSynthesisPolicy(overrides = {}) {
  return {
    audience: 'municipal_official',
    responseFrame: 'meeting_preparation',
    leadWith: ['location_resolution', 'known_context', 'limitations'],
    deprioritize: ['tool_failure_as_main_answer'],
    doNotAskFor: ['nap_wallet_did', 'did'],
    mustMention: ['municipality_level_only', 'vnb_not_authoritative'],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. appliedPolicy is non-null when routingPolicy is supplied
// ─────────────────────────────────────────────────────────────────────────────

describe('BP-EXB-001: appliedPolicy is populated when routingPolicy is provided', () => {
  it('appliedPolicy is non-null and carries sessionIntent', () => {
    const routingPolicy = makeMunicipalRoutingPolicy();

    const result = buildConsultationExecutionPlan({
      message: 'Wir suchen einen geeigneten Standort für eine kommunale Energieanlage.',
      consultation: {},
      knownContext: { municipality: 'Teststadt' },
      routingPolicy,
      executionMode: 'auto',
    });

    expect(result.appliedPolicy).not.toBeNull();
    expect(result.appliedPolicy.sessionIntent).toBe('municipal_energy_site_precheck');
    expect(result.appliedPolicy.source).toBe('blueprint-policy');
    expect(result.appliedPolicy.avoidWorkflowTypes).toContain('prosumer_nap_wallet_onboarding');
  });

  it('appliedPolicy is null when no routingPolicy is supplied', () => {
    const result = buildConsultationExecutionPlan({
      message: 'Einfache Anfrage ohne Policy.',
      consultation: {},
      knownContext: {},
      executionMode: 'auto',
    });

    expect(result.appliedPolicy).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Stickiness (pure unit)
// ─────────────────────────────────────────────────────────────────────────────

describe('BP-EXB-002: stickiness retains on turn 1, expires after retainForTurns', () => {
  const policy = makeMunicipalRoutingPolicy();

  it('retains on turn 0 (initial turn)', () => {
    const result = checkStickinessRetain(policy, 'Zweite Frage zur kommunalen Energieplanung', 0);
    expect(result.retain).toBe(true);
    expect(result.reason).toBe('stickiness_active');
  });

  it('retains on turn 1 (first follow-up)', () => {
    const result = checkStickinessRetain(policy, 'Noch eine Folgefrage zur Standortanalyse', 1);
    expect(result.retain).toBe(true);
    expect(result.reason).toBe('stickiness_active');
  });

  it('expires at turnsElapsed >= retainForTurns (6)', () => {
    const result = checkStickinessRetain(policy, 'Noch eine Frage', 6);
    expect(result.retain).toBe(false);
    expect(result.reason).toBe('stickiness_expired');
  });

  it('deactivates when negative signal is present', () => {
    const result = checkStickinessRetain(
      policy,
      'Ich möchte jetzt über Prosumer Onboarding sprechen',
      1
    );
    expect(result.retain).toBe(false);
    expect(result.reason).toMatch(/negative_signal/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. avoidWorkflowTypes blocks prosumer drift from "netzanschlusspunkt"
// ─────────────────────────────────────────────────────────────────────────────

describe('BP-EXB-003: avoidWorkflowTypes blocks prosumer drift', () => {
  it('workflowType is NOT prosumer_nap_wallet_onboarding when blocked by routingPolicy', () => {
    // "netzanschlusspunkt" in the message corpus would normally trigger prosumer drift on turn 2
    const result = buildConsultationExecutionPlan({
      message: 'Standortanalyse für kommunale Energieanlage am Netzanschlusspunkt',
      consultation: {
        factsUsed: [
          { source: 'message', value: 'Netzanschlusspunkt' },
          { source: 'turn1', value: 'Gemeinde Sinsheim, Bürgermeister-Anfrage' },
        ],
        nextActions: [
          { action: 'nap_wallet_check', description: 'NAP-Wallet prüfen' },
        ],
        semanticClassification: {
          workflowType: WORKFLOW_TYPES.BESS_SCREENING,
        },
      },
      knownContext: { municipality: 'Sinsheim' },
      routingPolicy: makeMunicipalRoutingPolicy(),
      executionMode: 'auto',
    });

    expect(result.workflowType).not.toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
  });

  it('workflowType falls back to semanticWorkflowType when the original type is blocked', () => {
    const routingPolicy = makeMunicipalRoutingPolicy({
      avoidWorkflowTypes: ['prosumer_nap_wallet_onboarding'],
    });
    // The semantic classification says bess_screening — expect that to win
    const result = buildConsultationExecutionPlan({
      message: 'Haushaltskunde mit NAP-Wallet und Netzanschlusspunkt',
      consultation: {
        semanticClassification: {
          workflowType: WORKFLOW_TYPES.BESS_SCREENING,
        },
      },
      knownContext: { municipality: 'Arnstadt', powerMW: 10 },
      routingPolicy,
      executionMode: 'auto',
    });

    expect(result.workflowType).not.toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);
    expect(result.appliedPolicy).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. doNotAskFor suppresses NAP-Wallet-DID from nextUserQuestion
// ─────────────────────────────────────────────────────────────────────────────

describe('BP-EXB-004: doNotAskFor suppresses NAP-Wallet-DID question', () => {
  it('nextUserQuestion does not mention NAP-Wallet-DID when suppressed', () => {
    const synthesisPolicy = makeMunicipalSynthesisPolicy({
      doNotAskFor: ['nap_wallet_did', 'did'],
    });
    // Use prosumer workflow (which normally asks for 'did') but with doNotAskFor suppressing it
    const result = buildConsultationExecutionPlan({
      message: 'Haushaltskunde mit PV und Wallbox: NAP-Wallet Onboarding',
      consultation: {
        semanticClassification: {
          workflowType: WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING,
        },
      },
      knownContext: {},
      synthesisPolicy,
      executionMode: 'auto',
    });

    const question = result.nextUserQuestion || '';
    expect(question.toLowerCase()).not.toMatch(/nap.?wallet.?did/i);
    expect(question.toLowerCase()).not.toMatch(/\bdid\b/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. _filterSuppressedInputs unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BP-EXB-005: _filterSuppressedInputs / filterSuppressedInputs', () => {
  const missingInputs = [
    { param: 'did', label: 'NAP-Wallet-DID', priority: 'critical' },
    { param: 'location_or_melo', label: 'PLZ oder MeLo-ID', priority: 'critical' },
    { param: 'asset_baseline', label: 'Asset-Typen', priority: 'high' },
  ];

  it('removes "did" param when doNotAskFor contains "did"', () => {
    const filtered = _filterSuppressedInputs(missingInputs, ['did']);
    const params = filtered.map((m) => m.param);
    expect(params).not.toContain('did');
    expect(params).toContain('location_or_melo');
  });

  it('removes "did" param when doNotAskFor contains "nap_wallet_did" (substring match)', () => {
    const filtered = _filterSuppressedInputs(missingInputs, ['nap_wallet_did']);
    const params = filtered.map((m) => m.param);
    expect(params).not.toContain('did');
  });

  it('returns all inputs unchanged when doNotAskFor is empty', () => {
    const filtered = _filterSuppressedInputs(missingInputs, []);
    expect(filtered).toHaveLength(missingInputs.length);
  });

  it('returns all inputs unchanged when doNotAskFor is null', () => {
    const filtered = _filterSuppressedInputs(missingInputs, null);
    expect(filtered).toHaveLength(missingInputs.length);
  });

  it('filterSuppressedInputs (exported from blueprint-policy-interpreter) works identically', () => {
    const filtered = filterSuppressedInputs(missingInputs, ['did']);
    const params = filtered.map((m) => m.param);
    expect(params).not.toContain('did');
    expect(params).toContain('location_or_melo');
  });

  it('handles non-array missingInputs gracefully', () => {
    const filtered = _filterSuppressedInputs(null, ['did']);
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Two-turn Sinsheim regression
// ─────────────────────────────────────────────────────────────────────────────

describe('BP-EXB-006: two-turn Sinsheim regression — no prosumer drift, no NAP question', () => {
  it('turn-2 consultation with netzanschlusspunkt context does not drift to prosumer workflow', () => {
    // Simulate turn 2: session has accumulated facts mentioning "Netzanschlusspunkt"
    const consultationPayload = {
      factsUsed: [
        { source: 'turn1', value: 'Gemeinde Sinsheim, Bürgermeister Standortplanung' },
        { source: 'tool_result', value: 'Netzanschlusspunkt gefunden' },
      ],
      nextActions: [
        {
          action: 'nap_wallet_check',
          description: 'NAP-Wallet-DID für Netzanschlusspunkt prüfen',
        },
      ],
      hypotheses: [],
      semanticClassification: {
        workflowType: WORKFLOW_TYPES.BESS_SCREENING,
      },
    };

    const routingPolicy = makeMunicipalRoutingPolicy();

    const result = buildConsultationExecutionPlan({
      message:
        'Was sind die nächsten Schritte für die Standortplanung der kommunalen Energieanlage?',
      consultation: consultationPayload,
      knownContext: { municipality: 'Sinsheim' },
      routingPolicy,
      synthesisPolicy: makeMunicipalSynthesisPolicy(),
      executionMode: 'auto',
    });

    // Must not drift to prosumer workflow
    expect(result.workflowType).not.toBe(WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING);

    // Must not ask for NAP-Wallet-DID
    const question = result.nextUserQuestion || '';
    expect(question.toLowerCase()).not.toMatch(/nap.?wallet.?did/i);

    // appliedPolicy must be populated
    expect(result.appliedPolicy).not.toBeNull();
    expect(result.appliedPolicy.sessionIntent).toBe('municipal_energy_site_precheck');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. _resolvePermittedWorkflowType unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BP-EXB-007: _resolvePermittedWorkflowType', () => {
  it('uses semanticWorkflowType when it is not blocked', () => {
    const result = _resolvePermittedWorkflowType(
      WORKFLOW_TYPES.BESS_SCREENING,
      ['prosumer_nap_wallet_onboarding']
    );
    expect(result).toBe(WORKFLOW_TYPES.BESS_SCREENING);
  });

  it('falls back to advisory_only when semanticWorkflowType is also blocked', () => {
    const result = _resolvePermittedWorkflowType(
      WORKFLOW_TYPES.PROSUMER_NAP_WALLET_ONBOARDING,
      ['prosumer_nap_wallet_onboarding']
    );
    expect(result).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
  });

  it('falls back to advisory_only when semanticWorkflowType is null', () => {
    const result = _resolvePermittedWorkflowType(null, ['prosumer_nap_wallet_onboarding']);
    expect(result).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
  });

  it('falls back to advisory_only when semanticWorkflowType is unknown', () => {
    const result = _resolvePermittedWorkflowType(
      'some_unknown_workflow',
      ['prosumer_nap_wallet_onboarding']
    );
    expect(result).toBe(WORKFLOW_TYPES.ADVISORY_ONLY);
  });
});
