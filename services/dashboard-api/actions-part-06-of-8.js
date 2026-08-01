'use strict';

// dashboard-api actions chunk 6/8 — extracted verbatim from
// services/dashboard-api.service.js as part of the v0.99 file-size modularization.
// Contains: stadtwerkMauerE2eProcessDemoStatus, stadtwerkMauerMastrDataOverlayStatus, stadtwerkMauerCaseDetailStatus, stadtwerkMauerCaseAnnotationCommand, stadtwerkMauerWorkbenchHubStatus, stadtwerkMauerBlueprintPackVerifyStatus, stadtwerkMauerTransferReadinessStatus, stadtwerkMauerLandingRegistryDraftStatus, energySidecarRouteRegistryStatus, interconnectionReleaseFileStatus, stadtwerkMauerAdministratorInventoryStatus, stadtwerkMauerTenantDatabrowserStatus, stadtwerkMauerCaseActionsStatus, stadtwerkMauerRoleWorkbenchCatalogStatus, stadtwerkMauerGridPlanningRoleQueueStatus, stadtwerkMauerGridPlanningSelectedItemDetailStatus

const {
  stadtwerkMauerSubstationLoadAssessment,
  stadtwerkMauerPvMissingNap,
  buildEnergySidecarRouteRegistryStatus,
  buildInterconnectionReleaseFileStatus,
  OPENAPI_TAG,
} = require('./shared');

module.exports = {
  stadtwerkMauerE2eProcessDemoStatus: {
    rest: 'GET /stadtwerk-mauer-e2e-process-demo',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      limit: { type: 'number', optional: true, convert: true, min: 1, max: 50 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer E2E process demo -- read-only status',
      description:
        'Reports deterministic Stadtwerk Mauer E2E demo traces, VDMI role/capability routing, ' +
        'stub transcript evidence, missing evidence, reset boundary and no-call guards. The endpoint ' +
        'is read-only; demo runs are separate sandbox-only non-consequential mutations.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer E2E process demo status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  tenantId: { type: 'string' },
                  demoPath: { type: 'string' },
                  caseId: { type: 'string', nullable: true },
                  traceCount: { type: 'number' },
                  artifactCount: { type: 'number' },
                  recentTraces: { type: 'array' },
                  rolesAndCapabilities: { type: 'array' },
                  evidenceQuality: { type: 'string' },
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
        'stadtwerk-mauer-e2e-process-demo.getStatus',
        { tenantId, caseId: params.caseId, limit: params.limit },
        this.buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId, params.caseId),
        errors,
        'stadtwerk-mauer-e2e-process-demo.getStatus'
      );
      return {
        ...status,
        timestamp: new Date().toISOString(),
        _errors: errors,
      };
    },
  },

  stadtwerkMauerMastrDataOverlayStatus: {
    rest: 'GET /stadtwerk-mauer-mastr-data-overlay',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      postalCode: { type: 'string', optional: true, min: 5, max: 5 },
      municipality: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      revalidationMode: { type: 'string', optional: true, min: 1 },
      limit: { type: 'any', optional: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer blended MaStR data overlay -- read-only status',
      description:
        'Reports the real MaStR baseline for Mauer and the virtual Stadtwerk Mauer ' +
        'operator overlay. Original MaStR facts and real-world operator provenance remain ' +
        'visible; no MaStR records, MaKo, device-control or external connectors are mutated.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'postalCode', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'municipality', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'revalidationMode', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'limit', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer blended MaStR data overlay status',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  tenantId: { type: 'string' },
                  municipality: { type: 'string' },
                  postalCode: { type: 'string' },
                  assetCount: { type: 'number' },
                  totalCapacityKw: { type: 'number' },
                  originalGridOperators: { type: 'array' },
                  operatorOverlay: { type: 'object' },
                  sampleAssets: { type: 'array' },
                  publicContextRows: { type: 'array' },
                  overlayAssetRows: { type: 'array' },
                  revalidationRows: { type: 'array' },
                  affectedCaseRows: { type: 'array' },
                  nextGateRows: { type: 'array' },
                  safeActionRows: { type: 'array' },
                  boundaryRows: { type: 'array' },
                  evidenceQuality: { type: 'string' },
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
        'stadtwerk-mauer-mastr-data-overlay.getStatus',
        {
          tenantId,
          postalCode: params.postalCode,
          municipality: params.municipality,
          limit: params.limit,
        },
        this.buildMissingStadtwerkMauerMastrDataOverlayStatus(tenantId, params),
        errors,
        'stadtwerk-mauer-mastr-data-overlay.getStatus'
      );
      const revalidationRows = this.buildStadtwerkMauerMastrRevalidationRows(status, params);
      return {
        ...status,
        publicContextRows:
          status.publicContextRows || this.buildStadtwerkMauerMastrPublicContextRows(status),
        overlayAssetRows:
          status.overlayAssetRows || this.buildStadtwerkMauerMastrOverlayAssetRows(status),
        revalidationRows: status.revalidationRows || revalidationRows,
        affectedCaseRows:
          status.affectedCaseRows ||
          this.buildStadtwerkMauerMastrAffectedCaseRows(status, params, revalidationRows),
        nextGateRows:
          status.nextGateRows ||
          this.buildStadtwerkMauerMastrNextGateRows(status, revalidationRows),
        safeActionRows:
          status.safeActionRows ||
          this.buildStadtwerkMauerMastrSafeActionRows(status, params, revalidationRows),
        boundaryRows: status.boundaryRows || this.buildStadtwerkMauerMastrBoundaryRows(status),
        timestamp: new Date().toISOString(),
        _errors: errors,
      };
    },
  },

  stadtwerkMauerCaseDetailStatus: {
    rest: 'GET /stadtwerk-mauer-case-detail',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer case detail -- read-only Workbench projection',
      description:
        'Returns a deterministic Budibase-renderable detail model for a selectable synthetic ' +
        'Stadtwerk Mauer PV missing-NAP demo case. The endpoint summarizes Blueprint seed, ' +
        'role-workbench hints, E2E trace/artifact status and operations-runbook links without ' +
        'executing Budibase, Rundeck, MaKo, billing, settlement, device-control or external actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer case detail projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const errors = [];
      const cacheKey = `stadtwerk-mauer-case-detail:${tenantId}:${caseId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerCaseDetailStatus,
        async () => {
          const e2eStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-e2e-process-demo.getStatus',
            { tenantId, caseId, limit: 10 },
            this.buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-e2e-process-demo.getStatus'
          );
          const annotationStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
            { tenantId, caseId, limit: 25 },
            this.buildMissingStadtwerkMauerCaseAnnotationStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations'
          );

          return {
            ...this.buildStadtwerkMauerCaseDetailStatus({
              tenantId,
              caseId,
              e2eStatus,
              annotationStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerCaseAnnotationCommand: {
    rest: 'POST /stadtwerk-mauer-case-annotations',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      commandType: { type: 'string', optional: true, min: 1 },
      status: { type: 'string', optional: true },
      note: { type: 'string', optional: true },
      reason: { type: 'string', optional: true },
      actorLabel: { type: 'string', optional: true },
      sourceLabel: { type: 'string', optional: true },
      idempotencyKey: { type: 'string', optional: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer case annotation -- sandbox command',
      description:
        'Records a bounded audited sandbox annotation/status for the selected synthetic ' +
        'Stadtwerk Mauer case. This is not a generic editor and does not write Budibase tables, ' +
        'mutate public context, trigger runbooks, MaKo, billing, settlement or device-control.',
      responses: {
        200: {
          description: 'Structured sandbox annotation command result',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const result = await ctx.call('stadtwerk-mauer-sandbox-runtime.recordCaseAnnotation', {
        ...params,
        tenantId,
        caseId,
      });

      for (const key of Array.from(this.cache.keys())) {
        if (
          key.startsWith(`stadtwerk-mauer-case-detail:${tenantId}:${caseId}`) ||
          key.startsWith(`stadtwerk-mauer-tenant-databrowser:${tenantId}:${caseId}`)
        ) {
          this.cache.delete(key);
        }
      }

      return {
        ...result,
        safety: 'non_consequential_sandbox_command',
        capabilityBroker: {
          exposed: false,
          reason: 'Curated Workbench command only; no broad broker route is added.',
        },
        hydrationRegistry: {
          exposed: false,
          reason: 'Dossier hydration remains read-only and must not invoke this POST command.',
        },
        noCallGuards: [
          'budibase.table.write',
          'budibase.system_of_record',
          'public-context.mutate',
          'production.mutate',
          'mako.dispatch',
          'billing.release',
          'settlement.prepareBilling',
          'tariff.mutate',
          'device-control.execute',
          'external.connector.call',
          'personal-agent.execute',
        ],
      };
    },
  },

  stadtwerkMauerWorkbenchHubStatus: {
    rest: 'GET /stadtwerk-mauer-workbench-hub',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer Workbench Hub -- read-only launcher projection',
      description:
        'Returns a deterministic Budibase-renderable hub model for the Stadtwerk Mauer ' +
        'Workbench. The endpoint exposes target readiness, route metadata, data-class ' +
        'separation, next gates and no-call guards without executing Budibase writes, ' +
        'Rundeck jobs, MaKo, billing, settlement, device-control or external actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer Workbench Hub projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const errors = [];
      const cacheKey = `stadtwerk-mauer-workbench-hub:${tenantId}:${caseId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerWorkbenchHubStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerWorkbenchHubStatus({
                tenantId,
                caseId,
                e2eStatus: null,
                mastrStatus: null,
                caseDetailStatus: null,
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
          const annotationStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
            { tenantId, caseId, limit: 25 },
            this.buildMissingStadtwerkMauerCaseAnnotationStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations'
          );
          const caseDetailStatus = this.buildStadtwerkMauerCaseDetailStatus({
            tenantId,
            caseId,
            e2eStatus,
            annotationStatus,
          });

          return {
            ...this.buildStadtwerkMauerWorkbenchHubStatus({
              tenantId,
              caseId,
              e2eStatus,
              mastrStatus,
              caseDetailStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerBlueprintPackVerifyStatus: {
    rest: 'GET /stadtwerk-mauer-blueprint-pack-verify',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      seedId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer Blueprint Pack verify -- read-only Workbench projection',
      description:
        'Returns scalar-friendly Blueprint-Pack verification evidence for the Stadtwerk Mauer ' +
        'Budibase Workbench. The endpoint reuses the static Blueprint seed validation contract ' +
        'and exposes no setup/reset/provisioning, direct Rundeck execution, Budibase writes, ' +
        'public-context mutation, MaKo, billing, settlement, tariff, device-control, external ' +
        'connector, secret/key or Personal-Agent action.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'seedId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer Blueprint Pack verify projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const seedId = params.seedId || stadtwerkMauerPvMissingNap.id;
      const cacheKey = `stadtwerk-mauer-blueprint-pack-verify:${tenantId}:${seedId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerBlueprintPackVerifyStatus,
        async () => ({
          ...this.buildStadtwerkMauerBlueprintPackVerifyStatus({ tenantId, seedId }),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  stadtwerkMauerTransferReadinessStatus: {
    rest: 'GET /stadtwerk-mauer-transfer-readiness',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      seedId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      includeBlockedBoundaries: { type: 'boolean', optional: true, convert: true },
      includeSafeNextSteps: { type: 'boolean', optional: true, convert: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer transfer readiness -- read-only Workbench projection',
      description:
        'Returns scalar Budibase-safe transfer-readiness rows for the Stadtwerk Mauer ' +
        'Blueprint Pack. The endpoint labels public context, synthetic seed data, sandbox ' +
        'runtime artifacts, tenant parameters, reusable Workbench elements and blocked ' +
        'production boundaries without setup/reset/provisioning, direct Rundeck execution, ' +
        'Budibase writes, public-context mutation, MaKo, billing, settlement, tariff, ' +
        'device-control, external connector, secret/key or Personal-Agent action.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'seedId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'includeBlockedBoundaries',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
        {
          name: 'includeSafeNextSteps',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
        },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer transfer-readiness projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const seedId = params.seedId || stadtwerkMauerPvMissingNap.id;
      const caseId = params.caseId || 'smm-budibase-workbench';
      const includeBlockedBoundaries = params.includeBlockedBoundaries !== false;
      const includeSafeNextSteps = params.includeSafeNextSteps !== false;
      const cacheKey = [
        'stadtwerk-mauer-transfer-readiness',
        tenantId,
        seedId,
        caseId,
        includeBlockedBoundaries ? 'with-boundaries' : 'no-boundaries',
        includeSafeNextSteps ? 'with-next-steps' : 'no-next-steps',
      ].join(':');

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerTransferReadinessStatus,
        async () => ({
          ...this.buildStadtwerkMauerTransferReadinessStatus({
            tenantId,
            seedId,
            caseId,
            includeBlockedBoundaries,
            includeSafeNextSteps,
          }),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  stadtwerkMauerLandingRegistryDraftStatus: {
    rest: 'GET /stadtwerk-mauer-landing-registry-draft',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      seedId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer Landing-Registry draft -- read-only sync proof',
      description:
        'Returns a deterministic Landing-Registry draft projection for the Stadtwerk Mauer ' +
        'Blueprint-Pack demo seed. The draft is derived from the canonical ' +
        'Blueprint-Pack demoProcessMatrix and keeps productive cernion.de publication pending. ' +
        'The endpoint performs no Landing-Registry write, Budibase write, deploy, publication, ' +
        'external connector, MaKo, billing, settlement, tariff, device-control, HITL, secret/key ' +
        'or Personal-Agent action.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'seedId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Landing-Registry draft sync proof',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const seedId = params.seedId || stadtwerkMauerSubstationLoadAssessment.id;
      const cacheKey = `stadtwerk-mauer-landing-registry-draft:${tenantId}:${seedId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerLandingRegistryDraftStatus,
        async () => ({
          ...this.buildStadtwerkMauerLandingRegistryDraftStatus({ tenantId, seedId }),
          timestamp: new Date().toISOString(),
        })
      );
    },
  },

  energySidecarRouteRegistryStatus: {
    rest: 'GET /energy-sidecar-route-registry',
    params: {
      intent: { type: 'string', optional: true, min: 1 },
      domain: { type: 'string', optional: true, min: 1 },
      requiredInput: { type: 'string', optional: true, min: 1 },
      tenantId: { type: 'string', optional: true, min: 1 },
      includeFallbacks: { type: 'boolean', optional: true, convert: true, default: false },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Energy Sidecar Route Registry -- read-only advisory evidence',
      description:
        'Returns deterministic dossier-safe route-registry rows for Fach-Sidecar routing/audit questions. ' +
        'The endpoint recommends existing read-only Cernion actions/endpoints, source registry boundaries, required inputs, fallback routes and no-call guards. ' +
        'It is advisory/read-only and never executes the recommended downstream endpoint, calls external connectors, creates HITL/workflows, sends webhooks/mail, mutates public context, or performs MaKo/billing/settlement/tariff/device-control actions.',
      parameters: [
        { name: 'intent', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'domain', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'requiredInput', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'includeFallbacks', in: 'query', required: false, schema: { type: 'boolean' } },
      ],
      responses: {
        200: {
          description: 'Read-only route-registry evidence',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const cacheKey = `energy-sidecar-route-registry:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.energySidecarRouteRegistryStatus,
        async () => ({
          ...buildEnergySidecarRouteRegistryStatus(params),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  interconnectionReleaseFileStatus: {
    rest: 'GET /interconnection-release-file',
    params: {
      caseId: { type: 'string', optional: true, min: 1 },
      koppelpunktId: { type: 'string', optional: true, min: 1 },
      marketPartnerId: { type: 'string', optional: true, min: 1 },
      timeseriesId: { type: 'string', optional: true, min: 1 },
      mappingVersion: { type: 'string', optional: true, min: 1 },
      sourceSystem: { type: 'string', optional: true, min: 1 },
      evidenceStatus: { type: 'string', optional: true, min: 1 },
      approvalStatus: { type: 'string', optional: true, min: 1 },
      owner: { type: 'string', optional: true, min: 1 },
      reviewerRole: { type: 'string', optional: true, min: 1 },
      affectedProcess: { type: 'string', optional: true, min: 1 },
      nextChangeGate: { type: 'string', optional: true, min: 1 },
      tenantId: { type: 'string', optional: true, min: 1 },
      includeFallbacks: { type: 'boolean', optional: true, convert: true, default: false },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Koppelpunkt Freigabeakte -- read-only evidence/gate status',
      description:
        'Returns deterministic dossier-safe Freigabeakte rows for Koppelpunkt, Marktpartner and Zeitreihen mapping decisions. ' +
        'The endpoint reports release status, evidence source/version, owner, downstream process impacts, missing evidence, positive follow-ups and no-call guards. ' +
        'It is advisory/read-only and never writes mappings, executes Freigabe workflows, creates HITL tickets, sends mail/webhooks, calls external connectors, mutates Budibase tables, or performs MaKo/billing/settlement/tariff/device-control actions.',
      parameters: [
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'koppelpunktId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'marketPartnerId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'timeseriesId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'mappingVersion', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'sourceSystem', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'evidenceStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'approvalStatus', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'owner', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'reviewerRole', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'affectedProcess', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'nextChangeGate', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'includeFallbacks', in: 'query', required: false, schema: { type: 'boolean' } },
      ],
      responses: {
        200: {
          description: 'Read-only interconnection release-file evidence',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'public';
      const cacheKey = `interconnection-release-file:${tenantId}:${JSON.stringify(params)}`;
      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.interconnectionReleaseFileStatus,
        async () => ({
          ...buildInterconnectionReleaseFileStatus({ ...params, tenantId }),
          timestamp: new Date().toISOString(),
          _errors: [],
        })
      );
    },
  },

  stadtwerkMauerAdministratorInventoryStatus: {
    rest: 'GET /stadtwerk-mauer-administrator-inventory',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      includeRuntime: { type: 'boolean', optional: true, convert: true },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer Administrator inventory -- read-only catalog projection',
      description:
        'Returns a deterministic Budibase-renderable Administrator inventory for the Stadtwerk ' +
        'Mauer Workbench. The endpoint separates public context, synthetic seed, sandbox runtime, ' +
        'generated Workbench items and runbook read/verify surfaces without provisioning, reset, ' +
        'Budibase writes, MaKo, billing, settlement, device-control or external actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'includeRuntime', in: 'query', required: false, schema: { type: 'boolean' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer Administrator inventory projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const includeRuntime = params.includeRuntime !== false;
      const errors = [];
      const cacheKey = `stadtwerk-mauer-administrator-inventory:${tenantId}:${caseId}:${includeRuntime}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerAdministratorInventoryStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerAdministratorInventoryStatus({
                tenantId,
                caseId,
                includeRuntime,
                e2eStatus: null,
                mastrStatus: null,
                caseDetailStatus: null,
                hubStatus: null,
              }),
              timestamp: new Date().toISOString(),
              _errors: errors,
            };
          }

          const e2eStatus = includeRuntime
            ? await this.safeCall(
                ctx,
                'stadtwerk-mauer-e2e-process-demo.getStatus',
                { tenantId, caseId, limit: 10 },
                this.buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId, caseId),
                errors,
                'stadtwerk-mauer-e2e-process-demo.getStatus'
              )
            : this.buildMissingStadtwerkMauerE2eProcessDemoStatus(tenantId, caseId);
          const mastrStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-mastr-data-overlay.getStatus',
            { tenantId, limit: 10 },
            this.buildMissingStadtwerkMauerMastrDataOverlayStatus(tenantId, {}),
            errors,
            'stadtwerk-mauer-mastr-data-overlay.getStatus'
          );
          const annotationStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
            { tenantId, caseId, limit: 25 },
            this.buildMissingStadtwerkMauerCaseAnnotationStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations'
          );
          const caseDetailStatus = this.buildStadtwerkMauerCaseDetailStatus({
            tenantId,
            caseId,
            e2eStatus,
            annotationStatus,
          });
          const hubStatus = this.buildStadtwerkMauerWorkbenchHubStatus({
            tenantId,
            caseId,
            e2eStatus,
            mastrStatus,
            caseDetailStatus,
          });

          return {
            ...this.buildStadtwerkMauerAdministratorInventoryStatus({
              tenantId,
              caseId,
              includeRuntime,
              e2eStatus,
              mastrStatus,
              caseDetailStatus,
              hubStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerTenantDatabrowserStatus: {
    rest: 'GET /stadtwerk-mauer-tenant-databrowser',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      categoryId: { type: 'string', optional: true, min: 1 },
      itemId: { type: 'string', optional: true, min: 1 },
      limit: { type: 'number', optional: true, convert: true, integer: true, min: 1, max: 50 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer Tenant Databrowser -- read-only bounded inspection rows',
      description:
        'Returns bounded scalar category, item, trace and detail rows for the Stadtwerk Mauer ' +
        'Administrator Workbench. The endpoint is read-only, sandbox-scoped and does not export, ' +
        'replay traces, mutate public context, write Budibase tables or execute runbooks.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'categoryId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'itemId', in: 'query', required: false, schema: { type: 'string' } },
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 50 },
        },
      ],
      responses: {
        200: {
          description: 'Read-only bounded Stadtwerk Mauer Tenant Databrowser projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const categoryId = params.categoryId || null;
      const itemId = params.itemId || null;
      const limit = Math.max(1, Math.min(Number(params.limit || 25), 50));
      const errors = [];
      const cacheKey = [
        'stadtwerk-mauer-tenant-databrowser',
        tenantId,
        caseId,
        categoryId || 'all',
        itemId || 'none',
        limit,
      ].join(':');

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerTenantDatabrowserStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerTenantDatabrowserStatus({
                tenantId,
                caseId,
                categoryId,
                itemId,
                limit,
                e2eStatus: null,
                mastrStatus: null,
                caseDetailStatus: null,
                hubStatus: null,
                administratorInventoryStatus: null,
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
          const annotationStatus = await this.safeCall(
            ctx,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations',
            { tenantId, caseId, limit: 25 },
            this.buildMissingStadtwerkMauerCaseAnnotationStatus(tenantId, caseId),
            errors,
            'stadtwerk-mauer-sandbox-runtime.listCaseAnnotations'
          );
          const caseDetailStatus = this.buildStadtwerkMauerCaseDetailStatus({
            tenantId,
            caseId,
            e2eStatus,
            annotationStatus,
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

          return {
            ...this.buildStadtwerkMauerTenantDatabrowserStatus({
              tenantId,
              caseId,
              categoryId,
              itemId,
              limit,
              e2eStatus,
              mastrStatus,
              caseDetailStatus,
              hubStatus,
              administratorInventoryStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerCaseActionsStatus: {
    rest: 'GET /stadtwerk-mauer-case-actions',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer case actions -- read-only/verify-only action contract',
      description:
        'Returns deterministic Budibase-renderable selected-case action and process-panel metadata for the ' +
        'Stadtwerk Mauer Workbench. The endpoint exposes refresh, Blueprint verify, ' +
        'evidence validation, runbook boundary and last-result rows without executing ' +
        'Budibase writes, setup/reset/provisioning, Rundeck jobs, MaKo, billing, settlement, ' +
        'device-control, HITL or external connector actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer selected-case action contract',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const errors = [];
      const cacheKey = `stadtwerk-mauer-case-actions:${tenantId}:${caseId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerCaseActionsStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerCaseActionsStatus({
                tenantId,
                caseId,
                caseDetailStatus: null,
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
          const caseDetailStatus = this.buildStadtwerkMauerCaseDetailStatus({
            tenantId,
            caseId,
            e2eStatus,
          });

          return {
            ...this.buildStadtwerkMauerCaseActionsStatus({
              tenantId,
              caseId,
              caseDetailStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerRoleWorkbenchCatalogStatus: {
    rest: 'GET /stadtwerk-mauer-role-workbench-catalog',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer role Workbench catalog -- read-only open-target contract',
      description:
        'Returns deterministic Budibase-renderable role Workbench target metadata for the ' +
        'Stadtwerk Mauer Workbench Hub. The endpoint exposes scalar role/open-target rows ' +
        'for Administrator, Zielnetzplanung, Vertrieb, Key Account and VDMI governance views ' +
        'without implementing role calculations, Budibase writes, authorization changes, ' +
        'MaKo, billing, settlement, device-control, HITL or external connector actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer role Workbench catalog projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const errors = [];
      const cacheKey = `stadtwerk-mauer-role-workbench-catalog:${tenantId}:${caseId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerRoleWorkbenchCatalogStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerRoleWorkbenchCatalogStatus({
                tenantId,
                caseId,
                hubStatus: null,
                administratorInventoryStatus: null,
                caseActionsStatus: null,
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

          return {
            ...this.buildStadtwerkMauerRoleWorkbenchCatalogStatus({
              tenantId,
              caseId,
              hubStatus,
              administratorInventoryStatus,
              caseActionsStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerGridPlanningRoleQueueStatus: {
    rest: 'GET /stadtwerk-mauer-grid-planning-role-queue',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer grid-planning role queue -- read-only evidence handover',
      description:
        'Returns deterministic Budibase-renderable Zielnetzplanung queue and evidence handover ' +
        'rows for the Stadtwerk Mauer Workbench. The endpoint exposes scalar generated role ' +
        'queue facts for the synthetic PV missing-NAP case without role assignment writes, ' +
        'Budibase writes, grid-capacity calculations, MaKo, billing, settlement, device-control, ' +
        'HITL or external connector actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer grid-planning role queue projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const errors = [];
      const cacheKey = `stadtwerk-mauer-grid-planning-role-queue:${tenantId}:${caseId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerGridPlanningRoleQueueStatus,
        async () => {
          if (tenantId !== 'stadtwerk-mauer') {
            return {
              ...this.buildStadtwerkMauerGridPlanningRoleQueueStatus({
                tenantId,
                caseId,
                caseDetailStatus: null,
                roleCatalogStatus: null,
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

          return {
            ...this.buildStadtwerkMauerGridPlanningRoleQueueStatus({
              tenantId,
              caseId,
              caseDetailStatus,
              roleCatalogStatus,
            }),
            timestamp: new Date().toISOString(),
            _errors: errors,
          };
        }
      );
    },
  },

  stadtwerkMauerGridPlanningSelectedItemDetailStatus: {
    rest: 'GET /stadtwerk-mauer-grid-planning-selected-item-detail',
    params: {
      tenantId: { type: 'string', optional: true, min: 1 },
      caseId: { type: 'string', optional: true, min: 1 },
      queueItemId: { type: 'string', optional: true, min: 1 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Stadtwerk Mauer grid-planning selected item detail -- read-only next-gate context',
      description:
        'Returns scalar Budibase-renderable detail, context, evidence gap, next-gate and safe ' +
        'follow-up rows for one generated Zielnetzplanung role-queue item. The endpoint is ' +
        'advisory/read-only and does not approve grid capacity, mutate public context, write ' +
        'Budibase tables, run planning engines, call external connectors or execute operational actions.',
      parameters: [
        { name: 'tenantId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'caseId', in: 'query', required: false, schema: { type: 'string' } },
        { name: 'queueItemId', in: 'query', required: false, schema: { type: 'string' } },
      ],
      responses: {
        200: {
          description: 'Read-only Stadtwerk Mauer selected grid-planning item detail projection',
        },
      },
    },
    async handler(ctx) {
      const params = { ...ctx.params };
      const tenantId = params.tenantId || ctx.meta?.tenantId || 'stadtwerk-mauer';
      const caseId = params.caseId || 'smm-budibase-workbench';
      const queueItemId = params.queueItemId || 'grid-planning:missing-nap-clarification';
      const cacheKey = `stadtwerk-mauer-grid-planning-selected-item-detail:${tenantId}:${caseId}:${queueItemId}`;

      return this.cacheGetOrFetch(
        cacheKey,
        this.settings.cacheTtlMs.stadtwerkMauerGridPlanningSelectedItemDetailStatus,
        async () => {
          const queueStatus = await ctx.call(
            'dashboard-api.stadtwerkMauerGridPlanningRoleQueueStatus',
            {
              tenantId,
              caseId,
            }
          );

          return {
            ...this.buildStadtwerkMauerGridPlanningSelectedItemDetailStatus({
              tenantId,
              caseId,
              queueItemId,
              queueStatus,
            }),
            timestamp: new Date().toISOString(),
          };
        }
      );
    },
  },
};
