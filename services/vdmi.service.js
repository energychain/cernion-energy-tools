'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const OPENAPI_TAG = 'VDMI';
const DOC_PREFIX = 'vdmi:';
const TEMPLATE_PREFIX = 'vdmi-template:';
const AUDIT_PREFIX = 'vdmi-audit:';
const FINDING_PREFIX = 'vdmi-finding:';
const DEFAULT_PROMOTION_THRESHOLD = 10;

const SHADOW_EVENT_PATTERNS = [
  'mail.attachment.extracted',
  'sharepoint.excel.updated',
  'mail.folder.moved',
];

const ROLE_PRIORITY = Object.freeze({ I: 1, M: 2, D: 3, V: 4 });
const ROLE_CONSTRAINTS = Object.freeze({
  V: ['escalate_hitl', 'single_owner'],
  D: ['execute_with_evidence', 'respect_role_boundary'],
  M: ['advisory_only', 'no_final_decision'],
  I: ['inform_only'],
});

function nowIso() {
  return new Date().toISOString();
}

function cleanObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeSeverity(value) {
  const normalized = String(value || 'M').toUpperCase();
  if (['L', 'M', 'H', 'K'].includes(normalized)) return normalized;
  return 'M';
}

function normalizeFindingStatus(value) {
  const normalized = String(value || 'open').toLowerCase();
  if (['open', 'mitigated', 'resolved'].includes(normalized)) return normalized;
  return 'open';
}

function toRoleCandidatesFromEvent(eventName, payload = {}) {
  const roles = [];

  if (eventName === 'hitl.item.created' || eventName === 'hitl.item.resolved') {
    const approver = payload.approver || payload.userId || payload.actorId || null;
    if (approver) {
      roles.push({
        role: 'V',
        actorType: payload.actorType || 'user',
        actorId: String(approver),
        confidence: 1,
        reason: 'HITL approver signal',
      });
    }
  }

  if (eventName.endsWith('.completed') || eventName.endsWith('.executed')) {
    const serviceId = payload.serviceId || payload.originService || payload.service || null;
    if (serviceId) {
      roles.push({
        role: 'D',
        actorType: 'service',
        actorId: String(serviceId),
        confidence: 0.95,
        reason: 'Execution completion event',
      });
    }
  }

  if (eventName.includes('agent') && (payload.personaId || payload.agentId)) {
    const agentId = payload.personaId || payload.agentId;
    roles.push({
      role: 'M',
      actorType: 'agent',
      actorId: String(agentId),
      confidence: 0.9,
      reason: 'Agent advisory signal',
    });
  }

  if (eventName === 'webhooks.delivered' && payload.recipient) {
    roles.push({
      role: 'I',
      actorType: 'external',
      actorId: String(payload.recipient),
      confidence: 0.85,
      reason: 'Notification delivery',
    });
  }

  if (SHADOW_EVENT_PATTERNS.includes(eventName)) {
    const actorId =
      payload.mailbox || payload.actorId || payload.senderGroup || payload.source || null;
    if (actorId) {
      roles.push({
        role: 'D',
        actorType: 'user',
        actorId: String(actorId),
        confidence: 0.7,
        reason: 'Shadow process execution candidate',
      });
    }
  }

  return roles;
}

function emptyTask(taskId, taskName) {
  return {
    taskId,
    taskName,
    phase: 'execution',
    verantwortlich: [],
    durchfuehrend: [],
    mitwirkend: [],
    information: [],
    dependsOn: [],
    blocks: [],
    hitlRequired: false,
    hitlItemId: null,
    executionTrace: [],
  };
}

function uniqueActors(list) {
  const seen = new Set();
  const out = [];
  for (const actor of list || []) {
    const key = `${actor.actorType}:${actor.actorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(actor);
  }
  return out;
}

function constraintsForRole(role) {
  return ROLE_CONSTRAINTS[role] || ['no_assigned_role_found'];
}

function pickHighestRole(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }
  let winner = entries[0];
  for (const entry of entries.slice(1)) {
    const current = ROLE_PRIORITY[entry.role] || 0;
    const best = ROLE_PRIORITY[winner.role] || 0;
    if (current > best) {
      winner = entry;
    }
  }
  return winner;
}

module.exports = {
  name: 'vdmi',

  settings: {
    dbPath: process.env.VDMI_DB_PATH || './data/vdmi',
    promotionThreshold: Number(process.env.VDMI_PROMOTION_THRESHOLD || DEFAULT_PROMOTION_THRESHOLD),
  },

  created() {
    const runtimeDbPath = process.env.VDMI_DB_PATH || this.settings.dbPath || './data/vdmi';
    this.settings.dbPath = runtimeDbPath;
    this.db = new PouchDB(runtimeDbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['processId'] } });
    await this.db.createIndex({ index: { fields: ['processType'] } });
    await this.db.createIndex({ index: { fields: ['nominationStatus'] } });
    await this.db.createIndex({ index: { fields: ['status'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['type'] } });
    this.logger.info(`VDMI DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  events: {
    'hitl.item.created': {
      async handler(payload, sender, eventName, ctx) {
        await this.ingestEvent(ctx, eventName, payload);
      },
    },
    'hitl.item.resolved': {
      async handler(payload, sender, eventName, ctx) {
        await this.ingestEvent(ctx, eventName, payload);
      },
    },
    'agent.plan.step.executed': {
      async handler(payload, sender, eventName, ctx) {
        await this.ingestEvent(ctx, eventName, payload);
      },
    },
    'webhooks.delivered': {
      async handler(payload, sender, eventName, ctx) {
        await this.ingestEvent(ctx, eventName, payload);
      },
    },
    'mail.attachment.extracted': {
      async handler(payload, sender, eventName, ctx) {
        await this.ingestEvent(ctx, eventName, payload);
      },
    },
    'sharepoint.excel.updated': {
      async handler(payload, sender, eventName, ctx) {
        await this.ingestEvent(ctx, eventName, payload);
      },
    },
  },

  actions: {
    list: {
      rest: 'GET /',
      params: {
        status: { type: 'string', optional: true },
        processType: { type: 'string', optional: true },
        nominationStatus: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 50, min: 1, max: 200 },
      },
      openapi: {
        summary: 'List VDMI matrix instances',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', example: 'active' } },
          { name: 'processType', in: 'query', schema: { type: 'string', example: 'adhoc' } },
          {
            name: 'nominationStatus',
            in: 'query',
            schema: { type: 'string', example: 'pending' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
        let items = docs.map((d) => this.toPublicMatrix(d));

        if (ctx.params.status) {
          items = items.filter((i) => i.status === ctx.params.status);
        }
        if (ctx.params.processType) {
          items = items.filter((i) => i.processType === ctx.params.processType);
        }
        if (ctx.params.nominationStatus) {
          items = items.filter((i) => i.nominationStatus === ctx.params.nominationStatus);
        }

        items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        const limit = Math.min(ctx.params.limit || 50, 200);

        return { success: true, count: items.length, items: items.slice(0, limit) };
      },
    },

    get: {
      rest: 'GET /:id',
      params: {
        id: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get one VDMI matrix instance',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'abc123' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixOrThrow(ctx.params.id, tenantId);
        return { success: true, matrix: this.toPublicMatrix(matrix) };
      },
    },

    create: {
      rest: 'POST /',
      params: {
        processId: { type: 'string', optional: true },
        processType: { type: 'string', optional: true, default: 'adhoc' },
        name: { type: 'string', min: 2 },
        scope: { type: 'string', optional: true, default: '' },
        tasks: { type: 'array', optional: true, default: [] },
        regulatoryBasis: { type: 'array', items: 'string', optional: true, default: [] },
        promotionThreshold: { type: 'number', optional: true, convert: true, min: 1, max: 100 },
      },
      openapi: {
        summary: 'Create an ad-hoc VDMI matrix',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  processId: { type: 'string', example: 'job-123' },
                  processType: { type: 'string', default: 'adhoc', example: 'adhoc' },
                  name: { type: 'string', example: 'Netzanschluss-Genehmigung PV' },
                  scope: { type: 'string', example: '§8 NAV Anschlussprozess' },
                  tasks: { type: 'array', items: { type: 'object' }, example: [] },
                  regulatoryBasis: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['§8 NAV'],
                  },
                  promotionThreshold: { type: 'integer', example: 10 },
                },
              },
              examples: {
                default: {
                  value: {
                    processId: 'job-123',
                    processType: 'adhoc',
                    name: 'Netzanschluss-Genehmigung PV',
                    scope: '§8 NAV Anschlussprozess',
                    tasks: [],
                    regulatoryBasis: ['§8 NAV'],
                    promotionThreshold: 10,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);

        // Guardrail: only V-role may create VDMI matrices (if agentRole asserted externally)
        if (ctx.meta?.agentRole && ctx.meta.agentRole !== 'V') {
          throw new MoleculerClientError(
            `Only V-role may create VDMI matrices. Current role: ${ctx.meta.agentRole}`,
            403,
            'FORBIDDEN_ROLE',
            { agentRole: ctx.meta.agentRole, agentId: ctx.meta.agentId }
          );
        }

        const id = crypto.randomUUID();
        const ts = nowIso();

        const matrix = {
          _id: `${DOC_PREFIX}${id}`,
          id,
          type: 'vdmi-matrix',
          tenantId,
          processId: ctx.params.processId || `job-${crypto.randomUUID()}`,
          processType: ctx.params.processType || 'adhoc',
          standardMatrixId: null,
          standardMatrixVersion: null,
          name: ctx.params.name,
          scope: ctx.params.scope || '',
          assetCategory: null,
          regulatoryBasis: ctx.params.regulatoryBasis || [],
          tasks:
            Array.isArray(ctx.params.tasks) && ctx.params.tasks.length > 0 ? ctx.params.tasks : [],
          status: 'active',
          createdAt: ts,
          updatedAt: ts,
          completedAt: null,
          autoDetected: false,
          detectionSource: 'manual',
          detectionConfidence: 1,
          nominationStatus: null,
          nominatedBy: null,
          nominatedAt: null,
          nominationHitlItemId: null,
          eventPatternHash: null,
          patternMatchCount: 0,
          promotionThreshold: ctx.params.promotionThreshold || this.settings.promotionThreshold,
          version: 1,
          history: [],
          evidence: [],
          findings: [],
          tasksById: {},
        };

        // Validate: each task may have at most one D actor
        for (const task of matrix.tasks) {
          if (Array.isArray(task.durchfuehrend) && task.durchfuehrend.length > 1) {
            throw new MoleculerClientError(
              'Task may have at most one D actor. Use human-override or re-assignment.',
              409,
              'CONFLICT_ROLE',
              { taskId: task.taskId, existingD: task.durchfuehrend }
            );
          }
        }

        await this.db.put(matrix);
        await this.writeAuditEvent(tenantId, matrix.id, 'created', {
          reason: 'manual_create',
          actorId: ctx.meta?.userId || 'system',
        });

        return { success: true, matrix: this.toPublicMatrix(matrix) };
      },
    },

    detect: {
      rest: 'POST /detect',
      params: {
        processId: { type: 'string', optional: true },
        processType: { type: 'string', optional: true, default: 'adhoc' },
        name: { type: 'string', optional: true, default: 'Auto-detected process' },
        events: {
          type: 'array',
          items: 'object',
          min: 1,
        },
      },
      openapi: {
        summary: 'Infer VDMI roles from event sequence',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['events'],
                properties: {
                  processId: { type: 'string', example: 'job-123' },
                  processType: { type: 'string', example: 'grid-connection-approval' },
                  name: { type: 'string', example: 'Auto Netzanschluss' },
                  events: {
                    type: 'array',
                    example: [
                      {
                        eventName: 'agent.plan.step.executed',
                        payload: { serviceId: 'grid-connection' },
                      },
                    ],
                    items: {
                      type: 'object',
                      properties: {
                        eventName: { type: 'string', example: 'hitl.item.created' },
                        timestamp: { type: 'string', format: 'date-time' },
                        payload: { type: 'object' },
                      },
                    },
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    processId: 'job-123',
                    processType: 'grid-connection-approval',
                    name: 'Auto Netzanschluss',
                    events: [
                      {
                        eventName: 'agent.plan.step.executed',
                        payload: { serviceId: 'grid-connection' },
                      },
                      { eventName: 'hitl.item.created', payload: { approver: 'grid_operator' } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const id = crypto.randomUUID();
        const ts = nowIso();
        const processId = ctx.params.processId || `job-${crypto.randomUUID()}`;
        const task = emptyTask('task-01', 'Detected task');

        let confidenceTotal = 0;
        let confidenceCount = 0;

        for (const evt of ctx.params.events) {
          const eventName = String(evt.eventName || '').trim();
          const payload = cleanObject(evt.payload);
          if (!eventName) continue;

          const candidates = toRoleCandidatesFromEvent(eventName, payload);
          task.executionTrace.push({
            eventName,
            payload,
            timestamp: evt.timestamp || nowIso(),
            candidates,
          });

          for (const candidate of candidates) {
            const actorRef = { actorType: candidate.actorType, actorId: candidate.actorId };
            if (candidate.role === 'V') task.verantwortlich.push(actorRef);
            if (candidate.role === 'D') {
              if (task.durchfuehrend.length > 0) {
                const existingD = task.durchfuehrend[0];
                const sameActor =
                  existingD?.actorType === actorRef.actorType &&
                  existingD?.actorId === actorRef.actorId;
                if (sameActor) {
                  continue;
                }
                throw new MoleculerClientError(
                  'Task already has a Durchfuehrend actor. Use human-override or re-assignment.',
                  409,
                  'CONFLICT_ROLE',
                  { taskId: task.taskId, existingD, conflictingCandidate: actorRef }
                );
              }
              task.durchfuehrend.push(actorRef);
            }
            if (candidate.role === 'M') task.mitwirkend.push(actorRef);
            if (candidate.role === 'I') task.information.push(actorRef);

            confidenceTotal += candidate.confidence;
            confidenceCount += 1;
          }
        }

        task.verantwortlich = uniqueActors(task.verantwortlich);
        task.durchfuehrend = uniqueActors(task.durchfuehrend);
        task.mitwirkend = uniqueActors(task.mitwirkend);
        task.information = uniqueActors(task.information);

        const confidence =
          confidenceCount > 0 ? Number((confidenceTotal / confidenceCount).toFixed(2)) : 0.6;
        const patternHash = crypto
          .createHash('sha256')
          .update(
            JSON.stringify(
              task.executionTrace.map((x) => ({
                eventName: x.eventName,
                keys: Object.keys(cleanObject(x.payload)).sort(),
              }))
            )
          )
          .digest('hex');

        const matrix = {
          _id: `${DOC_PREFIX}${id}`,
          id,
          type: 'vdmi-matrix',
          tenantId,
          processId,
          processType: ctx.params.processType,
          standardMatrixId: null,
          standardMatrixVersion: null,
          name: ctx.params.name,
          scope: 'auto-detected',
          assetCategory: null,
          regulatoryBasis: [],
          tasks: [task],
          status: 'active',
          createdAt: ts,
          updatedAt: ts,
          completedAt: null,
          autoDetected: true,
          detectionSource: 'moleculer-events',
          detectionConfidence: confidence,
          nominationStatus: null,
          nominatedBy: null,
          nominatedAt: null,
          nominationHitlItemId: null,
          eventPatternHash: patternHash,
          patternMatchCount: 1,
          promotionThreshold: this.settings.promotionThreshold,
          version: 1,
          history: [],
          evidence: [],
          findings: [],
          tasksById: {
            [task.taskId]: {
              rounds: task.executionTrace.length,
              converged: task.executionTrace.length <= 3,
              roleBoundaryViolation: false,
            },
          },
        };

        await this.db.put(matrix);
        await this.writeAuditEvent(tenantId, matrix.id, 'detected', {
          reason: 'event_sequence_inference',
          confidence,
          eventCount: ctx.params.events.length,
        });

        return { success: true, matrix: this.toPublicMatrix(matrix) };
      },
    },

    templates: {
      rest: 'GET /templates',
      params: {
        limit: { type: 'number', optional: true, convert: true, default: 50, min: 1, max: 200 },
      },
      openapi: {
        summary: 'List standard VDMI templates',
        tags: [OPENAPI_TAG],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(TEMPLATE_PREFIX, tenantId, true);
        const templates = docs
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
          .slice(0, Math.min(ctx.params.limit || 50, 200))
          .map((doc) => this.toPublicTemplate(doc));

        return { success: true, count: templates.length, templates };
      },
    },

    audit: {
      rest: 'GET /audit',
      params: {
        limit: { type: 'number', optional: true, convert: true, default: 100, min: 1, max: 500 },
      },
      openapi: {
        summary: 'Get VDMI audit events',
        tags: [OPENAPI_TAG],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(AUDIT_PREFIX, tenantId);
        const audits = docs
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
          .slice(0, Math.min(ctx.params.limit || 100, 500));

        return { success: true, count: audits.length, audits };
      },
    },

    nominations: {
      rest: 'GET /nominations',
      params: {
        status: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List nomination requests',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', example: 'pending' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
        let items = docs.filter((d) => d.nominationStatus && d.nominationStatus !== 'none');
        if (ctx.params.status) {
          items = items.filter((d) => d.nominationStatus === ctx.params.status);
        }

        items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

        return {
          success: true,
          count: items.length,
          nominations: items.map((d) => ({
            id: d.id,
            name: d.name,
            nominationStatus: d.nominationStatus,
            nominatedAt: d.nominatedAt,
            nominatedBy: d.nominatedBy,
            nominationHitlItemId: d.nominationHitlItemId || null,
            patternMatchCount: d.patternMatchCount || 0,
            promotionThreshold: d.promotionThreshold || this.settings.promotionThreshold,
          })),
        };
      },
    },

    nominate: {
      rest: 'POST /:id/nominate',
      params: {
        id: { type: 'string', min: 2 },
        reason: { type: 'string', min: 3 },
      },
      openapi: {
        summary: 'Nominate ad-hoc matrix as standard template candidate',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'abc123' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string', example: 'Muster stabil über 10 Fälle' },
                },
              },
              examples: {
                default: { value: { reason: 'Muster stabil über 10 Fälle' } },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixOrThrow(ctx.params.id, tenantId);

        matrix.nominationStatus = 'pending';
        matrix.nominatedBy = {
          actorType: ctx.meta?.userId ? 'user' : 'agent',
          actorId: ctx.meta?.userId || ctx.meta?.agentId || 'system',
        };
        matrix.nominatedAt = nowIso();
        matrix.updatedAt = matrix.nominatedAt;

        try {
          const hitl = await ctx.call('hitl.create', {
            kind: 'vdmi-nomination',
            payload: {
              matrixId: matrix.id,
              processId: matrix.processId,
              reason: ctx.params.reason,
            },
            originService: 'vdmi',
            originAction: 'nominate',
            severity: 'warning',
            requiredScope: 'full-access',
          });
          matrix.nominationHitlItemId = hitl?.item?.id || null;
        } catch (err) {
          this.logger.warn(`[vdmi] hitl.create failed for nomination ${matrix.id}: ${err.message}`);
        }

        await this.db.put(matrix);
        await this.writeAuditEvent(tenantId, matrix.id, 'nominated', {
          reason: ctx.params.reason,
          nominatedBy: matrix.nominatedBy,
          hitlItemId: matrix.nominationHitlItemId,
        });

        this.broker.emit('vdmi.nomination.requested.v1', {
          eventId: crypto.randomUUID(),
          timestamp: nowIso(),
          tenantId,
          matrixId: matrix.id,
          processId: matrix.processId,
          schemaVersion: '1.0.0',
          producer: 'vdmi',
          payload: {
            nominationStatus: matrix.nominationStatus,
            nominatedBy: matrix.nominatedBy,
          },
        });

        return { success: true, matrix: this.toPublicMatrix(matrix) };
      },
    },

    confirmNomination: {
      rest: 'POST /:id/confirm-nomination',
      params: {
        id: { type: 'string', min: 2 },
        approved: { type: 'boolean', optional: true, default: true },
        reason: { type: 'string', min: 3 },
      },
      openapi: {
        summary: 'Confirm or reject nomination and optionally create standard template',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'abc123' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  approved: { type: 'boolean', default: true },
                  reason: { type: 'string', example: 'HITL bestätigt Standardprozess' },
                },
              },
              examples: {
                default: { value: { approved: true, reason: 'HITL bestätigt Standardprozess' } },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixOrThrow(ctx.params.id, tenantId);
        const ts = nowIso();

        matrix.nominationStatus = ctx.params.approved ? 'confirmed' : 'rejected';
        matrix.updatedAt = ts;

        let template = null;
        if (ctx.params.approved) {
          template = await this.createTemplateFromMatrix(matrix, tenantId, ctx.params.reason);
          matrix.standardMatrixId = template.id;
          matrix.standardMatrixVersion = template.version;
        }

        await this.db.put(matrix);
        await this.writeAuditEvent(tenantId, matrix.id, 'nomination_decision', {
          approved: ctx.params.approved,
          reason: ctx.params.reason,
          actorId: ctx.meta?.userId || 'system',
          templateId: template?.id || null,
        });

        return {
          success: true,
          matrix: this.toPublicMatrix(matrix),
          template: template ? this.toPublicTemplate(template) : null,
        };
      },
    },

    myResponsibilities: {
      rest: 'GET /my-responsibilities',
      params: {
        userId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List matrices where caller has V role',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'string', example: 'grid_operator' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = ctx.params.userId || ctx.meta?.userId;
        if (!userId) {
          throw new MoleculerClientError('userId is required', 400, 'MISSING_USER_ID');
        }

        const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
        const items = docs.filter((doc) =>
          (doc.tasks || []).some((task) =>
            (task.verantwortlich || []).some((actor) => actor.actorId === userId)
          )
        );

        return {
          success: true,
          count: items.length,
          items: items.map((d) => this.toPublicMatrix(d)),
        };
      },
    },

    myInformed: {
      rest: 'GET /my-informed',
      params: {
        userId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'List matrices where caller has I role',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'string', example: 'applicant' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = ctx.params.userId || ctx.meta?.userId;
        if (!userId) {
          throw new MoleculerClientError('userId is required', 400, 'MISSING_USER_ID');
        }

        const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
        const items = docs.filter((doc) =>
          (doc.tasks || []).some((task) =>
            (task.information || []).some((actor) => actor.actorId === userId)
          )
        );

        return {
          success: true,
          count: items.length,
          items: items.map((d) => this.toPublicMatrix(d)),
        };
      },
    },

    agentRole: {
      rest: 'GET /agent/:agentId/role',
      params: {
        agentId: { type: 'string', min: 2 },
        processType: { type: 'string', optional: true },
        taskId: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Return guardrail role for an agent',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'agentId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'technical' },
          },
          { name: 'processType', in: 'query', schema: { type: 'string', example: 'adhoc' } },
          { name: 'taskId', in: 'query', schema: { type: 'string', example: 'network-operator-decision' } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
        const processType = ctx.params.processType || null;
        const taskId = ctx.params.taskId || null;
        const agentId = ctx.params.agentId;

        const candidates = docs
          .filter((doc) => !processType || doc.processType === processType)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        const rolesByTaskRaw = [];

        for (const matrix of candidates) {
          for (const task of matrix.tasks || []) {
            if (taskId && task.taskId !== taskId) {
              continue;
            }

            const taskRoles = [];
            if ((task.verantwortlich || []).some((a) => a.actorId === agentId)) {
              taskRoles.push('V');
            }
            if ((task.durchfuehrend || []).some((a) => a.actorId === agentId)) {
              taskRoles.push('D');
            }
            if ((task.mitwirkend || []).some((a) => a.actorId === agentId)) {
              taskRoles.push('M');
            }
            if ((task.information || []).some((a) => a.actorId === agentId)) {
              taskRoles.push('I');
            }

            if (taskRoles.length === 0) {
              continue;
            }

            const highestTaskRole = taskRoles.reduce((best, role) => {
              if (!best) return role;
              return (ROLE_PRIORITY[role] || 0) > (ROLE_PRIORITY[best] || 0) ? role : best;
            }, null);

            rolesByTaskRaw.push({
              matrixId: matrix.id,
              taskId: task.taskId,
              role: highestTaskRole,
              constraints: constraintsForRole(highestTaskRole),
            });
          }
        }

        if (rolesByTaskRaw.length === 0) {
          return {
            success: true,
            role: 'I',
            highestRole: 'I',
            rolesByTask: [],
            constraints: ['no_assigned_role_found'],
            warnings: [],
            matrixId: null,
            taskId: taskId || null,
          };
        }

        const dedupMap = new Map();
        for (const entry of rolesByTaskRaw) {
          const key = `${entry.matrixId}:${entry.taskId}`;
          const existing = dedupMap.get(key);
          if (!existing || (ROLE_PRIORITY[entry.role] || 0) > (ROLE_PRIORITY[existing.role] || 0)) {
            dedupMap.set(key, entry);
          }
        }
        const rolesByTask = Array.from(dedupMap.values());
        const highest = pickHighestRole(rolesByTask);
        const warnings = [];
        if (!taskId && rolesByTask.length > 1) {
          warnings.push('actor_has_multiple_roles_across_tasks');
        }

        return {
          success: true,
          role: highest.role,
          highestRole: highest.role,
          rolesByTask,
          constraints: constraintsForRole(highest.role),
          warnings,
          matrixId: highest.matrixId,
          taskId: highest.taskId,
        };
      },
    },

    context: {
      rest: 'GET /context',
      params: {
        jobId: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get active matrix context for a running job',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'jobId',
            in: 'query',
            required: true,
            schema: { type: 'string', example: 'job-123' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
        const matrix = docs
          .filter((doc) => doc.processId === ctx.params.jobId)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];

        if (!matrix) {
          return { success: true, matrix: null };
        }

        return { success: true, matrix: this.toPublicMatrix(matrix) };
      },
    },

    update: {
      rest: 'PATCH /:id',
      params: {
        id: { type: 'string', min: 2 },
        reason: { type: 'string', min: 3 },
        patch: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Human override of matrix fields',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'abc123' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string' },
                  patch: { type: 'object' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixOrThrow(ctx.params.id, tenantId);
        const ts = nowIso();

        const snapshot = this.toHistorySnapshot(
          matrix,
          'patch',
          ctx.params.reason,
          ctx.meta?.userId
        );
        matrix.history = Array.isArray(matrix.history) ? matrix.history : [];
        matrix.history.push(snapshot);

        const patch = cleanObject(ctx.params.patch);
        if (patch.tasks && !Array.isArray(patch.tasks)) {
          throw new MoleculerClientError('patch.tasks must be an array', 422, 'VALIDATION_ERROR');
        }

        if (patch.name) matrix.name = patch.name;
        if (patch.scope !== undefined) matrix.scope = patch.scope;
        if (patch.tasks) matrix.tasks = patch.tasks;
        if (patch.status) matrix.status = patch.status;
        if (patch.regulatoryBasis) matrix.regulatoryBasis = patch.regulatoryBasis;
        if (patch.nominationStatus) matrix.nominationStatus = patch.nominationStatus;

        matrix.version = Number(matrix.version || 1) + 1;
        matrix.updatedAt = ts;

        await this.db.put(matrix);
        await this.writeAuditEvent(tenantId, matrix.id, 'patched', {
          reason: ctx.params.reason,
          actorId: ctx.meta?.userId || 'system',
          patchKeys: Object.keys(patch),
        });

        return { success: true, matrix: this.toPublicMatrix(matrix) };
      },
    },

    revert: {
      rest: 'POST /:id/revert',
      params: {
        id: { type: 'string', min: 2 },
        reason: { type: 'string', min: 3 },
      },
      openapi: {
        summary: 'Revert matrix to previous version snapshot',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'abc123' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string', example: 'Rollback nach Governance-Review' },
                },
              },
              examples: {
                default: { value: { reason: 'Rollback nach Governance-Review' } },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixOrThrow(ctx.params.id, tenantId);
        const history = Array.isArray(matrix.history) ? matrix.history : [];
        if (history.length === 0) {
          throw new MoleculerClientError('No previous revision available', 409, 'NO_HISTORY');
        }

        const last = history.pop();
        const previous = cleanObject(last.previous || {});
        for (const key of [
          'name',
          'scope',
          'tasks',
          'status',
          'regulatoryBasis',
          'nominationStatus',
        ]) {
          if (Object.prototype.hasOwnProperty.call(previous, key)) {
            matrix[key] = previous[key];
          }
        }

        matrix.history = history;
        matrix.version = Number(matrix.version || 1) + 1;
        matrix.updatedAt = nowIso();

        await this.db.put(matrix);
        await this.writeAuditEvent(tenantId, matrix.id, 'reverted', {
          reason: ctx.params.reason,
          actorId: ctx.meta?.userId || 'system',
        });

        return { success: true, matrix: this.toPublicMatrix(matrix) };
      },
    },

    evidence: {
      rest: 'POST /:id/evidence',
      params: {
        id: { type: 'string', min: 2 },
        reason: { type: 'string', min: 3 },
        type: { type: 'string', min: 2 },
        reference: { type: 'string', min: 2 },
        content: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Inject manual evidence for offline process reality',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'abc123' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason', 'type', 'reference'],
                properties: {
                  reason: { type: 'string', example: 'Telefonischer Freigabenachweis' },
                  type: { type: 'string', example: 'aktenvermerk' },
                  reference: { type: 'string', example: 'AZ-2026-0042' },
                  content: { type: 'object', example: { note: 'Entscheid am Telefon bestätigt' } },
                },
              },
              examples: {
                default: {
                  value: {
                    reason: 'Telefonischer Freigabenachweis',
                    type: 'aktenvermerk',
                    reference: 'AZ-2026-0042',
                    content: { note: 'Entscheid am Telefon bestätigt' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixOrThrow(ctx.params.id, tenantId);
        const entry = {
          id: crypto.randomUUID(),
          type: ctx.params.type,
          reference: ctx.params.reference,
          content: cleanObject(ctx.params.content),
          reason: ctx.params.reason,
          createdAt: nowIso(),
          createdBy: ctx.meta?.userId || 'system',
        };

        matrix.evidence = Array.isArray(matrix.evidence) ? matrix.evidence : [];
        matrix.evidence.push(entry);
        matrix.updatedAt = entry.createdAt;
        matrix.version = Number(matrix.version || 1) + 1;

        await this.db.put(matrix);
        await this.writeAuditEvent(tenantId, matrix.id, 'evidence_added', {
          evidenceId: entry.id,
          reason: ctx.params.reason,
          actorId: entry.createdBy,
        });

        return { success: true, evidence: entry, matrix: this.toPublicMatrix(matrix) };
      },
    },

    negotiationTrace: {
      rest: 'GET /tasks/:taskId/negotiation-trace',
      params: {
        taskId: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get full A2A negotiation trace for one task',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'task-01' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixByTaskId(ctx.params.taskId, tenantId);
        if (!matrix) {
          throw new MoleculerClientError('Task not found', 404, 'TASK_NOT_FOUND');
        }

        const task = (matrix.tasks || []).find((t) => t.taskId === ctx.params.taskId);
        const trace = (task?.executionTrace || []).map((item, index) => ({
          round: index + 1,
          timestamp: item.timestamp,
          eventName: item.eventName,
          payload: item.payload,
          roleCandidates: item.candidates || [],
          convergenceCheck: index === (task.executionTrace || []).length - 1,
        }));

        const taskMeta = matrix.tasksById?.[ctx.params.taskId] || null;
        const roundLimit = 12;
        const timeoutMs = 30_000;
        const hitRoundLimit = trace.length >= roundLimit;

        if (hitRoundLimit) {
          await this.upsertFinding({
            tenantId,
            matrixId: matrix.id,
            code: 'VD_GOV_RECURRENCE_K',
            domain: 'GOV',
            severity: 'K',
            status: 'open',
            message: 'A2A round limit reached, escalation required',
            evidenceRefs: [ctx.params.taskId],
          });
        }

        return {
          success: true,
          matrixId: matrix.id,
          taskId: ctx.params.taskId,
          loopProtection: {
            roundLimit,
            timeoutMs,
            reached: hitRoundLimit,
            converged: taskMeta?.converged ?? trace.length <= 3,
            roleBoundaryViolation: taskMeta?.roleBoundaryViolation || false,
          },
          trace,
        };
      },
    },

    dossier: {
      rest: 'GET /tasks/:taskId/dossier',
      params: {
        taskId: { type: 'string', min: 2 },
      },
      openapi: {
        summary: 'Get condensed decision dossier for V role',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'taskId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'task-01' },
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const matrix = await this.getMatrixByTaskId(ctx.params.taskId, tenantId);
        if (!matrix) {
          throw new MoleculerClientError('Task not found', 404, 'TASK_NOT_FOUND');
        }

        const task = (matrix.tasks || []).find((t) => t.taskId === ctx.params.taskId);
        const facts = [];
        const dissens = [];

        for (const trace of task?.executionTrace || []) {
          if ((trace.candidates || []).length === 0) continue;
          for (const candidate of trace.candidates) {
            if (candidate.confidence >= 0.85) {
              facts.push({
                eventName: trace.eventName,
                role: candidate.role,
                actorId: candidate.actorId,
                reason: candidate.reason,
              });
            } else {
              dissens.push({
                eventName: trace.eventName,
                role: candidate.role,
                actorId: candidate.actorId,
                reason: candidate.reason,
              });
            }
          }
        }

        return {
          success: true,
          matrixId: matrix.id,
          taskId: ctx.params.taskId,
          dossier: {
            facts,
            dissens,
            options: [
              {
                id: 'option-capex',
                title: 'CAPEX-first path',
                impact: { risk: 'medium', cost: 'high', time: 'long' },
              },
              {
                id: 'option-flex',
                title: 'Flex/TOTEX path',
                impact: { risk: 'medium', cost: 'medium', time: 'short' },
              },
            ],
            recommendation:
              facts.length >= dissens.length
                ? 'Proceed with VDMI-aligned decision and escalate to V for final approval.'
                : 'Collect additional evidence before final V decision.',
          },
        };
      },
    },

    findings: {
      rest: 'GET /findings',
      params: {
        severity: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        code: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, default: 100, min: 1, max: 500 },
      },
      openapi: {
        summary: 'List VDMI governance findings',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'severity', in: 'query', schema: { type: 'string', example: 'H' } },
          { name: 'status', in: 'query', schema: { type: 'string', example: 'open' } },
          { name: 'code', in: 'query', schema: { type: 'string', example: 'VD_GOV_RECURRENCE_K' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const docs = await this.getTenantDocsByPrefix(FINDING_PREFIX, tenantId);

        let items = docs;
        if (ctx.params.severity) {
          items = items.filter((f) => f.severity === normalizeSeverity(ctx.params.severity));
        }
        if (ctx.params.status) {
          items = items.filter((f) => f.status === normalizeFindingStatus(ctx.params.status));
        }
        if (ctx.params.code) {
          items = items.filter((f) => f.code === ctx.params.code);
        }

        items = items
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
          .slice(0, Math.min(ctx.params.limit || 100, 500));

        return { success: true, count: items.length, findings: items };
      },
    },

    mitigateFinding: {
      rest: 'POST /findings/:findingId/mitigate',
      params: {
        findingId: { type: 'string', min: 2 },
        owner: { type: 'string', min: 2 },
        dueAt: { type: 'string', min: 10 },
        plan: { type: 'string', min: 3 },
      },
      openapi: {
        summary: 'Submit mitigation plan for a VDMI finding',
        tags: [OPENAPI_TAG],
        parameters: [{ name: 'findingId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['owner', 'dueAt', 'plan'],
                properties: {
                  owner: { type: 'string', example: 'grid-lead' },
                  dueAt: {
                    type: 'string',
                    format: 'date-time',
                    example: '2026-12-31T00:00:00.000Z',
                  },
                  plan: {
                    type: 'string',
                    example: 'Ablösung des Schattenpfads durch API-Integration',
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    owner: 'grid-lead',
                    dueAt: '2026-12-31T00:00:00.000Z',
                    plan: 'Ablösung des Schattenpfads durch API-Integration',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const finding = await this.getFindingOrThrow(ctx.params.findingId, tenantId);

        finding.status = 'mitigated';
        finding.mitigation = {
          owner: ctx.params.owner,
          dueAt: ctx.params.dueAt,
          plan: ctx.params.plan,
          updatedAt: nowIso(),
          updatedBy: ctx.meta?.userId || 'system',
        };
        finding.updatedAt = finding.mitigation.updatedAt;

        await this.db.put(finding);
        await this.writeAuditEvent(tenantId, finding.matrixId, 'finding_mitigated', {
          findingId: finding.id,
          code: finding.code,
          owner: ctx.params.owner,
        });

        return { success: true, finding };
      },
    },

    resolveFinding: {
      rest: 'POST /findings/:findingId/resolve',
      params: {
        findingId: { type: 'string', min: 2 },
        reason: { type: 'string', min: 3 },
        evidenceRef: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Resolve a VDMI finding',
        tags: [OPENAPI_TAG],
        parameters: [{ name: 'findingId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  reason: { type: 'string', example: 'Integration abgeschlossen' },
                  evidenceRef: { type: 'string', example: 'ticket-123' },
                },
              },
              examples: {
                default: {
                  value: { reason: 'Integration abgeschlossen', evidenceRef: 'ticket-123' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const finding = await this.getFindingOrThrow(ctx.params.findingId, tenantId);

        finding.status = 'resolved';
        finding.resolution = {
          reason: ctx.params.reason,
          evidenceRef: ctx.params.evidenceRef || null,
          resolvedAt: nowIso(),
          resolvedBy: ctx.meta?.userId || 'system',
        };
        finding.updatedAt = finding.resolution.resolvedAt;

        await this.db.put(finding);
        await this.writeAuditEvent(tenantId, finding.matrixId, 'finding_resolved', {
          findingId: finding.id,
          code: finding.code,
          reason: ctx.params.reason,
        });

        return { success: true, finding };
      },
    },
  },

  methods: {
    async ingestEvent(ctx, eventName, payload) {
      const tenantId = getTenantId(ctx);
      const processId = payload?.jobId || payload?.requestId || payload?.processId || null;
      if (!processId) return;

      const matrix = await this.findOrCreateEventMatrix(tenantId, processId);
      const taskId = payload?.taskId || 'task-01';
      let task = (matrix.tasks || []).find((t) => t.taskId === taskId);
      if (!task) {
        task = emptyTask(taskId, payload?.taskName || 'Event-driven task');
        matrix.tasks.push(task);
      }

      const candidates = toRoleCandidatesFromEvent(eventName, payload);
      task.executionTrace = Array.isArray(task.executionTrace) ? task.executionTrace : [];
      task.executionTrace.push({
        eventName,
        payload: cleanObject(payload),
        timestamp: payload?.timestamp || nowIso(),
        candidates,
      });

      for (const candidate of candidates) {
        const actor = { actorType: candidate.actorType, actorId: candidate.actorId };
        if (candidate.role === 'V') task.verantwortlich.push(actor);
        if (candidate.role === 'D') {
          if (task.durchfuehrend.length > 0) {
            const existingD = task.durchfuehrend[0];
            const sameActor =
              existingD?.actorType === actor.actorType &&
              existingD?.actorId === actor.actorId;
            if (sameActor) {
              continue;
            }
            throw new MoleculerClientError(
              'Task already has a Durchfuehrend actor. Use human-override or re-assignment.',
              409,
              'CONFLICT_ROLE',
              { taskId: task.taskId, existingD, conflictingCandidate: actor }
            );
          }
          task.durchfuehrend.push(actor);
        }
        if (candidate.role === 'M') task.mitwirkend.push(actor);
        if (candidate.role === 'I') task.information.push(actor);
      }

      task.verantwortlich = uniqueActors(task.verantwortlich);
      task.durchfuehrend = uniqueActors(task.durchfuehrend);
      task.mitwirkend = uniqueActors(task.mitwirkend);
      task.information = uniqueActors(task.information);

      matrix.patternMatchCount = Number(matrix.patternMatchCount || 0) + 1;
      matrix.updatedAt = nowIso();
      matrix.detectionSource = 'moleculer-events';
      matrix.autoDetected = true;

      const shadowSignals = SHADOW_EVENT_PATTERNS.includes(eventName);
      if (shadowSignals) {
        await this.upsertFinding({
          tenantId,
          matrixId: matrix.id,
          code: 'VD_SHADOW_SHAREPOINT_BYPASS_H',
          domain: 'SHADOW',
          severity: 'H',
          status: 'open',
          message: `Shadow-process signal detected: ${eventName}`,
          evidenceRefs: [eventName],
        });
      }

      if (
        matrix.patternMatchCount >=
        Number(matrix.promotionThreshold || this.settings.promotionThreshold)
      ) {
        matrix.nominationStatus = matrix.nominationStatus || 'pending';
      }

      await this.db.put(matrix);
    },

    async findOrCreateEventMatrix(tenantId, processId) {
      const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
      const existing = docs
        .filter((doc) => doc.processId === processId)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0];
      if (existing) return existing;

      const ts = nowIso();
      const id = crypto.randomUUID();
      const doc = {
        _id: `${DOC_PREFIX}${id}`,
        id,
        type: 'vdmi-matrix',
        tenantId,
        processId,
        processType: 'adhoc',
        standardMatrixId: null,
        standardMatrixVersion: null,
        name: `Auto matrix ${processId}`,
        scope: 'event-ingest',
        assetCategory: null,
        regulatoryBasis: [],
        tasks: [],
        status: 'active',
        createdAt: ts,
        updatedAt: ts,
        completedAt: null,
        autoDetected: true,
        detectionSource: 'moleculer-events',
        detectionConfidence: 0.8,
        nominationStatus: null,
        nominatedBy: null,
        nominatedAt: null,
        nominationHitlItemId: null,
        eventPatternHash: null,
        patternMatchCount: 0,
        promotionThreshold: this.settings.promotionThreshold,
        version: 1,
        history: [],
        evidence: [],
        findings: [],
        tasksById: {},
      };
      await this.db.put(doc);
      return doc;
    },

    async getTenantDocsByPrefix(prefix, tenantId, includeSystemTemplates = false) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\uffff`,
      });
      return result.rows
        .map((row) => row.doc)
        .filter(Boolean)
        .filter((doc) => {
          if (doc.tenantId === tenantId) return true;
          if (includeSystemTemplates && doc.tenantId === null) return true;
          return false;
        });
    },

    async getMatrixOrThrow(id, tenantId) {
      try {
        const doc = await this.db.get(`${DOC_PREFIX}${id}`);
        if (doc.tenantId !== tenantId) {
          throw new MoleculerClientError('Matrix not found', 404, 'VDMI_NOT_FOUND');
        }
        return doc;
      } catch (err) {
        if (err.status === 404 || err.code === 'VDMI_NOT_FOUND') {
          throw new MoleculerClientError('Matrix not found', 404, 'VDMI_NOT_FOUND', { id });
        }
        throw err;
      }
    },

    async getFindingOrThrow(findingId, tenantId) {
      try {
        const doc = await this.db.get(`${FINDING_PREFIX}${findingId}`);
        if (doc.tenantId !== tenantId) {
          throw new MoleculerClientError('Finding not found', 404, 'VDMI_FINDING_NOT_FOUND');
        }
        return doc;
      } catch (err) {
        if (err.status === 404 || err.code === 'VDMI_FINDING_NOT_FOUND') {
          throw new MoleculerClientError('Finding not found', 404, 'VDMI_FINDING_NOT_FOUND', {
            findingId,
          });
        }
        throw err;
      }
    },

    async getMatrixByTaskId(taskId, tenantId) {
      const docs = await this.getTenantDocsByPrefix(DOC_PREFIX, tenantId);
      return (
        docs
          .filter((doc) => (doc.tasks || []).some((task) => task.taskId === taskId))
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] ||
        null
      );
    },

    async createTemplateFromMatrix(matrix, tenantId, reason) {
      const templateId = `${matrix.processType || 'process'}-${matrix.id.slice(0, 8)}`;
      const version = '1.0.0';
      const ts = nowIso();
      const doc = {
        _id: `${TEMPLATE_PREFIX}${templateId}`,
        id: templateId,
        type: 'vdmi-template',
        tenantId,
        version,
        name: matrix.name,
        description: `Promoted from matrix ${matrix.id}`,
        scope: matrix.scope,
        assetCategory: matrix.assetCategory || null,
        regulatoryBasis: matrix.regulatoryBasis || [],
        certificationScope: 'ISO55001',
        isoClause: '8.1',
        taskTemplates: matrix.tasks || [],
        changelog: [
          {
            version,
            date: ts,
            author: matrix.nominatedBy?.actorId || 'system',
            changes: reason,
          },
        ],
        createdAt: ts,
        updatedAt: ts,
        promotedFromMatrixId: matrix.id,
        isSystemDefault: false,
        usageCount: 0,
      };

      await this.db.put(doc);
      return doc;
    },

    async writeAuditEvent(tenantId, matrixId, action, payload = {}, actor = null) {
      const ts = nowIso();
      const id = crypto.randomUUID();

      // Derive actor from explicit param or backward-compat payload fields
      const resolvedActor = actor || {
        actorType: payload.actorType || 'user',
        actorId: payload.actorId || payload.approver || 'system',
      };

      const doc = {
        _id: `${AUDIT_PREFIX}${id}`,
        id,
        type: 'vdmi-audit',
        tenantId,
        matrixId,
        action,
        actor: resolvedActor,
        payload,
        createdAt: ts,
      };
      await this.db.put(doc);
      return doc;
    },

    async upsertFinding({
      tenantId,
      matrixId,
      code,
      domain,
      severity,
      status,
      message,
      evidenceRefs,
    }) {
      const docs = await this.getTenantDocsByPrefix(FINDING_PREFIX, tenantId);
      const existing = docs.find(
        (doc) => doc.matrixId === matrixId && doc.code === code && doc.status !== 'resolved'
      );
      const ts = nowIso();

      if (existing) {
        existing.status = normalizeFindingStatus(status || existing.status);
        existing.severity = normalizeSeverity(severity || existing.severity);
        existing.message = message || existing.message;
        existing.evidenceRefs = Array.from(
          new Set([...(existing.evidenceRefs || []), ...(evidenceRefs || [])])
        );
        existing.updatedAt = ts;
        existing.occurrenceCount = Number(existing.occurrenceCount || 1) + 1;
        await this.db.put(existing);
        return existing;
      }

      const id = crypto.randomUUID();
      const doc = {
        _id: `${FINDING_PREFIX}${id}`,
        id,
        type: 'vdmi-finding',
        tenantId,
        matrixId,
        code,
        domain,
        severity: normalizeSeverity(severity),
        status: normalizeFindingStatus(status),
        message,
        evidenceRefs: evidenceRefs || [],
        occurrenceCount: 1,
        createdAt: ts,
        updatedAt: ts,
      };
      await this.db.put(doc);
      return doc;
    },

    toHistorySnapshot(matrix, action, reason, actorId) {
      return {
        at: nowIso(),
        action,
        reason,
        actorId: actorId || 'system',
        previous: {
          name: matrix.name,
          scope: matrix.scope,
          tasks: matrix.tasks,
          status: matrix.status,
          regulatoryBasis: matrix.regulatoryBasis,
          nominationStatus: matrix.nominationStatus,
        },
      };
    },

    toPublicMatrix(doc) {
      return {
        id: doc.id,
        tenantId: doc.tenantId,
        processId: doc.processId,
        processType: doc.processType,
        standardMatrixId: doc.standardMatrixId,
        standardMatrixVersion: doc.standardMatrixVersion,
        name: doc.name,
        scope: doc.scope,
        assetCategory: doc.assetCategory,
        regulatoryBasis: doc.regulatoryBasis || [],
        tasks: doc.tasks || [],
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        completedAt: doc.completedAt,
        autoDetected: doc.autoDetected,
        detectionSource: doc.detectionSource,
        detectionConfidence: doc.detectionConfidence,
        nominationStatus: doc.nominationStatus,
        nominatedBy: doc.nominatedBy,
        nominatedAt: doc.nominatedAt,
        nominationHitlItemId: doc.nominationHitlItemId,
        eventPatternHash: doc.eventPatternHash,
        patternMatchCount: doc.patternMatchCount,
        promotionThreshold: doc.promotionThreshold,
        version: doc.version,
        evidenceCount: (doc.evidence || []).length,
        findingCount: (doc.findings || []).length,
      };
    },

    toPublicTemplate(doc) {
      return {
        id: doc.id,
        version: doc.version,
        tenantId: doc.tenantId,
        name: doc.name,
        description: doc.description,
        scope: doc.scope,
        regulatoryBasis: doc.regulatoryBasis || [],
        certificationScope: doc.certificationScope,
        isoClause: doc.isoClause,
        taskTemplates: doc.taskTemplates || [],
        changelog: doc.changelog || [],
        promotedFromMatrixId: doc.promotedFromMatrixId || null,
        isSystemDefault: Boolean(doc.isSystemDefault),
        usageCount: Number(doc.usageCount || 0),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },
  },
};
