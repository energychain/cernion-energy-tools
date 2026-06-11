'use strict';

/**
 * Copilot Process Service
 *
 * Provides MS365 Copilot-compatible process actions for VDMI, ZNP, and
 * grid connection workflows. Strictly separates read-only, draft/propose,
 * and (future) consequential-execute tiers.
 *
 * Phase 2: read-only + draft/propose only. No writes, no bulk actions.
 * All consequential execute actions are deferred to Phase 3.
 */

const { MoleculerClientError } = require('moleculer').Errors;
const { randomUUID } = require('crypto');

const SERVICE_TAG = 'Copilot Process';

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

module.exports = {
  name: 'copilot-process',

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
            description: 'Actor ID to filter responsibilities for (defaults to authenticated caller)',
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
            { status: 'active', limit, ...(ctx.params.processType ? { processType: ctx.params.processType } : {}) },
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
        const findings = Array.isArray(report.findings) ? report.findings.length : (report.findingsCount ?? 0);
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
                  matrixId: { type: 'string', description: 'VDMI matrix ID', example: 'vdmi-abc123' },
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
                  required: ['draftId', 'action', 'target', 'summary', 'requiredConfirmation', 'auditTrail'],
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

        const warning = open.length > 0
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
                  required: ['draftId', 'action', 'target', 'evidenceSuggestions', 'summary', 'auditTrail'],
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
          summary: open.length === 0
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
                  gridOperatorName: { type: 'string', example: 'TWL Netze' },
                  reason: { type: 'string', minLength: 1, maxLength: 500, example: 'Jahresprüfung Q2 2026' },
                  includeCapacityCheck: { type: 'boolean', default: false },
                  correlationId: { type: 'string', example: 'req-2026-001' },
                  idempotencyKey: { type: 'string', example: 'idem-twl-20260611' },
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
                  required: ['draftId', 'action', 'target', 'proposedValidation', 'summary', 'requiredConfirmation', 'auditTrail'],
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
                      description: 'Parameters that would be passed to the consequential execute action',
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
        const { gridOperatorId, gridOperatorBdew, gridOperatorName, reason, includeCapacityCheck } = ctx.params;
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

        return {
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
            operationId: 'runGridConnectionValidation',
            endpoint: 'POST /api/grid-connection/validate',
            note: 'Noch nicht implementiert (Phase 3). Direkt: POST /api/grid-connection/validate',
          },
          auditTrail: {
            ...audit,
            reason,
            idempotencyKey: ctx.params.idempotencyKey ?? null,
          },
        };
      },
    },
  },
};
