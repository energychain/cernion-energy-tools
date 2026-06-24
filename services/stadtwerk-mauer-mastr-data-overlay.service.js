'use strict';

const { getTenantId } = require('../src/tenant-context');

const SANDBOX_TENANT_ID = 'stadtwerk-mauer';
const CAPABILITY_KEY = 'stadtwerk_mauer_mastr_data_overlay';
const DEFAULT_POSTAL_CODE = '69256';
const DEFAULT_MUNICIPALITY = 'Mauer';
const VIRTUAL_GRID_OPERATOR = {
  name: 'Stadtwerk Mauer',
  role: 'virtual_distribution_system_operator',
  tenantId: SANDBOX_TENANT_ID,
};
const REAL_WORLD_OPERATOR_HINT = {
  name: 'Syna GmbH',
  role: 'real_world_grid_operator',
};

const NO_CALL_GUARDS = [
  'mako.dispatch',
  'msb.connector.call',
  'edm.connector.call',
  'customer-service.send',
  'billing.release',
  'settlement.prepareBilling',
  'tariff.mutate',
  'switching.execute',
  'webhook.emit',
  'device-control.execute',
  'smgw.connector.call',
  'cls.control.execute',
  'external.connector.call',
  'hitl.create',
  'personal-agent.execute',
  'tenant.delete.production',
  'mastr.write',
];

function resolveTenant(ctx, explicitTenantId) {
  return String(explicitTenantId || getTenantId(ctx) || SANDBOX_TENANT_ID).toLowerCase();
}

function pickValue(item, keys) {
  for (const key of keys) {
    if (item?.[key] != null && item[key] !== '') return item[key];
  }
  return null;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeInstallationResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.installations)) return result.data.installations;
  if (Array.isArray(result?.data?.results)) return result.data.results;
  if (Array.isArray(result?.installations)) return result.installations;
  if (Array.isArray(result?.results)) return result.results;
  return [];
}

function installationId(item) {
  return pickValue(item, [
    'mastrNummer',
    'EinheitMastrNummer',
    'einheitMastrNummer',
    'MastrNummer',
    'id',
  ]);
}

function installationType(item) {
  return (
    pickValue(item, ['installationType', 'assetType', 'type', 'einheitTypLabel', 'EinheitTypLabel']) ||
    'unknown'
  );
}

function installedCapacityKw(item) {
  return numberValue(
    pickValue(item, [
      'bruttoleistung',
      'Bruttoleistung',
      'bruttoleistungKw',
      'bruttoleistungKW',
      'capacityKw',
      'capacityKW',
      'nettonennleistung',
      'Nettonennleistung',
    ])
  );
}

function operatorName(item) {
  return pickValue(item, [
    'netzbetreiberName',
    'NetzbetreiberName',
    'gridOperatorName',
    'netzbetreiber',
    'operatorName',
  ]);
}

function operatorMastrId(item) {
  return pickValue(item, [
    'netzbetreiberMastrNummer',
    'NetzbetreiberMastrNummer',
    'gridOperatorMastrId',
    'gridOperatorId',
  ]);
}

function buildOperatorSummary(installations) {
  const byKey = new Map();
  for (const item of installations) {
    const name = operatorName(item);
    const mastrId = operatorMastrId(item);
    const key = `${name || 'unknown'}|${mastrId || 'unknown'}`;
    const current = byKey.get(key) || { name, mastrId, assetCount: 0, capacityKw: 0 };
    current.assetCount += 1;
    current.capacityKw += installedCapacityKw(item);
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((a, b) => b.assetCount - a.assetCount);
}

module.exports = {
  name: 'stadtwerk-mauer-mastr-data-overlay',

  actions: {
    getStatus: {
      rest: 'GET /status',
      params: {
        tenantId: { type: 'string', optional: true },
        postalCode: { type: 'string', optional: true, min: 5, max: 5 },
        municipality: { type: 'string', optional: true, min: 1 },
        limit: { type: 'any', optional: true },
      },
      async handler(ctx) {
        const tenantId = resolveTenant(ctx, ctx.params.tenantId);
        const postalCode = ctx.params.postalCode || DEFAULT_POSTAL_CODE;
        const municipality = ctx.params.municipality || DEFAULT_MUNICIPALITY;
        const limit = ctx.params.limit == null ? 'all' : ctx.params.limit;
        const sandboxBoundaryAllowed = tenantId === SANDBOX_TENANT_ID;

        if (!sandboxBoundaryAllowed) {
          return this.buildBlockedStatus({ tenantId, postalCode, municipality });
        }

        let installations = [];
        let queryFailed = false;
        let queryError = null;
        try {
          const result = await ctx.call('energy-market.installations', {
            installationType: 'all',
            postleitzahl: postalCode,
            location: municipality,
            operationalStatus: 'all',
            includeNapData: true,
            limit,
          });
          installations = normalizeInstallationResult(result);
        } catch (err) {
          queryFailed = true;
          queryError = err.message;
        }

        return this.buildStatus({
          tenantId,
          postalCode,
          municipality,
          limit,
          installations,
          queryFailed,
          queryError,
        });
      },
    },
  },

  methods: {
    buildStatus({ tenantId, postalCode, municipality, limit, installations, queryFailed, queryError }) {
      const assetCount = installations.length;
      const totalCapacityKw = installations.reduce((sum, item) => sum + installedCapacityKw(item), 0);
      const typeCounts = installations.reduce((acc, item) => {
        const type = installationType(item);
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});
      const originalGridOperators = buildOperatorSummary(installations);
      const sourceActions = this.sourceActionGuards();
      const missingEvidence = [];
      if (queryFailed) {
        missingEvidence.push({
          missingDataPoint: 'mastr_query_result',
          enablesDossierAddition: 'restore MaStR read path for Stadtwerk Mauer real-data overlay',
        });
      }
      if (!queryFailed && assetCount === 0) {
        missingEvidence.push({
          missingDataPoint: 'mauer_mastr_assets',
          enablesDossierAddition: 'load public MaStR assets for Mauer before running blended demos',
        });
      }

      const sampleAssets = installations.slice(0, 5).map((item) => ({
        mastrNummer: installationId(item),
        assetType: installationType(item),
        capacityKw: installedCapacityKw(item),
        originalGridOperatorName: operatorName(item),
        originalGridOperatorMastrId: operatorMastrId(item),
        virtualGridOperatorName: VIRTUAL_GRID_OPERATOR.name,
      }));
      const positiveFollowUps = missingEvidence.map((item) => ({ ...item, category: CAPABILITY_KEY }));
      const status = queryFailed
        ? 'blended_overlay_mastr_query_failed'
        : assetCount > 0
          ? 'blended_overlay_ready'
          : 'blended_overlay_needs_mastr_assets';
      const evidenceQuality = queryFailed
        ? 'query_unavailable'
        : assetCount > 0
          ? 'real_mastr_baseline_with_virtual_operator_overlay'
          : 'awaiting_real_mastr_baseline';

      return {
        capabilityKey: CAPABILITY_KEY,
        safety: 'read_only_real_mastr_baseline_with_virtual_operator_overlay',
        tenantId,
        requiredTenantId: SANDBOX_TENANT_ID,
        sandboxBoundaryAllowed: true,
        status,
        municipality,
        postalCode,
        mastrQuery: {
          action: 'energy-market.installations',
          installationType: 'all',
          postleitzahl: postalCode,
          location: municipality,
          operationalStatus: 'all',
          includeNapData: true,
          limit,
          queryFailed,
          queryError,
        },
        assetCount,
        totalCapacityKw: Number(totalCapacityKw.toFixed(3)),
        typeCounts,
        originalGridOperators,
        operatorOverlay: {
          mode: 'tenant_role_process_overlay',
          virtualGridOperator: VIRTUAL_GRID_OPERATOR,
          realWorldOperatorHint: REAL_WORLD_OPERATOR_HINT,
          preservesOriginalMastrFacts: true,
          mutatesMastrRecords: false,
          explanation:
            'MaStR asset facts remain unchanged; Stadtwerk Mauer is applied only as tenant, role and process context.',
        },
        sampleAssets,
        evidenceQuality,
        missingEvidence,
        positiveFollowUps,
        resetBoundary: {
          service: 'stadtwerk-mauer-sandbox-runtime.reset',
          scopedToTenant: SANDBOX_TENANT_ID,
          deletesImportedMastrBaseline: false,
          deletesDerivedSandboxArtifacts: true,
        },
        sourceActions,
        dossierEvidence: {
          status,
          tenantId,
          municipality,
          postalCode,
          assetCount,
          totalCapacityKw: Number(totalCapacityKw.toFixed(3)),
          virtualGridOperatorName: VIRTUAL_GRID_OPERATOR.name,
          realWorldOperatorHint: REAL_WORLD_OPERATOR_HINT.name,
          originalGridOperators,
          sampleAssets,
          missingEvidence,
          positiveFollowUps,
          sourceActions,
          dossierFacts: [
            `Overlay Status: ${status}`,
            `Tenant: ${tenantId}`,
            `Municipality: ${municipality}`,
            `Postal Code: ${postalCode}`,
            `MaStR Assets: ${assetCount}`,
            `Virtual Grid Operator: ${VIRTUAL_GRID_OPERATOR.name}`,
            `Real-world operator hint: ${REAL_WORLD_OPERATOR_HINT.name}`,
          ],
        },
      };
    },

    buildBlockedStatus({ tenantId, postalCode, municipality }) {
      const missingEvidence = [
        {
          missingDataPoint: 'stadtwerk_mauer_tenant_scope',
          enablesDossierAddition: 'switch to tenant stadtwerk-mauer for the blended MaStR overlay',
        },
      ];
      const sourceActions = this.sourceActionGuards();
      return {
        capabilityKey: CAPABILITY_KEY,
        safety: 'read_only_real_mastr_baseline_with_virtual_operator_overlay',
        tenantId,
        requiredTenantId: SANDBOX_TENANT_ID,
        sandboxBoundaryAllowed: false,
        status: 'blocked_outside_sandbox_tenant',
        municipality,
        postalCode,
        mastrQuery: {
          action: 'energy-market.installations',
          skipped: true,
          reason: 'tenant_scope_mismatch',
        },
        assetCount: 0,
        totalCapacityKw: 0,
        typeCounts: {},
        originalGridOperators: [],
        operatorOverlay: {
          mode: 'tenant_role_process_overlay',
          virtualGridOperator: VIRTUAL_GRID_OPERATOR,
          realWorldOperatorHint: REAL_WORLD_OPERATOR_HINT,
          preservesOriginalMastrFacts: true,
          mutatesMastrRecords: false,
        },
        sampleAssets: [],
        evidenceQuality: 'blocked_by_tenant_scope',
        missingEvidence,
        positiveFollowUps: missingEvidence.map((item) => ({ ...item, category: CAPABILITY_KEY })),
        resetBoundary: {
          service: 'stadtwerk-mauer-sandbox-runtime.reset',
          scopedToTenant: SANDBOX_TENANT_ID,
          deletesImportedMastrBaseline: false,
          deletesDerivedSandboxArtifacts: true,
        },
        sourceActions,
        dossierEvidence: {
          status: 'blocked_outside_sandbox_tenant',
          tenantId,
          municipality,
          postalCode,
          assetCount: 0,
          totalCapacityKw: 0,
          virtualGridOperatorName: VIRTUAL_GRID_OPERATOR.name,
          realWorldOperatorHint: REAL_WORLD_OPERATOR_HINT.name,
          originalGridOperators: [],
          sampleAssets: [],
          missingEvidence,
          positiveFollowUps: missingEvidence.map((item) => ({ ...item, category: CAPABILITY_KEY })),
          sourceActions,
          dossierFacts: [
            'Overlay Status: blocked_outside_sandbox_tenant',
            `Tenant: ${tenantId}`,
            `Required Tenant: ${SANDBOX_TENANT_ID}`,
          ],
        },
      };
    },

    sourceActionGuards() {
      return {
        inspected: ['stadtwerk-mauer-mastr-data-overlay.getStatus'],
        referenced: ['energy-market.installations', 'stadtwerk-mauer-sandbox-runtime.reset'],
        notCalled: [...NO_CALL_GUARDS],
      };
    },
  },
};
