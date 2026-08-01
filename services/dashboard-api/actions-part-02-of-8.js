'use strict';

// dashboard-api actions chunk 2/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: costReviewCommitteeStatus, redispatchParticipationReadinessStatus, mastrSyncGapStatus, decommissionedAssetReconciliationStatus, energySharingCollectiveApprovalStatus, steeringArtifactAcceptanceGateStatus, communicationBreakProcessRiskStatus, noRegretMeasureProofGateStatus, anschlusskapazitaetEvidenceQueueStatus, connectionDeadlineEvidenceQueueStatus, layer0AuditDrilldownNoteStatus, legalClarificationOperatingModelStatus, drReadinessEvidenceStatus, specialGridUsageImpactMapStatus, liquidityPlanningGovernanceStatus, energySharingSimulationGateStatus

const { OPENAPI_TAG } = require('./shared');

module.exports = {
  costReviewCommitteeStatus: {
    rest: 'GET /cost-review-committee-status',
    params: {
      reviewId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      reviewStatus: { type: 'string', optional: true, min: 1 },
      dataOrigin: { type: 'string', optional: true, min: 1 },
      assetRelevance: { type: 'string', optional: true, min: 1 },
      revenueRelevance: { type: 'string', optional: true, min: 1 },
      decisionReadiness: { type: 'string', optional: true, min: 1 },
      escalationThreshold: { type: 'string', optional: true, min: 1 },
      nextCommitteeGate: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      amountClass: { type: 'string', optional: true, min: 1 },
      rationale: { type: 'string', optional: true, min: 1 },
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
      summary: 'Cost review committee status - read-only dossier-safe evidence board',
      description:
        'Builds a deterministic evidence and committee-readiness view for cost reviews. ' +
        'The endpoint is read-only and does not write ERP/SAP/PSP/accounting records, approve ' +
        'budgets, execute committee decisions, create HITL/workflow items, send messages or call external connectors.',
      parameters: [
        { name: 'reviewId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'reviewStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataOrigin', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetRelevance', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'revenueRelevance', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionReadiness', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'escalationThreshold', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextCommitteeGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'amountClass', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'rationale', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'evidenceRefs',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
      ],
      responses: {
        200: {
          description: 'Read-only cost review evidence board',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  safety: { type: 'string' },
                  evidenceItems: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  owner: { type: 'string' },
                  reviewStatus: { type: 'string' },
                  dataOrigin: { type: 'string' },
                  assetRelevance: { type: 'string' },
                  revenueRelevance: { type: 'string' },
                  decisionReadiness: { type: 'string' },
                  escalationThreshold: { type: 'string' },
                  nextCommitteeGate: { type: 'string' },
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
      const cacheKey = `cost-review-committee-status:${params.reviewId || params.caseId || 'no-review'}:${params.owner || 'no-owner'}:${params.reviewStatus || 'no-review-status'}:${params.dataOrigin || 'no-origin'}:${params.assetRelevance || 'no-asset'}:${params.revenueRelevance || 'no-revenue'}:${params.decisionReadiness || 'no-readiness'}:${params.escalationThreshold || 'no-threshold'}:${params.nextCommitteeGate || 'no-gate'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.costReviewCommitteeStatus,
        async () => ({
          ...this.buildCostReviewCommitteeStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  redispatchParticipationReadinessStatus: {
    rest: 'GET /redispatch-participation-readiness-status',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      syntheticRedispatchAssetPortfolio: { type: 'string', optional: true },
      installationGridLocationEvidence: { type: 'string', optional: true },
      remoteControlCommunicationTestEvidence: { type: 'string', optional: true },
      forecastDispatchTestProof: { type: 'string', optional: true },
      readinessReviewDecision: { type: 'string', optional: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Redispatch participation readiness status -- read-only Workbench projection',
      description: 'Builds deterministic redispatch readiness evidence from supplied facts.',
      responses: {
        200: {
          description: 'Read-only Redispatch participation readiness status',
        },
      },
      parameters: [
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'syntheticRedispatchAssetPortfolio', schema: { type: 'string' } },
        { in: 'query', name: 'installationGridLocationEvidence', schema: { type: 'string' } },
        {
          in: 'query',
          name: 'remoteControlCommunicationTestEvidence',
          schema: { type: 'string' },
        },
        { in: 'query', name: 'forecastDispatchTestProof', schema: { type: 'string' } },
        { in: 'query', name: 'readinessReviewDecision', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const cacheKey = `redispatch-participation-readiness-status:${tenantId}:${params.syntheticRedispatchAssetPortfolio || 'no-portfolio'}:${params.installationGridLocationEvidence || 'no-loc'}:${params.remoteControlCommunicationTestEvidence || 'no-comm'}:${params.forecastDispatchTestProof || 'no-forecast'}:${params.readinessReviewDecision || 'no-decision'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.redispatchParticipationReadinessStatus,
        async () => ({
          ...this.buildRedispatchParticipationReadinessStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  mastrSyncGapStatus: {
    rest: 'GET /mastr-sync-gap-status',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      mastrFreshnessEvidence: { type: 'string', optional: true },
      redispatchStammdatenComparison: { type: 'string', optional: true },
      syncGapAlertFeed: { type: 'string', optional: true },
      reconciliationApprovalDecision: { type: 'string', optional: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'MaStR Sync-Gap alerting status -- read-only Workbench projection',
      description: 'Builds deterministic MaStR sync gap alerting evidence from supplied facts.',
      responses: {
        200: {
          description: 'Read-only MaStR Sync-Gap alerting status',
        },
      },
      parameters: [
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'mastrFreshnessEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'redispatchStammdatenComparison', schema: { type: 'string' } },
        { in: 'query', name: 'syncGapAlertFeed', schema: { type: 'string' } },
        { in: 'query', name: 'reconciliationApprovalDecision', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const cacheKey = `mastr-sync-gap-status:${tenantId}:${params.mastrFreshnessEvidence || 'no-freshness'}:${params.redispatchStammdatenComparison || 'no-comp'}:${params.syncGapAlertFeed || 'no-alert'}:${params.reconciliationApprovalDecision || 'no-reconcile'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.mastrSyncGapStatus,
        async () => ({
          ...this.buildMastrSyncGapStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  decommissionedAssetReconciliationStatus: {
    rest: 'GET /decommissioned-asset-reconciliation-status',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      gisDecommissionedAssetsEvidence: { type: 'string', optional: true },
      sapAnlagenspiegelEvidence: { type: 'string', optional: true },
      reconciliationDiscrepancyFeed: { type: 'string', optional: true },
      reconciliationApprovalDecision: { type: 'string', optional: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Decommissioned Asset Reconciliation status -- read-only Workbench projection',
      description:
        'Builds deterministic Decommissioned Asset Reconciliation evidence from supplied facts.',
      responses: {
        200: {
          description: 'Read-only Decommissioned Asset Reconciliation status',
        },
      },
      parameters: [
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'gisDecommissionedAssetsEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'sapAnlagenspiegelEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'reconciliationDiscrepancyFeed', schema: { type: 'string' } },
        { in: 'query', name: 'reconciliationApprovalDecision', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const cacheKey = `decommissioned-asset-reconciliation-status:${tenantId}:${params.gisDecommissionedAssetsEvidence || 'no-gis'}:${params.sapAnlagenspiegelEvidence || 'no-sap'}:${params.reconciliationDiscrepancyFeed || 'no-feed'}:${params.reconciliationApprovalDecision || 'no-reconcile'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.decommissionedAssetReconciliationStatus,
        async () => ({
          ...this.buildDecommissionedAssetReconciliationStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  energySharingCollectiveApprovalStatus: {
    rest: 'GET /energy-sharing-collective-approval-status',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      syntheticCollectiveBoundaryEvidence: { type: 'string', optional: true },
      operatorParticipantBoundaryEvidence: { type: 'string', optional: true },
      meteringConceptEvidence: { type: 'string', optional: true },
      contractConsentMarketRoleEvidence: { type: 'string', optional: true },
      allocationBillingSettlementGapEvidence: { type: 'string', optional: true },
      approvalReadinessDecision: { type: 'string', optional: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Energy Sharing Collective Approval status -- read-only Workbench projection',
      description:
        'Builds deterministic Energy Sharing Collective Approval evidence from supplied facts.',
      responses: {
        200: {
          description: 'Read-only Energy Sharing Collective Approval status',
        },
      },
      parameters: [
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'syntheticCollectiveBoundaryEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'operatorParticipantBoundaryEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'meteringConceptEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'contractConsentMarketRoleEvidence', schema: { type: 'string' } },
        {
          in: 'query',
          name: 'allocationBillingSettlementGapEvidence',
          schema: { type: 'string' },
        },
        { in: 'query', name: 'approvalReadinessDecision', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const cacheKey = `energy-sharing-collective-approval-status:${tenantId}:${params.syntheticCollectiveBoundaryEvidence || 'no-boundary'}:${params.operatorParticipantBoundaryEvidence || 'no-participant'}:${params.meteringConceptEvidence || 'no-meter'}:${params.contractConsentMarketRoleEvidence || 'no-contract'}:${params.allocationBillingSettlementGapEvidence || 'no-billing-gap'}:${params.approvalReadinessDecision || 'no-decision'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.energySharingCollectiveApprovalStatus,
        async () => ({
          ...this.buildEnergySharingCollectiveApprovalStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  steeringArtifactAcceptanceGateStatus: {
    rest: 'GET /steering-artifact-acceptance-gate',
    params: {
      artifactType: { type: 'string', optional: true, min: 1 },
      artifactName: { type: 'string', optional: true, min: 1 },
      targetRole: { type: 'string', optional: true, min: 1 },
      useCase: { type: 'string', optional: true, min: 1 },
      itemCount: { type: 'number', optional: true, convert: true },
      maintenanceMinutesPerWeek: { type: 'number', optional: true, convert: true },
      updateCadence: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      deputyOwner: { type: 'string', optional: true, min: 1 },
      usageEvidence: { type: 'string', optional: true, min: 1 },
      escalationCriterion: { type: 'string', optional: true, min: 1 },
      rolloutDecision: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Steering artifact acceptance gate — read-only dossier-safe status',
      description:
        'Builds a deterministic advisory acceptance and maintenance gate for proposed Cernion ' +
        'steering artifacts. It covers target role, use case, bounded item/card count, expected ' +
        'maintenance effort, update cadence, owner/deputy, usage evidence, escalation/retirement ' +
        'criterion and rollout decision. The endpoint is read-only and does not persist artifacts, ' +
        'write Budibase data, create workflows/HITL items, call external connectors or mutate ' +
        'billing, settlement, MaKo, tariff or device-control state.',
      parameters: [
        { name: 'artifactType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'artifactName', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'useCase', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'itemCount', in: 'query', required: false, schema: { type: 'number' } },
        {
          name: 'maintenanceMinutesPerWeek',
          in: 'query',
          required: false,
          schema: { type: 'number' },
        },
        { name: 'updateCadence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deputyOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'usageEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'escalationCriterion', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'rolloutDecision', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only steering artifact acceptance and maintenance gate status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  artifact: { type: 'object' },
                  scalarRows: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  operationalRisks: { type: 'array' },
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
      const cacheKey = `steering-artifact-acceptance-gate:${params.artifactType || 'no-type'}:${params.artifactName || 'no-name'}:${params.targetRole || 'no-role'}:${params.useCase || 'no-use'}:${params.itemCount ?? 'no-count'}:${params.maintenanceMinutesPerWeek ?? 'no-maintenance'}:${params.updateCadence || 'no-cadence'}:${params.owner || 'no-owner'}:${params.deputyOwner || 'no-deputy'}:${params.usageEvidence || 'no-usage'}:${params.escalationCriterion || 'no-escalation'}:${params.rolloutDecision || 'no-decision'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.steeringArtifactAcceptanceGateStatus,
        async () => ({
          ...this.buildSteeringArtifactAcceptanceGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  communicationBreakProcessRiskStatus: {
    rest: 'GET /communication-break-process-risk',
    params: {
      processDomain: { type: 'string', optional: true, min: 1 },
      affectedDecision: { type: 'string', optional: true, min: 1 },
      presentationStatus: { type: 'string', optional: true, min: 1 },
      protocolStatus: { type: 'string', optional: true, min: 1 },
      questionResponseWindow: { type: 'string', optional: true, min: 1 },
      informationDuty: { type: 'string', optional: true, min: 1 },
      fachlicheBegleitung: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      deputy: { type: 'string', optional: true, min: 1 },
      blockedDecision: { type: 'string', optional: true, min: 1 },
      nextEvidencePoint: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      escalationCriterion: { type: 'string', optional: true, min: 1 },
      proofLabel: { type: 'string', optional: true, min: 1 },
      proofLink: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Communication-break process-risk gate - read-only dossier-safe status',
      description:
        'Builds a deterministic advisory process-risk gate for communication breaks around ' +
        'handover or management decisions. It covers process/domain, affected or blocked ' +
        'decision, presentation and protocol evidence, question-response window, information ' +
        'duty, fachliche Begleitung, owner/deputy, next evidence point, due date and escalation ' +
        'criterion. The endpoint is read-only and does not score people, ingest email/calendar ' +
        'or chat data, create workflows/HITL items, write Budibase data, call external ' +
        'connectors or mutate MaKo, billing, settlement, tariff or device-control state.',
      parameters: [
        { name: 'processDomain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'affectedDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'presentationStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'protocolStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'questionResponseWindow',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'informationDuty', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'fachlicheBegleitung', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deputy', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'blockedDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextEvidencePoint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'escalationCriterion', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'proofLabel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'proofLink', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only communication-break process-risk status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  riskLevel: { type: 'string' },
                  process: { type: 'object' },
                  scalarRows: { type: 'array' },
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
      const cacheKey = `communication-break-process-risk:${params.processDomain || 'no-domain'}:${params.affectedDecision || 'no-decision'}:${params.presentationStatus || 'no-presentation'}:${params.protocolStatus || 'no-protocol'}:${params.questionResponseWindow || 'no-window'}:${params.informationDuty || 'no-duty'}:${params.fachlicheBegleitung || 'no-support'}:${params.owner || 'no-owner'}:${params.deputy || 'no-deputy'}:${params.blockedDecision || 'no-blocked'}:${params.nextEvidencePoint || 'no-next-evidence'}:${params.dueDate || 'no-due'}:${params.escalationCriterion || 'no-escalation'}:${params.proofLabel || 'no-proof-label'}:${params.proofLink || 'no-proof-link'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.communicationBreakProcessRiskStatus,
        async () => ({
          ...this.buildCommunicationBreakProcessRiskStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  noRegretMeasureProofGateStatus: {
    rest: 'GET /no-regret-measure-proof-gate',
    params: {
      measureName: { type: 'string', optional: true, min: 1 },
      measureType: { type: 'string', optional: true, min: 1 },
      targetDomain: { type: 'string', optional: true, min: 1 },
      scenarioCoverage: { type: 'string', optional: true, min: 1 },
      budgetAnchor: { type: 'string', optional: true, min: 1 },
      costRange: { type: 'string', optional: true, min: 1 },
      expectedBenefitRange: { type: 'string', optional: true, min: 1 },
      regulatoryFit: { type: 'string', optional: true, min: 1 },
      decisionOwner: { type: 'string', optional: true, min: 1 },
      objectionWindow: { type: 'string', optional: true, min: 1 },
      evidenceSource: { type: 'string', optional: true, min: 1 },
      nextManagementGate: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      proofLabel: { type: 'string', optional: true, min: 1 },
      proofLink: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'No-Regret measure proof gate - read-only dossier-safe status',
      description:
        'Builds a deterministic advisory proof gate for No-Regret measure claims. It covers ' +
        'measure identity, target domain, scenario coverage, budget anchor, cost and benefit ' +
        'ranges, regulatory fit, decision owner, objection window, evidence source, next ' +
        'management gate and due date. The endpoint is read-only and does not approve ' +
        'investment, reserve budget, book finance, create workflows/HITL items, call external ' +
        'connectors or mutate billing, settlement, tariff or device-control state.',
      parameters: [
        { name: 'measureName', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'measureType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetDomain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'scenarioCoverage', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'budgetAnchor', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'costRange', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'expectedBenefitRange',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'regulatoryFit', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'objectionWindow', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceSource', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextManagementGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'proofLabel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'proofLink', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only No-Regret measure proof-gate status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  riskLevel: { type: 'string' },
                  measure: { type: 'object' },
                  scalarRows: { type: 'array' },
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
      const cacheKey = `no-regret-measure-proof-gate:${params.measureName || 'no-name'}:${params.measureType || 'no-type'}:${params.targetDomain || 'no-domain'}:${params.scenarioCoverage || 'no-scenario'}:${params.budgetAnchor || 'no-budget'}:${params.costRange || 'no-cost'}:${params.expectedBenefitRange || 'no-benefit'}:${params.regulatoryFit || 'no-regulatory'}:${params.decisionOwner || 'no-owner'}:${params.objectionWindow || 'no-objection'}:${params.evidenceSource || 'no-source'}:${params.nextManagementGate || 'no-gate'}:${params.dueDate || 'no-due'}:${params.proofLabel || 'no-proof-label'}:${params.proofLink || 'no-proof-link'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.noRegretMeasureProofGateStatus,
        async () => ({
          ...this.buildNoRegretMeasureProofGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  anschlusskapazitaetEvidenceQueueStatus: {
    rest: 'GET /anschlusskapazitaet-evidence-queue',
    params: {
      connectionRequestId: { type: 'string', optional: true, min: 1 },
      netzverknuepfungspunktHint: { type: 'string', optional: true, min: 1 },
      capacityAssumptionKw: { type: 'number', optional: true, convert: true },
      gridRestrictionHint: { type: 'string', optional: true, min: 1 },
      futureDemandContext: { type: 'string', optional: true, min: 1 },
      legalQuestionMarker: { type: 'string', optional: true, min: 1 },
      fnavOptionMarker: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      nextGate: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Anschlusskapazitaet evidence queue - read-only dossier-safe status',
      description:
        'Builds a deterministic evidence queue for VNB connection-capacity cases. The endpoint is read-only and ' +
        'does not reserve capacity, approve or reject grid-connection requests, decide fNAV/legal questions, ' +
        'create HITL tasks, or mutate billing, tariff, MaKo, settlement or external connector state.',
      parameters: [
        { name: 'connectionRequestId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'netzverknuepfungspunktHint',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'capacityAssumptionKw',
          in: 'query',
          required: false,
          schema: { type: 'number' },
        },
        { name: 'gridRestrictionHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'futureDemandContext', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'legalQuestionMarker', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'fnavOptionMarker', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextGate', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only connection-capacity evidence queue',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  evidenceQueue: { type: 'object' },
                  evidenceItems: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  nextGate: { type: 'string' },
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
      const cacheKey = `anschlusskapazitaet-evidence-queue:${params.connectionRequestId || 'no-request'}:${params.netzverknuepfungspunktHint || 'no-nvp'}:${params.capacityAssumptionKw ?? 'no-capacity'}:${params.gridRestrictionHint || 'no-restriction'}:${params.legalQuestionMarker || 'no-legal'}:${params.fnavOptionMarker || 'no-fnav'}:${params.owner || 'no-owner'}:${params.dueDate || 'no-due'}:${params.nextGate || 'no-gate'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.anschlusskapazitaetEvidenceQueueStatus,
        async () => ({
          ...this.buildAnschlusskapazitaetEvidenceQueueStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  connectionDeadlineEvidenceQueueStatus: {
    rest: 'GET /connection-deadline-evidence-queue',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      connectionType: { type: 'string', optional: true, min: 1 },
      deadlineDate: { type: 'string', optional: true, min: 1 },
      responsibleVnb: { type: 'string', optional: true, min: 1 },
      technicalPlausibility: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      nextGate: { type: 'string', optional: true, min: 1 },
      missingEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      clarificationPoints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      communicationContext: { type: 'string', optional: true, min: 1 },
      asOf: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Connection deadline evidence queue - read-only dossier-safe status',
      description:
        'Builds a deterministic evidence queue for deadline-critical VNB connection cases. The endpoint is read-only and ' +
        'does not send communication, approve/reject/condition a connection, reserve capacity, create workflow/HITL tasks, ' +
        'calculate legally binding deadlines, or mutate CRM, customer portal, billing, settlement, MaKo, tariff or device-control state.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'connectionType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deadlineDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'responsibleVnb', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'technicalPlausibility',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextGate', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'missingEvidence',
          in: 'query',
          required: false,
          schema: { type: 'array', items: { type: 'string' } },
        },
        {
          name: 'clarificationPoints',
          in: 'query',
          required: false,
          schema: { type: 'array', items: { type: 'string' } },
        },
        {
          name: 'communicationContext',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'asOf', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only connection-deadline evidence queue',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  deadlineRisk: { type: 'string' },
                  evidenceItems: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  clarificationPoints: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  communicationNoteDraft: { type: 'object' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  safety: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `connection-deadline-evidence-queue:${params.caseId || 'no-case'}:${params.deadlineDate || 'no-deadline'}:${params.responsibleVnb || 'no-vnb'}:${params.owner || 'no-owner'}:${params.nextGate || 'no-gate'}:${params.asOf || 'no-asof'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.connectionDeadlineEvidenceQueueStatus,
        async () => ({
          ...this.buildConnectionDeadlineEvidenceQueueStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  layer0AuditDrilldownNoteStatus: {
    rest: 'GET /layer0-audit-drilldown',
    params: {
      kpiId: { type: 'string', optional: true, min: 1 },
      topic: { type: 'string', optional: true, min: 1 },
      dataSource: { type: 'string', optional: true, min: 1 },
      peerDeviation: { type: 'string', optional: true, min: 1 },
      processHint: { type: 'string', optional: true, min: 1 },
      periodHint: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      next90DayFocus: { type: 'string', optional: true, min: 1 },
      benchmarkPeerGroup: { type: 'string', optional: true, min: 1 },
      observedValue: { type: 'string', optional: true, min: 1 },
      expectedValue: { type: 'string', optional: true, min: 1 },
      unit: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Layer-0 audit drilldown note - read-only dossier-safe validation note',
      description:
        'Turns an anomalous Layer-0 KPI into a deterministic validation note with data source, peer deviation, ' +
        'hypothesis, misinterpretation risk, ten check fields, owner, next 90-day step, evidence gaps and positive follow-ups. ' +
        'The endpoint is read-only and does not create persistent audit queues, external benchmark calls, reports, HITL tasks, ' +
        'legal/regulatory final judgments or production mutations.',
      parameters: [
        { name: 'kpiId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'topic', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataSource', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'peerDeviation', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'processHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'periodHint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'next90DayFocus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'benchmarkPeerGroup', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'observedValue', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'expectedValue', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'unit', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Layer-0 audit drilldown validation note',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  auditNote: { type: 'object' },
                  checkFields: { type: 'array' },
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
      const cacheKey = `layer0-audit-drilldown:${params.kpiId || 'no-kpi'}:${params.topic || 'no-topic'}:${params.dataSource || 'no-source'}:${params.peerDeviation || 'no-deviation'}:${params.owner || 'no-owner'}:${params.next90DayFocus || 'no-focus'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.layer0AuditDrilldownNoteStatus,
        async () => ({
          ...this.buildLayer0AuditDrilldownNoteStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  legalClarificationOperatingModelStatus: {
    rest: 'GET /legal-clarification-operating-model',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      clarificationPoint: { type: 'string', optional: true, min: 1 },
      affectedDecision: { type: 'string', optional: true, min: 1 },
      legalStatus: { type: 'string', optional: true, min: 1 },
      contractStatus: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      ownerContact: { type: 'string', optional: true, min: 1 },
      noRegretDataNeeds: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      availableEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      scenarioOptions: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      redLines: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      implementationStatus: { type: 'string', optional: true, min: 1 },
      decisionReadiness: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Legal clarification operating model - read-only dossier-safe status',
      description:
        'Builds a deterministic operating-model evidence view for VNB cases where a legal clarification is pending. ' +
        'The endpoint is read-only and does not approve, release, dispatch, bill, settle, mutate tariffs, trigger MaKo, create HITL work or interpret law.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'clarificationPoint', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'affectedDecision', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'legalStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'contractStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerContact', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'noRegretDataNeeds',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        {
          name: 'availableEvidence',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        {
          name: 'scenarioOptions',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        {
          name: 'redLines',
          in: 'query',
          required: false,
          schema: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }] },
        },
        {
          name: 'implementationStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'decisionReadiness', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only legal clarification operating-model status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  legalStatus: { type: 'string' },
                  decisionReadiness: { type: 'string' },
                  preparationModel: { type: 'object' },
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
      const cacheKey = `legal-clarification-operating-model:${params.caseId || 'no-case'}:${params.clarificationPoint || 'no-point'}:${params.affectedDecision || 'no-decision'}:${params.legalStatus || 'no-legal'}:${params.owner || 'no-owner'}:${params.decisionReadiness || 'no-readiness'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.legalClarificationOperatingModelStatus,
        async () => ({
          ...this.buildLegalClarificationOperatingModelStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  drReadinessEvidenceStatus: {
    rest: 'GET /dr-readiness-evidence',
    params: {
      tenantScope: { type: 'string', optional: true, min: 1 },
      storeInventoryStatus: { type: 'string', optional: true, min: 1 },
      snapshotManifestStatus: { type: 'string', optional: true, min: 1 },
      restoreDrillStatus: { type: 'string', optional: true, min: 1 },
      rtoTarget: { type: 'string', optional: true, min: 1 },
      rpoTarget: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      lastDrillDate: { type: 'string', optional: true, min: 1 },
      nextDrillDue: { type: 'string', optional: true, min: 1 },
      perTenantRestoreStatus: { type: 'string', optional: true, min: 1 },
      notes: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'DR readiness evidence gate - read-only dossier-safe status',
      description:
        'Builds deterministic disaster-recovery readiness evidence for backup, restore-drill, RTO/RPO and tenant-scope cutover checks. ' +
        'The endpoint is read-only and does not execute backup, restore, scheduler, replication, external connector, webhook, key handling, tenant-data mutation or Personal Agent actions.',
      parameters: [
        { name: 'tenantScope', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'storeInventoryStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'snapshotManifestStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'restoreDrillStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'rtoTarget', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'rpoTarget', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'lastDrillDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextDrillDue', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'perTenantRestoreStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'notes', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only DR readiness evidence status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessLevel: { type: 'string' },
                  readinessScore: { type: 'number' },
                  evidenceItems: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  riskFlags: { type: 'array' },
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
      const cacheKey = `dr-readiness-evidence:${params.tenantScope || 'no-tenant'}:${params.storeInventoryStatus || 'no-store'}:${params.snapshotManifestStatus || 'no-snapshot'}:${params.restoreDrillStatus || 'no-drill'}:${params.rtoTarget || 'no-rto'}:${params.rpoTarget || 'no-rpo'}:${params.perTenantRestoreStatus || 'no-tenant-restore'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.drReadinessEvidenceStatus,
        async () => ({
          ...this.buildDrReadinessEvidenceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  specialGridUsageImpactMapStatus: {
    rest: 'GET /special-grid-usage-impact-map',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      caseType: { type: 'string', optional: true, min: 1 },
      customerId: { type: 'string', optional: true, min: 1 },
      applicationStatus: { type: 'string', optional: true, min: 1 },
      formStatus: { type: 'string', optional: true, min: 1 },
      deadlineStatus: { type: 'string', optional: true, min: 1 },
      quantityBasis: { type: 'string', optional: true, min: 1 },
      calculationLogicRef: { type: 'string', optional: true, min: 1 },
      billingImpact: { type: 'string', optional: true, min: 1 },
      eogImpact: { type: 'string', optional: true, min: 1 },
      tariffImpact: { type: 'string', optional: true, min: 1 },
      communicationStatus: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      regulatoryUncertainty: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
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
      summary: 'Special-grid-usage impact map - read-only dossier-safe status',
      description:
        'Builds a deterministic impact map for Par. 19 StromNEV, self-consumption and special-grid-usage cases. ' +
        'The endpoint is read-only and does not execute legal interpretation, calculation, billing, settlement, tariff, customer communication, HITL, external connector or Personal Agent actions.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'customerId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'applicationStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'formStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'deadlineStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'quantityBasis', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'calculationLogicRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'billingImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'eogImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'tariffImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'communicationStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'regulatoryUncertainty',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'sourceDatapoints', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only special-grid-usage impact map status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessLevel: { type: 'string' },
                  readinessScore: { type: 'number' },
                  caseSummary: { type: 'object' },
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
      const cacheKey = `special-grid-usage-impact-map:${params.caseId || 'no-case'}:${params.caseType || 'no-type'}:${params.applicationStatus || 'no-application'}:${params.deadlineStatus || 'no-deadline'}:${params.quantityBasis || 'no-quantity'}:${params.calculationLogicRef || 'no-calculation'}:${params.billingImpact || 'no-billing'}:${params.regulatoryUncertainty || 'no-regulatory-uncertainty'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.specialGridUsageImpactMapStatus,
        async () => ({
          ...this.buildSpecialGridUsageImpactMapStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  liquidityPlanningGovernanceStatus: {
    rest: 'GET /liquidity-planning-governance',
    params: {
      planningRunId: { type: 'string', optional: true, min: 1 },
      planningHorizon: { type: 'string', optional: true, min: 1 },
      sourceRegister: { type: 'string', optional: true, min: 1 },
      sapAccountSources: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      controllingSourceIds: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      loanTmsSourceIds: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      vatLogicRef: { type: 'string', optional: true, min: 1 },
      cashPoolSettlementRef: { type: 'string', optional: true, min: 1 },
      dictionaryVersion: { type: 'string', optional: true, min: 1 },
      scenarioAssumptions: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      validationRules: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      plausibilityChecks: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceHealth: { type: 'string', optional: true, min: 1 },
      ownerRaci: { type: 'string', optional: true, min: 1 },
      correctionWorkflow: { type: 'string', optional: true, min: 1 },
      approvalStatus: { type: 'string', optional: true, min: 1 },
      liquidityRiskFlags: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      interestRiskFlags: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      investmentLinkRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceDatapoints: {
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
      summary: 'Liquidity planning governance - read-only dossier-safe status',
      description:
        'Builds deterministic governance evidence for liquidity, interest, SAP account, TMS loan, VAT logic and cash-pool planning contexts. ' +
        'The endpoint is read-only and does not calculate Treasury/cashflow/VAT values, approve finance workflows, send payments, mutate billing/settlement/tariffs/contracts/EOG, call connectors, create HITL items or execute Personal Agent actions.',
      parameters: [
        { name: 'planningRunId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'planningHorizon', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceRegister', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dictionaryVersion', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'vatLogicRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'cashPoolSettlementRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'ownerRaci', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'correctionWorkflow', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'approvalStatus', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'sapAccountSources', schema: { type: 'string' } },
        { in: 'query', name: 'controllingSourceIds', schema: { type: 'string' } },
        { in: 'query', name: 'loanTmsSourceIds', schema: { type: 'string' } },
        { in: 'query', name: 'scenarioAssumptions', schema: { type: 'string' } },
        { in: 'query', name: 'validationRules', schema: { type: 'string' } },
        { in: 'query', name: 'plausibilityChecks', schema: { type: 'string' } },
        { in: 'query', name: 'sourceHealth', schema: { type: 'string' } },
        { in: 'query', name: 'liquidityRiskFlags', schema: { type: 'string' } },
        { in: 'query', name: 'interestRiskFlags', schema: { type: 'string' } },
        { in: 'query', name: 'investmentLinkRefs', schema: { type: 'string' } },
        { in: 'query', name: 'sourceDatapoints', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only liquidity planning governance status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  readinessLevel: { type: 'string' },
                  readinessScore: { type: 'number' },
                  sourceCoverage: { type: 'object' },
                  evidenceItems: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  riskFlags: { type: 'array' },
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
      const cacheKey = `liquidity-planning-governance:${params.planningRunId || 'no-run'}:${params.planningHorizon || 'no-horizon'}:${params.sourceRegister || 'no-register'}:${params.dictionaryVersion || 'no-dictionary'}:${params.vatLogicRef || 'no-vat'}:${params.cashPoolSettlementRef || 'no-cash-pool'}:${params.ownerRaci || 'no-owner'}:${params.correctionWorkflow || 'no-correction'}:${params.approvalStatus || 'no-approval'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.liquidityPlanningGovernanceStatus,
        async () => ({
          ...this.buildLiquidityPlanningGovernanceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  energySharingSimulationGateStatus: {
    rest: 'GET /energy-sharing-simulation-gate',
    params: {
      communityId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      participantCount: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      participantEvidenceRef: { type: 'string', optional: true, min: 1 },
      maloStatus: { type: 'string', optional: true, min: 1 },
      meteringReadiness: { type: 'string', optional: true, min: 1 },
      marketRoleReadiness: { type: 'string', optional: true, min: 1 },
      dataBasis: { type: 'string', optional: true, min: 1 },
      a96EvidenceRef: { type: 'string', optional: true, min: 1 },
      settlementEvidenceRef: { type: 'string', optional: true, min: 1 },
      contractEvidenceRef: { type: 'string', optional: true, min: 1 },
      economicsAssumptionRef: { type: 'string', optional: true, min: 1 },
      generationMaloCount: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      consumptionMaloCount: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      maloInventoryEvidenceRef: { type: 'string', optional: true, min: 1 },
      supplierOrDirectMarketerEvidenceRef: { type: 'string', optional: true, min: 1 },
      meteringConceptEvidenceRef: { type: 'string', optional: true, min: 1 },
      imsysStatus: { type: 'string', optional: true, min: 1 },
      fifteenMinuteValuesReadiness: { type: 'string', optional: true, min: 1 },
      dataBasisFreshnessRef: { type: 'string', optional: true, min: 1 },
      residualSupplyContractEvidenceRef: { type: 'string', optional: true, min: 1 },
      participationStartDate: { type: 'string', optional: true, min: 1 },
      participationEndDate: { type: 'string', optional: true, min: 1 },
      eligibilityEvidenceRef: { type: 'string', optional: true, min: 1 },
      exceptionRateEvidenceRef: { type: 'string', optional: true, min: 1 },
      economicsThresholdRef: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      escalationContact: { type: 'string', optional: true, min: 1 },
      sourceArtifacts: {
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
      summary: 'Energy-Sharing simulation gate - read-only dossier-safe status',
      description:
        'Classifies Energy-Sharing candidates as learning pilot, simulation-ready, billing-near-ready or blocked by missing evidence. ' +
        'The endpoint is read-only and does not run allocation, settlement/A96 export, MaKo dispatch, billing, tariff mutation, HITL, external connector, customer communication or Personal Agent execution.',
      parameters: [
        { name: 'communityId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'participantCount', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'participantEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'maloStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'meteringReadiness', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'marketRoleReadiness', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataBasis', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'a96EvidenceRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'settlementEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'contractEvidenceRef', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'economicsAssumptionRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'generationMaloCount',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'consumptionMaloCount',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'maloInventoryEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'supplierOrDirectMarketerEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'meteringConceptEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'imsysStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'fifteenMinuteValuesReadiness',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'dataBasisFreshnessRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'residualSupplyContractEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'participationStartDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'participationEndDate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'eligibilityEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'exceptionRateEvidenceRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'economicsThresholdRef',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'escalationContact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceArtifacts', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Energy-Sharing simulation gate status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  gateStatus: { type: 'string' },
                  simulationStage: { type: 'string' },
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
      const cacheKey = `energy-sharing-simulation-gate:${params.communityId || 'no-community'}:${params.gridOperatorId || 'no-grid'}:${params.participantCount || 'no-participants'}:${params.maloStatus || 'no-malo'}:${params.meteringReadiness || 'no-metering'}:${params.marketRoleReadiness || 'no-market-role'}:${params.dataBasis || 'no-data-basis'}:${params.a96EvidenceRef || 'no-a96'}:${params.settlementEvidenceRef || 'no-settlement'}:${params.contractEvidenceRef || 'no-contract'}:${params.economicsAssumptionRef || 'no-economics'}:${params.generationMaloCount || 'no-gen-malo'}:${params.consumptionMaloCount || 'no-cons-malo'}:${params.maloInventoryEvidenceRef || 'no-malo-inventory'}:${params.supplierOrDirectMarketerEvidenceRef || 'no-supplier'}:${params.meteringConceptEvidenceRef || 'no-metering-concept'}:${params.imsysStatus || 'no-imsys'}:${params.fifteenMinuteValuesReadiness || 'no-15min'}:${params.dataBasisFreshnessRef || 'no-freshness'}:${params.residualSupplyContractEvidenceRef || 'no-residual-supply'}:${params.participationStartDate || 'no-start'}:${params.participationEndDate || 'no-end'}:${params.eligibilityEvidenceRef || 'no-eligibility'}:${params.exceptionRateEvidenceRef || 'no-exception-rate'}:${params.economicsThresholdRef || 'no-economics-threshold'}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.energySharingSimulationGateStatus,
        async () => ({
          ...this.buildEnergySharingSimulationGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },
};
