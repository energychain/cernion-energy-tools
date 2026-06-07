'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;

const { validateTenantId } = require('../src/tenant-context');
const {
  normalizeActiveLayer,
  normalizePlanningScenario,
  normalizeZnpAssetContext,
} = require('../src/znp-context-snapshot');  // v0.56.3
const {
  CATALOG_BY_ROLE,
  ALL_ROLE_KEYS,
} = require('../src/evu-operational-persona-catalog');

const DB_PATH = process.env.AGENT_PERSONA_DB_PATH || './data/agent-personas';
const AUDIT_DB_PATH = process.env.AGENT_PERSONA_AUDIT_DB_PATH || './data/agent-persona-audit';
const DEFAULT_AUDIT_RETENTION_DAYS = Number.parseInt(
  process.env.AGENT_PERSONA_AUDIT_RETENTION_DAYS || '90',
  10
);
const DOC_PREFIX = 'persona:';
const AUDIT_DOC_PREFIX = 'resolution-audit:';
const PERSONA_TYPES = Object.freeze(['human', 'specialized-agent']);
const PERSONA_STATUSES = Object.freeze(['active', 'inactive', 'on-leave']);
const CHANNEL_TYPES = Object.freeze(['email', 'telegram', 'signal', 'openclaw-chat']);
const RESOLUTION_MODES = Object.freeze(['context_match', 'handoff', 'system_fallback']);
const OPENAPI_TAG = 'Actor Personas';

// v0.56.1: canonical role identifiers for the Persona-Resolution-Modell
const ROLE_IDS = Object.freeze([
  'grid_planner',
  'asset_mdm_operator',
  'redispatch_coordinator',
  'market_communication_operator',
  'governance_reviewer',
  'system_agent',
]);

function tenantHeaderParameter() {
  return {
    name: 'X-Tenant-Id',
    in: 'header',
    required: false,
    description:
      'Tenant scope for the actor persona registry. The API gateway injects the resolved tenant into action params as tenantId.',
    schema: { type: 'string' },
  };
}

function tenantQueryParameter() {
  return {
    name: 'tenantId',
    in: 'query',
    required: false,
    description: 'Optional tenant fallback when the X-Tenant-Id header is not provided.',
    schema: { type: 'string' },
  };
}

function personaIdPathParameter() {
  return {
    name: 'id',
    in: 'path',
    required: true,
    description: 'Persona identifier within the tenant.',
    schema: { type: 'string' },
  };
}

function rolePathParameter() {
  return {
    name: 'role',
    in: 'path',
    required: true,
    description: 'Assigned role to resolve within the tenant persona registry.',
    schema: { type: 'string' },
  };
}

function personaSchema() {
  return {
    type: 'object',
    required: [
      'tenantId',
      'id',
      'personaName',
      'personaType',
      'assignedRoles',
      'communicationChannels',
      'status',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      tenantId: { type: 'string', example: 'tenant-a' },
      id: { type: 'string', example: 'thorsten-human' },
      personaName: { type: 'string', example: 'Thorsten Zoerner' },
      personaType: { type: 'string', enum: PERSONA_TYPES, example: 'human' },
      openclawUserId: { type: 'string', example: 'openclaw-123', nullable: true },
      assignedRoles: {
        type: 'array',
        items: { type: 'string' },
        example: ['billing@stadtwerk', 'management'],
      },
      communicationChannels: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'address'],
          properties: {
            type: { type: 'string', enum: CHANNEL_TYPES, example: 'email' },
            address: { type: 'string', example: 'thorsten@example.com' },
          },
        },
      },
      defaultPersonalAgentSessionId: {
        type: 'string',
        example: 'pa_12345678',
        nullable: true,
      },
      status: { type: 'string', enum: PERSONA_STATUSES, example: 'active' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      // v0.56.1 — optional, backward-compatible
      roleIds: {
        type: 'array',
        items: { type: 'string' },
        nullable: true,
        example: ['grid_planner'],
      },
      contextAffinities: {
        type: 'object',
        nullable: true,
        example: { workflowTypes: ['grid_connection_validation'], domainIntents: ['grid_planning'] },
      },
      handoffTargets: {
        type: 'array',
        items: { type: 'string' },
        nullable: true,
        example: ['governance-reviewer-agent'],
      },
      resolutionPolicy: {
        type: 'object',
        nullable: true,
        example: { mode: 'auto', priority: 1 },
      },
    },
  };
}

function personaItemResponseSchema() {
  return {
    type: 'object',
    required: ['success', 'item'],
    properties: {
      success: { type: 'boolean', example: true },
      item: personaSchema(),
    },
  };
}

function personaCollectionResponseSchema(includeRole = false) {
  const schema = {
    type: 'object',
    required: ['success', 'tenantId', 'count', 'items'],
    properties: {
      success: { type: 'boolean', example: true },
      tenantId: { type: 'string', example: 'tenant-a' },
      count: { type: 'integer', example: 1 },
      items: {
        type: 'array',
        items: personaSchema(),
      },
    },
  };

  if (includeRole) {
    schema.required.splice(2, 0, 'role');
    schema.properties.role = { type: 'string', example: 'billing@stadtwerk' };
  }

  return schema;
}

function createPersonaRequestBodySchema() {
  return {
    type: 'object',
    required: ['id', 'personaName', 'personaType'],
    properties: {
      id: { type: 'string', example: 'thorsten-human' },
      personaName: { type: 'string', example: 'Thorsten Zoerner' },
      personaType: { type: 'string', enum: PERSONA_TYPES, example: 'human' },
      openclawUserId: { type: 'string', example: 'openclaw-123', nullable: true },
      assignedRoles: {
        type: 'array',
        items: { type: 'string' },
        example: ['billing@stadtwerk'],
      },
      communicationChannels: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'address'],
          properties: {
            type: { type: 'string', enum: CHANNEL_TYPES, example: 'email' },
            address: { type: 'string', example: 'thorsten@example.com' },
          },
        },
      },
      defaultPersonalAgentSessionId: {
        type: 'string',
        example: 'pa_12345678',
        nullable: true,
      },
      status: { type: 'string', enum: PERSONA_STATUSES, example: 'active' },
    },
  };
}

function updatePersonaRequestBodySchema() {
  return {
    type: 'object',
    properties: {
      personaName: { type: 'string', example: 'Thorsten Z.' },
      personaType: { type: 'string', enum: PERSONA_TYPES, example: 'human' },
      openclawUserId: { type: 'string', example: 'openclaw-123', nullable: true },
      assignedRoles: {
        type: 'array',
        items: { type: 'string' },
        example: ['billing@stadtwerk'],
      },
      communicationChannels: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'address'],
          properties: {
            type: { type: 'string', enum: CHANNEL_TYPES, example: 'email' },
            address: { type: 'string', example: 'thorsten@example.com' },
          },
        },
      },
      defaultPersonalAgentSessionId: {
        type: 'string',
        example: 'pa_12345678',
        nullable: true,
      },
      status: { type: 'string', enum: PERSONA_STATUSES, example: 'active' },
    },
  };
}

function itemResponse() {
  return {
    200: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: personaItemResponseSchema(),
        },
      },
    },
  };
}

function collectionResponse(includeRole = false) {
  return {
    200: {
      description: 'Successful response',
      content: {
        'application/json': {
          schema: personaCollectionResponseSchema(includeRole),
        },
      },
    },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function toDocId(tenantId, id) {
  return `${DOC_PREFIX}${tenantId}:${id}`;
}

function tenantPrefix(tenantId) {
  return `${DOC_PREFIX}${tenantId}:`;
}

function auditDocId(tenantId, timestamp, eventId) {
  const ts = trimString(timestamp) || nowIso();
  const eid = trimString(eventId) || crypto.randomUUID();
  return `${AUDIT_DOC_PREFIX}${tenantId}:${ts}:${eid}`;
}

function auditTenantPrefix(tenantId) {
  return `${AUDIT_DOC_PREFIX}${tenantId}:`;
}

function trimString(value) {
  return String(value || '').trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validationError(message, data = {}) {
  return new MoleculerClientError(message, 422, 'VALIDATION_ERROR', data);
}

function conflictError(message, data = {}) {
  return new MoleculerClientError(message, 409, 'PERSONA_ALREADY_EXISTS', data);
}

function notFoundError(tenantId, id) {
  return new MoleculerClientError('Persona not found', 404, 'PERSONA_NOT_FOUND', {
    tenantId,
    id,
  });
}

function forbiddenTenantError(requestedTenantId, callerTenantId) {
  return new MoleculerClientError('Cross-tenant persona access is not allowed', 403, 'PERSONA_TENANT_FORBIDDEN', {
    tenantId: requestedTenantId,
    callerTenantId,
  });
}

module.exports = {
  name: 'agent-persona',

  settings: {
    dbPath: DB_PATH,
    auditDbPath: AUDIT_DB_PATH,
    auditRetentionDays: Number.isFinite(DEFAULT_AUDIT_RETENTION_DAYS)
      ? DEFAULT_AUDIT_RETENTION_DAYS
      : 90,
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
    this.auditDb = new PouchDB(this.settings.auditDbPath, { auto_compaction: true });
  },

  async started() {
    this.logger.info(`Agent Persona DB initialized at ${this.settings.dbPath}`);
    this.logger.info(`Agent Persona Audit DB initialized at ${this.settings.auditDbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
    if (this.auditDb) await this.auditDb.close();
  },

  actions: {
    create: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
        id: { type: 'string', trim: true, min: 1 },
        personaName: { type: 'string', trim: true, min: 1, max: 120 },
        personaType: { type: 'enum', values: PERSONA_TYPES },
        openclawUserId: { type: 'string', trim: true, min: 1, optional: true },
        assignedRoles: {
          type: 'array',
          optional: true,
          default: [],
          items: { type: 'string', trim: true, min: 1 },
        },
        communicationChannels: {
          type: 'array',
          optional: true,
          default: [],
          items: {
            type: 'object',
            props: {
              type: { type: 'enum', values: CHANNEL_TYPES },
              address: { type: 'string', trim: true, min: 1 },
            },
          },
        },
        defaultPersonalAgentSessionId: { type: 'string', trim: true, min: 1, optional: true },
        status: { type: 'enum', values: PERSONA_STATUSES, optional: true, default: 'active' },
        // v0.56.1
        roleIds: { type: 'array', optional: true, default: [], items: { type: 'string', trim: true, min: 1 } },
        contextAffinities: { type: 'object', optional: true },
        handoffTargets: { type: 'array', optional: true, default: [], items: { type: 'string', trim: true, min: 1 } },
        resolutionPolicy: { type: 'object', optional: true },
      },
      openapi: {
        summary: 'Create an actor persona',
        description:
          'Creates a tenant-scoped actor persona for HITL routing, notification delivery, and persona inbox resolution.',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter()],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: createPersonaRequestBodySchema(),
            },
          },
        },
        responses: itemResponse(),
      },
      async handler(ctx) {
        const persona = await this.createPersona(ctx.params, ctx);
        return { success: true, item: this.toPublic(persona) };
      },
    },

    get: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
        id: { type: 'string', trim: true, min: 1 },
      },
      openapi: {
        summary: 'Get an actor persona',
        description: 'Returns one actor persona by id within the resolved tenant scope.',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter(), personaIdPathParameter()],
        responses: itemResponse(),
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const persona = await this.getPersonaOrThrow(tenantId, ctx.params.id);
        return { success: true, item: this.toPublic(persona) };
      },
    },

    list: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
      },
      openapi: {
        summary: 'List actor personas',
        description: 'Lists all actor personas for the resolved tenant scope.',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter()],
        responses: collectionResponse(false),
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const personas = await this.getTenantPersonas(tenantId);
        const items = personas
          .slice()
          .sort(this.sortByNameThenId)
          .map((persona) => this.toPublic(persona));

        return { success: true, tenantId, count: items.length, items };
      },
    },

    update: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
        id: { type: 'string', trim: true, min: 1 },
        personaName: { type: 'string', trim: true, min: 1, max: 120, optional: true },
        personaType: { type: 'enum', values: PERSONA_TYPES, optional: true },
        openclawUserId: { type: 'string', trim: true, min: 1, optional: true },
        assignedRoles: {
          type: 'array',
          optional: true,
          items: { type: 'string', trim: true, min: 1 },
        },
        communicationChannels: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              type: { type: 'enum', values: CHANNEL_TYPES },
              address: { type: 'string', trim: true, min: 1 },
            },
          },
        },
        defaultPersonalAgentSessionId: { type: 'string', trim: true, min: 1, optional: true },
        status: { type: 'enum', values: PERSONA_STATUSES, optional: true },
        // v0.56.1
        roleIds: { type: 'array', optional: true, items: { type: 'string', trim: true, min: 1 } },
        contextAffinities: { type: 'object', optional: true },
        handoffTargets: { type: 'array', optional: true, items: { type: 'string', trim: true, min: 1 } },
        resolutionPolicy: { type: 'object', optional: true },
      },
      openapi: {
        summary: 'Update an actor persona',
        description: 'Updates one actor persona within the resolved tenant scope.',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter(), personaIdPathParameter()],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: updatePersonaRequestBodySchema(),
            },
          },
        },
        responses: itemResponse(),
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const updated = await this.updatePersona(tenantId, ctx.params.id, ctx.params);
        return { success: true, item: this.toPublic(updated) };
      },
    },

    remove: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
        id: { type: 'string', trim: true, min: 1 },
      },
      openapi: {
        summary: 'Deactivate an actor persona',
        description:
          'Soft-deactivates an actor persona within the resolved tenant scope while preserving the record for auditability.',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter(), personaIdPathParameter()],
        responses: itemResponse(),
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const updated = await this.deactivatePersona(tenantId, ctx.params.id);
        return { success: true, item: this.toPublic(updated) };
      },
    },

    listByRole: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
        role: { type: 'string', trim: true, min: 1 },
      },
      openapi: {
        summary: 'List actor personas by role',
        description: 'Lists all active actor personas matching one role inside the resolved tenant scope.',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter(), rolePathParameter()],
        responses: collectionResponse(true),
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const items = await this.findByRole(tenantId, ctx.params.role);
        return { success: true, tenantId, role: ctx.params.role, count: items.length, items };
      },
    },

    resolveByRole: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
        role: { type: 'string', trim: true, min: 1 },
      },
      openapi: {
        summary: 'Resolve actor personas by role',
        description:
          'Returns active actor personas for one role in deterministic name/id order for the resolved tenant scope.',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter(), rolePathParameter()],
        responses: collectionResponse(true),
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const items = await this.findByRole(tenantId, ctx.params.role);
        return { success: true, tenantId, role: ctx.params.role, count: items.length, items };
      },
    },

    updateAvailability: {
      rest: 'PUT /personas/:id/availability',
      params: {
        tenantId: { type: 'string', optional: true },
        id: { type: 'string', trim: true, min: 1 },
        available: { type: 'boolean', optional: true },
        availabilityWindow: { type: 'object', optional: true, props: {
          startHour: { type: 'number', integer: true, min: 0, max: 23, optional: true },
          endHour: { type: 'number', integer: true, min: 0, max: 23, optional: true },
          timezone: { type: 'string', optional: true, default: 'UTC' },
        }},
      },
      openapi: {
        summary: 'Update persona availability status and windows',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter(), personaIdPathParameter()],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  available: { type: 'boolean', example: true },
                  availabilityWindow: {
                    type: 'object',
                    properties: {
                      startHour: { type: 'integer', example: 9 },
                      endHour: { type: 'integer', example: 17 },
                      timezone: { type: 'string', example: 'Europe/Berlin' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const updated = await this.updatePersonaAvailability(tenantId, ctx.params.id, ctx.params);
        return { success: true, item: this.toPublic(updated) };
      },
    },

    recordPersonaActivity: {
      rest: 'POST /personas/:id/record-activity',
      params: {
        tenantId: { type: 'string', optional: true },
        id: { type: 'string', trim: true, min: 1 },
        activityType: { type: 'string', trim: true, optional: true, default: 'interaction' },
      },
      openapi: {
        summary: 'Record persona last-seen activity for availability tracking',
        tags: [OPENAPI_TAG],
        parameters: [tenantHeaderParameter(), tenantQueryParameter(), personaIdPathParameter()],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  activityType: { type: 'string', example: 'interaction', enum: ['interaction', 'approval', 'message'] },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const updated = await this.recordLastSeenActivity(tenantId, ctx.params.id);
        return { success: true, item: this.toPublic(updated) };
      },
    },

    /**
     * v0.56.1 — Internal persona resolution. No REST/OpenAPI endpoint.
     * Resolves the best-matching active persona for a given context within the
     * caller's tenant. Read-only, tenant-isolated, availability-aware, deterministic.
     * No L4/prompt/tool-call raw payloads are persisted or returned.
     */
    resolvePersona: {
      params: {
        tenantId: { type: 'string', optional: true },
        sessionId: { type: 'string', optional: true },
        sourceService: { type: 'string', optional: true },
        sourceAction: { type: 'string', optional: true },
        workflowType: { type: 'string', optional: true },
        domainIntent: { type: 'string', optional: true },
        znpProjectId: { type: 'string', optional: true },
        activeLayer: { type: 'string', optional: true },
        planningScenario: { type: 'string', optional: true },   // v0.56.3
        assetContext: { type: 'object', optional: true },
        hitlItemId: { type: 'string', optional: true },
        workflowCompletionState: { type: 'string', optional: true },
        handoffPersonaId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        // Whitelist safe scalar signals only — raw prompts and L4/tool-call
        // payloads are intentionally excluded from context.
        // assetContext is normalized to { assetType, capacityClass } only.
        const context = {
          sourceService: trimString(ctx.params.sourceService),
          sourceAction: trimString(ctx.params.sourceAction),
          workflowType: trimString(ctx.params.workflowType),
          domainIntent: trimString(ctx.params.domainIntent),
          activeLayer: normalizeActiveLayer(ctx.params.activeLayer),       // v0.56.3
          planningScenario: normalizePlanningScenario(ctx.params.planningScenario), // v0.56.3
          assetContext: normalizeZnpAssetContext(ctx.params.assetContext),  // v0.56.3
          handoffPersonaId: trimString(ctx.params.handoffPersonaId),
        };
        const result = await this.resolvePersonaForContext(tenantId, context);
        if (result?.success && result?.resolvedPersona) {
          const auditEventId = crypto.randomUUID();
          const payload = this.buildResolvedAuditEventPayload({
            eventId: auditEventId,
            tenantId,
            sessionId: trimString(ctx.params.sessionId),
            resolvedPersona: result.resolvedPersona,
          });
          this.emitResolvedAuditEventSafe(payload);
          await this.persistResolvedAuditRecordSafe(payload);
          return {
            ...result,
            auditEventId,
          };
        }
        return result;
      },
    },

    queryResolutionAudits: {
      params: {
        tenantId: { type: 'string', optional: true },
        from: { type: 'string', optional: true },
        to: { type: 'string', optional: true },
        personaId: { type: 'string', optional: true },
        roleId: { type: 'string', optional: true },
        resolutionMode: { type: 'enum', values: RESOLUTION_MODES, optional: true },
        limit: { type: 'number', integer: true, min: 1, max: 500, optional: true, convert: true, default: 100 },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantScopeForAudit(ctx, ctx.params.tenantId);
        const filters = this.normalizeAuditQueryFilters(ctx.params);
        const items = await this.listResolutionAuditsForTenant(tenantId, filters);
        return {
          success: true,
          tenantId,
          count: items.length,
          items,
        };
      },
    },

    summarizeResolutionAudits: {
      params: {
        tenantId: { type: 'string', optional: true },
        from: { type: 'string', optional: true },
        to: { type: 'string', optional: true },
        personaId: { type: 'string', optional: true },
        roleId: { type: 'string', optional: true },
        resolutionMode: { type: 'enum', values: RESOLUTION_MODES, optional: true },
        limit: { type: 'number', integer: true, min: 1, max: 500, optional: true, convert: true, default: 500 },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantScopeForAudit(ctx, ctx.params.tenantId);
        const filters = this.normalizeAuditQueryFilters(ctx.params);
        const items = await this.listResolutionAuditsForTenant(tenantId, filters);
        return {
          success: true,
          tenantId,
          summary: this.buildResolutionAuditSummary(items),
        };
      },
    },

    /**
     * Idempotent seed of EVU-standard operational personas for a tenant.
     * Only creates missing entries; with overwrite:true replaces them from the catalog.
     * Never touches personas outside the EVU catalog. No notifications or webhooks.
     */
    seedOperationalDefaults: {
      params: {
        tenantId: { type: 'string', trim: true, min: 1 },
        roles: {
          type: 'array',
          optional: true,
          items: { type: 'string', trim: true, min: 1 },
        },
        overwrite: { type: 'boolean', optional: true, default: false },
      },
      async handler(ctx) {
        const tenantId = this.assertTenantAccess(ctx, ctx.params.tenantId);
        const result = await this.seedEvuOperationalPersonas(tenantId, {
          roles: ctx.params.roles,
          overwrite: ctx.params.overwrite === true,
        });
        return result;
      },
    },

    pruneResolutionAudits: {
      params: {
        tenantId: { type: 'string', optional: true },
        olderThanDays: {
          type: 'number',
          integer: true,
          min: 0,
          max: 3650,
          optional: true,
          convert: true,
        },
      },
      async handler(ctx) {
        const tenantId = this.resolveTenantScopeForAudit(ctx, ctx.params.tenantId);
        const retentionDays = Number.isFinite(ctx.params.olderThanDays)
          ? Number(ctx.params.olderThanDays)
          : Number(this.settings.auditRetentionDays || 90);
        const pruned = await this.pruneResolutionAuditsForTenant(tenantId, retentionDays);
        return {
          success: true,
          tenantId,
          retentionDays,
          deletedCount: pruned.deletedCount,
          inspectedCount: pruned.inspectedCount,
          cutoffTimestamp: pruned.cutoffTimestamp,
        };
      },
    },
  },

  methods: {
    assertTenantAccess(ctx, requestedTenantId) {
      const tenantId = this.normalizeTenantId(requestedTenantId);
      const callerTenantId = trimString(ctx?.meta?.tenantId || ctx?.meta?.user?.tenantId);

      if (callerTenantId && callerTenantId !== tenantId) {
        throw forbiddenTenantError(tenantId, callerTenantId);
      }

      return tenantId;
    },

    normalizeTenantId(tenantId) {
      const normalized = trimString(tenantId);
      if (!normalized) {
        throw validationError('tenantId is required', { field: 'tenantId' });
      }

      validateTenantId(normalized);
      return normalized;
    },

    resolveTenantScopeForAudit(ctx, requestedTenantId) {
      const requested = trimString(requestedTenantId);
      if (requested) {
        return this.assertTenantAccess(ctx, requested);
      }

      const callerTenantId = trimString(ctx?.meta?.tenantId || ctx?.meta?.user?.tenantId);
      if (!callerTenantId) {
        throw validationError('tenantId is required', { field: 'tenantId' });
      }

      return this.normalizeTenantId(callerTenantId);
    },

    normalizePersonaId(id) {
      const normalized = trimString(id);
      if (!normalized) {
        throw validationError('id is required', { field: 'id' });
      }
      return normalized;
    },

    normalizePersonaName(value) {
      const normalized = trimString(value);
      if (!normalized) {
        throw validationError('personaName is required', { field: 'personaName' });
      }
      return normalized;
    },

    normalizePersonaType(value) {
      const normalized = trimString(value);
      if (!PERSONA_TYPES.includes(normalized)) {
        throw validationError('personaType must be human or specialized-agent', {
          field: 'personaType',
        });
      }
      return normalized;
    },

    normalizeStatus(value = 'active') {
      const normalized = trimString(value || 'active');
      if (!PERSONA_STATUSES.includes(normalized)) {
        throw validationError('status must be active, inactive, or on-leave', {
          field: 'status',
        });
      }
      return normalized;
    },

    normalizeRoles(value = []) {
      if (!Array.isArray(value)) {
        throw validationError('assignedRoles must be an array', { field: 'assignedRoles' });
      }

      return Array.from(new Set(value.map((entry) => trimString(entry)).filter(Boolean)));
    },

    normalizeChannels(value = []) {
      if (!Array.isArray(value)) {
        throw validationError('communicationChannels must be an array', {
          field: 'communicationChannels',
        });
      }

      return value.map((channel, index) => {
        if (!isPlainObject(channel)) {
          throw validationError('communicationChannels entries must be objects', {
            field: `communicationChannels[${index}]`,
          });
        }

        const type = trimString(channel.type);
        const address = trimString(channel.address);

        if (!CHANNEL_TYPES.includes(type)) {
          throw validationError('communicationChannels.type is invalid', {
            field: `communicationChannels[${index}].type`,
          });
        }

        if (!address) {
          throw validationError('communicationChannels.address must be non-empty', {
            field: `communicationChannels[${index}].address`,
          });
        }

        return { type, address };
      });
    },

    normalizeOptionalString(value, field) {
      if (value == null) return null;
      const normalized = trimString(value);
      if (!normalized) {
        throw validationError(`${field} must be a non-empty string when provided`, { field });
      }
      return normalized;
    },

    validatePersonaSemantics(persona) {
      if (persona.personaType === 'specialized-agent' && persona.openclawUserId) {
        throw validationError('openclawUserId is only meaningful for human personas', {
          field: 'openclawUserId',
        });
      }

      if (persona.personaType === 'human' && persona.openclawUserId != null) {
        persona.openclawUserId = this.normalizeOptionalString(persona.openclawUserId, 'openclawUserId');
      }

      if (!Array.isArray(persona.assignedRoles)) {
        throw validationError('assignedRoles must be an array', { field: 'assignedRoles' });
      }

      persona.assignedRoles = this.normalizeRoles(persona.assignedRoles);
      persona.communicationChannels = this.normalizeChannels(persona.communicationChannels);

      if (persona.defaultPersonalAgentSessionId != null) {
        persona.defaultPersonalAgentSessionId = this.normalizeOptionalString(
          persona.defaultPersonalAgentSessionId,
          'defaultPersonalAgentSessionId'
        );
      }

      if (!PERSONA_STATUSES.includes(persona.status)) {
        throw validationError('status must be active, inactive, or on-leave', {
          field: 'status',
        });
      }

      return persona;
    },

    async loadPersonaDocument(tenantId, id) {
      const docId = toDocId(tenantId, id);

      try {
        return await this.db.get(docId);
      } catch (err) {
        if (err?.status === 404) {
          throw notFoundError(tenantId, id);
        }
        throw err;
      }
    },

    async getPersonaOrThrow(tenantId, id) {
      return this.loadPersonaDocument(tenantId, id);
    },

    async getTenantPersonas(tenantId) {
      const prefix = tenantPrefix(tenantId);
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\ufff0`,
      });

      return result.rows.map((row) => row.doc).filter(Boolean);
    },

    async createPersona(params, ctx) {
      const tenantId = this.assertTenantAccess(ctx, params.tenantId);
      const id = this.normalizePersonaId(params.id);
      const docId = toDocId(tenantId, id);

      let existing = null;
      try {
        existing = await this.db.get(docId);
      } catch (err) {
        if (err?.status !== 404) {
          throw err;
        }
      }

      if (existing) {
        throw conflictError('Persona already exists in this tenant', { tenantId, id });
      }

      const persona = this.validatePersonaSemantics({
        _id: docId,
        docType: 'agent-persona',
        tenantId,
        id,
        personaName: this.normalizePersonaName(params.personaName),
        personaType: this.normalizePersonaType(params.personaType),
        openclawUserId: this.normalizeOptionalString(params.openclawUserId, 'openclawUserId'),
        assignedRoles: this.normalizeRoles(params.assignedRoles),
        communicationChannels: this.normalizeChannels(params.communicationChannels),
        defaultPersonalAgentSessionId: this.normalizeOptionalString(
          params.defaultPersonalAgentSessionId,
          'defaultPersonalAgentSessionId'
        ),
        status: this.normalizeStatus(params.status || 'active'),
        available: true,
        lastSeenAt: new Date().toISOString(),
        availabilityWindow: { startHour: 0, endHour: 24, timezone: 'UTC' },
        // v0.56.1
        roleIds: this.normalizeRoleIds(params.roleIds),
        contextAffinities: this.normalizeContextAffinities(params.contextAffinities),
        handoffTargets: this.normalizeHandoffTargets(params.handoffTargets),
        resolutionPolicy: this.normalizeResolutionPolicy(params.resolutionPolicy),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });

      try {
        await this.db.put(persona);
      } catch (err) {
        if (err?.status === 409) {
          throw conflictError('Persona already exists in this tenant', { tenantId, id });
        }
        throw err;
      }

      return persona;
    },

    async updatePersona(tenantId, id, params) {
      const current = await this.getPersonaOrThrow(tenantId, id);
      const updated = this.validatePersonaSemantics({
        ...current,
        personaName:
          params.personaName !== undefined
            ? this.normalizePersonaName(params.personaName)
            : current.personaName,
        personaType:
          params.personaType !== undefined
            ? this.normalizePersonaType(params.personaType)
            : current.personaType,
        openclawUserId:
          params.openclawUserId !== undefined
            ? this.normalizeOptionalString(params.openclawUserId, 'openclawUserId')
            : current.openclawUserId,
        assignedRoles:
          params.assignedRoles !== undefined ? this.normalizeRoles(params.assignedRoles) : current.assignedRoles,
        communicationChannels:
          params.communicationChannels !== undefined
            ? this.normalizeChannels(params.communicationChannels)
            : current.communicationChannels,
        defaultPersonalAgentSessionId:
          params.defaultPersonalAgentSessionId !== undefined
            ? this.normalizeOptionalString(
                params.defaultPersonalAgentSessionId,
                'defaultPersonalAgentSessionId'
              )
            : current.defaultPersonalAgentSessionId,
        status: params.status !== undefined ? this.normalizeStatus(params.status) : current.status,
        // v0.56.1
        roleIds: params.roleIds !== undefined ? this.normalizeRoleIds(params.roleIds) : current.roleIds,
        contextAffinities:
          params.contextAffinities !== undefined
            ? this.normalizeContextAffinities(params.contextAffinities)
            : current.contextAffinities,
        handoffTargets:
          params.handoffTargets !== undefined
            ? this.normalizeHandoffTargets(params.handoffTargets)
            : current.handoffTargets,
        resolutionPolicy:
          params.resolutionPolicy !== undefined
            ? this.normalizeResolutionPolicy(params.resolutionPolicy)
            : current.resolutionPolicy,
        updatedAt: nowIso(),
      });

      await this.db.put(updated);
      return updated;
    },

    async deactivatePersona(tenantId, id) {
      const current = await this.getPersonaOrThrow(tenantId, id);
      const updated = {
        ...current,
        status: 'inactive',
        updatedAt: nowIso(),
      };

      await this.db.put(updated);
      return updated;
    },

    async findByRole(tenantId, role) {
      const normalizedRole = trimString(role);
      if (!normalizedRole) {
        throw validationError('role is required', { field: 'role' });
      }

      const personas = await this.getTenantPersonas(tenantId);
      const items = personas
        .filter((persona) => persona.status === 'active')
        .filter((persona) => Array.isArray(persona.assignedRoles) && persona.assignedRoles.includes(normalizedRole))
        .sort(this.sortByNameThenId)
        .map((persona) => this.toPublic(persona));

      return items;
    },

    sortByNameThenId(left, right) {
      const nameCompare = String(left?.personaName || '').localeCompare(String(right?.personaName || ''));
      if (nameCompare !== 0) return nameCompare;
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    },

    toPublic(doc) {
      if (!doc) return null;
      // eslint-disable-next-line no-unused-vars
      const { _id, _rev, docType, ...rest } = doc;
      return { ...rest };
    },

    async updatePersonaAvailability(tenantId, id, params) {
      const current = await this.getPersonaOrThrow(tenantId, id);
      const updated = {
        ...current,
        available: params.available !== undefined ? params.available : current.available,
        availabilityWindow: params.availabilityWindow || current.availabilityWindow || { startHour: 0, endHour: 24, timezone: 'UTC' },
        updatedAt: nowIso(),
      };

      await this.db.put(updated);
      return updated;
    },

    async recordLastSeenActivity(tenantId, id) {
      const current = await this.getPersonaOrThrow(tenantId, id);
      const updated = {
        ...current,
        lastSeenAt: nowIso(),
        updatedAt: nowIso(),
      };

      await this.db.put(updated);
      return updated;
    },

    // -------------------------------------------------------------------------
    // v0.56.1 — normalization helpers
    // -------------------------------------------------------------------------

    normalizeRoleIds(value) {
      if (!Array.isArray(value)) return [];
      const normalized = value.map((v) => trimString(v)).filter(Boolean);
      const unknown = normalized.filter((v) => !ROLE_IDS.includes(v));
      if (unknown.length > 0) {
        throw validationError(
          `roleIds contains unknown role identifier(s): ${unknown.join(', ')}. ` +
            `Allowed values are: ${ROLE_IDS.join(', ')}`,
          { field: 'roleIds', unknownRoles: unknown }
        );
      }
      return normalized;
    },

    normalizeContextAffinities(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      const ALLOWED_KEYS = [
        'workflowTypes', 'domainIntents', 'activeLayers',
        'planningScenarios', 'assetTypes',           // v0.56.3
        'sourceServices', 'sourceActions',
      ];
      const result = {};
      for (const key of ALLOWED_KEYS) {
        if (Array.isArray(value[key])) {
          result[key] = value[key].map((v) => trimString(v)).filter(Boolean);
        }
      }
      return result;
    },

    normalizeHandoffTargets(value) {
      if (!Array.isArray(value)) return [];
      return value.map((v) => trimString(v)).filter(Boolean);
    },

    normalizeResolutionPolicy(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      return {
        mode: trimString(value.mode) || 'auto',
        priority: Number.isFinite(Number(value.priority)) ? Number(value.priority) : 0,
      };
    },

    // -------------------------------------------------------------------------
    // v0.56.1 — resolution engine
    // -------------------------------------------------------------------------

    /**
     * Core resolution logic — tenant-isolated, availability-aware, deterministic.
     * Returns an explicitly whitelisted resolvedPersona object.
     * No raw L4/prompt/tool-call payloads are ever stored or returned.
     */
    async resolvePersonaForContext(tenantId, context = {}) {
      const personas = await this.getTenantPersonas(tenantId);
      const activePersonas = personas.filter((p) => p.status === 'active');

      // --- step 3: handoff — tenant-safe, fail-closed ---
      if (context.handoffPersonaId) {
        const target = activePersonas.find((p) => p.id === context.handoffPersonaId);
        if (target && this.isPersonaAvailable(target)) {
          const fallbacks = activePersonas
            .filter((p) => p.id !== target.id)
            .sort(this.sortByNameThenId)
            .map((p) => p.id);
          return this.buildResolution(target, 'handoff', ['handoffPersonaId'], fallbacks);
        }
        // fail-closed: unknown or unavailable handoffPersonaId is silently ignored;
        // no other tenant's data is ever exposed.
      }

      // --- steps 4–6: context signal scoring + availability (step 7) ---
      const scored = activePersonas.map((p) => this.scorePersona(p, context));
      const withScore = scored.filter((s) => s.score > 0);
      const availableWithScore = withScore.filter((s) => this.isPersonaAvailable(s.persona));

      // step 8: deterministic sort — score desc, then id asc
      const sorter = (a, b) =>
        b.score - a.score || String(a.persona.id).localeCompare(String(b.persona.id));

      if (availableWithScore.length > 0) {
        availableWithScore.sort(sorter);
        const winner = availableWithScore[0];
        const unavailableWithScore = withScore
          .filter((s) => !this.isPersonaAvailable(s.persona))
          .sort(sorter);
        const fallbacks = [...availableWithScore.slice(1), ...unavailableWithScore].map(
          (s) => s.persona.id
        );
        return this.buildResolution(winner.persona, 'context_match', winner.signals, fallbacks);
      }

      if (withScore.length > 0) {
        // no available functional match — use best unavailable scorer as winner
        withScore.sort(sorter);
        const winner = withScore[0];
        const fallbacks = withScore.slice(1).map((s) => s.persona.id);
        return this.buildResolution(winner.persona, 'context_match', winner.signals, fallbacks);
      }

      // step 10: system_agent fallback
      return this.buildSystemAgentFallback(activePersonas);
    },

    /**
     * Score a persona against whitelisted context signals.
     * Weights: workflowType=3, domainIntent=3, activeLayer=2,
     *          sourceService=1, sourceAction=1
     */
    scorePersona(persona, context = {}) {
      const affinities =
        persona.contextAffinities && typeof persona.contextAffinities === 'object'
          ? persona.contextAffinities
          : {};

      let score = 0;
      const signals = [];

      const check = (value, key, weight, label) => {
        const normalized = trimString(value);
        if (!normalized) return;
        const list = Array.isArray(affinities[key]) ? affinities[key] : [];
        if (list.some((v) => trimString(v) === normalized)) {
          score += weight;
          signals.push(label);
        }
      };

      check(context.workflowType, 'workflowTypes', 3, 'workflowType');
      check(context.domainIntent, 'domainIntents', 3, 'domainIntent');
      check(context.activeLayer, 'activeLayers', 2, 'activeLayer');
      check(context.planningScenario, 'planningScenarios', 2, 'planningScenario'); // v0.56.3
      check(context.assetContext?.assetType, 'assetTypes', 1, 'assetType');        // v0.56.3
      check(context.sourceService, 'sourceServices', 1, 'sourceService');
      check(context.sourceAction, 'sourceActions', 1, 'sourceAction');

      return { persona, score, signals: signals.sort() };
    },

    isPersonaAvailable(persona) {
      return persona.available !== false;
    },

    /**
     * Build the whitelisted resolution response.
     * Only the 8 specified fields are returned — no raw payloads.
     */
    buildResolution(persona, resolutionMode, matchedSignals, fallbackPersonaIds) {
      const roleId =
        Array.isArray(persona.roleIds) && persona.roleIds.length > 0 ? persona.roleIds[0] : null;
      return {
        success: true,
        resolvedPersona: {
          personaId: persona.id,
          roleId,
          confidence: this.computeResolutionConfidence(resolutionMode, matchedSignals),
          resolutionMode,
          availability: this.isPersonaAvailable(persona),
          matchedSignals: [...matchedSignals].sort(),
          fallbackPersonaIds: [...fallbackPersonaIds],
          policy: persona.resolutionPolicy || null,
        },
      };
    },

    computeResolutionConfidence(resolutionMode, matchedSignals) {
      if (resolutionMode === 'handoff') return 1.0;
      if (resolutionMode === 'system_fallback') return 0.1;
      return Math.min(1.0, 0.4 + matchedSignals.length * 0.15);
    },

    buildSystemAgentFallback(activePersonas) {
      const systemAgentPersona = activePersonas.find(
        (p) => Array.isArray(p.roleIds) && p.roleIds.includes('system_agent')
      );

      const allFallbacks = activePersonas
        .filter((p) => !systemAgentPersona || p.id !== systemAgentPersona.id)
        .sort(this.sortByNameThenId)
        .map((p) => p.id);

      if (systemAgentPersona) {
        return {
          success: true,
          resolvedPersona: {
            personaId: systemAgentPersona.id,
            roleId: 'system_agent',
            confidence: 0.1,
            resolutionMode: 'system_fallback',
            availability: this.isPersonaAvailable(systemAgentPersona),
            matchedSignals: [],
            fallbackPersonaIds: allFallbacks,
            policy: systemAgentPersona.resolutionPolicy || null,
          },
        };
      }

      // No system_agent persona in this tenant — stable synthetic fallback
      return {
        success: true,
        resolvedPersona: {
          personaId: null,
          roleId: 'system_agent',
          confidence: 0.05,
          resolutionMode: 'system_fallback',
          availability: false,
          matchedSignals: [],
          fallbackPersonaIds: [],
          policy: null,
        },
      };
    },

    // -------------------------------------------------------------------------
    // v0.56.4 — audit event emission (best-effort, strict whitelist)
    // -------------------------------------------------------------------------

    buildResolvedAuditEventPayload({ eventId, tenantId, sessionId, resolvedPersona } = {}) {
      const rp = resolvedPersona && typeof resolvedPersona === 'object' ? resolvedPersona : {};
      return {
        eventId: trimString(eventId) || crypto.randomUUID(),
        tenantId: trimString(tenantId) || null,
        sessionId: trimString(sessionId) || null,
        personaId: trimString(rp.personaId) || null,
        roleId: trimString(rp.roleId) || null,
        resolutionMode: trimString(rp.resolutionMode) || null,
        confidence: typeof rp.confidence === 'number' ? rp.confidence : null,
        matchedSignals: Array.isArray(rp.matchedSignals) ? rp.matchedSignals.slice(0, 32) : [],
        fallbackPersonaIds: Array.isArray(rp.fallbackPersonaIds) ? rp.fallbackPersonaIds.slice(0, 64) : [],
        resolved: true,
        reason: null,
        timestamp: new Date().toISOString(),
      };
    },

    emitResolvedAuditEventSafe(payload) {
      try {
        this.broker.emit('agent-persona.resolved', payload);
      } catch (error) {
        this.logger?.warn(
          `agent-persona.resolved emit failed for eventId=${payload?.eventId || 'n/a'}: ${error.message}`
        );
      }
    },

    async persistResolvedAuditRecordSafe(payload) {
      try {
        await this.persistResolvedAuditRecord(payload);
      } catch (error) {
        this.logger?.warn(
          `agent-persona resolution audit persistence failed for eventId=${payload?.eventId || 'n/a'}: ${error.message}`
        );
      }
    },

    async persistResolvedAuditRecord(payload) {
      const doc = this.buildResolutionAuditDoc(payload);
      await this.auditDb.put(doc);
      return doc;
    },

    buildResolutionAuditDoc(payload = {}) {
      const tenantId = trimString(payload.tenantId);
      if (!tenantId) {
        throw validationError('tenantId is required for audit persistence', { field: 'tenantId' });
      }

      const eventId = trimString(payload.eventId) || crypto.randomUUID();
      const timestamp = trimString(payload.timestamp) || nowIso();
      return {
        _id: auditDocId(tenantId, timestamp, eventId),
        docType: 'agent-persona-resolution-audit',
        eventId,
        tenantId,
        sessionId: trimString(payload.sessionId) || null,
        personaId: trimString(payload.personaId) || null,
        roleId: trimString(payload.roleId) || null,
        resolutionMode: trimString(payload.resolutionMode) || null,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
        matchedSignals: Array.isArray(payload.matchedSignals) ? payload.matchedSignals.slice(0, 32) : [],
        fallbackPersonaIds: Array.isArray(payload.fallbackPersonaIds)
          ? payload.fallbackPersonaIds.slice(0, 64)
          : [],
        resolved: payload.resolved === true,
        reason: payload.reason == null ? null : trimString(payload.reason) || null,
        timestamp,
      };
    },

    normalizeAuditQueryFilters(params = {}) {
      const from = trimString(params.from);
      const to = trimString(params.to);
      const fromMs = from ? Date.parse(from) : null;
      const toMs = to ? Date.parse(to) : null;

      if (from && Number.isNaN(fromMs)) {
        throw validationError('from must be a valid ISO datetime', { field: 'from' });
      }
      if (to && Number.isNaN(toMs)) {
        throw validationError('to must be a valid ISO datetime', { field: 'to' });
      }
      if (fromMs != null && toMs != null && fromMs > toMs) {
        throw validationError('from must be before or equal to to', { field: 'from' });
      }

      return {
        fromMs,
        toMs,
        personaId: trimString(params.personaId) || null,
        roleId: trimString(params.roleId) || null,
        resolutionMode: trimString(params.resolutionMode) || null,
        limit: Number.isFinite(params.limit) ? Number(params.limit) : 100,
      };
    },

    async listResolutionAuditsForTenant(tenantId, filters = {}) {
      const prefix = auditTenantPrefix(tenantId);
      const result = await this.auditDb.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\ufff0`,
      });

      const rows = result.rows
        .map((row) => row.doc)
        .filter(Boolean)
        .filter((doc) => this.matchesResolutionAuditFilter(doc, filters))
        .sort((left, right) => {
          const l = Date.parse(left.timestamp || 0);
          const r = Date.parse(right.timestamp || 0);
          if (!Number.isNaN(r - l) && r !== l) return r - l;
          return String(right.eventId || '').localeCompare(String(left.eventId || ''));
        })
        .slice(0, Number.isFinite(filters.limit) ? filters.limit : 100);

      return rows.map((doc) => this.toPublicAudit(doc));
    },

    matchesResolutionAuditFilter(doc, filters = {}) {
      const ts = Date.parse(doc.timestamp || '');
      if (filters.fromMs != null && (Number.isNaN(ts) || ts < filters.fromMs)) return false;
      if (filters.toMs != null && (Number.isNaN(ts) || ts > filters.toMs)) return false;
      if (filters.personaId && trimString(doc.personaId) !== filters.personaId) return false;
      if (filters.roleId && trimString(doc.roleId) !== filters.roleId) return false;
      if (filters.resolutionMode && trimString(doc.resolutionMode) !== filters.resolutionMode) return false;
      return true;
    },

    toPublicAudit(doc) {
      if (!doc) return null;
      // eslint-disable-next-line no-unused-vars
      const { _id, _rev, docType, ...rest } = doc;
      return { ...rest };
    },

    buildResolutionAuditSummary(items = []) {
      const total = items.length;
      const byResolutionMode = {};
      const byPersonaId = {};
      const byRoleId = {};

      for (const item of items) {
        const mode = trimString(item.resolutionMode) || 'unknown';
        const personaId = trimString(item.personaId) || 'unknown';
        const roleId = trimString(item.roleId) || 'unknown';
        byResolutionMode[mode] = (byResolutionMode[mode] || 0) + 1;
        byPersonaId[personaId] = (byPersonaId[personaId] || 0) + 1;
        byRoleId[roleId] = (byRoleId[roleId] || 0) + 1;
      }

      const handoffCount = byResolutionMode.handoff || 0;
      const fallbackCount = byResolutionMode.system_fallback || 0;

      return {
        total,
        byResolutionMode,
        byPersonaId,
        byRoleId,
        handoffCount,
        fallbackCount,
        handoffShare: total > 0 ? handoffCount / total : 0,
        fallbackShare: total > 0 ? fallbackCount / total : 0,
      };
    },

    async seedEvuOperationalPersonas(tenantId, options = {}) {
      const { roles, overwrite } = options;
      const requestedRoles =
        Array.isArray(roles) && roles.length > 0 ? roles.map((r) => trimString(r)).filter(Boolean) : ALL_ROLE_KEYS;

      const unknownRoles = requestedRoles.filter((r) => !CATALOG_BY_ROLE.has(r));
      if (unknownRoles.length > 0) {
        throw validationError(
          `Unknown EVU operational role(s): ${unknownRoles.join(', ')}. Allowed: ${ALL_ROLE_KEYS.join(', ')}`,
          { field: 'roles', unknownRoles }
        );
      }

      const created = [];
      const skipped = [];

      for (const roleKey of requestedRoles) {
        const entry = CATALOG_BY_ROLE.get(roleKey);
        const docId = toDocId(tenantId, entry.defaultId);

        let existing = null;
        try {
          existing = await this.db.get(docId);
        } catch (e) {
          if (e?.status !== 404) throw e;
        }

        if (existing && !overwrite) {
          skipped.push(roleKey);
          continue;
        }

        const now = nowIso();
        const persona = {
          _id: docId,
          docType: 'agent-persona',
          tenantId,
          id: entry.defaultId,
          personaName: entry.personaName,
          personaType: entry.personaType,
          openclawUserId: null,
          assignedRoles: [roleKey],
          communicationChannels: [
            { type: entry.communicationChannel.type, address: entry.communicationChannel.address },
          ],
          defaultPersonalAgentSessionId: `pa-default-${roleKey}`,
          status: 'active',
          available: true,
          lastSeenAt: now,
          availabilityWindow: { startHour: 0, endHour: 24, timezone: 'UTC' },
          roleIds: [],
          contextAffinities: {},
          handoffTargets: [],
          resolutionPolicy: null,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };

        if (existing) {
          persona._rev = existing._rev;
        }

        await this.db.put(persona);
        created.push(roleKey);
      }

      return { success: true, tenantId, created, skipped };
    },

    async pruneResolutionAuditsForTenant(tenantId, olderThanDays) {
      const days = Number.isFinite(olderThanDays) ? Number(olderThanDays) : 90;
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const cutoffTimestamp = new Date(cutoffMs).toISOString();

      const prefix = auditTenantPrefix(tenantId);
      const result = await this.auditDb.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\ufff0`,
      });

      const candidates = result.rows.map((row) => row.doc).filter(Boolean);
      const toDelete = candidates.filter((doc) => {
        const ts = Date.parse(doc.timestamp || '');
        if (Number.isNaN(ts)) return false;
        return ts <= cutoffMs;
      });

      if (toDelete.length > 0) {
        await this.auditDb.bulkDocs(
          toDelete.map((doc) => ({
            _id: doc._id,
            _rev: doc._rev,
            _deleted: true,
          }))
        );
      }

      return {
        inspectedCount: candidates.length,
        deletedCount: toDelete.length,
        cutoffTimestamp,
      };
    },
  },
};
