'use strict';

/**
 * Referenzprozess 1 - Technischer Steuerbarkeits-/Redispatch-Prozess (#295).
 *
 * Validates the full governance primitive stack (#291 VDMI schema, #292 policy
 * evaluator, #293 HITL role derivation, #294 decision audit trail) for a
 * technical control case. This differs from #296's asset-transformation
 * reference process: escalation is driven by missing technical controllability
 * evidence, not by high financial/regulatory impact.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const GovernanceService = require('../services/governance.service');
const {
  buildRedispatchReferenceProcessInput,
  SOURCE_ACTIONS_NOT_CALLED,
} = require('../src/redispatch-reference-process');

const ALL_EVIDENCE = [
  'technical_controllability_evidence',
  'redispatch_scope_assessment',
  'grid_operations_decision_basis',
];

describe('Referenzprozess 1 - Technischer Steuerbarkeits-/Redispatch-Prozess (#295)', () => {
  let broker;
  let dbPath;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `cernion-redispatch-reference-${Date.now()}-${Math.random()}`);
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...GovernanceService,
      settings: {
        ...GovernanceService.settings,
        decisionAuditDbPath: dbPath,
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('builds a deterministic VDMI control-case row for the technical reference process', () => {
    const input = buildRedispatchReferenceProcessInput({
      tenantId: 'tenant-demo',
      caseId: 'redispatch-case-1',
      rowId: 'row-redispatch-1',
      responsibleRole: 'ROLE_NETZBETRIEB',
      evidence: ['technical_controllability_evidence'],
    });

    expect(input).toMatchObject({
      tenantId: 'tenant-demo',
      caseId: 'redispatch-case-1',
      row: {
        taskId: 'row-redispatch-1',
        controlCase: 'redispatch',
        verantwortlich: [{ actorType: 'role', actorId: 'ROLE_NETZBETRIEB' }],
        decisionPolicy: {
          onMissingEvidence: 'mandatory_human_decision',
          onConflictingSources: 'mandatory_human_decision',
        },
      },
      evidenceState: {
        technical_controllability_evidence: 'present',
        redispatch_scope_assessment: 'missing',
        grid_operations_decision_basis: 'missing',
      },
    });
  });

  it('runs schema -> policy -> role derivation -> explicit audit -> verification end to end', async () => {
    const result = await broker.call('governance.runRedispatchReferenceProcess', {
      tenantId: 'tenant-demo',
      caseId: 'redispatch-case-295',
      matrixId: 'redispatch-matrix-295',
      rowId: 'redispatch-row-295',
      evidence: ALL_EVIDENCE,
      responsibleRole: 'ROLE_NETZBETRIEB',
      contributorRole: 'ROLE_NETZPLANUNG',
      actor: 'governance-reference@example.test',
      timestamp: '2026-06-25T21:00:00.000Z',
    });

    expect(result).toMatchObject({
      success: true,
      referenceProcess: 'technical_redispatch_steuerbarkeitscheck',
      safety: 'controlled_reference_write',
      sideEffects: 'local_audit_append_only',
      controlCase: 'redispatch',
      tenantId: 'tenant-demo',
      caseId: 'redispatch-case-295',
      rowId: 'redispatch-row-295',
      policyDecision: {
        allowed: true,
        requiresHumanDecision: false,
        reason: 'policy_allowed',
        safety: 'read_only_policy_evaluation',
        sideEffects: 'none',
      },
      resolverRoles: {
        requiredResolverRoles: ['ROLE_NETZBETRIEB'],
        contributorApprovalRoles: [],
        missingRoleMetadata: false,
      },
      nextReferenceAction: 'continue_technical_reference_process',
    });
    expect(result.audit.entry).toMatchObject({
      tenantId: 'tenant-demo',
      entityId: 'redispatch-case-295',
      rowId: 'redispatch-row-295',
      decision: 'policy_allowed',
      previousHash: null,
    });
    expect(result.audit.verification).toMatchObject({
      verified: true,
      entryCount: 1,
      failures: [],
    });
    expect(result.sourceActions.notCalled).toEqual(SOURCE_ACTIONS_NOT_CALLED);
  });

  it('keeps policy evaluation side-effect-free and appends audit only through the reference action', async () => {
    const template = buildRedispatchReferenceProcessInput({
      tenantId: 'tenant-side-effect',
      caseId: 'redispatch-side-effect',
      rowId: 'redispatch-side-effect-row',
      evidence: ALL_EVIDENCE,
    });

    const policy = await broker.call('governance.evaluatePolicy', {
      controlCase: template.row,
      context: template.context,
    });
    expect(policy).toMatchObject({
      allowed: true,
      safety: 'read_only_policy_evaluation',
      sideEffects: 'none',
    });

    const emptyTrail = await broker.call('governance.getDecisionAuditTrail', {
      tenantId: 'tenant-side-effect',
      entityId: 'redispatch-side-effect',
      rowId: 'redispatch-side-effect-row',
    });
    expect(emptyTrail.entryCount).toBe(0);

    await broker.call('governance.runRedispatchReferenceProcess', {
      tenantId: 'tenant-side-effect',
      caseId: 'redispatch-side-effect',
      rowId: 'redispatch-side-effect-row',
      evidence: ALL_EVIDENCE,
    });

    const writtenTrail = await broker.call('governance.getDecisionAuditTrail', {
      tenantId: 'tenant-side-effect',
      entityId: 'redispatch-side-effect',
      rowId: 'redispatch-side-effect-row',
    });
    expect(writtenTrail.entryCount).toBe(1);
  });

  it('returns evidence gaps and positive follow-ups for incomplete reference input', async () => {
    const result = await broker.call('governance.runRedispatchReferenceProcess', {
      tenantId: 'tenant-gap',
      caseId: 'redispatch-gap',
      rowId: 'redispatch-gap-row',
      evidence: ['technical_controllability_evidence'],
    });

    expect(result.policyDecision).toMatchObject({
      allowed: false,
      requiresHumanDecision: true,
      reason: 'human_decision_required',
    });
    expect(result.policyDecision.evidenceGaps.map((gap) => gap.name)).toEqual([
      'redispatch_scope_assessment',
      'grid_operations_decision_basis',
    ]);
    expect(result.positiveFollowUps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ missingDataPoint: 'redispatch_scope_assessment' }),
        expect.objectContaining({ missingDataPoint: 'grid_operations_decision_basis' }),
        expect.objectContaining({ missingDataPoint: 'auditActor' }),
      ])
    );
    expect(result.nextReferenceAction).toBe('create_hitl_item_for_derived_roles_reference_only');
  });
});
