'use strict';

/**
 * Canonical domain taxonomy for the agent-facing llm.txt cluster manifest.
 *
 * Three independent, non-aligned vocabularies exist in this codebase:
 *  - capability.domain (src/capability-catalog.js)   — 32 raw values
 *  - recipe.domain (src/cookbook-recipes.js)         — 13 raw values, some cross-cutting
 *  - OpenAPI operation tags (openapi-export.json)     — 97 raw values
 *
 * This module maps all three into ONE fixed set of canonical domains so the
 * generated manifest can group capabilities, recipes, and operations consistently.
 *
 * Every mapper must classify every input. Anything that falls through is
 * reported as "unmapped" by classifyAll() so the generator can fail loudly
 * instead of silently dropping content (see scripts/generate-llm-txt.js).
 */

const CANONICAL_DOMAINS = [
  'redispatch',
  'grid-planning',
  'energy-sharing',
  'grid-ops',
  'inhouse-data',
  'market-data',
  'regulatory',
  'governance',
  'platform',
];

const UNMAPPED = 'unmapped';

// ── 1. capability.domain → canonical ─────────────────────────────────────────
// Capabilities already carry a curated `domain` field (src/capability-catalog.js).
// Per the task spec we trust that field and only normalize it onto the
// canonical taxonomy via this explicit lookup (no re-derivation from keywords).
const CAPABILITY_DOMAIN_MAP = {
  // decision-support / journalistic risk framing — advisory, not a hard data path
  cya: 'governance',
  // ZNP-linked anomaly correlation feeding investment signal
  znp_blindflug_radar: 'grid-planning',
  zielnetzplanung: 'grid-planning',
  // fNAV / flexible connection contract gating is an operational connection concern
  grid_connection_flexibility: 'grid-ops',
  'grid-operations': 'grid-ops',
  grid_operations: 'grid-ops', // underscore variant used by newer gate capabilities
  vnb_operations: 'grid-ops',
  // AGSI/ENTSO-E cross-commodity supply security briefing
  'market-operations': 'market-data',
  market_operations: 'market-data',
  // A96 redispatch settlement reconciliation
  settlement: 'redispatch',
  // load-profile / metering stream monitoring is internal EDM data
  'edm-monitoring': 'inhouse-data',
  'vdmi-governance': 'governance',
  inhouse: 'inhouse-data',
  // MaStR asset inventory is grid-operator/asset-registry centric
  assets: 'grid-ops',
  // Open Energy Platform research/scenario datasets
  oep: 'market-data',
  'finance-agent': 'governance',
  // Domain 1: Netzanschluss & BESS — connection-request lifecycle, all operational
  netzanschluss: 'grid-ops',
  grid_connection: 'grid-ops',
  // fNAV commercial hedging / flexibility cost grid — operational flex contracts
  flexibilitaet: 'grid-ops',
  // NKP/reporting maturity governance for grid operators
  stammdaten: 'governance',
  // reinvest signal, 100-Tage assessment, Altdaten migration, automation radar — CAPEX/investment cluster
  asset_management: 'grid-planning',
  // Wärmeplanungsgesetz-driven gas/heat network transformation
  gasnetz: 'regulatory',
  governance: 'governance',
  // AregV/StromNEV/§14a tariff rule logic
  regulatorik: 'regulatory',
  // file-ingest-monitor is explicitly domain-neutral platform infrastructure
  'data-governance': 'platform',
  redispatch: 'redispatch',
  // customer move-out billing evidence is EDM-driven internal data
  'edm-customer-service': 'inhouse-data',
  'energy-sharing': 'energy-sharing',
  'redispatch-rcs': 'redispatch',
  redispatch_governance: 'redispatch',
  // datasource registry/cache/classifier governance — cross-cutting data infra
  'datasource-governance': 'platform',
  // read-only UI/API contract discovery such as live-update readiness
  platform_ui_contracts: 'platform',
  // human-in-the-loop request plumbing — agent/process infrastructure
  hitl: 'platform',
  // EVU/VNB API migration diagnostics are interface-readiness evidence, not a live connector
  api_migration: 'platform',
  // MSCONS/MK40 messkonzept, Bilanzkreis/SLP — internal metering data
  edm: 'inhouse-data',
  // BESS flex-forecast advisory for grid operations
  forecast: 'grid-ops',
  // NKP/CAPEX/Reinvestitionsplanung — investment planning
  finance: 'grid-planning',
  // kommunale Wärmeplanung / Gasnetz-Transformation — regulatory-law driven
  gas: 'regulatory',
  regulatory: 'regulatory',
  // CAPEX/investment governance cluster (budget waterfall, committee steering,
  // data review, risk translation, two-track control, SAP PSP, off-balance gate)
  investment_governance: 'grid-planning',
  'investment-finance-governance': 'grid-planning',
  transformation_finance_governance: 'grid-planning',
  transformation_governance: 'grid-planning',
  // gas/heat network transformation governance — WPG-driven, regulatory
  gas_transformation_governance: 'regulatory',
  gas_grid_transformation: 'regulatory',
  'gas-capacity-governance': 'regulatory',
  heat_transformation: 'regulatory',
  heat_steering: 'regulatory', // Fernwaerme tariff steering, post-2030 recognition risk
  // pure decision/process governance, no single business vertical
  process_governance: 'governance',
  governance_decision_closure: 'governance',
  governance_management: 'governance',
  coordination_governance: 'governance',
  cross_domain_management: 'governance',
  vnb_data_quality_governance: 'governance',
  vnb_governance: 'governance',
  management_steering: 'governance',
  nova_governance: 'governance',
  automation_governance: 'governance',
  // single-candidate operating-model evidence gate — decision-support governance
  model_viability_governance: 'governance',
  ki_governance: 'governance',
  audit_governance: 'governance',
  // metering asset financial/accounting governance (off-balance treatment) —
  // a finance/compliance gate, not operational metering data
  metering_finance_governance: 'governance',
  finance_governance: 'governance',
  // iMSys/CLS smart-meter-gateway value chain — internal metering infrastructure
  imsys_cls_value_chain: 'inhouse-data',
  metering_governance: 'inhouse-data',
  // CLS (Controllable Local System) compliance — regulatory compliance gate
  cls_compliance_governance: 'regulatory',
  // legacy/operational grid control systems
  legacy_control_governance: 'grid-ops',
  // Steuerbarkeitscheck / §14a controllability — operational connection mechanism
  steuerbarkeitscheck_governance: 'grid-ops',
  asset_governance: 'grid-ops',
  asset_strategy: 'grid-planning',
  gas_strategy: 'regulatory',
  flex_governance: 'grid-ops',
  operations: 'platform',
  // tax/regulatory data handover
  tax_finance_data_handover: 'regulatory',
  regulatory_readiness: 'regulatory',
  regulatory_revenue: 'regulatory',
  re4de_grid_fees: 'regulatory',
  water_pricing_governance: 'regulatory',
  grid_connection_commercial_gate: 'grid-planning',
  // A2MDM mapping/release evidence is decision-governance unless a read/write asset store is added.
  a2mdm: 'governance',
  // market communication/messaging evidence chain
  market_communication: 'market-data',
  // agent's own answer-evidence/dossier-quality infrastructure
  answer_evidence: 'platform',
  'energy-routing': 'platform',
  compliance: 'regulatory',
  // demo-sandbox lifecycle/runtime boundary, not production tenant lifecycle
  sandbox_governance: 'platform',
};

// ── 2. OpenAPI operation tag → canonical ─────────────────────────────────────
// Covers every tag currently present in openapi-export.json. New services MUST
// add their tag here or they surface as "unmapped" in the build stats.
const OPENAPI_TAG_DOMAIN_MAP = {
  'Actor Personas': 'platform',
  'Agent Manifest': 'platform',
  'Evidence Router': 'platform',
  'Agent Receipts': 'platform',
  'AI Agent': 'platform',
  'agnes-bottleneck': 'grid-ops',
  'altdaten-assessment': 'grid-planning',
  api: 'platform',
  Assets: 'grid-ops',
  Authentication: 'platform',
  automatisierungsradar: 'grid-planning',
  'Backup & Restore': 'platform',
  'bess-screening': 'grid-ops',
  'Settlement (Abrechnung)': 'redispatch',
  'Blindflug Radar': 'grid-planning',
  'blueprint-management': 'platform',
  'Business Intelligence': 'platform',
  'capex-prioritization': 'grid-ops',
  'clarification-policy': 'platform',
  Companies: 'platform',
  'connection-rejection-evidence': 'grid-ops',
  Cookbook: 'platform',
  'Copilot Process': 'platform',
  'Customer Service': 'platform',
  'CYA Agent': 'governance',
  'Dashboard API': 'platform',
  Datapoints: 'platform',
  DataSources: 'platform',
  'Tabular Intelligence': 'inhouse-data',
  'Decision Frame': 'governance',
  'e2e-connection-check': 'grid-ops',
  'EDM Messkonzept': 'inhouse-data',
  'EDM (Energiedatenmanagement)': 'inhouse-data',
  'eeg-clawback-calculator': 'regulatory',
  'EIC Code Management': 'grid-ops',
  'Energy Market Data': 'market-data',
  'Energy Sharing Allocation': 'energy-sharing',
  'Energy Sharing Community': 'energy-sharing',
  'Energy Sharing Validation': 'energy-sharing',
  'ENTSO-E': 'market-data',
  'EOG Calculator': 'regulatory',
  'EWK Monitoring (BNetzA)': 'regulatory',
  'Finance Agent': 'governance',
  'Netzfahrplan / fNAV': 'grid-ops',
  'Flex (§14a Flexibilitätsmanagement)': 'grid-ops',
  'flexibilitaetskosten-raster': 'grid-ops',
  'fnav-commercial-hedging': 'grid-ops',
  'Forecast (Prognostik)': 'market-data',
  'Renewable Energy Forecasting': 'market-data',
  'Gas Storage (AGSI)': 'market-data',
  'gasnetz-waermeplanung': 'regulatory',
  'German Grid Data': 'grid-ops',
  'ghost-asset-alert': 'grid-ops',
  Governance: 'governance',
  'Grid Connection Validation': 'grid-ops',
  'Grid Operations': 'grid-ops',
  HITL: 'platform',
  Analytics: 'platform',
  'Interface Placeholder': 'platform',
  'Investment Planning': 'grid-planning',
  Jobs: 'platform',
  'Knowledge RAG': 'platform',
  'MCP Server': 'platform',
  'MaStR Monitor': 'grid-ops',
  'MaStR Data Quality': 'grid-ops',
  VNBMonitor: 'grid-ops',
  NBPMonitor: 'grid-ops',
  'netzkoppelvertrag-workflow': 'governance',
  'nkp-reporting': 'governance',
  NOVA: 'grid-planning',
  'Object Store': 'platform',
  Observability: 'platform',
  'Operations Runbook': 'platform',
  'OEP (Open Energy Platform)': 'market-data',
  'OSM Geo (OpenStreetMap)': 'grid-ops',
  'Personal Agent': 'platform',
  'OpenAI Compatible': 'platform',
  Presentation: 'platform',
  'Query Tools': 'platform',
  Copilot: 'platform',
  'rcs-rule-catalog': 'redispatch',
  'rcs-simulation-run': 'redispatch',
  'Redispatch Ex-Post': 'redispatch',
  'regulatorische-entgeltlogik': 'regulatory',
  'reinvest-signal': 'grid-planning',
  'reporting-governance': 'governance',
  'Residual Load': 'market-data',
  'SLP (Standardlastprofile)': 'inhouse-data',
  'System Tools': 'platform',
  'Tenant Quotas': 'platform',
  IntegrationHub: 'platform',
  'Utility Report': 'regulatory',
  'vdmi-governance-templates': 'governance',
  VDMI: 'governance',
  'vnb-100-tage-assessment': 'grid-planning',
  'Web Search': 'platform',
  Webhooks: 'platform',
  'Willi-Mako Marktkommunikation': 'market-data',
  'Willi-Regulatorik': 'regulatory',
  // federated search spans Marktkommunikation + regulatory collections; classified
  // with regulatory since that's the broader/less-covered of the two domains here.
  'Willi-Federated': 'regulatory',
  'Zielnetzplanung (ZNP)': 'grid-planning',
  ZNP: 'grid-planning',
  'vdmi-human-override': 'governance',
  'vdmi-spectator': 'governance',
  'vdmi-findings': 'governance',
  'vdmi-evidence': 'governance',
  'edm-messkonzept': 'inhouse-data',
  'vdmi-portfolio-gatekeeping': 'governance',
  // declarative routing-registry CRUD — agent infra, not a business domain
  'domain-routes': 'platform',
  'dossier-hydration': 'platform',
  // explicitly domain-neutral generic file/csv ingest monitoring infra
  'File Ingest Monitor': 'platform',
  'Redispatch Asset Register': 'redispatch',
  'Redispatch Data Governance': 'redispatch',
  'Redispatch Settlement Sandbox': 'redispatch',
  'Redispatch Special Case Gate': 'redispatch',
  'Agent Sidecar': 'platform',
  'ChatGPT Sidecar': 'platform',
  'Battery Redispatch Special Gate': 'redispatch',
  'Flexibility Conductor Role Model': 'grid-ops',
  'Gas Capacity Order Revision Gate': 'regulatory',
  'Investment Maturity Off-Balance Gate': 'grid-planning',
  'Knowledge Continuity Governance Gate': 'governance',
  'Re4DE Variable Grid Fee': 'regulatory',
  'Redispatch Readiness Gate': 'redispatch',
  Community: 'energy-sharing',
  operations: 'platform',
  'stadtwerk-mauer-sandbox-runtime': 'platform',
  'stadtwerk-mauer-external-interface-stubs': 'platform',
  'stadtwerk-mauer-e2e-process-demo': 'platform',
  'stadtwerk-mauer-mastr-data-overlay': 'platform',
};

// ── 3. recipe → canonical ────────────────────────────────────────────────────
// recipe.domain is NOT used directly — values like "agent-validation" mix
// recipes from completely unrelated subject domains (grid-connection,
// energy-sharing, mastr-quality, redispatch-expost, utility-report, osm-geo).
//
// Rule: take the FIRST recipe.tags[] entry that has a domain hint below
// (tags are written most-specific-subject-first in this codebase). If no tag
// hints, fall back to the most frequent src/cookbook-recipes.js process[].service
// (ties broken by first occurrence). If neither resolves, the recipe is
// reported unmapped.
const RECIPE_TAG_DOMAIN_HINTS = {
  vnb: 'grid-ops',
  assets: 'grid-ops',
  mastr: 'grid-ops',
  'residual-load': 'market-data',
  co2: 'market-data',
  prices: 'market-data',
  'grid-connection': 'grid-ops',
  fnav: 'grid-ops',
  netzfahrplan: 'grid-ops',
  netzsignal: 'grid-ops',
  'contract-gate': 'grid-ops',
  finance: 'governance',
  'energy-sharing': 'energy-sharing',
  'enwg-42c': 'energy-sharing',
  redispatch: 'redispatch',
  settlement: 'redispatch',
  forensic: 'redispatch',
  oep: 'market-data',
  'vnb-monitor': 'grid-ops',
  ewk: 'regulatory',
  regulatorikrisiko: 'regulatory',
  erloessteuerung: 'regulatory',
  'nbp-monitor': 'grid-ops',
  dashboard: 'platform',
  lastgang: 'inhouse-data',
  bewegungsstrom: 'inhouse-data',
  edm: 'inhouse-data',
  market: 'market-data',
  'spot-price': 'market-data',
  agents: 'platform',
  observability: 'platform',
  ops: 'platform',
  'production-feedback': 'platform',
  agent: 'platform',
  prompt: 'platform',
  debugging: 'platform',
  'feedback-loop': 'platform',
  // "datasource" recipes are about the customer's own uploaded inhouse data
  // (register/classify/join), not the platform's cross-cutting infra feature.
  datasource: 'inhouse-data',
  procurement: 'market-data',
  spot: 'market-data',
  generation: 'market-data',
  datapoint: 'platform',
  osm: 'grid-ops',
  substation: 'grid-ops',
  topology: 'grid-ops',
  znp: 'grid-planning',
  'g-factor': 'grid-planning',
  planning: 'grid-planning',
  'vde-ar-n-4100': 'grid-planning',
  nlp: 'platform',
  'section-14a': 'regulatory',
  'planned-assets': 'grid-planning',
  'strategic-prompts': 'grid-planning',
  llm: 'platform',
  layer2: 'grid-planning',
  transformer: 'grid-ops',
  'load-profile': 'inhouse-data',
  allocation: 'energy-sharing',
  'csv-export': 'platform',
  'utility-report': 'regulatory',
  compliance: 'regulatory',
  'flex-nav': 'grid-ops',
  capex: 'grid-planning',
  clustering: 'energy-sharing',
  storage: 'grid-planning',
  siting: 'grid-planning',
  'grid-benefit': 'grid-ops',
  nbp: 'grid-ops',
  nova: 'grid-planning',
  'data-quality': 'grid-ops',
  crowdsourcing: 'platform',
  'customer-service': 'platform',
  token: 'platform',
  prosumer: 'energy-sharing',
  nap: 'energy-sharing',
  wallet: 'energy-sharing',
  'section-42c': 'energy-sharing',
};

// Fallback when no recipe.tags[] entry resolves via RECIPE_TAG_DOMAIN_HINTS.
const RECIPE_SERVICE_DOMAIN_FALLBACK = {
  'grid-operations': 'grid-ops',
  'grid-connection': 'grid-ops',
  assets: 'grid-ops',
  'residual-load': 'market-data',
  'energy-market': 'market-data',
  'in-memory-join': 'inhouse-data',
  'energy-sharing': 'energy-sharing',
  'energy-sharing-allocation': 'energy-sharing',
  'mastr-quality': 'grid-ops',
  'redispatch-expost': 'redispatch',
  oep: 'market-data',
  'vnb-monitor': 'grid-ops',
  'nbp-monitor': 'grid-ops',
  'dashboard-api': 'platform',
  observability: 'platform',
  'datasource-registry': 'platform',
  'datasource-classifier': 'platform',
  'datasource-cache': 'platform',
  datapoint: 'platform',
  'osm-geo': 'grid-ops',
  znp: 'grid-planning',
  'utility-report': 'regulatory',
  'finance-agent': 'governance',
};

function normalizeDomain(domain, map) {
  if (!domain) return null;
  return map[domain] || null;
}

function mapCapabilityDomain(capability) {
  return normalizeDomain(capability && capability.domain, CAPABILITY_DOMAIN_MAP) || UNMAPPED;
}

function mapOpenApiTagsToDomain(tags) {
  const list = Array.isArray(tags) ? tags : [];
  for (const tag of list) {
    const mapped = OPENAPI_TAG_DOMAIN_MAP[tag];
    if (mapped) return mapped;
  }
  return UNMAPPED;
}

function mapRecipeDomain(recipe) {
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
  for (const tag of tags) {
    const mapped = RECIPE_TAG_DOMAIN_HINTS[tag];
    if (mapped) return mapped;
  }

  const serviceCounts = new Map();
  for (const step of recipe.process || []) {
    if (!step || !step.service) continue;
    serviceCounts.set(step.service, (serviceCounts.get(step.service) || 0) + 1);
  }

  let bestService = null;
  let bestCount = 0;
  for (const [service, count] of serviceCounts) {
    if (count > bestCount) {
      bestService = service;
      bestCount = count;
    }
  }

  return normalizeDomain(bestService, RECIPE_SERVICE_DOMAIN_FALLBACK) || UNMAPPED;
}

/**
 * Classifies capabilities, recipes, and OpenAPI operations onto the canonical
 * taxonomy. Returns per-domain buckets plus an `unmapped` list for each kind
 * so the caller can warn/fail loudly instead of silently losing entries.
 */
function classifyAll({ capabilities = [], recipes = [], operations = [] }) {
  const buckets = {};
  for (const domain of CANONICAL_DOMAINS) {
    buckets[domain] = { capabilities: [], recipes: [], operations: [] };
  }

  const unmapped = { capabilities: [], recipes: [], operations: [] };

  for (const capability of capabilities) {
    const domain = mapCapabilityDomain(capability);
    if (domain === UNMAPPED) {
      unmapped.capabilities.push(capability.capability);
    } else {
      buckets[domain].capabilities.push(capability);
    }
  }

  for (const recipe of recipes) {
    const domain = mapRecipeDomain(recipe);
    if (domain === UNMAPPED) {
      unmapped.recipes.push(recipe.id);
    } else {
      buckets[domain].recipes.push(recipe);
    }
  }

  for (const operation of operations) {
    const domain = mapOpenApiTagsToDomain(operation.tags);
    if (domain === UNMAPPED) {
      unmapped.operations.push(`${operation.method} ${operation.path}`);
    } else {
      buckets[domain].operations.push(operation);
    }
  }

  return { buckets, unmapped };
}

module.exports = {
  CANONICAL_DOMAINS,
  UNMAPPED,
  CAPABILITY_DOMAIN_MAP,
  OPENAPI_TAG_DOMAIN_MAP,
  RECIPE_TAG_DOMAIN_HINTS,
  RECIPE_SERVICE_DOMAIN_FALLBACK,
  mapCapabilityDomain,
  mapOpenApiTagsToDomain,
  mapRecipeDomain,
  classifyAll,
};
