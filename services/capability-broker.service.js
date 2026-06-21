const {
  BROKER_SCHEMA_VERSION,
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
  GLOBAL_DO_NOT_USE,
} = require('../src/capability-catalog');
const { buildServiceCatalogue } = require('../src/agent-planning-utils');

const {
  listCompiledDomainRoutes,
  findRuntimeCapability,
} = require('../src/domain-routes-registry');

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
    CURATED_CAPABILITIES.find((capability) => capability.capability === capabilityName) ||
    findRuntimeCapability(capabilityName) ||
    null
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
  const crossCommoditySupplySignals = [
    'gasspeicher',
    'agsi',
    'gie',
    'entso-e',
    'entsoe',
    'lagebild',
    'lage-/beschaffungsrunde',
    'beschaffungsrunde',
    'voralarm',
    'beobachtungsmodus',
    'fernwaerme',
    'fernwärme',
    'kwk',
    'waermelast',
    'wärmelast',
    'windprognose',
    'lastprognose',
    'day-ahead',
  ];

  const hasCrossCommoditySupplyCombo =
    /(gasspeicher|agsi|gie)/i.test(haystack) &&
    /(entso-e|entsoe|lastprognose|windprognose|day-ahead)/i.test(haystack) &&
    /(lagebild|versorgungssicherheit|beschaffung|voralarm|beobachtungsmodus|fernwaerme|fernwärme|kwk)/i.test(haystack);

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

  const hasSettlementA96SpecificSignal =
    /\ba96\b/i.test(haystack) &&
    /(settlement|reconciliation|reconcile|abgleich|bilanzierungsabweichung)/i.test(haystack);

  if (hasSettlementA96SpecificSignal) {
    const settlementA96Capability = findCapabilityByName('settlement_a96_reconciliation');
    if (settlementA96Capability) {
      return { capability: settlementA96Capability, score: 133, usedFallback: false };
    }
  }

  const hasRedispatchCallQualityGateSpecificSignal =
    /redispatch/i.test(haystack) &&
    /(abrufprozess|redispatch abruf|datenqualitaets-gate|datenqualität gate|datenqualitaet gate|nullwerte|fehlende prognose|kontrollnachweis|monitoring verantwortung|abrechnungsgate)/i.test(
      haystack
    );

  if (hasRedispatchCallQualityGateSpecificSignal) {
    const rdqgCapability = findCapabilityByName('redispatch_call_data_quality_gate');
    if (rdqgCapability) {
      return { capability: rdqgCapability, score: 134, usedFallback: false };
    }
  }

  const hasControllabilitySubmissionCockpitSpecificSignal =
    /(steuerbarkeitscheck|steuerbarkeitsnachweis|controllability)/i.test(haystack) &&
    /(abgabe.?cockpit|abgabeprojekt|submission cockpit|submission|quellenliste|datenabgleich|begruendungskatalog|begründungskatalog|assetgruppenstatus|naechster zyklus|nächster zyklus|abgabefrist)/i.test(haystack) &&
    !/(rundsteuertechnik|gruppensignal|legacy control|cls compliance|digital.?twin|billing|settlement|abrechnung|mako|steuerung ausfuehren|steuerung ausführen|device-control|smgw switch)/i.test(haystack);

  if (hasControllabilitySubmissionCockpitSpecificSignal) {
    const submissionCapability = findCapabilityByName('controllability_submission_cockpit');
    if (submissionCapability) {
      return { capability: submissionCapability, score: 138, usedFallback: false };
    }
  }

  const hasFlexStrategicDemandIntakeSpecificSignal =
    /(flexibilisierung|fahrplanmanagement|flex strategic|flex.?bedarf|bedarfsmeldung flex|strategische bedarfsanmeldung)/i.test(haystack) &&
    /(bedarf|intake|bedarfsmeldung|risk|risiko|nicht.?handeln|kaufmaennische|kaufmännische|commercial|ressource|resource|stop.?doing|owner|next decision gate|entscheidungsgate|blockierte folgeentscheidung)/i.test(haystack) &&
    !/(tarif|billing|settlement|abrechnung|device-control|smgw|cls|steuerung ausfuehren|steuerung ausführen|nova apply|hitl create)/i.test(haystack);

  if (hasFlexStrategicDemandIntakeSpecificSignal) {
    const flexIntakeCapability = findCapabilityByName('flex_strategic_demand_intake');
    if (flexIntakeCapability) {
      return { capability: flexIntakeCapability, score: 138, usedFallback: false };
    }
  }

  const hasGasInfrastructureRiskGovernanceSpecificSignal =
    /(gas.?infrastruktur|gas infrastructure|gasnetz|hochdruckleitung|netzkopplung|gas.?risiko|gas risk)/i.test(haystack) &&
    /(risikoregister|risk register|risikoaufnahme|formal risk|formale risikoaufnahme|nicht.?aufnahme|not aufgenommen|monitoring|massnahme|maßnahme|schwellenwert|threshold|eintrittswahrscheinlichkeit|probability|criticality|kritikalitaet|kritikalität|existing mitigation|absicherung|owner|decision window|entscheidungsfenster)/i.test(haystack) &&
    !/(stilllegung|decommissioning|roadmap|transformationsfahrplan|ausfuehrungsuebergabe|ausführungsübergabe|kapazitaetsbestellung|kapazitätsbestellung|capacity order|billing|settlement|abrechnung|tarif|payment|device-control|smgw|cls|execute|ausfuehren|ausführen|hitl create|vdmi create)/i.test(haystack);

  if (hasGasInfrastructureRiskGovernanceSpecificSignal) {
    const gasRiskCapability = findCapabilityByName('gas_infrastructure_risk_governance');
    if (gasRiskCapability) {
      return { capability: gasRiskCapability, score: 138, usedFallback: false };
    }
  }

  const hasCrisisDecisionRoutineSpecificSignal =
    /(krisenmodus|krisenroutine|ad.?hoc.?krise|crisis mode|crisis decision routine|entscheidungsroutine)/i.test(haystack) &&
    /(managemententscheidung|servicegruppenwirkung|bevoelkerungsgruppenwirkung|bevölkerungsgruppenwirkung|finanzwirkung|wissensstand|trainingsbedarf|owner|next decision gate|entscheidungsgate|blockierte folgeentscheidung)/i.test(haystack) &&
    !/(steuerbarkeitscheck|redispatch|mako|marktkommunikation|settlement|billing|abrechnung|device-control|smgw|cls)/i.test(haystack);

  if (hasCrisisDecisionRoutineSpecificSignal) {
    const crisisCapability = findCapabilityByName('crisis_decision_routine');
    if (crisisCapability) {
      return { capability: crisisCapability, score: 137, usedFallback: false };
    }
  }

  const hasInvestmentDataReviewQueueSpecificSignal =
    /(investdaten|investment data|datenpaket|assetmanagement|asset-abstimmung|capex priorisierung|capex-priorisierung|pruefqueue|prüfqueue)/i.test(haystack) &&
    /(pruefqueue|prüfqueue|review queue|datenqualitaet|datenqualität|quality status|gremienfenster|committee window|blockierte folgeentscheidung|blocked decision|bottleneck|engpass|owner)/i.test(haystack) &&
    !/(zwei spuren|two.?track|budgetabgabe|investitionsabgabe|abgabesicherheit|iso 55001|freigabelogik|vorstandsformat|wallet|key material|schluessel|schlüssel|crypto|billing|settlement|abrechnung|tarif|payment|device-control|smgw switch|hitl create|budget release)/i.test(haystack);

  if (hasInvestmentDataReviewQueueSpecificSignal) {
    const investmentDataQueueCapability = findCapabilityByName('investment_data_review_queue');
    if (investmentDataQueueCapability) {
      return { capability: investmentDataQueueCapability, score: 138, usedFallback: false };
    }
  }

  const hasInvestmentCommitteeSteeringCardsSpecificSignal =
    /(investmittel|investitionskarte|investment item|capex|committee|gremien)/i.test(haystack) &&
    /(gremiensteuerung|gremienkarte|steering card|committee card|committee window|gremienfenster|pruefstatus|prüfstatus|review status|evidenzstatus|blocked follow.?up|blockierte folgeaktion)/i.test(haystack) &&
    !/(portable energy wallet|wallet|key material|schluessel|schlüssel|crypto|settlement|billing|abrechnung|tarif|payment|device-control|smgw switch)/i.test(haystack);

  if (hasInvestmentCommitteeSteeringCardsSpecificSignal) {
    const investmentCardsCapability = findCapabilityByName('investment_committee_steering_cards');
    if (investmentCardsCapability) {
      return { capability: investmentCardsCapability, score: 137, usedFallback: false };
    }
  }

  const hasLegacyControlTechnologyTransitionSpecificSignal =
    /(rundsteuertechnik|rundsteuerempfaenger|rundsteuerempfänger|gruppensignal|legacy control|bestandsanlage|steuerbox uebergang|steuerbox übergang|cls uebergang|cls übergang)/i.test(haystack) &&
    /(rueckmeldefaehigkeit|rückmeldefähigkeit|testbarkeit|nichtdurchfuehrungsbegruendung|nichtdurchführungsbegründung|steuerbarkeitsnachweis|migration|roadmap|uebergang|übergang)/i.test(haystack);

  if (hasLegacyControlTechnologyTransitionSpecificSignal) {
    const legacyControlCapability = findCapabilityByName('legacy_control_technology_transition');
    if (legacyControlCapability) {
      return { capability: legacyControlCapability, score: 137, usedFallback: false };
    }
  }

  const hasControllabilityAssetHandoverSpecificSignal =
    /(steuerbarkeitscheck|steuerbarkeit|steuerbare anlagen)/i.test(haystack) &&
    /(linienuebergabe|linienübergabe|asset handover|meldezyklus|nichtdurchfuehrungsbegruendung|nichtdurchführungsbegründung|rueckmeldefaehigkeit|rückmeldefähigkeit|fernsteuerbarkeit|asset evidenzkatalog)/i.test(haystack);

  if (hasControllabilityAssetHandoverSpecificSignal) {
    const assetHandoverCapability = findCapabilityByName('controllability_asset_handover');
    if (assetHandoverCapability) {
      return { capability: assetHandoverCapability, score: 136, usedFallback: false };
    }
  }

  const hasE2eControllabilityGovernanceSpecificSignal =
    /(steuerbarkeitscheck|steuerbarkeit)/i.test(haystack) &&
    /(evidenzmatrix|rollenmatrix|abgabeprozess|messkonzept|handover|governance)/i.test(haystack);

  if (hasE2eControllabilityGovernanceSpecificSignal) {
    const e2eGovernanceCapability = findCapabilityByName('e2e_controllability_check_governance');
    if (e2eGovernanceCapability) {
      return { capability: e2eGovernanceCapability, score: 135, usedFallback: false };
    }
  }

  const hasRedispatchSettlementSandboxSpecificSignal =
    /redispatch/i.test(haystack) &&
    /(settlement sandbox|expost.?szenario|abrechnung|vergütungsrisiko|verguetungsrisiko)/i.test(
      haystack
    );

  if (hasRedispatchSettlementSandboxSpecificSignal) {
    const rdssCapability = findCapabilityByName('redispatch_settlement_sandbox');
    if (rdssCapability) {
      return { capability: rdssCapability, score: 133, usedFallback: false };
    }
  }

  const hasVdmiRoleBoundarySpecificSignal =
    /vdmi/i.test(haystack) &&
    /(role boundary|rollenverantwortung|akteursrollen|verantwortungsgrenzen|agentenrolle|rollengrenze)/i.test(
      haystack
    ) &&
    !/(portfolio gate|portfolio gatekeeping|investitionsfreigabe)/i.test(haystack);

  if (hasVdmiRoleBoundarySpecificSignal) {
    const vdmiGovernanceCapability = findCapabilityByName('vdmi_role_boundary_governance');
    if (vdmiGovernanceCapability) {
      return { capability: vdmiGovernanceCapability, score: 133, usedFallback: false };
    }
  }

  // ── Market communication evidence chain
  // Generic "Evidenz/Nachweis" terms otherwise match VDMI asset validation.
  const marketCommunicationEvidenceSignals = [
    'marktkommunikations evidenzkette',
    'marktkommunikation evidenz',
    'mako evidenzkette',
    'malo melo',
    'utilmd stammdatenweg',
    'verbrauchsdatenabruf',
    'edm datenqualitaet',
    'edm datenqualität',
    'portalhinweis',
    'portal screenshot',
    'imsys abrechnungsreife',
  ];
  const hasMarketCommunicationEvidenceCombo =
    /(marktkommunikation|mako|utilmd|malo|melo|imsys|verbrauchsdatenabruf)/i.test(haystack) &&
    /(evidenz|evidence|nachweis|stammdatenweg|portal|abrechnungsreife|datenqualit[aä]t)/i.test(
      haystack
    );

  if (
    marketCommunicationEvidenceSignals.some((signal) => haystack.includes(signal)) ||
    hasMarketCommunicationEvidenceCombo
  ) {
    const makoCapability = findCapabilityByName('market_communication_evidence_chain');
    if (makoCapability) {
      return { capability: makoCapability, score: 134, usedFallback: false };
    }
  }

  // ── Redispatch/RCS Special Case Governance — must precede VDMI decision check
  // 'vergütungszusage' + 'netzbetreiber' combo would otherwise trigger VDMI grid-connection
  // decision governance (score 130). RCS/Expost signals narrow the domain unambiguously.
  const redispatchRcsSpecificSignals = [
    'expost-nachweis', 'expost nachweis', 'expost-evidence', 'expost evidence',
    'rcs-sonderfall', 'rcs sonderfall', 'rcs-regelkatalog', 'rcs regelkatalog',
    'redispatch-koordination', 'redispatch-assetregister', 'redispatch assetregister',
    'settlement-risiko', 'settlement risiko',
  ];
  const hasRedispatchRcsSignal =
    redispatchRcsSpecificSignals.some((s) => haystack.includes(s)) ||
    (/\bexpost\b/i.test(haystack) && /redispatch/i.test(haystack)) ||
    (/(vergütungszusage|verguetungszusage)/i.test(haystack) && /redispatch/i.test(haystack));

  if (hasRedispatchRcsSignal) {
    const rdrcsCapability = findCapabilityByName('redispatch_rcs_special_case_governance');
    if (rdrcsCapability) {
      return { capability: rdrcsCapability, score: 132, usedFallback: false };
    }
  }

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

  const hasSmartMeterPurposeLockSignal =
    /(smart.?meter|imsys|z[aä]hlpark)/i.test(haystack) &&
    /(off.?balancing|purpose.?lock|zweckbindung|budgetverwaesserung|budgetverw[aä]sserung|freiwerdende liquidit[aä]t|leitwarte invest|steuerbarkeit finanzieren)/i.test(
      haystack
    );

  if (hasSmartMeterPurposeLockSignal) {
    const purposeLockCapability = findCapabilityByName(
      'smart_meter_off_balancing_purpose_lock'
    );
    if (purposeLockCapability) {
      return {
        capability: purposeLockCapability,
        score: 128,
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
    hasCrossCommoditySupplyCombo ||
    crossCommoditySupplySignals.filter((signal) => haystack.includes(signal)).length >= 3
  ) {
    const crossCommodityCapability = findCapabilityByName(
      'cross_commodity_supply_security_lagebild'
    );
    if (crossCommodityCapability) {
      return {
        capability: crossCommodityCapability,
        score: 135,
        usedFallback: false,
      };
    }
  }

  // ── EDM / Customer Service / Billing — Move-Out evidence dossier
  // 'evidence' in the prompt matches vdmiAssetValidationSignals — intercept before VDMI.
  const edmMoveoutSpecificSignals = [
    'schlusszählerstand', 'schlusszaehlerstand', 'abrechnungsfreigabe', 'edm-plausibilisierung',
    'plausibilisierter schlusszählerstand', 'plausibilisierter schlusszaehlerstand',
  ];
  const hasEdmMoveoutCombo =
    /(auszug|einzug)/i.test(haystack) &&
    /(edm|abrechnung|kundenservice|plausibilisierung)/i.test(haystack);

  if (edmMoveoutSpecificSignals.some((s) => haystack.includes(s)) || hasEdmMoveoutCombo) {
    const edmCap = findCapabilityByName('edm_customer_moveout_billing_evidence');
    if (edmCap) {
      return { capability: edmCap, score: 122, usedFallback: false };
    }
  }

  // ── Energy Sharing / Prosumer Advisory
  // 'evidence' in the prompt matches vdmiAssetValidationSignals — intercept before VDMI.
  const energySharingSpecificSignals = [
    'prosumer', 'energy sharing', 'mieterstrom', 'nachbarschaftsverkauf',
    'nap-wallet', '§42c enwg', '42c enwg',
    'gemeinschaftliche gebäudeversorgung', 'gemeinschaftliche gebaeudeversorgung',
  ];

  if (energySharingSpecificSignals.some((s) => haystack.includes(s))) {
    const energySharingCap = findCapabilityByName('energy_sharing_prosumer_advisory');
    if (energySharingCap) {
      return { capability: energySharingCap, score: 122, usedFallback: false };
    }
  }

  // ── Datasource Registry / Classification Governance
  // 'evidence' in the prompt matches vdmiAssetValidationSignals — intercept before VDMI.
  const datasourceRegistrySpecificSignals = [
    'datasource registry', 'datasource-registry', 'datenquellenbestand',
    'datasource-classifier', 'datasource-watcher', 'datasource-discovery',
  ];
  const hasDatasourceRegistryCombo =
    /datasource/i.test(haystack) &&
    /(registry|klassifikation|cache.?status|watcher|classifier|discovery)/i.test(haystack);

  if (
    datasourceRegistrySpecificSignals.some((s) => haystack.includes(s)) ||
    hasDatasourceRegistryCombo
  ) {
    const datasourceCap = findCapabilityByName('datasource_registry_classification_governance');
    if (datasourceCap) {
      return { capability: datasourceCap, score: 122, usedFallback: false };
    }
  }

  // ── HITL / Notification / Persona Inbox Evidence Request
  // 'asset' + 'evidence' combo matches vdmiAssetValidationCombo — intercept before VDMI.
  const hitlSpecificSignals = [
    'human-in-the-loop', 'human in the loop', 'ursprungssession',
    'persona-inbox', 'persona inbox', 'webhook-ausloesung', 'webhook-auslosung',
    'hitl-nachforderung', 'hitl nachforderung', 'hitl-nachforderungen',
  ];

  if (hitlSpecificSignals.some((s) => haystack.includes(s))) {
    const hitlCap = findCapabilityByName('hitl_role_based_evidence_request');
    if (hitlCap) {
      return { capability: hitlCap, score: 122, usedFallback: false };
    }
  }

  // ── DSO Residual Load / Flexibility Window
  // 'evidence' in the prompt matches vdmiAssetValidationSignals — intercept before VDMI.
  // Also catches prompts using the hyphenated 'residual-load' form not covered by catalog keywords.
  const residualLoadDsoSpecificSignals = [
    'residual-load',           // hyphenated form (Turn 1, 2, 3)
    'residuallast',            // compound form (Turn 2, 4)
    'residual load',           // space form, English (Turn 3)
    'netresidualload',         // service action name form
    'flexibility window',      // English equivalent (Turn 3)
    'flexibilitaetsmanagement', // very specific (Turn 4)
  ];
  const hasResidualLoadDsoCombo =
    // any residual-load concept + DSO/VNB/grid-ops context
    (/residual.?load|residuallast/i.test(haystack) &&
      /(dso|vnb|netzbetrieb|stadtwerk|netzbetreiber|lastverschieb|flexibilit)/i.test(haystack)) ||
    // flexibility window concept + operational context (excludes energy-sharing / prosumer)
    (/(flexibilitaetsfenster|flexibilitätsfenster|flexibility.?window)/i.test(haystack) &&
      /(dso|vnb|netzbetrieb|stadtwerk|lastverschieb|residual|forecast|co2)/i.test(haystack));

  if (
    residualLoadDsoSpecificSignals.some((s) => haystack.includes(s)) ||
    hasResidualLoadDsoCombo
  ) {
    const residualLoadCap = findCapabilityByName('residual_load_forecast_for_dso');
    if (residualLoadCap) {
      return { capability: residualLoadCap, score: 122, usedFallback: false };
    }
  }

  // ── Redispatch Readiness Gate
  // 'Produktivreife' can otherwise be captured by broad VDMI asset-validation signals.
  const redispatchReadinessGateSignals = [
    'redispatch readiness',
    'redispatch produktivreife',
    'redispatch betriebsbereit',
    'zugangsmatrix redispatch',
    'testabruf redispatch',
    'produktivnachweis redispatch',
    'stammdatentemplate redispatch',
    'abnahmefrist redispatch',
    'redispatch readiness gate',
    'redispatch onboarding gate',
    'redispatch operative bereitschaft',
  ];

  if (redispatchReadinessGateSignals.some((signal) => haystack.includes(signal))) {
    const rrgCapability = findCapabilityByName('redispatch_readiness_gate');
    if (rrgCapability) {
      return { capability: rrgCapability, score: 122, usedFallback: false };
    }
  }

  // ── Re4DE Variable Grid-Fee Layer-3 Service
  const re4deVariableGridFeeSignals = [
    're4de',
    'variable grid fee',
    'variable grid-fee',
    'variables netzentgelt',
    'variable netzentgelte',
    'tariff sheet',
    'tarifblatt',
    'grid fee calculation',
    'netzentgelt berechnung',
    'datenraum',
    'data product',
    'taf-7 interval',
    'section14a module 3',
    '§14a module 3',
  ];
  const hasRe4deVariableGridFeeCombo =
    /(netzentgelt|grid.?fee|tariff|tarif|datenraum|data.?product|re4de)/i.test(haystack) &&
    /(variable|calculation|berechnung|layer.?3|taf.?7|14a|§14a|evidence|nachweis)/i.test(haystack);

  if (
    re4deVariableGridFeeSignals.some((signal) => haystack.includes(signal)) ||
    hasRe4deVariableGridFeeCombo
  ) {
    const re4deCapability = findCapabilityByName('re4de_variable_grid_fee_layer3');
    if (re4deCapability) {
      return { capability: re4deCapability, score: 122, usedFallback: false };
    }
  }

  // ── Battery Redispatch Special Gate
  // Storage prompts share words with the older generic Redispatch special-case
  // gate. These signals narrow the case to MaLo/MeLo, direction and clearing
  // evidence for batteries.
  const batteryRedispatchSpecialGateSignals = [
    'batteriespeicher redispatch',
    'speicher sondergate',
    'redispatch speicher sondergate',
    'malo speicher',
    'melo speicher',
    'positive redispatch',
    'negative redispatch',
    'lastaufnahme',
    'einspeisung',
    'testabruf',
    'steuerbarkeitsrichtung',
    'clearing speicher',
    'abrechnung speicher',
    'battery redispatch special gate',
    'bess redispatch sondergate',
  ];
  const hasBatteryRedispatchSpecialGateCombo =
    /(batteriespeicher|bess|speicher)/i.test(haystack) &&
    /redispatch/i.test(haystack) &&
    /(malo|melo|lastaufnahme|einspeisung|testabruf|steuerbarkeitsrichtung|clearing|abrechnung|sondergate)/i.test(
      haystack
    );

  if (
    batteryRedispatchSpecialGateSignals.some((signal) => haystack.includes(signal)) ||
    hasBatteryRedispatchSpecialGateCombo
  ) {
    const brsCapability = findCapabilityByName('battery_redispatch_special_gate');
    if (brsCapability) {
      return { capability: brsCapability, score: 122, usedFallback: false };
    }
  }

  // ── Gas Decommissioning Roadmap Status
  // Gas roadmap prompts share investment and asset-risk vocabulary with the
  // off-balance gate. Require explicit gas decommissioning / roadmap signals.
  const gasDecommissioningRoadmapSignals = [
    'gasnetz stilllegung',
    'gasnetz-stilllegung',
    'gas decommissioning',
    'gas network decommissioning',
    'stilllegungsroadmap',
    'decommissioning roadmap',
    'transformationsfahrplan',
    'ausfuehrungsuebergabe',
    'ausführungsübergabe',
  ];
  const hasGasDecommissioningRoadmapCombo =
    /(gasnetz|gas network|gas)/i.test(haystack) &&
    /(stilllegung|decommissioning|transformationsfahrplan|roadmap)/i.test(haystack) &&
    /(asset.?risiko|investment.?impact|investfolge|gremiengate|committee.?gate|abhaengigkeit|abhängigkeit|ausfuehrungsuebergabe|ausführungsübergabe)/i.test(
      haystack
    );

  if (
    gasDecommissioningRoadmapSignals.some((signal) => haystack.includes(signal)) ||
    hasGasDecommissioningRoadmapCombo
  ) {
    const gdrCapability = findCapabilityByName('gas_decommissioning_roadmap_status');
    if (gdrCapability) {
      return { capability: gdrCapability, score: 122, usedFallback: false };
    }
  }

  // ── Jour-Fixe Decision Closure Tracker
  // JF closure prompts share generic owner/KPI/evidence words with older VDMI
  // routes. Require explicit Jour-fixe or decision-closure vocabulary.
  const jourFixeDecisionClosureSignals = [
    'jour_fixe_decision_closure_tracker',
    'jour fixe',
    'jour-fixe',
    'decision closure',
    'decision-closure',
    'abschlussstatus',
    'offene entscheidung',
    'entscheidung offen',
    'abschlussnachweis',
  ];
  const hasJourFixeDecisionClosureCombo =
    /(jour.?fixe|\bjf\b|decision.?closure|abschlussstatus|offene entscheidung|entscheidung offen)/i.test(
      haystack
    ) &&
    /(owner|kpi|kennzahl|entscheidungskriterium|decision.?criterion|naechstes gate|nächstes gate|next gate|carried.?over|eskalation|abschlussnachweis)/i.test(
      haystack
    );

  if (
    jourFixeDecisionClosureSignals.some((signal) => haystack.includes(signal)) ||
    hasJourFixeDecisionClosureCombo
  ) {
    const jfdCapability = findCapabilityByName('jour_fixe_decision_closure_tracker');
    if (jfdCapability) {
      return { capability: jfdCapability, score: 122, usedFallback: false };
    }
  }

  // ── Investment Maturity Off-Balance Gate
  // These prompts share evidence/risk vocabulary with VDMI asset validation.
  // Require explicit investment/off-balance finance signals before routing here.
  const investmentMaturityOffBalanceSignals = [
    'investitionsreifegrad',
    'off-balance',
    'off balance',
    'externe finanzierung',
    'extern finanzierung',
    'finanzierungszusatzkosten',
    'zusatzkosten finanzierung',
    'regulatory return',
    'regulatorischer return',
    'asset-risiko',
    'asset risiko',
    'iso-risiko',
    'iso risiko',
    'prozessqualitaet',
    'prozessqualität',
    'netzspielraum',
    'entscheidungsforum',
    'investment maturity',
    'off-balance gate',
  ];
  const hasInvestmentMaturityOffBalanceCombo =
    /(investition|investment|off.?balance|externe.?finanzierung|finanzierungszusatzkosten)/i.test(
      haystack
    ) &&
    /(prozessqualit[aä]t|regulatory.?return|regulatorischer.?return|asset.?risiko|iso.?risiko|netzspielraum|entscheidungsforum|gate)/i.test(
      haystack
    );

  if (
    investmentMaturityOffBalanceSignals.some((signal) => haystack.includes(signal)) ||
    hasInvestmentMaturityOffBalanceCombo
  ) {
    const imobCapability = findCapabilityByName('investment_maturity_off_balance_gate');
    if (imobCapability) {
      return { capability: imobCapability, score: 122, usedFallback: false };
    }
  }

  // ── Gas Capacity Order Revision Gate
  // Gas-order prompts share NKP and investment vocabulary with broader finance
  // governance routes. Require explicit gas-capacity/order revision signals.
  const gasCapacityOrderRevisionSignals = [
    'gaskapazitaetsbestellung',
    'gaskapazitätsbestellung',
    'gas capacity order',
    'jahresbestellung',
    'kapazitaetsbestellung',
    'kapazitätsbestellung',
    'gaskapazitaet',
    'gaskapazität',
    'kaltjahr',
    'milder winter',
    'industrie-rebound',
    'rlm rebound',
    'sicherheitsaufschlag',
    'druckflexibilitaet',
    'druckflexibilität',
    'wartungsfenster',
    'bestellbeschluss',
  ];
  const hasGasCapacityOrderRevisionCombo =
    /(gas|gaskapazit[aä]t|kapazit[aä]tsbestellung|jahresbestellung)/i.test(haystack) &&
    /(kaltjahr|milder.?winter|rlm|rebound|nkp|netzkopplungspunkt|sicherheitsaufschlag|druckflexibilit[aä]t|wartungsfenster|bestellbeschluss|revision.?gate)/i.test(
      haystack
    );

  if (
    gasCapacityOrderRevisionSignals.some((signal) => haystack.includes(signal)) ||
    hasGasCapacityOrderRevisionCombo
  ) {
    const gcorgCapability = findCapabilityByName('gas_capacity_order_revision_gate');
    if (gcorgCapability) {
      return { capability: gcorgCapability, score: 122, usedFallback: false };
    }
  }

  // ── Evidence Grounding Confidence Audit
  const evidenceGroundingConfidenceAuditSignals = [
    'evidence grounding confidence audit',
    'confidence audit',
    'evidence confidence',
    'routing confidence',
    'quellenklasse',
    'quellenklassen',
    'scope filter',
    'tool ausfall',
    'toolausfall',
    'netzbetreiber bestaetigung',
    'netzbetreiber bestätigung',
    'confidence begruendung',
    'confidence begründung',
    'scheinsicherheit',
    'unsicherheitsstatus',
  ];
  const hasEvidenceGroundingConfidenceAuditCombo =
    /(confidence|grounding|quellenklasse|scope.?filter|tool.?ausfall|scheinsicherheit|unsicherheitsstatus)/i.test(
      haystack
    ) &&
    /(audit|evidence|evidenz|quelle|netzbetreiber.?best[aä]tigung|begruendung|begründung)/i.test(
      haystack
    );

  if (
    evidenceGroundingConfidenceAuditSignals.some((signal) => haystack.includes(signal)) ||
    hasEvidenceGroundingConfidenceAuditCombo
  ) {
    const egcaCapability = findCapabilityByName('evidence_grounding_confidence_audit');
    if (egcaCapability) {
      return { capability: egcaCapability, score: 122, usedFallback: false };
    }
  }

  // ── Declarative domain routes registry (score 121, before VDMI asset-validation at 120)
  // Routes are managed via src/domain-routes-registry.js (static JSON + runtime overlay).
  // Each entry fires when any trigger phrase matches OR any combo (all-AND regex group) matches.
  // negativeTriggers (optional) prevent the route from firing when present.
  for (const route of listCompiledDomainRoutes()) {
    const negativeMatch = (route.negativeTriggers || []).some((t) => haystack.includes(t.toLowerCase()));
    if (negativeMatch) continue;
    const triggerMatch = (route.triggers || []).some((t) => haystack.includes(t));
    const comboMatch = route._compiledCombos.some((combo) =>
      combo.all.every((rx) => rx.test(haystack))
    );
    if (triggerMatch || comboMatch) {
      const domainCap = findCapabilityByName(route.capability);
      if (domainCap) {
        return { capability: domainCap, score: route.score || 121, usedFallback: false };
      }
    }
  }

  const hasClsDigitalTwinComplianceCombo =
    /(cls|digital.?twin|digitaler zwilling|digital.?zwilling)/i.test(haystack) &&
    /(compliance|beschaffung|procurement|avv|nda|betriebsvereinbarung|dsfa|rollenrechte|rbac|datenfluss|bnetza|security evidence)/i.test(
      haystack
    ) &&
    !/(steuern|steuerung ausfuehren|steuerung ausführen|control command|switch|schalten|device-control|smgw switch)/i.test(
      haystack
    );
  if (hasClsDigitalTwinComplianceCombo || haystack.includes('cls_digital_twin_compliance_gate')) {
    const clsComplianceCapability = findCapabilityByName('cls_digital_twin_compliance_gate');
    if (clsComplianceCapability) {
      return { capability: clsComplianceCapability, score: 122, usedFallback: false };
    }
  }

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

  const hasImsysScheduleValueChainSignal =
    /(imsys|cls|smart.?meter)/i.test(haystack) &&
    /(fahrplan|value.?chain|zustandsmanagement|messdaten.*steuerung|steuerung.*messdaten|kapazit[aä]tsbewirtschaftung|engpasslogik|flexibilit[aä]tsnutzung|leitwartenuebergabe|leitwarte|control.?readiness)/i.test(
      haystack
    );

  if (hasImsysScheduleValueChainSignal) {
    const imsysCapability = findCapabilityByName('imsys_schedule_value_chain_readiness');
    if (imsysCapability) {
      return {
        capability: imsysCapability,
        score: 122,
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
