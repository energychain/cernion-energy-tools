'use strict';

const crypto = require('crypto');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const { MoleculerClientError } = require('moleculer').Errors;

const OPENAPI_TAG = 'EOG Calculator';
const DOC_PREFIX_DP = 'eogdp:';
const DOC_PREFIX_VALIDATION = 'eogval:';
const DOC_PREFIX_EVENT = 'eogevt:';

const DATA_STATUS_VALUES = ['complete', 'partial', 'blocked'];
const CALCULATION_MODE_VALUES = ['actual', 'scenario', 'provisional'];
const CONFIDENCE_VALUES = ['confirmed', 'user_supplied', 'derived', 'missing', 'assumed'];
const SOURCE_VALUES = [
  'public',
  'tenant_uploaded',
  'user_confirmed',
  'derived',
  'missing',
  'hypothetical',
];
const SECTOR_VALUES = ['strom', 'gas'];

const EOG_FIELDS = {
  efficiency_value: {
    key: 'eog.efficiency_value',
    type: 'number',
    unit: '%',
    requiredForActual: true,
    blocker:
      'Ohne Effizienzwert kann der Abbaupfad ineffizienter Kosten nicht berechnet werden.',
  },
  base_cost_level: {
    key: 'eog.base_cost_level',
    type: 'number',
    unit: 'EUR',
    requiredForActual: true,
    blocker: 'Ohne Ausgangsniveau der Kostenprüfung fehlt die rechnerische Ausgangsbasis.',
  },
  controllable_costs: {
    key: 'eog.controllable_costs',
    type: 'number',
    unit: 'EUR',
    requiredForActual: true,
    blocker: 'Ohne beeinflussbare Kosten kann der Effizienzabbau nicht ermittelt werden.',
  },
  permanently_non_controllable_costs: {
    key: 'eog.permanently_non_controllable_costs',
    type: 'number',
    unit: 'EUR',
    requiredForActual: true,
    blocker: 'Ohne dauerhaft nicht beeinflussbare Kosten fehlt ein Pflichtbestandteil der EOG.',
  },
  temporarily_non_controllable_costs: {
    key: 'eog.temporarily_non_controllable_costs',
    type: 'number',
    unit: 'EUR',
    requiredForActual: true,
    blocker: 'Ohne vorübergehend nicht beeinflussbare Kosten ist die EOG nicht vollständig.',
  },
  capex_adjustment_addition: {
    key: 'eog.capex_adjustment_addition',
    type: 'number',
    unit: 'EUR',
    requiredForActual: false,
    blocker: 'Ohne Kapitalkostenaufschlag sind Investitionsanpassungen unvollständig.',
  },
  capex_adjustment_deduction: {
    key: 'eog.capex_adjustment_deduction',
    type: 'number',
    unit: 'EUR',
    requiredForActual: false,
    blocker: 'Ohne Kapitalkostenabzug sind Investitionsanpassungen unvollständig.',
  },
  volatile_costs: {
    key: 'eog.volatile_costs',
    type: 'number',
    unit: 'EUR',
    requiredForActual: false,
    blocker: 'Volatile Kosten sind für Detailreproduktion erforderlich.',
  },
  quality_element: {
    key: 'eog.quality_element',
    type: 'number',
    unit: 'EUR',
    requiredForActual: false,
    blocker: 'Ohne Qualitätselement fehlen Zu-/Abschläge aus der Qualitätsregulierung.',
  },
  regulatory_account_balance: {
    key: 'eog.regulatory_account_balance',
    type: 'number',
    unit: 'EUR',
    requiredForActual: false,
    blocker: 'Ohne Regulierungskonto-Saldo fehlen periodenübergreifende Korrekturen.',
  },
  approved_revenue_cap: {
    key: 'eog.approved_revenue_cap',
    type: 'number',
    unit: 'EUR',
    requiredForActual: false,
    isCalibrationAnchor: true,
    blocker: 'Beschiedene EOG-Werte dienen als Kalibrieranker zur Modellvalidierung.',
  },
  adjusted_revenue_cap: {
    key: 'eog.adjusted_revenue_cap',
    type: 'number',
    unit: 'EUR',
    requiredForActual: false,
    isCalibrationAnchor: true,
    blocker: 'Angepasste EOG-Werte dienen als Kalibrieranker zur Modellvalidierung.',
  },
  vpi: {
    key: 'eog.vpi',
    type: 'number',
    unit: 'index',
    requiredForActual: false,
    blocker: 'Ohne VPI sind periodenspezifische Preisfortschreibungen nicht reproduzierbar.',
  },
  xgen: {
    key: 'eog.xgen',
    type: 'number',
    unit: '%',
    requiredForActual: false,
    blocker: 'Ohne Xgen kann der allgemeine sektorale Produktivitätsfaktor nicht geprüft werden.',
  },
  distribution_factor: {
    key: 'eog.distribution_factor',
    type: 'number',
    unit: 'factor',
    requiredForActual: false,
    blocker: 'Ohne Verteilungsfaktor kann die Verteilungslogik nicht nachgerechnet werden.',
  },
};

const EOG_KEYS = Object.keys(EOG_FIELDS);
const REQUIRED_ACTUAL_KEYS = EOG_KEYS.filter((key) => EOG_FIELDS[key].requiredForActual);
const DECISION_OPTIONS = [
  'manual_confirm',
  'document_upload',
  'scenario_assumption',
  'abort',
];

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeYear(periodYear) {
  const parsed = Number(periodYear);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) return null;
  return parsed;
}

function sanitizeForDatapointName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 62);
}

module.exports = {
  name: 'eog-calculator',

  settings: {
    dbPath: process.env.EOG_CALCULATOR_DB_PATH || './data/eog-calculator',
    calibrationToleranceAbsolute: Number(process.env.EOG_CALIBRATION_TOLERANCE_ABS || 1),
    calibrationToleranceRelative: Number(process.env.EOG_CALIBRATION_TOLERANCE_REL || 0.01),
  },

  created() {
    this.db = new PouchDB(this.settings.dbPath, { auto_compaction: true });
  },

  async started() {
    await this.db.createIndex({ index: { fields: ['type', 'tenantId', 'vnbId'] } });
    await this.db.createIndex({ index: { fields: ['type', 'tenantId', 'vnbId', 'periodYear'] } });
    this.logger.info(`EOG calculator DB initialized at ${this.settings.dbPath}`);
  },

  async stopped() {
    if (this.db) {
      await this.db.close();
    }
  },

  actions: {
    inputStatus: {
      rest: 'POST /input-status',
      params: {
        tenantId: { type: 'string', min: 1 },
        vnbId: { type: 'string', min: 1 },
        periodYear: { type: 'number', convert: true, integer: true, optional: true },
        sector: { type: 'enum', values: SECTOR_VALUES, optional: true },
        regulatoryPeriod: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Check EOG input coverage for a tenant/VNB scope',
        description: 'Reports required fields, optional-but-relevant fields, and calibration anchors. optionalButRelevant includes quality_element, regulatory_account_balance, capex_adjustment_*, and volatile_costs which are needed for accurate detail reproduction.',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId', 'vnbId'],
                properties: {
                  tenantId: { type: 'string', example: 'tenant-a' },
                  vnbId: { type: 'string', example: 'SNB100' },
                  periodYear: { type: 'integer', example: 2026 },
                  sector: { type: 'string', enum: SECTOR_VALUES, example: 'strom' },
                  regulatoryPeriod: { type: 'string', example: 'RP3' },
                },
              },
              examples: {
                default: {
                  value: {
                    tenantId: 'tenant-a',
                    vnbId: 'SNB100',
                    periodYear: 2026,
                    sector: 'strom',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const scope = this.buildScope(ctx.params);
        const datapoints = await this.loadScopedDatapoints(scope);
        const grouped = this.mapDatapointsByKey(datapoints);

        const missingRequired = REQUIRED_ACTUAL_KEYS.filter((key) => !grouped[key]);
        const missing = missingRequired.map((key) => this.buildMissingDescriptor(key, scope));

        // Optional but regulatorily relevant fields for detail reproduction
        const OPTIONAL_BUT_RELEVANT = [
          'quality_element',
          'regulatory_account_balance',
          'capex_adjustment_addition',
          'capex_adjustment_deduction',
          'volatile_costs',
        ];
        const optionalButRelevant = OPTIONAL_BUT_RELEVANT.map((key) => ({
          key,
          available: Boolean(grouped[key]),
          description: EOG_FIELDS[key].blocker,
          importance: 'detail_reproduction',
        }));

        const anchors = ['approved_revenue_cap', 'adjusted_revenue_cap'].map((key) => ({
          key,
          available: Boolean(grouped[key]),
          description: EOG_FIELDS[key].blocker,
        }));

        return {
          success: true,
          scope,
          dataStatus: this.computeDataStatus(missingRequired.length, datapoints.length),
          calculationMode: 'actual',
          confidence: this.summarizeConfidence(datapoints),
          required: REQUIRED_ACTUAL_KEYS,
          missing,
          optionalButRelevant,
          anchors,
        };
      },
    },

    validateDatapoints: {
      rest: 'POST /datapoints/validate',
      params: {
        tenantId: { type: 'string', min: 1 },
        vnbId: { type: 'string', min: 1 },
        datapoints: {
          type: 'array',
          min: 1,
          items: {
            type: 'object',
            props: {
              key: { type: 'string', min: 1 },
              value: { type: 'any', optional: true },
              unit: { type: 'string', optional: true },
              periodYear: { type: 'number', integer: true, convert: true },
              sector: { type: 'enum', values: SECTOR_VALUES },
              regulatoryPeriod: { type: 'string', optional: true },
              source: { type: 'enum', values: SOURCE_VALUES },
              confidence: { type: 'enum', values: CONFIDENCE_VALUES },
              provenance: { type: 'object', optional: true, default: {} },
              status: {
                type: 'enum',
                values: ['final', 'hearing', 'draft', 'calculated'],
                optional: true,
                default: 'final',
              },
            },
          },
        },
      },
      openapi: {
        summary: 'Validate submitted EOG datapoints without persisting them',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId', 'vnbId', 'datapoints'],
                properties: {
                  tenantId: { type: 'string', example: 'tenant-a' },
                  vnbId: { type: 'string', example: 'SNB100' },
                  datapoints: {
                    type: 'array',
                    items: { type: 'object' },
                    example: [{ key: 'eog.base_cost_level', value: 1000, periodYear: 2026, sector: 'strom', source: 'tenant_uploaded', confidence: 'confirmed' }],
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    tenantId: 'tenant-a',
                    vnbId: 'SNB100',
                    datapoints: [
                      {
                        key: 'eog.base_cost_level',
                        value: 1000,
                        periodYear: 2026,
                        sector: 'strom',
                        source: 'tenant_uploaded',
                        confidence: 'confirmed',
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = String(ctx.params.tenantId).trim();
        const vnbId = String(ctx.params.vnbId).trim();
        const validation = this.validateInputDatapoints(tenantId, vnbId, ctx.params.datapoints);
        const validationId = crypto.randomUUID();
        const createdAt = nowIso();

        const validationDoc = {
          _id: `${DOC_PREFIX_VALIDATION}${validationId}`,
          type: 'eog-validation-session',
          validationId,
          tenantId,
          vnbId,
          createdAt,
          updatedAt: createdAt,
          dataStatus: validation.dataStatus,
          warnings: validation.warnings,
          errors: validation.errors,
          normalizedDatapoints: validation.normalizedDatapoints,
        };

        await this.db.put(validationDoc);

        return {
          success: true,
          validationId,
          tenantId,
          vnbId,
          dataStatus: validation.dataStatus,
          canCommit: validation.errors.length === 0 && validation.normalizedDatapoints.length > 0,
          warnings: validation.warnings,
          errors: validation.errors,
          normalizedDatapoints: validation.normalizedDatapoints,
        };
      },
    },

    commitDatapoints: {
      rest: 'POST /datapoints/commit',
      params: {
        validationId: { type: 'string', min: 1 },
        hitlConfirmation: {
          type: 'object',
          optional: true,
          props: {
            approved: { type: 'boolean', optional: true, default: false },
            itemId: { type: 'string', optional: true },
            decision: { type: 'enum', values: DECISION_OPTIONS, optional: true },
            actor: { type: 'string', optional: true },
            comment: { type: 'string', optional: true },
          },
        },
      },
      openapi: {
        summary:
          'Commit EOG datapoints only after successful validation or explicit HITL confirmation',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['validationId'],
                properties: {
                  validationId: { type: 'string', example: 'validation-uuid' },
                  hitlConfirmation: { type: 'object', example: { approved: true, decision: 'manual_confirm' } },
                },
              },
              examples: {
                default: {
                  value: {
                    validationId: 'validation-uuid',
                    hitlConfirmation: { approved: true, decision: 'manual_confirm' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const validationDoc = await this.getValidationSession(ctx.params.validationId);
        const confirmation = ctx.params.hitlConfirmation || null;

        if (validationDoc.errors.length > 0 && !confirmation?.approved) {
          throw new MoleculerClientError(
            'Validation contains blocking errors. Commit requires HITL confirmation.',
            422,
            'VALIDATION_BLOCKED'
          );
        }

        if (confirmation?.decision === 'abort') {
          await this.recordDecisionEvent(validationDoc, confirmation, {
            status: 'aborted',
            committed: false,
          });
          return {
            success: true,
            committed: false,
            reason: 'User aborted calculation/commit.',
            decision: confirmation,
          };
        }

        if (confirmation?.decision === 'scenario_assumption') {
          await this.recordDecisionEvent(validationDoc, confirmation, {
            status: 'scenario-only',
            committed: false,
          });
          return {
            success: true,
            committed: false,
            reason: 'Values marked as scenario assumptions and were not persisted as actual datapoints.',
            decision: confirmation,
          };
        }

        const persisted = [];
        for (const datapoint of validationDoc.normalizedDatapoints) {
          const result = await this.upsertEogDatapoint(datapoint);
          persisted.push(result);
          await this.syncToDatapointService(ctx, result);
        }

        await this.recordDecisionEvent(validationDoc, confirmation, {
          status: 'committed',
          committed: true,
          persistedCount: persisted.length,
        });

        return {
          success: true,
          committed: true,
          tenantId: validationDoc.tenantId,
          vnbId: validationDoc.vnbId,
          persistedCount: persisted.length,
          datapoints: persisted.map((item) => this.toPublicDatapoint(item.doc)),
        };
      },
    },

    calculate: {
      rest: 'POST /calculate',
      params: {
        tenantId: { type: 'string', min: 1 },
        vnbId: { type: 'string', min: 1 },
        periodYear: { type: 'number', convert: true, integer: true, optional: true },
        sector: { type: 'enum', values: SECTOR_VALUES, optional: true },
        regulatoryPeriod: { type: 'string', optional: true },
      },
      openapi: {
        summary: 'Calculate EOG for actual data scope',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId', 'vnbId'],
                properties: {
                  tenantId: { type: 'string', example: 'tenant-a' },
                  vnbId: { type: 'string', example: 'SNB100' },
                  periodYear: { type: 'integer', example: 2026 },
                  sector: { type: 'string', enum: SECTOR_VALUES, example: 'strom' },
                  regulatoryPeriod: { type: 'string', example: 'RP3' },
                },
              },
              examples: {
                default: {
                  value: {
                    tenantId: 'tenant-a',
                    vnbId: 'SNB100',
                    periodYear: 2026,
                    sector: 'strom',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const scope = this.buildScope(ctx.params);
        const datapoints = await this.loadScopedDatapoints(scope);
        const result = this.calculateInternal(datapoints, {
          scope,
          calculationMode: 'actual',
        });

        return { success: true, ...result };
      },
    },

    scenario: {
      rest: 'POST /scenario',
      params: {
        tenantId: { type: 'string', min: 1 },
        vnbId: { type: 'string', min: 1 },
        periodYear: { type: 'number', convert: true, integer: true, optional: true },
        sector: { type: 'enum', values: SECTOR_VALUES, optional: true },
        regulatoryPeriod: { type: 'string', optional: true },
        overrides: {
          type: 'array',
          min: 1,
          items: {
            type: 'object',
            props: {
              key: { type: 'string', min: 1 },
              value: { type: 'number', convert: true },
              unit: { type: 'string', optional: true },
              confidence: {
                type: 'enum',
                optional: true,
                values: CONFIDENCE_VALUES,
                default: 'assumed',
              },
            },
          },
        },
      },
      openapi: {
        summary: 'Run transient EOG scenario with overrides (no persistence)',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId', 'vnbId', 'overrides'],
                properties: {
                  tenantId: { type: 'string', example: 'tenant-a' },
                  vnbId: { type: 'string', example: 'SNB100' },
                  periodYear: { type: 'integer', example: 2026 },
                  sector: { type: 'string', enum: SECTOR_VALUES, example: 'strom' },
                  regulatoryPeriod: { type: 'string', example: 'RP3' },
                  overrides: {
                    type: 'array',
                    items: { type: 'object' },
                    example: [{ key: 'eog.quality_element', value: 50 }],
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    tenantId: 'tenant-a',
                    vnbId: 'SNB100',
                    overrides: [{ key: 'eog.quality_element', value: 50 }],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const scope = this.buildScope(ctx.params);
        const datapoints = await this.loadScopedDatapoints(scope);
        const datapointMap = this.mapDatapointsByKey(datapoints);

        const scenarioDatapoints = [...datapoints];
        for (const override of ctx.params.overrides) {
          const key = this.normalizeEogKey(override.key);
          if (!EOG_FIELDS[key]) {
            throw new MoleculerClientError(`Unsupported scenario key '${override.key}'`, 422);
          }
          const unit = override.unit || EOG_FIELDS[key].unit;
          const base = datapointMap[key];
          scenarioDatapoints.push({
            type: 'eog-datapoint-scenario',
            tenantId: scope.tenantId,
            vnbId: scope.vnbId,
            key,
            value: Number(override.value),
            unit,
            periodYear: base?.periodYear || scope.periodYear || new Date().getUTCFullYear(),
            sector: base?.sector || scope.sector || 'strom',
            regulatoryPeriod: base?.regulatoryPeriod || scope.regulatoryPeriod || null,
            source: 'hypothetical',
            confidence: override.confidence || 'assumed',
            provenance: {
              scenario: true,
              createdAt: nowIso(),
            },
            status: 'scenario',
            scenarioOverride: true,
          });
        }

        const result = this.calculateInternal(scenarioDatapoints, {
          scope,
          calculationMode: 'scenario',
        });

        return {
          success: true,
          persisted: false,
          ...result,
          overridesApplied: ctx.params.overrides.length,
        };
      },
    },

    requestInput: {
      rest: 'POST /request-input',
      params: {
        tenantId: { type: 'string', min: 1 },
        vnbId: { type: 'string', min: 1 },
        periodYear: { type: 'number', convert: true, integer: true, optional: true },
        sector: { type: 'enum', values: SECTOR_VALUES, optional: true },
        regulatoryPeriod: { type: 'string', optional: true },
        missingKeys: { type: 'array', items: 'string', optional: true },
      },
      openapi: {
        summary: 'Create HITL items for missing EOG inputs with blocker explanation',
        tags: [OPENAPI_TAG],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tenantId', 'vnbId'],
                properties: {
                  tenantId: { type: 'string', example: 'tenant-a' },
                  vnbId: { type: 'string', example: 'SNB100' },
                  periodYear: { type: 'integer', example: 2026 },
                  sector: { type: 'string', enum: SECTOR_VALUES, example: 'strom' },
                  regulatoryPeriod: { type: 'string', example: 'RP3' },
                  missingKeys: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['eog.efficiency_value'],
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    tenantId: 'tenant-a',
                    vnbId: 'SNB100',
                    missingKeys: ['eog.efficiency_value'],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const scope = this.buildScope(ctx.params);
        let missingKeys = asArray(ctx.params.missingKeys).map((item) => this.normalizeEogKey(item));

        if (!missingKeys.length) {
          const status = await ctx.call('eog-calculator.inputStatus', scope);
          missingKeys = status.missing.map((entry) => entry.key);
        }

        const items = [];
        for (const key of missingKeys) {
          if (!EOG_FIELDS[key]) continue;
          const descriptor = this.buildMissingDescriptor(key, scope);
          const hitlPayload = {
            ...descriptor,
            userChoices: DECISION_OPTIONS,
            acceptedInputForms: [
              'manual_confirmation',
              'document_upload_eog_notice',
              'document_upload_cost_review',
              'document_upload_regulatory_sheet',
            ],
            validationQuestions: [
              'Ist der Wert final beschieden?',
              'Ist der Wert nur Anhörungsstand?',
              'Für welche Regulierungsperiode gilt der Wert?',
              'Gilt der Wert für Strom oder Gas?',
              'Für welches Jahr gilt der Wert?',
            ],
          };

          const created = await ctx.call(
            'hitl.create',
            {
              kind: 'eog-missing-input',
              severity: 'warning',
              requiredScope: 'full-access',
              originService: 'eog-calculator',
              originAction: 'requestInput',
              payload: hitlPayload,
            },
            { meta: { tenantId: scope.tenantId } }
          );

          items.push({ key, hitlItem: created.item });
        }

        return {
          success: true,
          created: items.length,
          items,
        };
      },
    },

    getModel: {
      rest: 'GET /:tenantId/:vnbId',
      params: {
        tenantId: { type: 'string', min: 1 },
        vnbId: { type: 'string', min: 1 },
      },
      openapi: {
        summary: 'Get persisted EOG model (datapoints + decision events + provenance)',
        tags: [OPENAPI_TAG],
        parameters: [
          { name: 'tenantId', in: 'path', required: true, schema: { type: 'string', example: 'tenant-a' } },
          { name: 'vnbId', in: 'path', required: true, schema: { type: 'string', example: 'SNB100' } },
        ],
      },
      async handler(ctx) {
        const scope = this.buildScope(ctx.params);
        const datapoints = await this.loadScopedDatapoints(scope);
        const events = await this.loadDecisionEvents(scope);

        return {
          success: true,
          scope,
          datapoints: datapoints.map((doc) => this.toPublicDatapoint(doc)),
          decisions: events,
        };
      },
    },
  },

  methods: {
    buildScope(params) {
      return {
        tenantId: String(params.tenantId || '').trim(),
        vnbId: String(params.vnbId || '').trim(),
        periodYear: params.periodYear ? normalizeYear(params.periodYear) : null,
        sector: params.sector || null,
        regulatoryPeriod: params.regulatoryPeriod || null,
      };
    },

    normalizeEogKey(key) {
      const value = String(key || '').trim();
      return value.startsWith('eog.') ? value.slice(4) : value;
    },

    makeDatapointId(tenantId, vnbId, key, sector, periodYear, regulatoryPeriod) {
      const year = periodYear || 'na';
      const regPeriod = regulatoryPeriod || 'na';
      const sec = sector || 'na';
      return `${DOC_PREFIX_DP}${tenantId}:${vnbId}:${key}:${sec}:${year}:${regPeriod}`;
    },

    async getValidationSession(validationId) {
      try {
        return await this.db.get(`${DOC_PREFIX_VALIDATION}${validationId}`);
      } catch (error) {
        if (error.status === 404) {
          throw new MoleculerClientError(`Validation session '${validationId}' not found`, 404);
        }
        throw error;
      }
    },

    validateInputDatapoints(tenantId, vnbId, datapoints) {
      const errors = [];
      const warnings = [];
      const normalizedDatapoints = [];
      const seen = new Set();

      for (const raw of datapoints) {
        const key = this.normalizeEogKey(raw.key);
        const field = EOG_FIELDS[key];
        if (!field) {
          errors.push({
            code: 'UNSUPPORTED_KEY',
            key: raw.key,
            message: `Unsupported EOG datapoint key '${raw.key}'`,
          });
          continue;
        }

        const periodYear = normalizeYear(raw.periodYear);
        if (!periodYear) {
          errors.push({
            code: 'INVALID_YEAR',
            key,
            message: `Invalid periodYear for '${key}'. Expected integer between 2000 and 2100.`,
          });
          continue;
        }

        const sector = raw.sector;
        const dedupeId = [key, sector, periodYear, raw.regulatoryPeriod || 'na'].join('|');
        if (seen.has(dedupeId)) {
          errors.push({
            code: 'DUPLICATE_SCOPE',
            key,
            message: `Duplicate datapoint for scope ${dedupeId}.`,
          });
          continue;
        }
        seen.add(dedupeId);

        const expectedUnit = field.unit;
        const providedUnit = raw.unit || expectedUnit;
        if (providedUnit !== expectedUnit) {
          errors.push({
            code: 'UNIT_MISMATCH',
            key,
            message: `Unit mismatch for '${key}': expected '${expectedUnit}', got '${providedUnit}'.`,
          });
          continue;
        }

        const numericValue = toNumber(raw.value);
        if (field.type === 'number' && numericValue === null && raw.confidence !== 'missing') {
          errors.push({
            code: 'INVALID_VALUE',
            key,
            message: `Value for '${key}' must be numeric or explicitly marked as missing.`,
          });
          continue;
        }

        if (field.requiredForActual && raw.confidence === 'missing') {
          warnings.push({
            code: 'MISSING_REQUIRED_VALUE',
            key,
            message: field.blocker,
          });
        }

        const normalized = {
          tenantId,
          vnbId,
          key,
          value: numericValue,
          unit: expectedUnit,
          periodYear,
          sector,
          regulatoryPeriod: raw.regulatoryPeriod || null,
          source: raw.source,
          confidence: raw.confidence,
          provenance: raw.provenance || {},
          status: raw.status || 'final',
          createdAt: nowIso(),
          updatedAt: nowIso(),
          version: 1,
          type: 'eog-datapoint',
        };

        normalizedDatapoints.push(normalized);
      }

      const submittedKeys = new Set(normalizedDatapoints.map((item) => item.key));
      for (const required of REQUIRED_ACTUAL_KEYS) {
        if (!submittedKeys.has(required)) {
          warnings.push({
            code: 'MISSING_REQUIRED_INPUT',
            key: required,
            message: EOG_FIELDS[required].blocker,
          });
        }
      }

      const dataStatus = errors.length
        ? 'blocked'
        : warnings.length
          ? 'partial'
          : 'complete';

      return { errors, warnings, normalizedDatapoints, dataStatus };
    },

    async upsertEogDatapoint(datapoint) {
      const id = this.makeDatapointId(
        datapoint.tenantId,
        datapoint.vnbId,
        datapoint.key,
        datapoint.sector,
        datapoint.periodYear,
        datapoint.regulatoryPeriod
      );
      let doc;

      try {
        doc = await this.db.get(id);
      } catch (error) {
        if (error.status !== 404) throw error;
      }

      if (doc) {
        doc.value = datapoint.value;
        doc.source = datapoint.source;
        doc.confidence = datapoint.confidence;
        doc.provenance = datapoint.provenance;
        doc.status = datapoint.status;
        doc.updatedAt = nowIso();
        doc.version = Number(doc.version || 1) + 1;
      } else {
        doc = {
          _id: id,
          type: 'eog-datapoint',
          tenantId: datapoint.tenantId,
          vnbId: datapoint.vnbId,
          key: datapoint.key,
          value: datapoint.value,
          unit: datapoint.unit,
          periodYear: datapoint.periodYear,
          sector: datapoint.sector,
          regulatoryPeriod: datapoint.regulatoryPeriod,
          source: datapoint.source,
          confidence: datapoint.confidence,
          provenance: datapoint.provenance,
          status: datapoint.status,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          version: 1,
        };
      }

      const result = await this.db.put(doc);
      doc._rev = result.rev;
      return { id, doc };
    },

    async syncToDatapointService(ctx, upsertResult) {
      const doc = upsertResult.doc;
      const dpNameParts = [
        'eog',
        sanitizeForDatapointName(doc.tenantId),
        sanitizeForDatapointName(doc.vnbId),
        sanitizeForDatapointName(doc.key),
        String(doc.periodYear || 'na'),
        sanitizeForDatapointName(doc.sector || 'na'),
      ];
      const name = dpNameParts.join('-').slice(0, 64);

      const payload = {
        name,
        value: {
          value: doc.value,
          unit: doc.unit,
          periodYear: doc.periodYear,
          sector: doc.sector,
          regulatoryPeriod: doc.regulatoryPeriod,
          source: doc.source,
          confidence: doc.confidence,
          status: doc.status,
          provenance: doc.provenance,
          version: doc.version,
        },
        description: `EOG datapoint ${doc.key} (${doc.periodYear}/${doc.sector})`,
        owner: 'eog-calculator',
        tags: ['eog', doc.key, doc.sector, String(doc.periodYear)],
        provenance: 'eog-calculator.commit',
        metadata: {
          tenantId: doc.tenantId,
          vnbId: doc.vnbId,
          eogKey: doc.key,
        },
      };

      try {
        await ctx.call('datapoint.create', payload, { meta: { tenantId: doc.tenantId } });
      } catch (error) {
        if (error?.type !== 'DUPLICATE_NAME') throw error;
        await ctx.call('datapoint.remove', { name }, { meta: { tenantId: doc.tenantId } });
        await ctx.call('datapoint.create', payload, { meta: { tenantId: doc.tenantId } });
      }
    },

    async loadScopedDatapoints(scope) {
      const prefix = `${DOC_PREFIX_DP}${scope.tenantId}:${scope.vnbId}:`;
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: prefix,
        endkey: `${prefix}\ufff0`,
      });

      let docs = result.rows.map((row) => row.doc);
      if (scope.periodYear) docs = docs.filter((doc) => doc.periodYear === scope.periodYear);
      if (scope.sector) docs = docs.filter((doc) => doc.sector === scope.sector);
      if (scope.regulatoryPeriod) {
        docs = docs.filter((doc) => doc.regulatoryPeriod === scope.regulatoryPeriod);
      }
      return docs;
    },

    mapDatapointsByKey(datapoints) {
      const mapped = {};
      const sorted = [...datapoints].sort((a, b) => {
        const byYear = Number(b.periodYear || 0) - Number(a.periodYear || 0);
        if (byYear !== 0) return byYear;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });

      for (const datapoint of sorted) {
        if (!mapped[datapoint.key] || datapoint.scenarioOverride) {
          mapped[datapoint.key] = datapoint;
        }
      }
      return mapped;
    },

    computeDataStatus(missingRequiredCount, availableCount) {
      if (missingRequiredCount === 0) return 'complete';
      if (availableCount > 0) return 'partial';
      return 'blocked';
    },

    summarizeConfidence(datapoints) {
      const values = datapoints.map((item) => item.confidence).filter(Boolean);
      if (!values.length) return 'missing';
      if (values.includes('assumed')) return 'assumed';
      if (values.includes('missing')) return 'missing';
      if (values.includes('user_supplied')) return 'user_supplied';
      if (values.includes('confirmed')) return 'confirmed';
      return 'derived';
    },

    buildMissingDescriptor(key, scope) {
      return {
        key,
        typedKey: EOG_FIELDS[key].key,
        explanation: EOG_FIELDS[key].blocker,
        expectedType: EOG_FIELDS[key].type,
        expectedUnit: EOG_FIELDS[key].unit,
        periodYear: scope.periodYear,
        sector: scope.sector,
        regulatoryPeriod: scope.regulatoryPeriod,
        tenantId: scope.tenantId,
        vnbId: scope.vnbId,
        provenanceRequired: true,
      };
    },

    calculateInternal(datapoints, options) {
      const map = this.mapDatapointsByKey(datapoints);
      const missingRequired = REQUIRED_ACTUAL_KEYS.filter((key) => !map[key]);
      const blockers = missingRequired.map((key) => this.buildMissingDescriptor(key, options.scope));

      const values = {
        efficiencyValue: map.efficiency_value?.value,
        baseCostLevel: map.base_cost_level?.value,
        controllableCosts: map.controllable_costs?.value,
        permanentlyNonControllableCosts: map.permanently_non_controllable_costs?.value,
        temporarilyNonControllableCosts: map.temporarily_non_controllable_costs?.value,
        capexAdjustmentAddition: map.capex_adjustment_addition?.value || 0,
        capexAdjustmentDeduction: map.capex_adjustment_deduction?.value || 0,
        qualityElement: map.quality_element?.value || 0,
        regulatoryAccountBalance: map.regulatory_account_balance?.value || 0,
        volatileCosts: map.volatile_costs?.value || 0,
      };

      const steps = [];
      let computed = null;
      let adjusted = null;
      if (missingRequired.length === 0) {
        const efficiencyFactor = values.efficiencyValue > 1
          ? values.efficiencyValue / 100
          : values.efficiencyValue;
        const inefficiencyReduction = values.controllableCosts * (1 - efficiencyFactor);
        steps.push({
          step: 'inefficiency_reduction',
          formula: 'controllable_costs * (1 - efficiency_factor)',
          inputs: {
            controllable_costs: values.controllableCosts,
            efficiency_factor: efficiencyFactor,
          },
          result: inefficiencyReduction,
        });

        computed =
          values.baseCostLevel -
          inefficiencyReduction +
          values.permanentlyNonControllableCosts +
          values.temporarilyNonControllableCosts +
          values.capexAdjustmentAddition -
          values.capexAdjustmentDeduction +
          values.qualityElement +
          values.regulatoryAccountBalance +
          values.volatileCosts;

        adjusted = computed + values.regulatoryAccountBalance;

        steps.push({
          step: 'approved_revenue_cap_calculation',
          formula:
            'base - inefficiency + permanent + temporary + capex_add - capex_deduct + quality + regulatory_account + volatile',
          result: computed,
        });
        steps.push({
          step: 'adjusted_revenue_cap_calculation',
          formula: 'approved_revenue_cap + regulatory_account_balance',
          result: adjusted,
        });
      }

      const calibration = this.buildCalibrationResult(map, computed, adjusted);
      const dataStatus = this.computeDataStatus(missingRequired.length, datapoints.length);

      return {
        scope: options.scope,
        dataStatus,
        calculationMode: options.calculationMode,
        confidence: this.summarizeConfidence(datapoints),
        blockers,
        steps,
        results: {
          calculatedApprovedRevenueCap: computed,
          calculatedAdjustedRevenueCap: adjusted,
        },
        calibration,
      };
    },

    buildCalibrationResult(map, computedApproved, computedAdjusted) {
      const approvedAnchor = map.approved_revenue_cap?.value;
      const adjustedAnchor = map.adjusted_revenue_cap?.value;

      return {
        approvedRevenueCap: this.compareWithAnchor(approvedAnchor, computedApproved),
        adjustedRevenueCap: this.compareWithAnchor(adjustedAnchor, computedAdjusted),
      };
    },

    compareWithAnchor(anchorValue, computedValue) {
      if (anchorValue === undefined || anchorValue === null) {
        return {
          status: 'anchor_missing',
          anchor: null,
          computed: computedValue,
          delta: null,
          relativeDelta: null,
        };
      }
      if (computedValue === undefined || computedValue === null) {
        return {
          status: 'not_reproducible',
          anchor: anchorValue,
          computed: null,
          delta: null,
          relativeDelta: null,
        };
      }

      const delta = computedValue - anchorValue;
      const relativeDelta = anchorValue === 0 ? null : delta / anchorValue;
      const absDelta = Math.abs(delta);
      const rel = relativeDelta == null ? 0 : Math.abs(relativeDelta);
      const isMatch =
        absDelta <= this.settings.calibrationToleranceAbsolute ||
        rel <= this.settings.calibrationToleranceRelative;

      return {
        status: isMatch ? 'match' : 'deviation',
        anchor: anchorValue,
        computed: computedValue,
        delta,
        relativeDelta,
      };
    },

    async recordDecisionEvent(validationDoc, hitlConfirmation, details) {
      const timestamp = nowIso();
      const event = {
        _id: `${DOC_PREFIX_EVENT}${crypto.randomUUID()}`,
        type: 'eog-decision-event',
        tenantId: validationDoc.tenantId,
        vnbId: validationDoc.vnbId,
        validationId: validationDoc.validationId,
        hitlItemId: hitlConfirmation?.itemId || null,
        decision: hitlConfirmation?.decision || 'auto_commit',
        approved: Boolean(hitlConfirmation?.approved),
        actor: hitlConfirmation?.actor || 'system',
        comment: hitlConfirmation?.comment || null,
        context: {
          datapointCount: validationDoc.normalizedDatapoints.length,
          dataStatus: validationDoc.dataStatus,
        },
        details,
        createdAt: timestamp,
      };

      await this.db.put(event);
      return event;
    },

    async loadDecisionEvents(scope) {
      const result = await this.db.allDocs({
        include_docs: true,
        startkey: DOC_PREFIX_EVENT,
        endkey: `${DOC_PREFIX_EVENT}\ufff0`,
      });
      return result.rows
        .map((row) => row.doc)
        .filter((doc) => doc.tenantId === scope.tenantId && doc.vnbId === scope.vnbId)
        .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
        .map((doc) => ({
          id: String(doc._id).replace(DOC_PREFIX_EVENT, ''),
          decision: doc.decision,
          approved: doc.approved,
          actor: doc.actor,
          comment: doc.comment,
          validationId: doc.validationId,
          hitlItemId: doc.hitlItemId,
          details: doc.details,
          createdAt: doc.createdAt,
        }));
    },

    toPublicDatapoint(doc) {
      return {
        id: String(doc._id).replace(DOC_PREFIX_DP, ''),
        tenantId: doc.tenantId,
        vnbId: doc.vnbId,
        key: doc.key,
        typedKey: EOG_FIELDS[doc.key]?.key || `eog.${doc.key}`,
        value: doc.value,
        unit: doc.unit,
        periodYear: doc.periodYear,
        sector: doc.sector,
        regulatoryPeriod: doc.regulatoryPeriod,
        source: doc.source,
        confidence: doc.confidence,
        status: doc.status,
        provenance: doc.provenance,
        version: doc.version,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };
    },
  },
};
