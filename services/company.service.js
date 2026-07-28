'use strict';

/**
 * Company Service (v0.20.3)
 *
 * Manages "company entities" — groups of BDEW market-partner codes that belong
 * to the same economic unit (Konzernverbund / Stadtwerk).
 *
 * Persistence: PouchDB at data/companies/, doc prefix "co:"
 * In-memory index: bdewCode → companyId (rebuilt on startup + after mutations)
 *
 * Actions:
 *   create        POST /api/companies            — create company, optional autoDiscover
 *   confirm       PUT  /api/companies/:id/confirm — promote draft → active
 *   get           GET  /api/companies/:id
 *   list          GET  /api/companies?query=...
 *   update        PUT  /api/companies/:id
 *   delete        DELETE /api/companies/:id       — soft-delete (archived)
 *   enrichResults (internal) — inject companyId + marketRole into market-partner results
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');

const CernionMCPClient = require('../src/mcp-client');
const {
  MARKET_ROLE_ENUM,
  classifyPartner,
  normalizeMarketPartner,
  extractCandidates,
} = require('../src/market-role-classifier');

const DOC_PREFIX = 'co:';

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'company',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'COMPANY_DB_PATH',
      defaultDbPath: './data/companies',
      indexes: [['displayName'], ['status'], ['createdAt']],
    }),
  ],

  created() {
    // In-memory index: bdewCode (lowercase) → companyId
    this._bdewIndex = new Map();
  },

  async started() {
    await this._rebuildBdewIndex();
  },

  actions: {
    // ─── Create ─────────────────────────────────────────────────────────────

    create: {
      rest: 'POST /companies',
      params: {
        displayName: { type: 'string', min: 1, max: 120, trim: true },
        legalName: { type: 'string', optional: true, max: 120, trim: true },
        members: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              bdewCode: { type: 'string', min: 7, max: 13 },
              role: { type: 'enum', values: MARKET_ROLE_ENUM, optional: true },
              legalEntity: { type: 'string', optional: true, trim: true },
              mastrId: { type: 'string', optional: true },
            },
          },
        },
        autoDiscover: { type: 'boolean', optional: true, default: false, convert: true },
        autoConfirm: { type: 'boolean', optional: true, default: false, convert: true },
        query: { type: 'string', optional: true, min: 1 },
      },
      openapi: {
        summary: 'Create a company entity (Stadtwerk/Konzernverbund)',
        tags: ['Companies'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['displayName'],
                properties: {
                  displayName: { type: 'string', example: 'Stadtwerke Heidelberg' },
                  legalName: { type: 'string', example: 'Stadtwerke Heidelberg GmbH' },
                  members: {
                    type: 'array',
                    example: [],
                    items: {
                      type: 'object',
                      properties: {
                        bdewCode: { type: 'string', example: '9900277000000' },
                        role: { type: 'string', enum: MARKET_ROLE_ENUM },
                        legalEntity: { type: 'string' },
                        mastrId: { type: 'string' },
                      },
                    },
                  },
                  autoDiscover: { type: 'boolean', default: false },
                  autoConfirm: { type: 'boolean', default: false },
                  query: {
                    type: 'string',
                    description: 'Search term for autoDiscover (e.g. company name)',
                    example: 'Heidelberg',
                  },
                },
              },
              examples: {
                manualCreate: {
                  summary: 'Create company with explicit members',
                  value: {
                    displayName: 'Stadtwerke Heidelberg',
                    legalName: 'Stadtwerke Heidelberg GmbH & Co. KG',
                    members: [
                      { bdewCode: '9900277000000', role: 'VNB', legalEntity: 'SW HD Netze GmbH' },
                      { bdewCode: '9910277000001', role: 'Lieferant' },
                    ],
                  },
                },
                autoDiscover: {
                  summary: 'Auto-discover via MCP then confirm',
                  value: {
                    displayName: 'Stadtwerke Heidelberg',
                    autoDiscover: true,
                    autoConfirm: false,
                    query: 'Heidelberg',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const {
          displayName,
          legalName,
          members: explicitMembers,
          autoDiscover,
          autoConfirm,
          query,
        } = ctx.params;

        let suggestedMembers = [];
        let isDraft = false;

        if (autoDiscover) {
          if (!query) {
            throw new (require('moleculer').Errors.MoleculerClientError)(
              'query is required when autoDiscover is true.',
              422,
              'VALIDATION_ERROR'
            );
          }
          const mcpResult = await CernionMCPClient.callWithNewSession(
            'cernion_market_partners',
            { query, limit: 50 },
            ctx.meta.cernionToken
          );
          const raw = extractCandidates(mcpResult);
          suggestedMembers = raw
            .map(normalizeMarketPartner)
            .filter((c) => c && c.bdew)
            .map((c) => ({
              bdewCode: c.bdew,
              role: classifyPartner({ roles: c.roles, bdewCode: c.bdew }),
              legalEntity: c.name || null,
              mastrId: c.mastrId || null,
              city: c.city || null,
              postalCode: c.postalCode || null,
              active: true,
            }));
          isDraft = !autoConfirm;
        }

        const members = autoDiscover
          ? suggestedMembers
          : (explicitMembers || []).map((m) => ({
              bdewCode: m.bdewCode,
              role: m.role || classifyPartner({ bdewCode: m.bdewCode }),
              legalEntity: m.legalEntity || null,
              mastrId: m.mastrId || null,
              active: true,
            }));

        // Guard: reject BDEW codes already owned by another company
        await this._assertNoDuplicateBdew(members.map((m) => m.bdewCode));

        const companyId = crypto.randomUUID();
        const doc = {
          _id: DOC_PREFIX + companyId,
          companyId,
          displayName,
          legalName: legalName || displayName,
          status: isDraft ? 'draft' : 'active',
          members,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        await this.db.put(doc);
        await this._rebuildBdewIndex();

        const response = {
          companyId,
          displayName,
          legalName: doc.legalName,
          status: doc.status,
          members,
          createdAt: doc.createdAt,
        };

        if (isDraft) {
          response.suggestedRoles = members;
          response.message =
            'Draft created. Review suggestedRoles and call PUT /api/companies/' +
            companyId +
            '/confirm to activate.';
        }

        return response;
      },
    },

    // ─── Confirm (draft → active) ────────────────────────────────────────────

    confirm: {
      rest: 'PUT /companies/:id/confirm',
      params: {
        id: { type: 'string', min: 1 },
        members: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              bdewCode: { type: 'string', min: 7, max: 13 },
              role: { type: 'enum', values: MARKET_ROLE_ENUM, optional: true },
              legalEntity: { type: 'string', optional: true, trim: true },
              mastrId: { type: 'string', optional: true },
            },
          },
        },
      },
      openapi: {
        summary: 'Confirm draft company (transition draft → active)',
        tags: ['Companies'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        const doc = await this._loadDoc(ctx.params.id);
        if (doc.status !== 'draft') {
          throw new (require('moleculer').Errors.MoleculerClientError)(
            'Company is not in draft status.',
            409,
            'COMPANY_NOT_DRAFT'
          );
        }

        const members = ctx.params.members
          ? ctx.params.members.map((m) => ({
              bdewCode: m.bdewCode,
              role: m.role || classifyPartner({ bdewCode: m.bdewCode }),
              legalEntity: m.legalEntity || null,
              mastrId: m.mastrId || null,
              active: true,
            }))
          : doc.members;

        // Check for duplicate BDEW codes excluding this company's own codes
        const existingBdews = new Set(doc.members.map((m) => m.bdewCode));
        const newBdews = members
          .filter((m) => !existingBdews.has(m.bdewCode))
          .map((m) => m.bdewCode);
        if (newBdews.length > 0) {
          await this._assertNoDuplicateBdew(newBdews);
        }

        const updated = { ...doc, status: 'active', members, updatedAt: nowIso() };
        await this.db.put(updated);
        await this._rebuildBdewIndex();

        return {
          companyId: doc.companyId,
          displayName: doc.displayName,
          status: 'active',
          members,
          updatedAt: updated.updatedAt,
        };
      },
    },

    // ─── Get ─────────────────────────────────────────────────────────────────

    get: {
      rest: 'GET /companies/:id',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get company entity by ID',
        tags: ['Companies'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
          },
        ],
      },
      async handler(ctx) {
        const doc = await this._loadDoc(ctx.params.id);
        return this._toPublic(doc);
      },
    },

    // ─── List ─────────────────────────────────────────────────────────────────

    list: {
      rest: 'GET /companies',
      params: {
        query: { type: 'string', optional: true, min: 1 },
        limit: { type: 'number', optional: true, default: 10, min: 1, max: 50, convert: true },
        status: {
          type: 'enum',
          values: ['draft', 'active', 'archived', 'all'],
          optional: true,
          default: 'active',
        },
      },
      openapi: {
        summary: 'List / search company entities',
        tags: ['Companies'],
        parameters: [
          {
            name: 'query',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              example: 'Stadtwerke Heidelberg',
              description: 'Search by company name (case-insensitive)',
            },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'number', default: 10 },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['draft', 'active', 'archived', 'all'],
              default: 'active',
            },
          },
        ],
      },
      async handler(ctx) {
        const { query, limit, status } = ctx.params;
        const selector = status === 'all' ? {} : { status };

        // Fetch more than requested to allow in-memory name filtering
        const fetchLimit = query ? 200 : Number(limit);
        const result = await this.db.find({ selector, limit: fetchLimit });

        let docs = result.docs;
        if (query) {
          const queryLower = query.toLowerCase();
          docs = docs.filter((d) => d.displayName.toLowerCase().includes(queryLower));
        }

        return {
          count: docs.length,
          companies: docs.slice(0, Number(limit)).map((d) => this._toPublic(d)),
        };
      },
    },

    // ─── Update ───────────────────────────────────────────────────────────────

    update: {
      rest: 'PUT /companies/:id',
      params: {
        id: { type: 'string', min: 1 },
        displayName: { type: 'string', optional: true, min: 1, max: 120, trim: true },
        legalName: { type: 'string', optional: true, max: 120, trim: true },
        members: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              bdewCode: { type: 'string', min: 7, max: 13 },
              role: { type: 'enum', values: MARKET_ROLE_ENUM, optional: true },
              legalEntity: { type: 'string', optional: true, trim: true },
              mastrId: { type: 'string', optional: true },
              active: { type: 'boolean', optional: true, default: true },
            },
          },
        },
      },
      openapi: {
        summary: 'Update company entity (name, members)',
        tags: ['Companies'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        const doc = await this._loadDoc(ctx.params.id);
        const updates = {};

        if (ctx.params.displayName) updates.displayName = ctx.params.displayName;
        if (ctx.params.legalName) updates.legalName = ctx.params.legalName;

        if (ctx.params.members) {
          const existingBdews = new Set(doc.members.map((m) => m.bdewCode));
          const newBdews = ctx.params.members
            .filter((m) => !existingBdews.has(m.bdewCode))
            .map((m) => m.bdewCode);
          if (newBdews.length > 0) {
            await this._assertNoDuplicateBdew(newBdews);
          }
          updates.members = ctx.params.members.map((m) => ({
            bdewCode: m.bdewCode,
            role: m.role || classifyPartner({ bdewCode: m.bdewCode }),
            legalEntity: m.legalEntity || null,
            mastrId: m.mastrId || null,
            active: m.active !== false,
          }));
        }

        const updated = { ...doc, ...updates, updatedAt: nowIso() };
        await this.db.put(updated);
        await this._rebuildBdewIndex();
        return this._toPublic(updated);
      },
    },

    // ─── Delete (soft) ────────────────────────────────────────────────────────

    delete: {
      rest: 'DELETE /companies/:id',
      params: {
        id: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Archive (soft-delete) a company entity',
        tags: ['Companies'],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      },
      async handler(ctx) {
        const doc = await this._loadDoc(ctx.params.id);
        const updated = { ...doc, status: 'archived', updatedAt: nowIso() };
        await this.db.put(updated);
        await this._rebuildBdewIndex();
        return { companyId: doc.companyId, status: 'archived' };
      },
    },

    // ─── Enrich Results (internal) ────────────────────────────────────────────

    /**
     * Inject companyId and marketRole into market-partner result objects.
     * Called by grid-operations.marketPartners after MCP response.
     * Uses the in-memory bdewCode → companyId index for O(1) lookups.
     *
     * @param {object[]} results - Raw results from cernion_market_partners
     * @returns {object[]}       - Same array with companyId + marketRole injected
     */
    enrichResults: {
      params: {
        results: { type: 'array' },
      },
      async handler(ctx) {
        return ctx.params.results.map((item) => {
          const bdew = String(item.bdew || item.bdewCode || '');
          const roles = Array.isArray(item.roles)
            ? item.roles
            : Array.isArray(item.marketRoles)
              ? item.marketRoles
              : [];

          return {
            ...item,
            companyId: this._bdewIndex.get(bdew) || null,
            marketRole: classifyPartner({ roles, bdewCode: bdew }),
          };
        });
      },
    },
  },

  // ─── Internal methods ──────────────────────────────────────────────────────

  methods: {
    _toPublic(doc) {
      return {
        companyId: doc.companyId,
        displayName: doc.displayName,
        legalName: doc.legalName || doc.displayName,
        status: doc.status,
        members: doc.members || [],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },

    async _loadDoc(companyId) {
      try {
        return await this.db.get(DOC_PREFIX + companyId);
      } catch (err) {
        if (err.status === 404) {
          throw new (require('moleculer').Errors.MoleculerClientError)(
            'Company not found: ' + companyId,
            404,
            'COMPANY_NOT_FOUND'
          );
        }
        throw err;
      }
    },

    async _rebuildBdewIndex() {
      const result = await this.db.find({
        selector: { status: { $in: ['active', 'draft'] } },
        limit: 10000,
      });
      const index = new Map();
      for (const doc of result.docs) {
        for (const member of doc.members || []) {
          if (member.bdewCode && member.active !== false) {
            index.set(String(member.bdewCode), doc.companyId);
          }
        }
      }
      this._bdewIndex = index;
    },

    async _assertNoDuplicateBdew(bdewCodes) {
      const conflicts = bdewCodes.filter((code) => this._bdewIndex.has(String(code)));
      if (conflicts.length > 0) {
        throw new (require('moleculer').Errors.MoleculerClientError)(
          'BDEW code(s) already assigned to another company: ' + conflicts.join(', '),
          409,
          'BDEW_ALREADY_ASSIGNED',
          { conflicts }
        );
      }
    },
  },
};
