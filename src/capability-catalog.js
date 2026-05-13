/**
 * Capability Broker v1 curated catalog.
 *
 * Domain capability -> preferred action path -> action metadata hints.
 * Auto-discovery may add supplemental candidates, but this curated list remains
 * the primary decision layer in v1.
 */

const BROKER_SCHEMA_VERSION = 'cernion.capabilityRecommendation.v1';

const INTERFACE_PLACEHOLDER_CAPABILITY = {
  capability: 'interface_placeholder',
  domain: 'governance',
  abstractionLevel: 'explicit_gap_marker',
  intent: 'mark_unknown_execution_gap',
  keywords: [],
  preferredActions: [
    'interface-placeholder.markGap',
    'interface-placeholder.requestEvidence',
    'interface-placeholder.listGaps',
  ],
  fallbackActions: ['interface-placeholder.markGap'],
  avoid: ['query.ask', 'query.askLearned'],
  requiredInputs: [
    {
      name: 'role',
      label: 'Betroffene Rolle / Capability Owner',
      type: 'string',
      required: true,
    },
    {
      name: 'reason',
      label: 'Gap Reason',
      type: 'string',
      required: true,
    },
  ],
  risksAndNotes: [
    'Placeholder sind explizite Lückenmarker und keine fachliche Wahrheit.',
    'confidence bleibt immer low bis zur Auflösung mit Evidenz oder Entscheidung.',
  ],
  routingPattern: 'explicit_gap_marker',
  isFallback: true,
};

const CURATED_CAPABILITIES = [
  {
    capability: 'blindflug_radar_anomaly_detection',
    domain: 'znp_blindflug_radar',
    abstractionLevel: 'domain_workflow',
    intent: 'detect_disturbance_anomalies_and_correlate',
    keywords: [
      'blindflug',
      'radar',
      'disturbance',
      'störung',
      'störungen',
      'investitionssignal',
      'bottleneck',
      'redispatch',
    ],
    preferredActions: ['v1.blindflug-radar.scan', 'znp.correlateDisturbance'],
    fallbackActions: ['interface-placeholder.markGap'],
    avoid: ['query.ask'],
    requiredInputs: [
      {
        name: 'vnbId',
        label: 'VNB Identifier',
        type: 'string',
        required: true,
      },
      {
        name: 'projectId',
        label: 'ZNP Project ID',
        type: 'string',
        required: true,
      },
    ],
    risksAndNotes: [
      'Anomalies must be routed through interface-placeholder if evidence is missing.',
      'High severity anomalies require HITL creation via ZNP correlation.',
    ],
    routingPattern: 'blindflug_znp_correlation',
  },
  {
    capability: 'znp_portfolio_assessment',
    domain: 'zielnetzplanung',
    abstractionLevel: 'layered_portfolio_logic',
    intent: 'assess_znp_portfolio',
    keywords: [
      'portfolio',
      'zielnetzplanung',
      'znp',
      'fnav',
      'kaufmännische',
      'kaufmaennische',
      'layer 0',
      'layer 2',
      'strategic assumption',
      'strategische annahme',
    ],
    preferredActions: ['znp.assessPortfolio'],
    fallbackActions: ['interface-placeholder.markGap'],
    avoid: ['query.ask', 'query.askLearned'],
    requiredInputs: [
      {
        name: 'projectId',
        label: 'ZNP Project ID',
        type: 'string',
        required: true,
      },
      {
        name: 'kaufmaennischeFreigabeFnav',
        label: 'Kaufmännische fNAV-Freigabe',
        type: 'boolean',
        required: false,
        default: false,
      },
    ],
    risksAndNotes: [
      'Resultate müssen provenanceFlags transparent ausweisen (Layer 0/2/2.5).',
      'Fehlende kaufmännische fNAV-Freigabe bleibt manueller Hard-Blocker.',
      'Strategische Annahmen sind bewusst niedriger reliabel als gemessene Layer-2-Daten.',
    ],
    routingPattern: 'znp_hybrid_portfolio_assessment',
  },
  {
    capability: 'residual_load_forecast_for_dso',
    domain: 'grid-operations',
    abstractionLevel: 'domain_workflow',
    intent: 'residual_load_forecast_for_dso',
    keywords: [
      'residuallast',
      'residual load',
      'co2',
      'co₂',
      'lastverschieb',
      'beschaffungsplanung',
      'flexibilitätsfenster',
      'stadtwerk',
      'vnb',
      'dso',
    ],
    preferredActions: [
      'grid-operations.marketPartners',
      'grid-operations.vnbLookup',
      'residual-load.netResidualLoad',
      'energy-market.co2Intensity',
      'energy-market.prices',
    ],
    fallbackActions: ['grid-operations.marketPartners', 'residual-load.netResidualLoad'],
    avoid: ['query.ask', 'query.askLearned'],
    requiredInputs: [
      {
        name: 'query',
        label: 'Netzbetreiber / Stadtwerk',
        type: 'string',
        required: true,
      },
      {
        name: 'forecastDays',
        label: 'Forecast-Tage',
        type: 'number',
        required: false,
      },
    ],
    risksAndNotes: [
      'Region für residual-load als Stadtname aus marketPartners-Kontakt ableiten.',
      'Bei fehlender SNB-ID mit BDEW-Code + VNB-Name weiterarbeiten.',
    ],
    routingPattern: 'vnb_resolution_plus_residual_load_co2_prices',
  },
  {
    capability: 'grid_operator_identity_resolution',
    domain: 'grid-operations',
    abstractionLevel: 'deterministic_lookup',
    intent: 'resolve_grid_operator_identity',
    keywords: ['netzbetreiber', 'vnb', 'dso', 'stadtwerke', 'bdew', 'snb'],
    preferredActions: ['grid-operations.marketPartners', 'grid-operations.vnbLookup'],
    fallbackActions: ['grid-operations.marketPartners'],
    avoid: [],
    requiredInputs: [
      {
        name: 'query',
        label: 'Netzbetreiber / Stadtwerk',
        type: 'string',
        required: true,
      },
    ],
    risksAndNotes: ['Bei mehrdeutigen Treffern Top-3 Kandidaten vergleichen.'],
    routingPattern: 'vnb_identity_resolution',
  },
  {
    capability: 'inhouse_timeseries_analysis',
    domain: 'inhouse',
    abstractionLevel: 'domain_workflow',
    intent: 'inhouse_timeseries_analysis',
    keywords: ['inhouse', 'csv', 'upload', 'datasource', 'messwerte', 'lastprofil'],
    preferredActions: ['datasource-cache.query', 'in-memory-join.meteringSpotCost'],
    fallbackActions: ['datasource-cache.query'],
    avoid: ['query.ask', 'query.askLearned'],
    requiredInputs: [
      {
        name: 'sourceId',
        label: 'Inhouse-Datasource',
        type: 'string',
        required: true,
      },
    ],
    risksAndNotes: [
      'Inhouse-Daten niemals über generische SQL-/Query-Tools abfragen.',
      'Aggregation/Join in-memory durchführen.',
    ],
    routingPattern: 'inhouse_datasource_cache_query',
  },
  {
    capability: 'mastr_asset_inventory',
    domain: 'assets',
    abstractionLevel: 'aggregated_service',
    intent: 'mastr_asset_inventory',
    keywords: [
      'mastr',
      'anlage',
      'anlagen',
      'pv',
      'wind',
      'speicher',
      'redispatch',
      'fernsteuerbarkeit',
    ],
    preferredActions: [
      'grid-operations.marketPartners',
      'grid-operations.vnbLookup',
      'assets.solar',
    ],
    fallbackActions: ['assets.all'],
    avoid: ['oep.query'],
    requiredInputs: [
      {
        name: 'query',
        label: 'Betreiber / Region',
        type: 'string',
        required: true,
      },
    ],
    risksAndNotes: [
      'Betriebsstatus und Netzbetreiberprüfstatus getrennt behandeln.',
      'OEP ist für reale Assetlisten sekundär gegenüber MaStR.',
    ],
    routingPattern: 'mastr_primary_asset_lookup',
  },
  {
    capability: 'oep_research_dataset_discovery',
    domain: 'oep',
    abstractionLevel: 'raw_data',
    intent: 'oep_research_dataset_discovery',
    keywords: ['oep', 'open energy platform', 'szenario', 'tyndp', 'nep'],
    preferredActions: ['oep.energyTables', 'oep.search', 'oep.query'],
    fallbackActions: ['oep.listSchemas', 'oep.listTables', 'oep.getTableMeta'],
    avoid: [],
    requiredInputs: [
      {
        name: 'q',
        label: 'Suchbegriff',
        type: 'string',
        required: false,
      },
    ],
    risksAndNotes: ['OEP-Daten als Szenario-/Forschungsquelle behandeln, nicht als Primärquelle für Assets.'],
    routingPattern: 'oep_discovery_chain',
  },
  {
    capability: 'vnb_kpi_benchmark_comparison',
    domain: 'finance-agent',
    abstractionLevel: 'aggregated_kpi_comparison',
    intent: 'vnb_kpi_benchmark_comparison',
    keywords: [
      'benchmark',
      'vergleich',
      'potenzialvergleich',
      'nachbar',
      'wettbewerber',
      'kpi',
      'anschlussdauer',
      'digitalisierungsindex',
      'umsetzungsquote',
      'ewk',
    ],
    preferredActions: [
      'grid-operations.marketPartners',
      'ewk-monitoring.benchmarkVnb',
      'grid-operations.vnbLookup',
      'assets.all',
    ],
    fallbackActions: ['grid-operations.marketPartners', 'ewk-monitoring.benchmarkVnb'],
    avoid: ['query.ask', 'query.askLearned'],
    requiredInputs: [
      {
        name: 'vnb1Name',
        label: 'First VNB Name',
        type: 'string',
        required: true,
      },
      {
        name: 'vnb2Name',
        label: 'Second VNB Name',
        type: 'string',
        required: true,
      },
      {
        name: 'comparisonDimensions',
        label: 'Comparison Dimensions',
        type: 'array',
        items: 'string',
        default: ['anschlussdauer', 'digitalisierungsindex', 'umsetzungsquote'],
        required: false,
      },
    ],
    risksAndNotes: [
      'Both VNBs must be resolvable via marketPartners.',
      'EWK data is annual BNetzA source; may not reflect current operational status.',
      'Hard evidence only; no hypothetical synthesis unless explicitly requested.',
    ],
    routingPattern: 'vnb_kpi_benchmark_multi_step',
  },
];

const GLOBAL_DO_NOT_USE = [
  {
    action: 'query.ask',
    reason: 'Nur nutzen, wenn kein deterministischer oder domänenspezifischer Pfad verfügbar ist.',
  },
  {
    action: 'query.askLearned',
    reason: 'Nur nutzen, wenn kein deterministischer oder domänenspezifischer Pfad verfügbar ist.',
  },
];

module.exports = {
  BROKER_SCHEMA_VERSION,
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
  GLOBAL_DO_NOT_USE,
};
