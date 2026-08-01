'use strict';

// dashboard-api actions chunk 7/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: stadtwerkMauerSalesWorkbenchBriefingStatus, stadtwerkMauerWorkbenchLandingStatus, stadtwerkMauerWorkbenchSelectedTargetStatus, fnavFastTrackContractGateStatus, crossChannelVnbSignalQueueStatus, crossDomainSpecialTopicsQueueStatus, assetValuationTransformationGateStatus, gasCapacityBookingReviewGateStatus, gasNetworkDecisionChainStatus, waterPricingNetInvestmentAlignmentStatus, arealNetworkIntegrationOfferGateStatus, transformationFinancingScenarioViewStatus, investmentBudgetCapExceptionGovernanceStatus, investmentOwnerDeadlineBudgetGateStatus, directMarketerRiskGateStatus, noRegretMeasureDefinitionGateStatus

const { OPENAPI_TAG } = require('./shared');

module.exports = {
  stadtwerkMauerSalesWorkbenchBriefingStatus: {
    rest: 'GET /stadtwerk-mauer-sales-workbench-briefing',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      audience: { type: 'string', optional: true, min: 1 },
      limit: { type: 'number', optional: true, convert: true, integer: true, min: 1, max: 25 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer sales Workbench briefing -- read-only evidence-backed claims',
      description:
        'Returns deterministic Budibase-renderable Vertrieb and Key Account briefing rows for ' +
        'the Stadtwerk Mauer Workbench. Claims are explicitly evidence-backed, assumption-backed ' +
        'or not-yet-claimable and the endpoint does not create CRM/customer data, Budibase writes, ' +
        'MaKo, billing, settlement, tariff, device-control, HITL or external connector actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'audience', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 25 },
        },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer sales Workbench briefing projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const audience = params.audience || 'vertrieb';
      const limit = Math.max(1, Math.min(Number(params.limit || 10), 25));
      const errors = [];
      const cacheKey = `stadtwerk-mauer-sales-workbench-briefing:${tenantId}:${caseId}:${audience}:${limit}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerSalesWorkbenchBriefingStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerSalesWorkbenchBriefingStatus({
                tenantId,
                caseId,
                audience,
                limit,
                caseDetailStatus: null,
                roleCatalogStatus: null,
                gridPlanningRoleQueueStatus: null,
                tenantDatabrowserStatus: null,
              }),
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }

          const e2eStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-e2e-process-demo.getStatus',
            { tenantId, caseId, limit: 10 },
            this.buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-e2e-process-demo.getStatus'
          );
          const mastrStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-mastr-data-overlay.getStatus',
            { tenantId, limit: 10 },
            this.buildMissingStadtwerkMauerMastrDataOverlayStatus(tenantId, {}),
            errors,
            'stadtwerk-mauer-mastr-data-overlay.getStatus'
          );
          const caseDetailStatus = this.buildStadtwerkMauerCaseDetailStatus({
            tenantId,
            caseId,
            e2eStatus,
          });
          const hubStatus = this.buildStadtwerkMauerWorkbenchHubStatus({
            tenantId,
            caseId,
            e2eStatus,
            mastrStatus,
            caseDetailStatus,
          });
          const administratorInventoryStatus = this.buildStadtwerkMauerAdministratorInventoryStatus(
            {
              tenantId,
              caseId,
              includeRuntime: true,
              e2eStatus,
              mastrStatus,
              caseDetailStatus,
              hubStatus,
            }
          );
          const caseActionsStatus = this.buildStadtwerkMauerCaseActionsStatus({
            tenantId,
            caseId,
            caseDetailStatus,
          });
          const roleCatalogStatus = this.buildStadtwerkMauerRoleWorkbenchCatalogStatus({
            tenantId,
            caseId,
            hubStatus,
            administratorInventoryStatus,
            caseActionsStatus,
          });
          const gridPlanningRoleQueueStatus = this.buildStadtwerkMauerGridPlanningRoleQueueStatus({
            tenantId,
            caseId,
            caseDetailStatus,
            roleCatalogStatus,
          });
          const tenantDatabrowserStatus = this.buildStadtwerkMauerTenantDatabrowserStatus({
            tenantId,
            caseId,
            categoryId: 'case-evidence',
            itemId: null,
            limit,
            e2eStatus,
            mastrStatus,
            caseDetailStatus,
            hubStatus,
            administratorInventoryStatus,
          });

          return {
            ...this.buildStadtwerkMauerSalesWorkbenchBriefingStatus({
              tenantId,
              caseId,
              audience,
              limit,
              caseDetailStatus,
              roleCatalogStatus,
              gridPlanningRoleQueueStatus,
              tenantDatabrowserStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerWorkbenchLandingStatus: {
    rest: 'GET /stadtwerk-mauer-workbench-landing',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer Workbench landing -- presenter readiness projection',
      description:
        'Returns deterministic Budibase-renderable landing/status rows for the Stadtwerk ' +
        'Mauer Workbench first screen. The endpoint exposes demo readiness, available ' +
        'sections, safe presenter actions and guard gaps without Budibase writes, setup/reset, ' +
        'provisioning, MaKo, billing, settlement, device-control, HITL or external actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer Workbench landing projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const errors = [];
      const cacheKey = `stadtwerk-mauer-workbench-landing:${tenantId}:${caseId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerWorkbenchLandingStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerWorkbenchLandingStatus({
                tenantId,
                caseId,
                hubStatus: null,
                administratorInventoryStatus: null,
                roleCatalogStatus: null,
                gridPlanningRoleQueueStatus: null,
                caseActionsStatus: null,
                caseDetailStatus: null,
                e2eStatus: null,
                mastrStatus: null,
              }),
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }

          const e2eStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-e2e-process-demo.getStatus',
            { tenantId, caseId, limit: 10 },
            this.buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-e2e-process-demo.getStatus'
          );
          const mastrStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-mastr-data-overlay.getStatus',
            { tenantId, limit: 10 },
            this.buildMissingStadtwerkMauerMastrDataOverlayStatus(tenantId, {}),
            errors,
            'stadtwerk-mauer-mastr-data-overlay.getStatus'
          );
          const caseDetailStatus = this.buildStadtwerkMauerCaseDetailStatus({
            tenantId,
            caseId,
            e2eStatus,
          });
          const hubStatus = this.buildStadtwerkMauerWorkbenchHubStatus({
            tenantId,
            caseId,
            e2eStatus,
            mastrStatus,
            caseDetailStatus,
          });
          const administratorInventoryStatus = this.buildStadtwerkMauerAdministratorInventoryStatus(
            {
              tenantId,
              caseId,
              includeRuntime: true,
              e2eStatus,
              mastrStatus,
              caseDetailStatus,
              hubStatus,
            }
          );
          const caseActionsStatus = this.buildStadtwerkMauerCaseActionsStatus({
            tenantId,
            caseId,
            caseDetailStatus,
          });
          const roleCatalogStatus = this.buildStadtwerkMauerRoleWorkbenchCatalogStatus({
            tenantId,
            caseId,
            hubStatus,
            administratorInventoryStatus,
            caseActionsStatus,
          });
          const gridPlanningRoleQueueStatus = this.buildStadtwerkMauerGridPlanningRoleQueueStatus({
            tenantId,
            caseId,
            caseDetailStatus,
            roleCatalogStatus,
          });

          return {
            ...this.buildStadtwerkMauerWorkbenchLandingStatus({
              tenantId,
              caseId,
              hubStatus,
              administratorInventoryStatus,
              roleCatalogStatus,
              gridPlanningRoleQueueStatus,
              caseActionsStatus,
              caseDetailStatus,
              e2eStatus,
              mastrStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerWorkbenchSelectedTargetStatus: {
    rest: 'GET /stadtwerk-mauer-workbench-selected-target',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      targetId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer Workbench selected target -- read-only focus projection',
      description:
        'Returns deterministic Budibase-renderable selected/focused target rows for the ' +
        'Stadtwerk Mauer Workbench Hub. The endpoint maps Hub/role targets to scalar ' +
        'focus/helper rows without role-specific calculations, permission changes, ' +
        'Budibase writes, setup/reset, Rundeck execution, MaKo, billing, settlement, ' +
        'device-control, HITL or external connector actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer selected Workbench target projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const targetId = params.targetId || 'hub';
      const errors = [];
      const cacheKey = `stadtwerk-mauer-workbench-selected-target:${tenantId}:${caseId}:${targetId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerWorkbenchSelectedTargetStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerWorkbenchSelectedTargetStatus({
                tenantId,
                caseId,
                targetId,
                hubStatus: null,
                roleCatalogStatus: null,
                landingStatus: null,
              }),
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }

          const e2eStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-e2e-process-demo.getStatus',
            { tenantId, caseId, limit: 10 },
            this.buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-e2e-process-demo.getStatus'
          );
          const mastrStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-mastr-data-overlay.getStatus',
            { tenantId, limit: 10 },
            this.buildMissingStadtwerkMauerMastrDataOverlayStatus(tenantId, {}),
            errors,
            'stadtwerk-mauer-mastr-data-overlay.getStatus'
          );
          const caseDetailStatus = this.buildStadtwerkMauerCaseDetailStatus({
            tenantId,
            caseId,
            e2eStatus,
          });
          const hubStatus = this.buildStadtwerkMauerWorkbenchHubStatus({
            tenantId,
            caseId,
            e2eStatus,
            mastrStatus,
            caseDetailStatus,
          });
          const administratorInventoryStatus = this.buildStadtwerkMauerAdministratorInventoryStatus(
            {
              tenantId,
              caseId,
              includeRuntime: true,
              e2eStatus,
              mastrStatus,
              caseDetailStatus,
              hubStatus,
            }
          );
          const caseActionsStatus = this.buildStadtwerkMauerCaseActionsStatus({
            tenantId,
            caseId,
            caseDetailStatus,
          });
          const roleCatalogStatus = this.buildStadtwerkMauerRoleWorkbenchCatalogStatus({
            tenantId,
            caseId,
            hubStatus,
            administratorInventoryStatus,
            caseActionsStatus,
          });
          const gridPlanningRoleQueueStatus = this.buildStadtwerkMauerGridPlanningRoleQueueStatus({
            tenantId,
            caseId,
            caseDetailStatus,
            roleCatalogStatus,
          });
          const landingStatus = this.buildStadtwerkMauerWorkbenchLandingStatus({
            tenantId,
            caseId,
            hubStatus,
            administratorInventoryStatus,
            roleCatalogStatus,
            gridPlanningRoleQueueStatus,
            caseActionsStatus,
            caseDetailStatus,
            e2eStatus,
            mastrStatus,
          });

          return {
            ...this.buildStadtwerkMauerWorkbenchSelectedTargetStatus({
              tenantId,
              caseId,
              targetId,
              hubStatus,
              roleCatalogStatus,
              landingStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  fnavFastTrackContractGateStatus: {
    rest: 'GET /fnav-fast-track-contract-gate',
    params: {
      gateId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      requestType: { type: 'string', optional: true, min: 1 },
      assetOrLoadType: { type: 'string', optional: true, min: 1 },
      requestedCapacityKW: { type: 'number', optional: true, convert: true },
      firmCapacityKW: { type: 'number', optional: true, convert: true },
      flexibleCapacityKW: { type: 'number', optional: true, convert: true },
      curtailmentWindow: { type: 'string', optional: true, min: 1 },
      voltageLevel: { type: 'string', optional: true, min: 1 },
      netzsignalPriorityPolicy: { type: 'string', optional: true, min: 1 },
      scheduleObligation: { type: 'string', optional: true, min: 1 },
      meteringRequirements: { type: 'string', optional: true, min: 1 },
      controlEvidenceRef: { type: 'string', optional: true, min: 1 },
      marketingBoundaries: { type: 'string', optional: true, min: 1 },
      commercialImpact: { type: 'string', optional: true, min: 1 },
      contractStatus: { type: 'string', optional: true, min: 1 },
      legalStatus: { type: 'string', optional: true, min: 1 },
      breakCriteria: { type: 'string', optional: true, min: 1 },
      escalationOwner: { type: 'string', optional: true, min: 1 },
      ownerContact: { type: 'string', optional: true, min: 1 },
      vdmiProcessId: { type: 'string', optional: true, min: 1 },
      sourceRef: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      // -- FCA/fNAV lifecycle evidence (additive, caller-supplied, read-only) --
      connectionRequestRef: { type: 'string', optional: true, min: 1 },
      gridConnectionPoint: { type: 'string', optional: true, min: 1 },
      capacityOfferRef: { type: 'string', optional: true, min: 1 },
      capacityOfferVersion: { type: 'string', optional: true, min: 1 },
      capacityOfferDate: { type: 'string', optional: true, min: 1 },
      restrictionProfileRef: { type: 'string', optional: true, min: 1 },
      restrictionProfileVersion: { type: 'string', optional: true, min: 1 },
      contractRef: { type: 'string', optional: true, min: 1 },
      contractVersion: { type: 'string', optional: true, min: 1 },
      contractReviewStatus: { type: 'string', optional: true, min: 1 },
      operatingEventRef: { type: 'string', optional: true, min: 1 },
      operatingEventType: { type: 'string', optional: true, min: 1 },
      operatingEventTimestamp: { type: 'string', optional: true, min: 1 },
      curtailmentMeasurementEvidenceRef: { type: 'string', optional: true, min: 1 },
      redispatchRelevanceRef: { type: 'string', optional: true, min: 1 },
      redispatchStatusRef: { type: 'string', optional: true, min: 1 },
      compensationStatusRef: { type: 'string', optional: true, min: 1 },
      evidenceOwner: { type: 'string', optional: true, min: 1 },
      nextReviewGate: { type: 'string', optional: true, min: 1 },
      evidenceSourceTimestamp: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'fNAV fast-track contract gate -- read-only decision readiness',
      description:
        'Projects fNAV fast-track request, network-signal, metering/control, commercial, contract, legal and owner evidence into a dossier-safe gate status. ' +
        'The endpoint is read-only and never creates contracts, HITL items, MaKo, billing, settlement, tariff, control, SMGW/CLS or external actions. ' +
        'It additionally projects caller-supplied FCA/fNAV lifecycle evidence (connection request, capacity offer, restriction profile, contract, ' +
        'at most one operating-event snapshot, curtailment/measurement evidence, and Redispatch/compensation evidence markers) as review-only, ' +
        'non-consequential display fields.',
      parameters: [
        { name: 'gateId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'requestType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetOrLoadType', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'netzsignalPriorityPolicy',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'controlEvidenceRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'contractStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'legalStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerContact', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'requestedCapacityKW', schema: { type: 'number' } },
        { in: 'query', name: 'firmCapacityKW', schema: { type: 'number' } },
        { in: 'query', name: 'flexibleCapacityKW', schema: { type: 'number' } },
        { in: 'query', name: 'curtailmentWindow', schema: { type: 'string' } },
        { in: 'query', name: 'voltageLevel', schema: { type: 'string' } },
        { in: 'query', name: 'scheduleObligation', schema: { type: 'string' } },
        { in: 'query', name: 'meteringRequirements', schema: { type: 'string' } },
        { in: 'query', name: 'marketingBoundaries', schema: { type: 'string' } },
        { in: 'query', name: 'commercialImpact', schema: { type: 'string' } },
        { in: 'query', name: 'breakCriteria', schema: { type: 'string' } },
        { in: 'query', name: 'escalationOwner', schema: { type: 'string' } },
        { in: 'query', name: 'vdmiProcessId', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRef', schema: { type: 'string' } },
        { in: 'query', name: 'connectionRequestRef', schema: { type: 'string' } },
        { in: 'query', name: 'gridConnectionPoint', schema: { type: 'string' } },
        { in: 'query', name: 'capacityOfferRef', schema: { type: 'string' } },
        { in: 'query', name: 'capacityOfferVersion', schema: { type: 'string' } },
        { in: 'query', name: 'capacityOfferDate', schema: { type: 'string' } },
        { in: 'query', name: 'restrictionProfileRef', schema: { type: 'string' } },
        { in: 'query', name: 'restrictionProfileVersion', schema: { type: 'string' } },
        { in: 'query', name: 'contractRef', schema: { type: 'string' } },
        { in: 'query', name: 'contractVersion', schema: { type: 'string' } },
        { in: 'query', name: 'contractReviewStatus', schema: { type: 'string' } },
        { in: 'query', name: 'operatingEventRef', schema: { type: 'string' } },
        { in: 'query', name: 'operatingEventType', schema: { type: 'string' } },
        { in: 'query', name: 'operatingEventTimestamp', schema: { type: 'string' } },
        { in: 'query', name: 'curtailmentMeasurementEvidenceRef', schema: { type: 'string' } },
        { in: 'query', name: 'redispatchRelevanceRef', schema: { type: 'string' } },
        { in: 'query', name: 'redispatchStatusRef', schema: { type: 'string' } },
        { in: 'query', name: 'compensationStatusRef', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceOwner', schema: { type: 'string' } },
        { in: 'query', name: 'nextReviewGate', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceSourceTimestamp', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only fNAV fast-track contract-gate status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  gateId: { type: 'string' },
                  decisionReadiness: { type: 'string' },
                  status: { type: 'string' },
                  requestSummary: { type: 'object' },
                  technicalGate: { type: 'object' },
                  commercialGate: { type: 'object' },
                  contractGate: { type: 'object' },
                  evidenceStatus: { type: 'object' },
                  governanceBlockers: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
                  sourceActions: { type: 'object' },
                  dossierEvidence: { type: 'object' },
                  lifecycleEvidence: { type: 'object' },
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
      const cacheKey = `fnav-fast-track-contract-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.fnavFastTrackContractGateStatus,
        async () => ({
          ...this.buildFnavFastTrackContractGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  crossChannelVnbSignalQueueStatus: {
    rest: 'GET /cross-channel-vnb-signal-queue',
    params: {
      signalId: { type: 'string', optional: true, min: 1 },
      channel: { type: 'string', optional: true, min: 1 },
      sourceSystem: { type: 'string', optional: true, min: 1 },
      sourceRef: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      receivedAt: { type: 'string', optional: true, min: 1 },
      affectedProcess: { type: 'string', optional: true, min: 1 },
      processType: { type: 'string', optional: true, min: 1 },
      riskType: { type: 'string', optional: true, min: 1 },
      riskSeverity: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      ownerPersonaId: { type: 'string', optional: true, min: 1 },
      dueAt: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      evidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      nextDatapoint: { type: 'string', optional: true, min: 1 },
      dedupeKey: { type: 'string', optional: true, min: 1 },
      status: { type: 'string', optional: true, min: 1 },
      signals: { type: 'multi', optional: true, rules: [{ type: 'string' }, { type: 'array' }] },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Cross-channel VNB signal queue -- read-only evidence projection',
      description:
        'Normalizes caller-supplied signal references and summaries into a dossier-safe VNB queue evidence view. ' +
        'The endpoint is read-only and never ingests mail/chat/portal content, stores raw private content, persists a queue, creates HITL/inbox/notification/VDMI items, or dispatches operational actions.',
      parameters: [
        { name: 'signalId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'channel', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceSystem', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'affectedProcess', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'riskType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueAt', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextDatapoint', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'receivedAt', schema: { type: 'string' } },
        { in: 'query', name: 'processType', schema: { type: 'string' } },
        { in: 'query', name: 'riskSeverity', schema: { type: 'string' } },
        { in: 'query', name: 'ownerPersonaId', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceRefs', schema: { type: 'string' } },
        { in: 'query', name: 'dedupeKey', schema: { type: 'string' } },
        { in: 'query', name: 'status', schema: { type: 'string' } },
        { in: 'query', name: 'signals', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only cross-channel VNB signal queue evidence',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  queueStatus: { type: 'string' },
                  signalCount: { type: 'number' },
                  normalizedSignals: { type: 'array' },
                  byProcess: { type: 'object' },
                  byRiskType: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
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
      const cacheKey = `cross-channel-vnb-signal-queue:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.crossChannelVnbSignalQueueStatus,
        async () => ({
          ...this.buildCrossChannelVnbSignalQueueStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  crossDomainSpecialTopicsQueueStatus: {
    rest: 'GET /cross-domain-special-topics-queue',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      topic: { type: 'string', optional: true, min: 1 },
      topics: { type: 'multi', optional: true, rules: [{ type: 'string' }, { type: 'array' }] },
      domainLane: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      dueAt: { type: 'string', optional: true, min: 1 },
      regulatoryReference: { type: 'string', optional: true, min: 1 },
      dataGap: { type: 'string', optional: true, min: 1 },
      assetRevenueImpact: { type: 'string', optional: true, min: 1 },
      escalationThreshold: { type: 'string', optional: true, min: 1 },
      nextGovernanceGate: { type: 'string', optional: true, min: 1 },
      decisionStatus: { type: 'string', optional: true, min: 1 },
      evidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Cross-domain special topics queue -- read-only management projection',
      description:
        'Normalizes supplied Anschluss-, Flexibilitaets-, Energy-Sharing-, Mess-/Steuerdaten-, Kapazitaets-, Asset- and revenue-impact topics into a dossier-safe management queue. The endpoint is read-only and never creates tasks, workflows, tickets, e-mails, connector calls, bookings, executions, billing/settlement/tariff/device-control effects, or Personal-Agent shortcuts.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'topic', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'topics', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'domainLane', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'ownerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dueAt', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'regulatoryReference', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'dataGap', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetRevenueImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'escalationThreshold', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextGovernanceGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceRefs', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: { 200: { description: 'Read-only cross-domain special topics queue' } },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `cross-domain-special-topics-queue:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.crossDomainSpecialTopicsQueueStatus,
        async () => ({
          ...this.buildCrossDomainSpecialTopicsQueueStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  assetValuationTransformationGateStatus: {
    rest: 'GET /asset-valuation-transformation-gate',
    params: {
      gateId: { type: 'string', optional: true, min: 1 },
      assetId: { type: 'string', optional: true, min: 1 },
      assetGroupId: { type: 'string', optional: true, min: 1 },
      assetType: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      bookValueStatus: { type: 'string', optional: true, min: 1 },
      bookValueSource: { type: 'string', optional: true, min: 1 },
      assetConditionStatus: { type: 'string', optional: true, min: 1 },
      assetConditionSource: { type: 'string', optional: true, min: 1 },
      transformationOption: { type: 'string', optional: true, min: 1 },
      transformationOptionBasis: { type: 'string', optional: true, min: 1 },
      contractRisk: { type: 'string', optional: true, min: 1 },
      contractRiskBasis: { type: 'string', optional: true, min: 1 },
      regulatoryUncertainty: { type: 'string', optional: true, min: 1 },
      regulatoryUncertaintyBasis: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      decisionOwner: { type: 'string', optional: true, min: 1 },
      nextDecision: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      sourceRefs: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Asset valuation transformation gate -- read-only evidence projection',
      description:
        'Returns a deterministic dossier-safe management gate view over book value, asset condition, transformation option, contract/regulatory risk and data quality. ' +
        'The endpoint is read-only and never mutates asset records, creates valuation/accounting records, approves investments, creates HITL items, or executes decommissioning/repurposing.',
      parameters: [
        { name: 'assetId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetGroupId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'bookValueStatus', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'assetConditionStatus',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'transformationOption',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'contractRisk', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'regulatoryUncertainty',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'dataQualityStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextDecision', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'gateId', schema: { type: 'string' } },
        { in: 'query', name: 'bookValueSource', schema: { type: 'string' } },
        { in: 'query', name: 'assetConditionSource', schema: { type: 'string' } },
        { in: 'query', name: 'transformationOptionBasis', schema: { type: 'string' } },
        { in: 'query', name: 'contractRiskBasis', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryUncertaintyBasis', schema: { type: 'string' } },
        { in: 'query', name: 'sourceDatapoints', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRefs', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only asset valuation transformation gate evidence',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  decisionReadiness: { type: 'string' },
                  assetScope: { type: 'object' },
                  bookValueStatus: { type: 'object' },
                  assetConditionStatus: { type: 'object' },
                  transformationOption: { type: 'object' },
                  contractRisk: { type: 'object' },
                  regulatoryUncertainty: { type: 'object' },
                  dataQualityStatus: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
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
      const cacheKey = `asset-valuation-transformation-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.assetValuationTransformationGateStatus,
        async () => ({
          ...this.buildAssetValuationTransformationGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  gasCapacityBookingReviewGateStatus: {
    rest: 'GET /gas-capacity-booking-review-gate',
    params: {
      reviewId: { type: 'string', optional: true, min: 1 },
      bookingYear: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string' }],
      },
      networkArea: { type: 'string', optional: true, min: 1 },
      capacityAssumption: { type: 'string', optional: true, min: 1 },
      capacityAssumptionSource: { type: 'string', optional: true, min: 1 },
      coldYearEvidence: { type: 'string', optional: true, min: 1 },
      rlmReboundEvidence: { type: 'string', optional: true, min: 1 },
      congestionHistoryEvidence: { type: 'string', optional: true, min: 1 },
      vdmiOwner: { type: 'string', optional: true, min: 1 },
      decisionFrameRef: { type: 'string', optional: true, min: 1 },
      commercialSignoff: { type: 'string', optional: true, min: 1 },
      riskScenarios: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
      sourceRefs: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Gas capacity booking review gate -- read-only evidence projection',
      description:
        'Returns a deterministic dossier-safe review gate over gas capacity assumptions, cold-year/RLM/congestion evidence, VDMI ownership and commercial sign-off. ' +
        'The endpoint is read-only and never submits bookings, mutates VDMI/HITL workflows, dispatches notifications, creates booking persistence, or calls external systems.',
      parameters: [
        { name: 'reviewId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'bookingYear', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'networkArea', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'capacityAssumption', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'coldYearEvidence', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'rlmReboundEvidence', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'congestionHistoryEvidence',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'vdmiOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionFrameRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'commercialSignoff', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'capacityAssumptionSource', schema: { type: 'string' } },
        { in: 'query', name: 'riskScenarios', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRefs', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only gas capacity booking review gate evidence',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  reviewScope: { type: 'object' },
                  capacityAssumptionSummary: { type: 'object' },
                  scenarioEvidenceStatus: { type: 'object' },
                  vdmiReview: { type: 'object' },
                  commercialSignoff: { type: 'object' },
                  riskScenarios: { type: 'array' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
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
      const cacheKey = `gas-capacity-booking-review-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gasCapacityBookingReviewGateStatus,
        async () => ({
          ...this.buildGasCapacityBookingReviewGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  gasNetworkDecisionChainStatus: {
    rest: 'GET /gas-network-decision-chain',
    params: {
      chainId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      reconciliationId: { type: 'string', optional: true, min: 1 },
      segmentId: { type: 'string', optional: true, min: 1 },
      capacityAssumption: { type: 'string', optional: true, min: 1 },
      capacityEvidenceRef: { type: 'string', optional: true, min: 1 },
      decommissioningPath: { type: 'string', optional: true, min: 1 },
      decommissioningEvidenceRef: { type: 'string', optional: true, min: 1 },
      regulatoryImpactRef: { type: 'string', optional: true, min: 1 },
      eogRef: { type: 'string', optional: true, min: 1 },
      kanuRef: { type: 'string', optional: true, min: 1 },
      assetRef: { type: 'string', optional: true, min: 1 },
      bookValueRef: { type: 'string', optional: true, min: 1 },
      photoYear: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string' }],
      },
      decisionDeadline: { type: 'string', optional: true, min: 1 },
      ownerRole: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      gateStatus: { type: 'string', optional: true, min: 1 },
      blockedFollowUpDecision: { type: 'string', optional: true, min: 1 },
      nextEvidenceStep: { type: 'string', optional: true, min: 1 },
      sourceRefs: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Gas network decision chain -- read-only evidence projection',
      description:
        'Returns a deterministic dossier-safe decision-chain view over gas capacity assumptions, decommissioning path, KANU/EOG references, asset/book-value references, Fotojahr window and blocked follow-up decisions. ' +
        'The endpoint is read-only and never executes capacity booking, stilllegung, investment approval, Asset-MDM overrides, HITL, notifications, billing, settlement, tariff, MaKo, contract, device-control or external connector actions.',
      parameters: [
        { name: 'chainId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'reconciliationId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'segmentId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'capacityAssumption', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decommissioningPath', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'regulatoryImpactRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'assetRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'bookValueRef', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'photoYear', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'decisionDeadline', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'blockedFollowUpDecision',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'nextEvidenceStep', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'capacityEvidenceRef', schema: { type: 'string' } },
        { in: 'query', name: 'decommissioningEvidenceRef', schema: { type: 'string' } },
        { in: 'query', name: 'eogRef', schema: { type: 'string' } },
        { in: 'query', name: 'kanuRef', schema: { type: 'string' } },
        { in: 'query', name: 'ownerRole', schema: { type: 'string' } },
        { in: 'query', name: 'gateStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRefs', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only gas network decision-chain evidence',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  chainScope: { type: 'object' },
                  capacityAssumptionStatus: { type: 'object' },
                  decommissioningPathStatus: { type: 'object' },
                  regulatoryImpactStatus: { type: 'object' },
                  assetBookValueStatus: { type: 'object' },
                  photoYearWindow: { type: 'object' },
                  owner: { type: 'object' },
                  blockedFollowUpDecision: { type: 'string' },
                  nextEvidenceStep: { type: 'string' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
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
      const cacheKey = `gas-network-decision-chain:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.gasNetworkDecisionChainStatus,
        async () => ({
          ...this.buildGasNetworkDecisionChainStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  waterPricingNetInvestmentAlignmentStatus: {
    rest: 'GET /water-pricing-net-investment-alignment',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      projectId: { type: 'string', optional: true, min: 1 },
      tenantId: { type: 'string', optional: true, min: 1 },
      waterPriceReference: { type: 'string', optional: true, min: 1 },
      calculationReference: { type: 'string', optional: true, min: 1 },
      netInvestmentReference: { type: 'string', optional: true, min: 1 },
      infrastructureMeasureReference: { type: 'string', optional: true, min: 1 },
      assetAccountingReference: { type: 'string', optional: true, min: 1 },
      leaseOrConcessionReference: { type: 'string', optional: true, min: 1 },
      pachtnetzReference: { type: 'string', optional: true, min: 1 },
      regulatoryImpactReference: { type: 'string', optional: true, min: 1 },
      tariffLogicReference: { type: 'string', optional: true, min: 1 },
      governanceOwner: { type: 'string', optional: true, min: 1 },
      committeeOwner: { type: 'string', optional: true, min: 1 },
      reviewPeriod: { type: 'string', optional: true, min: 1 },
      targetCommitteeDate: { type: 'string', optional: true, min: 1 },
      alignmentDecision: { type: 'string', optional: true, min: 1 },
      sourceRefs: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Water pricing / net-investment alignment -- read-only evidence gate',
      description:
        'Returns a deterministic dossier-safe alignment view over water-price assumptions, net-investment references, asset-accounting evidence, Pachtnetz/concession references, regulatory-impact evidence, owner, review period and committee decision state. ' +
        'The endpoint is read-only and never calculates an official water price, claims regulatory approval, mutates accounting, billing, settlement, tariff, MaKo, contract or payment data, creates HITL/notifications, or calls external connectors.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'projectId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'waterPriceReference', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'calculationReference',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'netInvestmentReference',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'assetAccountingReference',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'pachtnetzReference', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'regulatoryImpactReference',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'governanceOwner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'reviewPeriod', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'targetCommitteeDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'alignmentDecision', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'infrastructureMeasureReference', schema: { type: 'string' } },
        { in: 'query', name: 'leaseOrConcessionReference', schema: { type: 'string' } },
        { in: 'query', name: 'tariffLogicReference', schema: { type: 'string' } },
        { in: 'query', name: 'committeeOwner', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRefs', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only water pricing / net-investment alignment evidence',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  alignmentScope: { type: 'object' },
                  pricingEvidence: { type: 'object' },
                  investmentEvidence: { type: 'object' },
                  assetAccountingEvidence: { type: 'object' },
                  leaseConditionEvidence: { type: 'object' },
                  regulatoryBoundaryEvidence: { type: 'object' },
                  owner: { type: 'object' },
                  reviewWindow: { type: 'object' },
                  alignmentDecision: { type: 'string' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
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
      const cacheKey = `water-pricing-net-investment-alignment:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.waterPricingNetInvestmentAlignmentStatus,
        async () => ({
          ...this.buildWaterPricingNetInvestmentAlignmentStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  arealNetworkIntegrationOfferGateStatus: {
    rest: 'GET /areal-network-integration-offer-gate',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      projectId: { type: 'string', optional: true, min: 1 },
      tenantId: { type: 'string', optional: true, min: 1 },
      siteReference: { type: 'string', optional: true, min: 1 },
      areaReference: { type: 'string', optional: true, min: 1 },
      requestedConnectionCapacity: { type: 'string', optional: true, min: 1 },
      requestedCapacityKw: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'number' }],
      },
      gridCapacityEvidence: { type: 'string', optional: true, min: 1 },
      capacityEvidenceReference: { type: 'string', optional: true, min: 1 },
      targetGridPath: { type: 'string', optional: true, min: 1 },
      zielnetzPath: { type: 'string', optional: true, min: 1 },
      investmentReference: { type: 'string', optional: true, min: 1 },
      capexReference: { type: 'string', optional: true, min: 1 },
      regulatoryImpactBoundary: { type: 'string', optional: true, min: 1 },
      regulatoryImpactReference: { type: 'string', optional: true, min: 1 },
      commercialOfferAssumptions: { type: 'string', optional: true, min: 1 },
      offerAssumptionReference: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      gateOwner: { type: 'string', optional: true, min: 1 },
      nextDecisionDate: { type: 'string', optional: true, min: 1 },
      offerDecisionStatus: { type: 'string', optional: true, min: 1 },
      sourceRefs: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'string' }, { type: 'array' }],
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Areal network-integration offer gate -- read-only evidence gate',
      description:
        'Returns a deterministic dossier-safe decision card over site/area, requested connection capacity, grid-capacity evidence, target-grid path, investment/CAPEX evidence, regulatory boundary, commercial offer assumptions, owner, decision date and offer decision state. ' +
        'The endpoint is read-only and never calculates a binding offer, reserves grid capacity, approves investments, creates contracts, mutates Asset-MDM, billing, settlement, tariff, MaKo or device-control systems, creates HITL/notifications, or calls external connectors.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'projectId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'siteReference', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'areaReference', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'requestedConnectionCapacity',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'requestedCapacityKw', in: 'query', required: false, schema: { type: 'number' } },
        {
          name: 'gridCapacityEvidence',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'targetGridPath', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'investmentReference', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'regulatoryImpactBoundary',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        {
          name: 'commercialOfferAssumptions',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextDecisionDate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'offerDecisionStatus', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'tenantId', schema: { type: 'string' } },
        { in: 'query', name: 'capacityEvidenceReference', schema: { type: 'string' } },
        { in: 'query', name: 'zielnetzPath', schema: { type: 'string' } },
        { in: 'query', name: 'capexReference', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryImpactReference', schema: { type: 'string' } },
        { in: 'query', name: 'offerAssumptionReference', schema: { type: 'string' } },
        { in: 'query', name: 'gateOwner', schema: { type: 'string' } },
        { in: 'query', name: 'sourceRefs', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Areal network-integration offer evidence',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  decisionScope: { type: 'object' },
                  capacityEvidence: { type: 'object' },
                  targetGridEvidence: { type: 'object' },
                  investmentEvidence: { type: 'object' },
                  regulatoryBoundaryEvidence: { type: 'object' },
                  commercialAssumptionEvidence: { type: 'object' },
                  owner: { type: 'object' },
                  decisionWindow: { type: 'object' },
                  missingEvidence: { type: 'array' },
                  positiveFollowUps: { type: 'array' },
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
      const cacheKey = `areal-network-integration-offer-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.arealNetworkIntegrationOfferGateStatus,
        async () => ({
          ...this.buildArealNetworkIntegrationOfferGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  transformationFinancingScenarioViewStatus: {
    rest: 'GET /transformation-financing-scenario-view',
    params: {
      scenarioId: { type: 'string', optional: true, min: 1 },
      gridOperatorId: { type: 'string', optional: true, min: 1 },
      planningHorizon: { type: 'string', optional: true, min: 1 },
      scenarioType: { type: 'string', optional: true, min: 1 },
      cashflowSource: { type: 'string', optional: true, min: 1 },
      cashflowSourceRef: { type: 'string', optional: true, min: 1 },
      marginCompensationAssumption: { type: 'string', optional: true, min: 1 },
      capitalReallocationOption: { type: 'string', optional: true, min: 1 },
      gasDecommissioningPath: { type: 'string', optional: true, min: 1 },
      rollbackCostBasis: { type: 'string', optional: true, min: 1 },
      heatInvestmentMeasure: { type: 'string', optional: true, min: 1 },
      h2OptionMeasure: { type: 'string', optional: true, min: 1 },
      municipalBurdenAssumption: { type: 'string', optional: true, min: 1 },
      publicTransportShareholderBurden: { type: 'string', optional: true, min: 1 },
      operationalInvestmentNeed: { type: 'string', optional: true, min: 1 },
      eogImpact: { type: 'string', optional: true, min: 1 },
      regulatoryImpactAssumption: { type: 'string', optional: true, min: 1 },
      liquidityImpact: { type: 'string', optional: true, min: 1 },
      stressThreshold: { type: 'string', optional: true, min: 1 },
      committeeDecisionGate: { type: 'string', optional: true, min: 1 },
      vdmiProcessId: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
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
      summary: 'Transformation financing scenario view -- read-only evidence gate',
      description:
        'Returns a deterministic dossier-safe view over transformation financing scenario identity, cashflow, margin, capital reallocation, gas decommissioning, rollback/removal cost, heat/H2 investment, municipal burden, operational investment, EOG/regulatory, liquidity/stress and committee-gate evidence. ' +
        'The endpoint is read-only and never creates finance/accounting records, executes treasury transfers, mutates gas assets, prepares billing/settlement/tariff/MaKo output, creates HITL/VDMI tasks, or calls external connectors.',
      parameters: [
        { name: 'scenarioId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'gridOperatorId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'planningHorizon', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'scenarioType', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'cashflowSource', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'rollbackCostBasis', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'municipalBurdenAssumption',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'eogImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'liquidityImpact', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'stressThreshold', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'committeeDecisionGate',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        },
        { name: 'sourceDatapoints', in: 'query', required: false, schema: { type: 'string' } },
        { in: 'query', name: 'cashflowSourceRef', schema: { type: 'string' } },
        { in: 'query', name: 'marginCompensationAssumption', schema: { type: 'string' } },
        { in: 'query', name: 'capitalReallocationOption', schema: { type: 'string' } },
        { in: 'query', name: 'gasDecommissioningPath', schema: { type: 'string' } },
        { in: 'query', name: 'heatInvestmentMeasure', schema: { type: 'string' } },
        { in: 'query', name: 'h2OptionMeasure', schema: { type: 'string' } },
        { in: 'query', name: 'publicTransportShareholderBurden', schema: { type: 'string' } },
        { in: 'query', name: 'operationalInvestmentNeed', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryImpactAssumption', schema: { type: 'string' } },
        { in: 'query', name: 'vdmiProcessId', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'sourceActions', schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only transformation financing scenario evidence view',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  capabilityKey: { type: 'string' },
                  status: { type: 'string' },
                  readinessScore: { type: 'number' },
                  scenarioSummary: { type: 'object' },
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
      const cacheKey = `transformation-financing-scenario-view:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.transformationFinancingScenarioViewStatus,
        async () => ({
          ...this.buildTransformationFinancingScenarioViewStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  investmentBudgetCapExceptionGovernanceStatus: {
    rest: 'GET /investment-budget-cap-exception-governance',
    params: {
      measureId: { type: 'string', optional: true, min: 1 },
      measureName: { type: 'string', optional: true, min: 1 },
      scope: { type: 'string', optional: true, min: 1 },
      budgetCapEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      requiredBudgetEur: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      noRegretCriterion: { type: 'string', optional: true, min: 1 },
      technicalJustification: { type: 'string', optional: true, min: 1 },
      regulatoryContext: { type: 'string', optional: true, min: 1 },
      kpiReference: { type: 'string', optional: true, min: 1 },
      division: { type: 'string', optional: true, min: 1 },
      assetRef: { type: 'string', optional: true, min: 1 },
      dataQuality: { type: 'string', optional: true, min: 1 },
      evidenceRefs: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      riskIfDeferred: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      deadline: { type: 'string', optional: true, min: 1 },
      nextDecisionGate: { type: 'string', optional: true, min: 1 },
      exceptionJustification: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceActions: {
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
      summary: 'Investment budget cap exception governance -- read-only evidence queue',
      description:
        'Builds deterministic dossier-safe evidence for investment measures above a budget cap or missing an exception justification. ' +
        'The endpoint is read-only and never approves budgets, creates committee decisions, writes SAP/ERP/PSP records, creates HITL/workflow tasks, sends communications, calls external connectors, or mutates billing/settlement/MaKo/tariff/device-control data.',
      responses: {
        200: {
          description: 'Read-only budget-cap exception governance evidence',
        },
      },
      parameters: [
        { in: 'query', name: 'measureId', schema: { type: 'string' } },
        { in: 'query', name: 'measureName', schema: { type: 'string' } },
        { in: 'query', name: 'scope', schema: { type: 'string' } },
        { in: 'query', name: 'budgetCapEur', schema: { type: 'string' } },
        { in: 'query', name: 'requiredBudgetEur', schema: { type: 'string' } },
        { in: 'query', name: 'noRegretCriterion', schema: { type: 'string' } },
        { in: 'query', name: 'technicalJustification', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryContext', schema: { type: 'string' } },
        { in: 'query', name: 'kpiReference', schema: { type: 'string' } },
        { in: 'query', name: 'division', schema: { type: 'string' } },
        { in: 'query', name: 'assetRef', schema: { type: 'string' } },
        { in: 'query', name: 'dataQuality', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceRefs', schema: { type: 'string' } },
        { in: 'query', name: 'riskIfDeferred', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'deadline', schema: { type: 'string' } },
        { in: 'query', name: 'nextDecisionGate', schema: { type: 'string' } },
        { in: 'query', name: 'exceptionJustification', schema: { type: 'string' } },
        { in: 'query', name: 'sourceDatapoints', schema: { type: 'string' } },
        { in: 'query', name: 'sourceActions', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `investment-budget-cap-exception-governance:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.investmentBudgetCapExceptionGovernanceStatus,
        async () => ({
          ...this.buildInvestmentBudgetCapExceptionGovernanceStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  investmentOwnerDeadlineBudgetGateStatus: {
    rest: 'GET /investment-owner-deadline-budget-gate',
    params: {
      measureId: { type: 'string', optional: true, min: 1 },
      measureTitle: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      deadline: { type: 'string', optional: true, min: 1 },
      budgetEffect: { type: 'string', optional: true, min: 1 },
      requiredEvidence: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      approvalStatus: { type: 'string', optional: true, min: 1 },
      blockedFollowUpDecision: { type: 'string', optional: true, min: 1 },
      nextEscalationStep: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceActions: {
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
      summary: 'Investment Owner-Frist-Budget Gate -- read-only evidence gate',
      description:
        'Returns a deterministic dossier-safe view over investment measure owner, deadline, budget effect, required evidence, approval status, blocked follow-up decision and next escalation step. ' +
        'The endpoint is read-only and never approves budgets, creates finance/accounting records, mutates investment workflows, prepares billing/settlement/tariff/MaKo output, creates HITL tasks, or calls external connectors.',
      responses: {
        200: {
          description: 'Read-only investment owner/deadline/budget gate evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'measureId', schema: { type: 'string' } },
        { in: 'query', name: 'measureTitle', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'deadline', schema: { type: 'string' } },
        { in: 'query', name: 'budgetEffect', schema: { type: 'string' } },
        { in: 'query', name: 'requiredEvidence', schema: { type: 'string' } },
        { in: 'query', name: 'approvalStatus', schema: { type: 'string' } },
        { in: 'query', name: 'blockedFollowUpDecision', schema: { type: 'string' } },
        { in: 'query', name: 'nextEscalationStep', schema: { type: 'string' } },
        { in: 'query', name: 'sourceDatapoints', schema: { type: 'string' } },
        { in: 'query', name: 'sourceActions', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `investment-owner-deadline-budget-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.investmentOwnerDeadlineBudgetGateStatus,
        async () => ({
          ...this.buildInvestmentOwnerDeadlineBudgetGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  directMarketerRiskGateStatus: {
    rest: 'GET /direct-marketer-risk-gate',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      projectId: { type: 'string', optional: true, min: 1 },
      communityModel: { type: 'string', optional: true, min: 1 },
      directMarketer: { type: 'string', optional: true, min: 1 },
      forecastQuality: { type: 'string', optional: true, min: 1 },
      forecastDeviationPct: {
        type: 'multi',
        optional: true,
        rules: [{ type: 'number' }, { type: 'string', min: 1 }],
      },
      allocationRules: { type: 'string', optional: true, min: 1 },
      balancingGroupImpact: { type: 'string', optional: true, min: 1 },
      scheduleImpact: { type: 'string', optional: true, min: 1 },
      billingStatus: { type: 'string', optional: true, min: 1 },
      settlementStatus: { type: 'string', optional: true, min: 1 },
      roleOwner: { type: 'string', optional: true, min: 1 },
      deadline: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      sourceEvidence: {
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
      summary: 'Direktvermarkter Risk Gate -- read-only dossier-safe status',
      description:
        'Returns deterministic dossier-safe risk/readiness evidence for a Direktvermarkter handover package across forecast quality, allocation rules, balancing-group/schedule impact, billing/settlement status, roles, deadlines and open evidence. ' +
        'The endpoint is read-only and never submits schedules, approves offers/contracts, transfers balancing groups, mutates billing/settlement/tariff/customer data, creates HITL/workflow tasks, sends customer communication, calls webhooks, or contacts external Direktvermarkter systems.',
      responses: {
        200: {
          description: 'Read-only Direktvermarkter risk-gate evidence',
        },
      },
      parameters: [
        { in: 'query', name: 'caseId', schema: { type: 'string' } },
        { in: 'query', name: 'projectId', schema: { type: 'string' } },
        { in: 'query', name: 'communityModel', schema: { type: 'string' } },
        { in: 'query', name: 'directMarketer', schema: { type: 'string' } },
        { in: 'query', name: 'forecastQuality', schema: { type: 'string' } },
        { in: 'query', name: 'forecastDeviationPct', schema: { type: 'string' } },
        { in: 'query', name: 'allocationRules', schema: { type: 'string' } },
        { in: 'query', name: 'balancingGroupImpact', schema: { type: 'string' } },
        { in: 'query', name: 'scheduleImpact', schema: { type: 'string' } },
        { in: 'query', name: 'billingStatus', schema: { type: 'string' } },
        { in: 'query', name: 'settlementStatus', schema: { type: 'string' } },
        { in: 'query', name: 'roleOwner', schema: { type: 'string' } },
        { in: 'query', name: 'deadline', schema: { type: 'string' } },
        { in: 'query', name: 'evidenceStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourceEvidence', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `direct-marketer-risk-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.directMarketerRiskGateStatus,
        async () => ({
          ...this.buildDirectMarketerRiskGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  noRegretMeasureDefinitionGateStatus: {
    rest: 'GET /no-regret-measure-definition-gate',
    params: {
      measureId: { type: 'string', optional: true, min: 1 },
      programmeId: { type: 'string', optional: true, min: 1 },
      measureName: { type: 'string', optional: true, min: 1 },
      scenarioAssumption: { type: 'string', optional: true, min: 1 },
      transformationEffect: { type: 'string', optional: true, min: 1 },
      budgetEffect: { type: 'string', optional: true, min: 1 },
      fundingOwner: { type: 'string', optional: true, min: 1 },
      regulatoryFit: { type: 'string', optional: true, min: 1 },
      constraintHint: { type: 'string', optional: true, min: 1 },
      prioritisationRule: { type: 'string', optional: true, min: 1 },
      nominationRight: { type: 'string', optional: true, min: 1 },
      dataQualityStatus: { type: 'string', optional: true, min: 1 },
      sourceSnapshot: { type: 'string', optional: true, min: 1 },
      communicationRule: { type: 'string', optional: true, min: 1 },
      stakeholderGroup: { type: 'string', optional: true, min: 1 },
      nextReviewGate: { type: 'string', optional: true, min: 1 },
      dueDate: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      sourceDatapoints: {
        type: 'multi',
        optional: true,
        rules: [
          { type: 'array', items: 'string' },
          { type: 'string', min: 1 },
        ],
      },
      sourceActions: {
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
      summary: 'No-Regret measure definition gate -- read-only evidence gate',
      description:
        'Returns a deterministic dossier-safe view over No-Regret measure definition evidence: scenario/effect, budget/funding owner, regulatory fit, prioritisation/nomination rule, data quality, communication rule, and next review gate. ' +
        'The endpoint is read-only and never approves measures or budgets, mutates programmes, creates HITL tasks, runs MaKo/A96/billing/settlement/tariff/device-control effects, or calls external connectors.',
      responses: {
        200: {
          description: 'Read-only No-Regret measure definition evidence',
        },
      },

      parameters: [
        { in: 'query', name: 'measureId', schema: { type: 'string' } },
        { in: 'query', name: 'programmeId', schema: { type: 'string' } },
        { in: 'query', name: 'measureName', schema: { type: 'string' } },
        { in: 'query', name: 'scenarioAssumption', schema: { type: 'string' } },
        { in: 'query', name: 'transformationEffect', schema: { type: 'string' } },
        { in: 'query', name: 'budgetEffect', schema: { type: 'string' } },
        { in: 'query', name: 'fundingOwner', schema: { type: 'string' } },
        { in: 'query', name: 'regulatoryFit', schema: { type: 'string' } },
        { in: 'query', name: 'constraintHint', schema: { type: 'string' } },
        { in: 'query', name: 'prioritisationRule', schema: { type: 'string' } },
        { in: 'query', name: 'nominationRight', schema: { type: 'string' } },
        { in: 'query', name: 'dataQualityStatus', schema: { type: 'string' } },
        { in: 'query', name: 'sourceSnapshot', schema: { type: 'string' } },
        { in: 'query', name: 'communicationRule', schema: { type: 'string' } },
        { in: 'query', name: 'stakeholderGroup', schema: { type: 'string' } },
        { in: 'query', name: 'nextReviewGate', schema: { type: 'string' } },
        { in: 'query', name: 'dueDate', schema: { type: 'string' } },
        { in: 'query', name: 'owner', schema: { type: 'string' } },
        { in: 'query', name: 'sourceDatapoints', schema: { type: 'string' } },
        { in: 'query', name: 'sourceActions', schema: { type: 'string' } },
      ],
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `no-regret-measure-definition-gate:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.noRegretMeasureDefinitionGateStatus,
        async () => ({
          ...this.buildNoRegretMeasureDefinitionGateStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },
};
