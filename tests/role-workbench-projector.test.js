'use strict';

/**
 * Tests for Role Workbench Projector (#301).
 *
 * Suite 1: Unit tests for the pure projector (no broker, no IO).
 * Suite 2: Integration tests via the governance service broker action,
 *          with a mock vdmi service supplying test matrices.
 */

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

const { projectRoleWorkbench } = require('../src/role-workbench-projector');
const { evaluateGovernancePolicy } = require('../src/governance-policy-evaluator');
const { deriveHitlResolverRoles } = require('../src/vdmi-hitl-role-derivation');

// Set the governance DB path before requiring the governance service.
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-gov-workbench-${Date.now()}`);
process.env.GOVERNANCE_DECISION_AUDIT_DB_PATH = TEST_DB_PATH;
const GovernanceService = require('../services/governance.service');

// ── Shared fixtures ───────────────────────────────────────────────────────────────

function makeEvaluatePolicy(row) {
  return evaluateGovernancePolicy({ controlCase: row, context: {} });
}

function makeDeriveRoles(input) {
  return deriveHitlResolverRoles(input);
}

const MATRIX_REDISPATCH = {
  id: 'matrix-redispatch-001',
  name: 'Steuerbarkeit Anlage A',
  status: 'active',
  tasks: [
    {
      taskId: 'task-steuerbarkeit',
      taskName: 'Steuerbarkeitscheck (§14a EnWG)',
      controlCase: 'redispatch',
      verantwortlich: [{ actorType: 'role', actorId: 'ROLE_NETZPLANUNG' }],
      durchfuehrend: [{ actorType: 'role', actorId: 'ROLE_GRID_OPERATOR' }],
      mitwirkend: [{ actorType: 'role', actorId: 'ROLE_REDISPATCH_COORDINATOR' }],
      information: [{ actorType: 'role', actorId: 'ROLE_REGULATORY' }],
      evidenceRequirements: [
        { id: 'remote_control_proof', label: 'Fernsteuerungsnachweis', required: true },
        { id: 'technical_availability', label: 'Verfügbarkeitsprüfung', required: true },
      ],
      decisionPolicy: { onMissingEvidence: 'clarification', onHighFinancialImpact: 'none' },
    },
  ],
};

const MATRIX_ASSET = {
  id: 'matrix-asset-002',
  name: 'Asset-Transformation Trafo B',
  status: 'active',
  tasks: [
    {
      taskId: 'task-asset-transform',
      taskName: 'Asset-Transformation-Prüfung',
      controlCase: 'asset_transformation',
      verantwortlich: [{ actorType: 'role', actorId: 'ROLE_CONTROLLING' }],
      durchfuehrend: [{ actorType: 'role', actorId: 'ROLE_ASSET_MANAGER' }],
      mitwirkend: [{ actorType: 'role', actorId: 'ROLE_NETZPLANUNG' }],
      information: [{ actorType: 'role', actorId: 'ROLE_MANAGEMENT' }],
      evidenceRequirements: [
        { id: 'commercial_asset_register', label: 'Kaufmänn. Anlageverzeichnis', required: true },
      ],
      decisionPolicy: {
        onMissingEvidence: 'evidence_gap',
        onHighFinancialImpact: 'mandatory_human_decision',
      },
    },
  ],
};

const MATRIX_COMPLETED = {
  id: 'matrix-completed-003',
  name: 'Abgeschlossene Matrix',
  status: 'completed',
  tasks: [
    {
      taskId: 'task-done',
      taskName: 'Abgeschlossene Aufgabe',
      controlCase: 'redispatch',
      verantwortlich: [{ actorType: 'role', actorId: 'ROLE_NETZPLANUNG' }],
      durchfuehrend: [],
      mitwirkend: [],
      information: [],
    },
  ],
};

// ── Suite 1: Pure unit tests ──────────────────────────────────────────────────────

describe('role-workbench-projector — pure unit tests', () => {
  test('returns a workbench item for a role in the verantwortlich field', () => {
    const { items, summary } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [MATRIX_REDISPATCH],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items).toHaveLength(1);
    expect(items[0].roleRelation).toBe('verantwortlich');
    expect(items[0].roleRelationLabel).toBe('accountable');
    expect(items[0].controlCase).toBe('redispatch');
    expect(items[0].matrixId).toBe('matrix-redispatch-001');
    expect(summary.totalItems).toBe(1);
  });

  test('returns a workbench item for a role in the durchfuehrend field', () => {
    const { items } = projectRoleWorkbench({
      role: 'ROLE_GRID_OPERATOR',
      matrices: [MATRIX_REDISPATCH],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items).toHaveLength(1);
    expect(items[0].roleRelation).toBe('durchfuehrend');
    expect(items[0].roleRelationLabel).toBe('responsible');
  });

  test('returns a workbench item for a role in the mitwirkend field', () => {
    const { items } = projectRoleWorkbench({
      role: 'ROLE_REDISPATCH_COORDINATOR',
      matrices: [MATRIX_REDISPATCH],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items).toHaveLength(1);
    expect(items[0].roleRelation).toBe('mitwirkend');
    expect(items[0].roleRelationLabel).toBe('consulted');
  });

  test('returns a workbench item for a role in the information field only', () => {
    const { items } = projectRoleWorkbench({
      role: 'ROLE_MANAGEMENT',
      matrices: [MATRIX_ASSET],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items).toHaveLength(1);
    expect(items[0].roleRelation).toBe('information');
    expect(items[0].roleRelationLabel).toBe('informed');
  });

  test('a role that appears in mitwirkend across multiple matrices returns one item per matrix', () => {
    const { items } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [MATRIX_REDISPATCH, MATRIX_ASSET],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    // ROLE_NETZPLANUNG: verantwortlich in MATRIX_REDISPATCH, mitwirkend in MATRIX_ASSET
    expect(items).toHaveLength(2);
    const relations = items.map((i) => i.roleRelation);
    expect(relations).toContain('verantwortlich');
    expect(relations).toContain('mitwirkend');
  });

  test('missing evidence triggers clarification in policy result', () => {
    // MATRIX_REDISPATCH has onMissingEvidence: 'clarification' — no evidence provided
    const { items, summary } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [MATRIX_REDISPATCH],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items[0].policy.requiresClarification).toBe(true);
    expect(items[0].policy.decision).toBe('requires_clarification');
    expect(items[0].missingEvidence).toContain('remote_control_proof');
    expect(items[0].missingEvidence).toContain('technical_availability');
    expect(summary.requiresClarification).toBe(1);
  });

  test('completed matrices are excluded by default; included with includeResolved=true', () => {
    const { items: defaultItems } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [MATRIX_REDISPATCH, MATRIX_COMPLETED],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });
    expect(defaultItems).toHaveLength(1);
    expect(defaultItems[0].matrixId).toBe('matrix-redispatch-001');

    const { items: allItems } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [MATRIX_REDISPATCH, MATRIX_COMPLETED],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
      includeResolved: true,
    });
    expect(allItems).toHaveLength(2);
  });

  test('an unknown role returns a clean empty workbench (no error)', () => {
    const { items, summary } = projectRoleWorkbench({
      role: 'ROLE_DOES_NOT_EXIST',
      matrices: [MATRIX_REDISPATCH, MATRIX_ASSET],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items).toHaveLength(0);
    expect(summary.totalItems).toBe(0);
    expect(summary.openItems).toBe(0);
    expect(summary.requiresClarification).toBe(0);
    expect(summary.requiresHumanDecision).toBe(0);
    expect(summary.evidenceGaps).toBe(0);
  });

  test('empty matrices array returns a clean empty workbench', () => {
    const { items, summary } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items).toHaveLength(0);
    expect(summary.totalItems).toBe(0);
  });

  test('resolver roles are derived from the RACI verantwortlich field', () => {
    const { items } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [MATRIX_REDISPATCH],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items[0].resolverRoles).toEqual(['ROLE_NETZPLANUNG']);
  });

  test('redispatch controlCase includes a runbook hint', () => {
    const { items } = projectRoleWorkbench({
      role: 'ROLE_NETZPLANUNG',
      matrices: [MATRIX_REDISPATCH],
      evaluatePolicy: makeEvaluatePolicy,
      deriveRoles: makeDeriveRoles,
    });

    expect(items[0].allowedCommands).toHaveLength(1);
    expect(items[0].allowedCommands[0].kind).toBe('runbook_hint');
    expect(items[0].allowedCommands[0].id).toBe('smm-rundeck:stadtwerk-mauer-e2e-smoke');
  });
});

// ── Suite 2: Broker integration tests ────────────────────────────────────────────

describe('governance.roleWorkbenchProjection — broker integration', () => {
  let broker;

  beforeEach(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    // Mock vdmi service returning a predefined set of matrices
    broker.createService({
      name: 'vdmi',
      actions: {
        list: {
          handler() {
            return {
              success: true,
              count: 2,
              items: [MATRIX_REDISPATCH, MATRIX_ASSET],
            };
          },
        },
      },
    });

    broker.createService(GovernanceService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  test('returns a projection for a role with verantwortlich tasks', async () => {
    const result = await broker.call('governance.roleWorkbenchProjection', {
      role: 'ROLE_NETZPLANUNG',
    });

    expect(result.success).toBe(true);
    expect(result.role).toBe('ROLE_NETZPLANUNG');
    expect(result.safety).toBe('read_only_projection');
    expect(result.sideEffects).toBe('none');
    expect(result.summary.totalItems).toBe(2); // verantwortlich + mitwirkend
    expect(result.items.some((i) => i.roleRelation === 'verantwortlich')).toBe(true);
    expect(result.items.some((i) => i.roleRelation === 'mitwirkend')).toBe(true);
  });

  test('returns empty workbench for a role with no VDMI tasks', async () => {
    const result = await broker.call('governance.roleWorkbenchProjection', {
      role: 'ROLE_NOBODY',
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalItems).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  test('surfaces a clarification-required policy for missing evidence', async () => {
    const result = await broker.call('governance.roleWorkbenchProjection', {
      role: 'ROLE_NETZPLANUNG',
    });

    const redispatchItem = result.items.find(
      (i) => i.controlCase === 'redispatch' && i.roleRelation === 'verantwortlich'
    );
    expect(redispatchItem).toBeDefined();
    expect(redispatchItem.policy.requiresClarification).toBe(true);
    expect(redispatchItem.missingEvidence).toContain('remote_control_proof');
  });

  test('returns a clean projection when vdmi service is unavailable (graceful degradation)', async () => {
    // Create a separate broker where vdmi is absent
    const emptyBroker = new ServiceBroker({ logger: false, transporter: null });
    emptyBroker.createService(GovernanceService);
    await emptyBroker.start();

    const result = await emptyBroker.call('governance.roleWorkbenchProjection', {
      role: 'ROLE_NETZPLANUNG',
    });

    expect(result.success).toBe(true);
    expect(result.summary.totalItems).toBe(0);

    await emptyBroker.stop();
  });
});
