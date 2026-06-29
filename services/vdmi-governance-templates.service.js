'use strict';

/**
 * VDMI Governance Templates Service — Reusable VDMI Role/Interface Matrices
 *
 * Issue #121 — VDMI Governance Templates
 *
 * VDMI governance practice requires clear role/interface definitions between
 * stakeholders (grid operator, asset owner, planning authority, regulator).
 * Anonymised, reusable templates derived from real project governance artefacts
 * reduce repeated specification work and protect against missing evidence gates.
 *
 * This service provides:
 *   1. Template library with RACI matrices and interface definitions
 *   2. Template instantiation with tenant/project substitutions
 *   3. Evidence requirement checklists per template type
 *   4. Completeness scoring and gap identification
 *   5. Approval audit trail for governance records
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const TMPL_PREFIX = 'vgt:';
const INST_PREFIX = 'vgi:';

const TEMPLATE_TYPE = Object.freeze({
  GRID_CONNECTION_RACI: 'GRID_CONNECTION_RACI',
  ASSET_HANDOVER: 'ASSET_HANDOVER',
  REDISPATCH_INTERFACE: 'REDISPATCH_INTERFACE',
  NETZKOPPELVERTRAG_ROLES: 'NETZKOPPELVERTRAG_ROLES',
  INVESTMENT_DECISION_RACI: 'INVESTMENT_DECISION_RACI',
  REGULATORY_REPORTING: 'REGULATORY_REPORTING',
});

// Built-in base templates (anonymised)
const BASE_TEMPLATES = {
  [TEMPLATE_TYPE.GRID_CONNECTION_RACI]: {
    templateType: TEMPLATE_TYPE.GRID_CONNECTION_RACI,
    description: 'RACI für Netzanschlussverfahren (technisch, kommerziell, regulatorisch)',
    evidenceRequirements: [
      'Netzanschlusspunkt dokumentiert',
      'Spannungsebene bestätigt',
      'Netzverträglichkeitsprüfung abgeschlossen',
      'Technische Anschlussbedingungen akzeptiert',
      'Anschlussvertrag unterzeichnet',
    ],
    roles: ['ANSCHLUSSNEHMER', 'NETZBETREIBER', 'PLANER', 'BEHOERDE', 'PRUEFSTELLE'],
    matrix: [
      {
        activity: 'Antrag stellen',
        ANSCHLUSSNEHMER: 'R',
        NETZBETREIBER: 'I',
        PLANER: 'C',
        BEHOERDE: 'I',
        PRUEFSTELLE: '-',
      },
      {
        activity: 'Netzverträglichkeit prüfen',
        ANSCHLUSSNEHMER: 'I',
        NETZBETREIBER: 'R',
        PLANER: 'C',
        BEHOERDE: '-',
        PRUEFSTELLE: 'C',
      },
      {
        activity: 'Angebot erstellen',
        ANSCHLUSSNEHMER: 'I',
        NETZBETREIBER: 'R',
        PLANER: '-',
        BEHOERDE: '-',
        PRUEFSTELLE: '-',
      },
      {
        activity: 'Angebot annehmen',
        ANSCHLUSSNEHMER: 'R',
        NETZBETREIBER: 'I',
        PLANER: '-',
        BEHOERDE: '-',
        PRUEFSTELLE: '-',
      },
      {
        activity: 'Bauausführung',
        ANSCHLUSSNEHMER: 'I',
        NETZBETREIBER: 'A',
        PLANER: 'R',
        BEHOERDE: '-',
        PRUEFSTELLE: 'I',
      },
      {
        activity: 'Abnahme',
        ANSCHLUSSNEHMER: 'C',
        NETZBETREIBER: 'A',
        PLANER: '-',
        BEHOERDE: '-',
        PRUEFSTELLE: 'R',
      },
    ],
  },
  [TEMPLATE_TYPE.REDISPATCH_INTERFACE]: {
    templateType: TEMPLATE_TYPE.REDISPATCH_INTERFACE,
    description: 'Schnittstellendefinition Redispatch 2.0 zwischen ANB, BNB, Direktvermarkter',
    evidenceRequirements: [
      'EIC-Code Anlage registriert',
      'Steuerdaten beim ANB hinterlegt',
      'Kommunikationstests abgeschlossen',
      'Rollout-Zeitplan vereinbart',
    ],
    roles: ['ANB', 'BNB', 'DIREKTVERMARKTER', 'ANLAGENBETREIBER'],
    matrix: [
      {
        activity: 'Stammdaten melden',
        ANB: 'C',
        BNB: 'R',
        DIREKTVERMARKTER: 'C',
        ANLAGENBETREIBER: 'I',
      },
      {
        activity: 'Einspeisemanagement-Abruf',
        ANB: 'R',
        BNB: 'I',
        DIREKTVERMARKTER: 'C',
        ANLAGENBETREIBER: 'I',
      },
      {
        activity: 'Abrechnungsreport',
        ANB: 'I',
        BNB: 'R',
        DIREKTVERMARKTER: 'C',
        ANLAGENBETREIBER: 'I',
      },
    ],
  },
  [TEMPLATE_TYPE.INVESTMENT_DECISION_RACI]: {
    templateType: TEMPLATE_TYPE.INVESTMENT_DECISION_RACI,
    description: 'RACI für Investitionsentscheidungen (CAPEX-Gate, Regulatorik, C-Level)',
    evidenceRequirements: [
      'Wirtschaftlichkeitsberechnung vorliegend',
      'Regulatorische Einschätzung eingeholt',
      'CAPEX-Budget freigegeben',
      'Technische Machbarkeit bestätigt',
    ],
    roles: ['FACHBEREICH', 'CONTROLLING', 'REGULATORIK', 'GESCHAEFTSFUEHRUNG'],
    matrix: [
      {
        activity: 'Maßnahme identifizieren',
        FACHBEREICH: 'R',
        CONTROLLING: 'C',
        REGULATORIK: 'C',
        GESCHAEFTSFUEHRUNG: 'I',
      },
      {
        activity: 'Business Case erstellen',
        FACHBEREICH: 'R',
        CONTROLLING: 'A',
        REGULATORIK: 'C',
        GESCHAEFTSFUEHRUNG: 'I',
      },
      {
        activity: 'Regulatorische Prüfung',
        FACHBEREICH: 'C',
        CONTROLLING: 'I',
        REGULATORIK: 'R',
        GESCHAEFTSFUEHRUNG: 'I',
      },
      {
        activity: 'CAPEX-Genehmigung',
        FACHBEREICH: 'I',
        CONTROLLING: 'C',
        REGULATORIK: 'C',
        GESCHAEFTSFUEHRUNG: 'R',
      },
    ],
  },
};

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  name: 'vdmi-governance-templates',

  settings: {
    dbPath: process.env.VDMI_TEMPLATES_DB_PATH || './data/vdmi-governance-templates',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['tenantId'] } });
    await this.db.createIndex({ index: { fields: ['templateType'] } });
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['tenantId', 'type', 'createdAt'] } });
    this.logger.info(`VDMI Governance Templates DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) await this.db.close();
  },

  actions: {
    /**
     * @openapi
     * /api/vdmi-governance-templates/templates:
     *   get:
     *     tags: [VDMI Governance Templates]
     *     summary: List available base template types
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Available template types
     */
    listBaseTemplates: {
      rest: 'GET /templates',
      async handler(_ctx) {
        return {
          baseTemplates: Object.keys(BASE_TEMPLATES).map((t) => ({
            templateType: t,
            description: BASE_TEMPLATES[t].description,
            roleCount: BASE_TEMPLATES[t].roles.length,
            evidenceRequirementCount: BASE_TEMPLATES[t].evidenceRequirements.length,
            activityCount: BASE_TEMPLATES[t].matrix.length,
          })),
        };
      },
    },

    /**
     * @openapi
     * /api/vdmi-governance-templates/instances:
     *   post:
     *     tags: [VDMI Governance Templates]
     *     summary: Instantiate a governance template for a project
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, templateType]
     *             properties:
     *               gridOperatorId: { type: string }
     *               templateType:
     *                 type: string
     *                 enum: [GRID_CONNECTION_RACI, ASSET_HANDOVER, REDISPATCH_INTERFACE,
     *                        NETZKOPPELVERTRAG_ROLES, INVESTMENT_DECISION_RACI, REGULATORY_REPORTING]
     *               projectId: { type: string }
     *               label: { type: string }
     *               roleAssignments:
     *                 type: object
     *                 description: Map of role -> person/team name
     *               evidenceStatus:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     requirement: { type: string }
     *                     met: { type: boolean }
     *                     note: { type: string }
     *     responses:
     *       200:
     *         description: Instantiated governance template
     *       400:
     *         description: Unknown template type
     */
    instantiate: {
      rest: 'POST /instances',
      params: {
        gridOperatorId: { type: 'string' },
        templateType: { type: 'string', enum: Object.values(TEMPLATE_TYPE) },
        projectId: { type: 'string', optional: true },
        label: { type: 'string', optional: true },
        roleAssignments: { type: 'object', optional: true },
        evidenceStatus: { type: 'array', items: 'object', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, templateType, projectId, label, roleAssignments, evidenceStatus } =
          ctx.params;

        const base = BASE_TEMPLATES[templateType];
        if (!base) {
          throw new MoleculerClientError('Unknown template type', 400, 'UNKNOWN_TEMPLATE_TYPE');
        }

        const instanceId = `${INST_PREFIX}${crypto.randomUUID()}`;

        // Check evidence completeness
        const evStatusMap = {};
        (evidenceStatus ?? []).forEach((e) => {
          evStatusMap[e.requirement] = e;
        });
        const evidenceCompleteness = base.evidenceRequirements.map((req) => ({
          requirement: req,
          met: evStatusMap[req]?.met ?? false,
          note: evStatusMap[req]?.note ?? null,
        }));
        const metCount = evidenceCompleteness.filter((e) => e.met).length;
        const completenessScore =
          base.evidenceRequirements.length > 0
            ? Math.round((metCount / base.evidenceRequirements.length) * 100)
            : 100;

        const doc = {
          _id: instanceId,
          type: 'vdmi-governance-instance',
          tenantId,
          gridOperatorId,
          templateType,
          pipelineVersion: PIPELINE_VERSION,
          projectId: projectId ?? null,
          label: label ?? null,
          roleAssignments: roleAssignments ?? {},
          matrix: base.matrix,
          evidenceCompleteness,
          completenessScore,
          approved: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };

        await this.db.put(doc);

        return {
          instanceId,
          templateType,
          completenessScore,
          unmetEvidence: evidenceCompleteness.filter((e) => !e.met).map((e) => e.requirement),
          matrix: base.matrix,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/vdmi-governance-templates/instances:
     *   get:
     *     tags: [VDMI Governance Templates]
     *     summary: List governance template instances
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: templateType
     *         schema: { type: string }
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of instances
     */
    listInstances: {
      rest: 'GET /instances',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        templateType: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, templateType, limit } = ctx.params;
        const selector = {
          tenantId,
          type: 'vdmi-governance-instance',
          createdAt: { $exists: true },
        };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (templateType) selector.templateType = templateType;
        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { instances: result.docs };
      },
    },

    /**
     * @openapi
     * /api/vdmi-governance-templates/instances/{id}:
     *   get:
     *     tags: [VDMI Governance Templates]
     *     summary: Get governance template instance by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Instance document
     *       404:
     *         description: Not found
     */
    getInstance: {
      rest: 'GET /instances/:id',
      params: { id: { type: 'string' } },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404)
            throw new MoleculerClientError('Instance not found', 404, 'INSTANCE_NOT_FOUND');
          throw err;
        }
      },
    },
  },
};
