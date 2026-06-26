'use strict';

const PouchDB = require('pouchdb');
const { evaluateGovernancePolicy } = require('../src/governance-policy-evaluator');
const {
  DecisionEvidenceAuditTrail,
  KNOWN_SOURCE_TYPES,
} = require('../src/decision-evidence-audit-trail');
const { deriveHitlResolverRoles } = require('../src/vdmi-hitl-role-derivation');
const {
  buildRedispatchReferenceProcessInput,
  SOURCE_ACTIONS_NOT_CALLED,
  summarizeRedispatchReferenceProcess,
} = require('../src/redispatch-reference-process');
const { projectRoleWorkbench } = require('../src/role-workbench-projector');
const { getTenantId } = require('../src/tenant-context');

module.exports = {
  name: 'governance',

  settings: {
    decisionAuditDbPath:
      process.env.GOVERNANCE_DECISION_AUDIT_DB_PATH || './data/governance-decision-audit',
  },

  created() {
    this.decisionAuditDb = new PouchDB(this.settings.decisionAuditDbPath, {
      auto_compaction: true,
    });
    this.decisionAuditTrail = new DecisionEvidenceAuditTrail(this.decisionAuditDb);
  },

  actions: {
    evaluatePolicy: {
      params: {
        capability: { type: 'any', optional: true },
        controlCase: { type: 'any', optional: true },
        action: { type: 'string', optional: true },
        context: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Evaluate governance policy without executing the action',
        tags: ['Governance'],
      },
      handler(ctx) {
        return {
          ...evaluateGovernancePolicy(ctx.params),
          safety: 'read_only_policy_evaluation',
          sideEffects: 'none',
        };
      },
    },

    deriveHitlResolverRoles: {
      params: {
        row: { type: 'object', optional: true, default: {} },
        decisionPolicy: { type: 'object', optional: true, default: {} },
        fallbackRoles: { type: 'array', optional: true, default: [], items: 'string' },
        context: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Derive HITL resolver roles from VDMI row role metadata',
        tags: ['Governance'],
      },
      handler(ctx) {
        return deriveHitlResolverRoles(ctx.params);
      },
    },

    runRedispatchReferenceProcess: {
      params: {
        tenantId: { type: 'string', optional: true },
        caseId: { type: 'string', optional: true },
        matrixId: { type: 'string', optional: true },
        rowId: { type: 'string', optional: true },
        controlCase: { type: 'string', optional: true },
        evidence: { type: 'array', optional: true, default: [], items: 'any' },
        responsibleRole: { type: 'string', optional: true },
        contributorRole: { type: 'string', optional: true },
        actor: { type: 'string', optional: true },
        actorRole: { type: 'string', optional: true },
        timestamp: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Run the explicit technical Redispatch governance reference process',
        tags: ['Governance'],
      },
      async handler(ctx) {
        const input = buildRedispatchReferenceProcessInput(ctx.params);
        const policyDecision = await ctx.call('governance.evaluatePolicy', {
          controlCase: input.row,
          context: input.context,
        });
        const roleDerivation = await ctx.call('governance.deriveHitlResolverRoles', {
          row: input.row,
          decisionPolicy: input.row.decisionPolicy,
        });
        const auditRecord = await ctx.call('governance.recordDecisionAudit', {
          tenantId: input.tenantId,
          entityId: input.caseId,
          rowId: input.row.taskId,
          mandate: 'technical-redispatch-reference-process',
          controlCase: input.row.controlCase,
          actor: input.actor || 'governance-reference-process',
          role: input.actorRole,
          evidenceState: input.evidenceState,
          decision: policyDecision.reason,
          followUpAction: policyDecision.requiresHumanDecision
            ? 'create_hitl_item_for_derived_roles_reference_only'
            : 'continue_technical_reference_process',
          policyDecision: {
            ...policyDecision,
            requiredResolverRoles: roleDerivation.requiredResolverRoles,
            contributorApprovalRoles: roleDerivation.contributorApprovalRoles,
          },
          metadata: {
            matrixId: input.matrixId,
            referenceProcess: 'technical_redispatch_steuerbarkeitscheck',
            sourceActionsNotCalled: SOURCE_ACTIONS_NOT_CALLED,
          },
          timestamp: ctx.params.timestamp,
        });
        const verification = await ctx.call('governance.verifyDecisionAuditTrail', {
          tenantId: input.tenantId,
          entityId: input.caseId,
          rowId: input.row.taskId,
        });

        return summarizeRedispatchReferenceProcess({
          input,
          policyDecision,
          roleDerivation,
          auditRecord,
          verification,
        });
      },
    },

    recordDecisionAudit: {
      params: {
        tenantId: { type: 'string', optional: true },
        entityId: { type: 'string' },
        rowId: { type: 'string', optional: true },
        mandate: { type: 'string', optional: true },
        controlCase: { type: 'string', optional: true },
        actor: { type: 'string', optional: true },
        role: { type: 'string', optional: true },
        evidenceState: { type: 'object', optional: true, default: {} },
        decision: { type: 'string' },
        followUpAction: { type: 'string', optional: true },
        policyDecision: { type: 'object', optional: true, default: {} },
        metadata: { type: 'object', optional: true, default: {} },
        // Provenance sources (#276 Option B): data origins that justified this
        // decision. Each entry: { sourceType, sourceId, sourceVersion?,
        // sourceTimestamp?, fieldNames? }. Known sourceType values:
        // 'mastr','edm','object-store','vdmi','mcp-tool','external-api'.
        sources: { type: 'array', optional: true, default: [], items: 'object' },
        timestamp: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Append an explicit decision/evidence audit entry',
        description:
          'Appends a hash-chained decision/evidence audit entry. ' +
          `sources[] carries provenance: which data origins (sourceType one of ${KNOWN_SOURCE_TYPES.join(', ')}) ` +
          'justified the decision, at which version/timestamp. ' +
          'Included in the hash chain — cannot be altered post-hoc without detection.',
        tags: ['Governance'],
      },
      async handler(ctx) {
        const entry = await this.decisionAuditTrail.appendEntry(ctx.params);
        return {
          success: true,
          safety: 'append_only_audit_write',
          sideEffects: 'local_audit_append_only',
          entry,
        };
      },
    },

    getDecisionAuditTrail: {
      params: {
        tenantId: { type: 'string', optional: true },
        entityId: { type: 'string' },
        rowId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Read a decision/evidence audit trail',
        tags: ['Governance'],
      },
      async handler(ctx) {
        const entries = await this.decisionAuditTrail.getTrail(ctx.params);
        return {
          success: true,
          safety: 'read_only_integrity_check',
          entries,
          entryCount: entries.length,
        };
      },
    },

    verifyDecisionAuditTrail: {
      params: {
        tenantId: { type: 'string', optional: true },
        entityId: { type: 'string' },
        rowId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Verify a decision/evidence audit trail hash chain',
        tags: ['Governance'],
      },
      async handler(ctx) {
        const verification = await this.decisionAuditTrail.verifyTrail(ctx.params);
        return {
          success: true,
          safety: 'read_only_integrity_check',
          ...verification,
        };
      },
    },

    // ── Role Workbench Projection (#301) ─────────────────────────────────────────
    // Read-only projection: given a role, returns a structured view of all VDMI
    // tasks/rows where that role appears, enriched with policy evaluation, HITL role
    // derivation, evidence gaps, and curated next-action hints. No writes, no
    // Rundeck execution — curated hints only. Suitable as a Budibase REST datasource.
    roleWorkbenchProjection: {
      rest: 'GET /role-workbench',
      params: {
        role: { type: 'string', min: 1 },
        includeResolved: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'Role Workbench Projection — role-specific VDMI task overview',
        tags: ['Governance'],
        description:
          'Returns a read-only workbench projection for a role: all VDMI matrix tasks ' +
          'where the role appears as verantwortlich/durchfuehrend/mitwirkend/information, ' +
          'enriched with governance policy evaluation, HITL role derivation, evidence ' +
          'gaps, and curated next-action hints. No writes; suitable as a Budibase datasource.',
        parameters: [
          {
            name: 'role',
            in: 'query',
            required: true,
            schema: { type: 'string', example: 'ROLE_NETZPLANUNG' },
          },
          {
            name: 'includeResolved',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Include tasks from completed/resolved matrices',
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { role, includeResolved } = ctx.params;

        // Fetch all VDMI matrices for this tenant (fail gracefully if vdmi service
        // is unavailable — return an empty workbench rather than a 500).
        let matrices = [];
        try {
          const vdmiResult = await ctx.call('vdmi.list', { limit: 200 }, { meta: ctx.meta });
          matrices = Array.isArray(vdmiResult?.items) ? vdmiResult.items : [];
        } catch {
          matrices = [];
        }

        const projection = projectRoleWorkbench({
          role,
          matrices,
          evaluatePolicy: (task, context) =>
            evaluateGovernancePolicy({ controlCase: task, context }),
          deriveRoles: (input) => deriveHitlResolverRoles(input),
          includeResolved,
        });

        return {
          success: true,
          safety: 'read_only_projection',
          sideEffects: 'none',
          role,
          tenantId,
          summary: projection.summary,
          items: projection.items,
        };
      },
    },
  },
};
