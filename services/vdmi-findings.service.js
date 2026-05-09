/**
 * VDMI Findings Service
 * Manages governance findings (Soll-Ist-Abweichungen) as actionable tickets
 * v0.50.2 — Shadow IT Resolution with nova-decision-machine Lifecycle
 */

const Service = require('moleculer').Service;
const PouchDB = require('pouchdb');
const VDMIAuditTrail = require('../src/vdmi-audit-trail');

module.exports = class VDMIFindingsService extends Service {
  constructor(broker) {
    super(broker);

    this.name = 'vdmi-findings';
    this.settings = {
      fields: {
        id: { type: 'string', primaryKey: true },
        tenantId: { type: 'string', required: true },
        status: { type: 'enum', values: ['proposed', 'triaged', 'pending_approval', 'approved', 'applied', 'rejected'] },
      },
    };

    this.db = null;
    this.auditTrail = null;
  }

  created() {
    this.db = new PouchDB('data/vdmi-findings', {
      auto_compaction: true,
    });
    this.auditTrail = new VDMIAuditTrail(
      new PouchDB('data/vdmi-audit-trail', { auto_compaction: true })
    );
  }

  async started() {
    await this.db.createIndex({
      index: { fields: ['tenantId', 'status'] },
    });
    await this.db.createIndex({
      index: { fields: ['tenantId', 'severity'] },
    });
  }

  actions = {
    /**
     * GET — List findings with filters
     */
    'list': {
      rest: 'GET /tenants/:tenantId/findings',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'List all governance findings for tenant',
        parameters: [
          { name: 'tenantId', path: true, required: true },
          {
            name: 'status',
            query: true,
            description: 'Comma-separated statuses',
          },
          {
            name: 'severity',
            query: true,
            description: 'Critical, high, medium, low',
          },
          {
            name: 'limit',
            query: true,
            description: 'Result limit',
          },
        ],
        responses: {
          '200': {
            description: 'List of findings',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tenantId: { type: 'string' },
                    totalFindings: { type: 'number' },
                    findings: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { tenantId } = ctx.params;
        const { status, severity, limit = 50, offset = 0 } = ctx.query;

        try {
          const selector = {
            tenantId,
          };

          if (status) {
            const statuses = status.split(',').map(s => s.trim());
            selector.status = { $in: statuses };
          }

          if (severity) {
            selector.severity = severity;
          }

          const result = await this.db.find({
            selector,
            limit,
            skip: offset,
            sort: [{ discoveredAt: 'desc' }],
          });

          // Count by status/severity for summary
          const summaryResult = await this.db.find({
            selector: { tenantId },
          });

          const summary = this._generateFindingsSummary(summaryResult.docs);

          return {
            tenantId,
            totalFindings: result.total_rows,
            findings: result.docs.map(doc => this._formatFinding(doc)),
            summary,
          };
        } catch (error) {
          this.logger.error('Error listing findings:', error);
          throw error;
        }
      },
    },

    /**
     * POST — Mitigate finding with proposed actions
     */
    'mitigate': {
      rest: 'POST /tenants/:tenantId/findings/:findingId/mitigate',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'Submit mitigation plan for a finding',
        parameters: [
          { name: 'tenantId', in: 'path', required: true },
          { name: 'findingId', in: 'path', required: true },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  mitigationStrategy: {
                    type: 'string',
                    enum: ['manual_evidence_injection', 'process_correction', 'policy_exception'],
                  },
                  proposedActions: { type: 'array', items: { type: 'object' } },
                  riskAssessment: { type: 'object' },
                  approvalRequired: { type: 'boolean' },
                },
                required: ['mitigationStrategy', 'proposedActions'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Mitigation accepted' },
          '422': { description: 'Validation error' },
        },
      },
      async handler(ctx) {
        const { tenantId, findingId } = ctx.params;
        const { mitigationStrategy, proposedActions, riskAssessment, approvalRequired } =
          ctx.request.body;

        try {
          // Get finding
          const finding = await this.db.get(`vdmi-finding:${tenantId}:${findingId}`);
          if (!finding) {
            throw new Error('Finding not found');
          }

          // Create mitigation plan
          const mitigation = {
            id: `mitigation-${Date.now()}`,
            strategy: mitigationStrategy,
            proposedActions,
            riskAssessment,
            createdBy: ctx.meta.userId,
            createdAt: new Date().toISOString(),
            status: approvalRequired ? 'pending_approval' : 'approved',
            approvalChain: approvalRequired
              ? [
                  {
                    approver: 'compliance-officer@company.com',
                    role: 'hitl-approver',
                    status: 'pending',
                    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                  },
                ]
              : [],
          };

          // Update finding
          finding.lifecycle.triageStatus = 'in_mitigation';
          finding.lifecycle.triageAssignee = ctx.meta.userId;
          finding.mitigation = mitigation;
          finding.status = 'pending_approval';

          await this.db.put(finding);

          // Create audit entry
          await this.auditTrail.createEntry(tenantId, {
            action: 'FINDING_MITIGATED',
            actor: ctx.meta.userId,
            rationale: `Mitigation strategy: ${mitigationStrategy}`,
            relatedEntities: {
              type: 'finding',
              id: findingId,
            },
          });

          return {
            id: finding._id,
            status: finding.status,
            mitigation,
          };
        } catch (error) {
          this.logger.error('Error mitigating finding:', error);
          throw error;
        }
      },
    },

    /**
     * POST — Resolve finding
     */
    'resolve': {
      rest: 'POST /tenants/:tenantId/findings/:findingId/resolve',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'Resolve a finding with proof',
        parameters: [
          { name: 'tenantId', in: 'path', required: true },
          { name: 'findingId', in: 'path', required: true },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  resolutionType: {
                    type: 'string',
                    enum: ['mitigated_with_evidence', 'accepted_risk', 'policy_exception'],
                  },
                  justification: { type: 'string' },
                  evidenceProof: { type: 'object' },
                  applyChanges: { type: 'boolean' },
                },
                required: ['resolutionType', 'justification'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Finding resolved' },
          '403': { description: 'Insufficient permissions' },
        },
      },
      async handler(ctx) {
        const { tenantId, findingId } = ctx.params;
        const { resolutionType, justification, evidenceProof, applyChanges } =
          ctx.request.body;

        // Authorization
        const userRole = ctx.meta.userRole || 'user';
        const allowedRoles = ['hitl-approver', 'compliance-officer', 'matrix-admin'];
        if (!allowedRoles.includes(userRole)) {
          throw new Error('FORBIDDEN: Only authorized roles can resolve findings');
        }

        try {
          // Get finding
          const finding = await this.db.get(`vdmi-finding:${tenantId}:${findingId}`);
          if (!finding) {
            throw new Error('Finding not found');
          }

          // Update lifecycle
          finding.lifecycle.status = 'applied';
          finding.lifecycle.approvalStatus = 'approved';
          finding.lifecycle.appliedAt = new Date().toISOString();
          finding.status = 'applied';
          finding.resolutionType = resolutionType;
          finding.justification = justification;
          finding.evidenceProof = evidenceProof;
          finding.resolvedBy = ctx.meta.userId;
          finding.resolvedAt = new Date().toISOString();

          await this.db.put(finding);

          // Create audit entry
          await this.auditTrail.createEntry(tenantId, {
            action: 'FINDING_RESOLVED',
            actor: ctx.meta.userId,
            actorRole: userRole,
            rationale: justification,
            relatedEntities: {
              type: 'finding',
              id: findingId,
            },
          });

          // Apply changes if requested
          if (applyChanges && finding.affectedMatrix) {
            await ctx.call('vdmi.update', {
              id: finding.affectedMatrix.matrixId,
              role: finding.affectedMatrix.roleId,
            });
          }

          return {
            id: finding._id,
            status: 'applied',
            lifecycle: finding.lifecycle,
            resolvedAt: finding.resolvedAt,
          };
        } catch (error) {
          this.logger.error('Error resolving finding:', error);
          throw error;
        }
      },
    },
  };

  _formatFinding(doc) {
    const { _id, _rev, ...rest } = doc;
    return { id: _id, ...rest };
  }

  _generateFindingsSummary(docs) {
    const summary = {
      byStatus: {},
      bySeverity: {},
    };

    docs.forEach(doc => {
      summary.byStatus[doc.status] = (summary.byStatus[doc.status] || 0) + 1;
      summary.bySeverity[doc.severity] = (summary.bySeverity[doc.severity] || 0) + 1;
    });

    return summary;
  }
};
