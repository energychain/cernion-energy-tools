'use strict';

const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));

const { MoleculerClientError } = require('moleculer').Errors;

const { validateTenantId } = require('../src/tenant-context');

const DB_PATH = process.env.AGENT_PERSONA_DB_PATH || './data/agent-personas';
const DOC_PREFIX = 'persona:';
const PERSONA_TYPES = Object.freeze(['human', 'specialized-agent']);
const PERSONA_STATUSES = Object.freeze(['active', 'inactive', 'on-leave']);
const CHANNEL_TYPES = Object.freeze(['email', 'telegram', 'signal', 'openclaw-chat']);
const OPENAPI_TAG = 'Actor Personas';

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
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    this.logger.info(`Agent Persona DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
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
  },
};
