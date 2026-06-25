'use strict';

const PouchDB = require('pouchdb');
const { evaluateGovernancePolicy } = require('../src/governance-policy-evaluator');
const { DecisionEvidenceAuditTrail } = require('../src/decision-evidence-audit-trail');

module.exports = {
  name: 'governance',

  settings: {
    decisionAuditDbPath: process.env.GOVERNANCE_DECISION_AUDIT_DB_PATH || './data/governance-decision-audit',
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
        timestamp: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Append an explicit decision/evidence audit entry',
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
  },
};
