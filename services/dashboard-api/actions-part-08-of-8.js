'use strict';

// dashboard-api actions chunk 8/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: gasGridTransformationAssetCockpitStatus, liveUpdateStreamContractStatus, smgwConnectorReadinessStatus, vnbSpecialTopicWorkstateStatus, monitoringNonEscalationStatus, leadershipDeltaCockpitStatus, netzsignalDeltaGatingStatus, vnbDeltaSignalClassifierStatus, evidenceFreshnessGuardStatus, municipalEnergyValueAnalysisStatus, marketSnapshot, qualitySummary, observabilityMini, findingCodes, modelViabilityEvidenceGateStatus

const {
  FINDING_CODE_METADATA,
  OPENAPI_TAG,
  ACTION_MQ_LIST,
  ACTION_RD_LIST,
  ACTION_ES_LIST,
  ACTION_GC_LIST,
  ACTION_VDMI_LIST,
  ACTION_VDMI_FINDINGS,
  stringQueryParam,
} = require('./shared');

module.exports = {
  gasGridTransformationAssetCockpitStatus: {
    rest: 'GET /gas-grid-transformation-asset-cockpit',
    params: {
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      transformationProgramId: { type: 'string', optional: true, min: 1 },
      workPackageId: { type: 'string', optional: true, min: 1 },
      assetSegmentRef: { type: 'string', optional: true, min: 1 },
      targetOption: { type: 'string', optional: true, min: 1 },
      technicalReuseStatus: { type: 'string', optional: true, min: 1 },
      decommissioningCostEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'number' }],
      },
      rollbackOrRemovalRisk: { type: 'string', optional: true, min: 1 },
      cashflowImpact: { type: 'string', optional: true, min: 1 },
      totexImpact: { type: 'string', optional: true, min: 1 },
      regulatoryRecognitionStatus: { type: 'string', optional: true, min: 1 },
      heatNetworkDependency: { type: 'string', optional: true, min: 1 },
      powerGridDependency: { type: 'string', optional: true, min: 1 },
      customerTransitionDependency: { type: 'string', optional: true, min: 1 },
      decisionGate: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      vdmiProcessId: { type: 'string', optional: true, min: 1 },
      investmentPlanId: { type: 'string', optional: true, min: 1 },
      financeAnalysisId: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      sourceActions: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Gas grid transformation asset cockpit -- read-only evidence gate',
      description:
        'Returns a deterministic dossier-safe view over gas transformation program/work-package identity, asset segment, H2/decommissioning/repurpose option, technical reuse, rollback/removal cost, financial and dependency evidence, decision gate, owner role, missing evidence and explicit non-actions. The endpoint is read-only and never mutates gas assets, approves finance/investment decisions, creates HITL/VDMI tasks, runs MaKo/billing/settlement/tariff flows, or calls external connectors.',
      parameters: [
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'transformationProgramId',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'workPackageId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetSegmentRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetOption', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'technicalReuseStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'decommissioningCostEur',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'rollbackOrRemovalRisk',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'cashflowImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'totexImpact', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'regulatoryRecognitionStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'heatNetworkDependency',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'powerGridDependency', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'customerTransitionDependency',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'decisionGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceDatapoints', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'vdmiProcessId', schema: { type: 'string' } },
        { in: 'query', name: 'investmentPlanId', schema: { type: 'string' } },
        { in: 'query', name: 'financeAnalysisId', schema: { type: 'string' } },
        { in: 'query', name: 'sourceActions', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only gas grid transformation asset evidence view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  programSummary: { type: 'object' },
                  evidenceGroups: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  nextActions: { type: 'array' },
                  sourceDatapoints: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `gas-grid-transformation-asset-cockpit:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gasGridTransformationAssetCockpitStatus,
        async () => ({
          ...this.buildGasGridTransformationAssetCockpitStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  liveUpdateStreamContractStatus: {
    rest: 'GET /live-update-stream-contract',
    params: {
      domains: { type: 'multi', optional: true, rules: [{ type: 'string' }, { type: 'array' }] },
      channels: { type: 'multi', optional: true, rules: [{ type: 'string' }, { type: 'array' }] },
      sourceService: { type: 'string', optional: true, min: 1 },
      sourceAction: { type: 'string', optional: true, min: 1 },
      uiSurface: { type: 'string', optional: true, min: 1 },
      authBoundary: { type: 'string', optional: true, min: 1 },
      requiresResume: { type: 'boolean', optional: true, convert: true },
      fallbackPollingPath: { type: 'string', optional: true, min: 1 },
      heartbeatSeconds: { type: 'number', optional: true, convert: true, min: 1, max: 3600 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      availability: { type: 'string', optional: true, min: 1 },
      includeUnsupportedSample: { type: 'boolean', optional: true, convert: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Live update stream contract -- read-only readiness evidence',
      description:
        'Returns a deterministic read-only contract/readiness view for proposed UI live-update channels. The endpoint describes stream kind, tenant/auth boundary, source service/action, current availability, fallback polling path, heartbeat/resume expectation, owner, blockers, gaps and side-effect guards. It does not open SSE/WebSocket connections, subscribe to channels, emit events, create auth modes, call external connectors, mutate domain state or add Personal-Agent shortcuts.',
      parameters: [
        { name: 'domains', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'channels', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceService', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceAction', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'uiSurface', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'authBoundary', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'requiresResume', in: 'query', required: false, schema: { type: 'boolean' } },
        { name: 'fallbackPollingPath', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'heartbeatSeconds', in: 'query', required: false, schema: { type: 'number' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'availability', schema: { type: 'string' } },
        { in: 'query', name: 'includeUnsupportedSample', schema: { type: 'boolean' } },
      ],
      responses: {
        200: {
          description: 'Read-only live-update contract readiness view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  channelCount: { type: 'number' },
                  channels: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  _errors: { type: 'array' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `live-update-stream-contract:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.liveUpdateStreamContractStatus,
        async () => ({
          ...this.buildLiveUpdateStreamContractStatus(params),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  smgwConnectorReadinessStatus: {
    rest: 'GET /smgw-connector-readiness',
    params: {
      integrationScope: { type: 'string', optional: true, min: 1 },
      gatewayClass: { type: 'string', optional: true, min: 1 },
      adapterClass: { type: 'string', optional: true, min: 1 },
      controlDomainIntent: { type: 'string', optional: true, min: 1 },
      nes2ModuleEvidence: { type: 'string', optional: true, min: 1 },
      eebusEvidence: { type: 'string', optional: true, min: 1 },
      tafEvidence: { type: 'string', optional: true, min: 1 },
      auditPrerequisites: { type: 'string', optional: true, min: 1 },
      authBoundary: { type: 'string', optional: true, min: 1 },
      tenantBoundary: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      fallbackReason: { type: 'string', optional: true, min: 1 },
      blocker: { type: 'multi', optional: true, rules: [{ type: 'string' }, { type: 'array' }] },
      evidenceHints: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'SMGW connector readiness -- read-only evidence/status gate',
      description:
        'Returns a deterministic read-only readiness/evidence view for a planned §14a SMGW / NES2 / EEBUS connector path. The endpoint reports integration scope, tenant/auth boundary, adapter class, control-domain intent, NES2 and EEBUS/TAF evidence, compliance/audit prerequisites, blockers, missing evidence, positive follow-ups and explicit side-effect guards. It does not pair gateways, register devices, dispatch TAF-7, publish MQTT, bridge EEBUS, create HITL work, call external adapters, manage secrets, mutate tariffs/billing, or add Personal-Agent shortcuts.',
      parameters: [
        { name: 'integrationScope', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'gatewayClass', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'adapterClass', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'controlDomainIntent', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nes2ModuleEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'eebusEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'tafEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'auditPrerequisites', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'authBoundary', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'tenantBoundary', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'fallbackReason', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'blocker', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceHints', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only SMGW connector readiness evidence view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  connectorReadiness: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  blockers: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  _errors: { type: 'array' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `smgw-connector-readiness:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.smgwConnectorReadinessStatus,
        async () => ({
          ...this.buildSmgwConnectorReadinessStatus(params),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  vnbSpecialTopicWorkstateStatus: {
    rest: 'GET /vnb-special-topic-workstate',
    params: {
      topicId: { type: 'string', optional: true, min: 1 },
      topicName: { type: 'string', optional: true, min: 1 },
      domain: { type: 'string', optional: true, min: 1 },
      leadingSource: { type: 'string', optional: true, min: 1 },
      leadingSourceTimestamp: { type: 'string', optional: true, min: 1 },
      leadingSourceVersion: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      accountableRole: { type: 'string', optional: true, min: 1 },
      allowedSideSources: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      sideSourceFreshness: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      allowSideSourceOverride: { type: 'boolean', optional: true, convert: true },
      freshnessThresholdDays: { type: 'number', optional: true, convert: true, min: 1, max: 365 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'VNB special-topic leading work state -- read-only evidence card',
      description:
        'Returns a deterministic dossier-safe evidence card for the leading work state of VNB special topics. ' +
        'It surfaces leading source, source timestamp/version, owner/accountable role, allowed side sources, stale markers, missing evidence, readiness status and positive follow-ups. ' +
        'The endpoint is read-only and does not call SharePoint/Teams/Outlook, create tasks, send mail, execute workflows, mutate Cernion data, run HITL, edit Budibase or use Personal-Agent shortcuts.',
      parameters: [
        { name: 'topicId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'topicName', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'domain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'leadingSource', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'leadingSourceTimestamp',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'leadingSourceVersion',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'accountableRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'allowedSideSources', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sideSourceFreshness', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'allowSideSourceOverride',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'freshnessThresholdDays',
          in: 'query',
          required: false,
          schema: { type: 'number' },
        },
      ],
      responses: {
        200: {
          description: 'Read-only VNB special-topic work-state evidence card',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  topic: { type: 'object' },
                  sourceFreshness: { type: 'object' },
                  allowedSideSources: { type: 'array' },
                  staleMarkers: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `vnb-special-topic-workstate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.vnbSpecialTopicWorkstateStatus,
        async () => ({
          ...this.buildVnbSpecialTopicWorkstateStatus(params),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  monitoringNonEscalationStatus: {
    rest: 'GET /monitoring-non-escalation',
    params: {
      signalId: { type: 'string', optional: true, min: 1 },
      domain: { type: 'string', optional: true, min: 1 },
      assetContext: { type: 'string', optional: true, min: 1 },
      sourceName: { type: 'string', optional: true, min: 1 },
      sourceCheckedAt: { type: 'string', optional: true, min: 1 },
      novelty: { type: 'string', optional: true, min: 1 },
      blockingFinding: { type: 'string', optional: true, min: 1 },
      nextCheckAt: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      rationale: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Monitoring non-escalation evidence -- read-only status card',
      description:
        'Returns deterministic dossier-safe evidence for a justified non-escalation in recurring VNB monitoring. ' +
        'The endpoint surfaces checked source, novelty, absent blocker, next check, owner, rationale, missing evidence and positive follow-ups. ' +
        'It is read-only and does not schedule monitoring, escalate, create HITL tickets, send mail/webhooks, call external connectors, mutate Cernion data, edit Budibase or use Personal-Agent shortcuts.',
      parameters: [
        { name: 'signalId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'domain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetContext', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceName', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceCheckedAt', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'novelty', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'blockingFinding', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextCheckAt', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'rationale', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only monitoring non-escalation evidence card',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  signal: { type: 'object' },
                  checkedSource: { type: 'object' },
                  absentBlocker: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `monitoring-non-escalation:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.monitoringNonEscalationStatus,
        async () => ({
          ...this.buildMonitoringNonEscalationStatus(params),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  leadershipDeltaCockpitStatus: {
    rest: 'GET /leadership-delta-cockpit',
    params: {
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      bdewCode: { type: 'string', optional: true, min: 1 },
      topicId: { type: 'string', optional: true, min: 1 },
      topic: { type: 'string', optional: true, min: 1 },
      domain: { type: 'string', optional: true, min: 1 },
      role: { type: 'string', optional: true, min: 1 },
      status: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      dueAt: { type: 'string', optional: true, min: 1 },
      dueBefore: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      escalationState: { type: 'string', optional: true, min: 1 },
      nextLever: { type: 'string', optional: true, min: 1 },
      knownBaseline: { type: 'string', optional: true, min: 1 },
      newSignals: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      linkedEntities: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      sourceSignals: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      includeDegradedSample: { type: 'boolean', optional: true, convert: true },
      limit: { type: 'number', optional: true, convert: true, min: 1, max: 50 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Leadership delta cockpit -- read-only management evidence aggregation',
      description:
        'Returns a deterministic read-only status/evidence view for recurring leadership topics. The endpoint surfaces delta summary, owner/deadline, evidence status, blocked decisions, escalation state, next lever, linked entities, source signals, positive follow-ups and degraded-source errors. It does not create HITL/NOVA/VDMI tasks, approvals, escalations, MS365 syncs, external calls, billing/settlement/tariff/MaKo actions, or Personal-Agent shortcuts.',
      parameters: [
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'bdewCode', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'topic', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'domain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueAt', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'blockedDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'escalationState', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextLever', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'newSignals', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'topicId', schema: { type: 'string' } },
        { in: 'query', name: 'role', schema: { type: 'string' } },
        { in: 'query', name: 'status', schema: { type: 'string' } },
        { in: 'query', name: 'dueBefore', schema: { type: 'string' } },
        { in: 'query', name: 'knownBaseline', schema: { type: 'string' } },
        { in: 'query', name: 'linkedEntities', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSignals', schema: { type: 'string' } },
        { in: 'query', name: 'includeDegradedSample', schema: { type: 'boolean' } },
        { in: 'query', name: 'limit', schema: { type: 'number' } },
      ],
      responses: {
        200: {
          description: 'Read-only leadership delta cockpit evidence view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  topicCount: { type: 'number' },
                  statusDistribution: { type: 'object' },
                  topics: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  _errors: { type: 'array' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `leadership-delta-cockpit:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.leadershipDeltaCockpitStatus,
        async () => ({
          ...this.buildLeadershipDeltaCockpitStatus(params),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  netzsignalDeltaGatingStatus: {
    rest: 'GET /netzsignal-delta-gating',
    params: {
      signalId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      domain: { type: 'string', optional: true, min: 1 },
      signalType: { type: 'string', optional: true, min: 1 },
      knownContextRef: { type: 'string', optional: true, min: 1 },
      freshnessProof: { type: 'string', optional: true, min: 1 },
      decisionTopic: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      materiality: { type: 'string', optional: true, min: 1 },
      newFact: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      nextEvidencePoint: { type: 'string', optional: true, min: 1 },
      regulatoryReference: { type: 'string', optional: true, min: 1 },
      assetReference: { type: 'string', optional: true, min: 1 },
      revenueImpactHint: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Netzsignal Delta-Gating — read-only evidence classification',
      description:
        'Classifies caller-supplied operational signal metadata into known context, freshness-only, ' +
        'decision-delta, new-blocker or insufficient-evidence states. The endpoint is read-only and ' +
        'does not ingest Outlook, Teams, monitoring, ticket, HITL, MaKo, billing, settlement, tariff, ' +
        'device-control, Budibase or external connector data.',
      parameters: [
        { name: 'signalId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'domain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'signalType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'knownContextRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'freshnessProof', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionTopic', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'materiality', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'newFact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'blockedDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextEvidencePoint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'regulatoryReference', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetReference', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'revenueImpactHint', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Netzsignal delta-gating status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  classification: { type: 'string' },
                  escalationRecommendation: { type: 'string' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `netzsignal-delta-gating:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.netzsignalDeltaGatingStatus,
        async () => ({
          ...this.buildNetzsignalDeltaGatingStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  vnbDeltaSignalClassifierStatus: {
    rest: 'POST /vnb-delta-signal-classifier/classify',
    params: {
      signalId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      sourceType: { type: 'string', optional: true, min: 1 },
      receivedAt: { type: 'string', optional: true, min: 1 },
      subject: { type: 'string', optional: true, min: 1, max: 500 },
      bodyExcerpt: { type: 'string', optional: true, min: 1, max: 4000 },
      knownContextAnchors: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      processHint: { type: 'string', optional: true, min: 1 },
      ownerHint: { type: 'string', optional: true, min: 1 },
      dueDateHint: { type: 'string', optional: true, min: 1 },
      blockedDecisionHint: { type: 'string', optional: true, min: 1 },
      nextEvidenceHint: { type: 'string', optional: true, min: 1 },
      signals: { type: 'array', optional: true, max: 10 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'VNB delta signal classifier -- read-only advisory evidence',
      description:
        'Classifies caller-supplied synthetic or sanitized VNB/EVU leadership signals into deterministic dossier-safe rows for novelty, decision relevance, process, owner, deadline, blocked decision, next evidence point, confidence and missing evidence. It does not read mail, Teams, calendars, task systems or private inboxes; does not persist message bodies; and does not create tickets, notifications, HITL tasks, billing, settlement, MaKo, tariff or device-control side effects.',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
      responses: {
        200: {
          description: 'Read-only VNB delta signal classification',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  classifications: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `vnb-delta-signal-classifier:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.vnbDeltaSignalClassifierStatus,
        async () => ({
          ...this.buildVnbDeltaSignalClassifierStatus(params),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  evidenceFreshnessGuardStatus: {
    rest: 'GET /evidence-freshness-guard',
    params: {
      signalId: { type: 'string', optional: true, min: 1 },
      sourceKind: { type: 'string', optional: true, min: 1 },
      sourceTimestamp: { type: 'string', optional: true, min: 1 },
      receivedTimestamp: { type: 'string', optional: true, min: 1 },
      lastSeenTimestamp: { type: 'string', optional: true, min: 1 },
      processArea: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      knownSnapshotId: { type: 'string', optional: true, min: 1 },
      knownSnapshotHash: { type: 'string', optional: true, min: 1 },
      currentSnapshotId: { type: 'string', optional: true, min: 1 },
      currentSnapshotHash: { type: 'string', optional: true, min: 1 },
      severityHint: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      escalationThresholdDays: {
        type: 'number',
        optional: true,
        convert: true,
        min: 0,
        max: 365,
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Evidence freshness guard -- read-only VNB signal metadata classification',
      description:
        'Classifies caller-supplied operational signal metadata into dossier-safe freshness and delta states. The endpoint returns staleness, known-anchor, new-delta, escalation recommendation, non-escalation reason, evidence gaps and positive follow-ups. It does not ingest email, Teams, calendar, monitoring or task data; does not create ACF cards, HITL tasks, tickets, workflow actions, billing/settlement/tariff/MaKo/device-control side effects; and does not add Personal-Agent shortcuts.',
      parameters: [
        { name: 'signalId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceKind', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceTimestamp', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'receivedTimestamp', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'lastSeenTimestamp', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'processArea', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'knownSnapshotId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'knownSnapshotHash', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'currentSnapshotId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'currentSnapshotHash', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'severityHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'blockedDecision', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'escalationThresholdDays',
          in: 'query',
          required: false,
          schema: { type: 'number' },
        },
      ],
      responses: {
        200: {
          description: 'Read-only evidence freshness classification',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  freshnessState: { type: 'string' },
                  deltaState: { type: 'string' },
                  escalationRecommended: { type: 'boolean' },
                  evidenceGaps: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `evidence-freshness-guard:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.evidenceFreshnessGuardStatus,
        async () => ({
          ...this.buildEvidenceFreshnessGuardStatus(params),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  municipalEnergyValueAnalysisStatus: {
    rest: 'GET /municipal-energy-value-analysis',
    params: {
      municipality: { type: 'string', optional: true, min: 1 },
      ags: { type: 'string', optional: true, min: 1 },
      year: { type: 'number', optional: true, convert: true, min: 2000, max: 2100 },
      scenario: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Municipal energy value Lagebild -- read-only dashboard aggregation',
      description:
        'Returns a deterministic, Budibase-renderable municipal electricity-economy Lagebild ' +
        'for a given German municipality (identified by municipality name or AGS). ' +
        'Includes scalar valueRows (generation/value by technology), riskRows (EWK/digitalization, ' +
        'iMSys/SMGW rollout readiness, capacity constraints), budgetImpactRows (Konzessionsabgabe ' +
        'layers as scenario assumptions), assumptionRows, and sourceRows. ' +
        'Missing data is surfaced in missingEvidence and sourceRows, not as errors. ' +
        'The endpoint is generic for German municipalities; Mauer serves as the first ' +
        'demonstrable fixture/regression case. It does not perform billing, settlement, ' +
        'tariff calculation, concession-fee settlement, device control, MaKo dispatch, ' +
        'tenant provisioning, reset, Budibase table writes, or unrestricted data exports.',
      parameters: [
        { name: 'municipality', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ags', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'year', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'scenario', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only municipal energy value Lagebild',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  status: { type: 'string' },
                  municipality: { type: 'string' },
                  ags: { type: 'string' },
                  year: { type: 'number' },
                  scenario: { type: 'string' },
                  analysisRunId: { type: 'string' },
                  valueRows: { type: 'array' },
                  riskRows: { type: 'array' },
                  budgetImpactRows: { type: 'array' },
                  assumptionRows: { type: 'array' },
                  sourceRows: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  noCallGuards: { type: 'array' },
                  _errors: { type: 'array' },
                  timestamp: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const municipalityRaw = (params.municipality || '').trim();
      const ags = (params.ags || '').trim();
      const year = params.year || 2025;
      const scenario = (params.scenario || 'baseline').trim().toLowerCase();
      const cacheKey = `municipal-energy-value-analysis:${municipalityRaw.toLowerCase()}:${ags}:${year}:${scenario}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.municipalEnergyValueAnalysisStatus,
        async () => {
          const base = this.buildMunicipalEnergyValueAnalysisStatus({
            municipality: municipalityRaw,
            ags,
            year,
            scenario,
          });
          const operator = await this.resolveMunicipalVnbdigitalOperator(ctx, base);
          return {
            ...this.attachMunicipalGridOperator(base, operator),
            timestamp: new Date().toISOString(),
          };
        }
      );
    },
  },

  marketSnapshot: {
    rest: 'GET /market-snapshot',
    params: {
      location: {
        type: 'string',
        optional: true,
        default: 'Deutschland',
        min: 2,
        messages: {
          stringMin: 'location muss mindestens 2 Zeichen lang sein',
        },
      },
      region: {
        type: 'string',
        optional: true,
        min: 2,
        messages: {
          stringMin: 'region muss mindestens 2 Zeichen lang sein',
        },
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Market snapshot — current spot prices, CO₂ intensity, renewable forecast',
      description:
        'Aggregates current day-ahead spot prices, CO₂ intensity (with forecast), and ' +
        'wind/solar generation forecast for the next 24 hours into a single response.\n\n' +
        "Fixed upstream parameters: `market: day-ahead`, today's date, `forecastType: both`.\n\n" +
        'Optional overrides:\n' +
        '- `?location=Heidelberg` overrides the CO₂ intensity location (default: Deutschland)\n' +
        '- `?region=Bayern` enables the ENTSO-E wind/solar forecast (region-specific); ' +
        'omit to skip — `renewableForecast24h` will be null when no region is given\n\n' +
        'Cache TTL: 15 minutes (key: location + region).',
      parameters: [
        {
          name: 'location',
          in: 'query',
          required: false,
          schema: { type: 'string', default: 'Deutschland', example: 'Heidelberg' },
          description: 'Location for CO₂ intensity lookup (default: Deutschland)',
        },
        {
          name: 'region',
          in: 'query',
          required: false,
          schema: { type: 'string', example: 'Bayern' },
          description:
            'Region for ENTSO-E wind/solar generation forecast. When omitted, renewableForecast24h is null and the ENTSO-E call is skipped.',
        },
      ],
      responses: {
        200: {
          description: 'Current market snapshot',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  spotPrice: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      current: { type: 'number', description: '€/MWh', example: 45.2 },
                      avgToday: { type: 'number', description: '€/MWh' },
                      minToday: { type: 'number', description: '€/MWh' },
                      maxToday: { type: 'number', description: '€/MWh' },
                      trend: { type: 'string', enum: ['rising', 'falling', 'stable'] },
                      source: { type: 'string', example: 'netztransparenz' },
                    },
                  },
                  co2: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      current: { type: 'number', description: 'gCO2eq/kWh', example: 380 },
                      avgToday: { type: 'number' },
                      signal: { type: 'string', enum: ['green', 'yellow', 'red'] },
                      location: { type: 'string', example: 'Deutschland' },
                    },
                  },
                  renewableForecast24h: {
                    type: 'object',
                    nullable: true,
                    properties: {
                      solarPeakMW: { type: 'number', example: 32500 },
                      windPeakMW: { type: 'number', example: 18200 },
                      combinedPeakAt: { type: 'string', format: 'date-time' },
                    },
                  },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      'x-oeo-class': ['OEO_00000523', 'OEO_00000143'],
    },
    async handler(ctx) {
      const { location, region } = ctx.params;
      const cacheKey = `market-snapshot:${location}:${region}`;
      return this.cacheGetOrFetch(cacheKey, this.settings.cacheTtlMs.marketSnapshot, async () => {
        const errors = [];
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

        // entsoe.dayAheadPrices, co2Intensity always fire in parallel (1 MCP session
        // each, no internal fan-out). entsoe.windSolarForecast only fires when the
        // caller provides an explicit `region` — without it, a Germany-wide forecast
        // is not meaningful for a local VNB dashboard. UI must hide the
        // renewableForecast24h card when it is null.
        const [pricesRes, co2Res] = await Promise.allSettled([
          this.safeCall(
            ctx,
            'entsoe.dayAheadPrices',
            {
              region: 'Deutschland',
              dateFrom: today,
              dateTo: today,
              includeStatistics: true,
            },
            null,
            errors,
            'entsoe.dayAheadPrices'
          ),
          this.safeCall(
            ctx,
            'energy-market.co2Intensity',
            {
              location,
              forecast: true,
            },
            null,
            errors,
            'energy-market.co2Intensity'
          ),
        ]);

        const forecastRaw = region
          ? await this.safeCall(
              ctx,
              'entsoe.windSolarForecast',
              {
                region,
                dateFrom: today,
                dateTo: tomorrow,
                forecastType: 'both',
              },
              null,
              errors,
              'entsoe.windSolarForecast'
            )
          : null;

        return {
          spotPrice: this.buildSpotPrice(pricesRes.value),
          co2: this.buildCo2(co2Res.value, location),
          renewableForecast24h: forecastRaw ? this.buildForecast(forecastRaw) : null,
          timestamp: new Date().toISOString(),
          _errors: errors,
        };
      });
    },
  },

  qualitySummary: {
    rest: 'GET /quality-summary',
    params: {
      gridOperatorId: {
        type: 'string',
        optional: true,
        pattern: /^[SG]NB\d+$/,
        messages: {
          stringPattern:
            'gridOperatorId muss im Format SNBxxx oder GNBxxx sein (Beispiel: SNB935578300972)',
        },
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Quality summary — recent reports from all agent pipelines',
      description:
        'Returns the five most recent reports from each of the five agent pipelines ' +
        '(MaStR Quality, Grid Connection, Energy Sharing, Redispatch Ex-Post, ' +
        'Energy Sharing Allocation), structured as an agent-type array with ' +
        'last-run timestamp, key metric, and report list.\n\n' +
        'Optionally filtered by `gridOperatorId` (MaStR SNB/GNB ID). ' +
        'If omitted, returns the five most recent reports regardless of operator.\n\n' +
        'Cache TTL: 5 minutes (key: gridOperatorId).',
      parameters: [
        {
          name: 'gridOperatorId',
          in: 'query',
          required: false,
          schema: { type: 'string', example: 'SNB935578300972' },
          description: 'MaStR ID of the grid operator (SNB.../GNB...)',
        },
      ],
      responses: {
        200: {
          description: 'Quality summary across all agent pipelines',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  agents: {
                    type: 'array',
                    description: 'One entry per agent type',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', example: 'mastr-quality' },
                        label: { type: 'string', example: 'MaStR Datenqualität' },
                        lastRun: { type: 'string', format: 'date-time', nullable: true },
                        keyMetric: { type: 'object', nullable: true },
                        findingsCount: {
                          type: 'object',
                          nullable: true,
                          description:
                            'Finding counts from latest report (null for agents without findings pattern)',
                          properties: {
                            info: { type: 'integer', example: 12 },
                            warning: { type: 'integer', example: 18 },
                            error: { type: 'integer', example: 5 },
                          },
                        },
                        recentReports: { type: 'array' },
                      },
                    },
                  },
                  businessKpis: {
                    type: 'object',
                    nullable: true,
                    description:
                      'VDMI business KPIs for governance and process-standardisation impact',
                    properties: {
                      vdmi_shadow_path_resolution_rate: {
                        type: 'number',
                        nullable: true,
                        description:
                          'Resolved share (%) of VD_SHADOW_* and VD_SILO_* findings in the observed data',
                      },
                      vdmi_n1_escalation_reduction_rate: {
                        type: 'number',
                        nullable: true,
                        description:
                          'Reduction (%) of escalation-like VD_GOV_* findings comparing current vs previous 30-day window',
                      },
                      vdmi_fnav_time_to_decision_gain_days: {
                        type: 'number',
                        nullable: true,
                        description:
                          'Median decision-time gain in days for fNAV process matrices (previous window minus current window)',
                      },
                    },
                  },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      'x-oeo-class': ['OEO_00000143'],
    },
    async handler(ctx) {
      const { gridOperatorId } = ctx.params;
      const cacheKey = `quality-summary:${gridOperatorId || 'all'}`;
      return this.cacheGetOrFetch(cacheKey, this.settings.cacheTtlMs.qualitySummary, async () => {
        const errors = [];
        const baseFilter = gridOperatorId ? { gridOperatorId } : {};

        const [mqRes, gcRes, esRes, rdRes, allocRes, vdmiMatrixRes, vdmiFindingsRes] =
          await Promise.allSettled([
            this.safeCall(
              ctx,
              ACTION_MQ_LIST,
              { ...baseFilter, limit: 5 },
              null,
              errors,
              ACTION_MQ_LIST
            ),
            this.safeCall(
              ctx,
              ACTION_GC_LIST,
              { ...baseFilter, limit: 5 },
              null,
              errors,
              ACTION_GC_LIST
            ),
            this.safeCall(ctx, ACTION_ES_LIST, { limit: 5 }, null, errors, ACTION_ES_LIST),
            this.safeCall(
              ctx,
              ACTION_RD_LIST,
              { ...baseFilter, limit: 5 },
              null,
              errors,
              ACTION_RD_LIST
            ),
            this.safeCall(
              ctx,
              'energy-sharing-allocation.list',
              { limit: 5 },
              null,
              errors,
              'energy-sharing-allocation.list'
            ),
            this.safeCall(ctx, ACTION_VDMI_LIST, { limit: 5 }, null, errors, ACTION_VDMI_LIST),
            this.safeCall(
              ctx,
              ACTION_VDMI_FINDINGS,
              { limit: 500 },
              null,
              errors,
              ACTION_VDMI_FINDINGS
            ),
          ]);

        const vdmiMatrices = vdmiMatrixRes.value?.items || [];
        const vdmiFindings = vdmiFindingsRes.value?.findings || [];

        const agents = [
          this.buildAgentEntry(
            'mastr-quality',
            'MaStR Datenqualität',
            mqRes.value?.audits,
            'qualityScore'
          ),
          this.buildAgentEntry(
            'grid-connection',
            'Netzanschluss-Validierung',
            gcRes.value?.validations,
            'decision'
          ),
          this.buildAgentEntry(
            'energy-sharing',
            'Energy Sharing Validierung',
            esRes.value?.validations,
            'decision'
          ),
          this.buildAgentEntry(
            'redispatch-expost',
            'Redispatch Ex-Post',
            rdRes.value?.audits,
            'settlementReadiness'
          ),
          this.buildAgentEntry(
            'energy-sharing-allocation',
            'Energy Sharing Allokation',
            allocRes.value?.allocations,
            'totalNetGenerationKWh'
          ),
          this.buildVdmiAgentEntry(vdmiMatrices, vdmiFindings),
        ];

        return {
          agents,
          businessKpis: this.buildVdmiBusinessKpis(vdmiFindings, vdmiMatrices),
          timestamp: new Date().toISOString(),
          _errors: errors,
        };
      });
    },
  },

  observabilityMini: {
    rest: 'GET /observability-mini',
    params: {
      sinceMinutes: {
        type: 'number',
        integer: true,
        optional: true,
        default: 60,
        min: 1,
        max: 24 * 60,
        convert: true,
      },
      slowActionThresholdMs: {
        type: 'number',
        integer: true,
        optional: true,
        default: 1000,
        min: 1,
        max: 600000,
        convert: true,
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Observability mini dashboard — compact production feedback cards',
      description:
        'Returns a compact operational payload from observability.summary with health, incidents, ' +
        'and performance cards plus recent errors and slowest actions. Optimized for dashboard widgets and agentic monitoring loops. ' +
        'Cache TTL: 60 seconds.',
      parameters: [
        {
          name: 'sinceMinutes',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 60, minimum: 1, maximum: 1440 },
          description: 'Rolling observation window in minutes.',
        },
        {
          name: 'slowActionThresholdMs',
          in: 'query',
          required: false,
          schema: { type: 'integer', default: 1000, minimum: 1, maximum: 600000 },
          description: 'Threshold used to classify actions as slow.',
        },
      ],
      responses: {
        200: {
          description: 'Compact observability widget payload',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  cards: { type: 'object' },
                  recentErrors: { type: 'array' },
                  slowestActions: { type: 'array' },
                  timestamp: { type: 'string', format: 'date-time' },
                  _errors: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      'x-oeo-class': ['OEO_00000143'],
    },
    async handler(ctx) {
      const { sinceMinutes, slowActionThresholdMs } = ctx.params;
      const cacheKey = `observability-mini:${sinceMinutes}:${slowActionThresholdMs}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.observabilityMini,
        async () => {
          const errors = [];
          const summary = await this.safeCall(
            ctx,
            'observability.summary',
            { sinceMinutes, slowActionThresholdMs, limit: 10 },
            null,
            errors,
            'observability.summary'
          );

          return {
            cards: this.buildObservabilityMiniCards(summary),
            recentErrors: summary?.logs?.recentErrors || [],
            slowestActions: summary?.metrics?.slowestActions || [],
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  findingCodes: {
    rest: 'GET /finding-codes',
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Finding codes reference — all 92 codes with metadata',
      description:
        'Returns the complete finding-code reference for all agent pipelines ' +
        '(Grid Connection v0.14, Energy Sharing v0.15, MaStR Quality v0.17, ' +
        'Redispatch Ex-Post v0.18). Each code entry contains: severity, agent, ' +
        'step, description (EN), descriptionDe (DE). ' +
        'Intended for UI tooltips, filter chips, and colour coding.\n\n' +
        'Cache TTL: 24 hours (static data — changes only on service restart).',
      responses: {
        200: {
          description: 'Finding codes reference',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  codes: {
                    type: 'object',
                    description: 'Map of code → metadata',
                    additionalProperties: {
                      type: 'object',
                      properties: {
                        severity: { type: 'string', enum: ['info', 'warning', 'error'] },
                        agent: { type: 'string', example: 'mastr-quality' },
                        step: { type: 'integer', example: 4 },
                        description: { type: 'string', description: 'English description' },
                        descriptionDe: { type: 'string', description: 'German description' },
                      },
                    },
                  },
                  agents: {
                    type: 'object',
                    description: 'Agent catalogue with version and step count',
                  },
                  totalCodes: { type: 'integer', example: 92 },
                },
              },
            },
          },
        },
      },
      'x-oeo-class': ['OEO_00000143'],
    },
    async handler() {
      return this.cacheGetOrFetch('finding-codes', this.settings.cacheTtlMs.findingCodes, () => {
        return Promise.resolve({
          codes: FINDING_CODE_METADATA,
          agents: {
            'grid-connection': {
              label: 'Netzanschluss-Validierung',
              version: '0.14.0',
              steps: 6,
              pouchdbPrefix: 'val:',
              endpoint: 'POST /api/grid-connection/validate',
            },
            'energy-sharing': {
              label: 'Energy Sharing Validierung',
              version: '0.15.0',
              steps: 6,
              pouchdbPrefix: 'es:',
              endpoint: 'POST /api/energy-sharing/validate',
            },
            'mastr-quality': {
              label: 'MaStR Datenqualität',
              version: '0.17.0',
              steps: 8,
              pouchdbPrefix: 'mq:',
              endpoint: 'POST /api/mastr-quality/audit',
            },
            'redispatch-expost': {
              label: 'Redispatch Ex-Post',
              version: '0.18.0',
              steps: 7,
              pouchdbPrefix: 'rd:',
              endpoint: 'POST /api/redispatch/audit',
            },
            vdmi: {
              label: 'VDMI Governance Matrix',
              version: '0.50.0',
              steps: 6,
              pouchdbPrefix: 'vdmi:',
              endpoint: 'GET /api/vdmi/findings',
            },
            'blindflug-radar': {
              label: 'Blindflug Radar',
              version: '1.0.0',
              steps: 1,
              pouchdbPrefix: null,
              endpoint: 'POST /api/blindflug-radar/scan',
            },
          },
          totalCodes: Object.keys(FINDING_CODE_METADATA).length,
        });
      });
    },
  },

  modelViabilityEvidenceGateStatus: {
    rest: 'GET /model-viability-evidence-gate',
    params: {
      candidateId: { type: 'string', optional: true, min: 1 },
      candidateName: { type: 'string', optional: true, min: 1 },
      modelType: { type: 'string', optional: true, min: 1 },
      scope: { type: 'string', optional: true, min: 1 },
      evidenceSnapshotRef: { type: 'string', optional: true, min: 1 },
      processCostBand: { type: 'string', optional: true, min: 1 },
      processCostReference: { type: 'string', optional: true, min: 1 },
      exceptionCaseRateBand: { type: 'string', optional: true, min: 1 },
      exceptionCaseOwner: { type: 'string', optional: true, min: 1 },
      liquidityImpactBand: { type: 'string', optional: true, min: 1 },
      liquidityImpactReference: { type: 'string', optional: true, min: 1 },
      dataMaturityMetering: { type: 'string', optional: true, min: 1 },
      dataMaturityRoles: { type: 'string', optional: true, min: 1 },
      dataMaturityTimeSeries: { type: 'string', optional: true, min: 1 },
      dataMaturitySourceFreshness: { type: 'string', optional: true, min: 1 },
      governanceEffortBand: { type: 'string', optional: true, min: 1 },
      governanceDecisionOwner: { type: 'string', optional: true, min: 1 },
      nextReviewGate: { type: 'string', optional: true, min: 1 },
      assumptionOnlyDimensions: {
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
      summary: 'Model Viability Evidence Gate — read-only single-candidate evidence view',
      description:
        'Builds a deterministic, dossier-safe evidence view for one supplied operating-model ' +
        'candidate. Normalizes process-cost, exception-case, liquidity-impact, data-maturity and ' +
        'governance-effort evidence into comparable dimension rows with provided/assumption_only/' +
        'missing status. Read-only: does not rank models, compute economics, or issue a legal, ' +
        'regulatory, tariff, contract, allocation, onboarding, billing, settlement, MaKo/A96, ' +
        'finance, procurement, workflow, HITL, connector, market-communication, device-control or ' +
        'Personal-Agent action.',
      parameters: [
        stringQueryParam('candidateId'),
        stringQueryParam('candidateName'),
        stringQueryParam('modelType'),
        stringQueryParam('scope'),
        stringQueryParam('evidenceSnapshotRef'),
        stringQueryParam('processCostBand'),
        stringQueryParam('processCostReference'),
        stringQueryParam('exceptionCaseRateBand'),
        stringQueryParam('exceptionCaseOwner'),
        stringQueryParam('liquidityImpactBand'),
        stringQueryParam('liquidityImpactReference'),
        stringQueryParam('dataMaturityMetering'),
        stringQueryParam('dataMaturityRoles'),
        stringQueryParam('dataMaturityTimeSeries'),
        stringQueryParam('dataMaturitySourceFreshness'),
        stringQueryParam('governanceEffortBand'),
        stringQueryParam('governanceDecisionOwner'),
        stringQueryParam('nextReviewGate'),
        {
          name: 'assumptionOnlyDimensions',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only single-candidate model viability evidence view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  safety: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  candidateContext: { type: 'object' },
                  rows: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  decisionBoundaries: { type: 'array' },
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
      const cacheKey = `model-viability-evidence-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.modelViabilityEvidenceGateStatus,
        async () => ({
          ...this.buildModelViabilityEvidenceGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },
};
