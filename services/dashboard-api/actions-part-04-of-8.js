'use strict';

// dashboard-api actions chunk 4/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: legacyControlTechnologyTransitionStatus, controllabilitySubmissionCockpitStatus, crisisDecisionRoutineStatus, investmentCommitteeSteeringCardsStatus, investmentDataReviewQueueStatus, flexStrategicDemandIntakeStatus, gasInfrastructureRiskGovernanceStatus, meteringRolloutProcessIndicatorStatus, heatTransformationLineAssetModelStatus, kiFloorwalkerGovernanceStatus, investmentWaterfallGovernanceStatus, capacityContractRiskAssetCockpitStatus, imsysTaf2ComplianceStatus, scheduleManagementGovernanceRoadmapStatus, gasTransformationDependencyMapStatus, gasTransformationDataroomStatus

const { OPENAPI_TAG } = require('./shared');

module.exports = {
  legacyControlTechnologyTransitionStatus: {
    rest: 'GET /legacy-control-technology-transition',
    params: {
      assetGroupId: { type: 'string', optional: true, min: 1 },
      assetId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      powerClass: { type: 'string', optional: true, min: 1 },
      controlTechnology: { type: 'string', optional: true, min: 1 },
      feedbackCapability: { type: 'string', optional: true, min: 1 },
      switchingRisk: { type: 'string', optional: true, min: 1 },
      testFeasibility: { type: 'string', optional: true, min: 1 },
      testStatus: { type: 'string', optional: true, min: 1 },
      nonExecutionReason: { type: 'string', optional: true, min: 1 },
      targetTechnology: { type: 'string', optional: true, min: 1 },
      migrationRoadmap: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
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
      summary: 'Legacy control technology transition — read-only dossier-safe gate',
      description:
        'Builds a deterministic evidence view for Rundsteuertechnik/Gruppensignal transition readiness. ' +
        'The endpoint is read-only and does not execute grid control, CLS, SMGW, device-control, HITL, settlement, MaKo, external connector or Personal-Agent side effects.',
      responses: {
        200: {
          description: 'Read-only legacy control technology transition status',
        },
      },

      parameters: [
        { in: 'query', name: 'assetGroupId', schema: { type: 'string' } },
        { in: 'query', name: 'assetId', schema: { type: 'string' } },
        { in: 'query', name: 'gridOperatorId', schema: { type: 'string' } },
        { in: 'query', name: 'powerClass', schema: { type: 'string' } },
        { in: 'query', name: 'controlTechnology', schema: { type: 'string' } },
        { in: 'query', name: 'feedbackCapability', schema: { type: 'string' } },
        { in: 'query', name: 'switchingRisk', schema: { type: 'string' } },
        { in: 'query', name: 'testFeasibility', schema: { type: 'string' } },
        { in: 'query', name: 'testStatus', schema: { type: 'string' } },
        { in: 'query', name: 'nonExecutionReason', schema: { type: 'string' } },
        { in: 'query', name: 'targetTechnology', schema: { type: 'string' } },
        { in: 'query', name: 'migrationRoadmap', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextAction', schema: { type: 'string' } },
        { in: 'query', name: 'sourceEvidenceRefs', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSnapshot', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `legacy-control-transition:${params.assetGroupId || 'no-group'}:${params.assetId || 'no-asset'}:${params.controlTechnology || 'no-tech'}:${params.feedbackCapability || 'no-feedback'}:${params.testStatus || 'no-test'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.legacyControlTechnologyTransitionStatus,
        async () => ({
          ...this.buildLegacyControlTechnologyTransitionStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  controllabilitySubmissionCockpitStatus: {
    rest: 'GET /controllability-submission-cockpit',
    params: {
      submissionId: { type: 'string', optional: true, min: 1 },
      submissionDeadline: { type: 'string', optional: true, min: 1 },
      coordinator: { type: 'string', optional: true, min: 1 },
      sourceList: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      dataReconciliationStatus: { type: 'string', optional: true, min: 1 },
      reasonCatalog: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      assetGroupStatuses: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      openMeasures: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      handoverDecision: { type: 'string', optional: true, min: 1 },
      handoverOwner: { type: 'string', optional: true, min: 1 },
      nextCycleTasks: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      deadlineRisks: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
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
      summary: 'Controllability submission cockpit — read-only dossier-safe gate',
      description:
        'Builds a deterministic evidence view for Steuerbarkeitscheck submission readiness and handover. ' +
        'The endpoint is read-only and does not create HITL items, submit filings, execute grid, CLS, SMGW or device control, mutate MaKo, billing, settlement or tariff processes, call external connectors, or use Personal-Agent shortcuts.',
      responses: {
        200: {
          description: 'Read-only controllability submission cockpit status',
        },
      },

      parameters: [
        { in: 'query', name: 'submissionId', schema: { type: 'string' } },
        { in: 'query', name: 'submissionDeadline', schema: { type: 'string' } },
        { in: 'query', name: 'coordinator', schema: { type: 'string' } },
        { in: 'query', name: 'sourceList', schema: { type: 'string' } },
        { in: 'query', name: 'dataReconciliationStatus', schema: { type: 'string' } },
        { in: 'query', name: 'reasonCatalog', schema: { type: 'string' } },
        { in: 'query', name: 'assetGroupStatuses', schema: { type: 'string' } },
        { in: 'query', name: 'openMeasures', schema: { type: 'string' } },
        { in: 'query', name: 'handoverDecision', schema: { type: 'string' } },
        { in: 'query', name: 'handoverOwner', schema: { type: 'string' } },
        { in: 'query', name: 'nextCycleTasks', schema: { type: 'string' } },
        { in: 'query', name: 'deadlineRisks', schema: { type: 'string' } },
        { in: 'query', name: 'sourceEvidenceRefs', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSnapshot', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `controllability-submission:${params.submissionId || 'no-submission'}:${params.coordinator || 'no-coordinator'}:${params.dataReconciliationStatus || 'no-reconciliation'}:${params.handoverDecision || 'no-handover'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.controllabilitySubmissionCockpitStatus,
        async () => ({
          ...this.buildControllabilitySubmissionCockpitStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  crisisDecisionRoutineStatus: {
    rest: 'GET /crisis-decision-routine',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      topic: { type: 'string', optional: true, min: 1 },
      serviceImpact: { type: 'string', optional: true, min: 1 },
      populationImpact: { type: 'string', optional: true, min: 1 },
      requiredMeasures: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      financeImpact: { type: 'string', optional: true, min: 1 },
      knowledgeState: { type: 'string', optional: true, min: 1 },
      trainingNeed: { type: 'string', optional: true, min: 1 },
      operatingModelNeed: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextGate: { type: 'string', optional: true, min: 1 },
      blockedFollowUp: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      decisionDeadline: { type: 'string', optional: true, min: 1 },
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
      summary: 'Crisis decision routine — read-only dossier-safe management gate',
      description:
        'Builds deterministic management-readiness evidence for crisis/ad-hoc topics. ' +
        'The endpoint is read-only and does not create HITL, NOVA or VDMI items, mutate finance or operations data, call external connectors, close decisions, dispatch operational actions, or use Personal-Agent shortcuts.',
      responses: {
        200: {
          description: 'Read-only crisis decision routine status',
        },
      },

      parameters: [
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
        { in: 'query', name: 'topic', schema: { type: 'string' } },
        { in: 'query', name: 'serviceImpact', schema: { type: 'string' } },
        { in: 'query', name: 'populationImpact', schema: { type: 'string' } },
        { in: 'query', name: 'requiredMeasures', schema: { type: 'string' } },
        { in: 'query', name: 'financeImpact', schema: { type: 'string' } },
        { in: 'query', name: 'knowledgeState', schema: { type: 'string' } },
        { in: 'query', name: 'trainingNeed', schema: { type: 'string' } },
        { in: 'query', name: 'operatingModelNeed', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextGate', schema: { type: 'string' } },
        { in: 'query', name: 'blockedFollowUp', schema: { type: 'string' } },
        { in: 'query', name: 'decisionDeadline', schema: { type: 'string' } },
        { in: 'query', name: 'sourceEvidenceRefs', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSnapshot', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `crisis-decision-routine:${params.caseId || 'no-case'}:${params.topic || 'no-topic'}:${params.owner || 'no-owner'}:${params.nextGate || 'no-gate'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.crisisDecisionRoutineStatus,
        async () => ({
          ...this.buildCrisisDecisionRoutineStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  investmentCommitteeSteeringCardsStatus: {
    rest: 'GET /investment-committee-steering-cards',
    params: {
      investmentItemId: { type: 'string', optional: true, min: 1 },
      projectId: { type: 'string', optional: true, min: 1 },
      assetId: { type: 'string', optional: true, min: 1 },
      reviewStatus: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      committeeWindow: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      blockedFollowUpAction: { type: 'string', optional: true, min: 1 },
      capexEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      riskFlag: { type: 'string', optional: true, min: 1 },
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
      summary: 'Investment committee steering cards — read-only dossier-safe status',
      description:
        'Builds deterministic investment committee steering-card evidence. ' +
        'The endpoint is read-only and does not create HITL, VDMI or investment-plan records, mutate finance data, release budgets, call external connectors, trigger billing/settlement/tariff/payment effects, or use Personal-Agent shortcuts.',
      responses: {
        200: {
          description: 'Read-only investment committee steering card status',
        },
      },

      parameters: [
        { in: 'query', name: 'investmentItemId', schema: { type: 'string' } },
        { in: 'query', name: 'projectId', schema: { type: 'string' } },
        { in: 'query', name: 'assetId', schema: { type: 'string' } },
        { in: 'query', name: 'reviewStatus', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'committeeWindow', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'blockedFollowUpAction', schema: { type: 'string' } },
        { in: 'query', name: 'capexEur', schema: { type: 'string' } },
        { in: 'query', name: 'riskFlag', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `investment-committee-steering-cards:${params.investmentItemId || 'no-item'}:${params.projectId || 'no-project'}:${params.assetId || 'no-asset'}:${params.owner || 'no-owner'}:${params.committeeWindow || 'no-window'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.investmentCommitteeSteeringCardsStatus,
        async () => ({
          ...this.buildInvestmentCommitteeSteeringCardsStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  investmentDataReviewQueueStatus: {
    rest: 'GET /investment-data-review-queue',
    params: {
      sourceId: { type: 'string', optional: true, min: 1 },
      dataPackageId: { type: 'string', optional: true, min: 1 },
      assetRef: { type: 'string', optional: true, min: 1 },
      projectRef: { type: 'string', optional: true, min: 1 },
      qualityStatus: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      bottleneckRef: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      committeeWindow: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      reviewStatus: { type: 'string', optional: true, min: 1 },
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
      summary: 'Investment data review queue — read-only dossier-safe status',
      description:
        'Builds deterministic Investdaten-Pruefqueue evidence. ' +
        'The endpoint is read-only and does not create HITL tickets, VDMI records, investment plans, finance records, budget releases, settlement/billing/tariff effects, external connector calls, or Personal-Agent shortcuts.',
      responses: {
        200: {
          description: 'Read-only investment data review queue status',
        },
      },

      parameters: [
        { in: 'query', name: 'sourceId', schema: { type: 'string' } },
        { in: 'query', name: 'dataPackageId', schema: { type: 'string' } },
        { in: 'query', name: 'assetRef', schema: { type: 'string' } },
        { in: 'query', name: 'projectRef', schema: { type: 'string' } },
        { in: 'query', name: 'qualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'division', schema: { type: 'string' } },
        { in: 'query', name: 'bottleneckRef', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'committeeWindow', schema: { type: 'string' } },
        { in: 'query', name: 'blockedDecision', schema: { type: 'string' } },
        { in: 'query', name: 'reviewStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const sourceRef = params.sourceId || params.dataPackageId || 'no-source';
      const assetOrProject = params.assetRef || params.projectRef || 'no-asset-project';
      const cacheKey = `investment-data-review-queue:${sourceRef}:${assetOrProject}:${params.owner || 'no-owner'}:${params.committeeWindow || 'no-window'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.investmentDataReviewQueueStatus,
        async () => ({
          ...this.buildInvestmentDataReviewQueueStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  flexStrategicDemandIntakeStatus: {
    rest: 'GET /flex-strategic-demand-intake',
    params: {
      demandId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      topic: { type: 'string', optional: true, min: 1 },
      demandTopic: { type: 'string', optional: true, min: 1 },
      affectedProcess: { type: 'string', optional: true, min: 1 },
      riskOfInaction: { type: 'string', optional: true, min: 1 },
      commercialQuestion: { type: 'string', optional: true, min: 1 },
      resourceConflict: { type: 'string', optional: true, min: 1 },
      stopDoingOption: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextDecisionGate: { type: 'string', optional: true, min: 1 },
      blockedFollowUp: { type: 'string', optional: true, min: 1 },
      sourceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      flexContext: { type: 'string', optional: true, min: 1 },
      znpContext: { type: 'string', optional: true, min: 1 },
      novaContext: { type: 'string', optional: true, min: 1 },
      financeContext: { type: 'string', optional: true, min: 1 },
      vdmiContext: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Strategic Flex demand intake — read-only dossier-safe status',
      description:
        'Builds deterministic strategic Flex/Fahrplanmanagement demand-intake evidence. ' +
        'The endpoint is read-only and does not create VDMI cards, HITL tickets, NOVA decisions, finance records, tariff/billing/settlement/device-control effects, external connector calls, or Personal-Agent shortcuts.',
      responses: {
        200: {
          description: 'Read-only strategic Flex demand intake status',
        },
      },

      parameters: [
        { in: 'query', name: 'demandId', schema: { type: 'string' } },
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
        { in: 'query', name: 'topic', schema: { type: 'string' } },
        { in: 'query', name: 'demandTopic', schema: { type: 'string' } },
        { in: 'query', name: 'affectedProcess', schema: { type: 'string' } },
        { in: 'query', name: 'riskOfInaction', schema: { type: 'string' } },
        { in: 'query', name: 'commercialQuestion', schema: { type: 'string' } },
        { in: 'query', name: 'resourceConflict', schema: { type: 'string' } },
        { in: 'query', name: 'stopDoingOption', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextDecisionGate', schema: { type: 'string' } },
        { in: 'query', name: 'blockedFollowUp', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
        { in: 'query', name: 'flexContext', schema: { type: 'string' } },
        { in: 'query', name: 'znpContext', schema: { type: 'string' } },
        { in: 'query', name: 'novaContext', schema: { type: 'string' } },
        { in: 'query', name: 'financeContext', schema: { type: 'string' } },
        { in: 'query', name: 'vdmiContext', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const topic = params.topic || params.demandTopic || 'no-topic';
      const cacheKey = `flex-strategic-demand-intake:${params.demandId || params.caseId || 'no-id'}:${topic}:${params.owner || 'no-owner'}:${params.nextDecisionGate || 'no-gate'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.flexStrategicDemandIntakeStatus,
        async () => ({
          ...this.buildFlexStrategicDemandIntakeStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  gasInfrastructureRiskGovernanceStatus: {
    rest: 'GET /gas-infrastructure-risk-governance',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      technicalFact: { type: 'string', optional: true, min: 1 },
      impactArea: { type: 'string', optional: true, min: 1 },
      probability: { type: 'string', optional: true, min: 1 },
      criticality: { type: 'string', optional: true, min: 1 },
      existingMitigation: { type: 'string', optional: true, min: 1 },
      threshold: { type: 'string', optional: true, min: 1 },
      riskRegisterDecision: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextDecisionWindow: { type: 'string', optional: true, min: 1 },
      blockedFollowUp: { type: 'string', optional: true, min: 1 },
      sourceRef: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      vdmiContext: { type: 'string', optional: true, min: 1 },
      hitlContext: { type: 'string', optional: true, min: 1 },
      interfacePlaceholderContext: { type: 'string', optional: true, min: 1 },
      assetContext: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Gas infrastructure risk governance — read-only dossier-safe status',
      description:
        'Builds deterministic gas-infrastructure risk governance evidence. ' +
        'The endpoint is read-only and does not create risk-register entries, HITL tickets, VDMI records, Asset-MDM changes, monitoring/mitigation decisions, operations actions, external connector calls, or Personal-Agent shortcuts.',
      responses: {
        200: {
          description: 'Read-only gas infrastructure risk governance status',
        },
      },

      parameters: [
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
        { in: 'query', name: 'technicalFact', schema: { type: 'string' } },
        { in: 'query', name: 'impactArea', schema: { type: 'string' } },
        { in: 'query', name: 'probability', schema: { type: 'string' } },
        { in: 'query', name: 'criticality', schema: { type: 'string' } },
        { in: 'query', name: 'existingMitigation', schema: { type: 'string' } },
        { in: 'query', name: 'threshold', schema: { type: 'string' } },
        { in: 'query', name: 'riskRegisterDecision', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextDecisionWindow', schema: { type: 'string' } },
        { in: 'query', name: 'blockedFollowUp', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
        { in: 'query', name: 'vdmiContext', schema: { type: 'string' } },
        { in: 'query', name: 'hitlContext', schema: { type: 'string' } },
        { in: 'query', name: 'interfacePlaceholderContext', schema: { type: 'string' } },
        { in: 'query', name: 'assetContext', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `gas-infrastructure-risk-governance:${params.caseId || 'no-case'}:${params.technicalFact || 'no-fact'}:${params.owner || 'no-owner'}:${params.nextDecisionWindow || 'no-window'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gasInfrastructureRiskGovernanceStatus,
        async () => ({
          ...this.buildGasInfrastructureRiskGovernanceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  meteringRolloutProcessIndicatorStatus: {
    rest: 'GET /metering-rollout-process-indicator',
    params: {
      indicatorId: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      sourceType: { type: 'string', optional: true, min: 1 },
      targetCount: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      actualCount: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      backlogCount: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      contractorLoad: { type: 'string', optional: true, min: 1 },
      capexImpactEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      opexImpactEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      owner: { type: 'string', optional: true, min: 1 },
      nextControlStep: { type: 'string', optional: true, min: 1 },
      blockedFollowUp: { type: 'string', optional: true, min: 1 },
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
      summary: 'Metering rollout process indicator — read-only dossier-safe status',
      description:
        'Builds deterministic metering/rollout process evidence from supplied KPI facts. ' +
        'The endpoint is read-only and does not refresh datasources, import EDM data, create HITL tasks, mutate finance/CAPEX state, billing, tariff, settlement, device control, external connectors, or Personal-Agent shortcuts.',
      responses: {
        200: {
          description: 'Read-only metering rollout process-indicator status',
        },
      },

      parameters: [
        { in: 'query', name: 'indicatorId', schema: { type: 'string' } },
        { in: 'query', name: 'division', schema: { type: 'string' } },
        { in: 'query', name: 'sourceType', schema: { type: 'string' } },
        { in: 'query', name: 'targetCount', schema: { type: 'string' } },
        { in: 'query', name: 'actualCount', schema: { type: 'string' } },
        { in: 'query', name: 'backlogCount', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'contractorLoad', schema: { type: 'string' } },
        { in: 'query', name: 'capexImpactEur', schema: { type: 'string' } },
        { in: 'query', name: 'opexImpactEur', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextControlStep', schema: { type: 'string' } },
        { in: 'query', name: 'blockedFollowUp', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `metering-rollout-process-indicator:${params.indicatorId || 'no-id'}:${params.division || 'no-division'}:${params.sourceType || 'no-source'}:${params.owner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.meteringRolloutProcessIndicatorStatus,
        async () => ({
          ...this.buildMeteringRolloutProcessIndicatorStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  heatTransformationLineAssetModelStatus: {
    rest: 'GET /heat-transformation-line-asset-model',
    params: {
      lineAssetId: { type: 'string', optional: true, min: 1 },
      geometryRef: { type: 'string', optional: true, min: 1 },
      connectedPointAssetIds: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      division: { type: 'string', optional: true, min: 1 },
      networkCalculationRef: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      transformationStatus: { type: 'string', optional: true, min: 1 },
      futureOption: { type: 'string', optional: true, min: 1 },
      investmentNeed: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      owner: { type: 'string', optional: true, min: 1 },
      nextDecision: { type: 'string', optional: true, min: 1 },
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
      summary: 'Heat transformation line-asset model — read-only dossier-safe status',
      description:
        'Builds deterministic line-asset evidence from supplied facts. ' +
        'The endpoint is read-only and does not create ZNP projects, point/line assets, datapoints, VDMI dossiers, finance plans, HITL tasks, or trigger device control or external connectors.',
      responses: {
        200: {
          description: 'Read-only heat transformation line-asset model status',
        },
      },

      parameters: [
        { in: 'query', name: 'lineAssetId', schema: { type: 'string' } },
        { in: 'query', name: 'geometryRef', schema: { type: 'string' } },
        { in: 'query', name: 'connectedPointAssetIds', schema: { type: 'string' } },
        { in: 'query', name: 'division', schema: { type: 'string' } },
        { in: 'query', name: 'networkCalculationRef', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'transformationStatus', schema: { type: 'string' } },
        { in: 'query', name: 'futureOption', schema: { type: 'string' } },
        { in: 'query', name: 'investmentNeed', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextDecision', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `heat-transformation-line-asset-model:${params.lineAssetId || 'no-id'}:${params.division || 'no-division'}:${params.owner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.heatTransformationLineAssetModelStatus,
        async () => ({
          ...this.buildHeatTransformationLineAssetModelStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  kiFloorwalkerGovernanceStatus: {
    rest: 'GET /ki-floorwalker-governance',
    params: {
      useCaseId: { type: 'string', optional: true, min: 1 },
      processOwner: { type: 'string', optional: true, min: 1 },
      useCasePriority: { type: 'string', optional: true, min: 1 },
      allowedDataspaces: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      promptStandards: { type: 'string', optional: true, min: 1 },
      processBoundaries: { type: 'string', optional: true, min: 1 },
      rolesAndResponsibilities: { type: 'string', optional: true, min: 1 },
      guidedApplication: { type: 'string', optional: true, min: 1 },
      riskAndApprovalStatus: { type: 'string', optional: true, min: 1 },
      proofOfBenefit: { type: 'string', optional: true, min: 1 },
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
      summary: 'KI Floorwalker governance — read-only dossier-safe status',
      description:
        'Builds deterministic AI governance evidence from supplied facts. ' +
        'The endpoint is read-only and does not run AI/LLM models, prompt databases, or write to HITL/VDMI.',
      responses: {
        200: {
          description: 'Read-only KI Floorwalker governance status',
        },
      },

      parameters: [
        { in: 'query', name: 'useCaseId', schema: { type: 'string' } },
        { in: 'query', name: 'processOwner', schema: { type: 'string' } },
        { in: 'query', name: 'useCasePriority', schema: { type: 'string' } },
        { in: 'query', name: 'allowedDataspaces', schema: { type: 'string' } },
        { in: 'query', name: 'promptStandards', schema: { type: 'string' } },
        { in: 'query', name: 'processBoundaries', schema: { type: 'string' } },
        { in: 'query', name: 'rolesAndResponsibilities', schema: { type: 'string' } },
        { in: 'query', name: 'guidedApplication', schema: { type: 'string' } },
        { in: 'query', name: 'riskAndApprovalStatus', schema: { type: 'string' } },
        { in: 'query', name: 'proofOfBenefit', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `ki-floorwalker-governance:${params.useCaseId || 'no-id'}:${params.processOwner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.kiFloorwalkerGovernanceStatus,
        async () => ({
          ...this.buildKiFloorwalkerGovernanceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  investmentWaterfallGovernanceStatus: {
    rest: 'GET /investment-waterfall-governance',
    params: {
      investmentItemId: { type: 'string', optional: true, min: 1 },
      targetProcess: { type: 'string', optional: true, min: 1 },
      budgetAmount: { type: 'string', optional: true, min: 1 },
      bottleneckRef: { type: 'string', optional: true, min: 1 },
      committeeWindow: { type: 'string', optional: true, min: 1 },
      evidenceReadiness: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
      mandateStatus: { type: 'string', optional: true, min: 1 },
      riskIfDelayed: { type: 'string', optional: true, min: 1 },
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
      summary: 'Investment waterfall governance — read-only dossier-safe status',
      description:
        'Builds deterministic investment waterfall governance evidence from supplied facts. ' +
        'The endpoint is read-only and does not run budget writes or write to HITL/VDMI.',
      responses: {
        200: {
          description: 'Read-only investment waterfall governance status',
        },
      },

      parameters: [
        { in: 'query', name: 'investmentItemId', schema: { type: 'string' } },
        { in: 'query', name: 'targetProcess', schema: { type: 'string' } },
        { in: 'query', name: 'budgetAmount', schema: { type: 'string' } },
        { in: 'query', name: 'bottleneckRef', schema: { type: 'string' } },
        { in: 'query', name: 'committeeWindow', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceReadiness', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextAction', schema: { type: 'string' } },
        { in: 'query', name: 'mandateStatus', schema: { type: 'string' } },
        { in: 'query', name: 'riskIfDelayed', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `investment-waterfall-governance:${params.investmentItemId || 'no-id'}:${params.targetProcess || 'no-process'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.investmentWaterfallGovernanceStatus,
        async () => ({
          ...this.buildInvestmentWaterfallGovernanceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  capacityContractRiskAssetCockpitStatus: {
    rest: 'GET /capacity-contract-risk-asset-cockpit',
    params: {
      gridOperatorId: { type: 'string', min: 1 },
      utilization: { type: 'number', optional: true },
      bottleneck: { type: 'string', optional: true, min: 1 },
      firmCapacityKW: { type: 'number', optional: true },
      flexibleCapacityKW: { type: 'number', optional: true },
      contractStatus: { type: 'string', optional: true, min: 1 },
      legalStatus: { type: 'string', optional: true, min: 1 },
      altvereinbarung: { type: 'boolean', optional: true },
      capex: { type: 'number', optional: true },
      opex: { type: 'number', optional: true },
      priority: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
      forecast: { type: 'boolean', optional: true },
      date: { type: 'string', optional: true, min: 1 },
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
      summary: 'Capacity & Contract Risk Asset Cockpit — read-only dossier-safe status',
      description:
        'Builds deterministic risk and decision status from supplied capacity and contract facts. ' +
        'The endpoint is read-only and does not run budget writes or write to ZNP, assets, HITL, or VDMI.',
      responses: {
        200: {
          description: 'Read-only capacity and contract risk status',
        },
      },

      parameters: [
        { in: 'query', name: 'gridOperatorId', required: true, schema: { type: 'string' } },
        { in: 'query', name: 'utilization', schema: { type: 'number' } },
        { in: 'query', name: 'bottleneck', schema: { type: 'string' } },
        { in: 'query', name: 'firmCapacityKW', schema: { type: 'number' } },
        { in: 'query', name: 'flexibleCapacityKW', schema: { type: 'number' } },
        { in: 'query', name: 'contractStatus', schema: { type: 'string' } },
        { in: 'query', name: 'legalStatus', schema: { type: 'string' } },
        { in: 'query', name: 'altvereinbarung', schema: { type: 'boolean' } },
        { in: 'query', name: 'capex', schema: { type: 'number' } },
        { in: 'query', name: 'opex', schema: { type: 'number' } },
        { in: 'query', name: 'priority', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextAction', schema: { type: 'string' } },
        { in: 'query', name: 'forecast', schema: { type: 'boolean' } },
        { in: 'query', name: 'date', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `capacity-contract-risk:${params.gridOperatorId}:${params.contractStatus || 'no-contract'}:${params.owner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.capacityContractRiskAssetCockpitStatus,
        async () => ({
          ...this.buildCapacityContractRiskAssetCockpitStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  imsysTaf2ComplianceStatus: {
    rest: 'GET /imsys-taf2-compliance',
    params: {
      meteringPointId: { type: 'string', min: 1 },
      taf2Obligation: { type: 'boolean', optional: true },
      targetDeadline: { type: 'string', optional: true, min: 1 },
      tariffModel: { type: 'string', optional: true, min: 1 },
      implementationStatus: { type: 'string', optional: true, min: 1 },
      measuredValueAccess: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
      forecast: { type: 'boolean', optional: true },
      date: { type: 'string', optional: true, min: 1 },
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
      summary: 'iMSys TAF2 compliance status — read-only dossier-safe status',
      description:
        'Builds deterministic compliance evidence from supplied facts. ' +
        'The endpoint is read-only and does not run budget writes or write to HITL/VDMI.',
      responses: {
        200: {
          description: 'Read-only iMSys TAF2 compliance status',
        },
      },

      parameters: [
        { in: 'query', name: 'meteringPointId', required: true, schema: { type: 'string' } },
        { in: 'query', name: 'taf2Obligation', schema: { type: 'boolean' } },
        { in: 'query', name: 'targetDeadline', schema: { type: 'string' } },
        { in: 'query', name: 'tariffModel', schema: { type: 'string' } },
        { in: 'query', name: 'implementationStatus', schema: { type: 'string' } },
        { in: 'query', name: 'measuredValueAccess', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextAction', schema: { type: 'string' } },
        { in: 'query', name: 'forecast', schema: { type: 'boolean' } },
        { in: 'query', name: 'date', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `imsys-taf2-compliance:${params.meteringPointId || 'no-id'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.imsysTaf2ComplianceStatus,
        async () => ({
          ...this.buildImsysTaf2ComplianceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  scheduleManagementGovernanceRoadmapStatus: {
    rest: 'GET /schedule-management-governance-roadmap',
    params: {
      meteringPointId: { type: 'string', optional: true, min: 1 },
      targetState: { type: 'string', optional: true, min: 1 },
      capabilityMaturity: { type: 'string', optional: true, min: 1 },
      dataObjects: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      systemIntegrations: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      roleOwnership: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      redispatchBoundary: { type: 'string', optional: true, min: 1 },
      fnavReadiness: { type: 'string', optional: true, min: 1 },
      capacityManagementGaps: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      roadmapItems: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      decisionMeetings: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      owner: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
      forecast: { type: 'boolean', optional: true },
      date: { type: 'string', optional: true, min: 1 },
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
      summary: 'Fahrplanmanagement Governance Roadmap — read-only dossier-safe status',
      description:
        'Builds deterministic roadmap and status from supplied facts. ' +
        'The endpoint is read-only and does not run dispatch/writes or write to ZNP, assets, HITL, or VDMI.',
      responses: {
        200: {
          description: 'Read-only schedule management status and roadmap evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'meteringPointId', schema: { type: 'string' } },
        { in: 'query', name: 'targetState', schema: { type: 'string' } },
        { in: 'query', name: 'capabilityMaturity', schema: { type: 'string' } },
        { in: 'query', name: 'dataObjects', schema: { type: 'string' } },
        { in: 'query', name: 'systemIntegrations', schema: { type: 'string' } },
        { in: 'query', name: 'roleOwnership', schema: { type: 'string' } },
        { in: 'query', name: 'redispatchBoundary', schema: { type: 'string' } },
        { in: 'query', name: 'fnavReadiness', schema: { type: 'string' } },
        { in: 'query', name: 'capacityManagementGaps', schema: { type: 'string' } },
        { in: 'query', name: 'roadmapItems', schema: { type: 'string' } },
        { in: 'query', name: 'decisionMeetings', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextAction', schema: { type: 'string' } },
        { in: 'query', name: 'forecast', schema: { type: 'boolean' } },
        { in: 'query', name: 'date', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `schedule-management-governance:${params.meteringPointId || 'no-melo'}:${params.targetState || 'no-target'}:${params.owner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.scheduleManagementGovernanceRoadmapStatus,
        async () => ({
          ...this.buildScheduleManagementGovernanceRoadmapStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  gasTransformationDependencyMapStatus: {
    rest: 'GET /gas-transformation-dependency-map',
    params: {
      projectId: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      nodes: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      dependencies: {
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
      investmentPaths: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      decommissionRepurposePaths: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      customerGroups: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      owner: { type: 'string', optional: true, min: 1 },
      nextAction: { type: 'string', optional: true, min: 1 },
      forecast: { type: 'boolean', optional: true },
      date: { type: 'string', optional: true, min: 1 },
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
      summary:
        'Gas- und Waermetransformation Abhaengigkeitslandkarte — read-only dossier-safe status',
      description:
        'Builds deterministic dependency map and status from supplied facts. ' +
        'The endpoint is read-only and does not run writes to ZNP, assets, HITL, or VDMI.',
      responses: {
        200: {
          description: 'Read-only gas and heat transformation status and dependency map evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'projectId', schema: { type: 'string' } },
        { in: 'query', name: 'division', schema: { type: 'string' } },
        { in: 'query', name: 'nodes', schema: { type: 'string' } },
        { in: 'query', name: 'dependencies', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityGaps', schema: { type: 'string' } },
        { in: 'query', name: 'investmentPaths', schema: { type: 'string' } },
        { in: 'query', name: 'decommissionRepurposePaths', schema: { type: 'string' } },
        { in: 'query', name: 'customerGroups', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'nextAction', schema: { type: 'string' } },
        { in: 'query', name: 'forecast', schema: { type: 'boolean' } },
        { in: 'query', name: 'date', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `gas-transformation-dependency:${params.projectId || 'no-project'}:${params.division || 'no-division'}:${params.owner || 'no-owner'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gasTransformationDependencyMapStatus,
        async () => ({
          ...this.buildGasTransformationDependencyMapStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  gasTransformationDataroomStatus: {
    rest: 'GET /gas-transformation-dataroom',
    params: {
      roomId: { type: 'string', optional: true, min: 1 },
      mandateId: { type: 'string', optional: true, min: 1 },
      profile: { type: 'string', optional: true, min: 1 },
      transformationPath: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      scenarioReference: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      decisionStatus: { type: 'string', optional: true, min: 1 },
      roadmapStatus: { type: 'string', optional: true, min: 1 },
      reviewDate: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      reviewer: { type: 'string', optional: true, min: 1 },
      lifecycleStatus: { type: 'string', optional: true, min: 1 },
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
      summary: 'Gasnetz-Transformationsdatenraum -- read-only status snapshot',
      description:
        'Returns a deterministic dossier-safe status and evidence snapshot for a Gasnetz-Transformationsdatenraum. The endpoint is read-only and does not write Object-Store documents, ingest Knowledge-RAG sources, mutate ACL/export/archive state, create review snapshots, decide EOG/KANU/GasNEV matters, approve investments, create HITL/workflow items, call external connectors, or add Personal-Agent shortcuts.',
      parameters: [
        { in: 'query', name: 'roomId', schema: { type: 'string' } },
        { in: 'query', name: 'mandateId', schema: { type: 'string' } },
        { in: 'query', name: 'profile', schema: { type: 'string' } },
        { in: 'query', name: 'transformationPath', schema: { type: 'string' } },
        { in: 'query', name: 'scenarioReference', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'decisionStatus', schema: { type: 'string' } },
        { in: 'query', name: 'roadmapStatus', schema: { type: 'string' } },
        { in: 'query', name: 'reviewDate', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'reviewer', schema: { type: 'string' } },
        { in: 'query', name: 'lifecycleStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRefs', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Gasnetz-Transformationsdatenraum status evidence',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `gas-transformation-dataroom:${params.roomId || 'no-room'}:${params.mandateId || 'no-mandate'}:${params.reviewDate || 'no-review-date'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gasTransformationDataroomStatus,
        async () => ({
          ...this.buildGasTransformationDataroomStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },
};
