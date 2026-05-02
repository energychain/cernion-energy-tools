'use strict';

/**
 * Redispatch Ex-Post Agent Service (v0.18.0)
 *
 * Deterministic 7-step pipeline that audits the Redispatch 2.0 portfolio of a VNB,
 * cross-references MaStR master data with Netztransparenz curtailment data, and
 * computes settlement readiness and financial risk estimates.
 *
 * No LLM involvement — identical inputs always produce identical finding codes.
 * Excluded from the LLM agent catalogue (agent.service.js skipServices).
 *
 * Regulatory basis: §§ 13, 13a EnWG, NABEG, StromNZV, Redispatch 2.0 (BDEW/BNetzA),
 * EU AI Act Art. 12 (audit trail).
 */

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const CernionMCPClient = require('../src/mcp-client');
const {
  createFinding,
  summarizeFindings,
  // Shared step 1 — VNB Identity
  VNB_RESOLVED,
  VNB_AMBIGUOUS,
  VNB_NOT_FOUND,
  // Shared audit trail
  AUDIT_TRAIL_CREATED,
  SNAPSHOT_DRIFT_DETECTED,
  // RD Step 2 — Portfolio
  RD_PORTFOLIO_COMPLETE,
  RD_PORTFOLIO_EMPTY,
  RD_PORTFOLIO_INCLUDES_INACTIVE,
  // RD Step 3 — Master data validation
  RD_MISSING_NAP,
  RD_MISSING_MELO,
  RD_MISSING_BTR,
  RD_NAP_VNB_MISMATCH,
  RD_DV_NOT_CONTROLLABLE,
  RD_CAPACITY_ANOMALY,
  // RD Step 4 — Curtailment correlation
  RD_CURTAILMENT_VOLUME,
  RD_HIGH_CURTAILMENT_PERIOD,
  RD_CURTAILMENT_DATA_UNAVAILABLE,
  RD_CURTAILMENT_ZERO,
  // RD Step 5 — Settlement readiness
  RD_SETTLEMENT_READY,
  RD_SETTLEMENT_PARTIAL,
  RD_SETTLEMENT_CRITICAL,
  // RD Step 6 — Risk assessment
  RD_RISK_LOW,
  RD_RISK_MEDIUM,
  RD_RISK_HIGH,
} = require('../src/validation-findings');
const { assessSettlementReadiness, assessRisk } = require('../src/redispatch-risk');

const PIPELINE_VERSION = '0.18.0';

// MaStR status code 35 = InBetrieb
const STATUS_IN_BETRIEB = 35;

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------
module.exports = {
  name: 'redispatch-expost',

  settings: {
    dbPath: process.env.REDISPATCH_EXPOST_DB_PATH || './data/redispatch-expost',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperator.mastrId'] } });
    this.logger.info(`Redispatch Ex-Post DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  actions: {
    /**
     * Run the 7-step Redispatch Ex-Post settlement audit pipeline.
     * Deterministic — no LLM, no probabilistic logic.
     */
    audit: {
      rest: 'POST /audit',
      timeout: 180_000,
      params: {
        gridOperatorId: { type: 'string', optional: true },
        gridOperatorBdew: { type: 'string', optional: true },
        gridOperatorName: { type: 'string', optional: true },
        dateFrom: { type: 'string', optional: true },
        dateTo: { type: 'string', optional: true },
        datapointTags: { type: 'array', items: 'string', optional: true, default: [] },
        maxAgeMinutes: { type: 'number', optional: true, default: 120, convert: true },
        skipSteps: { type: 'array', items: 'number', optional: true, default: [] },
        avgCompensationEurPerMWh: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        summary: 'Run Redispatch Ex-Post settlement audit (7-step, deterministic)',
        description:
          'Executes a deterministic 7-step Redispatch 2.0 Ex-Post settlement audit for a VNB: ' +
          'VNB identity → portfolio inventory (≥100 kW) → master data validation → ' +
          'Netztransparenz curtailment correlation → settlement readiness → ' +
          'financial risk assessment → audit trail. ' +
          'Returns settlementReadiness (% of installations ready for A96 settlement) and ' +
          'riskAssessment (estimated lost compensation in €). ' +
          'No LLM involvement — identical inputs always produce identical finding codes. ' +
          'Steps 3–6 can be skipped via the skipSteps parameter; steps 1, 2, and 7 are mandatory.',
        tags: ['Redispatch Ex-Post'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperatorId: {
                    type: 'string',
                    description: 'MaStR grid operator ID (SNB.../GNB...)',
                    example: 'SNB935578300972',
                  },
                  gridOperatorBdew: {
                    type: 'string',
                    description: '13-digit BDEW market-partner code',
                    example: '9907473000008',
                  },
                  gridOperatorName: {
                    type: 'string',
                    description: 'Grid operator name (fuzzy match)',
                    example: 'TWL Netze',
                  },
                  dateFrom: {
                    type: 'string',
                    format: 'date',
                    description: 'Start of audit period (ISO date) for Netztransparenz correlation',
                    example: '2026-01-01',
                  },
                  dateTo: {
                    type: 'string',
                    format: 'date',
                    description: 'End of audit period (ISO date) for Netztransparenz correlation',
                    example: '2026-03-31',
                  },
                  datapointTags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Tags for Weg B datapoint fallback (portfolio data)',
                    example: ['twl-netze', 'redispatch-portfolio'],
                  },
                  maxAgeMinutes: {
                    type: 'integer',
                    default: 120,
                    description: 'Datapoint freshness threshold in minutes (Weg B)',
                  },
                  skipSteps: {
                    type: 'array',
                    items: { type: 'integer' },
                    description: 'Steps to skip (valid: 3–6; steps 1, 2, 7 are mandatory)',
                    example: [4],
                  },
                  avgCompensationEurPerMWh: {
                    type: 'number',
                    default: 50,
                    description:
                      'Average Redispatch compensation rate in €/MWh for risk calculation',
                  },
                },
              },
              examples: {
                'By MaStR ID, full quarter': {
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    dateFrom: '2026-01-01',
                    dateTo: '2026-03-31',
                  },
                },
                'By BDEW, skip curtailment': {
                  value: { gridOperatorBdew: '9907473000008', skipSteps: [4] },
                },
                'Weg B — use tagged datapoint': {
                  value: {
                    gridOperatorId: 'SNB935578300972',
                    datapointTags: ['twl-netze', 'redispatch-portfolio'],
                    maxAgeMinutes: 60,
                    dateFrom: '2026-01-01',
                    dateTo: '2026-03-31',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description:
              'RedispatchAuditReport with settlementReadiness, riskAssessment, and findings',
            content: {
              'application/json': {
                example: {
                  success: true,
                  id: 'a1b2c3d4-...',
                  settlementReadiness: {
                    totalInstallations: 59,
                    readyForSettlement: 52,
                    readinessPercent: 88.1,
                    blockedInstallations: 7,
                  },
                  riskAssessment: {
                    riskLevel: 'medium',
                    estimatedLostCompensationEur: 28500,
                    curtailmentGWh: 4.8,
                    blockedFractionPercent: 11.9,
                  },
                  summary: {
                    findingsCount: { info: 5, warning: 9, error: 4 },
                    durationMs: 12800,
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { gridOperatorId, gridOperatorBdew, gridOperatorName } = ctx.params;
        if (!gridOperatorId && !gridOperatorBdew && !gridOperatorName) {
          throw new Error(
            'At least one of gridOperatorId, gridOperatorBdew, or gridOperatorName is required'
          );
        }

        // Validate skipSteps — only 3–6 allowed
        const rawSkip = ctx.params.skipSteps || [];
        const invalidSteps = rawSkip.filter((s) => ![3, 4, 5, 6].includes(s));
        if (invalidSteps.length > 0) {
          throw new Error(
            `Invalid skipSteps values: [${invalidSteps.join(', ')}]. Only steps 3–6 can be skipped.`
          );
        }

        const report = await this.runPipeline(ctx, ctx.params);

        // Persist to PouchDB (KRITIS: raw installation data NOT stored, only report metadata)
        const id = crypto.randomUUID();
        const doc = {
          _id: `rd:${id}`,
          id,
          type: 'redispatch-expost-audit',
          gridOperator: report.gridOperator,
          period: report.period,
          settlementReadiness: report.settlementReadiness,
          riskAssessment: report.riskAssessment,
          summary: report.summary,
          findingsCount: report.summary?.findingsCount,
          skippedSteps: rawSkip,
          steps: report.steps,
          metadata: {
            ...report.metadata,
            inputParams: {
              gridOperatorId: ctx.params.gridOperatorId || null,
              gridOperatorBdew: ctx.params.gridOperatorBdew || null,
              gridOperatorName: ctx.params.gridOperatorName || null,
              dateFrom: ctx.params.dateFrom || null,
              dateTo: ctx.params.dateTo || null,
              datapointTags: ctx.params.datapointTags || [],
              maxAgeMinutes: ctx.params.maxAgeMinutes,
              skipSteps: rawSkip,
              avgCompensationEurPerMWh: ctx.params.avgCompensationEurPerMWh || 50,
            },
          },
          pipelineVersion: PIPELINE_VERSION,
          createdAt: new Date().toISOString(),
        };

        await this.db.put(doc);

        return { success: true, id, ...report };
      },
    },

    /**
     * List past audit reports (newest first).
     */
    list: {
      rest: 'GET /audits',
      params: {
        gridOperatorId: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, default: 20, convert: true, max: 100 },
      },
      openapi: {
        summary: 'List past Redispatch Ex-Post audit reports',
        description:
          'Returns audit reports stored in PouchDB, newest first. Filter by gridOperatorId.',
        tags: ['Redispatch Ex-Post'],
        parameters: [
          {
            name: 'gridOperatorId',
            in: 'query',
            schema: { type: 'string', example: 'SNB935578300972' },
            description: 'Filter by MaStR grid operator ID',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20, maximum: 100 },
            description: 'Maximum number of results',
          },
        ],
        responses: {
          200: {
            description: 'List of audit report summaries',
            content: {
              'application/json': {
                example: {
                  count: 2,
                  audits: [
                    {
                      id: '...',
                      gridOperator: { name: 'TWL Netze' },
                      settlementReadiness: { readinessPercent: 88.1 },
                      riskAssessment: { riskLevel: 'medium' },
                      createdAt: '2026-03-31T...',
                    },
                  ],
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const result = await this.db.allDocs({
          include_docs: true,
          startkey: 'rd:',
          endkey: 'rd:\ufff0',
        });

        let docs = result.rows.map((r) => r.doc);

        if (ctx.params.gridOperatorId) {
          docs = docs.filter((d) => d.gridOperator?.mastrId === ctx.params.gridOperatorId);
        }

        docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        const limit = Math.min(ctx.params.limit || 20, 100);
        docs = docs.slice(0, limit);

        return {
          count: docs.length,
          audits: docs.map((d) => ({
            id: d.id,
            gridOperator: d.gridOperator,
            period: d.period,
            settlementReadiness: d.settlementReadiness,
            riskAssessment: d.riskAssessment,
            skippedSteps: d.skippedSteps,
            createdAt: d.createdAt,
            findingsCount: d.findingsCount,
            durationMs: d.summary?.durationMs,
          })),
        };
      },
    },

    /**
     * Retrieve a single audit report by ID.
     */
    get: {
      rest: 'GET /audits/:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get a specific Redispatch Ex-Post audit report by ID',
        description: 'Returns the full RedispatchAuditReport document including all findings.',
        tags: ['Redispatch Ex-Post'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'a1b2c3d4-1234-5678-90ab-cdef12345678' },
            description: 'Audit report UUID',
          },
        ],
        responses: {
          200: { description: 'Full RedispatchAuditReport document' },
          404: { description: 'Audit report not found' },
        },
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`rd:${ctx.params.id}`);
          return { success: true, ...doc };
        } catch (err) {
          if (err.status === 404 || err.name === 'not_found') {
            ctx.meta.$statusCode = 404;
            return { success: false, message: `Audit ${ctx.params.id} not found` };
          }
          throw err;
        }
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Methods — pipeline steps and helpers
  // ---------------------------------------------------------------------------
  methods: {
    // -------------------------------------------------------------------------
    // Step 1: VNB Identity resolution (MCP vnb_lookup_codes)
    // Identical pattern to v0.14/v0.15/v0.17.
    // -------------------------------------------------------------------------
    async stepIdentity(ctx, params) {
      const { gridOperatorId, gridOperatorBdew, gridOperatorName } = params;
      const token = ctx.meta?.cernionToken;
      const findings = [];
      let idx = 1;
      let operator = {
        mastrId: gridOperatorId || null,
        name: gridOperatorName || 'Unknown',
        bdew: gridOperatorBdew || null,
        bnr: null,
      };

      const lookupCode = gridOperatorBdew || gridOperatorId;
      if (lookupCode) {
        try {
          const result = await CernionMCPClient.callWithNewSession(
            'vnb_lookup_codes',
            { code: lookupCode },
            token
          );
          const canonical = result?.canonical || result?.data?.canonical || {};
          const candidates = result?.candidates || result?.data?.candidates || [];

          if (canonical && (canonical.mastrId || canonical.name)) {
            const resolvedId =
              (canonical.mastrId || '').split(' ')[0].trim() || gridOperatorId || null;
            operator = {
              mastrId: resolvedId,
              name: canonical.name || operator.name,
              bdew: canonical.bdew || gridOperatorBdew || null,
              bnr: canonical.bnr || null,
            };
            findings.push(
              createFinding(
                1,
                'identity',
                VNB_RESOLVED,
                'info',
                `VNB resolved: ${operator.name}`,
                `Operator identity confirmed via vnb_lookup_codes. MaStR ID: ${operator.mastrId || 'unknown'}.`,
                { operator, candidateCount: candidates.length },
                null,
                idx++
              )
            );
          } else if (candidates.length > 1) {
            findings.push(
              createFinding(
                1,
                'identity',
                VNB_AMBIGUOUS,
                'warning',
                `Ambiguous VNB: ${candidates.length} candidates found`,
                `vnb_lookup_codes returned ${candidates.length} candidates without a clear canonical match. Using first candidate.`,
                { candidates: candidates.slice(0, 5), lookupCode },
                'Provide a more specific gridOperatorId (MaStR ID) to ensure unambiguous resolution.',
                idx++
              )
            );
            if (candidates[0]) {
              const c = candidates[0];
              operator = {
                mastrId: (c.mastrId || '').split(' ')[0].trim() || gridOperatorId || null,
                name: c.name || operator.name,
                bdew: c.bdew || gridOperatorBdew || null,
                bnr: c.bnr || null,
              };
            }
          } else {
            findings.push(
              createFinding(
                1,
                'identity',
                VNB_NOT_FOUND,
                'warning',
                `VNB not found in lookup for code: ${lookupCode}`,
                'vnb_lookup_codes returned no canonical match. Proceeding with provided parameters.',
                { lookupCode },
                'Verify the BDEW code or MaStR ID is correct.',
                idx++
              )
            );
          }
        } catch (err) {
          this.logger.warn(
            `stepIdentity: vnb_lookup_codes failed — ${err.message}. Continuing with provided params.`
          );
          findings.push(
            createFinding(
              1,
              'identity',
              VNB_RESOLVED,
              'info',
              'VNB identity using provided parameters (lookup unavailable)',
              `MCP lookup failed: ${err.message}. Using provided operator parameters.`,
              { gridOperatorId, gridOperatorBdew, gridOperatorName },
              null,
              idx++
            )
          );
        }
      } else {
        // Name-only resolution — best effort
        findings.push(
          createFinding(
            1,
            'identity',
            VNB_RESOLVED,
            'info',
            `VNB identity from provided name: ${gridOperatorName}`,
            'No BDEW code or MaStR ID provided. Proceeding with name-based identification.',
            { gridOperatorName },
            'Provide gridOperatorBdew or gridOperatorId for more reliable resolution.',
            idx++
          )
        );
      }

      return { operator, findings };
    },

    // -------------------------------------------------------------------------
    // Step 2: Redispatch portfolio (MCP cernion_installations_local, ≥100 kW)
    // Supports Weg A (MCP) and Weg B (tagged datapoint fallback).
    // -------------------------------------------------------------------------
    async stepPortfolio(ctx, operator, params) {
      const { datapointTags = [], maxAgeMinutes = 120 } = params;
      const token = ctx.meta?.cernionToken;
      const findings = [];
      let idx = 1;

      // Weg B: try datapoint fallback first
      let installations = await this.tryDatapointFallback(ctx, datapointTags, maxAgeMinutes);
      const usedWegB = installations !== null;

      // Weg A: MCP call
      if (!installations) {
        if (!operator.mastrId) {
          throw new Error(
            `Cannot fetch Redispatch portfolio: MaStR ID not resolved for operator "${operator.name}". ` +
              'Provide gridOperatorId or a resolvable gridOperatorBdew.'
          );
        }

        const result = await CernionMCPClient.callWithNewSession(
          'cernion_installations_local',
          {
            gridOperatorMastrId: operator.mastrId,
            minCapacity: 100,
            format: 'detailed',
            includeStats: true,
            limit: 10000,
          },
          token
        );

        // Normalize flat response shape (v0.10.3 pattern)
        installations = result?.installations || result?.data?.installations || [];
      }

      if (installations.length === 0) {
        findings.push(
          createFinding(
            2,
            'portfolio',
            RD_PORTFOLIO_EMPTY,
            'error',
            'No Redispatch-relevant installations found (≥100 kW)',
            usedWegB
              ? 'Datapoint returned 0 installations. Refresh the datapoint or switch to Weg A.'
              : 'cernion_installations_local returned 0 installations ≥100 kW. The MaStR ID may be incorrect.',
            { gridOperatorMastrId: operator.mastrId, minCapacity: 100, usedWegB },
            'Verify the MaStR grid operator ID. Check if installations ≥100 kW are registered.',
            idx++
          )
        );
        return { installations: [], findings };
      }

      // Count inactive installations (status ≠ InBetrieb / 35)
      const inactiveCount = installations.filter((i) => {
        const status = Number(i.einheitBetriebsstatus || i.EinheitBetriebsstatus || 0);
        return status !== STATUS_IN_BETRIEB;
      }).length;

      if (inactiveCount > 0) {
        findings.push(
          createFinding(
            2,
            'portfolio',
            RD_PORTFOLIO_INCLUDES_INACTIVE,
            'warning',
            `${inactiveCount} of ${installations.length} installations are not "InBetrieb"`,
            `Portfolio includes ${inactiveCount} installations with status ≠ InBetrieb (35). ` +
              'These may affect historical settlement calculations.',
            { inactiveCount, totalCount: installations.length },
            'Verify whether inactive installations had curtailment events in the audit period.',
            idx++
          )
        );
      }

      // Type breakdown for the summary finding
      const byType = {};
      for (const inst of installations) {
        const t = this.deriveType(inst);
        byType[t] = (byType[t] || 0) + 1;
      }

      const totalKW = installations.reduce((sum, i) => {
        return sum + parseFloat(i.bruttoleistung || i.Bruttoleistung || i.NettoNennleistung || 0);
      }, 0);

      findings.push(
        createFinding(
          2,
          'portfolio',
          RD_PORTFOLIO_COMPLETE,
          'info',
          `${installations.length} Redispatch-relevant installations (${(totalKW / 1000).toFixed(1)} MW)`,
          `Portfolio inventory complete: ${Object.entries(byType)
            .map(([k, v]) => `${v} ${k}`)
            .join(', ')}. ` + `Data source: ${usedWegB ? 'Weg B (datapoint)' : 'Weg A (MCP)'}.`,
          {
            total: installations.length,
            capacityMW: parseFloat((totalKW / 1000).toFixed(2)),
            byType,
            inactiveCount,
            usedWegB,
          },
          null,
          idx++
        )
      );

      return { installations, findings };
    },

    // -------------------------------------------------------------------------
    // Step 3: Master data validation (pure sync)
    // Checks Redispatch-critical fields: NAP, MeLo, BTR, DV controllability,
    // NAP-VNB mismatch, capacity anomalies.
    // -------------------------------------------------------------------------
    stepMasterDataValidation(installations, operator) {
      const findings = [];
      let idx = 1;

      for (const inst of installations) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer || '?';
        const capacity = parseFloat(
          inst.bruttoleistung ?? inst.Bruttoleistung ?? inst.NettoNennleistung ?? 0
        );

        // Rule 1: Missing NAP → Redispatch control impossible
        const nap =
          inst.netzanschlusspunktMastrNummer || inst.NetzanschlusspunktMastrNummer || null;
        if (!nap) {
          findings.push(
            createFinding(
              3,
              'masterDataValidation',
              RD_MISSING_NAP,
              'error',
              `${mastr}: missing NAP — Redispatch control impossible`,
              'Installation ≥100 kW has no Netzanschlusspunkt (NAP) in MaStR. ' +
                'Redispatch control signal cannot be dispatched without a valid NAP.',
              { mastrNummer: mastr, capacity },
              'Register the Netzanschlusspunkt for this installation in MaStR.',
              idx++
            )
          );
        }

        // Rule 2: Missing MeLo → A96 settlement impossible
        const melo = inst.marktlokationId || inst.MarktlokationId || null;
        if (!melo) {
          findings.push(
            createFinding(
              3,
              'masterDataValidation',
              RD_MISSING_MELO,
              'error',
              `${mastr}: missing MeLo — A96 settlement impossible`,
              'Installation ≥100 kW has no Marktlokation-ID (MeLo) in MaStR. ' +
                'A96 settlement process requires a valid MeLo for billing.',
              { mastrNummer: mastr, capacity },
              'Register the MeLo ID for this installation in MaStR.',
              idx++
            )
          );
        }

        // Rule 3: Missing BTR (Einsatzverantwortlicher) → settlement chain broken
        // Note: DirektvermarkterMastrNummer is excluded from public MaStR exports (BNetzA policy).
        // We check the FernsteuerbarkeitDv flag as a proxy for BTR presence.
        // If neither controllability flag is set, the BTR role is likely unassigned.
        const hasDv = this.hasDvFlag(inst);
        const hasRemoteControl =
          hasDv || inst.FernsteuerbarkeitSonstige === '1' || inst.FernsteuerbarkeitSonstige === 1;
        if (!hasRemoteControl && capacity >= 100) {
          findings.push(
            createFinding(
              3,
              'masterDataValidation',
              RD_MISSING_BTR,
              'warning',
              `${mastr}: no BTR/remote-control assignment — settlement chain may be broken`,
              'No DV or other remote-control flag found. The Einsatzverantwortlicher (BTR) role ' +
                'may be unassigned. Note: DirektvermarkterMastrNummer is excluded from public MaStR ' +
                'bulk exports — this check is a best-effort proxy.',
              { mastrNummer: mastr, capacity, fernsteuerbarkeitDv: hasDv },
              'Verify BTR assignment in the MaStR portal or with the installation operator.',
              idx++
            )
          );
        }

        // Rule 4: NAP-VNB mismatch → wrong assignment in settlement chain
        if (nap) {
          const napVnb =
            inst.netzanschlusspunktNetzebetreiber ||
            inst.NetzanschlusspunktNetzbetreiber ||
            inst.napNetzbetreiber ||
            null;
          if (napVnb && operator.mastrId && napVnb !== operator.mastrId) {
            findings.push(
              createFinding(
                3,
                'masterDataValidation',
                RD_NAP_VNB_MISMATCH,
                'error',
                `${mastr}: NAP belongs to different VNB (${napVnb} ≠ ${operator.mastrId})`,
                'The NAP is registered under a different grid operator than the audited VNB. ' +
                  'This causes incorrect assignment in the A96 settlement chain (e.g., TWL KOM vs TWL Netze).',
                { mastrNummer: mastr, napMastrId: nap, napVnb, expectedVnb: operator.mastrId },
                'Correct NAP ownership in MaStR or re-assign installation to the correct VNB.',
                idx++
              )
            );
          }
        }

        // Rule 5: ≥100 kW without DV remote-controllability (§21 Abs. 2 EEG)
        if (!hasDv && capacity >= 100) {
          findings.push(
            createFinding(
              3,
              'masterDataValidation',
              RD_DV_NOT_CONTROLLABLE,
              'warning',
              `${mastr}: ≥100 kW without DV remote-controllability flag`,
              'FernsteuerbarkeitDv is not set. Installations ≥100 kW should be remotely ' +
                'controllable under §21 Abs. 2 EEG. Curtailment may not be technically possible.',
              { mastrNummer: mastr, capacity, fernsteuerbarkeitDv: hasDv },
              'Verify DV contract and update FernsteuerbarkeitDv flag in MaStR.',
              idx++
            )
          );
        }

        // Rule 6: Capacity anomaly (zero or implausibly high) → wrong compensation calculation
        const nettoKW = parseFloat(inst.nettonennleistung ?? inst.Nettonennleistung ?? capacity);
        if (capacity <= 0 || nettoKW <= 0) {
          findings.push(
            createFinding(
              3,
              'masterDataValidation',
              RD_CAPACITY_ANOMALY,
              'warning',
              `${mastr}: zero or missing capacity — compensation calculation will be wrong`,
              `Bruttoleistung=${capacity} kW, Nettonennleistung=${nettoKW} kW. ` +
                'Cannot compute correct Redispatch compensation without valid capacity data.',
              { mastrNummer: mastr, bruttoleistungKW: capacity, nettonennleistungKW: nettoKW },
              'Correct capacity data in MaStR portal.',
              idx++
            )
          );
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 4: Curtailment correlation (Netztransparenz)
    // -------------------------------------------------------------------------
    async stepCurtailmentCorrelation(ctx, operator, params) {
      const { dateFrom, dateTo } = params;
      const token = ctx.meta?.cernionToken;
      const findings = [];
      let idx = 1;
      let curtailmentGWh = 0;

      try {
        const queryParams = {};
        if (dateFrom) queryParams.dateFrom = dateFrom;
        if (dateTo) queryParams.dateTo = dateTo;

        const result = await CernionMCPClient.callWithNewSession(
          'netztransparenz_redispatch',
          queryParams,
          token
        );

        const measures =
          result?.measures ||
          result?.data?.measures ||
          result?.redispatch ||
          result?.data?.redispatch ||
          [];

        if (measures.length === 0) {
          findings.push(
            createFinding(
              4,
              'curtailmentCorrelation',
              RD_CURTAILMENT_ZERO,
              'info',
              'No Redispatch measures found in the specified period',
              `Netztransparenz returned 0 measures for ${dateFrom || 'any start'} – ${dateTo || 'any end'}. ` +
                'Either no curtailment events occurred or the VNB is not in the affected area.',
              { dateFrom, dateTo, measureCount: 0 },
              null,
              idx++
            )
          );
          return { curtailmentGWh: 0, findings };
        }

        // Aggregate volume (TSO-level — not VNB-specific)
        const totalMWh = measures.reduce((sum, m) => {
          const mwh = parseFloat(m.volumeMWh || m.volume_mwh || m.mwh || m.MWh || 0);
          return sum + mwh;
        }, 0);
        curtailmentGWh = parseFloat((totalMWh / 1000).toFixed(3));

        // Check for high-density periods (>100 measures/month)
        const periodDays =
          dateFrom && dateTo
            ? Math.max(1, Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000))
            : 90;
        const periodMonths = Math.max(1, periodDays / 30);
        const measuresPerMonth = measures.length / periodMonths;

        if (measuresPerMonth > 100) {
          findings.push(
            createFinding(
              4,
              'curtailmentCorrelation',
              RD_HIGH_CURTAILMENT_PERIOD,
              'warning',
              `High curtailment density: ${measures.length} measures / ${periodMonths.toFixed(1)} months`,
              `Average ${measuresPerMonth.toFixed(0)} measures/month exceeds 100. This indicates a ` +
                'systemic grid congestion pattern. Settlement volume and risk are elevated.',
              {
                measureCount: measures.length,
                periodMonths: parseFloat(periodMonths.toFixed(1)),
                measuresPerMonth: parseFloat(measuresPerMonth.toFixed(0)),
              },
              'Investigate root causes of recurring congestion (transformer bottlenecks, wind feed-in peaks).',
              idx++
            )
          );
        }

        findings.push(
          createFinding(
            4,
            'curtailmentCorrelation',
            RD_CURTAILMENT_VOLUME,
            'info',
            `${measures.length} Redispatch measures, total ${curtailmentGWh} GWh (${dateFrom || '?'} – ${dateTo || '?'})`,
            `Netztransparenz data retrieved. Note: TSO-level data — not VNB-specific. ` +
              `Volume used for proportional financial risk estimate only.`,
            { measureCount: measures.length, curtailmentGWh, dateFrom, dateTo },
            null,
            idx++
          )
        );
      } catch (err) {
        this.logger.warn(
          `stepCurtailmentCorrelation: Netztransparenz call failed — ${err.message}`
        );
        findings.push(
          createFinding(
            4,
            'curtailmentCorrelation',
            RD_CURTAILMENT_DATA_UNAVAILABLE,
            'warning',
            'Netztransparenz data unavailable — risk calculation uses 0 GWh',
            `netztransparenz_redispatch call failed: ${err.message}. ` +
              'Financial risk estimate will be 0 (conservative — actual risk unknown).',
            { error: err.message, dateFrom, dateTo },
            'Check Netztransparenz API availability. Re-run audit when data is accessible.',
            idx++
          )
        );
        return { curtailmentGWh: 0, findings };
      }

      return { curtailmentGWh, findings };
    },

    // -------------------------------------------------------------------------
    // Step 5: Settlement readiness (delegates to src/redispatch-risk.js)
    // -------------------------------------------------------------------------
    stepSettlementReadiness(installations, masterDataFindings) {
      const findings = [];
      let idx = 1;

      const readiness = assessSettlementReadiness(installations, masterDataFindings);

      if (readiness.totalInstallations === 0) {
        return { readiness, findings };
      }

      if (readiness.readinessPercent === 100) {
        findings.push(
          createFinding(
            5,
            'settlementReadiness',
            RD_SETTLEMENT_READY,
            'info',
            `100% settlement readiness — all ${readiness.totalInstallations} installations ready`,
            'All installations in the Redispatch portfolio meet A96 settlement prerequisites ' +
              '(NAP and MeLo present, no NAP-VNB mismatch).',
            { ...readiness },
            null,
            idx++
          )
        );
      } else if (readiness.readinessPercent >= 80) {
        findings.push(
          createFinding(
            5,
            'settlementReadiness',
            RD_SETTLEMENT_PARTIAL,
            'warning',
            `${readiness.readinessPercent}% settlement readiness — ${readiness.blockedInstallations} installation(s) blocked`,
            `${readiness.blockedInstallations} of ${readiness.totalInstallations} installations have errors ` +
              'that prevent A96 settlement (missing NAP/MeLo or NAP-VNB mismatch). ' +
              'Proceed with settlement but remediate blocked installations promptly.',
            { ...readiness },
            'Prioritise remediation of the blocked MaStR numbers listed in blockedMastrNumbers.',
            idx++
          )
        );
      } else {
        findings.push(
          createFinding(
            5,
            'settlementReadiness',
            RD_SETTLEMENT_CRITICAL,
            'error',
            `${readiness.readinessPercent}% settlement readiness — critical data quality issue`,
            `${readiness.blockedInstallations} of ${readiness.totalInstallations} installations (${100 - readiness.readinessPercent}%) ` +
              'have settlement-blocking errors. This indicates a systematic data quality problem that ' +
              'must be resolved before settlement.',
            { ...readiness },
            'Conduct an emergency MaStR data quality remediation before submitting A96 settlement.',
            idx++
          )
        );
      }

      return { readiness, findings };
    },

    // -------------------------------------------------------------------------
    // Step 6: Risk assessment (delegates to src/redispatch-risk.js)
    // -------------------------------------------------------------------------
    stepRiskAssessment(readiness, curtailmentGWh, avgCompensationEurPerMWh) {
      const findings = [];
      let idx = 1;

      const risk = assessRisk(readiness, curtailmentGWh, avgCompensationEurPerMWh);

      const riskCodeMap = {
        low: RD_RISK_LOW,
        medium: RD_RISK_MEDIUM,
        high: RD_RISK_HIGH,
      };

      const severityMap = {
        low: 'info',
        medium: 'warning',
        high: 'error',
      };

      const descriptions = {
        low: `Estimated compensation loss <10,000 € (${risk.estimatedLostCompensationEur.toLocaleString('de-DE')} €). Low financial risk.`,
        medium: `Estimated compensation loss 10,000–100,000 € (${risk.estimatedLostCompensationEur.toLocaleString('de-DE')} €). Remediate blocked installations to reduce financial exposure.`,
        high: `Estimated compensation loss >100,000 € (${risk.estimatedLostCompensationEur.toLocaleString('de-DE')} €). Immediate action required — systematic master data deficiencies.`,
      };

      findings.push(
        createFinding(
          6,
          'riskAssessment',
          riskCodeMap[risk.riskLevel],
          severityMap[risk.riskLevel],
          `${risk.riskLevel.toUpperCase()} financial risk: ~${risk.estimatedLostCompensationEur.toLocaleString('de-DE')} €`,
          descriptions[risk.riskLevel],
          { ...risk },
          risk.riskLevel === 'low'
            ? null
            : 'Remediate blocked installations to reduce settlement risk before the next billing cycle.',
          idx++
        )
      );

      return { risk, findings };
    },

    // -------------------------------------------------------------------------
    // Step 7: Audit trail (mirrors v0.14/v0.15/v0.17 pattern)
    // -------------------------------------------------------------------------
    async stepAudit(ctx, params, reportData, callOpts) {
      const findings = [];
      let idx = 1;
      let snapshotValidation = null;
      const { datapointTags = [], maxAgeMinutes = 120, _resolvedOperator: operator = {} } = params;

      if (datapointTags.length > 0) {
        try {
          const snap = await ctx.call(
            'datapoint.createSnapshot',
            {
              tags: datapointTags.join(','),
              maxAgeMinutes,
              createdBy: 'agent',
              name: `rd-${(operator.mastrId || 'unknown').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`,
              description: `Redispatch Ex-Post audit snapshot for ${operator.name || 'unknown'}`,
            },
            callOpts
          );

          if (snap?.id) {
            try {
              snapshotValidation = await ctx.call(
                'datapoint.validateSnapshot',
                { id: snap.id },
                callOpts
              );
              if (snapshotValidation?.drift?.length > 0) {
                findings.push(
                  createFinding(
                    7,
                    'audit',
                    SNAPSHOT_DRIFT_DETECTED,
                    'warning',
                    `Data drift detected in ${snapshotValidation.drift.length} datapoint(s)`,
                    'One or more datapoints changed during pipeline execution. Results may be inconsistent.',
                    { drift: snapshotValidation.drift, snapshotId: snap.id },
                    'Re-run audit after data refresh for a consistent result.',
                    idx++
                  )
                );
              }
            } catch (err) {
              this.logger.debug(`stepAudit: snapshot validation skipped — ${err.message}`);
            }
          }
        } catch (err) {
          this.logger.warn(`stepAudit: snapshot creation skipped — ${err.message}`);
        }
      }

      findings.push(
        createFinding(
          7,
          'audit',
          AUDIT_TRAIL_CREATED,
          'info',
          `Audit trail created — pipeline v${PIPELINE_VERSION}`,
          `Deterministic Redispatch Ex-Post pipeline v${PIPELINE_VERSION} completed. ` +
            `No LLM involvement. Total findings: ${reportData.allFindingsCount + findings.length}. ` +
            `Settlement readiness: ${reportData.readinessPercent ?? 'n/a'}%.`,
          {
            pipelineVersion: PIPELINE_VERSION,
            readinessPercent: reportData.readinessPercent,
            riskLevel: reportData.riskLevel,
            totalInstallations: reportData.totalInstallations,
            findingsTotal: reportData.allFindingsCount + findings.length,
            consistent: snapshotValidation?.consistent ?? null,
          },
          null,
          idx++
        )
      );

      return { findings, snapshotValidation };
    },

    // -------------------------------------------------------------------------
    // Weg B: try to load portfolio data from a tagged datapoint.
    // Returns rows array on success, or null to fall back to Weg A.
    // Follows the energy-sharing.service.js pattern (with freshness gate).
    // -------------------------------------------------------------------------
    async tryDatapointFallback(ctx, datapointTags, maxAgeMinutes) {
      if (!datapointTags || datapointTags.length === 0) return null;
      try {
        const callOpts = { meta: { ...ctx.meta, $gateway: false } };
        const dpList = await ctx.call(
          'datapoint.list',
          { tags: datapointTags.join(',') },
          callOpts
        );
        const dp = (dpList.datapoints || []).find((d) =>
          (d.tags || []).some((t) =>
            ['redispatch-portfolio', 'mastr-portfolio', 'grid-connection-inventory'].includes(t)
          )
        );
        if (!dp) return null;
        const ageMin = dp.lastRun?.timestamp
          ? (Date.now() - new Date(dp.lastRun.timestamp).getTime()) / 60_000
          : Infinity;
        if (ageMin > maxAgeMinutes) return null;
        const dpData = await ctx.call('datapoint.data', { name: dp.name }, callOpts);
        const rows = dpData?.data?.rows || dpData?.rows || [];
        if (rows.length > 0) {
          this.logger.debug(
            `tryDatapointFallback: using datapoint "${dp.name}" (${rows.length} rows)`
          );
          return rows;
        }
      } catch (err) {
        this.logger.debug(`tryDatapointFallback: skipped — ${err.message}`);
      }
      return null;
    },

    // -------------------------------------------------------------------------
    // Derive normalized installation type from a raw MaStR record.
    // -------------------------------------------------------------------------
    deriveType(inst) {
      const et = String(
        inst.Energietraeger || inst.energietraeger || inst.energieTraeger || ''
      ).toLowerCase();
      if (['solar', 'photovoltaik', 'pv'].some((t) => et.includes(t))) return 'solar';
      if (['wind', 'windkraft'].some((t) => et.includes(t))) return 'wind';
      if (['speicher', 'battery', 'batterie', 'storage'].some((t) => et.includes(t)))
        return 'storage';
      if (['biomasse', 'biogas', 'biomethan'].some((t) => et.includes(t))) return 'biomass';
      if (['verbrennung', 'gas', 'kohle', 'combustion'].some((t) => et.includes(t)))
        return 'combustion';
      if (inst.Modulanzahl || inst.GrossflächePv) return 'solar';
      if (inst.Nabenhoehe || inst.Rotordurchmesser) return 'wind';
      if (inst.Speicherkapazitaet) return 'storage';
      return 'other';
    },

    // -------------------------------------------------------------------------
    // Returns true if installation has DV remote-control flag set.
    // Field FernsteuerbarkeitDv stored as string "1"/"0" in local MaStR data.
    // -------------------------------------------------------------------------
    hasDvFlag(inst) {
      const v = inst?.FernsteuerbarkeitDv ?? inst?.fernsteuerbarkeitDv;
      return v === true || v === 1 || v === '1';
    },

    // -------------------------------------------------------------------------
    // Main pipeline orchestrator (7 steps, runStep pattern from v0.17)
    // -------------------------------------------------------------------------
    async runPipeline(ctx, params) {
      const startTime = Date.now();
      const { skipSteps = [], avgCompensationEurPerMWh = 50 } = params;
      const skip = new Set(skipSteps);
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };
      const allFindings = [];
      const stepSummaries = [];

      // Helper: run one step, catch errors, record timing — mirrors v0.17 runStep
      const runStep = async (stepNum, stepName, fn) => {
        if (skip.has(stepNum)) {
          stepSummaries.push({
            step: stepNum,
            name: stepName,
            status: 'skipped',
            durationMs: 0,
            findingsCount: 0,
          });
          return null;
        }
        const t0 = Date.now();
        try {
          const result = await fn();
          const stepFindings = Array.isArray(result) ? result : result?.findings || [];
          allFindings.push(...stepFindings);
          stepSummaries.push({
            step: stepNum,
            name: stepName,
            status: 'success',
            durationMs: Date.now() - t0,
            findingsCount: stepFindings.length,
          });
          return result;
        } catch (err) {
          this.logger.error(
            `Redispatch Ex-Post pipeline step ${stepNum} (${stepName}) failed: ${err.message}`
          );
          stepSummaries.push({
            step: stepNum,
            name: stepName,
            status: 'error',
            durationMs: Date.now() - t0,
            findingsCount: 0,
            error: err.message,
          });
          return null;
        }
      };

      // Step 1: VNB Identity (mandatory)
      let operator = {
        mastrId: params.gridOperatorId || null,
        name: params.gridOperatorName || 'Unknown',
        bdew: params.gridOperatorBdew || null,
        bnr: null,
      };
      await runStep(1, 'identity', async () => {
        const res = await this.stepIdentity(ctx, params);
        operator = res.operator;
        return res.findings;
      });

      // Inject resolved operator for downstream steps (audit trail snapshot naming)
      params._resolvedOperator = operator;

      // Step 2: Portfolio (mandatory)
      let installations = [];
      await runStep(2, 'portfolio', async () => {
        const res = await this.stepPortfolio(ctx, operator, params);
        installations = res.installations;
        return res.findings;
      });

      // Step 3: Master data validation (skippable)
      let masterDataFindings = [];
      if (!skip.has(3)) {
        await runStep(3, 'masterDataValidation', () => {
          const f = this.stepMasterDataValidation(installations, operator);
          masterDataFindings = f;
          return f;
        });
      } else {
        stepSummaries.push({
          step: 3,
          name: 'masterDataValidation',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Step 4: Curtailment correlation (skippable)
      let curtailmentGWh = 0;
      if (!skip.has(4)) {
        await runStep(4, 'curtailmentCorrelation', async () => {
          const res = await this.stepCurtailmentCorrelation(ctx, operator, params);
          curtailmentGWh = res.curtailmentGWh;
          return res.findings;
        });
      } else {
        stepSummaries.push({
          step: 4,
          name: 'curtailmentCorrelation',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Step 5: Settlement readiness (skippable)
      let settlementReadiness = null;
      if (!skip.has(5)) {
        await runStep(5, 'settlementReadiness', () => {
          const res = this.stepSettlementReadiness(installations, masterDataFindings);
          settlementReadiness = res.readiness;
          return res.findings;
        });
      } else {
        stepSummaries.push({
          step: 5,
          name: 'settlementReadiness',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
        // Provide a null-safe default for downstream risk step
        settlementReadiness = assessSettlementReadiness(installations, masterDataFindings);
      }

      // Step 6: Risk assessment (skippable)
      let riskAssessment = null;
      if (!skip.has(6)) {
        await runStep(6, 'riskAssessment', () => {
          const res = this.stepRiskAssessment(
            settlementReadiness || {
              readinessPercent: 100,
              totalInstallations: 0,
              blockedInstallations: 0,
            },
            curtailmentGWh,
            avgCompensationEurPerMWh
          );
          riskAssessment = res.risk;
          return res.findings;
        });
      } else {
        stepSummaries.push({
          step: 6,
          name: 'riskAssessment',
          status: 'skipped',
          durationMs: 0,
          findingsCount: 0,
        });
      }

      // Step 7: Audit trail (mandatory)
      await runStep(7, 'audit', async () => {
        const res = await this.stepAudit(
          ctx,
          params,
          {
            readinessPercent: settlementReadiness?.readinessPercent ?? null,
            riskLevel: riskAssessment?.riskLevel ?? null,
            totalInstallations: installations.length,
            allFindingsCount: allFindings.length,
          },
          callOpts
        );
        return res.findings;
      });

      return {
        gridOperator: operator,
        period: {
          dateFrom: params.dateFrom || null,
          dateTo: params.dateTo || null,
        },
        settlementReadiness,
        riskAssessment,
        summary: {
          totalInstallations: installations.length,
          findingsCount: summarizeFindings(allFindings),
          skippedSteps: skipSteps,
          durationMs: Date.now() - startTime,
        },
        findings: allFindings,
        steps: stepSummaries,
        metadata: {
          pipelineVersion: PIPELINE_VERSION,
          executedAt: new Date().toISOString(),
          regulatoryBasis: '§§ 13, 13a EnWG, NABEG, StromNZV, Redispatch 2.0 (BDEW/BNetzA)',
          maxAgeMinutes: params.maxAgeMinutes || 120,
          avgCompensationEurPerMWh,
        },
      };
    },
  },
};
