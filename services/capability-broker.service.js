const {
  BROKER_SCHEMA_VERSION,
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
  GLOBAL_DO_NOT_USE,
} = require('../src/capability-catalog');
const { buildServiceCatalogue } = require('../src/agent-planning-utils');

const MODES = new Set(['initial', 'next_step', 'repair', 'compare']);

function normalizeRequestSchemaVersion(schemaVersion, warnings) {
  if (!schemaVersion) {
    warnings.push(`Missing request schemaVersion mapped to ${BROKER_SCHEMA_VERSION}`);
    return BROKER_SCHEMA_VERSION;
  }
  if (schemaVersion !== BROKER_SCHEMA_VERSION) {
    warnings.push(`Unsupported request schemaVersion mapped to ${BROKER_SCHEMA_VERSION}`);
    return BROKER_SCHEMA_VERSION;
  }
  return schemaVersion;
}

function normalizeMode(mode, alreadyExecutedSteps, compareCandidates, warnings) {
  if (!mode || !MODES.has(mode)) {
    return 'initial';
  }

  if (mode === 'next_step' && alreadyExecutedSteps.length === 0) {
    warnings.push(
      'Requested mode next_step but alreadyExecutedSteps was empty; degraded to initial recommendation.'
    );
    return 'initial';
  }

  if (mode === 'repair' && alreadyExecutedSteps.length === 0) {
    warnings.push(
      'Requested mode repair without step/error context; degraded to initial recommendation.'
    );
    return 'initial';
  }

  if (mode === 'compare' && compareCandidates.length === 0) {
    warnings.push(
      'Requested mode compare but no candidates were provided; degraded to initial recommendation.'
    );
    return 'initial';
  }

  return mode;
}

function findCapabilityByName(capabilityName) {
  return (
    CURATED_CAPABILITIES.find((capability) => capability.capability === capabilityName) || null
  );
}

function findBestCapability(taskText, options = {}) {
  const haystack = taskText.toLowerCase();
  const resolvedParams = options?.resolvedParams || {};
  const resolvedCapabilities = Array.isArray(options?.resolvedCapabilities)
    ? options.resolvedCapabilities
    : [];
  const resolvedCapNames = new Set(
    resolvedCapabilities.map((rc) => (typeof rc === 'string' ? rc : rc?.capability)).filter(Boolean)
  );

  const cyaSignals = [
    'versorgungssicherheit',
    'belastbare aussagen',
    'journalist',
    'fazit',
    'unsicher',
    'kernaussagen',
  ];
  const benchmarkSignals = [
    'benchmark',
    'vergleich',
    'rangliste',
    'digitalisierungsindex',
    'umsetzungsquote',
    'kpi',
  ];
  const fnavSignals = [
    'netzfahrplan',
    'n-1',
    'requestedcapacitykw',
    'voltage level',
    'rechenzentrum',
    'kupferausbau',
    'firm capacity',
    'flexible capacity',
  ];
  const settlementA96Signals = [
    'a96',
    'abgleich',
    'reconcile',
    'reconciliation',
    'timeslice',
    'time slice',
    'anlageid',
    'delta',
    'abweichung',
  ];
  const loadProfileMonitorSignals = [
    'lastgang',
    'lastgangdaten',
    'bewegungsstrom',
    'load profile',
    'stream monitor',
    'streamstatus',
    'anomaly class',
    'datenqualitätslücke',
    'datenqualitaetsluecke',
    'forecast quality',
  ];
  const financierDueDiligenceSignals = [
    'due diligence',
    'risk assessment',
    'kreditausschuss',
    'credit committee',
    'bankability',
    'condition precedent',
    'financier',
    'finanzierer',
  ];
  const vdmiGovernanceSignals = [
    'arealnetzbetreiber',
    '§17 enwg',
    '17 enwg',
    'ohne formales netzanschlussbegehren',
    'netzanschlussbegehren',
    'projektträger nicht netzbetreiber',
    'darf keine netzanschlusszusage treffen',
    'zulässige aussagen',
    'rollengrenze',
  ];
  const vdmiDecisionCoreSignals = [
    'anschlusszusage',
    'kapazitätszusage',
    'kapazitaetszusage',
    'übergabepunkt',
    'uebergabepunkt',
    'netzbetreiberentscheidung',
    'belastbare zusage',
    'darf der netzbetreiber zusagen',
    'decision_blocked_pending_formal_request',
  ];
  const vdmiDecisionContextSignals = ['formales netzanschlussbegehren', '§17 enwg', '17 enwg'];
  const vdmiAssetValidationSignals = [
    'asset validation',
    'asset-validierung',
    'asset validierung',
    'asset-prüfung',
    'asset pruefung',
    'assetklasse',
    'evidence',
    'evidenz',
    'nachweis',
    'beleg',
    'forbidden assumption',
    'forbidden assumptions',
    'verbotene annahme',
    'verbotene annahmen',
    'risk factor',
    'risk factors',
    'risikofaktor',
    'risikofaktoren',
    'grid-connection-asset-validation',
  ];

  const hasVdmiBoundaryCombo =
    /(rollen|rolle|schnittstellen)/i.test(haystack) &&
    /(netzanschluss|enwg|arealnetz|gatekeeper)/i.test(haystack);

  const hasVdmiDecisionCombo =
    /(zusage|entscheidung|uebergabepunkt|übergabepunkt|kapazit[aä]t)/i.test(haystack) &&
    /(netzbetreiber|formales netzanschlussbegehren|§17|17 enwg|enwg)/i.test(haystack);

  const hasVdmiDecisionSignal =
    vdmiDecisionCoreSignals.some((signal) => haystack.includes(signal)) ||
    (vdmiDecisionContextSignals.some((signal) => haystack.includes(signal)) &&
      /(zusage|entscheidung|uebergabepunkt|übergabepunkt|kapazit[aä]t|anschluss)/i.test(haystack));

  if (hasVdmiDecisionSignal || hasVdmiDecisionCombo) {
    const vdmiDecisionCapability = findCapabilityByName('vdmi_grid_connection_decision_governance');
    if (vdmiDecisionCapability) {
      return {
        capability: vdmiDecisionCapability,
        score: 130,
        usedFallback: false,
      };
    }
  }

  const hasFinancierDueDiligenceCombo =
    /(due\s*diligence|risk\s*assessment|kreditausschuss|credit\s*committee|bankability)/i.test(
      haystack
    ) && /(finanz|financier|kredit|committee|condition\s*precedent|risiko)/i.test(haystack);

  if (
    financierDueDiligenceSignals.some((signal) => haystack.includes(signal)) ||
    hasFinancierDueDiligenceCombo
  ) {
    const financierDueDiligenceCapability = findCapabilityByName(
      'financier_due_diligence_assessment'
    );
    if (financierDueDiligenceCapability) {
      return {
        capability: financierDueDiligenceCapability,
        score: 125,
        usedFallback: false,
      };
    }
  }

  const hasVdmiAssetValidationCombo =
    /(asset|anlage|anlagen|assetklasse|transformator|trafo)/i.test(haystack) &&
    /(evidence|evidenz|nachweis|beleg|risk|risiko|forbidden|verbotene annahme)/i.test(haystack);

  if (
    vdmiAssetValidationSignals.some((signal) => haystack.includes(signal)) ||
    hasVdmiAssetValidationCombo
  ) {
    const vdmiAssetValidationCapability = findCapabilityByName('vdmi_asset_validation_governance');
    if (vdmiAssetValidationCapability) {
      return {
        capability: vdmiAssetValidationCapability,
        score: 120,
        usedFallback: false,
      };
    }
  }

  if (vdmiGovernanceSignals.some((signal) => haystack.includes(signal)) || hasVdmiBoundaryCombo) {
    const vdmiGovernanceCapability = findCapabilityByName('vdmi_role_boundary_governance');
    if (vdmiGovernanceCapability) {
      return {
        capability: vdmiGovernanceCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (cyaSignals.some((signal) => haystack.includes(signal))) {
    const cyaCapability = findCapabilityByName('cya_assessment_briefing');
    if (cyaCapability) {
      return {
        capability: cyaCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (benchmarkSignals.some((signal) => haystack.includes(signal))) {
    const benchmarkCapability = findCapabilityByName('vnb_kpi_benchmark_comparison');
    if (benchmarkCapability) {
      return {
        capability: benchmarkCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (fnavSignals.some((signal) => haystack.includes(signal))) {
    const fnavCapability = findCapabilityByName('netzfahrplan_fnav_assessment');
    if (fnavCapability) {
      return {
        capability: fnavCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (settlementA96Signals.some((signal) => haystack.includes(signal))) {
    const settlementA96Capability = findCapabilityByName('settlement_a96_reconciliation');
    if (settlementA96Capability) {
      return {
        capability: settlementA96Capability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  if (loadProfileMonitorSignals.some((signal) => haystack.includes(signal))) {
    const loadProfileMonitorCapability = findCapabilityByName('load_profile_stream_monitor');
    if (loadProfileMonitorCapability) {
      return {
        capability: loadProfileMonitorCapability,
        score: 100,
        usedFallback: false,
      };
    }
  }

  // Redispatch Special Case Gate — Speicher / Eigenverbrauch / Co-Location
  const redispatchSpecialCaseSignals = [
    'speicher redispatch',
    'eigenverbrauch redispatch',
    'co-location gate',
    'co location gate',
    'sonderfall gate',
    'special case gate',
    'steuerbarkeitsnachweis',
    'nichtverfügbarkeit redispatch',
    'nichtverfuegbarkeit redispatch',
    'abweichungstoleranz',
    'redispatch gate speicher',
    'bess redispatch gate',
    'eigenverbrauch gate',
  ];

  if (redispatchSpecialCaseSignals.some((signal) => haystack.includes(signal))) {
    const rdscgCapability = findCapabilityByName('redispatch_special_case_gate');
    if (rdscgCapability) {
      return { capability: rdscgCapability, score: 100, usedFallback: false };
    }
  }

  // Redispatch Settlement Sandbox — scenario creation / kWh→EUR variants
  const redispatchSettlementSandboxSignals = [
    'settlement sandbox',
    'abrechnungsszenario',
    'settlement szenario',
    'redispatch szenario',
    'ausfallarbeit kalkulation',
    'redispatch kalkulation',
    'kwh eur szenario',
    'szenario abrechnung',
    'curtailment szenario',
    'redispatch abrechnung variante',
  ];

  if (redispatchSettlementSandboxSignals.some((signal) => haystack.includes(signal))) {
    const rdssCapability = findCapabilityByName('redispatch_settlement_sandbox');
    if (rdssCapability) {
      return { capability: rdssCapability, score: 100, usedFallback: false };
    }
  }

  // Redispatch Data Governance — owner model / deadline classes / source-of-record
  const redispatchDataGovernanceSignals = [
    'redispatch governance',
    'führender datenpfad',
    'source of record',
    'fristenklasse',
    'deadline klasse',
    'stammdaten owner',
    'owner klasse',
    'governance policy redispatch',
    'datenpfad governance',
    'abrechnungsfrist redispatch',
    'prozesskalender',
  ];

  if (redispatchDataGovernanceSignals.some((signal) => haystack.includes(signal))) {
    const rdgCapability = findCapabilityByName('redispatch_data_governance');
    if (rdgCapability) {
      return { capability: rdgCapability, score: 100, usedFallback: false };
    }
  }

  // Redispatch Asset Register — projections / relationships / co-location
  const redispatchAssetRegisterSignals = [
    'redispatch asset register',
    'asset projektion',
    'technische ressource',
    'steuerbare ressource',
    'ressourcenzuordnung',
    'anlagenregister redispatch',
    'identifier konflikt',
    'asset beziehung',
    'steuergruppe redispatch',
  ];

  if (redispatchAssetRegisterSignals.some((signal) => haystack.includes(signal))) {
    const rdarCapability = findCapabilityByName('redispatch_asset_register');
    if (rdarCapability) {
      return { capability: rdarCapability, score: 100, usedFallback: false };
    }
  }

  // File Ingest Monitor — generic CSV/file monitoring and schema registry
  const fileIngestMonitorSignals = [
    'file ingest',
    'file monitor',
    'csv monitor',
    'datei monitoring',
    'dateiimport',
    'importpfad',
    'error folder',
    'fehlerordner',
    'stammdaten import',
    'datei governance',
    'ingest monitor',
    'stale file',
    'importdatei',
  ];

  if (fileIngestMonitorSignals.some((signal) => haystack.includes(signal))) {
    const fimCapability = findCapabilityByName('file_ingest_monitor');
    if (fimCapability) {
      return { capability: fimCapability, score: 95, usedFallback: false };
    }
  }

  // Pure VNB/Netzbetreiber identity/territory lookup — must not escalate to VDMI or fNAV.
  // Fires only when no higher-priority signal matched above.
  const pureVnbLookupSignals = [
    'vnb lookup',
    'vnb zuordnung',
    'netzbetreiber zuordnung',
    'welcher netzbetreiber',
    'zuständiger netzbetreiber',
    'zustaendiger netzbetreiber',
    'netzgebiet zuordnung',
    'netzgebiet klärung',
    'netzgebiet klaerung',
  ];

  // PLZ/Postleitzahl/Standort combined with VNB identity intent, excluding contexts
  // already claimed by higher-priority blocks (fNAV, benchmark).
  const hasPureVnbLookupCombo =
    /(plz|postleitzahl|\bstandort\b)/i.test(haystack) &&
    /\b(netzbetreiber|vnb|netzgebiet)\b/i.test(haystack) &&
    !fnavSignals.some((s) => haystack.includes(s)) &&
    !benchmarkSignals.some((s) => haystack.includes(s));

  if (pureVnbLookupSignals.some((signal) => haystack.includes(signal)) || hasPureVnbLookupCombo) {
    const vnbLookupCapability = findCapabilityByName('grid_operator_identity_resolution');
    if (vnbLookupCapability) {
      return {
        capability: vnbLookupCapability,
        score: 90,
        usedFallback: false,
      };
    }
  }

  let best = null;

  for (const capability of CURATED_CAPABILITIES) {
    let score = capability.keywords.reduce(
      (acc, keyword) => (haystack.includes(keyword.toLowerCase()) ? acc + 1 : acc),
      0
    );

    // Deprioritize already-resolved capabilities (-30 penalty)
    if (resolvedCapNames.has(capability.capability)) {
      score -= 30;
    }

    // Boost capabilities whose requiredInputs are satisfied by resolvedParams (+20 per match)
    const requiredInputs = Array.isArray(capability.requiredInputs)
      ? capability.requiredInputs
      : [];
    const resolvedKeys = Object.keys(resolvedParams);
    const satisfiedInputs = requiredInputs.filter((ri) => resolvedKeys.includes(ri));
    score += satisfiedInputs.length * 20;

    // Extra boost for capabilities that CONSUME resolved intermediate results
    // e.g. grid-connection.validate consumes bdewCode / gridOperatorName
    if (
      capability.capability.startsWith('grid_connection') &&
      (resolvedParams.bdew || resolvedParams.gridOperatorName || resolvedParams.gridOperatorId)
    ) {
      score += 40;
    }

    if (capability.capability === 'mastr_asset_inventory') {
      const hasExplicitMastrSignal = [
        'mastr',
        'redispatch',
        'fernsteuerbarkeit',
        'anlage',
        'anlagen',
        'pv',
        'wind',
        'speicher',
      ].some((signal) => haystack.includes(signal));

      const hasCompetingScenarioSignal = [...cyaSignals, ...benchmarkSignals, ...fnavSignals].some(
        (signal) => haystack.includes(signal)
      );

      if (!hasExplicitMastrSignal || hasCompetingScenarioSignal) {
        score = 0;
      }
    }

    if (!best || score > best.score) {
      best = { capability, score };
    }
  }

  if (!best || best.score === 0) {
    return {
      capability: INTERFACE_PLACEHOLDER_CAPABILITY,
      score: 0,
      usedFallback: true,
    };
  }

  return {
    capability: best.capability,
    score: best.score,
    usedFallback: false,
  };
}

function buildActionTemplate(action) {
  if (action === 'interface-placeholder.markGap') {
    return {
      role: null,
      reason: 'NEEDS_INTERFACE',
      blockingLevel: 'soft',
      replacementCriteria: {
        kind: 'process',
        capabilityHint: null,
        deadline: null,
      },
    };
  }
  if (action === 'interface-placeholder.requestEvidence') {
    return {
      placeholderId: '__previous_step.placeholder.placeholderId',
    };
  }
  if (action === 'interface-placeholder.listGaps') {
    return {
      includeResolved: false,
      limit: 25,
    };
  }
  if (action === 'znp.assessPortfolio') {
    return {
      projectId: null,
      kaufmaennischeFreigabeFnav: false,
    };
  }
  if (action === 'grid-operations.marketPartners') {
    return {
      query: null,
      limit: 3,
    };
  }
  if (action === 'grid-operations.vnbLookup') {
    return {
      bdew: '__step_1.data.results[0].bdewCode',
      city: '__step_1.data.results[0].contacts[0].city',
      query: null,
      vnbName: null,
    };
  }
  if (action === 'grid-operations.vnbLookupCodes') {
    return {
      bdewCode: '__step_2.data.bdew',
      vnbName: null,
      mastrId: null,
    };
  }
  if (action === 'residual-load.netResidualLoad') {
    return {
      gridOperatorMastrId: '__step_2.data.mastrId',
      region: '__step_1.data.results[0].contacts[0].city',
      forecastDays: null,
    };
  }
  if (action === 'energy-market.co2Intensity') {
    return {
      location: '__step_1.data.results[0].contacts[0].city',
      forecast: true,
      resolution: 'hourly',
    };
  }
  if (action === 'energy-market.prices') {
    return {
      market: 'day-ahead',
      region: 'Deutschland',
      startDate: null,
      endDate: null,
    };
  }
  if (action === 'grid-connection.fnavValidate') {
    return {
      gridOperatorId: null,
      gridOperatorBdew: null,
      gridOperatorName: null,
      voltageLevel: null,
      ownerContact: null,
      fnavProfile: null,
    };
  }
  if (action === 'grid-operations.netzfahrplanGenerate') {
    return {
      gridOperatorName: null,
      voltageLevel: null,
      requestedCapacityKW: null,
      firmCapacityKW: null,
      flexibleCapacityKW: null,
      curtailmentWindow: null,
      signalPriorityPolicy: null,
      controlEvidenceRef: null,
      contractStatus: null,
      legalStatus: null,
      ownerContact: null,
    };
  }
  if (action === 'finance-agent.fnavEconomics') {
    return {
      gridOperator: null,
      voltageLevel: null,
      ownerContact: null,
      annualFeeEur: null,
      fnavProfile: null,
    };
  }
  if (action === 'finance-agent.analyze') {
    return {
      query: null,
      mode: 'rule_plus_hyde',
      allowHypotheticals: false,
      includeTrace: false,
    };
  }
  if (action === 'settlement.reconcileA96') {
    return {
      settlementId: null,
      incomingRows: null,
      toleranceEur: 0.01,
    };
  }
  if (action === 'dashboard-api.loadProfileStreamMonitor') {
    return {
      meloId: null,
      obis: '1-0:1.8.0',
      from: null,
      to: null,
      gridOperatorId: null,
      profileId: 'H0',
      annualConsumptionKwh: null,
    };
  }
  if (action === 'vdmi.agentRole') {
    return {
      agentId: null,
      processType: 'grid-connection-governance',
      taskId: null,
    };
  }
  if (action === 'vdmi.context') {
    return {
      jobId: null,
    };
  }
  if (action === 'vdmi.dossier' || action === 'vdmi.negotiationTrace') {
    return {
      taskId: null,
    };
  }
  if (action === 'ewk-monitoring.benchmarkVnb') {
    return {
      vnbName: null,
      bnr: null,
    };
  }
  if (action === 'datasource-cache.query') {
    return {
      sourceId: null,
      query: null,
    };
  }
  if (action === 'in-memory-join.meteringSpotCost') {
    return {
      sourceId: null,
      date: null,
    };
  }
  return {};
}

function parseBenchmarkNames(taskText = '') {
  const text = String(taskText || '');
  const againstMatch = text.match(
    /\b(?:benchmark(?:e|t)?|vergleich(?:e|t)?)\s+(.+?)\s+gegen\s+(.+?)(?:[\.!?]|$)/i
  );
  if (againstMatch) {
    const first = String(againstMatch[1] || '').trim();
    const secondPart = String(againstMatch[2] || '').trim();
    const second = secondPart.split(/\s+(?:und|,|vs\.?|versus)\s+/i)[0]?.trim() || secondPart;
    return {
      vnb1Name: first || null,
      vnb2Name: second || null,
    };
  }
  return {
    vnb1Name: null,
    vnb2Name: null,
  };
}

function parseRequestedCapacityKW(taskText = '') {
  const text = String(taskText || '');
  const explicitMatch =
    text.match(/\brequested\s*capacity\s*kw\s*[:=]?\s*(\d+(?:[\.,]\d+)?)/i) ||
    text.match(/\brequestedcapacitykw\s*[:=]?\s*(\d+(?:[\.,]\d+)?)/i) ||
    text.match(/\brequested\s*capacity\s*[:=]?\s*(\d+(?:[\.,]\d+)?)/i);
  if (explicitMatch) {
    return Number(String(explicitMatch[1]).replace(',', '.'));
  }
  return null;
}

function buildFnavProfile(knownContext = {}, taskText = '') {
  if (knownContext?.fnavProfile && typeof knownContext.fnavProfile === 'object') {
    return {
      ...knownContext.fnavProfile,
      signalPriorityPolicy:
        knownContext.fnavProfile.signalPriorityPolicy ?? knownContext.signalPriorityPolicy,
      controlEvidenceRef:
        knownContext.fnavProfile.controlEvidenceRef ?? knownContext.controlEvidenceRef,
    };
  }

  const requestedCapacity =
    knownContext?.requestedCapacityKW ??
    knownContext?.requestedCapacity ??
    parseRequestedCapacityKW(taskText);

  if (requestedCapacity == null) {
    return null;
  }

  return {
    requestedCapacity,
    firmCapacity: knownContext?.firmCapacity ?? knownContext?.firmCapacityKW,
    flexibleCapacity: knownContext?.flexibleCapacity ?? knownContext?.flexibleCapacityKW,
    curtailmentWindow: knownContext?.curtailmentWindow,
    signalPriorityPolicy: knownContext?.signalPriorityPolicy,
    controlEvidenceRef: knownContext?.controlEvidenceRef,
    contractStatus: knownContext?.contractStatus,
    legalStatus: knownContext?.legalStatus,
  };
}

function isVdmiDecisionPrompt(taskText = '') {
  const haystack = String(taskText || '').toLowerCase();
  const hasDecisionCore =
    /(anschlusszusage|kapazitaetszusage|kapazitätszusage|uebergabepunkt|übergabepunkt|netzbetreiberentscheidung|belastbare\s+zusage)/i.test(
      haystack
    );
  const hasLegalFrame = /(formales\s+netzanschlussbegehren|§17\s*enwg|17\s*enwg|enwg)/i.test(
    haystack
  );
  return hasDecisionCore && hasLegalFrame;
}

function interpolateTemplateWithKnownContext(
  action,
  paramsTemplate = {},
  knownContext = {},
  taskText = ''
) {
  const hydrated = { ...(paramsTemplate || {}) };
  const parsedBenchmarkNames = parseBenchmarkNames(taskText);
  const parsedRequestedCapacityKW = parseRequestedCapacityKW(taskText);
  const queryCandidate =
    knownContext.query ||
    knownContext.vnb1Name ||
    parsedBenchmarkNames.vnb1Name ||
    knownContext.vnb1Name ||
    knownContext.gridOperatorName ||
    knownContext.operatorName ||
    String(taskText || '').trim() ||
    '*';

  if (action === 'grid-operations.marketPartners') {
    if (hydrated.query === null || hydrated.query === undefined || hydrated.query === '') {
      hydrated.query = queryCandidate;
    }
  }

  if (action === 'grid-operations.vnbLookup') {
    const knownBdew = knownContext.bdew || knownContext.bdewCode || null;
    const knownCity =
      knownContext.city || knownContext.municipality || knownContext.postalCode || null;
    // Override step-reference templates when direct context values are available.
    // Step-refs remain intact for flows where marketPartners runs first (step 1).
    if (knownBdew && typeof hydrated.bdew === 'string' && hydrated.bdew.startsWith('__step_')) {
      hydrated.bdew = knownBdew;
    }
    if (knownCity && typeof hydrated.city === 'string' && hydrated.city.startsWith('__step_')) {
      hydrated.city = knownCity;
    }
    if (hydrated.query === null) {
      hydrated.query = knownContext.query || null;
    }
    if (hydrated.vnbName === null) {
      hydrated.vnbName = knownContext.vnbName || knownContext.gridOperatorName || null;
    }
  }

  if (action === 'grid-operations.vnbLookupCodes') {
    const knownBdew = knownContext.bdewCode || knownContext.bdew || null;
    if (
      knownBdew &&
      typeof hydrated.bdewCode === 'string' &&
      hydrated.bdewCode.startsWith('__step_')
    ) {
      hydrated.bdewCode = knownBdew;
    }
    if (hydrated.vnbName === null) {
      hydrated.vnbName = knownContext.vnbName || knownContext.gridOperatorName || null;
    }
    if (hydrated.mastrId === null) {
      hydrated.mastrId = knownContext.mastrId || null;
    }
  }

  if (action === 'ewk-monitoring.benchmarkVnb') {
    if (hydrated.vnbName == null) {
      hydrated.vnbName =
        knownContext.vnbName || knownContext.vnb1Name || parsedBenchmarkNames.vnb1Name || null;
    }
    if (hydrated.bnr == null && knownContext.bnr) {
      hydrated.bnr = knownContext.bnr;
    }
  }

  if (action === 'grid-connection.fnavValidate') {
    if (hydrated.gridOperatorName == null && knownContext.gridOperatorName) {
      hydrated.gridOperatorName = knownContext.gridOperatorName;
    }
    if (hydrated.voltageLevel == null && knownContext.voltageLevel) {
      hydrated.voltageLevel = knownContext.voltageLevel;
    }
    if (hydrated.ownerContact == null && knownContext.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
    if (hydrated.fnavProfile == null) {
      hydrated.fnavProfile = buildFnavProfile(knownContext, taskText);
    }
  }

  if (action === 'grid-operations.netzfahrplanGenerate') {
    if (hydrated.gridOperatorName == null && knownContext.gridOperatorName) {
      hydrated.gridOperatorName = knownContext.gridOperatorName;
    }
    if (hydrated.voltageLevel == null && knownContext.voltageLevel) {
      hydrated.voltageLevel = knownContext.voltageLevel;
    }
    if (hydrated.requestedCapacityKW == null) {
      hydrated.requestedCapacityKW =
        knownContext.requestedCapacityKW ??
        knownContext.requestedCapacity ??
        parsedRequestedCapacityKW;
    }
    if (hydrated.firmCapacityKW == null) {
      hydrated.firmCapacityKW = knownContext.firmCapacityKW ?? knownContext.firmCapacity ?? null;
    }
    if (hydrated.flexibleCapacityKW == null) {
      hydrated.flexibleCapacityKW =
        knownContext.flexibleCapacityKW ?? knownContext.flexibleCapacity ?? null;
    }
    if (hydrated.curtailmentWindow == null && knownContext.curtailmentWindow != null) {
      hydrated.curtailmentWindow = knownContext.curtailmentWindow;
    }
    if (hydrated.signalPriorityPolicy == null && knownContext.signalPriorityPolicy) {
      hydrated.signalPriorityPolicy = knownContext.signalPriorityPolicy;
    }
    if (hydrated.controlEvidenceRef == null && knownContext.controlEvidenceRef) {
      hydrated.controlEvidenceRef = knownContext.controlEvidenceRef;
    }
    if (hydrated.contractStatus == null && knownContext.contractStatus) {
      hydrated.contractStatus = knownContext.contractStatus;
    }
    if (hydrated.legalStatus == null && knownContext.legalStatus) {
      hydrated.legalStatus = knownContext.legalStatus;
    }
    if (hydrated.ownerContact == null && knownContext.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
  }

  if (action === 'finance-agent.fnavEconomics') {
    if (hydrated.gridOperator == null) {
      hydrated.gridOperator = knownContext.gridOperator || knownContext.gridOperatorName || null;
    }
    if (hydrated.voltageLevel == null && knownContext.voltageLevel) {
      hydrated.voltageLevel = knownContext.voltageLevel;
    }
    if (hydrated.ownerContact == null && knownContext.ownerContact) {
      hydrated.ownerContact = knownContext.ownerContact;
    }
    if (hydrated.annualFeeEur == null && knownContext.annualFeeEur != null) {
      hydrated.annualFeeEur = knownContext.annualFeeEur;
    }
    if (hydrated.fnavProfile && typeof hydrated.fnavProfile === 'object') {
      hydrated.fnavProfile = {
        ...hydrated.fnavProfile,
        signalPriorityPolicy:
          hydrated.fnavProfile.signalPriorityPolicy ?? knownContext.signalPriorityPolicy,
        controlEvidenceRef:
          hydrated.fnavProfile.controlEvidenceRef ?? knownContext.controlEvidenceRef,
      };
    }
    if (hydrated.fnavProfile == null) {
      hydrated.fnavProfile = buildFnavProfile(knownContext, taskText);
    }
  }

  if (action === 'finance-agent.analyze') {
    if (hydrated.query == null || hydrated.query === '') {
      hydrated.query =
        knownContext.query ||
        knownContext.dueDiligenceQuestion ||
        String(taskText || '').trim() ||
        null;
    }
    if (hydrated.profileId == null && knownContext.profileId) {
      hydrated.profileId = knownContext.profileId;
    }
  }

  if (action === 'settlement.reconcileA96') {
    if (hydrated.settlementId == null && knownContext.settlementId) {
      hydrated.settlementId = knownContext.settlementId;
    }
    if (hydrated.incomingRows == null) {
      hydrated.incomingRows =
        knownContext.incomingRows || knownContext.a96Rows || knownContext.externalRows || null;
    }
    if (hydrated.toleranceEur == null && knownContext.toleranceEur != null) {
      hydrated.toleranceEur = knownContext.toleranceEur;
    }
  }

  if (action === 'dashboard-api.loadProfileStreamMonitor') {
    if (hydrated.meloId == null) {
      hydrated.meloId = knownContext.meloId || knownContext.messlokationId || null;
    }
    if (hydrated.obis == null && knownContext.obis) {
      hydrated.obis = knownContext.obis;
    }
    if (hydrated.from == null) {
      hydrated.from = knownContext.from || knownContext.dateFrom || knownContext.startDate || null;
    }
    if (hydrated.to == null) {
      hydrated.to = knownContext.to || knownContext.dateTo || knownContext.endDate || null;
    }
    if (hydrated.gridOperatorId == null && knownContext.gridOperatorId) {
      hydrated.gridOperatorId = knownContext.gridOperatorId;
    }
    if (hydrated.profileId == null && knownContext.profileId) {
      hydrated.profileId = knownContext.profileId;
    }
    if (hydrated.annualConsumptionKwh == null && knownContext.annualConsumptionKwh != null) {
      hydrated.annualConsumptionKwh = knownContext.annualConsumptionKwh;
    }
  }

  if (action === 'vdmi.agentRole') {
    if (hydrated.agentId == null && knownContext.agentId) {
      hydrated.agentId = knownContext.agentId;
    }
    if (hydrated.taskId == null && knownContext.taskId) {
      hydrated.taskId = knownContext.taskId;
    }
    if (
      knownContext.processType &&
      (hydrated.processType == null || hydrated.processType === 'grid-connection-governance')
    ) {
      hydrated.processType = knownContext.processType;
    }
    if (hydrated.taskId == null && isVdmiDecisionPrompt(taskText)) {
      hydrated.taskId = 'network-operator-decision';
    }
    if (hydrated.processType == null && isVdmiDecisionPrompt(taskText)) {
      hydrated.processType = 'grid-connection-governance';
    }
  }

  if (action === 'vdmi.dossier' || action === 'vdmi.negotiationTrace') {
    if (hydrated.taskId == null && knownContext.taskId) {
      hydrated.taskId = knownContext.taskId;
    }
    if (hydrated.taskId == null && isVdmiDecisionPrompt(taskText)) {
      hydrated.taskId = 'network-operator-decision';
    }
  }

  return hydrated;
}

function buildRequiredInputSet(capability, requiredActions) {
  const fields = [];
  const seen = new Set();

  for (const input of capability.requiredInputs || []) {
    if (seen.has(input.name)) continue;
    seen.add(input.name);
    fields.push({
      ...input,
      default: input.default !== undefined ? input.default : undefined,
    });
  }

  const hasPriceStep = requiredActions.includes('energy-market.prices');
  if (hasPriceStep) {
    if (!seen.has('startDate')) {
      fields.push({
        name: 'startDate',
        label: 'Startdatum',
        type: 'date',
        required: true,
      });
      seen.add('startDate');
    }
    if (!seen.has('endDate')) {
      fields.push({
        name: 'endDate',
        label: 'Enddatum',
        type: 'date',
        required: true,
      });
      seen.add('endDate');
    }
  }

  return fields;
}

function discoverSupplementalActions(services, taskText, blockedActions) {
  const catalogue = buildServiceCatalogue(services);
  const words = taskText
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);

  const picks = [];
  for (const item of catalogue) {
    if (blockedActions.has(item.actionName)) continue;
    const text =
      `${item.actionName} ${item.description || ''} ${item.descriptionDetail || ''}`.toLowerCase();
    const hit = words.some((w) => text.includes(w));
    if (hit) {
      picks.push(item.actionName);
    }
    if (picks.length >= 3) break;
  }

  return picks;
}

module.exports = {
  name: 'capability-broker',

  settings: {
    defaultTimeout: 30 * 1000,
  },

  actions: {
    recommend: {
      params: {
        schemaVersion: { type: 'string', optional: true },
        mode: {
          type: 'enum',
          values: ['initial', 'next_step', 'repair', 'compare'],
          optional: true,
          default: 'initial',
        },
        task: { type: 'string', min: 3 },
        agentRole: { type: 'string', optional: true },
        knownContext: { type: 'object', optional: true, default: {} },
        alreadyExecutedSteps: { type: 'array', optional: true, default: [] },
        currentQuestion: { type: 'string', optional: true },
        compareCandidates: { type: 'array', optional: true, default: [] },
        doNotUse: { type: 'array', optional: true, default: [] },
        resolvedParams: { type: 'object', optional: true, default: {} },
        resolvedCapabilities: { type: 'array', optional: true, default: [] },
      },
      async handler(ctx) {
        const warnings = [];
        normalizeRequestSchemaVersion(ctx.params.schemaVersion, warnings);

        const alreadyExecutedSteps = Array.isArray(ctx.params.alreadyExecutedSteps)
          ? ctx.params.alreadyExecutedSteps
          : [];
        const compareCandidates = Array.isArray(ctx.params.compareCandidates)
          ? ctx.params.compareCandidates
          : [];

        const effectiveMode = normalizeMode(
          ctx.params.mode,
          alreadyExecutedSteps,
          compareCandidates,
          warnings
        );

        const taskText = `${ctx.params.task || ''} ${ctx.params.currentQuestion || ''}`.trim();
        const resolvedParams =
          ctx.params.resolvedParams && typeof ctx.params.resolvedParams === 'object'
            ? ctx.params.resolvedParams
            : {};
        const resolvedCapabilities = Array.isArray(ctx.params.resolvedCapabilities)
          ? ctx.params.resolvedCapabilities
          : [];
        const selected = findBestCapability(taskText, {
          resolvedParams,
          resolvedCapabilities,
        });
        const capability = selected.capability;

        const blockedActions = new Set([
          ...GLOBAL_DO_NOT_USE.map((item) => item.action),
          ...capability.avoid,
          ...ctx.params.doNotUse,
        ]);

        // Deprioritize (block) capabilities that have already been resolved in this session
        const resolvedCapabilityActions = new Set();
        for (const rc of resolvedCapabilities) {
          if (typeof rc === 'string') {
            const cap = findCapabilityByName(rc);
            if (cap) {
              cap.preferredActions.forEach((a) => resolvedCapabilityActions.add(a));
              cap.fallbackActions.forEach((a) => resolvedCapabilityActions.add(a));
            }
          } else if (rc?.capability) {
            const cap = findCapabilityByName(rc.capability);
            if (cap) {
              cap.preferredActions.forEach((a) => resolvedCapabilityActions.add(a));
              cap.fallbackActions.forEach((a) => resolvedCapabilityActions.add(a));
            }
          }
        }
        resolvedCapabilityActions.forEach((a) => blockedActions.add(a));

        const alreadyExecuted = new Set(
          alreadyExecutedSteps
            .map((step) => (typeof step.action === 'string' ? step.action : ''))
            .filter(Boolean)
        );

        let preferredActionPath = [...capability.preferredActions].filter(
          (action) => !blockedActions.has(action)
        );
        if (effectiveMode === 'next_step' || effectiveMode === 'repair') {
          preferredActionPath = preferredActionPath.filter(
            (action) => !alreadyExecuted.has(action)
          );
        }
        if (preferredActionPath.length === 0) {
          preferredActionPath = [...capability.fallbackActions].filter(
            (action) => !blockedActions.has(action)
          );
        }

        const discovered = discoverSupplementalActions(
          ctx.broker.registry.getServiceList({ withActions: true }),
          taskText,
          blockedActions
        ).filter((action) => !preferredActionPath.includes(action));

        const knownContext =
          ctx.params.knownContext && typeof ctx.params.knownContext === 'object'
            ? ctx.params.knownContext
            : {};

        const recommendedPlan = preferredActionPath.map((action, index) => ({
          step: index + 1,
          action,
          purpose: `Execute capability path for ${capability.capability}`,
          params: interpolateTemplateWithKnownContext(
            action,
            buildActionTemplate(action),
            knownContext,
            taskText
          ),
          expectedOutput: 'Action-specific response payload',
          source: 'curated',
        }));

        if (recommendedPlan.length < 2 && discovered.length > 0) {
          recommendedPlan.push(
            ...discovered.slice(0, 2).map((action, idx) => ({
              step: recommendedPlan.length + idx + 1,
              action,
              purpose: 'Supplemental candidate from registry/openapi discovery',
              params: {},
              expectedOutput: 'Action-specific response payload',
              source: 'supplemental',
            }))
          );
        }

        const requiredInputs = buildRequiredInputSet(
          capability,
          recommendedPlan.map((step) => step.action)
        );

        const doNotUse = [
          ...GLOBAL_DO_NOT_USE,
          ...capability.avoid.map((action) => ({
            action,
            reason: `Avoided by curated capability ${capability.capability}`,
          })),
          ...ctx.params.doNotUse.map((action) => ({
            action,
            reason: 'Explicitly forbidden by caller doNotUse rule',
          })),
        ];

        const confidenceBase = selected.score > 0 ? 0.8 : 0.55;
        const confidence = Math.min(0.98, confidenceBase + Math.min(selected.score, 4) * 0.04);
        const scoringBreakdown = {
          rawScore: selected.score,
          confidenceBase,
          usedFallback: selected.usedFallback,
          resolvedCapabilityPenaltyApplied: Array.isArray(resolvedCapabilities)
            ? resolvedCapabilities.some(
                (item) =>
                  (typeof item === 'string' ? item : item?.capability) === capability.capability
              )
            : false,
          satisfiedInputCount: Array.isArray(capability.requiredInputs)
            ? capability.requiredInputs.filter((key) => Object.keys(resolvedParams).includes(key))
                .length
            : 0,
          preferredActionCount: preferredActionPath.length,
          discoveredActionCount: discovered.length,
          finalConfidence: Number(confidence.toFixed(2)),
        };

        if (selected.usedFallback) {
          warnings.push(
            'No curated deterministic capability matched; returning explicit interface-placeholder fallback recommendation.'
          );
        }

        return {
          schemaVersion: BROKER_SCHEMA_VERSION,
          summary: selected.usedFallback
            ? 'No deterministic capability matched. Recommend explicit gap marking via interface-placeholder.'
            : `Recommended ${capability.capability} via curated deterministic path with doNotUse enforcement.`,
          intent: capability.intent,
          capability: capability.capability,
          confidence: Number(confidence.toFixed(2)),
          scoringBreakdown,
          mode: ctx.params.mode,
          effectiveMode,
          recommendedCapabilities: [
            {
              capability: capability.capability,
              abstractionLevel: capability.abstractionLevel,
              reason: `Matched curated domain capability in ${capability.domain}.`,
              actions: preferredActionPath,
              hitlPolicy: capability.hitlPolicy || null,
            },
          ],
          recommendedPlan,
          requiredInputs,
          doNotUse,
          risksAndNotes: capability.risksAndNotes,
          nextBrokerQuestionSuggestion:
            'Nach Ausführung der nächsten Schritte erneut mit alreadyExecutedSteps aufrufen.',
          warnings,
        };
      },
    },

    catalog: {
      params: {},
      handler() {
        return {
          schemaVersion: BROKER_SCHEMA_VERSION,
          capabilities: CURATED_CAPABILITIES,
          globalDoNotUse: GLOBAL_DO_NOT_USE,
        };
      },
    },
  },
};
