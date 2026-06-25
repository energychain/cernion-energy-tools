'use strict';

/**
 * Energy Sharing Community Master Data (issue #285, sub-issue of #280).
 *
 * Persistent "Gemeinschaft" (community) + "Teilnehmer" (member) Stammdaten
 * entity for § 42c EnWG Energy Sharing — gap identified in #280's gap
 * analysis: services/energy-sharing-allocation.service.js's `allocate`
 * action only ever accepted generators/consumers inline, per request, with
 * no durable community/membership registry and no Teilnahmezeitraum
 * (join/leave dates).
 *
 * A community's members are embedded in the community document (small,
 * bounded lists — tens, not millions of members), each with:
 *   - roles: combinable array of 'generator' | 'consumer' | 'storage'
 *     ('storage' is modelable per the issue's acceptance criteria, but is
 *     NOT fed into allocation arithmetic in this issue — the underlying
 *     engine has no storage charge/discharge model yet)
 *   - generatorSharePercent / consumerSharePercent (whichever roles apply)
 *   - validFrom / validTo (Teilnahmezeitraum; validTo null = still active)
 *
 * `resolveActiveMembers` derives the generators[]/consumers[] arrays
 * services/energy-sharing-allocation.service.js's `allocate` action expects,
 * for a given date range, excluding members whose membership does not
 * overlap that range — additive only: inline generators/consumers remain
 * fully supported, this is an alternative input path via `communityId`.
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { resolveTenantId } = require('../src/pagination');

const MALO_REGEX = /^DE\d{31}$/;
const VALID_ROLES = new Set(['generator', 'consumer', 'storage']);

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new MoleculerClientError(`Invalid date: "${value}"`, 400, 'INVALID_DATE');
  }
  return value;
}

/**
 * A member is active for [dateFrom, dateTo] if their [validFrom, validTo]
 * range overlaps it: validFrom <= dateTo AND (validTo is null OR validTo >= dateFrom).
 * No prorating of sharePercent for partial-period membership — binary
 * in/out only, per the issue's literal acceptance criteria.
 */
function isMemberActive(member, dateFrom, dateTo) {
  if (member.validFrom > dateTo) return false;
  if (member.validTo != null && member.validTo < dateFrom) return false;
  return true;
}

function validateMemberInput(input, { requireMaloOrMastr = true } = {}) {
  const roles = Array.isArray(input.roles) ? input.roles : [];
  if (roles.length === 0) {
    throw new MoleculerClientError(
      'At least one role is required (generator, consumer, storage)',
      400,
      'MEMBER_ROLE_REQUIRED'
    );
  }
  for (const role of roles) {
    if (!VALID_ROLES.has(role)) {
      throw new MoleculerClientError(
        `Invalid role "${role}" — expected one of: ${[...VALID_ROLES].join(', ')}`,
        400,
        'INVALID_ROLE'
      );
    }
  }
  if (roles.includes('generator') && !input.mastrNummer) {
    throw new MoleculerClientError(
      'mastrNummer is required for members with the "generator" role',
      400,
      'MASTR_NUMMER_REQUIRED'
    );
  }
  if (roles.includes('generator') && typeof input.generatorSharePercent !== 'number') {
    throw new MoleculerClientError(
      'generatorSharePercent is required for members with the "generator" role',
      400,
      'GENERATOR_SHARE_REQUIRED'
    );
  }
  if ((roles.includes('consumer') || roles.includes('storage')) && requireMaloOrMastr) {
    if (!input.maloId || !MALO_REGEX.test(input.maloId)) {
      throw new MoleculerClientError(
        'A valid maloId (DE + 31 digits) is required for members with the "consumer" or "storage" role',
        400,
        'INVALID_MALO_ID'
      );
    }
  }
  if (roles.includes('consumer') && typeof input.consumerSharePercent !== 'number') {
    throw new MoleculerClientError(
      'consumerSharePercent is required for members with the "consumer" role',
      400,
      'CONSUMER_SHARE_REQUIRED'
    );
  }
  if (!input.validFrom) {
    throw new MoleculerClientError('validFrom is required', 400, 'VALID_FROM_REQUIRED');
  }
}

function buildMemberDoc(input) {
  return {
    memberId: crypto.randomUUID(),
    maloId: input.maloId || null,
    mastrNummer: input.mastrNummer || null,
    name: input.name || null,
    roles: input.roles,
    generatorSharePercent: input.generatorSharePercent ?? null,
    consumerSharePercent: input.consumerSharePercent ?? null,
    validFrom: toIsoDate(input.validFrom),
    validTo: input.validTo ? toIsoDate(input.validTo) : null,
  };
}

module.exports = {
  name: 'energy-sharing-community',

  settings: {
    dbPath: process.env.ENERGY_SHARING_COMMUNITY_DB_PATH || './data/energy-sharing-community',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['communityId'] } });
    this.logger.info(`Energy-sharing community DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * Create a new Energy Sharing community (without members — add them via addMember).
     */
    createCommunity: {
      rest: 'POST /communities',
      params: {
        name: { type: 'string', min: 1 },
        communityId: { type: 'string', optional: true, default: '' },
        validationReportId: { type: 'string', optional: true, default: '' },
      },
      openapi: {
        summary: 'Create a new Energy Sharing community (#285)',
        description:
          'Creates a persistent community record. Add members via POST /communities/:id/members.',
        tags: ['Energy Sharing Community'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'PV-Gemeinschaft Musterstraße' },
                  communityId: {
                    type: 'string',
                    description: 'External community ID from VNB',
                    example: 'ES-2026-001',
                  },
                  validationReportId: { type: 'string', example: 'a1b2c3d4-...' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Created community' } },
      },
      async handler(ctx) {
        const id = crypto.randomUUID();
        const tenantId = resolveTenantId(ctx) || 'default';
        const docId = tenantId !== 'default' ? `community:${tenantId}:${id}` : `community:${id}`;
        const doc = {
          _id: docId,
          id,
          tenantId,
          type: 'energy-sharing-community',
          communityId: ctx.params.communityId || null,
          name: ctx.params.name,
          validationReportId: ctx.params.validationReportId || null,
          members: [],
          markedDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await this.db.put(doc);
        return { success: true, ...doc };
      },
    },

    /**
     * Get a single community by ID, including its members.
     */
    getCommunity: {
      rest: 'GET /communities/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Get an Energy Sharing community by ID (#285)',
        tags: ['Energy Sharing Community'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Community record' }, 404: { description: 'Not found' } },
      },
      async handler(ctx) {
        const doc = await this._getCommunityDoc(ctx, ctx.params.id);
        if (!doc) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Community ${ctx.params.id} not found` };
        }
        return { success: true, ...doc };
      },
    },

    /**
     * List communities (newest first). Soft-deleted excluded by default.
     */
    listCommunities: {
      rest: 'GET /communities',
      params: {
        includeDeleted: { type: 'boolean', optional: true, default: false, convert: true },
      },
      openapi: {
        summary: 'List Energy Sharing communities (#285)',
        tags: ['Energy Sharing Community'],
        parameters: [
          {
            name: 'includeDeleted',
            in: 'query',
            schema: { type: 'boolean', default: false },
            description: 'Include soft-deleted communities (for audit access)',
          },
        ],
        responses: { 200: { description: 'List of communities' } },
      },
      async handler(ctx) {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'community:',
          endkey: 'community:￰',
        });
        let docs = result.rows.map((r) => r.doc);
        if (!ctx.params.includeDeleted) {
          docs = docs.filter((d) => !d.markedDeleted);
        }
        docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return {
          success: true,
          count: docs.length,
          communities: docs.map((d) => ({
            id: d.id,
            communityId: d.communityId,
            name: d.name,
            memberCount: (d.members || []).length,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          })),
        };
      },
    },

    /**
     * Soft-delete a community (retains the document for audit purposes).
     */
    removeCommunity: {
      rest: 'DELETE /communities/:id',
      params: { id: { type: 'string' } },
      openapi: {
        summary: 'Soft-delete an Energy Sharing community (#285)',
        tags: ['Energy Sharing Community'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Soft-delete confirmed' },
          404: { description: 'Not found' },
        },
      },
      async handler(ctx) {
        const doc = await this._getCommunityDoc(ctx, ctx.params.id);
        if (!doc) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Community ${ctx.params.id} not found` };
        }
        doc.markedDeleted = true;
        doc.updatedAt = new Date().toISOString();
        await this.db.put(doc);
        return { success: true, id: ctx.params.id };
      },
    },

    /**
     * Add a member (Teilnehmer) to a community.
     *
     * roles is a combinable array: ['generator'], ['consumer'], ['storage'],
     * or e.g. ['generator', 'consumer'] for a Prosumer. validTo is optional —
     * omit for an open-ended (still active) membership.
     */
    addMember: {
      rest: 'POST /communities/:id/members',
      params: {
        id: { type: 'string' },
        maloId: { type: 'string', optional: true },
        mastrNummer: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        roles: { type: 'array', items: 'string', min: 1 },
        generatorSharePercent: { type: 'number', optional: true, convert: true },
        consumerSharePercent: { type: 'number', optional: true, convert: true },
        validFrom: { type: 'string' },
        validTo: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Add a member to an Energy Sharing community (#285)',
        description:
          'roles is combinable: ["generator"], ["consumer"], ["storage"], or e.g. ' +
          '["generator","consumer"] for a Prosumer. "storage" is modelable but not yet fed into ' +
          'allocation arithmetic. validTo is optional (omit for an open-ended membership).',
        tags: ['Energy Sharing Community'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['roles', 'validFrom'],
                properties: {
                  maloId: { type: 'string', example: 'DE0001234567890123456789012345678' },
                  mastrNummer: { type: 'string', example: 'SEE904837264953' },
                  name: { type: 'string', example: 'Müller' },
                  roles: {
                    type: 'array',
                    items: { type: 'string', enum: ['generator', 'consumer', 'storage'] },
                  },
                  generatorSharePercent: { type: 'number', example: 100 },
                  consumerSharePercent: { type: 'number', example: 30 },
                  validFrom: { type: 'string', example: '2026-01-01' },
                  validTo: { type: 'string', example: '2026-12-31' },
                },
              },
              examples: {
                consumer: {
                  value: {
                    maloId: 'DE0001234567890123456789012345678',
                    name: 'Müller',
                    roles: ['consumer'],
                    consumerSharePercent: 30,
                    validFrom: '2026-01-01',
                  },
                },
                prosumer: {
                  value: {
                    maloId: 'DE0001234567890123456789012345678',
                    mastrNummer: 'SEE904837264953',
                    name: 'Schmidt',
                    roles: ['generator', 'consumer'],
                    generatorSharePercent: 50,
                    consumerSharePercent: 20,
                    validFrom: '2026-01-01',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated community with the new member' },
          404: { description: 'Community not found' },
        },
      },
      async handler(ctx) {
        const doc = await this._getCommunityDoc(ctx, ctx.params.id);
        if (!doc) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Community ${ctx.params.id} not found` };
        }

        validateMemberInput(ctx.params);
        const member = buildMemberDoc(ctx.params);
        doc.members.push(member);
        doc.updatedAt = new Date().toISOString();
        await this.db.put(doc);

        return { success: true, member, community: doc };
      },
    },

    /**
     * Update an existing member — typically used to end a membership by
     * setting validTo (rather than removing them, to keep the historical
     * Teilnahmezeitraum record intact).
     */
    updateMember: {
      rest: 'PUT /communities/:id/members/:memberId',
      params: {
        id: { type: 'string' },
        memberId: { type: 'string' },
        maloId: { type: 'string', optional: true },
        mastrNummer: { type: 'string', optional: true },
        name: { type: 'string', optional: true },
        roles: { type: 'array', items: 'string', optional: true },
        generatorSharePercent: { type: 'number', optional: true, convert: true },
        consumerSharePercent: { type: 'number', optional: true, convert: true },
        validFrom: { type: 'string', optional: true },
        validTo: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Update a community member, e.g. to end their membership via validTo (#285)',
        tags: ['Energy Sharing Community'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Updated member' },
          404: { description: 'Community or member not found' },
        },
      },
      async handler(ctx) {
        const doc = await this._getCommunityDoc(ctx, ctx.params.id);
        if (!doc) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Community ${ctx.params.id} not found` };
        }
        const index = doc.members.findIndex((m) => m.memberId === ctx.params.memberId);
        if (index === -1) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Member ${ctx.params.memberId} not found` };
        }

        const merged = { ...doc.members[index], ...ctx.params };
        delete merged.id;
        delete merged.memberId;
        validateMemberInput(merged, { requireMaloOrMastr: false });
        doc.members[index] = { ...buildMemberDoc(merged), memberId: ctx.params.memberId };
        doc.updatedAt = new Date().toISOString();
        await this.db.put(doc);

        return { success: true, member: doc.members[index] };
      },
    },

    /**
     * Hard-remove a member from a community (use sparingly — to correct
     * data-entry mistakes. To end an active membership normally, use
     * updateMember with validTo instead, which preserves the historical record).
     */
    removeMember: {
      rest: 'DELETE /communities/:id/members/:memberId',
      params: { id: { type: 'string' }, memberId: { type: 'string' } },
      openapi: {
        summary: 'Hard-remove a member from a community — data-entry correction only (#285)',
        description:
          'Removes the member record entirely. To end an active membership normally, use ' +
          'PUT /communities/:id/members/:memberId with validTo instead, which preserves history.',
        tags: ['Energy Sharing Community'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Member removed' },
          404: { description: 'Community or member not found' },
        },
      },
      async handler(ctx) {
        const doc = await this._getCommunityDoc(ctx, ctx.params.id);
        if (!doc) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Community ${ctx.params.id} not found` };
        }
        const index = doc.members.findIndex((m) => m.memberId === ctx.params.memberId);
        if (index === -1) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Member ${ctx.params.memberId} not found` };
        }
        doc.members.splice(index, 1);
        doc.updatedAt = new Date().toISOString();
        await this.db.put(doc);
        return { success: true, id: ctx.params.id, memberId: ctx.params.memberId };
      },
    },

    /**
     * Resolve the active generators[]/consumers[] for a date range — the
     * same shape services/energy-sharing-allocation.service.js's `allocate`
     * action expects. Used internally by `allocate` when it is given a
     * communityId without inline generators/consumers, and also exposed
     * standalone for previewing/debugging membership resolution.
     */
    resolveActiveMembers: {
      rest: 'GET /communities/:id/active-members',
      params: {
        id: { type: 'string' },
        dateFrom: { type: 'string' },
        dateTo: { type: 'string' },
      },
      openapi: {
        summary: 'Resolve active generators/consumers for a date range (#285)',
        description:
          'A member is active for [dateFrom, dateTo] if their [validFrom, validTo] Teilnahmezeitraum ' +
          'overlaps it. Members whose validTo is before dateFrom are excluded — no manual filtering ' +
          'needed by the caller. No prorating of sharePercent for partial-period membership.',
        tags: ['Energy Sharing Community'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'dateFrom',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-06-01' },
          },
          {
            name: 'dateTo',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-06-30' },
          },
        ],
        responses: {
          200: { description: 'Active generators/consumers for the period' },
          404: { description: 'Community not found' },
        },
      },
      async handler(ctx) {
        const doc = await this._getCommunityDoc(ctx, ctx.params.id);
        if (!doc) {
          ctx.meta.$statusCode = 404;
          return { success: false, message: `Community ${ctx.params.id} not found` };
        }
        return {
          success: true,
          ...this.resolveActiveMembers(doc, ctx.params.dateFrom, ctx.params.dateTo),
        };
      },
    },
  },

  methods: {
    // Accepts either the community's internal id (UUID) or its external
    // communityId business key (e.g. "ES-2026-001", the existing
    // energy-sharing-allocation.service.js#allocate `communityId` field) —
    // lets `allocate` resolve a community without needing to know which form
    // the caller has at hand (#285).
    async _getCommunityDoc(ctx, id) {
      try {
        const doc = await this.db.get(`community:${id}`);
        if (doc.markedDeleted) return null;
        return doc;
      } catch (err) {
        if (err.status !== 404 && err.name !== 'not_found') throw err;
      }

      const result = await this.db.allDocs({
        include_docs: true,
        startkey: 'community:',
        endkey: 'community:￰',
      });
      const match = result.rows.find((r) => r.doc.communityId === id && !r.doc.markedDeleted);
      return match ? match.doc : null;
    },

    /**
     * Pure derivation — no I/O — kept as a method (not exported from a
     * separate pure module) since it only operates on an already-loaded
     * community document, mirroring src/timeseries-allocation.js's style
     * without introducing a new shared module for a single small function.
     */
    resolveActiveMembers(doc, dateFrom, dateTo) {
      const active = (doc.members || []).filter((m) => isMemberActive(m, dateFrom, dateTo));

      const generators = active
        .filter((m) => m.roles.includes('generator'))
        .map((m) => ({
          mastrNummer: m.mastrNummer,
          sharePercent: m.generatorSharePercent,
        }));

      const consumers = active
        .filter((m) => m.roles.includes('consumer'))
        .map((m) => ({
          maloId: m.maloId,
          sharePercent: m.consumerSharePercent,
          name: m.name,
        }));

      const storageMembers = active
        .filter((m) => m.roles.includes('storage'))
        .map((m) => ({ maloId: m.maloId, name: m.name }));

      return {
        dateFrom,
        dateTo,
        activeMemberCount: active.length,
        generators,
        consumers,
        storageMembers,
      };
    },
  },
};
