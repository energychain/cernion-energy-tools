'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const CernionMCPClient = require('../src/mcp-client');
const {
  createFinding,
  summarizeFindings,
  AUDIT_TRAIL_CREATED,
  SNAPSHOT_DRIFT_DETECTED,
  VNB_RESOLVED,
  VNB_AMBIGUOUS,
  VNB_NOT_FOUND,
  MQ_INVENTORY_COMPLETE,
  MQ_INVENTORY_EMPTY,
  MQ_STALE_PLANNING,
  MQ_STALE_TEMPORARY_SHUTDOWN,
  MQ_MISSING_COMMISSIONING_DATE,
  MQ_FUTURE_COMMISSIONING,
  MQ_NBP_PENDING,
  MQ_NBP_NOT_PLANNED,
  MQ_ZERO_CAPACITY,
  MQ_NEGATIVE_CAPACITY,
  MQ_IMPLAUSIBLE_HIGH_CAPACITY,
  MQ_NETTO_EXCEEDS_BRUTTO,
  MQ_MISSING_FEED_IN_TYPE,
  MQ_MISSING_NAP,
  MQ_MISSING_MELO,
  MQ_NAP_VNB_MISMATCH,
  MQ_VOLTAGE_MISMATCH,
  MQ_NAP_MULTI_UNIT,
  MQ_REDISPATCH_NO_NAP,
  MQ_PROBABLE_DUPLICATE,
  MQ_POSSIBLE_DUPLICATE,
  MQ_GEO_DUPLICATE,
  MQ_GEO_PLAUSIBLE,
  MQ_GEO_MISASSIGNMENT,
  MQ_GEO_CHECK_FAILED,
  QUALITY_DIMENSION_WEIGHTS,
  computeDimensionScore,
  computeQualityScore,
} = require('../src/validation-findings');

const PIPELINE_VERSION = '0.17.0';

// Dimension → step number mapping for score computation
const DIMENSION_STEPS = {
  status:           [3],
  capacity:         [4],
  connectionPoints: [5],
  duplicates:       [6],
  geo:              [7],
};

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------
module.exports = {
  name: 'mastr-quality',

  settings: {
    dbPath: process.env.MASTR_QUALITY_DB_PATH || './data/mastr-quality',
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['createdAt'] } });
    await this.db.createIndex({ index: { fields: ['gridOperator.mastrId'] } });
    this.logger.info(`MaStR quality DB initialized at ${this.settings.dbPath}`);
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
     * Run the 8-step MaStR portfolio quality audit pipeline.
     * Deterministic — no LLM, no probabilistic logic.
     */
    audit: {
      rest: 'POST /audit',
      timeout: 180_000,
      params: {
        gridOperatorId:   { type: 'string', optional: true },
        gridOperatorBdew: { type: 'string', optional: true },
        gridOperatorName: { type: 'string', optional: true },
        datapointTags:    { type: 'array', items: 'string', optional: true, default: [] },
        maxAgeMinutes:    { type: 'number', optional: true, default: 120, convert: true },
        skipSteps:        { type: 'array', items: 'number', optional: true, default: [] },
        geoSampleSize:    { type: 'number', optional: true, default: 10, convert: true, max: 50 },
      },
      openapi: {
        summary: 'Run MaStR portfolio quality audit (8-step, deterministic)',
        description:
          'Executes a deterministic 8-step MaStR data quality audit for a VNB portfolio: ' +
          'VNB identity → full inventory → status anomalies → capacity anomalies → ' +
          'connection point integrity → duplicate detection → geo spot check → audit trail. ' +
          'Returns a qualityScore (0–100) across 5 weighted dimensions. ' +
          'No LLM involvement — identical inputs always produce identical finding codes. ' +
          'Steps 3–7 can be skipped via the skipSteps parameter; scores are re-normalised. ' +
          'Steps 1, 2, and 8 are mandatory.',
        tags: ['MaStR Data Quality'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gridOperatorId:   { type: 'string', description: 'MaStR grid operator ID (SNB.../GNB...)', example: 'SNB935578300972' },
                  gridOperatorBdew: { type: 'string', description: '13-digit BDEW market-partner code', example: '9907473000008' },
                  gridOperatorName: { type: 'string', description: 'Grid operator name (fuzzy match)', example: 'TWL Netze' },
                  datapointTags:    { type: 'array', items: { type: 'string' }, description: 'Tags for datapoint snapshot (Weg B)', example: ['twl-netze'] },
                  maxAgeMinutes:    { type: 'integer', default: 120, description: 'Datapoint freshness threshold in minutes' },
                  skipSteps:        { type: 'array', items: { type: 'integer' }, description: 'Steps to skip (valid: 3–7; steps 1, 2, 8 are mandatory)', example: [7] },
                  geoSampleSize:    { type: 'integer', default: 10, maximum: 50, description: 'Number of installations to geo-validate in step 7' },
                },
              },
              examples: {
                'By MaStR ID': {
                  value: { gridOperatorId: 'SNB935578300972', datapointTags: ['twl-netze'] },
                },
                'By BDEW code, skip geo': {
                  value: { gridOperatorBdew: '9907473000008', skipSteps: [7] },
                },
                'By name, full audit': {
                  value: { gridOperatorName: 'TWL Netze', geoSampleSize: 20 },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'AuditReport with qualityScore, dimensions, and findings from all executed pipeline steps',
            content: {
              'application/json': {
                example: {
                  success: true,
                  id: 'a1b2c3d4-...',
                  qualityScore: 82,
                  qualityDimensions: {
                    status:           { score: 90, findings: 2 },
                    capacity:         { score: 85, findings: 3 },
                    connectionPoints: { score: 70, findings: 5 },
                    duplicates:       { score: 100, findings: 0 },
                    geo:              { score: 80, findings: 4 },
                  },
                  summary: { totalInstallations: 142, findingsCount: { info: 5, warning: 8, error: 2 }, durationMs: 45230 },
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

        // Validate skipSteps — only 3–7 allowed
        const rawSkip = ctx.params.skipSteps || [];
        const invalidSteps = rawSkip.filter((s) => ![3, 4, 5, 6, 7].includes(s));
        if (invalidSteps.length > 0) {
          throw new Error(
            `Invalid skipSteps values: [${invalidSteps.join(', ')}]. Only steps 3–7 can be skipped.`
          );
        }

        const report = await this.runPipeline(ctx, ctx.params);

        // Persist to PouchDB (KRITIS: raw installation data NOT stored, only report metadata)
        const id = crypto.randomUUID();
        const doc = {
          _id: `mq:${id}`,
          id,
          type: 'mastr-quality-audit',
          gridOperator: report.gridOperator,
          qualityScore: report.qualityScore,
          qualityDimensions: report.qualityDimensions,
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
              datapointTags: ctx.params.datapointTags || [],
              maxAgeMinutes: ctx.params.maxAgeMinutes,
              skipSteps: rawSkip,
              geoSampleSize: ctx.params.geoSampleSize || 10,
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
        limit:          { type: 'number', optional: true, default: 20, convert: true, max: 100 },
      },
      openapi: {
        summary: 'List past MaStR quality audit reports',
        description: 'Returns audit reports stored in PouchDB, newest first. Filter by gridOperatorId.',
        tags: ['MaStR Data Quality'],
        parameters: [
          { name: 'gridOperatorId', in: 'query', schema: { type: 'string', example: 'SNB935578300972' }, description: 'Filter by MaStR grid operator ID' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 }, description: 'Maximum number of results' },
        ],
        responses: {
          200: {
            description: 'List of audit report summaries',
            content: {
              'application/json': {
                example: {
                  count: 2,
                  audits: [
                    { id: '...', gridOperator: { name: 'TWL Netze' }, qualityScore: 82, createdAt: '2026-03-31T...' },
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
          startkey: 'mq:',
          endkey: 'mq:\ufff0',
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
            qualityScore: d.qualityScore,
            qualityDimensions: d.qualityDimensions,
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
        summary: 'Get a specific MaStR quality audit report by ID',
        description: 'Returns the full AuditReport document including all findings and quality dimensions.',
        tags: ['MaStR Data Quality'],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'a1b2c3d4-1234-5678-90ab-cdef12345678' }, description: 'Audit report UUID' },
        ],
        responses: {
          200: { description: 'Full AuditReport document' },
          404: { description: 'Audit report not found' },
        },
      },
      async handler(ctx) {
        try {
          const doc = await this.db.get(`mq:${ctx.params.id}`);
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
    // -------------------------------------------------------------------------
    async stepIdentity(ctx, params) {
      const { gridOperatorId, gridOperatorBdew, gridOperatorName } = params;
      const token = ctx.meta?.cernionToken;
      const findings = [];
      let idx = 1;
      let operator = { mastrId: gridOperatorId || null, name: gridOperatorName || 'Unknown', bdew: gridOperatorBdew || null, bnr: null };

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
            const resolvedId = (canonical.mastrId || '').split(' ')[0].trim() || gridOperatorId || null;
            operator = {
              mastrId: resolvedId,
              name: canonical.name || operator.name,
              bdew: canonical.bdew || gridOperatorBdew || null,
              bnr: canonical.bnr || null,
            };
            findings.push(createFinding(
              1, 'identity', VNB_RESOLVED, 'info',
              `VNB resolved: ${operator.name}`,
              `Operator identity confirmed via vnb_lookup_codes. MaStR ID: ${operator.mastrId || 'unknown'}.`,
              { operator, candidateCount: candidates.length },
              null, idx++
            ));
          } else if (candidates.length > 1) {
            findings.push(createFinding(
              1, 'identity', VNB_AMBIGUOUS, 'warning',
              `Ambiguous VNB: ${candidates.length} candidates found`,
              `vnb_lookup_codes returned ${candidates.length} candidates without a clear canonical match. Using first candidate.`,
              { candidates: candidates.slice(0, 5), lookupCode },
              'Provide a more specific gridOperatorId (MaStR ID) to ensure unambiguous resolution.',
              idx++
            ));
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
            findings.push(createFinding(
              1, 'identity', VNB_NOT_FOUND, 'warning',
              `VNB not found in lookup for code: ${lookupCode}`,
              'vnb_lookup_codes returned no canonical match. Proceeding with provided parameters.',
              { lookupCode },
              'Verify the BDEW code or MaStR ID is correct.',
              idx++
            ));
          }
        } catch (err) {
          this.logger.warn(`stepIdentity: vnb_lookup_codes failed — ${err.message}. Continuing with provided params.`);
          findings.push(createFinding(
            1, 'identity', VNB_RESOLVED, 'info',
            `VNB identity using provided parameters (lookup unavailable)`,
            `MCP lookup failed: ${err.message}. Using provided operator parameters.`,
            { gridOperatorId, gridOperatorBdew, gridOperatorName },
            null, idx++
          ));
        }
      } else {
        // Name-only resolution — best effort
        findings.push(createFinding(
          1, 'identity', VNB_RESOLVED, 'info',
          `VNB identity from provided name: ${gridOperatorName}`,
          'No BDEW code or MaStR ID provided. Proceeding with name-based identification.',
          { gridOperatorName },
          'Provide gridOperatorBdew or gridOperatorId for more reliable resolution.',
          idx++
        ));
      }

      return { operator, findings };
    },

    // -------------------------------------------------------------------------
    // Step 2: Full portfolio inventory (MCP cernion_installations_local)
    // One call, no status/minCapacity filter — full portfolio
    // -------------------------------------------------------------------------
    async stepInventory(ctx, operator) {
      const token = ctx.meta?.cernionToken;

      if (!operator.mastrId) {
        throw new Error(
          `Cannot fetch inventory: MaStR ID not resolved for operator "${operator.name}". ` +
          'Provide gridOperatorId or a resolvable gridOperatorBdew.'
        );
      }

      const result = await CernionMCPClient.callWithNewSession(
        'cernion_installations_local',
        {
          gridOperatorMastrId: operator.mastrId,
          format: 'detailed',
          includeStats: true,
          limit: 10000,
        },
        token
      );

      // Normalize flat response shape (see v0.10.3 pattern)
      const installations = result?.installations || result?.data?.installations || [];
      const findings = [];
      let idx = 1;

      if (installations.length === 0) {
        findings.push(createFinding(
          2, 'inventory', MQ_INVENTORY_EMPTY, 'error',
          'No installations found in MaStR for this grid operator',
          'cernion_installations_local returned 0 installations. The MaStR ID may be incorrect or the portfolio is unregistered.',
          { gridOperatorMastrId: operator.mastrId },
          'Verify the MaStR grid operator ID. Check MaStR portal for portfolio registrations.',
          idx++
        ));
        return { installations: [], findings };
      }

      // Build type and status maps for the summary finding
      const byType = {};
      const byStatus = {};
      for (const inst of installations) {
        const t = this.deriveInstallationType(inst);
        byType[t] = (byType[t] || 0) + 1;
        const s = String(inst.einheitBetriebsstatus || inst.EinheitBetriebsstatus || 'unknown');
        byStatus[s] = (byStatus[s] || 0) + 1;
      }

      const totalBruttoKW = installations.reduce((sum, i) => {
        return sum + parseFloat(i.bruttoleistung || i.Bruttoleistung || i.NettoNennleistung || 0);
      }, 0);

      findings.push(createFinding(
        2, 'inventory', MQ_INVENTORY_COMPLETE, 'info',
        `${installations.length} installations found (${(totalBruttoKW / 1000).toFixed(1)} MW total)`,
        `Full portfolio inventory complete: ${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ')}.`,
        { total: installations.length, capacityMW: parseFloat((totalBruttoKW / 1000).toFixed(2)), byType, byStatus },
        null, idx++
      ));

      return { installations, findings };
    },

    // -------------------------------------------------------------------------
    // Step 3: Status anomalies (pure sync)
    // -------------------------------------------------------------------------
    stepStatusAnomalies(installations, now) {
      const findings = [];
      let idx = 1;
      const cutoffDate = now || new Date();
      const TWO_YEARS_MS  = 2 * 365 * 24 * 60 * 60 * 1000;
      const ONE_YEAR_MS   = 365 * 24 * 60 * 60 * 1000;

      const statusLabel = (inst) => String(
        inst.einheitBetriebsstatus || inst.EinheitBetriebsstatus || ''
      ).toLowerCase();

      for (const inst of installations) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer || '?';
        const status = statusLabel(inst);

        // Rule 1: Stale "InPlanung" — planning for >2 years
        const regDateStr = inst.registrierungsDatum || inst.Registrierungsdatum;
        if ((status === '31' || status === 'inplanung') && regDateStr) {
          const regDate = new Date(regDateStr);
          if (!isNaN(regDate) && (cutoffDate - regDate) > TWO_YEARS_MS) {
            findings.push(createFinding(
              3, 'statusAnomalies', MQ_STALE_PLANNING, 'warning',
              `${mastr}: stale planning status (${regDateStr})`,
              `Installation has been "InPlanung" since ${regDateStr} (>2 years). Likely abandoned or mislabelled.`,
              { mastr, registrierungsDatum: regDateStr, ageDays: Math.floor((cutoffDate - regDate) / 86400000) },
              'Update MaStR status or deregister if project was abandoned.',
              idx++
            ));
          }
        }

        // Rule 2: Stale temporary shutdown >365 days
        const shutdownDateStr = inst.datumBeginnVoruebergehenderStilllegung || inst.DatumBeginnVoruebergehenderStilllegung;
        if ((status === '37' || status === 'voruebergehendstillgelegt') && shutdownDateStr) {
          const shutdownDate = new Date(shutdownDateStr);
          if (!isNaN(shutdownDate) && (cutoffDate - shutdownDate) > ONE_YEAR_MS) {
            findings.push(createFinding(
              3, 'statusAnomalies', MQ_STALE_TEMPORARY_SHUTDOWN, 'warning',
              `${mastr}: temporary shutdown exceeds 365 days (${shutdownDateStr})`,
              `Installation has been temporarily shut down since ${shutdownDateStr}. Consider permanent decommissioning.`,
              { mastr, shutdownDate: shutdownDateStr, ageDays: Math.floor((cutoffDate - shutdownDate) / 86400000) },
              'Update MaStR with actual operational status or register permanent decommissioning.',
              idx++
            ));
          }
        }

        // Rule 3: Missing commissioning date for operational units
        const ibDate = inst.inbetriebnahmeDatum || inst.Inbetriebnahmedatum;
        if ((status === '35' || status === 'inbetrieb') && !ibDate) {
          findings.push(createFinding(
            3, 'statusAnomalies', MQ_MISSING_COMMISSIONING_DATE, 'warning',
            `${mastr}: missing commissioning date (operational unit)`,
            'Operational installation has no Inbetriebnahmedatum in MaStR. Required for EEG tariff calculation.',
            { mastr, status },
            'Submit commissioning date correction via MaStR portal.',
            idx++
          ));
        }

        // Rule 4: Future commissioning date
        if (ibDate) {
          const ibDateObj = new Date(ibDate);
          if (!isNaN(ibDateObj) && ibDateObj > cutoffDate) {
            findings.push(createFinding(
              3, 'statusAnomalies', MQ_FUTURE_COMMISSIONING, 'error',
              `${mastr}: commissioning date in the future (${ibDate})`,
              `Inbetriebnahmedatum ${ibDate} is in the future for a registered installation. Data integrity issue.`,
              { mastr, inbetriebnahmeDatum: ibDate },
              'Correct the commissioning date in MaStR. If genuinely future-dated, status should be "InPlanung".',
              idx++
            ));
          }
        }

        // Rule 5: NBP status = "InPrüfung" (2955)
        const nbpStatus = String(inst.netzbetreiberPruefungStatus || '');
        if (nbpStatus === '2955') {
          findings.push(createFinding(
            3, 'statusAnomalies', MQ_NBP_PENDING, 'warning',
            `${mastr}: NBP review pending (InPrüfung)`,
            'NetzbetreiberPrüfung status is 2955 (In Prüfung). Grid operator review not completed.',
            { mastr, netzbetreiberPruefungStatus: nbpStatus },
            'Complete Netzbetreiberprüfung in MaStR portal.',
            idx++
          ));
        }

        // Rule 6: NBP status = "NichtVorgesehen" (3075)
        if (nbpStatus === '3075') {
          findings.push(createFinding(
            3, 'statusAnomalies', MQ_NBP_NOT_PLANNED, 'warning',
            `${mastr}: NBP review not planned (NichtVorgesehen)`,
            'NetzbetreiberPrüfung status is 3075 (Nicht Vorgesehen). Regulatory review may be required.',
            { mastr, netzbetreiberPruefungStatus: nbpStatus },
            'Verify if NBP is required for this installation type. Update status if applicable.',
            idx++
          ));
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 4: Capacity anomalies (pure sync)
    // -------------------------------------------------------------------------
    stepCapacityAnomalies(installations) {
      const findings = [];
      let idx = 1;

      // Type-specific implausible-high thresholds (kW)
      const HIGH_THRESHOLDS = { solar: 50000, wind: 20000 };
      const DEFAULT_HIGH = 100000;

      for (const inst of installations) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer || '?';
        const brutto = parseFloat(inst.bruttoleistung || inst.Bruttoleistung || inst.NettoNennleistung || 0);
        const netto  = parseFloat(inst.nettoNennleistung || inst.NettoNennleistung || 0);
        const type   = this.deriveInstallationType(inst);

        // Rule 1: Zero capacity
        if (brutto === 0 && netto === 0) {
          findings.push(createFinding(
            4, 'capacityAnomalies', MQ_ZERO_CAPACITY, 'error',
            `${mastr}: zero capacity (brutto=0, netto=0)`,
            'Both Bruttoleistung and NettoNennleistung are 0. This installation contributes no capacity to grid calculations.',
            { mastr, brutto, netto, type },
            'Enter correct capacity values in MaStR or deregister.',
            idx++
          ));
          continue;
        }

        // Rule 2: Negative capacity
        if (brutto < 0 || netto < 0) {
          findings.push(createFinding(
            4, 'capacityAnomalies', MQ_NEGATIVE_CAPACITY, 'error',
            `${mastr}: negative capacity (brutto=${brutto}, netto=${netto})`,
            'Negative capacity is physically impossible and indicates a data entry error.',
            { mastr, brutto, netto, type },
            'Correct capacity values in MaStR.',
            idx++
          ));
          continue;
        }

        // Rule 3: Implausibly high capacity
        const threshold = HIGH_THRESHOLDS[type] || DEFAULT_HIGH;
        if (brutto > threshold) {
          findings.push(createFinding(
            4, 'capacityAnomalies', MQ_IMPLAUSIBLE_HIGH_CAPACITY, 'warning',
            `${mastr}: implausibly high capacity ${brutto.toFixed(0)} kW (type: ${type}, threshold: ${threshold} kW)`,
            `Bruttoleistung of ${brutto} kW exceeds the plausibility threshold for type "${type}". Likely a unit error (kW vs. MW).`,
            { mastr, brutto, netto, type, threshold },
            'Verify unit (kW vs. MW). Correct in MaStR if erroneous.',
            idx++
          ));
        }

        // Rule 4: NettoNennleistung > Bruttoleistung (physical impossibility)
        if (netto > 0 && brutto > 0 && netto > brutto) {
          findings.push(createFinding(
            4, 'capacityAnomalies', MQ_NETTO_EXCEEDS_BRUTTO, 'error',
            `${mastr}: netto (${netto} kW) > brutto (${brutto} kW)`,
            'NettoNennleistung cannot exceed Bruttoleistung. This violates physics and indicates a data entry error.',
            { mastr, brutto, netto, type },
            'Swap or correct capacity values in MaStR.',
            idx++
          ));
        }

        // Rule 5: Missing Einspeisungsart (feed-in type) for operational solar
        const feedInType = inst.einspeisungsart || inst.Einspeisungsart;
        if (type === 'solar' && !feedInType && String(inst.einheitBetriebsstatus || '') === '35') {
          findings.push(createFinding(
            4, 'capacityAnomalies', MQ_MISSING_FEED_IN_TYPE, 'warning',
            `${mastr}: missing feed-in type (Einspeisungsart)`,
            'Operational solar installation has no Einspeisungsart. Required for EEG tariff and billing.',
            { mastr, type },
            'Add Einspeisungsart (Volleinspeisung/Überschusseinspeisung) in MaStR.',
            idx++
          ));
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 5: Connection point integrity (pure sync)
    // -------------------------------------------------------------------------
    stepConnectionPointIntegrity(installations, gridOperatorId) {
      const findings = [];
      let idx = 1;

      // Build NAP → installations map to detect multi-unit NAPs
      const napUnits = {};
      for (const inst of installations) {
        const napId = inst.nap?.MastrNummer || inst.NapMastrNummer || inst.napMastrNummer;
        if (napId) {
          if (!napUnits[napId]) napUnits[napId] = [];
          napUnits[napId].push(inst.EinheitMastrNummer || inst.einheitMastrNummer);
        }
      }

      for (const inst of installations) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer || '?';
        const napId  = inst.nap?.MastrNummer || inst.NapMastrNummer || inst.napMastrNummer;
        const melo   = inst.MeLo || inst.meLo || inst.messlokationsId;
        const brutto = parseFloat(inst.bruttoleistung || inst.Bruttoleistung || inst.NettoNennleistung || 0);
        const type   = this.deriveInstallationType(inst);

        // Rule 1: Missing NAP
        if (!napId) {
          findings.push(createFinding(
            5, 'connectionPoints', MQ_MISSING_NAP, 'warning',
            `${mastr}: no NAP (Netzanschlusspunkt) assigned`,
            'Installation has no linked NAP in MaStR. Grid operator routing and voltage level validation not possible.',
            { mastr, type, brutto },
            'Assign correct NAP via MaStR portal or request assignment from grid operator.',
            idx++
          ));
        }

        // Rule 2: Missing MeLo for operational units ≥100 kW
        if (!melo && brutto >= 100 && String(inst.einheitBetriebsstatus || '') === '35') {
          findings.push(createFinding(
            5, 'connectionPoints', MQ_MISSING_MELO, 'warning',
            `${mastr}: missing MeLo (Messlokation) for ≥100 kW operational unit`,
            'Operational installation ≥100 kW has no Messlokations-ID. Required for billing and metering.',
            { mastr, brutto, type },
            'Register Messlokation with metering operator and link in MaStR.',
            idx++
          ));
        }

        // Rule 3: NAP VNB mismatch (if NAP data available with VNB info)
        if (napId && gridOperatorId) {
          const napVnb = inst.nap?.NetzbetreiberMastrNummer || inst.napNetzbetreiberMastrNummer;
          if (napVnb && napVnb !== gridOperatorId) {
            findings.push(createFinding(
              5, 'connectionPoints', MQ_NAP_VNB_MISMATCH, 'error',
              `${mastr}: NAP ${napId} belongs to different VNB (${napVnb})`,
              `The NAP assigned to this installation belongs to VNB ${napVnb}, not the audited VNB ${gridOperatorId}.`,
              { mastr, napId, napVnb, auditedVnb: gridOperatorId },
              'Verify grid area assignment. Re-assign NAP to correct VNB if needed.',
              idx++
            ));
          }
        }

        // Rule 4: Voltage level mismatch — brutto ≥100 kW but NAP at NS (354)
        if (napId && brutto >= 100) {
          const napVoltage = String(inst.nap?.Spannungsebene || inst.napSpannungsebene || '');
          if (napVoltage === '354' || napVoltage.toLowerCase() === 'ns') {
            findings.push(createFinding(
              5, 'connectionPoints', MQ_VOLTAGE_MISMATCH, 'warning',
              `${mastr}: ${brutto.toFixed(0)} kW connected at Niederspannung (NS) — expected MS or higher`,
              'Installations ≥100 kW are typically connected at Mittelspannung or higher. NS connection may indicate a data error.',
              { mastr, brutto, napVoltage, napId },
              'Verify voltage level with grid operator. Update NAP voltage level in MaStR if incorrect.',
              idx++
            ));
          }
        }

        // Rule 5: NAP shared by >3 units — may indicate master-meter grouping issue
        if (napId && napUnits[napId] && napUnits[napId].length > 3) {
          // Only emit once per NAP
          if (napUnits[napId][0] === mastr) {
            findings.push(createFinding(
              5, 'connectionPoints', MQ_NAP_MULTI_UNIT, 'warning',
              `NAP ${napId}: shared by ${napUnits[napId].length} installations`,
              `More than 3 installations share the same NAP (${napId}). This may indicate incorrect NAP assignment or a master-meter grouping.`,
              { napId, unitCount: napUnits[napId].length, mastrNumbers: napUnits[napId].slice(0, 10) },
              'Review NAP assignment. Each installation should have its own NAP unless intentionally grouped.',
              idx++
            ));
          }
        }

        // Rule 6: Redispatch-relevant (≥100 kW) without NAP
        if (!napId && brutto >= 100) {
          findings.push(createFinding(
            5, 'connectionPoints', MQ_REDISPATCH_NO_NAP, 'error',
            `${mastr}: Redispatch-relevant unit (${brutto.toFixed(0)} kW) without NAP`,
            'Installations ≥100 kW must participate in Redispatch 2.0. Without a NAP, they cannot be registered in the Redispatch process.',
            { mastr, brutto, type },
            'Assign NAP immediately. Report to TSO/DSO for Redispatch registration.',
            idx++
          ));
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 6: Duplicate detection (pure sync)
    // Heuristic: match on PLZ + type + capacity ±10% + commissioning date ±90d
    // 4/4 criteria → MQ_PROBABLE_DUPLICATE
    // 3/4 criteria → MQ_POSSIBLE_DUPLICATE
    // lat/lon ±0.001° + type → MQ_GEO_DUPLICATE
    // -------------------------------------------------------------------------
    stepDuplicateDetection(installations) {
      const findings = [];
      let idx = 1;
      const reported = new Set();

      for (let i = 0; i < installations.length; i++) {
        const a = installations[i];
        const mastrA = a.EinheitMastrNummer || a.einheitMastrNummer || `idx-${i}`;

        for (let j = i + 1; j < installations.length; j++) {
          const b = installations[j];
          const mastrB = b.EinheitMastrNummer || b.einheitMastrNummer || `idx-${j}`;
          const pairKey = [mastrA, mastrB].sort().join('|');
          if (reported.has(pairKey)) continue;

          const typeA = this.deriveInstallationType(a);
          const typeB = this.deriveInstallationType(b);
          const plzA  = a.Postleitzahl || a.postleitzahl;
          const plzB  = b.Postleitzahl || b.postleitzahl;
          const capA  = parseFloat(a.bruttoleistung || a.Bruttoleistung || a.NettoNennleistung || 0);
          const capB  = parseFloat(b.bruttoleistung || b.Bruttoleistung || b.NettoNennleistung || 0);
          const ibA   = a.inbetriebnahmeDatum || a.Inbetriebnahmedatum;
          const ibB   = b.inbetriebnahmeDatum || b.Inbetriebnahmedatum;
          const latA  = parseFloat(a.koordinatenBreitengrad || a.lat || 0);
          const latB  = parseFloat(b.koordinatenBreitengrad || b.lat || 0);
          const lonA  = parseFloat(a.koordinatenLaengengrad || a.lon || 0);
          const lonB  = parseFloat(b.koordinatenLaengengrad || b.lon || 0);

          // Geo duplicate: same type + coordinates within 0.001°
          if (typeA === typeB && latA !== 0 && latB !== 0 &&
              Math.abs(latA - latB) <= 0.001 && Math.abs(lonA - lonB) <= 0.001) {
            findings.push(createFinding(
              6, 'duplicateDetection', MQ_GEO_DUPLICATE, 'warning',
              `Geo duplicate: ${mastrA} / ${mastrB} at same coordinates`,
              `Two ${typeA} installations at nearly identical coordinates (Δlat=${Math.abs(latA - latB).toFixed(4)}°, Δlon=${Math.abs(lonA - lonB).toFixed(4)}°).`,
              { mastrA, mastrB, latA, lonA, latB, lonB, type: typeA },
              'Check if these are the same physical installation registered twice. Deregister the duplicate.',
              idx++
            ));
            reported.add(pairKey);
            continue;
          }

          // Criteria matching
          const samePLZ     = plzA && plzB && plzA === plzB;
          const sameType    = typeA === typeB;
          const sameCap     = capA > 0 && capB > 0 && Math.abs(capA - capB) / Math.max(capA, capB) <= 0.10;
          let sameDate = false;
          if (ibA && ibB) {
            const dA = new Date(ibA);
            const dB = new Date(ibB);
            if (!isNaN(dA) && !isNaN(dB)) {
              sameDate = Math.abs(dA - dB) <= 90 * 24 * 60 * 60 * 1000;
            }
          }

          const score = [samePLZ, sameType, sameCap, sameDate].filter(Boolean).length;

          if (score === 4) {
            findings.push(createFinding(
              6, 'duplicateDetection', MQ_PROBABLE_DUPLICATE, 'error',
              `Probable duplicate: ${mastrA} / ${mastrB}`,
              `All 4 criteria match (PLZ, type, capacity ±10%, commissioning date ±90d). Very likely the same physical installation.`,
              { mastrA, mastrB, plzA, typeA, capA, ibA, capB, ibB },
              'Review both records. Deregister the duplicate in MaStR immediately.',
              idx++
            ));
            reported.add(pairKey);
          } else if (score === 3) {
            findings.push(createFinding(
              6, 'duplicateDetection', MQ_POSSIBLE_DUPLICATE, 'warning',
              `Possible duplicate: ${mastrA} / ${mastrB} (3/4 criteria match)`,
              `3 of 4 duplicate criteria match (PLZ: ${samePLZ}, type: ${sameType}, cap: ${sameCap}, date: ${sameDate}).`,
              { mastrA, mastrB, plzA: plzA || plzB, typeA, capA, ibA, capB, ibB, matchedCriteria: { samePLZ, sameType, sameCap, sameDate } },
              'Review both records. Deregister if confirmed duplicate.',
              idx++
            ));
            reported.add(pairKey);
          }
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 7: Geo spot check (async — broker calls to osm-geo.validate)
    // Selects up to geoSampleSize installations:
    //   priority 1: bruttoleistung ≥100 kW (Redispatch-relevant)
    //   priority 2: type diversity
    // -------------------------------------------------------------------------
    async stepGeoSpotCheck(ctx, installations, params, callOpts) {
      const findings = [];
      let idx = 1;
      const geoSampleSize = Math.min(params.geoSampleSize || 10, 50);
      const operator = params._resolvedOperator || {};

      if (installations.length === 0) return findings;

      // Filter to installations with coordinates
      const withCoords = installations.filter((i) => {
        const lat = parseFloat(i.koordinatenBreitengrad || i.lat || 0);
        const lon = parseFloat(i.koordinatenLaengengrad || i.lon || 0);
        return lat !== 0 && lon !== 0;
      });

      if (withCoords.length === 0) {
        findings.push(createFinding(
          7, 'geoSpotCheck', MQ_GEO_CHECK_FAILED, 'warning',
          'Geo spot check skipped: no installations with coordinates',
          'None of the portfolio installations have coordinate data in MaStR. Geo validation not possible.',
          { total: installations.length, withCoords: 0 },
          'Register coordinates for installations in MaStR portal.',
          idx++
        ));
        return findings;
      }

      // Priority 1: Redispatch-relevant (≥100 kW)
      const redispatch = withCoords.filter((i) =>
        parseFloat(i.bruttoleistung || i.Bruttoleistung || i.NettoNennleistung || 0) >= 100
      );
      // Build a diverse sample: alternate types
      const typeGroups = {};
      for (const inst of (redispatch.length > 0 ? redispatch : withCoords)) {
        const t = this.deriveInstallationType(inst);
        if (!typeGroups[t]) typeGroups[t] = [];
        typeGroups[t].push(inst);
      }

      const sample = [];
      const typeKeys = Object.keys(typeGroups);
      let ti = 0;
      while (sample.length < geoSampleSize) {
        let added = false;
        for (let k = 0; k < typeKeys.length && sample.length < geoSampleSize; k++) {
          const typeKey = typeKeys[(ti + k) % typeKeys.length];
          if (typeGroups[typeKey].length > 0) {
            sample.push(typeGroups[typeKey].shift());
            added = true;
          }
        }
        ti++;
        if (!added) break;
      }

      // Run osm-geo.validate for each sampled installation
      for (const inst of sample) {
        const mastr = inst.EinheitMastrNummer || inst.einheitMastrNummer;
        if (!mastr) continue;

        try {
          const geoResult = await ctx.call(
            'osm-geo.validate',
            { mastrNummer: mastr, gridOperatorId: operator.mastrId },
            callOpts
          );

          const verdict = geoResult?.data?.validation?.verdict || geoResult?.validation?.verdict;
          const confidence = geoResult?.data?.validation?.confidenceScore || 0;

          if (verdict === 'CONSISTENT') {
            findings.push(createFinding(
              7, 'geoSpotCheck', MQ_GEO_PLAUSIBLE, 'info',
              `${mastr}: geo assignment plausible (${verdict})`,
              `OSM geo validation confirmed installation is in the correct grid area. Confidence: ${(confidence * 100).toFixed(0)}%.`,
              { mastr, verdict, confidenceScore: confidence },
              null, idx++
            ));
          } else if (['DEFINITIVE_MISASSIGNMENT', 'LIKELY_MISASSIGNMENT'].includes(verdict)) {
            findings.push(createFinding(
              7, 'geoSpotCheck', MQ_GEO_MISASSIGNMENT, 'error',
              `${mastr}: geo misassignment detected (${verdict})`,
              `OSM geo validation indicates installation may be assigned to wrong grid operator. Verdict: ${verdict}. Confidence: ${(confidence * 100).toFixed(0)}%.`,
              { mastr, verdict, confidenceScore: confidence },
              'Investigate grid area assignment. Escalate to BNetzA if confirmed definitive misassignment.',
              idx++
            ));
          } else {
            // UNCERTAIN, INSUFFICIENT_DATA — informational
            findings.push(createFinding(
              7, 'geoSpotCheck', MQ_GEO_PLAUSIBLE, 'info',
              `${mastr}: geo check inconclusive (${verdict || 'no verdict'})`,
              `OSM geo validation returned an inconclusive result. Not enough data for a definitive assessment.`,
              { mastr, verdict, confidenceScore: confidence },
              null, idx++
            ));
          }
        } catch (err) {
          findings.push(createFinding(
            7, 'geoSpotCheck', MQ_GEO_CHECK_FAILED, 'warning',
            `${mastr}: geo check failed — ${err.message}`,
            `osm-geo.validate call failed for installation ${mastr}. Geo data not available.`,
            { mastr, error: err.message },
            'Check OSM geo service availability. Re-run audit when service is restored.',
            idx++
          ));
        }
      }

      return findings;
    },

    // -------------------------------------------------------------------------
    // Step 8: Audit trail (mirrors v0.14/v0.15 pattern)
    // -------------------------------------------------------------------------
    async stepAudit(ctx, params, reportData, callOpts) {
      const findings = [];
      let idx = 1;
      let snapshotValidation = null;
      const { datapointTags = [], maxAgeMinutes = 120, _resolvedOperator: operator = {} } = params;

      if (datapointTags.length > 0) {
        try {
          const snap = await ctx.call('datapoint.createSnapshot', {
            tags: datapointTags.join(','),
            maxAgeMinutes,
            createdBy: 'agent',
            name: `mq-${(operator.mastrId || 'unknown').replace(/[^a-z0-9]/gi, '-')}-${Date.now()}`,
            description: `MaStR quality audit snapshot for ${operator.name || 'unknown'}`,
          }, callOpts);

          if (snap?.id) {
            try {
              snapshotValidation = await ctx.call('datapoint.validateSnapshot', { id: snap.id }, callOpts);
              if (snapshotValidation?.drift?.length > 0) {
                findings.push(createFinding(
                  8, 'audit', SNAPSHOT_DRIFT_DETECTED, 'warning',
                  `Data drift detected in ${snapshotValidation.drift.length} datapoint(s)`,
                  'One or more datapoints changed during pipeline execution. Results may be inconsistent.',
                  { drift: snapshotValidation.drift, snapshotId: snap.id },
                  'Re-run audit after data refresh for a consistent result.',
                  idx++
                ));
              }
            } catch (err) {
              this.logger.debug(`stepAudit: snapshot validation skipped — ${err.message}`);
            }
          }
        } catch (err) {
          this.logger.warn(`stepAudit: snapshot creation skipped — ${err.message}`);
        }
      }

      findings.push(createFinding(
        8, 'audit', AUDIT_TRAIL_CREATED, 'info',
        `Audit trail created — pipeline v${PIPELINE_VERSION}`,
        `Deterministic MaStR quality pipeline v${PIPELINE_VERSION} completed. ` +
        `No LLM involvement. Total findings: ${reportData.allFindingsCount + findings.length}. ` +
        `qualityScore: ${reportData.qualityScore}.`,
        {
          pipelineVersion: PIPELINE_VERSION,
          qualityScore: reportData.qualityScore,
          totalInstallations: reportData.totalInstallations,
          findingsTotal: reportData.allFindingsCount + findings.length,
          consistent: snapshotValidation?.consistent ?? null,
        },
        null, idx++
      ));

      return { findings, snapshotValidation };
    },

    // -------------------------------------------------------------------------
    // Derive installation type from raw MaStR record (shared helper)
    // -------------------------------------------------------------------------
    deriveInstallationType(inst) {
      const et = String(
        inst.Energietraeger || inst.energietraeger || inst.energieTraeger || ''
      ).toLowerCase();
      if (['solar', 'photovoltaik', 'pv'].some((t) => et.includes(t))) return 'solar';
      if (['wind', 'windkraft'].some((t) => et.includes(t))) return 'wind';
      if (['speicher', 'battery', 'batterie', 'storage'].some((t) => et.includes(t))) return 'storage';
      if (['biomasse', 'biogas', 'biomethan'].some((t) => et.includes(t))) return 'biomass';
      if (['verbrennung', 'gas', 'kohle', 'combustion'].some((t) => et.includes(t))) return 'combustion';
      if (inst.Modulanzahl || inst.GrossflächePv) return 'solar';
      if (inst.Nabenhoehe || inst.Rotordurchmesser) return 'wind';
      if (inst.Speicherkapazitaet) return 'storage';
      return 'other';
    },

    // -------------------------------------------------------------------------
    // Main pipeline orchestrator
    // -------------------------------------------------------------------------
    async runPipeline(ctx, params) {
      const startTime = Date.now();
      const { skipSteps = [] } = params;
      const skip = new Set(skipSteps);
      const callOpts = { meta: { ...ctx.meta, $gateway: false } };
      const allFindings = [];
      const stepSummaries = [];

      // Helper: run one step, catch errors, record timing
      const runStep = async (stepNum, stepName, fn) => {
        if (skip.has(stepNum)) {
          stepSummaries.push({ step: stepNum, name: stepName, status: 'skipped', durationMs: 0, findingsCount: 0 });
          return null;
        }
        const t0 = Date.now();
        try {
          const result = await fn();
          const stepFindings = Array.isArray(result) ? result : (result?.findings || []);
          allFindings.push(...stepFindings);
          stepSummaries.push({
            step: stepNum, name: stepName, status: 'success',
            durationMs: Date.now() - t0, findingsCount: stepFindings.length,
          });
          return result;
        } catch (err) {
          this.logger.error(`MaStR quality pipeline step ${stepNum} (${stepName}) failed: ${err.message}`);
          stepSummaries.push({
            step: stepNum, name: stepName, status: 'error',
            durationMs: Date.now() - t0, findingsCount: 0, error: err.message,
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

      // Inject resolved operator into params for downstream steps
      params._resolvedOperator = operator;

      // Step 2: Inventory (mandatory)
      let installations = [];
      await runStep(2, 'inventory', async () => {
        const res = await this.stepInventory(ctx, operator);
        installations = res.installations;
        return res.findings;
      });

      const now = new Date();

      // Step 3: Status anomalies (skippable)
      if (!skip.has(3)) {
        await runStep(3, 'statusAnomalies', () =>
          this.stepStatusAnomalies(installations, now)
        );
      } else {
        stepSummaries.push({ step: 3, name: 'statusAnomalies', status: 'skipped', durationMs: 0, findingsCount: 0 });
      }

      // Step 4: Capacity anomalies (skippable)
      if (!skip.has(4)) {
        await runStep(4, 'capacityAnomalies', () =>
          this.stepCapacityAnomalies(installations)
        );
      } else {
        stepSummaries.push({ step: 4, name: 'capacityAnomalies', status: 'skipped', durationMs: 0, findingsCount: 0 });
      }

      // Step 5: Connection point integrity (skippable)
      if (!skip.has(5)) {
        await runStep(5, 'connectionPoints', () =>
          this.stepConnectionPointIntegrity(installations, operator.mastrId)
        );
      } else {
        stepSummaries.push({ step: 5, name: 'connectionPoints', status: 'skipped', durationMs: 0, findingsCount: 0 });
      }

      // Step 6: Duplicate detection (skippable)
      if (!skip.has(6)) {
        await runStep(6, 'duplicateDetection', () =>
          this.stepDuplicateDetection(installations)
        );
      } else {
        stepSummaries.push({ step: 6, name: 'duplicateDetection', status: 'skipped', durationMs: 0, findingsCount: 0 });
      }

      // Step 7: Geo spot check (skippable)
      if (!skip.has(7)) {
        await runStep(7, 'geoSpotCheck', () =>
          this.stepGeoSpotCheck(ctx, installations, params, callOpts)
        );
      } else {
        stepSummaries.push({ step: 7, name: 'geoSpotCheck', status: 'skipped', durationMs: 0, findingsCount: 0 });
      }

      // Compute quality dimensions and scores
      const qualityDimensions = {};
      for (const [dim, stepNums] of Object.entries(DIMENSION_STEPS)) {
        const stepSkipped = stepNums.every((s) => skip.has(s));
        if (stepSkipped) {
          qualityDimensions[dim] = { score: null, findings: 0, weight: QUALITY_DIMENSION_WEIGHTS[dim] };
        } else {
          const dimFindings = allFindings.filter((f) => stepNums.includes(f.step));
          qualityDimensions[dim] = {
            score: computeDimensionScore(allFindings, stepNums),
            findings: dimFindings.length,
            weight: QUALITY_DIMENSION_WEIGHTS[dim],
          };
        }
      }

      const qualityScore = computeQualityScore(qualityDimensions);

      // Step 8: Audit trail (mandatory)
      let auditResult = null;
      await runStep(8, 'audit', async () => {
        auditResult = await this.stepAudit(ctx, params, {
          qualityScore,
          totalInstallations: installations.length,
          allFindingsCount: allFindings.length,
        }, callOpts);
        return auditResult.findings;
      });

      const byType = {};
      for (const inst of installations) {
        const t = this.deriveInstallationType(inst);
        byType[t] = (byType[t] || 0) + 1;
      }

      return {
        gridOperator: operator,
        qualityScore,
        qualityDimensions,
        summary: {
          totalInstallations: installations.length,
          installationsByType: byType,
          findingsCount: summarizeFindings(allFindings),
          skippedSteps: skipSteps,
          durationMs: Date.now() - startTime,
        },
        findings: allFindings,
        steps: stepSummaries,
        metadata: {
          pipelineVersion: PIPELINE_VERSION,
          executedAt: new Date().toISOString(),
          maxAgeMinutes: params.maxAgeMinutes || 120,
          geoSampleSize: params.geoSampleSize || 10,
        },
      };
    },
  },
};
