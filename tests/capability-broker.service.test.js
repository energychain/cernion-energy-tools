const { ServiceBroker } = require('moleculer');
const CapabilityBrokerService = require('../services/capability-broker.service');

describe('Capability Broker Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(CapabilityBrokerService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('rejects unsupported dossier mode at the service contract boundary', async () => {
    await expect(
      broker.call('capability-broker.recommend', {
        schemaVersion: 'cernion.capabilityRecommendation.v1',
        task: 'CO2-Intensität für 74889 Sinsheim bitte anzeigen',
        mode: 'dossier',
      })
    ).rejects.toMatchObject({ type: 'VALIDATION_ERROR' });
  });

  it('returns fixed response schemaVersion when request schemaVersion is missing', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bewerte Residuallast für Stadtwerke München in 48h',
    });

    expect(result.schemaVersion).toBe('cernion.capabilityRecommendation.v1');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(
      result.warnings.some((w) =>
        w.includes('Missing request schemaVersion mapped to cernion.capabilityRecommendation.v1')
      )
    ).toBe(true);
  });

  it('maps unsupported request schemaVersion to v1 with warning', async () => {
    const result = await broker.call('capability-broker.recommend', {
      schemaVersion: 'legacy.v0',
      task: 'Löse VNB Identität für Stadtwerke München',
    });

    expect(result.schemaVersion).toBe('cernion.capabilityRecommendation.v1');
    expect(
      result.warnings.some((w) =>
        w.includes(
          'Unsupported request schemaVersion mapped to cernion.capabilityRecommendation.v1'
        )
      )
    ).toBe(true);
  });

  it('degrades next_step to initial when alreadyExecutedSteps is empty', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Residuallast für Stadtwerk analysieren',
      mode: 'next_step',
      alreadyExecutedSteps: [],
    });

    expect(result.mode).toBe('next_step');
    expect(result.effectiveMode).toBe('initial');
    expect(
      result.warnings.some((w) =>
        w.includes(
          'Requested mode next_step but alreadyExecutedSteps was empty; degraded to initial recommendation.'
        )
      )
    ).toBe(true);
  });

  it('enforces doNotUse by excluding forbidden actions from recommendedPlan', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Residuallast und CO2 für Stadtwerke X',
      doNotUse: ['grid-operations.marketPartners'],
    });

    const actions = result.recommendedPlan.map((step) => step.action);
    expect(actions.includes('grid-operations.marketPartners')).toBe(false);
    expect(result.doNotUse.some((entry) => entry.action === 'grid-operations.marketPartners')).toBe(
      true
    );
  });

  it('degrades compare to initial when compareCandidates are missing', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Vergleiche Service A und B für Residuallast',
      mode: 'compare',
      compareCandidates: [],
    });

    expect(result.mode).toBe('compare');
    expect(result.effectiveMode).toBe('initial');
    expect(
      result.warnings.some((w) =>
        w.includes(
          'Requested mode compare but no candidates were provided; degraded to initial recommendation.'
        )
      )
    ).toBe(true);
  });

  it('routes VNB KPI benchmark comparison queries to correct capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle einen Potenzialvergleich zwischen Netze BW und STROMDAO Netze anhand der EWK KPI-Kennzahlen (Anschlussdauer, Digitalisierungsindex, Umsetzungsquote)',
    });

    expect(result.schemaVersion).toBe('cernion.capabilityRecommendation.v1');
    expect(result.recommendedCapabilities).toBeDefined();
    expect(result.recommendedCapabilities[0].capability).toBe('vnb_kpi_benchmark_comparison');
    expect(result.recommendedPlan).toBeDefined();
    expect(Array.isArray(result.recommendedPlan)).toBe(true);

    // The plan should include marketPartners and benchmarkVnb as preferred actions
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('grid-operations.marketPartners');
    expect(actionNames).toContain('ewk-monitoring.benchmarkVnb');
  });

  it('includes correct keywords for VNB benchmark capability recommendation', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Vergleich Anschlussdauer und Digitalisierungsindex zwischen Nachbar-Stadtwerken',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('vnb_kpi_benchmark_comparison');
  });

  it('falls back to interface-placeholder when no deterministic capability matches', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Irgendetwas völlig Unbekanntes ohne erkennbare Prozesszuordnung',
      agentRole: 'portfolio_decision',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('interface_placeholder');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
    expect(
      result.warnings.some((warning) => warning.includes('interface-placeholder fallback'))
    ).toBe(true);
  });

  it('routes portfolio logic prompts to znp.assessPortfolio', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte ZNP Portfolio-Logik für Projekt abc prüfen inkl. Layer 0/2/2.5 und fNAV',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('znp_portfolio_assessment');
    expect(result.recommendedPlan[0].action).toBe('znp.assessPortfolio');
    expect(result.recommendedPlan[0].params).toEqual(
      expect.objectContaining({
        projectId: null,
        kaufmaennischeFreigabeFnav: false,
      })
    );
  });

  it('routes direct netzfahrplan prompts to the dedicated Phase-5 capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte fNAV als Alternative zu Kupferausbau prüfen inkl. Netzfahrplan, N-1 und Payback',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('netzfahrplan_fnav_assessment');
    expect(result.recommendedPlan[0].action).toBe('grid-connection.fnavValidate');
  });

  it('routes AGSI plus ENTSO-E Lagebild prompts to cross-commodity supply security', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte erstelle ein 72h Lagebild fuer die Beschaffungsrunde mit Gasspeicher AGSI, ENTSO-E Lastprognose, Windprognose, Day-Ahead und Voralarm-Einordnung.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe(
      'cross_commodity_supply_security_lagebild'
    );
    const actions = result.recommendedPlan.map((step) => step.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'gas-storage.countryStorage',
        'gas-storage.supplySecurityCheck',
        'entsoe.loadForecast',
        'entsoe.windSolarForecast',
        'entsoe.dayAheadPrices',
      ])
    );
  });

  it('routes Netzsignal-Vorrang Vertragsgate prompts to the Phase-5 fNAV capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte fNAV Netzfahrplan mit Netzsignal Vorrang Vertragsgate für einen flexiblen Netzanschlussvertrag prüfen.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('netzfahrplan_fnav_assessment');
    expect(result.recommendedPlan[0].action).toBe('grid-connection.fnavValidate');
  });

  it('routes A96 reconciliation prompts to settlement.reconcileA96 and hydrates knownContext', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte A96 Abgleich per anlageId/timeSlice durchführen und Deltas zeigen.',
      knownContext: {
        settlementId: 'redispatch_2026q2_SEE999952467552',
        incomingRows: [
          {
            anlageId: 'SEE999952467552',
            timeSlice: '2026-04-01T00:00:00.000Z/2026-04-01T01:00:00.000Z',
          },
        ],
      },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('settlement_a96_reconciliation');
    expect(result.recommendedPlan[0].action).toBe('settlement.reconcileA96');
    expect(result.recommendedPlan[0].params).toEqual(
      expect.objectContaining({
        settlementId: 'redispatch_2026q2_SEE999952467552',
      })
    );
  });

  it('routes Lastgangdaten Bewegungsstrom monitor prompts to dashboard-api.loadProfileStreamMonitor', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Lastgangdaten Bewegungsstrom Stream-Monitor mit Anomaly-Class Buckets prüfen.',
      knownContext: {
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
        gridOperatorId: 'SNB935578300972',
      },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('load_profile_stream_monitor');
    expect(result.recommendedPlan[0].action).toBe('dashboard-api.loadProfileStreamMonitor');
    expect(result.recommendedPlan[0].params).toEqual(
      expect.objectContaining({
        meloId: 'DE0012345678901234567890123456789',
        from: '2026-03-31T00:00:00Z',
        to: '2026-04-01T00:00:00Z',
      })
    );
  });

  it('routes financier due-diligence prompts to finance-agent.analyze instead of interface placeholder', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle ein vorläufiges Risk Assessment für den Kreditausschuss (Due Diligence, Condition Precedent).',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('financier_due_diligence_assessment');
    expect(result.intent).toBe('financier_due_diligence_assessment');
    expect(result.recommendedPlan[0].action).toBe('finance-agent.analyze');
    expect(result.recommendedPlan[0].params.query).toMatch(
      /Risk Assessment|Kreditausschuss|Due Diligence/i
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe('interface_placeholder');
  });

  it('routes role-boundary governance prompts to VDMI governance capability (not pure VNB identity)', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Schritt 1: Rollen und Schnittstellen klären – Projektträger ist nicht Netzbetreiber und die Gatekeeper-Rolle liegt beim DSO (§17 EnWG, Arealnetzbetreiber).',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_role_boundary_governance');
    expect(result.recommendedPlan[0].action).toBe('vdmi.agentRole');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'grid_operator_identity_resolution'
    );
  });

  it('routes formal grid-connection decision prompts to VDMI decision governance intent', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage oder Kapazitaetszusage geben?',
      knownContext: {
        processType: 'grid-connection-governance',
        taskId: 'network-operator-decision',
      },
    });

    expect(result.recommendedCapabilities[0].capability).toBe(
      'vdmi_grid_connection_decision_governance'
    );
    expect(result.recommendedPlan.map((step) => step.action)).toEqual(
      expect.arrayContaining(['vdmi.dossier', 'vdmi.negotiationTrace', 'vdmi.agentRole'])
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
  });

  it('hydrates vdmi decision defaults (taskId/processType) from prompt when knownContext is missing', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage geben?',
    });

    expect(result.recommendedCapabilities[0].capability).toBe(
      'vdmi_grid_connection_decision_governance'
    );

    const dossierStep = result.recommendedPlan.find((step) => step.action === 'vdmi.dossier');
    const traceStep = result.recommendedPlan.find(
      (step) => step.action === 'vdmi.negotiationTrace'
    );
    const roleStep = result.recommendedPlan.find((step) => step.action === 'vdmi.agentRole');

    expect(dossierStep.params.taskId).toBe('network-operator-decision');
    expect(traceStep.params.taskId).toBe('network-operator-decision');
    expect(roleStep.params.taskId).toBe('network-operator-decision');
    expect(roleStep.params.processType).toBe('grid-connection-governance');
  });

  it('routes asset-evidence governance prompts to VDMI asset-validation capability before generic role-boundary', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Asset-Validierung für Anlage TR-17 durchführen, Evidence/Nachweise prüfen, Risikofaktoren und verbotene Annahmen offenlegen.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('vdmi.dossier');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_role_boundary_governance');
  });

  it('propagates knownContext.processType into vdmi.agentRole plan params', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Rollen und Schnittstellen im Governance-Prozess für DSO Gatekeeper klären',
      knownContext: {
        processType: 'grid-connection-asset-validation',
      },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_role_boundary_governance');
    expect(result.recommendedPlan[0].action).toBe('vdmi.agentRole');
    expect(result.recommendedPlan[0].params.processType).toBe('grid-connection-asset-validation');
  });

  // ── VNB Lookup Routing (Issue #177) ──────────────────────────────────────────

  it('routes PLZ + VNB intent to grid_operator_identity_resolution with vnbLookup as first action', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Welcher Netzbetreiber ist für PLZ 12045 in Berlin zuständig?',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('grid-operations.vnbLookup');
    expect(actionNames).toContain('grid-operations.vnbLookupCodes');
  });

  it('routes explicit netzbetreiber-zuordnung prompt to grid_operator_identity_resolution', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Netzbetreiber-Zuordnung für Standort Frankfurt – welcher VNB ist zuständig und welchen BDEW-Code hat er?',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('grid-operations.vnbLookup');
    expect(actionNames).toContain('grid-operations.marketPartners');
  });

  it('routes Firmenname VNB lookup to grid_operator_identity_resolution including marketPartners', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'VNB Lookup: Netzgebiet-Zuordnung für Firmenname Stadtwerke Köln ermitteln – BDEW-Code und SNB gesucht',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('grid-operations.marketPartners');
    expect(actionNames).toContain('grid-operations.vnbLookup');
  });

  it('does NOT route pure VNB lookup to VDMI governance capabilities', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Welcher VNB ist für PLZ 70173 Stuttgart zuständig?',
    });

    const cap = result.recommendedCapabilities[0].capability;
    expect(cap).not.toBe('vdmi_grid_connection_decision_governance');
    expect(cap).not.toBe('vdmi_role_boundary_governance');
    expect(cap).not.toBe('vdmi_asset_validation_governance');
  });

  it('does NOT route pure VNB lookup to interface-placeholder or generic query.ask', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Netzbetreiber Zuordnung für PLZ 80333 München',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    expect(result.recommendedPlan[0].action).not.toBe('interface-placeholder.markGap');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).not.toContain('query.ask');
    expect(actionNames).not.toContain('query.askLearned');
  });

  // ── VNB Lookup — Param Hydration from knownContext (Issue #177) ─────────────

  it('hydrates vnbLookup.bdew from knownContext.bdew (direct BDEW lookup)', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'VNB Lookup: BDEW-Code auflösen',
      knownContext: { bdew: '9900992720003' },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const vnbStep = result.recommendedPlan.find((s) => s.action === 'grid-operations.vnbLookup');
    expect(vnbStep).toBeDefined();
    expect(vnbStep.params.bdew).toBe('9900992720003');
  });

  it('hydrates vnbLookup.city from knownContext.city (Ort-based lookup)', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Netzbetreiber-Zuordnung für PLZ 80333 München',
      knownContext: { city: 'München' },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const vnbStep = result.recommendedPlan.find((s) => s.action === 'grid-operations.vnbLookup');
    expect(vnbStep).toBeDefined();
    expect(vnbStep.params.city).toBe('München');
  });

  it('hydrates vnbLookup.city from knownContext.postalCode as fallback', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Welcher VNB ist für PLZ 12045 in Berlin zuständig?',
      knownContext: { postalCode: '12045' },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const vnbStep = result.recommendedPlan.find((s) => s.action === 'grid-operations.vnbLookup');
    expect(vnbStep).toBeDefined();
    // postalCode maps to city as fallback when no city is provided
    expect(vnbStep.params.city).toBe('12045');
  });

  it('hydrates marketPartners.query from knownContext.gridOperatorName (Firmenname path)', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'VNB Lookup Firmenname Stadtwerke Köln',
      knownContext: { gridOperatorName: 'Stadtwerke Köln' },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const mpStep = result.recommendedPlan.find(
      (s) => s.action === 'grid-operations.marketPartners'
    );
    expect(mpStep).toBeDefined();
    expect(mpStep.params.query).toBe('Stadtwerke Köln');
  });

  it('hydrates vnbLookupCodes.bdewCode from knownContext.bdewCode', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'VNB Lookup Codes',
      knownContext: { bdewCode: '9907473000008' },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('grid_operator_identity_resolution');
    const codesStep = result.recommendedPlan.find(
      (s) => s.action === 'grid-operations.vnbLookupCodes'
    );
    expect(codesStep).toBeDefined();
    expect(codesStep.params.bdewCode).toBe('9907473000008');
  });

  // ── Non-VDMI Domain Routing Regression Tests (Issue #225) ──────────────────

  it('routes EDM Move-Out / customer-service / billing dossier to edm_customer_moveout_billing_evidence, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Kundenservice eines Stadtwerks in Heidelberg. Ein Kunde meldet seinen Auszug zum Monatsende, aber der plausibilisierte Schlusszaehlerstand liegt noch nicht vor. Bitte erstelle ein Cernion Answer Dossier: Welche Evidence brauchen Kundenservice, EDM und Abrechnung, was duerfen wir dem Kunden heute sagen, was darf erst nach EDM-Plausibilisierung und Abrechnungsfreigabe passieren? Bitte trenne bekannte Angaben, fehlende Evidence, Rollenverantwortung und Folgefragen.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('edm_customer_moveout_billing_evidence');
    expect(result.capability).toBe('edm_customer_moveout_billing_evidence');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes Energy Sharing / Prosumer Advisory dossier to energy_sharing_prosumer_advisory, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin Prosumer und moechte mich unabhaengig informieren: Kann ich Strom aus meiner PV-Anlage an meinen Nachbarn verkaufen? Welche Voraussetzungen gelten fuer Energy Sharing und wie muesste ich dabei vorgehen? Bitte erstelle ein Cernion Answer Dossier und trenne Energy Sharing, Mieterstrom, Direktlieferung/Nachbarschaftsverkauf und Eigenversorgung. Bitte nenne benoetigte Evidence, Marktrollen, Messkonzept, Bilanzierung/Allokation, Vertrag/Abrechnung und offene Folgefragen. Keine verbindliche Rechtsberatung und kein automatisches NAP-Wallet-Onboarding.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('energy_sharing_prosumer_advisory');
    expect(result.capability).toBe('energy_sharing_prosumer_advisory');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes Redispatch/RCS special-case governance dossier to redispatch_rcs_special_case_governance, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin in der Redispatch-Koordination eines Verteilnetzbetreibers. Bitte erstelle ein Cernion Answer Dossier fuer folgenden Sonderfall: Eine steuerbare Erzeugungsanlage wurde wegen lokaler Netzengpasslage abgeregelt, aber die Stammdatenlage ist unsicher und es ist unklar, ob der Fall in den normalen Redispatch-2.0-Prozess, einen RCS-Sonderfall oder eine Expost-/Settlement-Nachklaerung gehoert. Bitte trenne operative Massnahme, Datenqualitaet, Expost-Nachweis, Settlement-Risiko und Reporting-Governance. Nenne, welche Evidence aus Redispatch-Assetregister, Data Governance, Special-Case-Gate, RCS-Regelkatalog, Simulation und Settlement-Sandbox erforderlich waere. Keine Verguetungszusage ohne Expost-Evidence.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('redispatch_rcs_special_case_governance');
    expect(result.capability).toBe('redispatch_rcs_special_case_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes Datasource Registry / classification governance dossier to datasource_registry_classification_governance, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Datenmanagement eines Stadtwerks. Wir wollen einen neuen Datenquellenbestand fuer Lastgaenge, MSCONS-Importe und Netzplanungsdaten in Cernion aufnehmen. Bitte erstelle ein Answer Dossier: Welche Evidence brauchen wir fuer Datasource Registry, Klassifikation, Cache-Status, Watcher/Monitoring und Data-Governance, bevor die Datenquelle fuer Netzplanung oder Abrechnung genutzt werden darf? Bitte trenne bekannte Angaben, Missing Evidence, technische Pruefschritte und Freigabepunkte. Keine produktive Ingest- oder Schreibaktion ausloesen.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('datasource_registry_classification_governance');
    expect(result.capability).toBe('datasource_registry_classification_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes HITL / notification / persona-inbox evidence request dossier to hitl_role_based_evidence_request, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Kundenservice eines Stadtwerks und habe ein Dossier mit fehlender Evidence: Assetmanagement muss den Netzasset-Bezug bestaetigen, Netzplanung muss Kapazitaet pruefen und EDM muss den plausibilisierten Zaehlerstand nachliefern. Bitte erstelle ein Cernion Answer Dossier, das die Human-in-the-Loop-Nachforderungen rollenbasiert vorbereitet: Welche Persona/Rolle bekommt welche Evidence-Anforderung, welche Nachricht darf intern vorbereitet werden, was darf nicht extern gesendet werden, und wie soll die Ursprungssession informiert werden, sobald Evidence nachgeliefert wird? Keine externe Nachricht oder Webhook-Ausloesung ohne Freigabe.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('hitl_role_based_evidence_request');
    expect(result.capability).toBe('hitl_role_based_evidence_request');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  // ── DSO Residual Load / Flexibility Window — issue #231 ──

  it('routes Turn 1 DSO residual-load dossier (hyphenated form + Evidence keyword) to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Netzbetrieb eines Stadtwerks und brauche ein Answer Dossier fuer morgen: Wie sieht die Residual-Load-Lage fuer unser DSO-Gebiet aus, welche Flexibilitaetsfenster sind aus CO2/GruenstromIndex, Day-Ahead-Preis, Forecast und ggf. German-Grid-/Netztransparenzdaten ableitbar? Bitte nutze wenn moeglich residual-load, forecast, german-grid und energy-market Evidence. Standort: 74889 Sinsheim. Keine Steueranweisung und keine MW-Zusage ohne belastbare Evidence.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
  });

  it('routes Turn 2 Beschaffungsplanung Residuallast/CO2 dossier to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin in der Beschaffungsplanung eines Stadtwerks. Bitte erstelle ein Answer Dossier fuer morgen: Wie ist die Residuallast einzuschaetzen, welche CO2-/GruenstromIndex-Signale und Day-Ahead-Preise sprechen fuer oder gegen Lastverschiebung, und welche Evidence fehlt fuer ein belastbares Flexibilitaetsfenster? Bitte nutze residual-load und energy-market Evidence, wenn verfuegbar. Keine Steueranweisung und keine MW-Zusage.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
  });

  it('routes Turn 3 English DSO residual load forecast dossier to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'As a DSO operations analyst, I need an Answer Dossier for a residual load forecast and flexibility window assessment for the next 24 hours. Please consider residual-load, forecast, CO2 intensity and day-ahead price evidence. Separate validated evidence, missing evidence and operational constraints. Do not make switching instructions or MW commitments.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
  });

  it('routes Turn 4 VNB Flexibilitaetsfenster (no postal code, not grid-connection) to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin beim VNB fuer Flexibilitaetsmanagement zustaendig. Bitte erstelle ein Dossier fuer ein Flexibilitaetsfenster morgen frueh: Residuallast, Forecast, GruenstromIndex/CO2 und Day-Ahead-Preis sollen gemeinsam bewertet werden. Es geht nicht um einen Netzanschlussantrag und nicht um Assetvalidierung, sondern um eine vorsichtige Lageeinschaetzung fuer Lastverschiebung.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_grid_connection_decision_governance');
  });

  // ── Regression: Existing VDMI prompts must still route correctly after domain fixes ──

  it('still routes formal §17 EnWG grid-connection decision prompt to VDMI decision governance after non-VDMI fixes', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage oder Kapazitaetszusage geben?',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_grid_connection_decision_governance');
  });

  it('still routes asset-evidence validation prompt to VDMI asset-validation after non-VDMI fixes', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Asset-Validierung für Anlage TR-17 durchführen, Evidence/Nachweise prüfen, Risikofaktoren und verbotene Annahmen offenlegen.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_asset_validation_governance');
  });

  // ── Issue #232 — VDMI positive controls and non-VDMI domain route regression tests ──

  it('control-vdmi-asset-project-evidence: multi-role asset-validation Evidence dossier still routes to vdmi_asset_validation_governance', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle ein VDMI Evidence-Governance-Dossier fuer die Asset-Validierung eines Netzanschlussprojekts: Mehrere Rollen muessen Evidence beisteuern, Nachweise pruefen und Risikofaktoren sowie verbotene Annahmen dokumentieren. Keine Freigabe ohne vollstaendige Evidenz-Matrix.',
    });

    expect(result.capability).toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_asset_validation_governance');
  });

  it('control-vdmi-ad-hoc-responsibility: ad-hoc Stadtwerk asset-evidence responsibility dossier still routes to vdmi_asset_validation_governance', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Mehrere Rollen im Stadtwerk muessen fuer die Entscheidung Evidence und Nachweise beisteuern. Wer ist zustaendig fuer die Asset-Validierung und welche Belege und Risikofaktoren muss jede Rolle dokumentieren?',
    });

    expect(result.capability).toBe('vdmi_asset_validation_governance');
    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_asset_validation_governance');
  });

  it('edm-metering-mk40: MSCONS/MK40 Messkonzept Evidence dossier routes to edm_metering_concept_evidence, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im EDM-Team eines Stadtwerks und bearbeite einen MSCONS-Fall fuer das Messkonzept MK40. Bitte erstelle ein Answer Dossier: Welche MSCONS-Meldungen liegen vor, welche EDM-Qualitaetspruefschritte sind noch offen, und welche Evidence und Nachweise fehlen fuer die Messkonzept-Freigabe? Kein produktiver Schreibzugriff ohne Freigabe.',
    });

    expect(result.capability).toBe('edm_metering_concept_evidence');
    expect(result.recommendedCapabilities[0].capability).toBe('edm_metering_concept_evidence');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('edm-messkonzept.list');
  });

  it('forecast-flex-bess: BESS Flex-Prognose Grid-Operations Evidence dossier routes to flex_forecast_bess_grid_operations_advisory, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Grid-Operations-Team eines Verteilnetzbetreibers. Bitte erstelle ein Answer Dossier fuer die BESS-Flex-Prognose fuer morgen: Welche Forecast-Evidence liegt vor, welche Flex-Kapazitaet ist verfuegbar, und welche Nachweise fehlen fuer eine belastbare Prognose? Keine Schaltanweisung ohne Evidence.',
    });

    expect(result.capability).toBe('flex_forecast_bess_grid_operations_advisory');
    expect(result.recommendedCapabilities[0].capability).toBe('flex_forecast_bess_grid_operations_advisory');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('finance-nkp-regulatory: NKP/CAPEX Reinvestitionsplanung Governance dossier routes to finance_nkp_capex_reinvest_governance, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Regulierungsmanagement eines Verteilnetzbetreibers. Bitte erstelle ein Answer Dossier fuer die NKP-Kalkulation und den CAPEX-Reinvestitionsplan: Welche regulatorischen Anforderungen gelten, welche Nachweise fehlen fuer die Genehmigung, und welche Governance-Schritte sind erforderlich? Bitte trenne vorhandene Evidence, Missing Evidence und regulatorische Pruefpflichten.',
    });

    expect(result.capability).toBe('finance_nkp_capex_reinvest_governance');
    expect(result.recommendedCapabilities[0].capability).toBe('finance_nkp_capex_reinvest_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('bilanzkreis-slp-edm: Bilanzkreis/SLP Fahrplanabgleich Evidence dossier routes to bilanzkreis_slp_edm_operations, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Bilanzkreis-Management eines Stadtwerks. Bitte erstelle ein Answer Dossier fuer den Fahrplanabgleich unserer SLP-Kunden mit den EDM-Daten: Welche Abweichungen liegen vor, welche Evidence fehlt fuer den Bilanzkreisausgleich, und welche Freigabeschritte sind erforderlich? Kein produktiver Eingriff ohne Evidenz.',
    });

    expect(result.capability).toBe('bilanzkreis_slp_edm_operations');
    expect(result.recommendedCapabilities[0].capability).toBe('bilanzkreis_slp_edm_operations');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('bilanzkreis.list');
  });

  it('connection-rejection-fnav-14a: §14a EnWG Anschlussablehnung Evidence dossier routes to connection_rejection_fnav_14a_evidence, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Unser Stadtwerk hat eine Anschlussablehnung fuer eine steuerbare Verbrauchseinrichtung nach §14a EnWG erhalten. Bitte erstelle ein Answer Dossier: Welche Evidence liegt vor, welche Nachweise fehlen fuer den Widerspruch, und welche technischen Pruefschritte sind erforderlich? Bitte trenne Known Evidence, Missing Evidence und moegliche Widerspruchsgruende.',
    });

    expect(result.capability).toBe('connection_rejection_fnav_14a_evidence');
    expect(result.recommendedCapabilities[0].capability).toBe('connection_rejection_fnav_14a_evidence');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('gasnetz-waermeplanung: Gasnetz kommunale Waermeplanung Assessment dossier routes to gasnetz_waermeplanung_assessment, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin in der Netzplanung eines Gasnetzbetreibers. Im Rahmen der kommunalen Wärmeplanung muessen wir Gasnetz-Abschnitte fuer die Transformation evaluieren. Bitte erstelle ein Answer Dossier: Welche Evidence liegt zur Leitungslage vor, welche Nachweise fehlen fuer die Umplanung, und welche Governance-Schritte sind erforderlich?',
    });

    expect(result.capability).toBe('gasnetz_waermeplanung_assessment');
    expect(result.recommendedCapabilities[0].capability).toBe('gasnetz_waermeplanung_assessment');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('eeg-clawback-ewk-monitoring: EEG-Clawback EWK-Monitoring Evidence dossier routes to eeg_clawback_ewk_monitoring, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Regulierungsmanagement eines Verteilnetzbetreibers. Bitte erstelle ein Answer Dossier fuer das EEG-Clawback-Monitoring: Welche EWK-Bewertungen und Evidence liegen vor, welche Nachweise fuer eine moegliche EEG-Rueckforderung fehlen, und welche Governance-Schritte sind erforderlich?',
    });

    expect(result.capability).toBe('eeg_clawback_ewk_monitoring');
    expect(result.recommendedCapabilities[0].capability).toBe('eeg_clawback_ewk_monitoring');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_asset_validation_governance');
    expect(result.recommendedPlan[0].action).toBe('ewk-monitoring.benchmarkVnb');
  });

  it('breadth-a96: A96 Settlement dossier routes to settlement_a96_reconciliation before Redispatch-RCS', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte erstelle ein Settlement A96 Reconciliation Dossier: A96-Abgleich, Bilanzierungsabweichung, Expost-Nachweis, Abrechnungsfreigabe und fehlende Settlement-Evidence.',
    });

    expect(result.capability).toBe('settlement_a96_reconciliation');
    expect(result.recommendedCapabilities[0].capability).toBe('settlement_a96_reconciliation');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'redispatch_rcs_special_case_governance'
    );
  });

  it('breadth-vdmi-role-boundary: role-boundary dossier routes to vdmi_role_boundary_governance before portfolio gatekeeping', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte erstelle ein VDMI Role Boundary Governance Dossier: Akteursrollen, Verantwortungsgrenzen, Evidence-Zustaendigkeit, Agentenrolle und verbotene Annahmen.',
    });

    expect(result.capability).toBe('vdmi_role_boundary_governance');
    expect(result.recommendedCapabilities[0].capability).toBe('vdmi_role_boundary_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe('vdmi_portfolio_gatekeeping');
  });

  it('breadth-redispatch-settlement-sandbox: sandbox dossier routes before Redispatch-RCS', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte erstelle ein Redispatch Settlement Sandbox Dossier: Expost-Szenario, Redispatch-Abrechnung, Verguetungsrisiko, Plausibilitaet und offene Settlement-Nachweise.',
    });

    expect(result.capability).toBe('redispatch_settlement_sandbox');
    expect(result.recommendedCapabilities[0].capability).toBe('redispatch_settlement_sandbox');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'redispatch_rcs_special_case_governance'
    );
  });

  it('routes Redispatch readiness prompts to the readiness gate capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe die Redispatch Produktivreife: Zugangsmatrix, Testabruf, Produktivnachweis, Stammdatentemplate und Abnahmefrist.',
    });

    expect(result.capability).toBe('redispatch_readiness_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('redispatch_readiness_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('redispatch-readiness-gate.getStatus');
    expect(actionNames).toContain('redispatch-readiness-gate.evaluate');
  });

  it('routes Redispatch call data-quality prompts to the read-only dashboard gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe den Redispatch Abrufprozess als Datenqualitaets-Gate: Nullwerte, fehlende Prognose, Kontrollnachweis, Monitoring Verantwortung, Redispatch Clearing und Abrechnungsgate.',
    });

    expect(result.capability).toBe('redispatch_call_data_quality_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'redispatch_call_data_quality_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.redispatchCallQualityGate');
    expect(actionNames).toContain('redispatch-expost.list');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes evidence grounding confidence prompts to the read-only audit view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle einen Evidence Grounding Confidence Audit mit Quellenklassen, Scope Filter, Tool Ausfall, Netzbetreiber Bestaetigung und Confidence Begruendung.',
    });

    expect(result.capability).toBe('evidence_grounding_confidence_audit');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'evidence_grounding_confidence_audit'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.evidenceGroundingConfidenceAudit');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes receipt-grounded presentation contract prompts to the read-only inspect view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Receipt Grounded Presentation Contract bei Renderer Mismatch und Source Action Mismatch fuer VDMI Presentation Mismatch.',
    });

    expect(result.capability).toBe('receipt_grounded_presentation_contract');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'receipt_grounded_presentation_contract'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.receiptGroundedPresentationContract');
    expect(actionNames).not.toContain('personal-agent.execute');
    expect(actionNames).not.toContain('hitl.create');
  });

  it('routes market-communication evidence-chain prompts to the read-only dossier status view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Marktkommunikations Evidenzkette fuer MaLo MeLo UTILMD Stammdatenweg Verbrauchsdatenabruf EDM Datenqualitaet und Portalhinweis vs offizieller Nachweis.',
    });

    expect(result.capability).toBe('market_communication_evidence_chain');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'market_communication_evidence_chain'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.marketCommunicationEvidenceChainStatus');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes E2E Steuerbarkeitscheck governance prompts to the read-only matrix view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Baue eine E2E Steuerbarkeitscheck Governance Evidenzmatrix fuer §14a Redispatch Steuerbarkeit mit Messkonzept, Rollenmatrix, Abgabeprozess und Abrechnung Grenze.',
    });

    expect(result.capability).toBe('e2e_controllability_check_governance');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'e2e_controllability_check_governance'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.e2eControllabilityGovernanceStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Steuerbarkeitscheck asset handover prompts to the read-only handover view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle Steuerbarkeitscheck Asset Linienuebergabe fuer steuerbare Anlagen mit Rueckmeldefaehigkeit, Fernsteuerbarkeit, Meldezyklus, Nichtdurchfuehrungsbegruendung und Asset Evidenzkatalog.',
    });

    expect(result.capability).toBe('controllability_asset_handover');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'controllability_asset_handover'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.controllabilityAssetHandoverStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes regulatory change readiness prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Regulatory Change Simulator Readiness fuer EEG Mechanik mit Viertelstundenprofil, Ersatzwertlogik, MaKo Sonderfall, Betreibererklaerung, Auditierbarkeit und Testfallpaket.',
    });

    expect(result.capability).toBe('regulatory_change_simulator_readiness');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'regulatory_change_simulator_readiness'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.regulatoryChangeReadinessStatus');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes investment two-track control prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Investitionsprozess Zwei Spuren fuer Budgetabgabe, Investitionsabgabe, Abgabesicherheit, Investdaten Datenqualitaet, ISO 55001 Zielbild, Freigabelogik und Vorstandsformat.',
    });

    expect(result.capability).toBe('investment_two_track_control');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'investment_two_track_control'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.investmentTwoTrackControlStatus');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes SAP Budget PSP Gate prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe SAP Budget PSP Gate fuer PSP Reste, Budgetueberhang, interner Auftrag, SAP Migration Invest, Finance Gate, Massnahmenpriorisierung, Planwert und Assetnutzen.',
    });

    expect(result.capability).toBe('sap_budget_psp_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'sap_budget_psp_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.sapBudgetPspGateStatus');
    expect(actionNames).not.toContain('sap.psp.write');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Energy Tax Information Package prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Energiesteuer Steuerdaten Information Package mit Data Dictionary, Aggregationslogik, Validierungsstatus, Datenuebergabe, SLA und Audit Reference.',
    });

    expect(result.capability).toBe('energy_tax_information_package');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'energy_tax_information_package'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.energyTaxInformationPackageStatus');
    expect(actionNames).not.toContain('tax.calculate');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Invest Risiko translation prompts to the read-only evidence status', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Uebersetze GF-Folie und Monatsbericht als Invest Risiko Uebersetzungsqueue mit Risikoaufnahme, Entscheidungsgrundlage, Owner, blockierter Folgeentscheidung und naechster Aktion.',
    });

    expect(result.capability).toBe('investment_risk_translation_status');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'investment_risk_translation_status'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.investmentRiskTranslationStatus');
    expect(actionNames).not.toContain('vdmi.create');
    expect(actionNames).not.toContain('finance-agent.analyze');
    expect(actionNames).not.toContain('investment-planning.createPlan');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Budget Waterfall Governance prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe budget_waterfall_governance fuer Budget-Wasserfall, Investitionswasserfall, Ueberhang, Vorzeichenlogik, Prognoseende, Freigabestatus und Gremienreife.',
    });

    expect(result.capability).toBe('budget_waterfall_governance');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'budget_waterfall_governance'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.budgetWaterfallGovernanceStatus');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('sap.psp.write');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Gas Decommissioning Roadmap prompts to the read-only evidence status', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe gas_decommissioning_roadmap_status fuer Gasnetz-Stilllegung, Stilllegungsroadmap, Transformationsfahrplan, Asset-Risiko, Investfolge, Gremiengate, Abhaengigkeiten und Ausfuehrungsuebergabe.',
    });

    expect(result.capability).toBe('gas_decommissioning_roadmap_status');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'gas_decommissioning_roadmap_status'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gasDecommissioningRoadmapStatus');
    expect(actionNames).not.toContain('gas-transformation.executeDecommissioning');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Jour-Fixe Decision Closure prompts to the read-only evidence status', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe jour_fixe_decision_closure_tracker fuer Jour Fixe, Entscheidung offen, Abschlussstatus, Owner, KPI, Entscheidungskriterium, naechstes Gate, carried over und Abschlussnachweis.',
    });

    expect(result.capability).toBe('jour_fixe_decision_closure_tracker');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'jour_fixe_decision_closure_tracker'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.jourFixeDecisionClosureStatus');
    expect(actionNames).not.toContain('meeting-transcription.ingest');
    expect(actionNames).not.toContain('vdmi.create');
    expect(actionNames).not.toContain('nova.createDecision');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Off-Balancing Metering Pruefmatrix prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe off_balancing_metering_pruefmatrix fuer Off-Balancing Metering, Zaehlpark Leasing, CAPEX OPEX, EOG, Kostenanerkennung, Datenqualitaet, Schnittstellenrisiko, Scheinspielraum und nutzbaren Stromnetz Investitionsspielraum.',
    });

    expect(result.capability).toBe('off_balancing_metering_pruefmatrix');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'off_balancing_metering_pruefmatrix'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.offBalancingMeteringPruefmatrixStatus');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('sap.psp.write');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Automation Requirements Decision Value prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe automation_requirements_decision_value fuer eine PowerBI Dashboard Wunsch Requirements Card mit Bewegungsdatenfluss, manuellem Aufwand, Kontrollpunkt, Entscheidungswert, Folgeprozess und Rollback Criterion.',
    });

    expect(result.capability).toBe('automation_requirements_decision_value');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'automation_requirements_decision_value'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.automationRequirementsDecisionValueStatus');
    expect(actionNames).not.toContain('powerbi.createDashboard');
    expect(actionNames).not.toContain('power-automate.createFlow');
    expect(actionNames).not.toContain('workflow.create');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Smart-Meter Off-Balancing Purpose-Lock prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe smart_meter_off_balancing_purpose_lock fuer Smart Meter Off-Balancing, Purpose Lock, Zweckbindung, freiwerdende Liquiditaet, Finanzierer Kosten, regulatorische Anerkennung, Budgetverwaesserung und Leitwarte Invest.',
    });

    expect(result.capability).toBe('smart_meter_off_balancing_purpose_lock');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'smart_meter_off_balancing_purpose_lock'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.smartMeterOffBalancingPurposeLockStatus');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('sap.psp.write');
    expect(actionNames).not.toContain('investment-planning.createPlan');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes iMSys schedule value-chain prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe imsys_schedule_value_chain_readiness fuer iMSys Fahrplan, CLS Fahrplan, Messdaten zu Steuerung, Engpasslogik, Flexibilitaetsnutzung, Netzfahrplan Assessment und Leitwartenuebergabe.',
    });

    expect(result.capability).toBe('imsys_schedule_value_chain_readiness');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'imsys_schedule_value_chain_readiness'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.imsysScheduleValueChainReadinessStatus');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('cls.executeControl');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes CLS digital-twin compliance prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe cls_digital_twin_compliance_gate fuer CLS Schnittstelle, digitaler Zwilling Beschaffung, AVV, NDA, Betriebsvereinbarung, Rollenrechte, Datenfluss, DSFA, BNetzA Nachweis und Security Evidence.',
    });

    expect(result.capability).toBe('cls_digital_twin_compliance_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('cls_digital_twin_compliance_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.clsDigitalTwinComplianceGateStatus');
    expect(actionNames).not.toContain('procurement.approve');
    expect(actionNames).not.toContain('legal.approve');
    expect(actionNames).not.toContain('dsfa.create');
    expect(actionNames).not.toContain('rbac.grant');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('cls.executeControl');
    expect(actionNames).not.toContain('smgw.switch');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes legacy Rundsteuertechnik transition prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe legacy_control_technology_transition fuer Rundsteuertechnik, Gruppensignal, Rueckmeldefaehigkeit, Bestandsanlage, Steuerbarkeitsnachweis, Testbarkeit, Nichtdurchfuehrungsbegruendung und Steuerbox Uebergang.',
    });

    expect(result.capability).toBe('legacy_control_technology_transition');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'legacy_control_technology_transition'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.legacyControlTechnologyTransitionStatus');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('cls.executeControl');
    expect(actionNames).not.toContain('smgw.switch');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Steuerbarkeitscheck submission cockpit prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe das Steuerbarkeitscheck Abgabe-Cockpit fuer Abgabeprojekt, Quellenliste, Datenabgleich, Begruendungskatalog, Assetgruppenstatus, Handover und naechster Zyklus.',
    });

    expect(result.capability).toBe('controllability_submission_cockpit');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'controllability_submission_cockpit'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.controllabilitySubmissionCockpitStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('cls.executeControl');
    expect(actionNames).not.toContain('smgw.switch');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes crisis decision routine prompts to the read-only management evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte erstelle eine Krisenmodus Entscheidungsroutine fuer eine Managemententscheidung: Servicegruppenwirkung, Finanzwirkung, Wissensstand, Trainingsbedarf, Owner, naechstes Entscheidungsgate und blockierte Folgeentscheidung pruefen.',
    });

    expect(result.capability).toBe('crisis_decision_routine');
    expect(result.recommendedCapabilities[0].capability).toBe('crisis_decision_routine');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.crisisDecisionRoutineStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('nova.apply');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes investment committee steering card prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte baue eine Investmittel Gremiensteuerung Karte fuer CAPEX Review: Investmittelposition, Assetbezug, Pruefstatus, Evidenzstatus, Gremienfenster, Owner und blockierte Folgeaktion pruefen.',
    });

    expect(result.capability).toBe('investment_committee_steering_cards');
    expect(result.recommendedCapabilities[0].capability).toBe('investment_committee_steering_cards');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.investmentCommitteeSteeringCardsStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('investment-planning.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('budget.release');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes strategic Flex demand-intake prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte strategische Bedarfsanmeldung Flexibilisierung fuer Fahrplanmanagement pruefen: Risiko des Nicht-Handelns, kaufmaennische Bewertungsfrage, Ressourcenkonflikt, Stop-doing-Option, Owner, next decision gate und blockierte Folgeentscheidung.',
    });

    expect(result.capability).toBe('flex_strategic_demand_intake');
    expect(result.recommendedCapabilities[0].capability).toBe('flex_strategic_demand_intake');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.flexStrategicDemandIntakeStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('nova.createDecision');
    expect(actionNames).not.toContain('nova.apply');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Re4DE variable grid-fee prompts to the Layer-3 value service', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Berechne variable Netzentgelte als Re4DE Layer-3 Service mit Tariff Sheet, TAF-7 Intervallen, Data Product Evidence und §14a Module 3 Kontext.',
    });

    expect(result.capability).toBe('re4de_variable_grid_fee_layer3');
    expect(result.recommendedCapabilities[0].capability).toBe('re4de_variable_grid_fee_layer3');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('re4de-variable-grid-fee.getEvidence');
    expect(actionNames).toContain('re4de-variable-grid-fee.calculate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes battery storage Redispatch Sondergate prompts to the battery gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Batteriespeicher Redispatch Sondergate: MaLo Speicher, MeLo, positive Redispatch, negative Redispatch, Lastaufnahme, Einspeisung, Testabruf, Steuerbarkeitsrichtung und Clearing Speicher.',
    });

    expect(result.capability).toBe('battery_redispatch_special_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('battery_redispatch_special_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('battery-redispatch-special-gate.getStatus');
    expect(actionNames).toContain('battery-redispatch-special-gate.evaluate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Flexibilitaetsdirigent role-model prompts to the read-only evidence path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle ein Flexibilitaetsdirigent Rollenmodell mit RACI, Entscheidungsrechten, Fahrplanmanagement, Steuerbefehl-Grenze, Softwareueberwachung, Niederspannung, Assetmanagement, Regulierungsbewertung und Eskalationspfad.',
    });

    expect(result.capability).toBe('flexibility_conductor_role_model');
    expect(result.recommendedCapabilities[0].capability).toBe('flexibility_conductor_role_model');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('flexibility-conductor-role-model.getStatus');
    expect(actionNames).toContain('flexibility-conductor-role-model.evaluate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Wissenssicherung Governance Gate prompts to the read-only evidence path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Wissenssicherung Governance Gate fuer Rollenwechsel: Hauptordner, Berechtigungsowner, Gastzugriff, Adminrechte, Uebergabedokument, Loeschfrist, Teams, Loop, SharePoint und IT-Abnahme.',
    });

    expect(result.capability).toBe('knowledge_continuity_governance_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'knowledge_continuity_governance_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('knowledge-continuity-governance-gate.getStatus');
    expect(actionNames).toContain('knowledge-continuity-governance-gate.evaluate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes investment maturity off-balance prompts to the read-only gate evidence path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Investitionsreifegrad Off-Balance Gate: externe Finanzierung, Finanzierungszusatzkosten, regulatory return, Asset-Risiko, ISO-Risiko, Prozessqualitaet, Netzspielraum und Entscheidungsforum.',
    });

    expect(result.capability).toBe('investment_maturity_off_balance_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'investment_maturity_off_balance_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('investment-maturity-off-balance-gate.getStatus');
    expect(actionNames).toContain('investment-maturity-off-balance-gate.evaluate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes gas-capacity order revision prompts to the read-only gate evidence path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Gaskapazitaetsbestellung Jahresbestellung: Kaltjahr, Industrie-Rebound, reversible RLM Lasten, Netzkopplungspunkt NKP, Engpasshistorie, Sicherheitsaufschlag, Druckflexibilitaet, Wartungsfenster und Bestellbeschluss.',
    });

    expect(result.capability).toBe('gas_capacity_order_revision_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'gas_capacity_order_revision_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('gas-capacity-order-revision-gate.getStatus');
    expect(actionNames).toContain('gas-capacity-order-revision-gate.evaluate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });
});
