'use strict';

/**
 * Referenzprozess 2 — Asset-/Transformationsprozess mit kaufmännisch-regulatorischer
 * Wirkung (Issue #296, sub-issue of #275).
 *
 * Validates that the full governance primitive stack (#291 VDMI schema, #292 policy
 * evaluator, #293 HITL role derivation, #294 decision audit trail) composes correctly
 * for a commercial/regulatory-impact control case.
 *
 * ── Key distinguishing characteristics vs. a technical Redispatch reference process ──
 *
 *   1. controlCase: 'asset_transformation' (not 'redispatch' / 'steuerbarkeitscheck').
 *      Commercial asset lifecycle, EOG/AfA accounting impact, regulatory write-offs.
 *
 *   2. `decisionPolicy.onHighFinancialImpact: 'mandatory_human_decision'` fires when
 *      the caller signals `context.highFinancialImpact: true` — e.g. an asset with book
 *      value > threshold triggers the financial-impact flag.  This escalation rule does
 *      NOT exist in technical (redispatch/steuerbarkeit) control cases.
 *
 *   3. `decisionPolicy.onConflictingSources: 'mandatory_human_decision'` — regulatory
 *      data conflicts (commercial register vs. regulatory register) require explicit
 *      human sign-off before the process may auto-continue. Technical cases may accept
 *      'evidence_gap' for conflicting data.
 *
 *   4. RACI roles are financially/organisationally rooted (ROLE_CONTROLLING,
 *      ROLE_ASSET_MANAGER) rather than grid-operationally rooted (ROLE_NETZPLANUNG,
 *      ROLE_GRID_OPERATOR).
 *
 *   5. evidenceRequirements include the commercial asset register, the regulatory
 *      relevance check (§ 6 StromNEV / § 32 StromNEV), and an EOG/AfA impact
 *      assessment — not meter data or remote-control proofs.
 */

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

// Set the DB path before requiring the governance service so the settings
// object picks up the correct path (settings is evaluated at require time).
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-gov-refproc2-${Date.now()}`);
process.env.GOVERNANCE_DECISION_AUDIT_DB_PATH = TEST_DB_PATH;

const GovernanceService = require('../services/governance.service');

// ── Shared fixture — the asset-transformation VDMI matrix row ─────────────────────────

const ASSET_TRANSFORMATION_ROW = {
  taskId: 'asset-transformation-governance',
  taskName: 'Asset-Transformation-Prüfung (Kaufmännisch-Regulatorisch)',
  controlCase: 'asset_transformation',
  // RACI — commercially/organisationally rooted, unlike the technical Redispatch case
  verantwortlich: [{ actorType: 'role', actorId: 'ROLE_CONTROLLING' }],
  durchfuehrend: [{ actorType: 'role', actorId: 'ROLE_ASSET_MANAGER' }],
  mitwirkend: [{ actorType: 'role', actorId: 'ROLE_REGULATORY' }],
  information: [{ actorType: 'role', actorId: 'ROLE_MANAGEMENT' }],
  // Evidence — commercial/regulatory documents, not technical meter readings
  evidenceRequirements: [
    {
      id: 'commercial_asset_register',
      label: 'Kaufmännisches Anlageverzeichnis',
      required: true,
    },
    {
      id: 'regulatory_relevance',
      label: 'Regulatorische Relevanzprüfung (§ 6 / § 32 StromNEV)',
      required: true,
    },
    {
      id: 'eog_afa_assessment',
      label: 'EOG-/AfA-Wirkungsanalyse',
      required: true,
    },
  ],
  // decisionPolicy — the key commercial/regulatory distinction:
  // onHighFinancialImpact escalates to mandatory human decision (not present in
  // technical cases); onConflictingSources also requires human sign-off.
  decisionPolicy: {
    onMissingEvidence: 'evidence_gap',
    onHighFinancialImpact: 'mandatory_human_decision',
    onConflictingSources: 'mandatory_human_decision',
  },
};

const ALL_EVIDENCE = ['commercial_asset_register', 'regulatory_relevance', 'eog_afa_assessment'];

describe('Referenzprozess 2 — Asset-/Transformationsprozess (#296)', () => {
  let broker;

  beforeEach(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(GovernanceService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  // ── Section 1: governance policy evaluation ────────────────────────────────────────

  describe('policy evaluation', () => {
    it('allows the process when all evidence is present and no financial-impact flag is set', async () => {
      const result = await broker.call('governance.evaluatePolicy', {
        controlCase: ASSET_TRANSFORMATION_ROW,
        context: { evidence: ALL_EVIDENCE },
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresHumanDecision).toBe(false);
      expect(result.requiresClarification).toBe(false);
      expect(result.evidenceGaps).toHaveLength(0);
      expect(result.safety).toBe('read_only_policy_evaluation');
      expect(result.sideEffects).toBe('none');
    });

    it('escalates to mandatory human decision when highFinancialImpact context flag is set', async () => {
      // This is the key distinguishing behaviour vs. the technical Redispatch process:
      // commercial/regulatory cases with material book-value impact require explicit
      // CONTROLLING/management sign-off regardless of evidence completeness.
      const result = await broker.call('governance.evaluatePolicy', {
        controlCase: ASSET_TRANSFORMATION_ROW,
        context: {
          evidence: ALL_EVIDENCE,
          highFinancialImpact: true,
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresHumanDecision).toBe(true);
      expect(result.requiresClarification).toBe(false);
      expect(result.hitlPolicy).toMatchObject({
        source: 'controlCase.decisionPolicy',
        trigger: 'highFinancialImpact',
      });
      expect(result.reason).toBe('human_decision_required');
    });

    it('reports evidence gaps (not clarification) when required documents are missing', async () => {
      // onMissingEvidence: 'evidence_gap' — not 'clarification', unlike a case where the
      // policy expects the user to supply more context before a decision can be made.
      const result = await broker.call('governance.evaluatePolicy', {
        controlCase: ASSET_TRANSFORMATION_ROW,
        context: { evidence: ['commercial_asset_register'] }, // regulatory_relevance + eog_afa_assessment missing
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresClarification).toBe(false);
      expect(result.requiresHumanDecision).toBe(false);
      expect(result.reason).toBe('evidence_missing');
      const gapNames = result.evidenceGaps.map((g) => g.name);
      expect(gapNames).toContain('regulatory_relevance');
      expect(gapNames).toContain('eog_afa_assessment');
      expect(gapNames).not.toContain('commercial_asset_register');
    });

    it('reports that the schema validation catches an invalid controlCase', async () => {
      const result = await broker.call('governance.evaluatePolicy', {
        controlCase: { controlCase: 12345, decisionPolicy: {} },
        context: {},
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('control_case_invalid');
    });
  });

  // ── Section 2: HITL resolver-role derivation ─────────────────────────────────────

  describe('HITL role derivation from VDMI row', () => {
    it('derives ROLE_CONTROLLING as the required resolver from the verantwortlich field', async () => {
      const result = await broker.call('governance.deriveHitlResolverRoles', {
        row: ASSET_TRANSFORMATION_ROW,
      });

      expect(result.success).toBe(true);
      expect(result.requiredResolverRoles).toEqual(['ROLE_CONTROLLING']);
      expect(result.responsibleRoles).toEqual(['ROLE_CONTROLLING']);
      expect(result.contributorRoles).toEqual(['ROLE_REGULATORY']);
      // mitwirkend present but no multiPartyApproval policy → contributor gap noted
      expect(result.evidenceGaps.some((g) => g.name === 'vdmi_contributor_approval_policy')).toBe(
        true
      );
    });

    it('can supply ROLE_REGULATORY as a contributor-approval role when decisionPolicy requires multi-party', async () => {
      const rowWithMultiParty = {
        ...ASSET_TRANSFORMATION_ROW,
        decisionPolicy: {
          ...ASSET_TRANSFORMATION_ROW.decisionPolicy,
          multiPartyApproval: true,
        },
      };

      const result = await broker.call('governance.deriveHitlResolverRoles', {
        row: rowWithMultiParty,
        decisionPolicy: { multiPartyApproval: true },
      });

      expect(result.contributorApprovalRoles).toEqual(['ROLE_REGULATORY']);
      expect(result.contributorApprovalRequired).toBe(true);
    });
  });

  // ── Section 3: end-to-end chain — evaluate → derive → record → verify ────────────

  describe('full governance chain with audit trail', () => {
    it('evaluates, derives roles, records a human-decision entry, and verifies the hash chain', async () => {
      // Step 1 — policy evaluation with financial-impact flag
      const policyResult = await broker.call('governance.evaluatePolicy', {
        controlCase: ASSET_TRANSFORMATION_ROW,
        context: { evidence: ALL_EVIDENCE, highFinancialImpact: true },
      });
      expect(policyResult.requiresHumanDecision).toBe(true);

      // Step 2 — derive HITL resolver roles
      const roleResult = await broker.call('governance.deriveHitlResolverRoles', {
        row: ASSET_TRANSFORMATION_ROW,
      });
      expect(roleResult.requiredResolverRoles).toEqual(['ROLE_CONTROLLING']);

      // Step 3 — record the governance decision in the audit trail
      const auditEntry = await broker.call('governance.recordDecisionAudit', {
        tenantId: 'tenant-demo',
        entityId: 'asset-12345',
        rowId: ASSET_TRANSFORMATION_ROW.taskId,
        mandate: 'transformation-governance-wave2',
        controlCase: 'asset_transformation',
        actor: 'system@governance-agent',
        role: 'ROLE_GOVERNANCE_AGENT',
        evidenceState: {
          commercial_asset_register: 'present',
          regulatory_relevance: 'present',
          eog_afa_assessment: 'present',
        },
        decision: 'human_decision_required',
        followUpAction: 'create_hitl_item_for_controlling',
        policyDecision: {
          allowed: false,
          requiresHumanDecision: true,
          reason: 'human_decision_required',
          trigger: 'highFinancialImpact',
          requiredResolverRoles: roleResult.requiredResolverRoles,
        },
      });
      expect(auditEntry.success).toBe(true);
      expect(auditEntry.entry.decision).toBe('human_decision_required');
      expect(auditEntry.entry.chain.previousHash).toBeNull(); // first entry in chain

      // Step 4 — verify audit trail integrity
      const verification = await broker.call('governance.verifyDecisionAuditTrail', {
        tenantId: 'tenant-demo',
        entityId: 'asset-12345',
        rowId: ASSET_TRANSFORMATION_ROW.taskId,
      });
      expect(verification.success).toBe(true);
      expect(verification.verified).toBe(true);
      expect(verification.entryCount).toBe(1);
      expect(verification.failures).toHaveLength(0);
    });
  });
});
