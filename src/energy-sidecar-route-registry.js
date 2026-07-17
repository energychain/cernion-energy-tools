'use strict';

const { rankOperations } = require('./operation-capability-index');

const NO_CALL_GUARDS = Object.freeze([
  'recommendedEndpoint.execute',
  'external.connector.call',
  'hitl.create',
  'workflow.execute',
  'webhook.emit',
  'mail.send',
  'market.executeTrade',
  'schedule.submit',
  'billing.release',
  'settlement.prepareBilling',
  'settlement.exportA96',
  'tariff.mutate',
  'device-control.execute',
  'public-context.mutate',
  'personal-agent.execute',
]);

const ROUTE_SEEDS = Object.freeze([
  {
    routeKey: 'market_price_context',
    intentFamily: 'market_price_route_audit',
    domain: 'market',
    query: 'market price day ahead price zone route audit',
    preferredAction: 'energy-market.prices',
    preferredEndpoint: '/api/energy-market/prices',
    sourceRegistry: 'operation-capability-index',
    requiredInputs: ['market', 'region'],
    tenantScopeBoundary: 'tenant_read_context_only',
    fallbackRoute: 'market-snapshot or explicit missing-input explanation',
    positiveFollowUp:
      'market and region enable a grounded price-zone route recommendation without executing it',
  },
  {
    routeKey: 'mastr_public_context_lookup',
    intentFamily: 'mastr_asset_public_context_route_audit',
    domain: 'asset',
    query: 'mastr asset public context lookup route audit',
    preferredAction: 'energy-market.installations',
    preferredEndpoint: '/api/energy-market/installations',
    sourceRegistry: 'operation-capability-index',
    requiredInputs: ['installationType'],
    tenantScopeBoundary: 'public_or_tenant_read_context_only',
    fallbackRoute: 'public-context lookup gap or explicit postal-code / asset-id follow-up',
    positiveFollowUp:
      'asset type, postal code or MaStR id enables a grounded public-context route recommendation',
  },
  {
    routeKey: 'redispatch_readiness_evidence',
    intentFamily: 'redispatch_readiness_route_audit',
    domain: 'redispatch',
    query: 'redispatch readiness evidence gate route audit',
    preferredAction: 'redispatch-readiness-gate.getStatus',
    preferredEndpoint: '/api/redispatch-readiness-gate/status',
    sourceRegistry: 'capability-catalog',
    requiredInputs: ['processId'],
    tenantScopeBoundary: 'tenant_read_context_only',
    fallbackRoute: 'read-only status with found=false when no evaluation exists',
    positiveFollowUp:
      'process id enables lookup of the Redispatch readiness evidence status without creating a run',
  },
  {
    routeKey: 'market_communication_evidence_chain',
    intentFamily: 'market_communication_route_audit',
    domain: 'market-communication',
    query: 'market communication evidence chain route audit',
    preferredAction: 'dashboard-api.marketCommunicationEvidenceChainStatus',
    preferredEndpoint: '/api/dashboard/market-communication-evidence-chain',
    sourceRegistry: 'dashboard-api',
    requiredInputs: ['caseId'],
    tenantScopeBoundary: 'tenant_read_context_only',
    fallbackRoute: 'evidence-chain overview with explicit missing case context',
    positiveFollowUp: 'case id enables dossier-ready market-communication evidence-chain filtering',
  },
  {
    routeKey: 'vdmi_workbench_projection',
    intentFamily: 'vdmi_workbench_route_audit',
    domain: 'vdmi-workbench',
    query: 'stadtwerk mauer workbench vdmi route audit',
    preferredAction: 'dashboard-api.stadtwerkMauerBlueprintPackVerifyStatus',
    preferredEndpoint: '/api/dashboard/stadtwerk-mauer-blueprint-pack-verify',
    sourceRegistry: 'dashboard-api',
    requiredInputs: ['targetId'],
    tenantScopeBoundary: 'generated_workbench_projection_only',
    fallbackRoute: 'workbench projection route list with no live Budibase edit',
    positiveFollowUp: 'target id enables a deterministic generated-workbench projection check',
  },
]);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function providedInputSet(params = {}) {
  const provided = new Set();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      provided.add(key.toLowerCase());
    }
  }
  if (params.requiredInput) {
    String(params.requiredInput)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => provided.add(item.toLowerCase()));
  }
  return provided;
}

function matchSeed(seed, params) {
  const intent = normalizeText(params.intent);
  const domain = normalizeText(params.domain);
  if (!intent && !domain) return true;
  const haystack = normalizeText(
    [
      seed.routeKey,
      seed.intentFamily,
      seed.domain,
      seed.query,
      seed.preferredAction,
      seed.preferredEndpoint,
    ].join(' ')
  );
  const intentTokens = intent.split(' ').filter((token) => token.length > 2);
  const intentMatches = !intent || intentTokens.every((token) => haystack.includes(token));
  return (!domain || haystack.includes(domain)) && intentMatches;
}

function evidenceStatusFor(seed, params) {
  const provided = providedInputSet(params);
  const missingInputs = seed.requiredInputs.filter((input) => !provided.has(input.toLowerCase()));
  return {
    missingInputs,
    evidenceStatus: missingInputs.length ? 'missing_required_input' : 'route_grounded',
  };
}

function operationCandidateFor(seed, params) {
  const candidates = rankOperations(params.intent || seed.query, {
    domain: params.domain || null,
    limit: 5,
    extractedInputs: params,
  });
  return (
    candidates.find((candidate) => candidate.action === seed.preferredAction) ||
    candidates.find((candidate) => candidate.path === seed.preferredEndpoint) ||
    candidates[0] ||
    null
  );
}

function buildRouteRow(seed, params) {
  const candidate = operationCandidateFor(seed, params);
  const { missingInputs, evidenceStatus } = evidenceStatusFor(seed, params);
  return {
    routeKey: seed.routeKey,
    intentFamily: seed.intentFamily,
    preferredAction: seed.preferredAction,
    preferredEndpoint: seed.preferredEndpoint,
    sourceRegistry: candidate
      ? `${seed.sourceRegistry}+operation-capability-index`
      : seed.sourceRegistry,
    requiredInputs: [...seed.requiredInputs],
    tenantScopeBoundary: seed.tenantScopeBoundary,
    evidenceStatus,
    missingInputs,
    fallbackRoute: seed.fallbackRoute,
    positiveFollowUp: seed.positiveFollowUp,
    noCallGuards: [...NO_CALL_GUARDS],
    safety: 'read_only',
    operationEvidence: candidate
      ? {
          operationId: candidate.operationId || null,
          confidence: candidate.confidence || 'low',
          score: candidate.score || 0,
        }
      : {
          operationId: null,
          confidence: 'none',
          score: 0,
        },
  };
}

function buildEnergySidecarRouteRegistryStatus(params = {}) {
  const includeFallbacks = params.includeFallbacks === true || params.includeFallbacks === 'true';
  let rows = ROUTE_SEEDS.filter((seed) => matchSeed(seed, params)).map((seed) =>
    buildRouteRow(seed, params)
  );
  if (!includeFallbacks && params.intent) {
    rows = rows.filter((row) => row.evidenceStatus === 'route_grounded' || rows.length === 1);
  }
  if (!rows.length) {
    rows = [
      {
        routeKey: 'unsupported_domain_fallback',
        intentFamily: params.intent || 'missing_intent',
        preferredAction: 'interface-placeholder.requestEvidence',
        preferredEndpoint: null,
        sourceRegistry: 'capability-catalog',
        requiredInputs: ['intent', 'domain'],
        tenantScopeBoundary: 'tenant_read_context_only',
        evidenceStatus: 'unsupported_or_ambiguous_route',
        missingInputs: ['supported_domain_or_existing_endpoint'],
        fallbackRoute: 'explain unsupported route and request product cut instead of guessing',
        positiveFollowUp:
          'a supported domain and existing read-only endpoint enable deterministic route registration',
        noCallGuards: [...NO_CALL_GUARDS],
        safety: 'read_only',
        operationEvidence: { operationId: null, confidence: 'none', score: 0 },
      },
    ];
  }

  const missingEvidence = rows.flatMap((row) =>
    row.missingInputs.map((input) => ({
      missingDataPoint: input,
      routeKey: row.routeKey,
      enablesDossierAddition: row.positiveFollowUp,
    }))
  );
  const status = rows.some((row) => row.evidenceStatus === 'route_grounded')
    ? missingEvidence.length
      ? 'partial_route_registry_evidence'
      : 'route_registry_ready'
    : 'needs_route_context';
  const positiveFollowUps = missingEvidence.map((gap) => ({
    ...gap,
    category: 'energy_sidecar_route_registry',
  }));
  const sourceActions = {
    inspected: [
      'dashboard-api.energySidecarRouteRegistryStatus',
      'operation-capability-index.rankOperations',
      'capability-catalog.CURATED_CAPABILITIES',
    ],
    referenced: rows.map((row) => row.preferredAction).filter(Boolean),
    notCalled: [...NO_CALL_GUARDS],
  };
  const dossierFacts = [
    `Energy Sidecar Route Registry Status: ${status}`,
    `Routes: ${rows.length}`,
    `First Route: ${rows[0]?.routeKey || 'none'}`,
    `First Action: ${rows[0]?.preferredAction || 'none'}`,
    `Leading Gap: ${missingEvidence[0]?.missingDataPoint || 'none'}`,
    `Safety: read_only`,
  ];

  return {
    routeRegistryStatusId: `esrr:${Buffer.from(
      `${params.intent || ''}:${params.domain || ''}:${params.requiredInput || ''}`
    )
      .toString('base64url')
      .slice(0, 28)}`,
    capabilityKey: 'energy_sidecar_route_registry',
    safety: 'read_only',
    found: rows.length > 0,
    status,
    routeCount: rows.length,
    rows,
    missingEvidence,
    positiveFollowUps,
    sourceActions,
    decisionBoundary: {
      advisoryOnly: true,
      recommendedEndpointExecuted: false,
      externalConnectorCalled: false,
      productionMutation: false,
      personalAgentHardcoded: false,
    },
    dossierEvidence: {
      capabilityKey: 'energy_sidecar_route_registry',
      status,
      routeCount: rows.length,
      rows: rows.map((row) => ({
        routeKey: row.routeKey,
        intentFamily: row.intentFamily,
        preferredAction: row.preferredAction,
        preferredEndpoint: row.preferredEndpoint,
        sourceRegistry: row.sourceRegistry,
        requiredInputs: row.requiredInputs,
        tenantScopeBoundary: row.tenantScopeBoundary,
        evidenceStatus: row.evidenceStatus,
        fallbackRoute: row.fallbackRoute,
        positiveFollowUp: row.positiveFollowUp,
        noCallGuards: row.noCallGuards.slice(0, 4),
      })),
      missingEvidence,
      positiveFollowUps,
      sourceActions: { notCalled: sourceActions.notCalled },
      dossierFacts,
    },
  };
}

module.exports = {
  ROUTE_SEEDS,
  NO_CALL_GUARDS,
  buildEnergySidecarRouteRegistryStatus,
};
