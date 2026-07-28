/**
 * VDMI Human Override Service
 * Enables correcting LLM-inferred VDMI matrices with mandatory audit trail
 * v0.50.2 — Matrix Override & Version Revert Workflows
 */

const Service = require('moleculer').Service;
const { MoleculerClientError } = require('moleculer').Errors;
const PouchDB = require('pouchdb');
const VDMIAuditTrail = require('../src/vdmi-audit-trail');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');

module.exports = class VDMIHumanOverrideService extends Service {
  constructor(broker) {
    super(broker);

    this.name = 'vdmi-human-override';
    this.settings = {
      fields: {
        id: { type: 'string', primaryKey: true },
        tenantId: { type: 'string', required: true },
        matrixId: { type: 'string', required: true },
        version: { type: 'number', required: true },
        status: { type: 'enum', values: ['pending_review', 'approved', 'rejected'] },
      },
    };

    this.auditTrail = null;

    this.parseServiceSchema({
      name: this.name,
      mixins: [
        createPouchDbLifecycleMixin({
          defaultDbPath: 'data/vdmi-human-override',
          indexes: [
            ['tenantId', 'matrixId'],
            ['tenantId', 'status'],
          ],
          logLabel: 'vdmi-human-override',
        }),
      ],
      settings: this.settings,
      actions: this.actions,
      created: this.created,
    });
  }

  created() {
    // Shared across vdmi-evidence/vdmi-findings/vdmi-human-override — each opens its own
    // PouchDB handle onto the same underlying store, so this one is deliberately NOT
    // lifecycle-managed by the mixin: closing one handle to a shared PouchDB path hangs
    // the sibling handles (verified), so it is left open for the process lifetime as before.
    this.auditTrail = new VDMIAuditTrail(
      new PouchDB('data/vdmi-audit-trail', { auto_compaction: true })
    );
  }

  actions = {
    /**
     * PATCH — Override matrix roles with rationale
     */
    override: {
      rest: 'PATCH /tenants/:tenantId/matrices/:matrixId',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'Override LLM-inferred matrix roles with mandatory audit trail',
        parameters: [
          { name: 'tenantId', in: 'path', required: true, description: 'Tenant ID' },
          {
            name: 'matrixId',
            in: 'path',
            required: true,
            description: 'Matrix ID to override',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  overrides: {
                    type: 'object',
                    description: 'Role assignments to override',
                    properties: {
                      roles: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            roleId: { type: 'string' },
                            assignments: { type: 'object' },
                            precedenceScore: { type: 'number' },
                          },
                        },
                      },
                    },
                  },
                  rationale: {
                    type: 'string',
                    minLength: 20,
                    description: 'Mandatory justification (min 20 chars)',
                  },
                  changeCategory: {
                    type: 'string',
                    enum: ['organizational_change', 'data_correction', 'compliance', 'other'],
                  },
                  urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
                },
                required: ['overrides', 'rationale', 'changeCategory'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Matrix override successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    tenantId: { type: 'string' },
                    status: { type: 'string' },
                    version: { type: 'number' },
                    auditEntry: { type: 'object' },
                  },
                },
              },
            },
          },
          403: { description: 'Insufficient permissions' },
          422: { description: 'Validation error' },
        },
      },
      async handler(ctx) {
        const { tenantId, matrixId } = ctx.params;
        const body = ctx.request?.body || ctx.params;
        const { overrides, rationale, changeCategory, urgency } = body;

        // Authorization check
        const userRole = ctx.meta.userRole || 'user';
        const allowedRoles = ['hitl-approver', 'data-steward', 'matrix-admin'];
        if (!allowedRoles.includes(userRole)) {
          throw new Error('FORBIDDEN: Insufficient permissions for matrix override');
        }

        // Validation
        if (rationale.length < 20) {
          throw new Error('Rationale must be at least 20 characters');
        }
        if (!overrides.roles || overrides.roles.length === 0) {
          throw new Error('At least one role override must be provided');
        }

        const coreResult = await ctx.call(
          'vdmi.get',
          { id: matrixId },
          { meta: { ...ctx.meta, tenantId } }
        );
        const matrix = coreResult?.matrix;
        if (!matrix) {
          throw new Error('Matrix not found');
        }

        const patch = overrides.patch || null;
        if (!patch) {
          throw new MoleculerClientError(
            'Legacy role-object VDMI override is retired for this facade. Provide overrides.patch for canonical vdmi.update or define the VDMI row schema in the governance model first.',
            410,
            'VDMI_LEGACY_ROLE_OVERRIDE_RETIRED',
            { tenantId, matrixId }
          );
        }

        // Create override document
        const overrideDoc = {
          _id: `vdmi-override:${tenantId}:${matrixId}:${Date.now()}`,
          tenantId,
          matrixId,
          originalVersion: matrix.version,
          newVersion: matrix.version + 1,
          overrides,
          status: 'pending_review',
          createdBy: ctx.meta.userId,
          createdAt: new Date().toISOString(),
        };

        await this.db.put(overrideDoc);

        // Create audit entry
        const auditEntry = await this.auditTrail.createEntry(tenantId, {
          action: 'MATRIX_OVERRIDE',
          actor: ctx.meta.userId,
          actorRole: userRole,
          rationale,
          changeCategory,
          delta: {
            roles: overrides.roles.map((r) => ({
              roleId: r.roleId,
              before: matrix.roles?.find((mr) => mr.roleId === r.roleId),
              after: r.assignments,
            })),
          },
          relatedEntities: {
            type: 'matrix',
            id: matrixId,
          },
          ipAddress: ctx.meta.remoteAddress,
          userAgent: ctx.meta.userAgent,
        });

        const updated = await ctx.call(
          'vdmi.update',
          {
            id: matrixId,
            reason: rationale,
            patch: {
              ...patch,
              status: patch.status || 'pending_review',
            },
          },
          { meta: { ...ctx.meta, tenantId } }
        );

        // Send notification
        await ctx.emit('vdmi.matrix.overridden', {
          matrixId,
          tenantId,
          overriddenBy: ctx.meta.userId,
          urgency,
        });

        return {
          id: overrideDoc._id,
          tenantId,
          matrixId,
          status: 'pending_review',
          version: updated?.matrix?.version || matrix.version,
          changes: {
            modified_roles: overrides.roles.length,
            audit_trail_entries: 1,
          },
          auditEntry,
        };
      },
    },

    /**
     * POST — Revert matrix to previous version
     */
    revert: {
      rest: 'POST /tenants/:tenantId/matrices/:matrixId/revert',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'Rollback matrix to previous version with audit trail',
        parameters: [
          { name: 'tenantId', in: 'path', required: true },
          { name: 'matrixId', in: 'path', required: true },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  targetVersion: {
                    type: 'number',
                    description: 'Target version to revert to',
                  },
                  reason: {
                    type: 'string',
                    minLength: 10,
                    description: 'Reason for revert',
                  },
                  notifyStakeholders: {
                    type: 'boolean',
                    description: 'Send notifications',
                  },
                },
                required: ['targetVersion', 'reason'],
              },
            },
          },
        },
        responses: {
          200: { description: 'Matrix reverted successfully' },
          409: { description: 'Concurrent modification conflict' },
        },
      },
      async handler(ctx) {
        const { tenantId, matrixId } = ctx.params;
        const body = ctx.request?.body || ctx.params;
        const { targetVersion, reason, notifyStakeholders } = body;

        // Authorization
        const userRole = ctx.meta.userRole || 'user';
        const allowedRoles = ['hitl-approver', 'matrix-admin'];
        if (!allowedRoles.includes(userRole)) {
          throw new Error('FORBIDDEN: Only matrix admins can revert versions');
        }

        const coreResult = await ctx.call(
          'vdmi.get',
          { id: matrixId },
          { meta: { ...ctx.meta, tenantId } }
        );
        const matrix = coreResult?.matrix;
        if (!matrix) {
          throw new Error('Matrix not found');
        }

        if (targetVersion >= matrix.version) {
          throw new Error('Target version must be older than current version');
        }

        if (matrix.version - targetVersion > 10) {
          throw new Error('Cannot revert more than 10 versions; request archive');
        }

        if (targetVersion !== matrix.version - 1) {
          throw new MoleculerClientError(
            'Version-targeted VDMI rollback is retired for this facade. The canonical vdmi.revert action only supports reverting the latest stored revision.',
            410,
            'VDMI_VERSIONED_REVERT_RETIRED',
            { tenantId, matrixId, currentVersion: matrix.version, targetVersion }
          );
        }

        // Create revert document
        const revertDoc = {
          _id: `vdmi-revert:${tenantId}:${matrixId}:${Date.now()}`,
          tenantId,
          matrixId,
          fromVersion: matrix.version,
          toVersion: targetVersion,
          reason,
          revertedBy: ctx.meta.userId,
          revertedAt: new Date().toISOString(),
        };

        await this.db.put(revertDoc);

        // Create audit entry
        const auditEntry = await this.auditTrail.createEntry(tenantId, {
          action: 'MATRIX_REVERT',
          actor: ctx.meta.userId,
          actorRole: userRole,
          rationale: reason,
          delta: {
            fromVersion: matrix.version,
            toVersion: targetVersion,
          },
          relatedEntities: {
            type: 'matrix',
            id: matrixId,
          },
        });

        const reverted = await ctx.call(
          'vdmi.revert',
          {
            id: matrixId,
            reason,
          },
          { meta: { ...ctx.meta, tenantId } }
        );

        // Notify
        if (notifyStakeholders) {
          await ctx.emit('vdmi.matrix.reverted', {
            matrixId,
            tenantId,
            fromVersion: revertDoc.fromVersion,
            toVersion: revertDoc.toVersion,
            revertedBy: ctx.meta.userId,
          });
        }

        return {
          id: revertDoc._id,
          matrixId,
          previousVersion: revertDoc.fromVersion,
          targetVersion: revertDoc.toVersion,
          currentVersion: reverted?.matrix?.version || matrix.version,
          revertedAt: revertDoc.revertedAt,
          revertedBy: ctx.meta.userId,
          auditEntry,
          notificationsQueued: notifyStakeholders ? ['stakeholders'] : [],
        };
      },
    },
  };
};
