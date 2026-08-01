'use strict';

// dashboard-api actions chunk 5/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: gridConnectionTransformationGateStatus, heatAssetTariffSteeringStatus, techCommercialOfferCockpitStatus, zaehlparkFinanzierungSzenarioCockpitStatus, processSensitizationReadinessMapStatus, netzprozessReadinessGateStatus, grossspeicherAnschlussReadinessGateStatus, rolePermissionAccessReadinessGateStatus, ownerDeadlineEvidenceGateStatus, automationRiskGateStatus, redispatchProjectControllingKpiCockpitStatus, stadtwerkMauerVdmiProfileStatus, stadtwerkMauerCapabilityProjectionStatus, stadtwerkMauerEventReplayPreviewStatus, stadtwerkMauerSandboxRuntimeStatus, stadtwerkMauerExternalInterfaceStubsStatus

const { OPENAPI_TAG } = require('./shared');

module.exports = {
  gridConnectionTransformationGateStatus: {
    rest: 'GET /grid-connection-transformation-gate',
    params: {
      meteringPointId: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      transformationOption: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      investmentPath: { type: 'string', optional: true, min: 1 },
      decommissionPath: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
      sourceRef: {
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
      summary: 'Netzanschlusspunkt Transformations Gate — read-only dossier-safe status',
      description:
        'Builds deterministic gate status and evidence from supplied facts. ' +
        'The endpoint is read-only and does not run writes to ZNP, assets, HITL, or VDMI.',
      responses: {
        200: {
          description: 'Read-only grid connection transformation status evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'meteringPointId', schema: { type: 'string' } },
        { in: 'query', name: 'division', schema: { type: 'string' } },
        { in: 'query', name: 'transformationOption', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'investmentPath', schema: { type: 'string' } },
        { in: 'query', name: 'decommissionPath', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextAction', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `grid-connection-transformation-gate:${params.meteringPointId || 'no-melo'}:${params.division || 'no-division'}:${params.owner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gridConnectionTransformationGateStatus,
        async () => ({
          ...this.buildGridConnectionTransformationGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  heatAssetTariffSteeringStatus: {
    rest: 'GET /heat-asset-tariff-steering',
    params: {
      heatPortfolioId: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      technicalMeasures: { type: 'string', optional: true, min: 1 },
      tariffImpactStatus: { type: 'string', optional: true, min: 1 },
      regulatoryUncertainty: { type: 'string', optional: true, min: 1 },
      fundingStatus: { type: 'string', optional: true, min: 1 },
      customerImpact: { type: 'string', optional: true, min: 1 },
      investmentPriority: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextDecisionGate: { type: 'string', optional: true, min: 1 },
      blockedFollowUpAction: { type: 'string', optional: true, min: 1 },
      sourceRef: {
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
      summary: 'District Heating Asset & Tariff Steering Gate — read-only dossier-safe status',
      description:
        'Builds deterministic gate status and evidence from supplied facts. ' +
        'The endpoint is read-only and does not run writes to ZNP, assets, HITL, or VDMI.',
      responses: {
        200: {
          description: 'Read-only district heating asset and tariff status evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'heatPortfolioId', schema: { type: 'string' } },
        { in: 'query', name: 'division', schema: { type: 'string' } },
        { in: 'query', name: 'technicalMeasures', schema: { type: 'string' } },
        { in: 'query', name: 'tariffImpactStatus', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryUncertainty', schema: { type: 'string' } },
        { in: 'query', name: 'fundingStatus', schema: { type: 'string' } },
        { in: 'query', name: 'customerImpact', schema: { type: 'string' } },
        { in: 'query', name: 'investmentPriority', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextDecisionGate', schema: { type: 'string' } },
        { in: 'query', name: 'blockedFollowUpAction', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `heat-asset-tariff-steering:${params.heatPortfolioId || 'no-portfolio'}:${params.division || 'no-division'}:${params.owner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.heatAssetTariffSteeringStatus,
        async () => ({
          ...this.buildHeatAssetTariffSteeringStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  techCommercialOfferCockpitStatus: {
    rest: 'GET /tech-commercial-offer-cockpit',
    params: {
      connectionRequestId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      znpAlignment: { type: 'string', optional: true, min: 1 },
      gridNode: { type: 'string', optional: true, min: 1 },
      technicalRestriction: { type: 'string', optional: true, min: 1 },
      requestedCapacityKW: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string' }],
      },
      technicalStatus: { type: 'string', optional: true, min: 1 },
      capacityUtilization: { type: 'string', optional: true, min: 1 },
      fnavContractLogic: { type: 'string', optional: true, min: 1 },
      commercialAssumptions: { type: 'string', optional: true, min: 1 },
      legalAgreementStatus: { type: 'string', optional: true, min: 1 },
      legalBoundaries: { type: 'string', optional: true, min: 1 },
      sourceRef: {
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
      summary: 'Technical & Commercial Offer Cockpit — read-only dossier-safe status',
      description:
        'Builds deterministic gate status and evidence from supplied facts. ' +
        'The endpoint is read-only and does not run writes or actual offer generation.',
      responses: {
        200: {
          description: 'Read-only technical and commercial offer status evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'connectionRequestId', schema: { type: 'string' } },
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'znpAlignment', schema: { type: 'string' } },
        { in: 'query', name: 'gridNode', schema: { type: 'string' } },
        { in: 'query', name: 'technicalRestriction', schema: { type: 'string' } },
        { in: 'query', name: 'requestedCapacityKW', schema: { type: 'string' } },
        { in: 'query', name: 'technicalStatus', schema: { type: 'string' } },
        { in: 'query', name: 'capacityUtilization', schema: { type: 'string' } },
        { in: 'query', name: 'fnavContractLogic', schema: { type: 'string' } },
        { in: 'query', name: 'commercialAssumptions', schema: { type: 'string' } },
        { in: 'query', name: 'legalAgreementStatus', schema: { type: 'string' } },
        { in: 'query', name: 'legalBoundaries', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `tech-commercial-offer-cockpit:${params.connectionRequestId || 'no-request'}:${params.gridOperatorId || 'no-operator'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.techCommercialOfferCockpitStatus,
        async () => ({
          ...this.buildTechCommercialOfferCockpitStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  zaehlparkFinanzierungSzenarioCockpitStatus: {
    rest: 'GET /zaehlpark-finanzierung-szenario-cockpit',
    params: {
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      scenarioId: { type: 'string', optional: true, min: 1 },
      assetScope: { type: 'string', optional: true, min: 1 },
      meteringScope: { type: 'string', optional: true, min: 1 },
      period: { type: 'string', optional: true, min: 1 },
      investmentVolume: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string' }],
      },
      imsysCount: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string' }],
      },
      financingModel: { type: 'string', optional: true, min: 1 },
      opexAnnual: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string' }],
      },
      regulatoryRelevance: { type: 'string', optional: true, min: 1 },
      sourceRef: {
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
      summary: 'Zaehlpark Finanzierung Szenario Cockpit -- read-only dossier-safe status',
      description:
        'Builds deterministic rollout and financing scenario status from supplied facts. ' +
        'The endpoint is read-only and does not run external financing, billing, settlement, or mutation paths.',
      responses: {
        200: {
          description: 'Read-only metering rollout financing scenario evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'scenarioId', schema: { type: 'string' } },
        { in: 'query', name: 'assetScope', schema: { type: 'string' } },
        { in: 'query', name: 'meteringScope', schema: { type: 'string' } },
        { in: 'query', name: 'period', schema: { type: 'string' } },
        { in: 'query', name: 'investmentVolume', schema: { type: 'string' } },
        { in: 'query', name: 'imsysCount', schema: { type: 'string' } },
        { in: 'query', name: 'financingModel', schema: { type: 'string' } },
        { in: 'query', name: 'opexAnnual', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryRelevance', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `zaehlpark-finanzierung-szenario-cockpit:${params.gridOperatorId || 'no-operator'}:${params.scenarioId || 'no-scenario'}:${params.assetScope || 'no-asset-scope'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.zaehlparkFinanzierungSzenarioCockpitStatus,
        async () => ({
          ...this.buildZaehlparkFinanzierungSzenarioCockpitStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  processSensitizationReadinessMapStatus: {
    rest: 'GET /process-sensitization-readiness-map',
    params: {
      processType: { type: 'string', optional: true, min: 1 },
      topic: { type: 'string', optional: true, min: 1 },
      roleDecision: { type: 'string', optional: true, min: 1 },
      roleDecisionStatus: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      systemBreakStatus: { type: 'string', optional: true, min: 1 },
      redLineStatus: { type: 'string', optional: true, min: 1 },
      missingEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      roleDecisionGaps: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      dataQualityGaps: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      systemBreaks: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      nonNegotiableConstraints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      owner: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      taskId: { type: 'string', optional: true, min: 1 },
      matrixId: { type: 'string', optional: true, min: 1 },
      assetId: { type: 'string', optional: true, min: 1 },
      sourceRef: {
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
      summary: 'Process Sensitization Readiness Map -- read-only dossier-safe status',
      description:
        'Builds deterministic readiness evidence from supplied process facts. ' +
        'The endpoint is read-only and does not create trainings, HITL tasks, VDMI changes, or external calls.',
      responses: {
        200: {
          description: 'Read-only process sensitization readiness evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'processType', schema: { type: 'string' } },
        { in: 'query', name: 'topic', schema: { type: 'string' } },
        { in: 'query', name: 'roleDecision', schema: { type: 'string' } },
        { in: 'query', name: 'roleDecisionStatus', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'systemBreakStatus', schema: { type: 'string' } },
        { in: 'query', name: 'redLineStatus', schema: { type: 'string' } },
        { in: 'query', name: 'missingEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'roleDecisionGaps', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityGaps', schema: { type: 'string' } },
        { in: 'query', name: 'systemBreaks', schema: { type: 'string' } },
        { in: 'query', name: 'nonNegotiableConstraints', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'dueDate', schema: { type: 'string' } },
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'taskId', schema: { type: 'string' } },
        { in: 'query', name: 'matrixId', schema: { type: 'string' } },
        { in: 'query', name: 'assetId', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `process-sensitization-readiness-map:${params.processType || params.topic || 'no-topic'}:${params.gridOperatorId || 'no-operator'}:${params.taskId || params.matrixId || params.assetId || 'no-context'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.processSensitizationReadinessMapStatus,
        async () => ({
          ...this.buildProcessSensitizationReadinessMapStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  netzprozessReadinessGateStatus: {
    rest: 'GET /netzprozess-readiness-gate',
    params: {
      processType: { type: 'string', optional: true, min: 1 },
      processId: { type: 'string', optional: true, min: 1 },
      processRefType: { type: 'string', optional: true, min: 1 },
      processRefId: { type: 'string', optional: true, min: 1 },
      portalAccess: { type: 'string', optional: true, min: 1 },
      sftpRoute: { type: 'string', optional: true, min: 1 },
      rolePermission: { type: 'string', optional: true, min: 1 },
      itSecurityUpdate: { type: 'string', optional: true, min: 1 },
      training: { type: 'string', optional: true, min: 1 },
      dataPath: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      dueAt: { type: 'string', optional: true, min: 1 },
      nextDecision: { type: 'string', optional: true, min: 1 },
      missingEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      customSignals: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'array' }, { type: 'string', min: 1 }],
      },
      sourceRef: {
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
      summary: 'Netzprozess Readiness Gate -- read-only dossier-safe status',
      description:
        'Builds deterministic readiness evidence from supplied administrative process facts. ' +
        'The endpoint is read-only and does not create HITL tasks, mutate VDMI/workflow state, or call external systems.',
      responses: {
        200: {
          description: 'Read-only Netzprozess readiness evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'processType', schema: { type: 'string' } },
        { in: 'query', name: 'processId', schema: { type: 'string' } },
        { in: 'query', name: 'processRefType', schema: { type: 'string' } },
        { in: 'query', name: 'processRefId', schema: { type: 'string' } },
        { in: 'query', name: 'portalAccess', schema: { type: 'string' } },
        { in: 'query', name: 'sftpRoute', schema: { type: 'string' } },
        { in: 'query', name: 'rolePermission', schema: { type: 'string' } },
        { in: 'query', name: 'itSecurityUpdate', schema: { type: 'string' } },
        { in: 'query', name: 'training', schema: { type: 'string' } },
        { in: 'query', name: 'dataPath', schema: { type: 'string' } },
        { in: 'query', name: 'blockedDecision', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'dueAt', schema: { type: 'string' } },
        { in: 'query', name: 'nextDecision', schema: { type: 'string' } },
        { in: 'query', name: 'missingEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'customSignals', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `netzprozess-readiness-gate:${params.processType || 'general'}:${params.processId || params.processRefId || 'no-process'}:${params.portalAccess || ''}:${params.sftpRoute || ''}:${params.rolePermission || ''}:${params.itSecurityUpdate || ''}:${params.training || ''}:${params.dataPath || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.netzprozessReadinessGateStatus,
        async () => ({
          ...this.buildNetzprozessReadinessGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  grossspeicherAnschlussReadinessGateStatus: {
    rest: 'GET /grossspeicher-anschluss-readiness-gate',
    params: {
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      projectId: { type: 'string', optional: true, min: 1 },
      storageAssetId: { type: 'string', optional: true, min: 1 },
      location: { type: 'string', optional: true, min: 1 },
      requestedCapacityKW: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      storageCapacityKWh: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      voltageLevel: { type: 'string', optional: true, min: 1 },
      assetContextStatus: { type: 'string', optional: true, min: 1 },
      napMastrNummer: { type: 'string', optional: true, min: 1 },
      napEvidenceStatus: { type: 'string', optional: true, min: 1 },
      connectionRequestStatus: { type: 'string', optional: true, min: 1 },
      formalRequestEvidence: { type: 'string', optional: true, min: 1 },
      networkSignalPriority: { type: 'string', optional: true, min: 1 },
      gridSignalStatus: { type: 'string', optional: true, min: 1 },
      fnavProfile: { type: 'string', optional: true, min: 1 },
      contractBoundaryStatus: { type: 'string', optional: true, min: 1 },
      scheduleRequirement: { type: 'string', optional: true, min: 1 },
      storageDispatchAssumption: { type: 'string', optional: true, min: 1 },
      scheduleEvidenceStatus: { type: 'string', optional: true, min: 1 },
      controllabilityStatus: { type: 'string', optional: true, min: 1 },
      controlRoomHandoverStatus: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextDecision: { type: 'string', optional: true, min: 1 },
      source: { type: 'string', optional: true, min: 1 },
      missingEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      evidenceGaps: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceRef: {
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
      summary: 'Grossspeicher Anschluss Readiness Gate -- read-only dossier-safe status',
      description:
        'Builds deterministic Grossspeicher/Flex Anschluss readiness evidence from supplied facts. ' +
        'The endpoint is read-only and does not mutate Anschluss, fNAV, ZNP, VDMI/HITL, dispatch, or device-control state.',
      responses: {
        200: {
          description: 'Read-only Grossspeicher Anschluss readiness evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'projectId', schema: { type: 'string' } },
        { in: 'query', name: 'storageAssetId', schema: { type: 'string' } },
        { in: 'query', name: 'location', schema: { type: 'string' } },
        { in: 'query', name: 'requestedCapacityKW', schema: { type: 'string' } },
        { in: 'query', name: 'storageCapacityKWh', schema: { type: 'string' } },
        { in: 'query', name: 'voltageLevel', schema: { type: 'string' } },
        { in: 'query', name: 'assetContextStatus', schema: { type: 'string' } },
        { in: 'query', name: 'napMastrNummer', schema: { type: 'string' } },
        { in: 'query', name: 'napEvidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'connectionRequestStatus', schema: { type: 'string' } },
        { in: 'query', name: 'formalRequestEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'networkSignalPriority', schema: { type: 'string' } },
        { in: 'query', name: 'gridSignalStatus', schema: { type: 'string' } },
        { in: 'query', name: 'fnavProfile', schema: { type: 'string' } },
        { in: 'query', name: 'contractBoundaryStatus', schema: { type: 'string' } },
        { in: 'query', name: 'scheduleRequirement', schema: { type: 'string' } },
        { in: 'query', name: 'storageDispatchAssumption', schema: { type: 'string' } },
        { in: 'query', name: 'scheduleEvidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'controllabilityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'controlRoomHandoverStatus', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextDecision', schema: { type: 'string' } },
        { in: 'query', name: 'source', schema: { type: 'string' } },
        { in: 'query', name: 'missingEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceGaps', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `grossspeicher-anschluss-readiness-gate:${params.gridOperatorId || 'no-operator'}:${params.projectId || 'no-project'}:${params.storageAssetId || 'no-asset'}:${params.gridSignalStatus || ''}:${params.contractBoundaryStatus || ''}:${params.controllabilityStatus || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.grossspeicherAnschlussReadinessGateStatus,
        async () => ({
          ...this.buildGrossspeicherAnschlussReadinessGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  rolePermissionAccessReadinessGateStatus: {
    rest: 'GET /role-permission-access-readiness-gate',
    params: {
      roleId: { type: 'string', optional: true, min: 1 },
      roleName: { type: 'string', optional: true, min: 1 },
      processType: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      accessManagerRef: { type: 'string', optional: true, min: 1 },
      tenantScope: { type: 'string', optional: true, min: 1 },
      portalAccess: { type: 'string', optional: true, min: 1 },
      sftpRoute: { type: 'string', optional: true, min: 1 },
      rolePermission: { type: 'string', optional: true, min: 1 },
      securityClearance: { type: 'string', optional: true, min: 1 },
      trainingProof: { type: 'string', optional: true, min: 1 },
      reapprovalStatus: { type: 'string', optional: true, min: 1 },
      sourcePath: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      blockedAccess: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      source: { type: 'string', optional: true, min: 1 },
      missingEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      evidenceGaps: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceRef: {
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
      summary: 'Role-Permission / AccessManager Readiness Gate -- read-only dossier-safe status',
      description:
        'Builds deterministic role/access readiness evidence from supplied facts. ' +
        'The endpoint is read-only and does not call AccessManager, mutate IAM/RBAC state, store credentials, create workflows, or call external systems.',
      responses: {
        200: {
          description: 'Read-only Role-Permission / AccessManager readiness evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'roleId', schema: { type: 'string' } },
        { in: 'query', name: 'roleName', schema: { type: 'string' } },
        { in: 'query', name: 'processType', schema: { type: 'string' } },
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'accessManagerRef', schema: { type: 'string' } },
        { in: 'query', name: 'tenantScope', schema: { type: 'string' } },
        { in: 'query', name: 'portalAccess', schema: { type: 'string' } },
        { in: 'query', name: 'sftpRoute', schema: { type: 'string' } },
        { in: 'query', name: 'rolePermission', schema: { type: 'string' } },
        { in: 'query', name: 'securityClearance', schema: { type: 'string' } },
        { in: 'query', name: 'trainingProof', schema: { type: 'string' } },
        { in: 'query', name: 'reapprovalStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourcePath', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'dueDate', schema: { type: 'string' } },
        { in: 'query', name: 'blockedAccess', schema: { type: 'string' } },
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
        { in: 'query', name: 'source', schema: { type: 'string' } },
        { in: 'query', name: 'missingEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceGaps', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `role-permission-access-readiness-gate:${params.roleId || params.roleName || 'no-role'}:${params.portalAccess || ''}:${params.sftpRoute || ''}:${params.rolePermission || ''}:${params.securityClearance || ''}:${params.trainingProof || ''}:${params.reapprovalStatus || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.rolePermissionAccessReadinessGateStatus,
        async () => ({
          ...this.buildRolePermissionAccessReadinessGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  ownerDeadlineEvidenceGateStatus: {
    rest: 'GET /owner-deadline-evidence-gate',
    params: {
      signalId: { type: 'string', optional: true, min: 1 },
      sourceType: { type: 'string', optional: true, min: 1 },
      sourceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      processType: { type: 'string', optional: true, min: 1 },
      riskLevel: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      ownerContact: { type: 'string', optional: true, min: 1 },
      dueAt: { type: 'string', optional: true, min: 1 },
      evidenceRef: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      linkedEntity: { type: 'string', optional: true, min: 1 },
      blockedByMissingEvidence: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      overdue: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      signalContextStatus: { type: 'string', optional: true, min: 1 },
      missingEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      evidenceGaps: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      caseId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Owner-Frist-Evidenz Gate -- read-only dossier-safe status',
      description:
        'Builds deterministic owner/deadline/evidence readiness from supplied VNB signal facts. ' +
        'The endpoint is read-only and does not ingest mail/Teams/Loop, mutate workflows, send notifications, create tasks, or call external systems.',
      responses: {
        200: {
          description: 'Read-only Owner-Frist-Evidenz readiness evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'signalId', schema: { type: 'string' } },
        { in: 'query', name: 'sourceType', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
        { in: 'query', name: 'processType', schema: { type: 'string' } },
        { in: 'query', name: 'riskLevel', schema: { type: 'string' } },
        { in: 'query', name: 'ownerRole', schema: { type: 'string' } },
        { in: 'query', name: 'ownerContact', schema: { type: 'string' } },
        { in: 'query', name: 'dueAt', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceRef', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'blockedDecision', schema: { type: 'string' } },
        { in: 'query', name: 'linkedEntity', schema: { type: 'string' } },
        { in: 'query', name: 'blockedByMissingEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'overdue', schema: { type: 'string' } },
        { in: 'query', name: 'signalContextStatus', schema: { type: 'string' } },
        { in: 'query', name: 'missingEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceGaps', schema: { type: 'string' } },
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `owner-deadline-evidence-gate:${params.signalId || params.caseId || 'no-signal'}:${params.ownerRole || ''}:${params.dueAt || ''}:${params.evidenceRef || ''}:${params.blockedDecision || ''}:${params.linkedEntity || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.ownerDeadlineEvidenceGateStatus,
        async () => ({
          ...this.buildOwnerDeadlineEvidenceGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  automationRiskGateStatus: {
    rest: 'GET /automation-risk-gate',
    params: {
      processId: { type: 'string', optional: true, min: 1 },
      processName: { type: 'string', optional: true, min: 1 },
      processClass: { type: 'string', optional: true, min: 1 },
      runFrequency: { type: 'string', optional: true, min: 1 },
      massRunVolume: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      affectedDomains: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      customerCommunicationImpact: { type: 'string', optional: true, min: 1 },
      billingImpact: { type: 'string', optional: true, min: 1 },
      marketCommunicationImpact: { type: 'string', optional: true, min: 1 },
      massDataImpact: { type: 'string', optional: true, min: 1 },
      testCaseCoverage: { type: 'string', optional: true, min: 1 },
      edgeCaseCatalog: { type: 'string', optional: true, min: 1 },
      acceptanceMethod: { type: 'string', optional: true, min: 1 },
      monitoringSignals: { type: 'string', optional: true, min: 1 },
      stopCriteria: { type: 'string', optional: true, min: 1 },
      rollbackPath: { type: 'string', optional: true, min: 1 },
      processOwner: { type: 'string', optional: true, min: 1 },
      operationsOwner: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      missingEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      riskLevel: { type: 'string', optional: true, min: 1 },
      source: { type: 'string', optional: true, min: 1 },
      sourceRef: {
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
      summary: 'Automation Risk Gate -- read-only dossier-safe status',
      description:
        'Builds deterministic RPA / automation risk readiness from supplied process facts. ' +
        'The endpoint is read-only and does not run bots, trigger mass-runs, mutate workflows, create approvals, or call external systems.',
      responses: {
        200: {
          description: 'Read-only automation-risk readiness evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'processId', schema: { type: 'string' } },
        { in: 'query', name: 'processName', schema: { type: 'string' } },
        { in: 'query', name: 'processClass', schema: { type: 'string' } },
        { in: 'query', name: 'runFrequency', schema: { type: 'string' } },
        { in: 'query', name: 'massRunVolume', schema: { type: 'string' } },
        { in: 'query', name: 'affectedDomains', schema: { type: 'string' } },
        { in: 'query', name: 'customerCommunicationImpact', schema: { type: 'string' } },
        { in: 'query', name: 'billingImpact', schema: { type: 'string' } },
        { in: 'query', name: 'marketCommunicationImpact', schema: { type: 'string' } },
        { in: 'query', name: 'massDataImpact', schema: { type: 'string' } },
        { in: 'query', name: 'testCaseCoverage', schema: { type: 'string' } },
        { in: 'query', name: 'edgeCaseCatalog', schema: { type: 'string' } },
        { in: 'query', name: 'acceptanceMethod', schema: { type: 'string' } },
        { in: 'query', name: 'monitoringSignals', schema: { type: 'string' } },
        { in: 'query', name: 'stopCriteria', schema: { type: 'string' } },
        { in: 'query', name: 'rollbackPath', schema: { type: 'string' } },
        { in: 'query', name: 'processOwner', schema: { type: 'string' } },
        { in: 'query', name: 'operationsOwner', schema: { type: 'string' } },
        { in: 'query', name: 'blockedDecision', schema: { type: 'string' } },
        { in: 'query', name: 'missingEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'riskLevel', schema: { type: 'string' } },
        { in: 'query', name: 'source', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `automation-risk-gate:${params.processId || params.processName || 'no-process'}:${params.testCaseCoverage || ''}:${params.edgeCaseCatalog || ''}:${params.stopCriteria || ''}:${params.rollbackPath || ''}:${params.monitoringSignals || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.automationRiskGateStatus,
        async () => ({
          ...this.buildAutomationRiskGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  redispatchProjectControllingKpiCockpitStatus: {
    rest: 'GET /redispatch-project-controlling-kpi-cockpit',
    params: {
      cockpitId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      period: { type: 'string', optional: true, min: 1 },
      redispatchAuditId: { type: 'string', optional: true, min: 1 },
      settlementRef: { type: 'string', optional: true, min: 1 },
      vdmiProcessId: { type: 'string', optional: true, min: 1 },
      taskId: { type: 'string', optional: true, min: 1 },
      taskStatus: { type: 'string', optional: true, min: 1 },
      taskOwner: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      decisionBlocker: { type: 'string', optional: true, min: 1 },
      hasRedispatchAudit: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      hasAssetEvidence: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      hasMastrEvidence: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      hasLoadProfileEvidence: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      hasSettlementReadiness: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      hasKpiReference: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      datasourceHealth: { type: 'string', optional: true, min: 1 },
      sourceFreshness: { type: 'string', optional: true, min: 1 },
      qualityStatus: { type: 'string', optional: true, min: 1 },
      staleSources: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      tasks: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'array' }, { type: 'string', min: 1 }],
      },
      kpiSignals: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'array' }, { type: 'string', min: 1 }],
      },
      sourceHealth: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'array' }, { type: 'string', min: 1 }],
      },
      affectedAssets: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      missingEvidence: {
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
      summary: 'Redispatch project-controlling KPI cockpit -- read-only evidence gate',
      description:
        'Builds deterministic Redispatch project-controlling and KPI readiness from supplied facts and references. ' +
        'The endpoint is read-only and does not execute Redispatch orders, settlement, billing, task/workflow/HITL/VDMI mutation, datasource ingestion, asset mutation, or external calls.',
      responses: {
        200: {
          description: 'Read-only Redispatch project-controlling KPI evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'cockpitId', schema: { type: 'string' } },
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'period', schema: { type: 'string' } },
        { in: 'query', name: 'redispatchAuditId', schema: { type: 'string' } },
        { in: 'query', name: 'settlementRef', schema: { type: 'string' } },
        { in: 'query', name: 'vdmiProcessId', schema: { type: 'string' } },
        { in: 'query', name: 'taskId', schema: { type: 'string' } },
        { in: 'query', name: 'taskStatus', schema: { type: 'string' } },
        { in: 'query', name: 'taskOwner', schema: { type: 'string' } },
        { in: 'query', name: 'dueDate', schema: { type: 'string' } },
        { in: 'query', name: 'blockedDecision', schema: { type: 'string' } },
        { in: 'query', name: 'decisionBlocker', schema: { type: 'string' } },
        { in: 'query', name: 'hasRedispatchAudit', schema: { type: 'string' } },
        { in: 'query', name: 'hasAssetEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'hasMastrEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'hasLoadProfileEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'hasSettlementReadiness', schema: { type: 'string' } },
        { in: 'query', name: 'hasKpiReference', schema: { type: 'string' } },
        { in: 'query', name: 'datasourceHealth', schema: { type: 'string' } },
        { in: 'query', name: 'sourceFreshness', schema: { type: 'string' } },
        { in: 'query', name: 'qualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'staleSources', schema: { type: 'string' } },
        { in: 'query', name: 'tasks', schema: { type: 'string' } },
        { in: 'query', name: 'kpiSignals', schema: { type: 'string' } },
        { in: 'query', name: 'sourceHealth', schema: { type: 'string' } },
        { in: 'query', name: 'affectedAssets', schema: { type: 'string' } },
        { in: 'query', name: 'missingEvidence', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `redispatch-project-controlling-kpi:${params.cockpitId || params.redispatchAuditId || 'no-cockpit'}:${params.period || ''}:${params.redispatchAuditId || ''}:${params.settlementRef || ''}:${params.taskOwner || ''}:${params.blockedDecision || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.redispatchProjectControllingKpiCockpitStatus,
        async () => ({
          ...this.buildRedispatchProjectControllingKpiCockpitStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  stadtwerkMauerVdmiProfileStatus: {
    rest: 'GET /stadtwerk-mauer-vdmi-profile',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      includeRoles: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      includeEvidenceGaps: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      demoQuestion: { type: 'string', optional: true, min: 1 },
      focusSparte: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer VDMI profile -- read-only dossier-safe status',
      description:
        'Returns the deterministic Stadtwerk Mauer MVP profile, sparten, VDMI roles, evidence gaps, and side-effect guards. ' +
        'The endpoint is read-only and does not create tenants, Eve agents, workflows, NOVA/VDMI/HITL objects, or external calls.',
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer VDMI/profile evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'includeRoles', schema: { type: 'string' } },
        { in: 'query', name: 'includeEvidenceGaps', schema: { type: 'string' } },
        { in: 'query', name: 'demoQuestion', schema: { type: 'string' } },
        { in: 'query', name: 'focusSparte', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `stadtwerk-mauer-vdmi-profile:${params.tenantId || 'stadtwerk-mauer'}:${params.focusSparte || ''}:${params.includeRoles || ''}:${params.includeEvidenceGaps || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerVdmiProfileStatus,
        async () => ({
          ...this.buildStadtwerkMauerVdmiProfileStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  stadtwerkMauerCapabilityProjectionStatus: {
    rest: 'GET /stadtwerk-mauer-capability-projection',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      roles: { type: 'string', optional: true, min: 1 },
      includeConsequential: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
      includeDescriptorSources: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'boolean' }, { type: 'string', min: 1 }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer capability projection -- read-only role/VDMI view',
      description:
        'Returns a deterministic role-scoped capability projection for Stadtwerk Mauer based on existing VDMI profile, catalog, hydration, and generated descriptor sources. ' +
        'The endpoint is read-only and does not create Eve agents, workflows, tasks, NOVA/VDMI/HITL objects, tenants, tokens, or external calls.',
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer role/capability projection',
        },
      },

      parameters: [
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'roles', schema: { type: 'string' } },
        { in: 'query', name: 'includeConsequential', schema: { type: 'string' } },
        { in: 'query', name: 'includeDescriptorSources', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `stadtwerk-mauer-capability-projection:${params.tenantId || 'stadtwerk-mauer'}:${params.roles || 'core'}:${params.includeConsequential ?? 'true'}:${params.includeDescriptorSources ?? 'true'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerCapabilityProjectionStatus,
        async () => ({
          ...this.buildStadtwerkMauerCapabilityProjectionStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  stadtwerkMauerEventReplayPreviewStatus: {
    rest: 'GET /stadtwerk-mauer-event-replay-preview',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      seed: { type: 'string', optional: true, min: 1 },
      count: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      eventType: { type: 'string', optional: true, min: 1 },
      sparte: { type: 'string', optional: true, min: 1 },
      marketRole: { type: 'string', optional: true, min: 1 },
      sourceActor: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer event replay preview -- read-only synthetic event catalog',
      description:
        'Returns deterministic synthetic Stadtwerk Mauer event templates and replay envelopes. ' +
        'The endpoint is read-only and does not schedule, persist, inject, publish, execute, or externally send events.',
      responses: {
        200: {
          description: 'Read-only deterministic Stadtwerk Mauer event replay preview',
        },
      },

      parameters: [
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'seed', schema: { type: 'string' } },
        { in: 'query', name: 'count', schema: { type: 'string' } },
        { in: 'query', name: 'eventType', schema: { type: 'string' } },
        { in: 'query', name: 'sparte', schema: { type: 'string' } },
        { in: 'query', name: 'marketRole', schema: { type: 'string' } },
        { in: 'query', name: 'sourceActor', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `stadtwerk-mauer-event-replay-preview:${params.seed || 'stadtwerk-mauer-demo'}:${params.count || ''}:${params.eventType || ''}:${params.sparte || ''}:${params.marketRole || ''}:${params.sourceActor || ''}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerEventReplayPreviewStatus,
        async () => ({
          ...this.buildStadtwerkMauerEventReplayPreviewStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  stadtwerkMauerSandboxRuntimeStatus: {
    rest: 'GET /stadtwerk-mauer-sandbox-runtime',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer sandbox runtime -- read-only dossier-safe status',
      description:
        'Reports deterministic Stadtwerk Mauer sandbox runtime state, reset/delete readiness, ' +
        'derived artifact counts and source-action guards. The endpoint is read-only; sandbox ' +
        'ingest/reset mutation actions are separate and not used for dossier hydration.',
      parameters: [{ name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer sandbox runtime status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  tenantId: { type: 'string' },
                  eventCount: { type: 'number' },
                  artifactCount: { type: 'number' },
                  derivedStateInventory: { type: 'object' },
                  resetDeleteReadiness: { type: 'object' },
                  lastResetResult: { type: 'object', nullable: true },
                  missingLifecycleEvidence: { type: 'array' },
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
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const errors = [];
      const status = await this.safeCall(
        ctx,
        'stadtwerk-mauer-sandbox-runtime.status',
        { tenantId },
        this.buildMissingStadtwerkMauerSandboxRuntimeStatus(tenantId),
        errors,
        'stadtwerk-mauer-sandbox-runtime.status'
      );
      return {
        ...status,
        timestamp: new Date().toISOString(),
        _errors: errors,
      };
    },
  },

  stadtwerkMauerExternalInterfaceStubsStatus: {
    rest: 'GET /stadtwerk-mauer-external-interface-stubs',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      limit: { type: 'number', optional: true, convert: true, min: 1, max: 50 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer external-interface stubs -- read-only status',
      description:
        'Reports deterministic sandbox stub transcripts, response variants, missing evidence, ' +
        'reset boundary and no-call guards. The endpoint is read-only; stub calls are separate ' +
        'sandbox-only non-consequential mutations.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer external-interface stub status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  tenantId: { type: 'string' },
                  transcriptCount: { type: 'number' },
                  artifactCount: { type: 'number' },
                  familyCounts: { type: 'object' },
                  variantCounts: { type: 'object' },
                  recentTranscripts: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  resetBoundary: { type: 'object' },
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
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const errors = [];
      const status = await this.safeCall(
        ctx,
        'stadtwerk-mauer-external-interface-stubs.getStatus',
        { tenantId, limit: params.limit },
        this.buildMissingStadtwerkMauerExternalInterfaceStubsStatus(tenantId),
        errors,
        'stadtwerk-mauer-external-interface-stubs.getStatus'
      );
      return {
        ...status,
        timestamp: new Date().toISOString(),
        _errors: errors,
      };
    },
  },
};
