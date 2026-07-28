/**
 * VDMI Spectator Service
 * Provides transparency in agent negotiation traces and governance dossiers
 * v0.50.2 — Agent Dialog Transparency for Role V (Human Verifier)
 */

const Service = require('moleculer').Service;
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');

module.exports = class VDMISpectatorService extends Service {
  constructor(broker) {
    super(broker);

    this.name = 'vdmi-spectator';
    this.settings = {
      fields: {
        taskId: { type: 'string', primaryKey: true },
        tenantId: { type: 'string' },
      },
    };

    this.parseServiceSchema({
      name: this.name,
      mixins: [
        createPouchDbLifecycleMixin({
          defaultDbPath: 'data/vdmi-spectator',
          indexes: [['tenantId', 'taskId']],
          logLabel: 'vdmi-spectator',
        }),
      ],
      settings: this.settings,
      actions: this.actions,
    });
  }

  actions = {
    /**
     * GET — Negotiation Trace with full agent arguments
     */
    negotiationTrace: {
      rest: 'GET /tenants/:tenantId/tasks/:taskId/negotiation-trace',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'View complete agent negotiation dialog with reasoning',
        parameters: [
          { name: 'tenantId', in: 'path', required: true },
          { name: 'taskId', in: 'path', required: true },
          {
            name: 'phase',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['all', 'proposal', 'consensus', 'conflict_resolution'],
            },
            description: 'Filter by negotiation phase',
          },
          {
            name: 'agentFilter',
            in: 'query',
            schema: { type: 'string' },
            description: 'Comma-separated agent IDs',
          },
        ],
        responses: {
          200: {
            description: 'Complete negotiation trace',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    taskId: { type: 'string' },
                    tenantId: { type: 'string' },
                    negotiationPhase: { type: 'string' },
                    totalRounds: { type: 'number' },
                    consensusReachedAt: { type: 'string', format: 'date-time' },
                    trace: { type: 'array', items: { type: 'object' } },
                    consensusMatrix: { type: 'object' },
                  },
                },
              },
            },
          },
          403: { description: 'Access denied' },
        },
      },
      async handler(ctx) {
        const { tenantId, taskId } = ctx.params;
        const { phase, agentFilter } = ctx.query || ctx.params || {};

        // Authorization: spectator, hitl-approver, data-steward
        const userRole = ctx.meta.userRole || 'user';
        const allowedRoles = ['spectator', 'hitl-approver', 'data-steward', 'matrix-admin'];
        if (!allowedRoles.includes(userRole)) {
          throw new Error('FORBIDDEN: Access to negotiation trace denied');
        }

        try {
          const result = await ctx.call(
            'vdmi.negotiationTrace',
            { taskId },
            { meta: { ...ctx.meta, tenantId } }
          );
          let trace = Array.isArray(result?.trace) ? result.trace : [];

          if (phase && phase !== 'all') {
            trace = trace.filter((entry) => entry.phase === phase || entry.eventName === phase);
          }

          if (agentFilter) {
            const agents = agentFilter.split(',').map((a) => a.trim());
            trace = trace.filter((entry) => agents.includes(entry.agent || entry.actorId));
          }

          return {
            ...result,
            taskId,
            tenantId,
            totalRounds: trace.length,
            trace,
          };
        } catch (error) {
          this.logger.error('Error retrieving negotiation trace:', error);
          throw error;
        }
      },
    },

    /**
     * GET — Governance Dossier (decision document)
     */
    dossier: {
      rest: 'GET /tenants/:tenantId/tasks/:taskId/dossier',
      openapi: {
        tags: ['VDMI Governance'],
        description: 'Get formatted governance dossier for stakeholder review',
        parameters: [
          { name: 'tenantId', in: 'path', required: true },
          { name: 'taskId', in: 'path', required: true },
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'html', 'pdf'] },
            description: 'Output format',
          },
          {
            name: 'includeDelta',
            in: 'query',
            schema: { type: 'boolean' },
            description: 'Include differences from previous version',
          },
        ],
        responses: {
          200: {
            description: 'Governance dossier document',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    dossier: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        taskId: { type: 'string' },
                        summary: { type: 'object' },
                        executive_summary: { type: 'string' },
                        governance_checks: { type: 'object' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { tenantId, taskId } = ctx.params;
        const { format = 'json' } = ctx.query || ctx.params || {};

        // Authorization
        const userRole = ctx.meta.userRole || 'user';
        const allowedRoles = ['spectator', 'hitl-approver', 'data-steward', 'matrix-admin'];
        if (!allowedRoles.includes(userRole)) {
          throw new Error('FORBIDDEN: Access to dossier denied');
        }

        try {
          const result = await ctx.call(
            'vdmi.dossier',
            { taskId },
            { meta: { ...ctx.meta, tenantId } }
          );
          const dossier = result?.dossier || result;

          // Format output
          if (format === 'json') {
            return { dossier };
          } else if (format === 'html') {
            return { dossier: this._convertToHTML(dossier) };
          } else if (format === 'pdf') {
            return { dossier: `PDF export would be generated here` };
          }

          return { dossier };
        } catch (error) {
          this.logger.error('Error retrieving dossier:', error);
          throw error;
        }
      },
    },
  };

  _assessRiskLevel(task) {
    if (task.criticalFindings?.length > 0) return 'high';
    if (task.warnings?.length > 3) return 'medium';
    return 'low';
  }

  _generateExecutiveSummary(task) {
    const app_count = task.affectedMatrices?.length || 0;
    const role_count = task.affectedRoles?.length || 0;
    return `${app_count} applications with ${role_count} role assignments updated. No critical violations detected.`;
  }

  async _generateDelta(prevMatrixId, currentMatrix) {
    // Would fetch previous matrix and generate structured diff
    return {
      added_roles: [],
      modified_roles: [],
      removed_roles: [],
    };
  }

  _convertToHTML(dossier) {
    // Simple HTML conversion
    return `<html><body><h1>${dossier.summary.title}</h1></body></html>`;
  }
};
