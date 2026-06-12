'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { generateStructured, SchemaType } = require('../src/llm-client');

const OPENAPI_TAG = 'Decision Frame';

const DOMAIN_VALUES = ['infrastructure', 'regulatory', 'financial', 'strategic', 'operational'];
const ROLE_VALUES = [
  'asset_management',
  'finance',
  'regulatory',
  'strategy',
  'operations',
  'customer',
];
const STATUS_VALUES = ['draft', 'active', 'closed'];
const ENTITY_TYPE_VALUES = [
  'znp_project',
  'vdmi_matrix',
  'investment_plan',
  'grid_operator',
  'grid_connection',
  'process_intent',
];

// ─── Schema for AI-assisted starter generation ────────────────────────────────

const STARTER_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    situation: { type: SchemaType.STRING },
    complication: { type: SchemaType.STRING },
    question: { type: SchemaType.STRING },
    suggestedDomain: { type: SchemaType.STRING },
    confidence: { type: SchemaType.STRING },
  },
  required: ['situation', 'complication', 'question', 'suggestedDomain', 'confidence'],
};

// ─── ID helpers ───────────────────────────────────────────────────────────────

function makeFrameId() {
  return `df-${crypto.randomBytes(6).toString('hex')}`;
}

function docId(frameId) {
  return `df:${frameId}`;
}

// ─── Public projection ────────────────────────────────────────────────────────

function toPublic(doc) {
  return {
    frameId: doc.frameId,
    situation: doc.situation,
    complication: doc.complication,
    question: doc.question,
    answer: doc.answer || null,
    domain: doc.domain,
    role: doc.role || null,
    status: doc.status,
    linkedEntities: Array.isArray(doc.linkedEntities) ? doc.linkedEntities : [],
    createdBy: doc.createdBy || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

module.exports = {
  name: 'decision-frame',

  settings: {
    dbPath: process.env.DECISION_FRAME_DB_PATH || './data/decision-frames',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['type', 'createdAt'] } });
    await this.db.createIndex({ index: { fields: ['type', 'domain', 'status'] } });
    await this.db.createIndex({ index: { fields: ['type', 'createdBy'] } });
    this.logger.info(`[decision-frame] DB ready at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    // ── create ────────────────────────────────────────────────────────────────
    create: {
      rest: 'POST /',
      openapi: {
        summary: 'Create a SCQA decision frame',
        tags: [OPENAPI_TAG],
      },
      params: {
        situation: { type: 'string', min: 10 },
        complication: { type: 'string', min: 10 },
        question: { type: 'string', min: 5 },
        answer: { type: 'string', optional: true },
        domain: { type: 'enum', values: DOMAIN_VALUES },
        role: { type: 'enum', values: ROLE_VALUES, optional: true },
        createdBy: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const frameId = makeFrameId();
        const now = new Date().toISOString();
        const doc = {
          _id: docId(frameId),
          type: 'decision_frame',
          frameId,
          situation: ctx.params.situation.trim(),
          complication: ctx.params.complication.trim(),
          question: ctx.params.question.trim(),
          answer: ctx.params.answer ? ctx.params.answer.trim() : null,
          domain: ctx.params.domain,
          role: ctx.params.role || null,
          status: 'draft',
          linkedEntities: [],
          createdBy: ctx.params.createdBy || null,
          createdAt: now,
          updatedAt: now,
        };
        await this.db.put(doc);
        return toPublic(doc);
      },
    },

    // ── get ───────────────────────────────────────────────────────────────────
    get: {
      rest: 'GET /:frameId',
      openapi: {
        summary: 'Get a SCQA decision frame by ID',
        tags: [OPENAPI_TAG],
      },
      params: {
        frameId: { type: 'string' },
      },
      async handler(ctx) {
        const doc = await this._getDoc(ctx.params.frameId);
        return toPublic(doc);
      },
    },

    // ── list ──────────────────────────────────────────────────────────────────
    list: {
      rest: 'GET /',
      openapi: {
        summary: 'List SCQA decision frames',
        tags: [OPENAPI_TAG],
      },
      params: {
        domain: { type: 'string', optional: true },
        status: { type: 'string', optional: true },
        createdBy: { type: 'string', optional: true },
        linkedEntityId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, convert: true },
      },
      async handler(ctx) {
        const selector = { type: 'decision_frame' };
        if (ctx.params.domain) selector.domain = ctx.params.domain;
        if (ctx.params.status) selector.status = ctx.params.status;
        if (ctx.params.createdBy) selector.createdBy = ctx.params.createdBy;

        const requestedLimit = Math.min(Number(ctx.params.limit) || 20, 100);
        // Fetch more if we need to post-filter by linkedEntityId
        const fetchLimit = ctx.params.linkedEntityId
          ? Math.min(requestedLimit * 10, 500)
          : requestedLimit;

        const result = await this.db.find({ selector, limit: fetchLimit });
        let docs = result.docs;

        if (ctx.params.linkedEntityId) {
          docs = docs
            .filter((d) => (d.linkedEntities || []).some((e) => e.id === ctx.params.linkedEntityId))
            .slice(0, requestedLimit);
        }

        return { frames: docs.map(toPublic), total: docs.length };
      },
    },

    // ── update ────────────────────────────────────────────────────────────────
    update: {
      rest: 'PUT /:frameId',
      openapi: {
        summary: 'Update a SCQA decision frame (patch answer, status, etc.)',
        tags: [OPENAPI_TAG],
      },
      params: {
        frameId: { type: 'string' },
        situation: { type: 'string', min: 10, optional: true },
        complication: { type: 'string', min: 10, optional: true },
        question: { type: 'string', min: 5, optional: true },
        answer: { type: 'string', optional: true },
        status: { type: 'enum', values: STATUS_VALUES, optional: true },
        role: { type: 'enum', values: ROLE_VALUES, optional: true },
      },
      async handler(ctx) {
        const doc = await this._getDoc(ctx.params.frameId);
        const now = new Date().toISOString();
        const updated = { ...doc, updatedAt: now };

        if (ctx.params.situation !== undefined) updated.situation = ctx.params.situation.trim();
        if (ctx.params.complication !== undefined)
          updated.complication = ctx.params.complication.trim();
        if (ctx.params.question !== undefined) updated.question = ctx.params.question.trim();
        if (ctx.params.answer !== undefined)
          updated.answer = ctx.params.answer ? ctx.params.answer.trim() : null;
        if (ctx.params.status !== undefined) updated.status = ctx.params.status;
        if (ctx.params.role !== undefined) updated.role = ctx.params.role;

        await this.db.put(updated);
        return toPublic(updated);
      },
    },

    // ── linkEntity ────────────────────────────────────────────────────────────
    linkEntity: {
      rest: 'POST /:frameId/links',
      openapi: {
        summary: 'Link a domain entity to a SCQA frame',
        tags: [OPENAPI_TAG],
      },
      params: {
        frameId: { type: 'string' },
        entityType: { type: 'enum', values: ENTITY_TYPE_VALUES },
        entityId: { type: 'string' },
      },
      async handler(ctx) {
        const doc = await this._getDoc(ctx.params.frameId);
        const alreadyLinked = (doc.linkedEntities || []).some(
          (e) => e.type === ctx.params.entityType && e.id === ctx.params.entityId
        );
        if (alreadyLinked) return toPublic(doc);

        const link = {
          type: ctx.params.entityType,
          id: ctx.params.entityId,
          linkedAt: new Date().toISOString(),
        };
        const updated = {
          ...doc,
          linkedEntities: [...(doc.linkedEntities || []), link],
          updatedAt: new Date().toISOString(),
        };
        await this.db.put(updated);
        return toPublic(updated);
      },
    },

    // ── generateStarter ───────────────────────────────────────────────────────
    generateStarter: {
      rest: 'POST /generate-starter',
      openapi: {
        summary: 'AI-assisted SCQA starter from entity context',
        tags: [OPENAPI_TAG],
        description:
          'Gathers context from available downstream services (ZNP, VDMI) and uses an LLM ' +
          'to synthesise a SCQA starter frame. Returns Situation, Complication, Question — ' +
          'the caller decides whether to persist via create. Requires LLM configuration.',
      },
      params: {
        contextHint: { type: 'string', optional: true },
        znpProjectId: { type: 'string', optional: true },
        vdmiMatrixId: { type: 'string', optional: true },
        gridOperatorId: { type: 'string', optional: true },
        domain: { type: 'enum', values: DOMAIN_VALUES, optional: true },
      },
      async handler(ctx) {
        const contextParts = [];

        if (ctx.params.contextHint) {
          contextParts.push(`Nutzerhinweis: ${ctx.params.contextHint}`);
        }

        if (ctx.params.znpProjectId) {
          try {
            const project = await ctx.call('znp.getProjectMeta', {
              projectId: ctx.params.znpProjectId,
            });
            contextParts.push(
              `ZNP-Projekt: ${JSON.stringify({
                projectId: project.projectId,
                name: project.name || null,
                layers: project.layers,
                assetCount: project.assetCount || null,
              })}`
            );
            // Strategic prompts as Question seed — best-effort
            try {
              const prompts = await ctx.call('znp.strategicPrompts', {
                projectId: ctx.params.znpProjectId,
              });
              if (Array.isArray(prompts.questions) && prompts.questions.length > 0) {
                contextParts.push(
                  `Strategische Planungsfragen (als Question-Kontext): ${prompts.questions.join(' | ')}`
                );
              }
            } catch (_) {
              // strategic-prompts requires LLM; degrade silently
            }
          } catch (_) {
            // znp not available — degrade
          }
        }

        if (ctx.params.vdmiMatrixId) {
          try {
            const vdmi = await ctx.call('vdmi.get', { id: ctx.params.vdmiMatrixId });
            contextParts.push(
              `VDMI-Matrix: ${JSON.stringify({
                id: vdmi.id || ctx.params.vdmiMatrixId,
                status: vdmi.status || null,
                findingsCount: vdmi.findingsCount || null,
              })}`
            );
          } catch (_) {
            // vdmi not available — degrade
          }
        }

        if (ctx.params.gridOperatorId) {
          contextParts.push(`Netzbetreiber-ID: ${ctx.params.gridOperatorId}`);
        }

        const domainHint = ctx.params.domain ? `Ziel-Domäne: ${ctx.params.domain}\n` : '';
        const contextBlock =
          contextParts.length > 0 ? `Verfügbarer Kontext:\n${contextParts.join('\n')}\n\n` : '';

        const prompt =
          'Du bist ein Experte für strukturierte Entscheidungsrahmen in der deutschen Energiewirtschaft.\n' +
          'Erstelle einen SCQA-Entscheidungsrahmen (Situation – Complication – Question) auf Basis des folgenden Kontexts.\n\n' +
          domainHint +
          contextBlock +
          'Regeln:\n' +
          '- situation: 1-3 Sätze, faktische Ausgangslage ohne Wertung\n' +
          '- complication: 1-3 Sätze, konkrete Veränderung/Druck/Constraint, der die Entscheidung erzwingt\n' +
          '- question: 1 Satz, die Kernentscheidungsfrage\n' +
          '- suggestedDomain: exakt einer der Werte [infrastructure, regulatory, financial, strategic, operational]\n' +
          '- confidence: low (wenig Kontext verfügbar), medium, oder high (viel Kontext vorhanden)\n\n' +
          'Keine erfundenen Daten. Wenn Kontext fehlt, verwende Platzhalter wie "[Netzgebiet]".';

        const raw = await generateStructured(STARTER_SCHEMA, prompt);

        return {
          situation: typeof raw.situation === 'string' ? raw.situation.trim() : '',
          complication: typeof raw.complication === 'string' ? raw.complication.trim() : '',
          question: typeof raw.question === 'string' ? raw.question.trim() : '',
          suggestedDomain: DOMAIN_VALUES.includes(raw.suggestedDomain)
            ? raw.suggestedDomain
            : ctx.params.domain || 'strategic',
          confidence: ['low', 'medium', 'high'].includes(raw.confidence) ? raw.confidence : 'low',
          contextUsed: {
            znpProjectId: ctx.params.znpProjectId || null,
            vdmiMatrixId: ctx.params.vdmiMatrixId || null,
            gridOperatorId: ctx.params.gridOperatorId || null,
            contextHintProvided: Boolean(ctx.params.contextHint),
          },
        };
      },
    },

    // ── exportSummary ─────────────────────────────────────────────────────────
    exportSummary: {
      rest: 'GET /:frameId/export',
      openapi: {
        summary: 'Export a SCQA frame as Markdown or JSON document',
        tags: [OPENAPI_TAG],
      },
      params: {
        frameId: { type: 'string' },
        format: { type: 'enum', values: ['markdown', 'json'], optional: true, default: 'markdown' },
      },
      async handler(ctx) {
        const doc = await this._getDoc(ctx.params.frameId);

        if (ctx.params.format === 'json') {
          return { frame: toPublic(doc), exportedAt: new Date().toISOString() };
        }

        const domainLine = `**Domäne:** ${doc.domain}${doc.role ? ` | **Rolle:** ${doc.role}` : ''} | **Status:** ${doc.status}`;
        const createdLine = `**Erstellt:** ${doc.createdAt.slice(0, 10)}${doc.createdBy ? ` von ${doc.createdBy}` : ''}`;

        const lines = [
          `# Entscheidungsrahmen — ${doc.frameId}`,
          domainLine,
          createdLine,
          '',
          '## Situation',
          doc.situation,
          '',
          '## Complication',
          doc.complication,
          '',
          '## Question (Kernfrage)',
          doc.question,
          '',
          '## Answer',
          doc.answer || '_Noch nicht befüllt._',
          '',
        ];

        if (doc.linkedEntities && doc.linkedEntities.length > 0) {
          lines.push('## Verknüpfte Objekte');
          for (const e of doc.linkedEntities) {
            lines.push(`- **${e.type}**: ${e.id}`);
          }
          lines.push('');
        }

        return {
          frameId: doc.frameId,
          format: 'markdown',
          content: lines.join('\n'),
          exportedAt: new Date().toISOString(),
        };
      },
    },
  },

  methods: {
    async _getDoc(frameId) {
      try {
        return await this.db.get(docId(frameId));
      } catch (err) {
        if (err.status === 404) {
          throw new MoleculerClientError(
            `Decision frame '${frameId}' not found.`,
            404,
            'DECISION_FRAME_NOT_FOUND',
            { frameId }
          );
        }
        throw err;
      }
    },
  },
};
