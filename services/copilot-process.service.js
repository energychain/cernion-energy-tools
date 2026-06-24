'use strict';

/**
 * Copilot Process Service
 *
 * Provides MS365 Copilot-compatible process actions for VDMI, ZNP, and
 * grid connection workflows. Strictly separates read-only, draft/propose,
 * and consequential-execute tiers.
 *
 * Phase 2: read-only + draft/propose only. No writes, no bulk actions.
 * Phase 3: intent-based preparation and execution lifecycle.
 */

const { MoleculerClientError } = require('moleculer').Errors;
const { randomUUID } = require('crypto');
const { getRule } = require('../src/dossier-hydration-registry');

const SERVICE_TAG = 'Copilot Process';

// operationFamily values with their own dedicated, validated prepare* action
// above (prepareVdmiEvidence, prepareZnpAssumption, prepareGridConnectionValidation,
// prepareConnectionRejectionEvidence) and a real case in _executeIntent's
// dispatch table. The generic prepareProcessIntent (issue #272) refuses these —
// accepting them here would let a caller bypass that action's own validation.
const RESERVED_PROCESS_OPERATION_FAMILIES = new Set([
  'vdmi',
  'gridConnection',
  'znp',
  'connectionRejectionEvidence',
]);

function buildAudit(ctx, correlationId) {
  return {
    requestedAt: new Date().toISOString(),
    requestedBy: ctx.meta?.userId || ctx.meta?.actorId || 'copilot-agent',
    correlationId: correlationId || randomUUID(),
  };
}

function openTasksOf(matrix) {
  return (matrix.tasks || []).filter(
    (t) => t.status !== 'done' && t.status !== 'closed' && t.status !== 'completed'
  );
}

// ── ProcessIntentStore ─────────────────────────────────────────────────────────
// In-memory store for process execution intents. Each service instance (broker)
// gets its own store — this gives test isolation and avoids external dependencies.

const INTENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours default

class ProcessIntentStore {
  constructor(ttlMs = INTENT_TTL_MS) {
    this._store = new Map();
    this._ttlMs = ttlMs;
  }

  create({
    operationFamily,
    proposedAction,
    targetType,
    targetId,
    inputSummary,
    payload,
    risk,
    createdBy,
    correlationId,
    reason,
    decisionFrameId,
  }) {
    const now = new Date();
    const intent = {
      intentId: randomUUID(),
      operationFamily,
      proposedAction,
      targetType: targetType || null,
      targetId: targetId || null,
      inputSummary: inputSummary || '',
      payload: payload || {},
      risk: risk || 'medium',
      requiresHumanConfirmation: true,
      createdBy: createdBy || 'unknown',
      decisionFrameId: decisionFrameId || null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this._ttlMs).toISOString(),
      status: 'pending_confirmation',
      auditTrail: [
        {
          timestamp: now.toISOString(),
          actor: createdBy || 'unknown',
          action: 'prepared',
          reason: reason || null,
          correlationId: correlationId || null,
        },
      ],
    };
    this._store.set(intent.intentId, intent);
    return intent;
  }

  get(intentId) {
    const intent = this._store.get(intentId);
    if (!intent) return null;
    this._checkExpiry(intent);
    return intent;
  }

  list({ operationFamily, status, createdBy, decisionFrameId, limit = 20 } = {}) {
    const all = [...this._store.values()];
    all.forEach((i) => this._checkExpiry(i));
    return all
      .filter((i) => !operationFamily || i.operationFamily === operationFamily)
      .filter((i) => !status || i.status === status)
      .filter((i) => !createdBy || i.createdBy === createdBy)
      .filter((i) => !decisionFrameId || i.decisionFrameId === decisionFrameId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.min(limit, 100));
  }

  transition(intentId, newStatus, actor, reason, extra = {}) {
    const intent = this._store.get(intentId);
    if (!intent) return null;
    intent.status = newStatus;
    intent.auditTrail.push({
      timestamp: new Date().toISOString(),
      actor: actor || 'system',
      action: newStatus,
      reason: reason || null,
      ...extra,
    });
    return intent;
  }

  _checkExpiry(intent) {
    if (intent.status === 'pending_confirmation' && new Date(intent.expiresAt) < new Date()) {
      intent.status = 'expired';
      intent.auditTrail.push({
        timestamp: new Date().toISOString(),
        actor: 'system',
        action: 'expired',
        reason: 'Intent TTL exceeded',
      });
    }
  }
}

module.exports = {
  name: 'copilot-process',

  created() {
    this.intentStore = new ProcessIntentStore();
  },

  actions: {
    // ── READ-ONLY ────────────────────────────────────────────────────────────

    /**
     * Load full VDMI matrix context: status, tasks, nomination, evidence.
     * operationId: getVdmiContext
     */
    getVdmiContext: {
      rest: 'GET /vdmi/:matrixId/context',
      params: {
        matrixId: { type: 'string', min: 2 },
      },
      openapi: {
        operationId: 'getVdmiContext',
        'x-openai-isConsequential': false,
        summary: 'Load VDMI matrix context (read-only)',
        description: `Returns full VDMI matrix context for Copilot: status, open tasks, nomination state, evidence count, and regulatory basis.

**When to use**: Before proposing any VDMI process action, load context to understand current state.
**Read-only**: No state is changed.`,
        tags: [SERVICE_TAG],
        parameters: [
          {
            name: 'matrixId',
            in: 'path',
            required: true,
            description: 'VDMI matrix instance ID',
            schema: { type: 'string', example: 'vdmi-abc123' },
          },
        ],
        responses: {
          200: {
            description: 'VDMI matrix context',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['matrixId', 'name', 'status', 'openTaskCount', 'summary'],
                  properties: {
                    matrixId: { type: 'string' },
                    name: { type: 'string' },
                    status: { type: 'string', example: 'active' },
                    processType: { type: 'string', nullable: true },
                    nominationStatus: { type: 'string', nullable: true },
                    openTaskCount: { type: 'integer', example: 2 },
                    totalTaskCount: { type: 'integer', example: 5 },
                    evidenceCount: { type: 'integer', example: 1 },
                    findingCount: { type: 'integer', example: 0 },
                    scope: { type: 'string', nullable: true },
                    regulatoryBasis: { type: 'array', items: { type: 'string' } },
                    createdAt: { type: 'string', nullable: true },
                    summary: { type: 'string', description: 'Human-readable status summary' },
                    detailUrl: { type: 'string', example: '/api/vdmi/vdmi-abc123' },
                  },
                },
              },
            },
          },
          404: { description: 'Matrix not found' },
        },
      },
      async handler(ctx) {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const { matrix } = await ctx.call('vdmi.get', { id: ctx.params.matrixId }, callOpts);
        const open = openTasksOf(matrix);
        const parts = [];
        if (matrix.scope) parts.push(matrix.scope);
        if (matrix.processType) parts.push(`Prozesstyp: ${matrix.processType}`);
        parts.push(`Status: ${matrix.status}`);
        if (open.length) parts.push(`${open.length} offene Aufgabe(n)`);
        if (matrix.nominationStatus && matrix.nominationStatus !== 'none') {
          parts.push(`Nominierung: ${matrix.nominationStatus}`);
        }
        return {
          matrixId: matrix.id,
          name: matrix.name,
          status: matrix.status,
          processType: matrix.processType ?? null,
          nominationStatus: matrix.nominationStatus ?? null,
          openTaskCount: open.length,
          totalTaskCount: matrix.tasks?.length ?? 0,
          evidenceCount: matrix.evidenceCount ?? 0,
          findingCount: matrix.findingCount ?? 0,
          scope: matrix.scope ?? null,
          regulatoryBasis: matrix.regulatoryBasis ?? [],
          createdAt: matrix.createdAt ?? null,
          summary: parts.join(' · '),
          detailUrl: `/api/vdmi/${matrix.id}`,
        };
      },
    },

    /**
     * List open VDMI responsibilities: matrices where the caller or a named
     * user has Verantwortlich (V) tasks still open.
     * operationId: listOpenResponsibilities
     */
    listOpenResponsibilities: {
      rest: 'GET /vdmi/responsibilities',
      params: {
        userId: { type: 'string', optional: true },
        processType: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 50, convert: true },
      },
      openapi: {
        operationId: 'listOpenResponsibilities',
        'x-openai-isConsequential': false,
        summary: 'List open VDMI responsibilities (read-only)',
        description: `Returns VDMI matrices where the specified user (or authenticated caller) holds open Verantwortlich tasks.

If \`userId\` is not supplied, falls back to listing all active matrices with at least one open task.
**Read-only**: No state is changed.`,
        tags: [SERVICE_TAG],
        parameters: [
          {
            name: 'userId',
            in: 'query',
            required: false,
            description:
              'Actor ID to filter responsibilities for (defaults to authenticated caller)',
            schema: { type: 'string', example: 'grid_operator' },
          },
          {
            name: 'processType',
            in: 'query',
            required: false,
            description: 'Filter by process type',
            schema: { type: 'string', example: 'adhoc' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        ],
        responses: {
          200: {
            description: 'Open responsibilities',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['count', 'responsibilities'],
                  properties: {
                    count: { type: 'integer' },
                    responsibilities: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          matrixId: { type: 'string' },
                          name: { type: 'string' },
                          status: { type: 'string' },
                          openTaskCount: { type: 'integer' },
                          nominationStatus: { type: 'string', nullable: true },
                          detailUrl: { type: 'string' },
                        },
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
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const userId = ctx.params.userId || ctx.meta?.userId;
        const { limit } = ctx.params;

        let items;
        if (userId) {
          const resp = await ctx.call('vdmi.myResponsibilities', { userId }, callOpts);
          items = resp.items || [];
        } else {
          const resp = await ctx.call(
            'vdmi.list',
            {
              status: 'active',
              limit,
              ...(ctx.params.processType ? { processType: ctx.params.processType } : {}),
            },
            callOpts
          );
          items = resp.items || [];
        }

        if (ctx.params.processType && !userId) {
          items = items.filter((m) => m.processType === ctx.params.processType);
        }

        const responsibilities = items
          .map((m) => {
            const open = openTasksOf(m);
            return {
              matrixId: m.id,
              name: m.name,
              status: m.status,
              openTaskCount: open.length,
              nominationStatus: m.nominationStatus ?? null,
              detailUrl: `/api/vdmi/${m.id}`,
            };
          })
          .filter((r) => r.openTaskCount > 0)
          .slice(0, limit);

        return { count: responsibilities.length, responsibilities };
      },
    },

    /**
     * Get ZNP project metadata and graph statistics.
     * operationId: getZnpProjectStatus
     */
    getZnpProjectStatus: {
      rest: 'GET /znp/:projectId/status',
      params: {
        projectId: { type: 'string', min: 2 },
      },
      openapi: {
        operationId: 'getZnpProjectStatus',
        'x-openai-isConsequential': false,
        summary: 'Get ZNP project status and graph statistics (read-only)',
        description: `Returns ZNP project metadata: name, loaded layers, node/edge counts, bounding box, and creation timestamp.

**Read-only**: No state is changed.`,
        tags: [SERVICE_TAG],
        parameters: [
          {
            name: 'projectId',
            in: 'path',
            required: true,
            description: 'ZNP project UUID',
            schema: { type: 'string', example: 'a1b2c3d4-0000-0000-0000-000000000001' },
          },
        ],
        responses: {
          200: {
            description: 'ZNP project status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['projectId', 'name', 'layers', 'graphStats'],
                  properties: {
                    projectId: { type: 'string' },
                    name: { type: 'string' },
                    layers: { type: 'array', items: { type: 'string' } },
                    graphStats: {
                      type: 'object',
                      properties: {
                        nodes: { type: 'integer' },
                        edges: { type: 'integer' },
                      },
                    },
                    createdAt: { type: 'string', nullable: true },
                    summary: { type: 'string' },
                    detailUrl: { type: 'string' },
                  },
                },
              },
            },
          },
          404: { description: 'Project not found' },
        },
      },
      async handler(ctx) {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const project = await ctx.call(
          'znp.getProjectMeta',
          { projectId: ctx.params.projectId },
          callOpts
        );
        const { nodes, edges } = project.graphStats || {};
        const layerList = Array.isArray(project.layers) ? project.layers.join(', ') : '–';
        return {
          projectId: project.projectId,
          name: project.name ?? project.projectId,
          layers: project.layers ?? [],
          graphStats: { nodes: nodes ?? 0, edges: edges ?? 0 },
          createdAt: project.createdAt ?? null,
          summary: `${project.name ?? project.projectId} · Schichten: ${layerList} · ${nodes ?? 0} Knoten, ${edges ?? 0} Kanten`,
          detailUrl: `/api/znp/projects/${project.projectId}`,
        };
      },
    },

    /**
     * Retrieve a grid connection validation report by ID.
     * operationId: getGridConnectionValidation
     */
    getGridConnectionValidation: {
      rest: 'GET /grid-connection/:validationId',
      params: {
        validationId: { type: 'string', min: 2 },
      },
      openapi: {
        operationId: 'getGridConnectionValidation',
        'x-openai-isConsequential': false,
        summary: 'Get grid connection validation report (read-only)',
        description: `Returns a specific grid connection validation report including decision, findings, and grid operator details.

**Read-only**: No state is changed.`,
        tags: [SERVICE_TAG],
        parameters: [
          {
            name: 'validationId',
            in: 'path',
            required: true,
            description: 'Validation report UUID',
            schema: { type: 'string', example: 'a1b2c3d4-1234-5678-90ab-cdef12345678' },
          },
        ],
        responses: {
          200: {
            description: 'Validation report summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['validationId', 'decision', 'gridOperatorName', 'summary'],
                  properties: {
                    validationId: { type: 'string' },
                    decision: { type: 'string', nullable: true },
                    gridOperatorName: { type: 'string' },
                    gridOperatorId: { type: 'string', nullable: true },
                    findingsCount: { type: 'integer' },
                    createdAt: { type: 'string', nullable: true },
                    summary: { type: 'string' },
                    detailUrl: { type: 'string' },
                  },
                },
              },
            },
          },
          404: { description: 'Validation not found' },
        },
      },
      async handler(ctx) {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const report = await ctx.call(
          'grid-connection.get',
          { id: ctx.params.validationId },
          callOpts
        );
        if (report.success === false) {
          ctx.meta.$statusCode = 404;
          throw new MoleculerClientError(
            `Validation ${ctx.params.validationId} not found`,
            404,
            'NOT_FOUND'
          );
        }
        const operatorName =
          report.gridOperator?.name ?? report.gridOperator?.mastrId ?? 'Unbekannter Netzbetreiber';
        const findings = Array.isArray(report.findings)
          ? report.findings.length
          : (report.findingsCount ?? 0);
        return {
          validationId: ctx.params.validationId,
          decision: report.decision ?? null,
          gridOperatorName: operatorName,
          gridOperatorId: report.gridOperator?.mastrId ?? null,
          findingsCount: findings,
          createdAt: report.createdAt ?? null,
          summary: `Entscheidung: ${report.decision ?? '–'} · ${operatorName} · ${findings} Befund(e)`,
          detailUrl: `/api/grid-connection/validations/${ctx.params.validationId}`,
        };
      },
    },

    // ── DRAFT / PROPOSE ──────────────────────────────────────────────────────

    /**
     * Prepare a VDMI matrix nomination — returns a draft proposal, no write.
     * operationId: prepareVdmiValidation
     */
    prepareVdmiValidation: {
      rest: 'POST /vdmi/:matrixId/prepare-validation',
      params: {
        matrixId: { type: 'string', min: 2 },
        reason: { type: 'string', min: 1, max: 500 },
        correlationId: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'prepareVdmiValidation',
        'x-openai-isConsequential': false,
        summary: 'Prepare VDMI matrix nomination — draft only, no write',
        description: `Analyses the VDMI matrix and returns a draft nomination proposal.
**No writes**: This action creates no persisted state. The returned draft must be explicitly confirmed by a consequential execute action (Phase 3).

Set \`requiredConfirmation: true\` in the response means Copilot must ask the user to confirm before proceeding.`,
        tags: [SERVICE_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['matrixId', 'reason'],
                properties: {
                  matrixId: {
                    type: 'string',
                    description: 'VDMI matrix ID',
                    example: 'vdmi-abc123',
                  },
                  reason: {
                    type: 'string',
                    description: 'Business reason for the nomination',
                    example: 'Netzanschluss fristgerecht abgeschlossen',
                    minLength: 1,
                    maxLength: 500,
                  },
                  correlationId: {
                    type: 'string',
                    description: 'Caller-supplied trace ID for audit logging',
                    example: 'req-2026-001',
                  },
                  idempotencyKey: {
                    type: 'string',
                    description: 'Prevents duplicate submissions on retries',
                    example: 'idem-abc123-20260611',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Draft nomination proposal',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'draftId',
                    'action',
                    'target',
                    'summary',
                    'requiredConfirmation',
                    'auditTrail',
                  ],
                  properties: {
                    draftId: { type: 'string', description: 'Unique ID of this draft' },
                    action: { type: 'string', example: 'nominate_vdmi_matrix' },
                    target: {
                      type: 'object',
                      properties: {
                        matrixId: { type: 'string' },
                        matrixName: { type: 'string' },
                        currentStatus: { type: 'string' },
                      },
                    },
                    proposedChange: {
                      type: 'object',
                      properties: {
                        from: { type: 'string' },
                        to: { type: 'string' },
                        nominationStatus: { type: 'string' },
                      },
                    },
                    warningIfAny: { type: 'string', nullable: true },
                    summary: { type: 'string' },
                    confirmationMessage: { type: 'string' },
                    requiredConfirmation: { type: 'boolean', example: true },
                    readyToExecute: { type: 'boolean' },
                    consequentialAction: {
                      type: 'object',
                      description: 'The Phase 3 execute action that would perform this change',
                      properties: {
                        operationId: { type: 'string', example: 'executeVdmiNomination' },
                        note: { type: 'string' },
                      },
                    },
                    auditTrail: {
                      type: 'object',
                      properties: {
                        requestedAt: { type: 'string' },
                        requestedBy: { type: 'string' },
                        correlationId: { type: 'string' },
                        idempotencyKey: { type: 'string', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Matrix not found' },
          422: { description: 'Matrix status does not allow nomination' },
        },
      },
      async handler(ctx) {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const audit = buildAudit(ctx, ctx.params.correlationId);

        const { matrix } = await ctx.call('vdmi.get', { id: ctx.params.matrixId }, callOpts);
        const open = openTasksOf(matrix);
        const nominationAllowed = ['draft', 'active'].includes(matrix.status);

        if (!nominationAllowed) {
          throw new MoleculerClientError(
            `Matrix status '${matrix.status}' does not allow nomination`,
            422,
            'INVALID_STATUS_TRANSITION'
          );
        }

        const warning =
          open.length > 0
            ? `${open.length} offene Aufgabe(n) — Nominierung trotzdem möglich, aber unvollständige Evidenz erhöht Ablehnungsrisiko.`
            : null;

        return {
          draftId: randomUUID(),
          action: 'nominate_vdmi_matrix',
          target: {
            matrixId: matrix.id,
            matrixName: matrix.name,
            currentStatus: matrix.status,
          },
          proposedChange: {
            from: matrix.nominationStatus ?? 'none',
            to: 'pending',
            nominationStatus: 'pending',
          },
          warningIfAny: warning,
          summary: `Nominierungsentwurf für '${matrix.name}': Status ${matrix.status} → nominiert. Begründung: ${ctx.params.reason}`,
          confirmationMessage: `Bitte bestätige die Nominierung der VDMI-Matrix '${matrix.name}' (ID: ${matrix.id}).${warning ? ` Hinweis: ${warning}` : ''}`,
          requiredConfirmation: true,
          readyToExecute: open.length === 0,
          consequentialAction: {
            operationId: 'executeVdmiNomination',
            note: 'Noch nicht implementiert (Phase 3). Direkt: POST /api/vdmi/:id/nominate',
          },
          auditTrail: {
            ...audit,
            idempotencyKey: ctx.params.idempotencyKey ?? null,
            reason: ctx.params.reason,
          },
        };
      },
    },

    /**
     * Draft evidence suggestions for a VDMI matrix — no write.
     * operationId: draftVdmiEvidence
     */
    draftVdmiEvidence: {
      rest: 'POST /vdmi/:matrixId/draft-evidence',
      params: {
        matrixId: { type: 'string', min: 2 },
        correlationId: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'draftVdmiEvidence',
        'x-openai-isConsequential': false,
        summary: 'Draft evidence suggestions for VDMI matrix tasks — no write',
        description: `Analyses open VDMI tasks and returns structured evidence suggestions for each.
**No writes**: This returns suggestions only. No evidence is added to the matrix.
Use \`POST /api/vdmi/:id/evidence\` (Phase 3) to actually inject evidence.`,
        tags: [SERVICE_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['matrixId'],
                properties: {
                  matrixId: { type: 'string', example: 'vdmi-abc123' },
                  correlationId: { type: 'string', example: 'req-2026-001' },
                  idempotencyKey: { type: 'string', example: 'idem-abc123-20260611' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Evidence draft with per-task suggestions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'draftId',
                    'action',
                    'target',
                    'evidenceSuggestions',
                    'summary',
                    'auditTrail',
                  ],
                  properties: {
                    draftId: { type: 'string' },
                    action: { type: 'string', example: 'draft_evidence_for_vdmi' },
                    target: {
                      type: 'object',
                      properties: {
                        matrixId: { type: 'string' },
                        matrixName: { type: 'string' },
                      },
                    },
                    evidenceSuggestions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          taskIndex: { type: 'integer' },
                          taskLabel: { type: 'string' },
                          suggestedEvidenceType: { type: 'string' },
                          suggestion: { type: 'string' },
                        },
                      },
                    },
                    openTaskCount: { type: 'integer' },
                    summary: { type: 'string' },
                    requiredConfirmation: { type: 'boolean', example: false },
                    auditTrail: { type: 'object' },
                  },
                },
              },
            },
          },
          404: { description: 'Matrix not found' },
        },
      },
      async handler(ctx) {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const audit = buildAudit(ctx, ctx.params.correlationId);

        const { matrix } = await ctx.call('vdmi.get', { id: ctx.params.matrixId }, callOpts);
        const open = openTasksOf(matrix);

        const evidenceSuggestions = open.map((task, i) => {
          const label = task.label || task.name || task.description || `Aufgabe ${i + 1}`;
          const evidenceType = task.evidenceType || 'document';
          let suggestion = 'Nachweis-Dokument oder Protokoll einreichen.';
          if (evidenceType === 'signature') {
            suggestion = 'Digitale Signatur des Verantwortlichen erforderlich.';
          } else if (evidenceType === 'report') {
            suggestion = 'Prüfbericht oder technisches Gutachten hochladen.';
          } else if (/netzanschluss|anschluss/i.test(label)) {
            suggestion = 'Netzanschlussvertrag oder technisches Anschlussdokument einreichen.';
          } else if (/messung|messen|zähl/i.test(label)) {
            suggestion = 'Messprotokoll oder Zählerstandsbericht einreichen.';
          }
          return {
            taskIndex: i,
            taskLabel: label,
            suggestedEvidenceType: evidenceType,
            suggestion,
          };
        });

        return {
          draftId: randomUUID(),
          action: 'draft_evidence_for_vdmi',
          target: { matrixId: matrix.id, matrixName: matrix.name },
          evidenceSuggestions,
          openTaskCount: open.length,
          summary:
            open.length === 0
              ? `Alle Aufgaben der Matrix '${matrix.name}' sind abgeschlossen. Kein Evidenz-Entwurf nötig.`
              : `Evidenz-Entwurf für '${matrix.name}': ${open.length} offene Aufgabe(n) ohne Nachweis.`,
          requiredConfirmation: false,
          auditTrail: {
            ...audit,
            idempotencyKey: ctx.params.idempotencyKey ?? null,
          },
        };
      },
    },

    /**
     * Prepare a grid connection validation run — returns draft config, no write.
     * operationId: prepareGridConnectionValidation
     */
    prepareGridConnectionValidation: {
      rest: 'POST /grid-connection/prepare-validation',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        gridOperatorBdew: { type: 'string', optional: true },
        gridOperatorName: { type: 'string', optional: true },
        reason: { type: 'string', min: 1, max: 500 },
        includeCapacityCheck: { type: 'boolean', optional: true, default: false, convert: true },
        correlationId: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'prepareGridConnectionValidation',
        'x-openai-isConsequential': false,
        summary: 'Prepare grid connection validation config — draft only, no write',
        description: `Validates the input parameters and returns a draft validation configuration.
**No writes**: This action has no side effects. The returned proposal must be confirmed before the actual 6-step pipeline is started.
At least one of \`gridOperatorId\`, \`gridOperatorBdew\`, or \`gridOperatorName\` is required.

The consequential execute action (\`POST /api/grid-connection/validate\`) is Phase 3.`,
        tags: [SERVICE_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  gridOperatorId: { type: 'string', example: 'SNB935578300972' },
                  gridOperatorBdew: { type: 'string', example: '9907473000008' },
                  gridOperatorName: { type: 'string', example: 'STROMDAO Netze' },
                  reason: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 500,
                    example: 'Jahresprüfung Q2 2026',
                  },
                  includeCapacityCheck: { type: 'boolean', default: false },
                  correlationId: { type: 'string', example: 'req-2026-001' },
                  idempotencyKey: { type: 'string', example: 'idem-stromdao-20260611' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Grid connection validation draft proposal',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'draftId',
                    'action',
                    'target',
                    'proposedValidation',
                    'summary',
                    'requiredConfirmation',
                    'auditTrail',
                  ],
                  properties: {
                    draftId: { type: 'string' },
                    action: { type: 'string', example: 'run_grid_connection_validation' },
                    target: {
                      type: 'object',
                      properties: {
                        gridOperatorId: { type: 'string', nullable: true },
                        gridOperatorBdew: { type: 'string', nullable: true },
                        gridOperatorName: { type: 'string', nullable: true },
                      },
                    },
                    proposedValidation: {
                      type: 'object',
                      description:
                        'Parameters that would be passed to the consequential execute action',
                    },
                    summary: { type: 'string' },
                    confirmationMessage: { type: 'string' },
                    requiredConfirmation: { type: 'boolean', example: true },
                    consequentialAction: { type: 'object' },
                    auditTrail: { type: 'object' },
                  },
                },
              },
            },
          },
          400: { description: 'No grid operator identifier supplied' },
        },
      },
      async handler(ctx) {
        const { gridOperatorId, gridOperatorBdew, gridOperatorName, reason, includeCapacityCheck } =
          ctx.params;
        const audit = buildAudit(ctx, ctx.params.correlationId);

        if (!gridOperatorId && !gridOperatorBdew && !gridOperatorName) {
          throw new MoleculerClientError(
            'At least one of gridOperatorId, gridOperatorBdew, or gridOperatorName is required',
            400,
            'MISSING_GRID_OPERATOR'
          );
        }

        const operatorLabel = gridOperatorName || gridOperatorBdew || gridOperatorId;
        const proposedValidation = {
          ...(gridOperatorId ? { gridOperatorId } : {}),
          ...(gridOperatorBdew ? { gridOperatorBdew } : {}),
          ...(gridOperatorName ? { gridOperatorName } : {}),
          includeCapacityCheck: Boolean(includeCapacityCheck),
          datapointTags: [],
        };

        const intent = this.intentStore.create({
          operationFamily: 'gridConnection',
          proposedAction: 'run_grid_connection_validation',
          targetType: 'gridOperator',
          targetId: gridOperatorId || gridOperatorBdew || gridOperatorName,
          inputSummary: `Run grid connection validation for operator '${operatorLabel}'`,
          payload: proposedValidation,
          risk: 'medium',
          createdBy: audit.requestedBy,
          correlationId: audit.correlationId,
          reason,
        });

        return {
          intentId: intent.intentId,
          draftId: randomUUID(),
          action: 'run_grid_connection_validation',
          target: {
            gridOperatorId: gridOperatorId ?? null,
            gridOperatorBdew: gridOperatorBdew ?? null,
            gridOperatorName: gridOperatorName ?? null,
          },
          proposedValidation,
          summary: `Netzanschluss-Validierung für '${operatorLabel}' vorbereitet. Kapazitätsprüfung: ${includeCapacityCheck ? 'ja' : 'nein'}. Begründung: ${reason}`,
          confirmationMessage: `Bitte bestätige die Ausführung der Netzanschluss-Validierungs-Pipeline für '${operatorLabel}'. Diese Aktion dauert bis zu 2 Minuten und schreibt einen persistenten Validierungsbericht.`,
          requiredConfirmation: true,
          consequentialAction: {
            operationId: 'executeProcessIntent',
            endpoint: 'POST /api/copilot-process/intents/:intentId/execute',
            note: 'Use executeProcessIntent with intentId to run after human confirmation',
          },
          auditTrail: {
            ...audit,
            reason,
            idempotencyKey: ctx.params.idempotencyKey ?? null,
          },
        };
      },
    },

    // ── PHASE 3: INTENT-BASED PREPARE + EXECUTE ──────────────────────────────

    /**
     * Prepare a VDMI evidence injection intent — no write.
     * operationId: prepareVdmiEvidence
     */
    prepareVdmiEvidence: {
      rest: 'POST /vdmi/:matrixId/intents/evidence',
      params: {
        matrixId: { type: 'string', min: 2 },
        evidenceType: { type: 'string', min: 2 },
        reference: { type: 'string', min: 2 },
        reason: { type: 'string', min: 1, max: 500 },
        content: { type: 'object', optional: true, default: {} },
        correlationId: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
        decisionFrameId: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'prepareVdmiEvidence',
        'x-openai-isConsequential': false,
        summary: 'Prepare VDMI evidence injection intent — no write',
        description: `Verifies the VDMI matrix exists and creates a persistent ProcessExecutionIntent for evidence injection. No evidence is written.
Returns intentId, expiresAt, and confirmationMessage. Execute via executeProcessIntent outside Copilot.`,
        tags: [SERVICE_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['matrixId', 'evidenceType', 'reference', 'reason'],
                properties: {
                  matrixId: { type: 'string', example: 'vdmi-abc123' },
                  evidenceType: { type: 'string', minLength: 2, example: 'aktenvermerk' },
                  reference: { type: 'string', minLength: 2, example: 'REF-2026-001' },
                  reason: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 500,
                    example: 'Jahresprüfung abgeschlossen',
                  },
                  content: { type: 'object', description: 'Optional additional content payload' },
                  correlationId: { type: 'string', example: 'req-2026-001' },
                  idempotencyKey: { type: 'string', example: 'idem-vdmi-20260611' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'VDMI evidence intent created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'intentId',
                    'operationFamily',
                    'proposedAction',
                    'status',
                    'requiresHumanConfirmation',
                  ],
                  properties: {
                    intentId: { type: 'string' },
                    operationFamily: { type: 'string', example: 'vdmi' },
                    proposedAction: { type: 'string', example: 'inject_evidence' },
                    target: { type: 'object' },
                    inputSummary: { type: 'string' },
                    status: { type: 'string', example: 'pending_confirmation' },
                    expiresAt: { type: 'string' },
                    risk: { type: 'string', example: 'medium' },
                    requiresHumanConfirmation: { type: 'boolean', example: true },
                    summary: { type: 'string' },
                    confirmationMessage: { type: 'string' },
                    executeVia: { type: 'object' },
                    auditTrail: { type: 'object' },
                  },
                },
              },
            },
          },
          404: { description: 'Matrix not found' },
        },
      },
      async handler(ctx) {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const { matrixId, evidenceType, reference, reason, content } = ctx.params;
        const audit = buildAudit(ctx, ctx.params.correlationId);

        const { matrix } = await ctx.call('vdmi.get', { id: matrixId }, callOpts);

        const inputSummary = `Inject ${evidenceType} evidence for matrix '${matrix.name}' (${matrixId})`;
        const intent = this.intentStore.create({
          operationFamily: 'vdmi',
          proposedAction: 'inject_evidence',
          targetType: 'vdmiMatrix',
          targetId: matrixId,
          inputSummary,
          payload: { id: matrixId, type: evidenceType, reference, reason, content: content || {} },
          risk: 'medium',
          createdBy: audit.requestedBy,
          correlationId: audit.correlationId,
          reason,
          decisionFrameId: ctx.params.decisionFrameId || null,
        });

        return {
          intentId: intent.intentId,
          operationFamily: 'vdmi',
          proposedAction: 'inject_evidence',
          target: { matrixId, matrixName: matrix.name },
          inputSummary: intent.inputSummary,
          status: intent.status,
          expiresAt: intent.expiresAt,
          risk: 'medium',
          requiresHumanConfirmation: true,
          decisionFrameId: intent.decisionFrameId,
          summary: `Evidenz-Intent erstellt für '${matrix.name}': Typ '${evidenceType}', Referenz '${reference}'. Menschliche Bestätigung erforderlich.`,
          confirmationMessage: `Bitte bestätige die Evidenz-Einbuchung in VDMI-Matrix '${matrix.name}' (${matrixId}). Typ: ${evidenceType}, Referenz: ${reference}.`,
          executeVia: {
            operationId: 'executeProcessIntent',
            note: 'Not available via Copilot. Use direct API: POST /api/copilot-process/intents/:intentId/execute',
          },
          auditTrail: { ...audit, idempotencyKey: ctx.params.idempotencyKey ?? null, reason },
        };
      },
    },

    /**
     * Prepare a ZNP planning assumption intent — no write.
     * operationId: prepareZnpAssumption
     */
    prepareZnpAssumption: {
      rest: 'POST /znp/:projectId/intents/assumption',
      params: {
        projectId: { type: 'string', min: 2 },
        text: { type: 'string', min: 10, max: 2000 },
        reason: { type: 'string', min: 1, max: 500 },
        correlationId: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
        decisionFrameId: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'prepareZnpAssumption',
        'x-openai-isConsequential': false,
        summary: 'Prepare ZNP planning assumption intent — no write',
        description: `Verifies the ZNP project exists and creates a persistent ProcessExecutionIntent for adding a planning assumption. No write occurs.
Returns intentId, expiresAt, and confirmationMessage. Execute via executeProcessIntent outside Copilot.`,
        tags: [SERVICE_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['projectId', 'text', 'reason'],
                properties: {
                  projectId: { type: 'string', example: 'znp-proj-001' },
                  text: {
                    type: 'string',
                    minLength: 10,
                    maxLength: 2000,
                    example: 'Annahme: Netzkapazität ausreichend für Q3 2026',
                  },
                  reason: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 500,
                    example: 'Planungsstand Q2 2026',
                  },
                  correlationId: { type: 'string', example: 'req-2026-001' },
                  idempotencyKey: { type: 'string', example: 'idem-znp-20260611' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'ZNP assumption intent created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'intentId',
                    'operationFamily',
                    'proposedAction',
                    'status',
                    'requiresHumanConfirmation',
                  ],
                  properties: {
                    intentId: { type: 'string' },
                    operationFamily: { type: 'string', example: 'znp' },
                    proposedAction: { type: 'string', example: 'add_assumption' },
                    target: { type: 'object' },
                    inputSummary: { type: 'string' },
                    status: { type: 'string', example: 'pending_confirmation' },
                    expiresAt: { type: 'string' },
                    risk: { type: 'string', example: 'medium' },
                    requiresHumanConfirmation: { type: 'boolean', example: true },
                    summary: { type: 'string' },
                    confirmationMessage: { type: 'string' },
                    executeVia: { type: 'object' },
                    auditTrail: { type: 'object' },
                  },
                },
              },
            },
          },
          404: { description: 'Project not found' },
        },
      },
      async handler(ctx) {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const { projectId, text, reason } = ctx.params;
        const audit = buildAudit(ctx, ctx.params.correlationId);

        const project = await ctx.call('znp.getProjectMeta', { projectId }, callOpts);

        const inputSummary = `Add assumption to ZNP project '${project.name || projectId}'`;
        const intent = this.intentStore.create({
          operationFamily: 'znp',
          proposedAction: 'add_assumption',
          targetType: 'znpProject',
          targetId: projectId,
          inputSummary,
          payload: { projectId, text },
          risk: 'medium',
          createdBy: audit.requestedBy,
          correlationId: audit.correlationId,
          reason,
          decisionFrameId: ctx.params.decisionFrameId || null,
        });

        return {
          intentId: intent.intentId,
          operationFamily: 'znp',
          proposedAction: 'add_assumption',
          target: { projectId, projectName: project.name || projectId },
          inputSummary: intent.inputSummary,
          status: intent.status,
          expiresAt: intent.expiresAt,
          risk: 'medium',
          requiresHumanConfirmation: true,
          decisionFrameId: intent.decisionFrameId,
          summary: `ZNP-Annahme-Intent erstellt für '${project.name || projectId}'. Menschliche Bestätigung erforderlich.`,
          confirmationMessage: `Bitte bestätige das Hinzufügen der Planungsannahme zum ZNP-Projekt '${project.name || projectId}' (${projectId}).`,
          executeVia: {
            operationId: 'executeProcessIntent',
            note: 'Not available via Copilot. Use direct API: POST /api/copilot-process/intents/:intentId/execute',
          },
          auditTrail: { ...audit, idempotencyKey: ctx.params.idempotencyKey ?? null, reason },
        };
      },
    },

    /**
     * Prepare a connection rejection evidence package intent — no write.
     * operationId: prepareConnectionRejectionEvidence
     */
    prepareConnectionRejectionEvidence: {
      rest: 'POST /connection-rejection-evidence/intents',
      params: {
        gridOperatorId: { type: 'string' },
        applicantReference: { type: 'string' },
        loadAssumptionKw: { type: 'number', convert: true },
        netzverknuepfungspunktId: { type: 'string' },
        voltageLevel: { type: 'string' },
        bottleneckDescription: { type: 'string' },
        n1QualityStatus: {
          type: 'enum',
          values: ['COMPLIANT', 'NON_COMPLIANT', 'CONDITIONALLY_COMPLIANT', 'UNKNOWN'],
        },
        decision: { type: 'string' },
        reason: { type: 'string', min: 1, max: 500 },
        correlationId: { type: 'string', optional: true },
        idempotencyKey: { type: 'string', optional: true },
        decisionFrameId: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'prepareConnectionRejectionEvidence',
        'x-openai-isConsequential': false,
        summary: 'Prepare connection rejection evidence package intent — no write',
        description: `Validates all required fields and creates a persistent ProcessExecutionIntent for creating a connection rejection evidence package. No write occurs.
Returns intentId, expiresAt, and confirmationMessage. Execute via executeProcessIntent outside Copilot.`,
        tags: [SERVICE_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'gridOperatorId',
                  'applicantReference',
                  'loadAssumptionKw',
                  'netzverknuepfungspunktId',
                  'voltageLevel',
                  'bottleneckDescription',
                  'n1QualityStatus',
                  'decision',
                  'reason',
                ],
                properties: {
                  gridOperatorId: { type: 'string', example: 'SNB935578300972' },
                  applicantReference: { type: 'string', example: 'APP-2026-001' },
                  loadAssumptionKw: { type: 'number', example: 150 },
                  netzverknuepfungspunktId: { type: 'string', example: 'NVP-001' },
                  voltageLevel: { type: 'string', example: 'NS' },
                  bottleneckDescription: {
                    type: 'string',
                    example: 'Trafoüberlastung bei Spitzenlast',
                  },
                  n1QualityStatus: {
                    type: 'string',
                    enum: ['COMPLIANT', 'NON_COMPLIANT', 'CONDITIONALLY_COMPLIANT', 'UNKNOWN'],
                  },
                  decision: { type: 'string', example: 'REJECTED' },
                  reason: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 500,
                    example: 'Netzkapazität nicht ausreichend',
                  },
                  correlationId: { type: 'string', example: 'req-2026-001' },
                  idempotencyKey: { type: 'string', example: 'idem-cre-20260611' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Connection rejection evidence intent created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: [
                    'intentId',
                    'operationFamily',
                    'proposedAction',
                    'status',
                    'requiresHumanConfirmation',
                  ],
                  properties: {
                    intentId: { type: 'string' },
                    operationFamily: { type: 'string', example: 'connectionRejectionEvidence' },
                    proposedAction: { type: 'string', example: 'create_package' },
                    target: { type: 'object' },
                    inputSummary: { type: 'string' },
                    status: { type: 'string', example: 'pending_confirmation' },
                    expiresAt: { type: 'string' },
                    risk: { type: 'string', example: 'medium' },
                    requiresHumanConfirmation: { type: 'boolean', example: true },
                    summary: { type: 'string' },
                    confirmationMessage: { type: 'string' },
                    executeVia: { type: 'object' },
                    auditTrail: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          gridOperatorId,
          applicantReference,
          loadAssumptionKw,
          netzverknuepfungspunktId,
          voltageLevel,
          bottleneckDescription,
          n1QualityStatus,
          decision,
          reason,
        } = ctx.params;
        const audit = buildAudit(ctx, ctx.params.correlationId);

        const payload = {
          gridOperatorId,
          applicantReference,
          loadAssumptionKw,
          netzverknuepfungspunktId,
          voltageLevel,
          bottleneckDescription,
          n1QualityStatus,
          decision,
        };

        const inputSummary = `Create rejection evidence package for operator '${gridOperatorId}', ref '${applicantReference}'`;
        const intent = this.intentStore.create({
          operationFamily: 'connectionRejectionEvidence',
          proposedAction: 'create_package',
          targetType: 'gridOperator',
          targetId: gridOperatorId,
          inputSummary,
          payload,
          risk: 'medium',
          createdBy: audit.requestedBy,
          correlationId: audit.correlationId,
          reason,
          decisionFrameId: ctx.params.decisionFrameId || null,
        });

        return {
          intentId: intent.intentId,
          operationFamily: 'connectionRejectionEvidence',
          proposedAction: 'create_package',
          target: { gridOperatorId, applicantReference },
          inputSummary: intent.inputSummary,
          status: intent.status,
          expiresAt: intent.expiresAt,
          risk: 'medium',
          requiresHumanConfirmation: true,
          decisionFrameId: intent.decisionFrameId,
          summary: `Ablehnungs-Nachweis-Intent erstellt für Netzbetreiber '${gridOperatorId}', Referenz '${applicantReference}'. Menschliche Bestätigung erforderlich.`,
          confirmationMessage: `Bitte bestätige die Erstellung des Ablehnungs-Nachweispakets für Netzbetreiber '${gridOperatorId}', Antragssteller-Referenz '${applicantReference}'.`,
          executeVia: {
            operationId: 'executeProcessIntent',
            note: 'Not available via Copilot. Use direct API: POST /api/copilot-process/intents/:intentId/execute',
          },
          auditTrail: { ...audit, idempotencyKey: ctx.params.idempotencyKey ?? null, reason },
        };
      },
    },

    /**
     * Generic Process Intake / Write Boundary (issue energychain/cernion-energy-tools#272).
     *
     * Completely separate contract from the read-only Evidence Router
     * (services/evidence-router.service.js, POST /api/evidence-router/route).
     * Accepts a domain-agnostic process/write intent and creates a
     * ProcessExecutionIntent in pending_confirmation status via the SAME
     * store/lifecycle (getProcessIntent, listProcessIntents,
     * executeProcessIntent, rejectProcessIntent) already used by the
     * domain-specific prepare* actions above. This establishes the generic
     * intake/classification/HITL boundary only — the created intent's
     * operationFamily has no case in _executeIntent's dispatch table, so it
     * can never be auto-executed until a developer deliberately adds a
     * reviewed, specific case there. This issue does not implement any
     * downstream process.
     *
     * Server-side guardrails (never trusts the caller's contract choice blindly):
     * - Rejects RESERVED_PROCESS_OPERATION_FAMILIES — those have their own
     *   dedicated, validated prepare* action; accepting them here would let a
     *   caller bypass that action's domain-specific validation.
     * - Rejects when proposedAction resolves to a registered, safety-approved
     *   read-only hydration action (getRule() returns non-null) — that is a
     *   misuse of the write boundary; the caller should use the Evidence
     *   Router instead.
     *
     * operationId: prepareProcessIntent
     */
    prepareProcessIntent: {
      rest: 'POST /intents',
      params: {
        operationFamily: { type: 'string', min: 1, max: 64 },
        proposedAction: { type: 'string', min: 1, max: 200 },
        targetType: { type: 'string', optional: true },
        targetId: { type: 'string', optional: true },
        inputSummary: { type: 'string', optional: true, max: 500 },
        payload: { type: 'object', optional: true, default: {} },
        risk: { type: 'enum', values: ['low', 'medium', 'high'], optional: true, default: 'medium' },
        reason: { type: 'string', optional: true, max: 500 },
        correlationId: { type: 'string', optional: true },
        decisionFrameId: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'prepareProcessIntent',
        'x-openai-isConsequential': false,
        summary: 'Generic Process Intake — creates a pending_confirmation intent, no write, no auto-execution',
        description: `Separate contract from the read-only Evidence Router (POST /api/evidence-router/route). Accepts a generic, domain-agnostic process/write intent and creates a ProcessExecutionIntent in pending_confirmation status. Establishes the intake/classification/HITL boundary only — the created intent's operationFamily has no case in executeProcessIntent's dispatch table (_executeIntent), so it can never be auto-executed until a developer deliberately adds a reviewed, specific case. Rejects domain-reserved operationFamily values (use the dedicated prepare* action instead, e.g. prepareVdmiEvidence) and rejects proposedAction values that resolve to a registered read-only action (use the Evidence Router instead).`,
        tags: [SERVICE_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['operationFamily', 'proposedAction'],
                properties: {
                  operationFamily: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 64,
                    example: 'customer_master_data_correction',
                  },
                  proposedAction: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                    example: 'correct_metering_point_address',
                  },
                  targetType: { type: 'string', example: 'meteringPoint' },
                  targetId: { type: 'string', example: 'MP-12345' },
                  inputSummary: { type: 'string', maxLength: 500 },
                  payload: {
                    type: 'object',
                    description: 'Arbitrary structured or semi-structured process data supplied by the user.',
                  },
                  risk: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
                  reason: { type: 'string', maxLength: 500 },
                  correlationId: { type: 'string' },
                  decisionFrameId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Process intake intent created (pending human confirmation)' },
          409: {
            description:
              'Rejected: reserved operationFamily (use the dedicated prepare* action) or read-only proposedAction (use the Evidence Router instead)',
          },
        },
      },
      async handler(ctx) {
        const { operationFamily, proposedAction } = ctx.params;
        const audit = buildAudit(ctx, ctx.params.correlationId);

        if (RESERVED_PROCESS_OPERATION_FAMILIES.has(operationFamily)) {
          throw new MoleculerClientError(
            `operationFamily "${operationFamily}" is reserved for a dedicated, validated prepare* action. Use that action instead of the generic Process Intake.`,
            409,
            'PROCESS_INTAKE_RESERVED_OPERATION_FAMILY',
            { operationFamily }
          );
        }

        const readOnlyRule = getRule(proposedAction);
        if (readOnlyRule) {
          throw new MoleculerClientError(
            `proposedAction "${proposedAction}" is a registered read-only action — use the Evidence Router contract (POST /api/evidence-router/route) instead of Process Intake.`,
            409,
            'PROCESS_INTAKE_TARGET_IS_READ_ONLY',
            { proposedAction }
          );
        }

        const intent = this.intentStore.create({
          operationFamily,
          proposedAction,
          targetType: ctx.params.targetType || null,
          targetId: ctx.params.targetId || null,
          inputSummary: ctx.params.inputSummary || `${operationFamily}: ${proposedAction}`,
          payload: ctx.params.payload || {},
          risk: ctx.params.risk || 'medium',
          createdBy: audit.requestedBy,
          correlationId: audit.correlationId,
          reason: ctx.params.reason,
          decisionFrameId: ctx.params.decisionFrameId || null,
        });

        return {
          success: true,
          resolved: { kind: 'process_intake', source: 'process_intent_store' },
          receipt: {
            intentId: intent.intentId,
            operationFamily: intent.operationFamily,
            proposedAction: intent.proposedAction,
            status: intent.status,
            requiresHumanConfirmation: intent.requiresHumanConfirmation,
            expiresAt: intent.expiresAt,
          },
          policy: {
            readOnly: false,
            sideEffects: 'pending_human_confirmation',
            tenantScoped: true,
            externalSideEffects: false,
            hitlRequired: true,
          },
          executeVia: {
            operationId: 'executeProcessIntent',
            note: 'Not available via Copilot/Sidecar. A human must execute or reject this intent via the direct API.',
          },
          auditTrail: audit,
        };
      },
    },

    /**
     * Get a process execution intent by ID.
     * operationId: getProcessIntent
     */
    getProcessIntent: {
      rest: 'GET /intents/:intentId',
      params: {
        intentId: { type: 'string' },
      },
      openapi: {
        operationId: 'getProcessIntent',
        'x-openai-isConsequential': false,
        summary: 'Get a process execution intent by ID',
        description: 'Returns intent status, payload summary, and audit trail. Read-only.',
        tags: [SERVICE_TAG],
        parameters: [
          {
            name: 'intentId',
            in: 'path',
            required: true,
            description: 'Intent UUID',
            schema: { type: 'string' },
          },
        ],
        responses: {
          200: {
            description: 'Process execution intent',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          404: { description: 'Intent not found' },
        },
      },
      async handler(ctx) {
        const intent = this.intentStore.get(ctx.params.intentId);
        if (!intent) {
          throw new MoleculerClientError(
            `Intent ${ctx.params.intentId} not found`,
            404,
            'INTENT_NOT_FOUND'
          );
        }
        return intent;
      },
    },

    /**
     * List process execution intents.
     * operationId: listProcessIntents
     */
    listProcessIntents: {
      rest: 'GET /intents',
      params: {
        operationFamily: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        decisionFrameId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 100, convert: true },
      },
      openapi: {
        operationId: 'listProcessIntents',
        'x-openai-isConsequential': false,
        summary: 'List process execution intents',
        description:
          'Returns a paginated list of process execution intents. Filter by operationFamily, status, or decisionFrameId. Read-only.',
        tags: [SERVICE_TAG],
        parameters: [
          { name: 'operationFamily', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          {
            name: 'decisionFrameId',
            in: 'query',
            required: false,
            description: 'Filter by SCQA decision frame ID',
            schema: { type: 'string' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          200: {
            description: 'List of process execution intents',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['count', 'intents'],
                  properties: {
                    count: { type: 'integer' },
                    intents: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { operationFamily, status, decisionFrameId, limit } = ctx.params;
        const intents = this.intentStore.list({ operationFamily, status, decisionFrameId, limit });
        return { count: intents.length, intents };
      },
    },

    /**
     * Execute a confirmed process intent (consequential write).
     * NOT available in Copilot.
     * operationId: executeProcessIntent
     */
    executeProcessIntent: {
      rest: 'POST /intents/:intentId/execute',
      params: {
        intentId: { type: 'string' },
        executedBy: { type: 'string', optional: true },
        correlationId: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'executeProcessIntent',
        'x-openai-isConsequential': true,
        summary: 'Execute a confirmed process intent (consequential)',
        description: `Executes a process intent that is in pending_confirmation status. This is a consequential write action.
NOT available via Copilot. Copilot prepares intents; humans execute outside Copilot using this endpoint.`,
        tags: [SERVICE_TAG],
        parameters: [
          {
            name: 'intentId',
            in: 'path',
            required: true,
            description: 'Intent UUID to execute',
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  executedBy: { type: 'string', description: 'Actor performing the execution' },
                  correlationId: { type: 'string', description: 'Trace ID for audit' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Intent executed successfully',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          404: { description: 'Intent not found' },
          409: { description: 'Intent not in executable status' },
          410: { description: 'Intent has expired' },
        },
      },
      async handler(ctx) {
        const { intentId, executedBy } = ctx.params;
        const actor = executedBy || ctx.meta?.userId || ctx.meta?.actorId || 'system';

        const intent = this.intentStore.get(intentId);
        if (!intent) {
          throw new MoleculerClientError(`Intent ${intentId} not found`, 404, 'INTENT_NOT_FOUND');
        }
        if (intent.status === 'expired') {
          throw new MoleculerClientError(`Intent ${intentId} has expired`, 410, 'INTENT_EXPIRED');
        }
        if (intent.status === 'rejected') {
          throw new MoleculerClientError(`Intent ${intentId} was rejected`, 409, 'INTENT_REJECTED');
        }
        if (intent.status === 'executed') {
          throw new MoleculerClientError(
            `Intent ${intentId} was already executed`,
            409,
            'INTENT_ALREADY_EXECUTED'
          );
        }
        if (intent.status === 'failed') {
          throw new MoleculerClientError(
            `Intent ${intentId} previously failed`,
            409,
            'INTENT_FAILED'
          );
        }
        if (intent.status !== 'pending_confirmation') {
          throw new MoleculerClientError(
            `Intent ${intentId} has invalid status: ${intent.status}`,
            409,
            'INTENT_INVALID_STATUS'
          );
        }

        try {
          await this._executeIntent(ctx, intent);
          this.intentStore.transition(intentId, 'executed', actor, 'Human-confirmed execution', {
            result: 'success',
          });
          return {
            intentId,
            status: 'executed',
            operationFamily: intent.operationFamily,
            proposedAction: intent.proposedAction,
            executedAt: new Date().toISOString(),
            executedBy: actor,
            auditTrail: intent.auditTrail,
          };
        } catch (err) {
          this.intentStore.transition(intentId, 'failed', actor, err.message);
          throw err;
        }
      },
    },

    /**
     * Reject a process intent (human rejection).
     * NOT available in Copilot.
     * operationId: rejectProcessIntent
     */
    rejectProcessIntent: {
      rest: 'POST /intents/:intentId/reject',
      params: {
        intentId: { type: 'string' },
        reason: { type: 'string', min: 1 },
        rejectedBy: { type: 'string', optional: true },
      },
      openapi: {
        operationId: 'rejectProcessIntent',
        'x-openai-isConsequential': false,
        summary: 'Reject a process intent (human rejection)',
        description: `Rejects a pending_confirmation intent. Must be performed by a human operator.
NOT available via Copilot — not for autonomous agent use.`,
        tags: [SERVICE_TAG],
        parameters: [
          {
            name: 'intentId',
            in: 'path',
            required: true,
            description: 'Intent UUID to reject',
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string', minLength: 1, description: 'Reason for rejection' },
                  rejectedBy: { type: 'string', description: 'Actor performing the rejection' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Intent rejected',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          404: { description: 'Intent not found' },
          409: { description: 'Intent not in rejectable status' },
        },
      },
      async handler(ctx) {
        const { intentId, reason, rejectedBy } = ctx.params;
        const actor = rejectedBy || ctx.meta?.userId || ctx.meta?.actorId || 'system';

        const intent = this.intentStore.get(intentId);
        if (!intent) {
          throw new MoleculerClientError(`Intent ${intentId} not found`, 404, 'INTENT_NOT_FOUND');
        }
        const rejectableStatuses = ['pending_confirmation'];
        if (!rejectableStatuses.includes(intent.status)) {
          throw new MoleculerClientError(
            `Intent ${intentId} is not in a rejectable status: ${intent.status}`,
            409,
            'INTENT_NOT_REJECTABLE'
          );
        }

        this.intentStore.transition(intentId, 'rejected', actor, reason);
        return {
          intentId,
          status: 'rejected',
          reason,
          rejectedBy: actor,
          rejectedAt: new Date().toISOString(),
        };
      },
    },
  },

  methods: {
    async _executeIntent(ctx, intent) {
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };
      const { operationFamily, payload } = intent;

      switch (operationFamily) {
        case 'vdmi':
          return ctx.call('vdmi.evidence', payload, callOpts);
        case 'gridConnection':
          return ctx.call('grid-connection.validate', payload, callOpts);
        case 'znp':
          return ctx.call('znp.addAssumption', payload, callOpts);
        case 'connectionRejectionEvidence':
          return ctx.call('connection-rejection-evidence.create', payload, callOpts);
        default:
          throw new MoleculerClientError(
            `Unknown operationFamily: ${operationFamily}`,
            400,
            'UNKNOWN_OPERATION_FAMILY'
          );
      }
    },
  },
};
