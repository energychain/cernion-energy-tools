'use strict';

// dashboard-api actions chunk 3/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: energySharing42cCutoverReadinessStatus, evuApiMigrationDiagnosticsStatus, novaDecisionLifecycleReadinessStatus, regulatoryChangeReadinessStatus, investmentTwoTrackControlStatus, sapBudgetPspGateStatus, energyTaxInformationPackageStatus, investmentRiskTranslationStatus, budgetWaterfallGovernanceStatus, gasDecommissioningRoadmapStatus, jourFixeDecisionClosureStatus, offBalancingMeteringPruefmatrixStatus, automationRequirementsDecisionValueStatus, smartMeterOffBalancingPurposeLockStatus, imsysScheduleValueChainReadinessStatus, clsDigitalTwinComplianceGateStatus

const { OPENAPI_TAG } = require('./shared');

module.exports = {
  energySharing42cCutoverReadinessStatus: {
    rest: 'GET /energy-sharing-42c-cutover-readiness',
    params: {
      cutoverId: { type: 'string', optional: true, min: 1 },
      pilotTenantId: { type: 'string', optional: true, min: 1 },
      balanceGroupId: { type: 'string', optional: true, min: 1 },
      a96DefaultsStatus: { type: 'string', optional: true, min: 1 },
      specFreezeStatus: { type: 'string', optional: true, min: 1 },
      pilotTenantStatus: { type: 'string', optional: true, min: 1 },
      settlementHardeningStatus: { type: 'string', optional: true, min: 1 },
      allocationLoadTestStatus: { type: 'string', optional: true, min: 1 },
      runbookStatus: { type: 'string', optional: true, min: 1 },
      complianceSignoffStatus: { type: 'string', optional: true, min: 1 },
      rollbackPlanStatus: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      targetDate: { type: 'string', optional: true, min: 1 },
      evidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: '§42c cutover readiness - read-only dossier-safe status',
      description:
        'Evaluates supplied §42c cutover evidence across sub-tracks A-G and returns a dossier-safe readiness gate. ' +
        'The endpoint is read-only and does not provision tenants, migrate data, release A96 exports, execute allocation/settlement, create HITL tasks, run rollback/restore, call external connectors, handle secrets or mutate Personal Agent behavior.',
      parameters: [
        { name: 'cutoverId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'pilotTenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'balanceGroupId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'a96DefaultsStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'specFreezeStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'pilotTenantStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'settlementHardeningStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'allocationLoadTestStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'runbookStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'complianceSignoffStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'rollbackPlanStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetDate', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRefs',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only §42c cutover readiness status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  riskLevel: { type: 'string' },
                  readinessScore: { type: 'number' },
                  subTracks: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `energy-sharing-42c-cutover-readiness:${params.cutoverId || 'no-cutover'}:${params.pilotTenantId || 'no-tenant'}:${params.balanceGroupId || 'no-bg'}:${params.a96DefaultsStatus || ''}:${params.specFreezeStatus || ''}:${params.pilotTenantStatus || ''}:${params.settlementHardeningStatus || ''}:${params.allocationLoadTestStatus || ''}:${params.runbookStatus || ''}:${params.complianceSignoffStatus || ''}:${params.rollbackPlanStatus || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.energySharing42cCutoverReadinessStatus,
        async () => ({
          ...this.buildEnergySharing42cCutoverReadinessStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  evuApiMigrationDiagnosticsStatus: {
    rest: 'GET /evu-api-migration-diagnostics',
    params: {
      businessProcess: { type: 'string', optional: true, min: 1 },
      endpoint: { type: 'string', optional: true, min: 1 },
      method: { type: 'string', optional: true, min: 1 },
      authScope: { type: 'string', optional: true, min: 1 },
      dataContext: { type: 'string', optional: true, min: 1 },
      requestShape: { type: 'string', optional: true, min: 1 },
      validationError: { type: 'string', optional: true, min: 1 },
      responseCode: { type: 'string', optional: true, min: 1 },
      completionCriterion: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextStep: { type: 'string', optional: true, min: 1 },
      ticketRef: { type: 'string', optional: true, min: 1 },
      systemRef: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'EVU API migration diagnostics - read-only dossier-safe status',
      description:
        'Evaluates supplied EVU/VNB API migration observations as a read-only diagnostic matrix. ' +
        'The endpoint does not call live endpoints, run OAuth flows, handle secrets, execute JSON Patch, close third-party processes, create HITL tasks, or trigger MaKo/Billing/Settlement/Tariff actions.',
      parameters: [
        { name: 'businessProcess', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'endpoint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'method', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'authScope', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataContext', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'requestShape', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'validationError', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'responseCode', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'completionCriterion', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextStep', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ticketRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'systemRef', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only EVU API migration diagnostic status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  safety: { type: 'string' },
                  evidenceCompleteness: { type: 'number' },
                  missingEvidence: { type: 'array' },
                  diagnosticFindings: { type: 'array' },
                  riskHints: { type: 'array' },
                  next90DayStep: { type: 'string' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `evu-api-migration-diagnostics:${params.businessProcess || ''}:${params.endpoint || ''}:${params.method || ''}:${params.authScope || ''}:${params.dataContext || ''}:${params.requestShape || ''}:${params.validationError || ''}:${params.responseCode || ''}:${params.completionCriterion || ''}:${params.owner || ''}:${params.nextStep || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.evuApiMigrationDiagnosticsStatus,
        async () => ({
          ...this.buildEvuApiMigrationDiagnosticsStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  novaDecisionLifecycleReadinessStatus: {
    rest: 'GET /nova-decision-lifecycle-readiness',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      decisionKind: { type: 'string', optional: true, min: 1 },
      lifecycleModel: { type: 'string', optional: true, min: 1 },
      sourceCatalogue: { type: 'string', optional: true, min: 1 },
      auditTrail: { type: 'string', optional: true, min: 1 },
      tenantIsolationEvidence: { type: 'string', optional: true, min: 1 },
      hitlPolicyEvidence: { type: 'string', optional: true, min: 1 },
      replayEvidence: { type: 'string', optional: true, min: 1 },
      expiryEvidence: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      deadline: { type: 'string', optional: true, min: 1 },
      openMeasure: { type: 'string', optional: true, min: 1 },
      evidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'NOVA decision lifecycle readiness - read-only dossier-safe status',
      description:
        'Evaluates supplied NOVA decision-lifecycle evidence and returns a dossier-safe readiness gate. ' +
        'The endpoint is read-only and does not create decisions, transition lifecycle state, create HITL items, emit webhooks/SSE events, replay triggers, apply asset overrides, mutate MaStR/Redispatch/thresholds, call external connectors, handle secrets or mutate Personal Agent behavior.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionKind', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'lifecycleModel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceCatalogue', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'auditTrail', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'tenantIsolationEvidence',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'hitlPolicyEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'replayEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'expiryEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deadline', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'openMeasure', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRefs',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only NOVA decision lifecycle readiness status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  riskLevel: { type: 'string' },
                  readinessScore: { type: 'number' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `nova-decision-lifecycle-readiness:${params.caseId || 'no-case'}:${params.decisionKind || 'no-kind'}:${params.lifecycleModel || ''}:${params.sourceCatalogue || ''}:${params.auditTrail || ''}:${params.tenantIsolationEvidence || ''}:${params.hitlPolicyEvidence || ''}:${params.replayEvidence || ''}:${params.expiryEvidence || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.novaDecisionLifecycleReadinessStatus,
        async () => ({
          ...this.buildNovaDecisionLifecycleReadinessStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  regulatoryChangeReadinessStatus: {
    rest: 'GET /regulatory-change-readiness',
    params: {
      changeId: { type: 'string', optional: true, min: 1 },
      effectiveDate: { type: 'string', optional: true, min: 1 },
      mechanismType: { type: 'string', optional: true, min: 1 },
      affectedSystems: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      dictionaryVersion: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      intervalCoverage: { type: 'string', optional: true, min: 1 },
      masterDataStatus: { type: 'string', optional: true, min: 1 },
      substituteValuePolicy: { type: 'string', optional: true, min: 1 },
      makoCases: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      operatorDeclarationStatus: { type: 'string', optional: true, min: 1 },
      billingRuleReference: { type: 'string', optional: true, min: 1 },
      auditTrailStatus: { type: 'string', optional: true, min: 1 },
      testCasePackStatus: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Regulatory change readiness — read-only dossier-safe gate',
      description:
        'Builds a deterministic readiness/evidence contract for upcoming regulatory billing, EEG or ' +
        'refinancing mechanisms. The endpoint separates dictionary, datapoint, interval, master-data, ' +
        'substitute-value, MaKo, operator-declaration, billing-rule, audit and test-case evidence. It is ' +
        'read-only and does not run settlement, billing, MaKo dispatch, HITL, external connectors or legal interpretation.',
      parameters: [
        { name: 'changeId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'effectiveDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'mechanismType', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'affectedSystems',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        { name: 'dictionaryVersion', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'sourceDatapoints',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        { name: 'intervalCoverage', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'masterDataStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'substituteValuePolicy',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'makoCases',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        {
          name: 'operatorDeclarationStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'billingRuleReference',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'auditTrailStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'testCasePackStatus', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only regulatory change readiness status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  evidenceItems: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  generatedTestCaseRequirements: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  blockingFindings: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `regulatory-change-readiness:${params.changeId || 'no-change'}:${params.effectiveDate || 'no-date'}:${params.mechanismType || 'no-mechanism'}:${params.dictionaryVersion || 'no-dictionary'}:${params.intervalCoverage || 'no-interval'}:${params.masterDataStatus || 'no-masterdata'}:${params.substituteValuePolicy || 'no-substitute'}:${params.operatorDeclarationStatus || 'no-operator'}:${params.auditTrailStatus || 'no-audit'}:${params.testCasePackStatus || 'no-tests'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.regulatoryChangeReadinessStatus,
        async () => ({
          ...this.buildRegulatoryChangeReadinessStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  investmentTwoTrackControlStatus: {
    rest: 'GET /investment-two-track-control',
    params: {
      submissionId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      deadline: { type: 'string', optional: true, min: 1 },
      submissionFormat: { type: 'string', optional: true, min: 1 },
      tacticalOwner: { type: 'string', optional: true, min: 1 },
      targetOwner: { type: 'string', optional: true, min: 1 },
      financeReviewStatus: { type: 'string', optional: true, min: 1 },
      boardReadiness: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      approvalModel: { type: 'string', optional: true, min: 1 },
      handoverStatus: { type: 'string', optional: true, min: 1 },
      budgetEnvelopeEur: { type: 'number', optional: true, convert: true },
      measureCount: { type: 'number', optional: true, integer: true, convert: true, min: 0 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      blockedDecisions: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Investment two-track control — read-only dossier-safe status',
      description:
        'Builds a deterministic evidence/readiness view that separates tactical investment submission ' +
        'readiness from the target-process readiness track for Asset Management / ISO 55001 work. The ' +
        'endpoint is read-only and does not mutate Investment Planning, Finance, SAP/PSP, settlement, ' +
        'billing, MaKo, HITL, VDMI, external connector or Personal-Agent state.',
      parameters: [
        { name: 'submissionId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deadline', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'submissionFormat', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'tacticalOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'financeReviewStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'boardReadiness', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'approvalModel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'handoverStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'budgetEnvelopeEur', in: 'query', required: false, schema: { type: 'number' } },
        {
          name: 'measureCount',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 0 },
        },
        {
          name: 'sourceDatapoints',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        {
          name: 'blockedDecisions',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only investment two-track control status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  tacticalTrack: { type: 'object' },
                  targetTrack: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  blockedDecisions: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `investment-two-track-control:${params.submissionId || 'no-submission'}:${params.gridOperatorId || 'no-grid'}:${params.deadline || 'no-deadline'}:${params.tacticalOwner || 'no-tactical-owner'}:${params.targetOwner || 'no-target-owner'}:${params.financeReviewStatus || 'no-finance'}:${params.boardReadiness || 'no-board'}:${params.dataQualityStatus || 'no-data'}:${params.approvalModel || 'no-approval'}:${params.handoverStatus || 'no-handover'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.investmentTwoTrackControlStatus,
        async () => ({
          ...this.buildInvestmentTwoTrackControlStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  sapBudgetPspGateStatus: {
    rest: 'GET /sap-budget-psp-gate',
    params: {
      measureId: { type: 'string', optional: true, min: 1 },
      measureName: { type: 'string', optional: true, min: 1 },
      migrationWave: { type: 'string', optional: true, min: 1 },
      sapSystemRef: { type: 'string', optional: true, min: 1 },
      pspElementId: { type: 'string', optional: true, min: 1 },
      legacyInternalOrderId: { type: 'string', optional: true, min: 1 },
      assetBenefit: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      approvalStatus: { type: 'string', optional: true, min: 1 },
      financeGate: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      sourceSnapshotId: { type: 'string', optional: true, min: 1 },
      availableBudgetEur: { type: 'number', optional: true, convert: true },
      plannedValueEur: { type: 'number', optional: true, convert: true },
      committedValueEur: { type: 'number', optional: true, convert: true },
      pspCarryOverEur: { type: 'number', optional: true, convert: true },
      budgetOverhangEur: { type: 'number', optional: true, convert: true },
      priorityScore: { type: 'number', optional: true, convert: true },
      blockedDecisions: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'SAP Budget PSP Gate — read-only dossier-safe status',
      description:
        'Builds a deterministic SAP/PSP budget-gate evidence view for one investment measure. ' +
        'The endpoint is read-only and does not mutate SAP/PSP, Finance, investment workflow, ' +
        'billing, settlement, MaKo, HITL, VDMI, external connector or Personal-Agent state.',
      parameters: [
        { name: 'measureId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'measureName', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'migrationWave', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sapSystemRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'pspElementId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'legacyInternalOrderId',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'assetBenefit', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'approvalStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'financeGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceSnapshotId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'availableBudgetEur', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'plannedValueEur', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'committedValueEur', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'pspCarryOverEur', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'budgetOverhangEur', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'priorityScore', in: 'query', required: false, schema: { type: 'number' } },
        {
          name: 'blockedDecisions',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only SAP/PSP budget-gate status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  measureContext: { type: 'object' },
                  budgetEvidence: { type: 'object' },
                  gateEvidence: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  blockedDecisions: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `sap-budget-psp-gate:${params.measureId || 'no-measure'}:${params.migrationWave || 'no-wave'}:${params.sapSystemRef || 'no-sap'}:${params.pspElementId || 'no-psp'}:${params.ownerRole || 'no-owner'}:${params.approvalStatus || 'no-approval'}:${params.financeGate || 'no-finance'}:${params.dataQualityStatus || 'no-data'}:${params.sourceSnapshotId || 'no-snapshot'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.sapBudgetPspGateStatus,
        async () => ({
          ...this.buildSapBudgetPspGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  energyTaxInformationPackageStatus: {
    rest: 'GET /energy-tax-information-package',
    params: {
      packageId: { type: 'string', optional: true, min: 1 },
      dataSourceId: { type: 'string', optional: true, min: 1 },
      dictionaryVersion: { type: 'string', optional: true, min: 1 },
      period: { type: 'string', optional: true, min: 1 },
      periodStart: { type: 'string', optional: true, min: 1 },
      periodEnd: { type: 'string', optional: true, min: 1 },
      aggregationLogic: { type: 'string', optional: true, min: 1 },
      validationStatus: { type: 'string', optional: true, min: 1 },
      responsibleOwner: { type: 'string', optional: true, min: 1 },
      contactRole: { type: 'string', optional: true, min: 1 },
      sla: { type: 'string', optional: true, min: 1 },
      auditReference: { type: 'string', optional: true, min: 1 },
      handoverDecision: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      sourceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Energy Tax Information Package — read-only dossier-safe status',
      description:
        'Builds a deterministic evidence view for an Energiesteuer/Finance information package. ' +
        'The endpoint is read-only and does not calculate tax, approve packages, copy raw data, or mutate ' +
        'Finance, billing, settlement, MaKo, SAP, HITL, external connector or Personal-Agent state.',
      parameters: [
        { name: 'packageId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataSourceId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dictionaryVersion', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'period', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'periodStart', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'periodEnd', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'aggregationLogic', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'validationStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'responsibleOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'contactRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sla', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'auditReference', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'handoverDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'sourceRefs',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only energy-tax information-package status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  packageContext: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceEvidence: { type: 'object' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `energy-tax-information-package:${params.packageId || 'no-package'}:${params.dataSourceId || 'no-source'}:${params.dictionaryVersion || 'no-dictionary'}:${params.period || params.periodStart || 'no-period'}:${params.validationStatus || 'no-validation'}:${params.responsibleOwner || 'no-owner'}:${params.handoverDecision || 'no-decision'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.energyTaxInformationPackageStatus,
        async () => ({
          ...this.buildEnergyTaxInformationPackageStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  investmentRiskTranslationStatus: {
    rest: 'GET /investment-risk-translation',
    params: {
      sourceRef: { type: 'string', optional: true, min: 1 },
      sourceType: { type: 'string', optional: true, min: 1 },
      period: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      classification: { type: 'string', optional: true, min: 1 },
      financialImpact: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      assetImpact: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      decisionReadiness: { type: 'string', optional: true, min: 1 },
      blockedDecisionId: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
      sourceSnapshot: { type: 'string', optional: true, min: 1 },
      evidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      forbiddenAssumptions: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      budgetRef: { type: 'string', optional: true, min: 1 },
      riskRef: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Investment Risk Translation — read-only dossier-safe status',
      description:
        'Builds a deterministic evidence view for investment/risk translation material. ' +
        'The endpoint is read-only and does not create VDMI, HITL, Finance, Investment Planning, SAP/PSP, external connector or Personal-Agent side effects.',
      parameters: [
        { name: 'sourceRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'period', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'division', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'classification', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'financialImpact',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'number' }, { type: 'string' }] },
        },
        { name: 'assetImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionReadiness', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'blockedDecisionId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextAction', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceSnapshot', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRefs',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        { in: 'query', name: 'forbiddenAssumptions', schema: { type: 'string' } },
        { in: 'query', name: 'budgetRef', schema: { type: 'string' } },
        { in: 'query', name: 'riskRef', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only investment-risk translation status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  translationContext: { type: 'object' },
                  handoverContext: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `investment-risk-translation:${params.sourceRef || 'no-source'}:${params.sourceType || 'no-type'}:${params.period || 'no-period'}:${params.classification || 'no-class'}:${params.ownerRole || 'no-owner'}:${params.decisionReadiness || 'no-readiness'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.investmentRiskTranslationStatus,
        async () => ({
          ...this.buildInvestmentRiskTranslationStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  budgetWaterfallGovernanceStatus: {
    rest: 'GET /budget-waterfall-governance',
    params: {
      waterfallId: { type: 'string', optional: true, min: 1 },
      sourceId: { type: 'string', optional: true, min: 1 },
      period: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      baselineRef: { type: 'string', optional: true, min: 1 },
      forecastCutoff: { type: 'string', optional: true, min: 1 },
      carryoverLogic: { type: 'string', optional: true, min: 1 },
      signConvention: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      approvalStatus: { type: 'string', optional: true, min: 1 },
      followUpDecision: { type: 'string', optional: true, min: 1 },
      sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
      evidenceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Budget Waterfall Governance — read-only dossier-safe gate',
      description:
        'Builds a deterministic evidence view for budget-waterfall governance. ' +
        'The endpoint is read-only and does not create Finance, SAP/PSP, Investment Planning, settlement, billing, MaKo, HITL, external connector or Personal-Agent side effects.',
      parameters: [
        { name: 'waterfallId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'period', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'division', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'baselineRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'forecastCutoff', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'carryoverLogic', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'signConvention', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'approvalStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'followUpDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRef',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only budget-waterfall governance status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  waterfallContext: { type: 'object' },
                  governanceEvidence: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `budget-waterfall-governance:${params.waterfallId || params.sourceId || 'no-source'}:${params.period || 'no-period'}:${params.division || 'no-division'}:${params.baselineRef || 'no-baseline'}:${params.forecastCutoff || 'no-cutoff'}:${params.approvalStatus || 'no-approval'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.budgetWaterfallGovernanceStatus,
        async () => ({
          ...this.buildBudgetWaterfallGovernanceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  gasDecommissioningRoadmapStatus: {
    rest: 'GET /gas-decommissioning-roadmap',
    params: {
      roadmapId: { type: 'string', optional: true, min: 1 },
      currentPhase: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      assetRiskEvidence: { type: 'string', optional: true, min: 1 },
      dependencyMap: { type: 'string', optional: true, min: 1 },
      investmentImpactRef: { type: 'string', optional: true, min: 1 },
      committeeGateDate: { type: 'string', optional: true, min: 1 },
      executionHandoverOwner: { type: 'string', optional: true, min: 1 },
      nextDecisionGate: { type: 'string', optional: true, min: 1 },
      blocker: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
      evidenceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Gas Decommissioning Roadmap — read-only dossier-safe status',
      description:
        'Builds a deterministic evidence view for gas-network decommissioning roadmap readiness. ' +
        'The endpoint is read-only and does not create gas-transformation, finance, SAP, investment, HITL, external connector or Personal-Agent side effects.',
      parameters: [
        { name: 'roadmapId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'currentPhase', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetRiskEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dependencyMap', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'investmentImpactRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'committeeGateDate', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'executionHandoverOwner',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'nextDecisionGate', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'blocker',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRef',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only gas decommissioning roadmap status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  roadmapContext: { type: 'object' },
                  phaseEvidence: { type: 'object' },
                  dependencies: { type: 'object' },
                  blockers: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `gas-decommissioning-roadmap:${params.roadmapId || 'no-roadmap'}:${params.currentPhase || 'no-phase'}:${params.owner || 'no-owner'}:${params.dependencyMap || 'no-dependencies'}:${params.committeeGateDate || 'no-gate'}:${params.executionHandoverOwner || 'no-handover'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gasDecommissioningRoadmapStatus,
        async () => ({
          ...this.buildGasDecommissioningRoadmapStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  jourFixeDecisionClosureStatus: {
    rest: 'GET /jour-fixe-decision-closure',
    params: {
      topicId: { type: 'string', optional: true, min: 1 },
      topicTitle: { type: 'string', optional: true, min: 1 },
      jourFixeId: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      kpi: { type: 'string', optional: true, min: 1 },
      decisionCriterion: { type: 'string', optional: true, min: 1 },
      nextGate: { type: 'string', optional: true, min: 1 },
      closureStatus: { type: 'string', optional: true, min: 1 },
      closureProof: { type: 'string', optional: true, min: 1 },
      blockedFollowUpAction: { type: 'string', optional: true, min: 1 },
      sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
      evidenceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Jour-Fixe Decision Closure — read-only dossier-safe status',
      description:
        'Builds a deterministic evidence view for Jour-fixe topic closure. ' +
        'The endpoint is read-only and does not create meeting, VDMI, NOVA, HITL, external connector or Personal-Agent side effects.',
      parameters: [
        { name: 'topicId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'topicTitle', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'jourFixeId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'kpi', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionCriterion', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'closureStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'closureProof', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'blockedFollowUpAction',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRef',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only Jour-fixe decision closure status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  topic: { type: 'object' },
                  closureEvidence: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `jour-fixe-decision-closure:${params.topicId || params.topicTitle || 'no-topic'}:${params.jourFixeId || 'no-jf'}:${params.owner || 'no-owner'}:${params.closureStatus || 'no-status'}:${params.nextGate || 'no-gate'}:${params.closureProof || 'no-proof'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.jourFixeDecisionClosureStatus,
        async () => ({
          ...this.buildJourFixeDecisionClosureStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  offBalancingMeteringPruefmatrixStatus: {
    rest: 'GET /off-balancing-metering-pruefmatrix',
    params: {
      matrixId: { type: 'string', optional: true, min: 1 },
      meteringScope: { type: 'string', optional: true, min: 1 },
      financingModel: { type: 'string', optional: true, min: 1 },
      decisionOwner: { type: 'string', optional: true, min: 1 },
      committeeGate: { type: 'string', optional: true, min: 1 },
      capexOpexBaseline: { type: 'string', optional: true, min: 1 },
      eogEffectEvidence: { type: 'string', optional: true, min: 1 },
      regulatoryEffectEvidence: { type: 'string', optional: true, min: 1 },
      costRecognitionAssumption: { type: 'string', optional: true, min: 1 },
      financierConditions: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      interfaceRiskStatus: { type: 'string', optional: true, min: 1 },
      gridInvestmentSpaceProof: { type: 'string', optional: true, min: 1 },
      sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
      evidenceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Off-Balancing Metering Pruefmatrix — read-only dossier-safe gate',
      description:
        'Builds a deterministic evidence view for off-balancing metering option readiness. ' +
        'The endpoint is read-only and does not create finance, SAP, investment, settlement, billing, MaKo, HITL, external connector or Personal-Agent side effects.',
      parameters: [
        { name: 'matrixId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'meteringScope', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'financingModel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'committeeGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'capexOpexBaseline', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'eogEffectEvidence', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'regulatoryEffectEvidence',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'costRecognitionAssumption',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'financierConditions', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'interfaceRiskStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'gridInvestmentSpaceProof',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRef',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only off-balancing metering pruefmatrix status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  matrixContext: { type: 'object' },
                  financingEvidence: { type: 'object' },
                  gridInvestmentVerdict: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `off-balancing-metering:${params.matrixId || 'no-matrix'}:${params.meteringScope || 'no-scope'}:${params.financingModel || 'no-model'}:${params.decisionOwner || 'no-owner'}:${params.gridInvestmentSpaceProof || 'no-grid-proof'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.offBalancingMeteringPruefmatrixStatus,
        async () => ({
          ...this.buildOffBalancingMeteringPruefmatrixStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  automationRequirementsDecisionValueStatus: {
    rest: 'GET /automation-requirements-decision-value',
    params: {
      requirementId: { type: 'string', optional: true, min: 1 },
      requestTitle: { type: 'string', optional: true, min: 1 },
      requestType: { type: 'string', optional: true, min: 1 },
      processArea: { type: 'string', optional: true, min: 1 },
      decisionOwner: { type: 'string', optional: true, min: 1 },
      targetGate: { type: 'string', optional: true, min: 1 },
      sourceSystem: { type: 'string', optional: true, min: 1 },
      movingDataFlow: { type: 'string', optional: true, min: 1 },
      manualEffort: { type: 'string', optional: true, min: 1 },
      controlPoint: { type: 'string', optional: true, min: 1 },
      decisionValue: { type: 'string', optional: true, min: 1 },
      followUpProcess: { type: 'string', optional: true, min: 1 },
      dataQuality: { type: 'string', optional: true, min: 1 },
      rollbackOrStopCriterion: { type: 'string', optional: true, min: 1 },
      sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
      evidenceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Automation Requirements Decision Value — read-only dossier-safe gate',
      description:
        'Builds a deterministic evidence view for automation, dashboard, PowerBI or workflow wishes. ' +
        'The endpoint is read-only and does not create Office/BI workflows, tickets, HITL items, VDMI mutations, external connectors or production side effects.',
      parameters: [
        { name: 'requirementId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'requestTitle', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'requestType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'processArea', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceSystem', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'movingDataFlow', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'manualEffort', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'controlPoint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionValue', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'followUpProcess', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataQuality', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'rollbackOrStopCriterion',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'sourceSnapshotRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRef',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only automation requirements decision-value status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  requirementContext: { type: 'object' },
                  decisionEvidence: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `automation-requirements:${params.requirementId || 'no-id'}:${params.requestTitle || 'no-title'}:${params.requestType || 'no-type'}:${params.processArea || 'no-area'}:${params.decisionValue || 'no-value'}:${params.followUpProcess || 'no-follow-up'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.automationRequirementsDecisionValueStatus,
        async () => ({
          ...this.buildAutomationRequirementsDecisionValueStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  smartMeterOffBalancingPurposeLockStatus: {
    rest: 'GET /smart-meter-off-balancing-purpose-lock',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      assetScope: { type: 'string', optional: true, min: 1 },
      financingModel: { type: 'string', optional: true, min: 1 },
      offBalanceVolumeEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      freedLiquidityEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      financierCostEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      capexOpexTotexEffect: { type: 'string', optional: true, min: 1 },
      regulatoryRecognitionStatus: { type: 'string', optional: true, min: 1 },
      purposeLockedMeasures: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      controlRoomInvestments: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      processInvestments: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      gridInfrastructureInvestments: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      budgetDilutionRisk: { type: 'string', optional: true, min: 1 },
      financeReviewStatus: { type: 'string', optional: true, min: 1 },
      sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
      evidenceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Smart Meter Off-Balancing Purpose Lock — read-only dossier-safe gate',
      description:
        'Builds a deterministic evidence view for smart-meter off-balancing purpose-lock readiness. ' +
        'The endpoint is read-only and does not create finance, SAP, investment, billing, settlement, MaKo, HITL, external connector or Personal-Agent side effects.',
      responses: {
        200: {
          description: 'Read-only smart-meter off-balancing purpose-lock status',
        },
      },

      parameters: [
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'assetScope', schema: { type: 'string' } },
        { in: 'query', name: 'financingModel', schema: { type: 'string' } },
        { in: 'query', name: 'offBalanceVolumeEur', schema: { type: 'string' } },
        { in: 'query', name: 'freedLiquidityEur', schema: { type: 'string' } },
        { in: 'query', name: 'financierCostEur', schema: { type: 'string' } },
        { in: 'query', name: 'capexOpexTotexEffect', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryRecognitionStatus', schema: { type: 'string' } },
        { in: 'query', name: 'purposeLockedMeasures', schema: { type: 'string' } },
        { in: 'query', name: 'controlRoomInvestments', schema: { type: 'string' } },
        { in: 'query', name: 'processInvestments', schema: { type: 'string' } },
        { in: 'query', name: 'gridInfrastructureInvestments', schema: { type: 'string' } },
        { in: 'query', name: 'budgetDilutionRisk', schema: { type: 'string' } },
        { in: 'query', name: 'financeReviewStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSnapshotRef', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `smart-meter-purpose-lock:${params.caseId || 'no-case'}:${params.assetScope || 'no-asset'}:${params.financingModel || 'no-model'}:${params.financeReviewStatus || 'no-review'}:${params.budgetDilutionRisk || 'no-dilution'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.smartMeterOffBalancingPurposeLockStatus,
        async () => ({
          ...this.buildSmartMeterOffBalancingPurposeLockStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  imsysScheduleValueChainReadinessStatus: {
    rest: 'GET /imsys-schedule-value-chain-readiness',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      meteringScope: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      forecastWindow: { type: 'string', optional: true, min: 1 },
      congestionSignal: { type: 'string', optional: true, min: 1 },
      assetScope: { type: 'string', optional: true, min: 1 },
      controllabilityStatus: { type: 'string', optional: true, min: 1 },
      flexibilityOptions: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      netzfahrplanAssessmentRef: { type: 'string', optional: true, min: 1 },
      operationalDecision: { type: 'string', optional: true, min: 1 },
      controlReadiness: { type: 'string', optional: true, min: 1 },
      lineOwnerRole: { type: 'string', optional: true, min: 1 },
      sourceSnapshotRef: { type: 'string', optional: true, min: 1 },
      evidenceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'iMSys schedule value-chain readiness — read-only dossier-safe gate',
      description:
        'Builds a deterministic evidence view for iMSys/CLS schedule value-chain readiness. ' +
        'The endpoint is read-only and does not execute device control, grid operations, HITL, MaKo, billing, settlement, external connector or Personal-Agent actions.',
      responses: {
        200: {
          description: 'Read-only iMSys schedule value-chain readiness status',
        },
      },

      parameters: [
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'meteringScope', schema: { type: 'string' } },
        { in: 'query', name: 'sourceDatapoints', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'forecastWindow', schema: { type: 'string' } },
        { in: 'query', name: 'congestionSignal', schema: { type: 'string' } },
        { in: 'query', name: 'assetScope', schema: { type: 'string' } },
        { in: 'query', name: 'controllabilityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'flexibilityOptions', schema: { type: 'string' } },
        { in: 'query', name: 'netzfahrplanAssessmentRef', schema: { type: 'string' } },
        { in: 'query', name: 'operationalDecision', schema: { type: 'string' } },
        { in: 'query', name: 'controlReadiness', schema: { type: 'string' } },
        { in: 'query', name: 'lineOwnerRole', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSnapshotRef', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `imsys-schedule:${params.caseId || 'no-case'}:${params.meteringScope || 'no-scope'}:${params.forecastWindow || 'no-forecast'}:${params.assetScope || 'no-asset'}:${params.controlReadiness || 'no-control'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.imsysScheduleValueChainReadinessStatus,
        async () => ({
          ...this.buildImsysScheduleValueChainReadinessStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  clsDigitalTwinComplianceGateStatus: {
    rest: 'GET /cls-digital-twin-compliance-gate',
    params: {
      procurementId: { type: 'string', optional: true, min: 1 },
      vendorId: { type: 'string', optional: true, min: 1 },
      systemPurpose: { type: 'string', optional: true, min: 1 },
      digitalTwinScope: { type: 'string', optional: true, min: 1 },
      clsInterfaceScope: { type: 'string', optional: true, min: 1 },
      dataFlowMap: { type: 'string', optional: true, min: 1 },
      personalDataCategories: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      rolesAccessRights: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      rbacRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      avvStatus: { type: 'string', optional: true, min: 1 },
      ndaStatus: { type: 'string', optional: true, min: 1 },
      worksCouncilStatus: { type: 'string', optional: true, min: 1 },
      dsfaStatus: { type: 'string', optional: true, min: 1 },
      billingModuleImpact: { type: 'string', optional: true, min: 1 },
      regulatoryEvidenceStatus: { type: 'string', optional: true, min: 1 },
      securityEvidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      approvalStatus: { type: 'string', optional: true, min: 1 },
      sourceEvidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceSnapshot: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'CLS Digital Twin Compliance Gate — read-only dossier-safe status',
      description:
        'Builds a deterministic evidence view for CLS/digital-twin procurement readiness. ' +
        'The endpoint is read-only and does not create procurement, legal, DSFA, RBAC, HITL, billing, settlement, MaKo, CLS, SMGW, device-control, external connector or Personal-Agent side effects.',
      responses: {
        200: {
          description: 'Read-only CLS digital-twin compliance gate status',
        },
      },

      parameters: [
        { in: 'query', name: 'procurementId', schema: { type: 'string' } },
        { in: 'query', name: 'vendorId', schema: { type: 'string' } },
        { in: 'query', name: 'systemPurpose', schema: { type: 'string' } },
        { in: 'query', name: 'digitalTwinScope', schema: { type: 'string' } },
        { in: 'query', name: 'clsInterfaceScope', schema: { type: 'string' } },
        { in: 'query', name: 'dataFlowMap', schema: { type: 'string' } },
        { in: 'query', name: 'personalDataCategories', schema: { type: 'string' } },
        { in: 'query', name: 'rolesAccessRights', schema: { type: 'string' } },
        { in: 'query', name: 'rbacRefs', schema: { type: 'string' } },
        { in: 'query', name: 'avvStatus', schema: { type: 'string' } },
        { in: 'query', name: 'ndaStatus', schema: { type: 'string' } },
        { in: 'query', name: 'worksCouncilStatus', schema: { type: 'string' } },
        { in: 'query', name: 'dsfaStatus', schema: { type: 'string' } },
        { in: 'query', name: 'billingModuleImpact', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryEvidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'securityEvidenceRefs', schema: { type: 'string' } },
        { in: 'query', name: 'approvalStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourceEvidenceRefs', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSnapshot', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `cls-digital-twin-compliance:${params.procurementId || 'no-procurement'}:${params.vendorId || 'no-vendor'}:${params.systemPurpose || 'no-purpose'}:${params.dataFlowMap || 'no-data-flow'}:${params.approvalStatus || 'no-approval'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.clsDigitalTwinComplianceGateStatus,
        async () => ({
          ...this.buildClsDigitalTwinComplianceGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },
};
