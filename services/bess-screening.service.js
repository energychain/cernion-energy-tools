'use strict';

/**
 * BESS Screening Service — VNB Evidenzguard
 *
 * Issue #131 — BESS Screening VNB-Evidenzguard
 *
 * Battery Energy Storage System (BESS) and large-load connection requests often
 * arrive with location, power, and energy content but without verified evidence
 * for: responsible grid operator (VNB), network territory, voltage level, and
 * bottleneck context.
 *
 * This service:
 *   1. Accepts a BESS connection request with the supplied parameters.
 *   2. Clearly separates market-partner data (MaStR / plausibility) from
 *      verified VNB evidence.
 *   3. Marks open proofs ("Offene Nachweise") and keeps routing stable in the
 *      BESS screening domain.
 *   4. Produces a structured evidence gap report with next-step recommendations.
 *
 * Pipeline version: 0.1.0
 */

const crypto = require('crypto');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId } = require('../src/tenant-context');

const PIPELINE_VERSION = '0.1.0';
const OPENAPI_TAG = 'BESS Screening';
const DOC_PREFIX = 'bess:';

// Evidence quality tiers
const EVIDENCE_TIER = Object.freeze({
  VERIFIED: 'VERIFIED', // confirmed by official VNB document / MaStR record
  PLAUSIBLE: 'PLAUSIBLE', // market-partner data / MaStR-based plausibility
  UNVERIFIED: 'UNVERIFIED', // user-supplied, no independent confirmation
  MISSING: 'MISSING', // required but not provided
});

const REQUIRED_EVIDENCE_FIELDS = [
  'vnbMastrId',
  'networkTerritory',
  'voltageLevel',
  'netzverknuepfungspunkt',
  'bottleneckContext',
];

function nowIso() {
  return new Date().toISOString();
}

/**
 * Classify supplied evidence against the required fields.
 */
function classifyEvidence(params) {
  const evidenceItems = [];

  // VNB identity
  evidenceItems.push({
    field: 'vnbMastrId',
    label: 'Zuständiger VNB (MaStR-ID)',
    supplied: !!params.vnbMastrId,
    tier: params.vnbMastrIdVerified
      ? EVIDENCE_TIER.VERIFIED
      : params.vnbMastrId
        ? EVIDENCE_TIER.PLAUSIBLE
        : EVIDENCE_TIER.MISSING,
    value: params.vnbMastrId ?? null,
    openProof: !params.vnbMastrIdVerified,
    nextStep: !params.vnbMastrId
      ? 'MaStR-Abfrage für Netzgebiet durchführen (PLZ/Gemeinde)'
      : !params.vnbMastrIdVerified
        ? 'VNB-Zuständigkeit per offiziellem Netzgebietsatlas verifizieren'
        : null,
  });

  // Network territory
  evidenceItems.push({
    field: 'networkTerritory',
    label: 'Netzgebiet (Gemarkungs-Polygon oder Gemeindeschlüssel)',
    supplied: !!params.networkTerritory,
    tier: params.networkTerritoryVerified
      ? EVIDENCE_TIER.VERIFIED
      : params.networkTerritory
        ? EVIDENCE_TIER.UNVERIFIED
        : EVIDENCE_TIER.MISSING,
    value: params.networkTerritory ?? null,
    openProof: !params.networkTerritoryVerified,
    nextStep:
      !params.networkTerritory || !params.networkTerritoryVerified
        ? 'Netzgebiet gegen BDEW-Netzgebietsdatenbank oder VNB-Geoatlas prüfen'
        : null,
  });

  // Voltage level
  evidenceItems.push({
    field: 'voltageLevel',
    label: 'Spannungsebene (NS/MS/HS)',
    supplied: !!params.voltageLevel,
    tier: params.voltageLevelVerified
      ? EVIDENCE_TIER.VERIFIED
      : params.voltageLevel
        ? EVIDENCE_TIER.PLAUSIBLE
        : EVIDENCE_TIER.MISSING,
    value: params.voltageLevel ?? null,
    openProof: !params.voltageLevelVerified,
    nextStep:
      !params.voltageLevel || !params.voltageLevelVerified
        ? 'Spannungsebene per NAP-Abfrage oder VNB-Rückmeldung belegen'
        : null,
  });

  // Netzverknüpfungspunkt (NAP)
  evidenceItems.push({
    field: 'netzverknuepfungspunkt',
    label: 'Netzverknüpfungspunkt (NAP / Umspannwerk)',
    supplied: !!params.netzverknuepfungspunkt,
    tier: params.netzverknuepfungspunktVerified
      ? EVIDENCE_TIER.VERIFIED
      : params.netzverknuepfungspunkt
        ? EVIDENCE_TIER.UNVERIFIED
        : EVIDENCE_TIER.MISSING,
    value: params.netzverknuepfungspunkt ?? null,
    openProof: !params.netzverknuepfungspunktVerified,
    nextStep:
      !params.netzverknuepfungspunkt || !params.netzverknuepfungspunktVerified
        ? 'NAP durch VNB-Netzzugangsanfrage bestätigen lassen'
        : null,
  });

  // Bottleneck context
  evidenceItems.push({
    field: 'bottleneckContext',
    label: 'Engpasskontext (N-1-Situation, vorhandene Kapazität)',
    supplied: !!params.bottleneckContext,
    tier: params.bottleneckContextVerified
      ? EVIDENCE_TIER.VERIFIED
      : params.bottleneckContext
        ? EVIDENCE_TIER.UNVERIFIED
        : EVIDENCE_TIER.MISSING,
    value: params.bottleneckContext ?? null,
    openProof: !params.bottleneckContextVerified,
    nextStep:
      !params.bottleneckContext || !params.bottleneckContextVerified
        ? 'Kapazitätssituation und N-1-Status am NAP vom VNB anfordern'
        : null,
  });

  return evidenceItems;
}

/**
 * Compute the overall evidence quality score (0–1) and readiness tier.
 */
function computeEvidenceScore(evidenceItems) {
  const tierWeights = {
    [EVIDENCE_TIER.VERIFIED]: 1.0,
    [EVIDENCE_TIER.PLAUSIBLE]: 0.5,
    [EVIDENCE_TIER.UNVERIFIED]: 0.25,
    [EVIDENCE_TIER.MISSING]: 0,
  };
  const total = evidenceItems.length;
  const score = evidenceItems.reduce((sum, item) => sum + (tierWeights[item.tier] ?? 0), 0) / total;

  let readiness;
  if (score >= 0.9) readiness = 'SCREENING_READY';
  else if (score >= 0.6) readiness = 'PARTIAL_EVIDENCE';
  else if (score >= 0.3) readiness = 'EVIDENCE_GAPS_CRITICAL';
  else readiness = 'INSUFFICIENT_FOR_SCREENING';

  return { score: Math.round(score * 100) / 100, readiness };
}

module.exports = {
  name: 'bess-screening',

  mixins: [
    createPouchDbLifecycleMixin({
      dbPathEnvVar: 'BESS_SCREENING_DB_PATH',
      defaultDbPath: './data/bess-screening',
      indexes: [
        ['tenantId'],
        ['tenantId', 'type', 'createdAt'],
        ['gridOperatorId'],
        ['createdAt'],
        ['evidenceReadiness'],
      ],
    }),
  ],

  actions: {
    /**
     * @openapi
     * /api/bess-screening/screenings:
     *   post:
     *     tags: [BESS Screening]
     *     summary: Run BESS/large-storage connection evidence screening
     *     description: >
     *       Separates market-partner / plausibility data from verified VNB evidence
     *       for a BESS connection request. Returns structured evidence gaps and
     *       next-step recommendations.
     *     security:
     *       - bearerAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [gridOperatorId, powerKw, energyKwh, location]
     *             properties:
     *               gridOperatorId:
     *                 type: string
     *               powerKw:
     *                 type: number
     *               energyKwh:
     *                 type: number
     *               location:
     *                 type: object
     *               vnbMastrId:
     *                 type: string
     *               vnbMastrIdVerified:
     *                 type: boolean
     *               networkTerritory:
     *                 type: string
     *               networkTerritoryVerified:
     *                 type: boolean
     *               voltageLevel:
     *                 type: string
     *               voltageLevelVerified:
     *                 type: boolean
     *               netzverknuepfungspunkt:
     *                 type: string
     *               netzverknuepfungspunktVerified:
     *                 type: boolean
     *               bottleneckContext:
     *                 type: string
     *               bottleneckContextVerified:
     *                 type: boolean
     *     responses:
     *       200:
     *         description: BESS screening result with evidence classification
     */
    screen: {
      rest: 'POST /screenings',
      timeout: 30_000,
      params: {
        gridOperatorId: { type: 'string' },
        powerKw: { type: 'number', min: 1, convert: true },
        energyKwh: { type: 'number', min: 1, convert: true },
        location: { type: 'object' },
        // Evidence fields — all optional with verification flags
        vnbMastrId: { type: 'string', optional: true },
        vnbMastrIdVerified: { type: 'boolean', optional: true, default: false, convert: true },
        networkTerritory: { type: 'string', optional: true },
        networkTerritoryVerified: {
          type: 'boolean',
          optional: true,
          default: false,
          convert: true,
        },
        voltageLevel: {
          type: 'enum',
          values: ['NS', 'MS', 'HS', 'EHS'],
          optional: true,
        },
        voltageLevelVerified: { type: 'boolean', optional: true, default: false, convert: true },
        netzverknuepfungspunkt: { type: 'string', optional: true },
        netzverknuepfungspunktVerified: {
          type: 'boolean',
          optional: true,
          default: false,
          convert: true,
        },
        bottleneckContext: { type: 'string', optional: true },
        bottleneckContextVerified: {
          type: 'boolean',
          optional: true,
          default: false,
          convert: true,
        },
        projectDescription: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const screeningId = `${DOC_PREFIX}${crypto.randomUUID()}`;

        const evidenceItems = classifyEvidence(ctx.params);
        const { score, readiness } = computeEvidenceScore(evidenceItems);

        const openProofs = evidenceItems.filter((e) => e.openProof && e.nextStep);
        const missingFields = evidenceItems
          .filter((e) => e.tier === EVIDENCE_TIER.MISSING)
          .map((e) => e.field);

        const doc = {
          _id: screeningId,
          type: 'bess-screening',
          tenantId,
          gridOperatorId: ctx.params.gridOperatorId,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: nowIso(),
          status: 'COMPLETED',
          evidenceReadiness: readiness,
          evidenceScore: score,
          request: {
            powerKw: ctx.params.powerKw,
            energyKwh: ctx.params.energyKwh,
            location: ctx.params.location,
            projectDescription: ctx.params.projectDescription,
          },
          evidenceItems,
          openProofs: openProofs.map((e) => ({
            field: e.field,
            label: e.label,
            currentTier: e.tier,
            nextStep: e.nextStep,
          })),
          missingFields,
          recommendation:
            readiness === 'SCREENING_READY'
              ? 'Evidenzlage ausreichend für technische Machbarkeitsprüfung'
              : readiness === 'PARTIAL_EVIDENCE'
                ? 'Fehlende Nachweise anfordern bevor Kapazitätszusage erteilt wird'
                : 'Screening eingestellt — kritische Evidenzlücken müssen zuerst geschlossen werden',
        };

        await this.db.put(doc);
        this.logger.info(
          `BESS screening ${screeningId}: readiness=${readiness}, score=${score}, openProofs=${openProofs.length}`
        );

        return {
          screeningId,
          evidenceReadiness: readiness,
          evidenceScore: score,
          openProofs: doc.openProofs,
          missingFields,
          evidenceItems,
          recommendation: doc.recommendation,
          pipelineVersion: PIPELINE_VERSION,
          createdAt: doc.createdAt,
        };
      },
    },

    /**
     * @openapi
     * /api/bess-screening/screenings:
     *   get:
     *     tags: [BESS Screening]
     *     summary: List BESS screenings
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: query
     *         name: gridOperatorId
     *         schema: { type: string }
     *       - in: query
     *         name: evidenceReadiness
     *         schema:
     *           type: string
     *           enum: [SCREENING_READY, PARTIAL_EVIDENCE, EVIDENCE_GAPS_CRITICAL, INSUFFICIENT_FOR_SCREENING]
     *       - in: query
     *         name: limit
     *         schema: { type: integer, default: 20 }
     *     responses:
     *       200:
     *         description: List of screenings
     */
    list: {
      rest: 'GET /screenings',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        evidenceReadiness: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, min: 1, max: 200, convert: true },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const { gridOperatorId, evidenceReadiness, limit } = ctx.params;

        const selector = { tenantId, type: 'bess-screening', createdAt: { $exists: true } };
        if (gridOperatorId) selector.gridOperatorId = gridOperatorId;
        if (evidenceReadiness) selector.evidenceReadiness = evidenceReadiness;

        const result = await this.db.find({ selector, limit, sort: [{ createdAt: 'desc' }] });
        return { screenings: result.docs };
      },
    },

    /**
     * @openapi
     * /api/bess-screening/screenings/{id}:
     *   get:
     *     tags: [BESS Screening]
     *     summary: Get a BESS screening by ID
     *     security:
     *       - bearerAuth: []
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema: { type: string }
     *     responses:
     *       200:
     *         description: Screening document
     *       404:
     *         description: Not found
     */
    get: {
      rest: 'GET /screenings/:id',
      params: {
        id: { type: 'string' },
      },
      async handler(ctx) {
        try {
          return await this.db.get(ctx.params.id);
        } catch (err) {
          if (err.status === 404) {
            throw new MoleculerClientError('Screening not found', 404, 'SCREENING_NOT_FOUND');
          }
          throw err;
        }
      },
    },
  },
};
