const { ServiceBroker } = require('moleculer');
const CapabilityBrokerService = require('../services/capability-broker.service');
const { CURATED_CAPABILITIES } = require('../src/capability-catalog');

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

  it('routes regulatory risk revenue scenario prompts to the cookbook briefing path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Regulatorikrisiko, Erlöswirkung, Risikospanne, Gegenmaßnahme und Management-Gate als regulatory revenue scenario für den VNB vorbereiten.',
      knownContext: {
        gridOperatorId: 'SNB328',
        referenceDate: '2026-06-27',
        period: '2026',
      },
    });

    expect(result.recommendedCapabilities[0].capability).toBe('regulatory_risk_revenue_scenario');
    expect(result.intent).toBe('cookbook.regulatoryRiskRevenueScenarioBriefing');

    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toEqual(
      expect.arrayContaining([
        'cookbook.get',
        'cookbook.search',
        'regulatorische-entgeltlogik.getActive',
        'eog-calculator.inputStatus',
        'eog-calculator.scenario',
        'finance-agent.analyze',
        'decision-frame.create',
      ])
    );
    expect(actionNames).not.toContain('query.ask');
    expect(actionNames).not.toContain('query.askLearned');
    expect(actionNames).not.toContain('billing.release');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('hitl.create');
    const catalogCapability = CURATED_CAPABILITIES.find(
      (capability) => capability.capability === 'regulatory_risk_revenue_scenario'
    );
    expect(catalogCapability.risksAndNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Hydration Registry remains unchanged'),
        expect.stringContaining('No legal opinion'),
      ])
    );
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

    expect(result.recommendedCapabilities[0].capability).toBe(
      'edm_customer_moveout_billing_evidence'
    );
    expect(result.capability).toBe('edm_customer_moveout_billing_evidence');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes Energy Sharing / Prosumer Advisory dossier to energy_sharing_prosumer_advisory, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin Prosumer und moechte mich unabhaengig informieren: Kann ich Strom aus meiner PV-Anlage an meinen Nachbarn verkaufen? Welche Voraussetzungen gelten fuer Energy Sharing und wie muesste ich dabei vorgehen? Bitte erstelle ein Cernion Answer Dossier und trenne Energy Sharing, Mieterstrom, Direktlieferung/Nachbarschaftsverkauf und Eigenversorgung. Bitte nenne benoetigte Evidence, Marktrollen, Messkonzept, Bilanzierung/Allokation, Vertrag/Abrechnung und offene Folgefragen. Keine verbindliche Rechtsberatung und kein automatisches NAP-Wallet-Onboarding.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('energy_sharing_prosumer_advisory');
    expect(result.capability).toBe('energy_sharing_prosumer_advisory');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes Redispatch/RCS special-case governance dossier to redispatch_rcs_special_case_governance, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin in der Redispatch-Koordination eines Verteilnetzbetreibers. Bitte erstelle ein Cernion Answer Dossier fuer folgenden Sonderfall: Eine steuerbare Erzeugungsanlage wurde wegen lokaler Netzengpasslage abgeregelt, aber die Stammdatenlage ist unsicher und es ist unklar, ob der Fall in den normalen Redispatch-2.0-Prozess, einen RCS-Sonderfall oder eine Expost-/Settlement-Nachklaerung gehoert. Bitte trenne operative Massnahme, Datenqualitaet, Expost-Nachweis, Settlement-Risiko und Reporting-Governance. Nenne, welche Evidence aus Redispatch-Assetregister, Data Governance, Special-Case-Gate, RCS-Regelkatalog, Simulation und Settlement-Sandbox erforderlich waere. Keine Verguetungszusage ohne Expost-Evidence.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe(
      'redispatch_rcs_special_case_governance'
    );
    expect(result.capability).toBe('redispatch_rcs_special_case_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes Datasource Registry / classification governance dossier to datasource_registry_classification_governance, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Datenmanagement eines Stadtwerks. Wir wollen einen neuen Datenquellenbestand fuer Lastgaenge, MSCONS-Importe und Netzplanungsdaten in Cernion aufnehmen. Bitte erstelle ein Answer Dossier: Welche Evidence brauchen wir fuer Datasource Registry, Klassifikation, Cache-Status, Watcher/Monitoring und Data-Governance, bevor die Datenquelle fuer Netzplanung oder Abrechnung genutzt werden darf? Bitte trenne bekannte Angaben, Missing Evidence, technische Pruefschritte und Freigabepunkte. Keine produktive Ingest- oder Schreibaktion ausloesen.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe(
      'datasource_registry_classification_governance'
    );
    expect(result.capability).toBe('datasource_registry_classification_governance');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('routes HITL / notification / persona-inbox evidence request dossier to hitl_role_based_evidence_request, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Kundenservice eines Stadtwerks und habe ein Dossier mit fehlender Evidence: Assetmanagement muss den Netzasset-Bezug bestaetigen, Netzplanung muss Kapazitaet pruefen und EDM muss den plausibilisierten Zaehlerstand nachliefern. Bitte erstelle ein Cernion Answer Dossier, das die Human-in-the-Loop-Nachforderungen rollenbasiert vorbereitet: Welche Persona/Rolle bekommt welche Evidence-Anforderung, welche Nachricht darf intern vorbereitet werden, was darf nicht extern gesendet werden, und wie soll die Ursprungssession informiert werden, sobald Evidence nachgeliefert wird? Keine externe Nachricht oder Webhook-Ausloesung ohne Freigabe.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('hitl_role_based_evidence_request');
    expect(result.capability).toBe('hitl_role_based_evidence_request');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  // ── DSO Residual Load / Flexibility Window — issue #231 ──

  it('routes Turn 1 DSO residual-load dossier (hyphenated form + Evidence keyword) to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Netzbetrieb eines Stadtwerks und brauche ein Answer Dossier fuer morgen: Wie sieht die Residual-Load-Lage fuer unser DSO-Gebiet aus, welche Flexibilitaetsfenster sind aus CO2/GruenstromIndex, Day-Ahead-Preis, Forecast und ggf. German-Grid-/Netztransparenzdaten ableitbar? Bitte nutze wenn moeglich residual-load, forecast, german-grid und energy-market Evidence. Standort: 74889 Sinsheim. Keine Steueranweisung und keine MW-Zusage ohne belastbare Evidence.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
  });

  it('routes Turn 2 Beschaffungsplanung Residuallast/CO2 dossier to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin in der Beschaffungsplanung eines Stadtwerks. Bitte erstelle ein Answer Dossier fuer morgen: Wie ist die Residuallast einzuschaetzen, welche CO2-/GruenstromIndex-Signale und Day-Ahead-Preise sprechen fuer oder gegen Lastverschiebung, und welche Evidence fehlt fuer ein belastbares Flexibilitaetsfenster? Bitte nutze residual-load und energy-market Evidence, wenn verfuegbar. Keine Steueranweisung und keine MW-Zusage.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
  });

  it('routes Turn 3 English DSO residual load forecast dossier to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'As a DSO operations analyst, I need an Answer Dossier for a residual load forecast and flexibility window assessment for the next 24 hours. Please consider residual-load, forecast, CO2 intensity and day-ahead price evidence. Separate validated evidence, missing evidence and operational constraints. Do not make switching instructions or MW commitments.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
  });

  it('routes Turn 4 VNB Flexibilitaetsfenster (no postal code, not grid-connection) to residual_load_forecast_for_dso, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin beim VNB fuer Flexibilitaetsmanagement zustaendig. Bitte erstelle ein Dossier fuer ein Flexibilitaetsfenster morgen frueh: Residuallast, Forecast, GruenstromIndex/CO2 und Day-Ahead-Preis sollen gemeinsam bewertet werden. Es geht nicht um einen Netzanschlussantrag und nicht um Assetvalidierung, sondern um eine vorsichtige Lageeinschaetzung fuer Lastverschiebung.',
    });

    expect(result.capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).toBe('residual_load_forecast_for_dso');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_grid_connection_decision_governance'
    );
  });

  // ── Regression: Existing VDMI prompts must still route correctly after domain fixes ──

  it('still routes formal §17 EnWG grid-connection decision prompt to VDMI decision governance after non-VDMI fixes', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage oder Kapazitaetszusage geben?',
    });

    expect(result.recommendedCapabilities[0].capability).toBe(
      'vdmi_grid_connection_decision_governance'
    );
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
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('edm-messkonzept.list');
  });

  it('forecast-flex-bess: BESS Flex-Prognose Grid-Operations Evidence dossier routes to flex_forecast_bess_grid_operations_advisory, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Grid-Operations-Team eines Verteilnetzbetreibers. Bitte erstelle ein Answer Dossier fuer die BESS-Flex-Prognose fuer morgen: Welche Forecast-Evidence liegt vor, welche Flex-Kapazitaet ist verfuegbar, und welche Nachweise fehlen fuer eine belastbare Prognose? Keine Schaltanweisung ohne Evidence.',
    });

    expect(result.capability).toBe('flex_forecast_bess_grid_operations_advisory');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'flex_forecast_bess_grid_operations_advisory'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('finance-nkp-regulatory: NKP/CAPEX Reinvestitionsplanung Governance dossier routes to finance_nkp_capex_reinvest_governance, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Regulierungsmanagement eines Verteilnetzbetreibers. Bitte erstelle ein Answer Dossier fuer die NKP-Kalkulation und den CAPEX-Reinvestitionsplan: Welche regulatorischen Anforderungen gelten, welche Nachweise fehlen fuer die Genehmigung, und welche Governance-Schritte sind erforderlich? Bitte trenne vorhandene Evidence, Missing Evidence und regulatorische Pruefpflichten.',
    });

    expect(result.capability).toBe('finance_nkp_capex_reinvest_governance');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'finance_nkp_capex_reinvest_governance'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('bilanzkreis-slp-edm: Bilanzkreis/SLP Fahrplanabgleich Evidence dossier routes to bilanzkreis_slp_edm_operations, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Bilanzkreis-Management eines Stadtwerks. Bitte erstelle ein Answer Dossier fuer den Fahrplanabgleich unserer SLP-Kunden mit den EDM-Daten: Welche Abweichungen liegen vor, welche Evidence fehlt fuer den Bilanzkreisausgleich, und welche Freigabeschritte sind erforderlich? Kein produktiver Eingriff ohne Evidenz.',
    });

    expect(result.capability).toBe('bilanzkreis_slp_edm_operations');
    expect(result.recommendedCapabilities[0].capability).toBe('bilanzkreis_slp_edm_operations');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('bilanzkreis.list');
  });

  it('connection-rejection-fnav-14a: §14a EnWG Anschlussablehnung Evidence dossier routes to connection_rejection_fnav_14a_evidence, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Unser Stadtwerk hat eine Anschlussablehnung fuer eine steuerbare Verbrauchseinrichtung nach §14a EnWG erhalten. Bitte erstelle ein Answer Dossier: Welche Evidence liegt vor, welche Nachweise fehlen fuer den Widerspruch, und welche technischen Pruefschritte sind erforderlich? Bitte trenne Known Evidence, Missing Evidence und moegliche Widerspruchsgruende.',
    });

    expect(result.capability).toBe('connection_rejection_fnav_14a_evidence');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'connection_rejection_fnav_14a_evidence'
    );
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('gasnetz-waermeplanung: Gasnetz kommunale Waermeplanung Assessment dossier routes to gasnetz_waermeplanung_assessment, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin in der Netzplanung eines Gasnetzbetreibers. Im Rahmen der kommunalen Wärmeplanung muessen wir Gasnetz-Abschnitte fuer die Transformation evaluieren. Bitte erstelle ein Answer Dossier: Welche Evidence liegt zur Leitungslage vor, welche Nachweise fehlen fuer die Umplanung, und welche Governance-Schritte sind erforderlich?',
    });

    expect(result.capability).toBe('gasnetz_waermeplanung_assessment');
    expect(result.recommendedCapabilities[0].capability).toBe('gasnetz_waermeplanung_assessment');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
    expect(result.recommendedPlan[0].action).toBe('interface-placeholder.markGap');
  });

  it('eeg-clawback-ewk-monitoring: EEG-Clawback EWK-Monitoring Evidence dossier routes to eeg_clawback_ewk_monitoring, not VDMI', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Ich bin im Regulierungsmanagement eines Verteilnetzbetreibers. Bitte erstelle ein Answer Dossier fuer das EEG-Clawback-Monitoring: Welche EWK-Bewertungen und Evidence liegen vor, welche Nachweise fuer eine moegliche EEG-Rueckforderung fehlen, und welche Governance-Schritte sind erforderlich?',
    });

    expect(result.capability).toBe('eeg_clawback_ewk_monitoring');
    expect(result.recommendedCapabilities[0].capability).toBe('eeg_clawback_ewk_monitoring');
    expect(result.recommendedCapabilities[0].capability).not.toBe(
      'vdmi_asset_validation_governance'
    );
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
    expect(result.recommendedCapabilities[0].capability).toBe('redispatch_call_data_quality_gate');
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
    expect(result.recommendedCapabilities[0].capability).toBe('controllability_asset_handover');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.controllabilityAssetHandoverStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Netzsignal Delta-Gating prompts to the read-only evidence classifier', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Klassifiziere Netzsignal Delta-Gating: bekannter Kontext, Freshness Proof, Entscheidungsdelta, neuer Blocker, Owner, Frist, Materialitaet und naechster Evidenzpunkt.',
    });

    expect(result.capability).toBe('netzsignal_delta_gating');
    expect(result.recommendedCapabilities[0].capability).toBe('netzsignal_delta_gating');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.netzsignalDeltaGatingStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('ticket.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes steering artifact acceptance gate prompts to the read-only gate view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Akzeptanz-Gate und Pflege-Gate fuer ein Steuerungsartefakt mit Rollout-Freigabe, Nutzungsnachweis, Pflegeowner, Stellvertretung und Eskalationskriterium.',
    });

    expect(result.capability).toBe('steering_artifact_acceptance_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('steering_artifact_acceptance_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.steeringArtifactAcceptanceGateStatus');
    expect(actionNames).not.toContain('budibase.table.write');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes communication-break process-risk prompts to the read-only gate view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Modelliere Kommunikationsbruch als Prozessrisiko mit Rueckfragefenster, Informationspflicht, fachlicher Begleitung, blockierter Entscheidung, naechstem Evidenzpunkt und Owner.',
    });

    expect(result.capability).toBe('communication_break_process_risk');
    expect(result.recommendedCapabilities[0].capability).toBe('communication_break_process_risk');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.communicationBreakProcessRiskStatus');
    expect(actionNames).not.toContain('email.ingest');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes No-Regret measure proof prompts to the read-only proof gate view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe No-Regret Massnahme mit Szenario-Beweis, Budgetanker, regulatorischer Anschlussfaehigkeit, Einspruchsfenster, Management-Gate und Decision Owner fuer die Transformationsmassnahme.',
    });

    expect(result.capability).toBe('no_regret_measure_proof_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('no_regret_measure_proof_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.noRegretMeasureProofGateStatus');
    expect(actionNames).not.toContain('budget.reserve');
    expect(actionNames).not.toContain('investment.approve');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Anschlusskapazitaet evidence queue prompts to the read-only review view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle Anschlusskapazitaet Evidenzqueue fuer Netzverknuepfungspunkt NVP-West mit Kapazitaetsannahme, Netzrestriktion, fNAV Evidenz und Anschlussentscheidung Readiness.',
    });

    expect(result.capability).toBe('anschlusskapazitaet_evidence_queue');
    expect(result.recommendedCapabilities[0].capability).toBe('anschlusskapazitaet_evidence_queue');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.anschlusskapazitaetEvidenceQueueStatus');
    expect(actionNames).not.toContain('grid-connection.reserveCapacity');
    expect(actionNames).not.toContain('grid-connection.approve');
    expect(actionNames).not.toContain('grid-connection.reject');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Layer-0 audit drilldown prompts to the read-only validation note', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle layer0_audit_drilldown_note als Layer-0 Audit Drilldown Generator Validierungsnotiz fuer KPI Auffaelligkeit mit Peer-Abweichung und naechstem 90-Tage-Schritt.',
    });

    expect(result.capability).toBe('layer0_audit_drilldown_note');
    expect(result.recommendedCapabilities[0].capability).toBe('layer0_audit_drilldown_note');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.layer0AuditDrilldownNoteStatus');
    expect(actionNames).not.toContain('audit-queue.create');
    expect(actionNames).not.toContain('benchmark.connector.fetch');
    expect(actionNames).not.toContain('report.pdf.generate');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Stadtwerk Mauer sandbox runtime prompts to the read-only status view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Stadtwerk Mauer Sandbox Runtime fuer tenant reset cleanup readiness demo event ingestion status und reset delete proof.',
    });

    expect(result.capability).toBe('stadtwerk_mauer_sandbox_runtime');
    expect(result.recommendedCapabilities[0].capability).toBe('stadtwerk_mauer_sandbox_runtime');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.stadtwerkMauerSandboxRuntimeStatus');
    expect(actionNames).not.toContain('stadtwerk-mauer-sandbox-runtime.ingestEvent');
    expect(actionNames).not.toContain('stadtwerk-mauer-sandbox-runtime.reset');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Stadtwerk Mauer external stub prompts to the read-only status view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Stadtwerk Mauer externe Schnittstellen Stubs fuer MaKo Lieferantenwechsel, EDM Plausibilitaet, Kundenkommunikation und Control Boundary Stub Transkripte.',
    });

    expect(result.capability).toBe('stadtwerk_mauer_external_interface_stubs');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'stadtwerk_mauer_external_interface_stubs'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.stadtwerkMauerExternalInterfaceStubsStatus');
    expect(actionNames).not.toContain('stadtwerk-mauer-external-interface-stubs.callStub');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Stadtwerk Mauer E2E demo prompts to the read-only status view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Stadtwerk Mauer E2E Prozessdemo fuer PV Anmeldung durch Elektriker, fehlende NAP Referenz, Prozessspur, Stub Transcript, Dossier Growth und Reset Proof.',
    });

    expect(result.capability).toBe('stadtwerk_mauer_e2e_process_demo');
    expect(result.recommendedCapabilities[0].capability).toBe('stadtwerk_mauer_e2e_process_demo');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.stadtwerkMauerE2eProcessDemoStatus');
    expect(actionNames).not.toContain('stadtwerk-mauer-e2e-process-demo.runDemo');
    expect(actionNames).not.toContain('stadtwerk-mauer-external-interface-stubs.callStub');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Stadtwerk Mauer blended MaStR overlay prompts to the read-only status view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Stadtwerk Mauer Blended MaStR Data Overlay: reale MaStR Daten Mauer 1:1, Syna als Realwelt-Provenienz, virtuelles Stadtwerk Mauer als Netzbetreiber Overlay.',
    });

    expect(result.capability).toBe('stadtwerk_mauer_mastr_data_overlay');
    expect(result.recommendedCapabilities[0].capability).toBe('stadtwerk_mauer_mastr_data_overlay');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.stadtwerkMauerMastrDataOverlayStatus');
    expect(actionNames).not.toContain('stadtwerk-mauer-e2e-process-demo.runDemo');
    expect(actionNames).not.toContain('stadtwerk-mauer-external-interface-stubs.callStub');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('mastr.write');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes legal clarification operating-model prompts to the read-only preparation view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle ein operatives Steuerungsmodell fuer Rechtsklaerung Kapazitaetsfrage mit no-regret Datenbedarf, roter Linie und Entscheidung nach Rechtsantwort.',
    });

    expect(result.capability).toBe('legal_clarification_operating_model');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'legal_clarification_operating_model'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.legalClarificationOperatingModelStatus');
    expect(actionNames).not.toContain('legal.approve');
    expect(actionNames).not.toContain('hitl.create');
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

  it('routes DR readiness prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Disaster Recovery Readiness mit Backup Evidence, Restore Drill, RTO, RPO, Snapshot Manifest und Multi-Tenant Restore Nachweis.',
    });

    expect(result.capability).toBe('dr_readiness_evidence_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('dr_readiness_evidence_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.drReadinessEvidenceStatus');
    expect(actionNames).not.toContain('backup.restore');
    expect(actionNames).not.toContain('tenant.restore');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes fNAV fast-track contract-gate prompts to the read-only gate projection', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe fnav_fast_track_contract_gate fuer ein fNAV Fast Track Vertragsgate beim Rechenzentrum mit Netzsignal Vorrang, Fahrplanpflicht, Messdaten, Steuerdaten, Vermarktungsgrenze, Vertragsstatus, Rechtsstatus und Eskalationslogik.',
    });

    expect(result.capability).toBe('fnav_fast_track_contract_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('fnav_fast_track_contract_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.fnavFastTrackContractGateStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes cross-channel VNB signal queue prompts to the read-only evidence projection', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Cross Channel VNB Signal Queue fuer Mail Hinweis, Chat Hinweis und Portal Hinweis mit Owner Frist, Evidenzstatus, Netzanschluss Blocker, Redispatch Hinweis, Zielnetzplanung Signal, IT Freigabe, Berechtigung und Schulung.',
    });

    expect(result.capability).toBe('cross_channel_vnb_signal_queue');
    expect(result.recommendedCapabilities[0].capability).toBe('cross_channel_vnb_signal_queue');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.crossChannelVnbSignalQueueStatus');
    expect(actionNames).not.toContain('mail.connector.ingest');
    expect(actionNames).not.toContain('persona-inbox.enqueue');
    expect(actionNames).not.toContain('notification.dispatchInternal');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes VNB delta signal classifier prompts to the read-only advisory classifier', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe VNB Delta Signal Classifier fuer EVU Fuehrungssignal, Entscheidungssignal, Frist, Owner, Anschluss, Kapazitaet, Regulierung, Messstellen, Flexibilitaet, Assetthemen, blockierte Entscheidung und naechster Evidenzpunkt.',
    });

    expect(result.capability).toBe('vnb_delta_signal_classifier');
    expect(result.recommendedCapabilities[0].capability).toBe('vnb_delta_signal_classifier');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.vnbDeltaSignalClassifierStatus');
    expect(actionNames).not.toContain('mail.connector.ingest');
    expect(actionNames).not.toContain('outlook.connector.read');
    expect(actionNames).not.toContain('teams.connector.read');
    expect(actionNames).not.toContain('calendar.connector.read');
    expect(actionNames).not.toContain('task.connector.read');
    expect(actionNames).not.toContain('ticket.create');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes evidence freshness guard prompts to the read-only metadata classifier', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe evidence_freshness_guard Evidence Freshness Guard fuer VNB Signal Freshness, source timestamp, current snapshot hash, known snapshot hash, stale context anchor, known anchor repeat, new delta, freshness delta und non escalation reason.',
    });

    expect(result.capability).toBe('evidence_freshness_guard');
    expect(result.recommendedCapabilities[0].capability).toBe('evidence_freshness_guard');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.evidenceFreshnessGuardStatus');
    expect(actionNames).not.toContain('mail.connector.ingest');
    expect(actionNames).not.toContain('teams.connector.read');
    expect(actionNames).not.toContain('monitoring.connector.read');
    expect(actionNames).not.toContain('acf.card.create');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes asset valuation transformation gate prompts to the read-only evidence projection', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Asset Valuation Transformation Gate fuer Buchwert, Restwert, Assetzustand, Stilllegung, Umwidmung, H2 Option, Waermebezug, Vertragsrisiko, regulatorische Unsicherheit und Datenqualitaet.',
    });

    expect(result.capability).toBe('asset_valuation_transformation_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'asset_valuation_transformation_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.assetValuationTransformationGateStatus');
    expect(actionNames).not.toContain('assets.applyOverride');
    expect(actionNames).not.toContain('investment.approve');
    expect(actionNames).not.toContain('asset-lifecycle.decommission');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes gas capacity booking review prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Gas-Kapazitaetsbestellung als Capacity Booking Review Gate mit Kaltjahr, RLM-Rebound, Engpasshistorie, VDMI-Abnahme, Decision Frame und kaufmaennischem Review.',
    });

    expect(result.capability).toBe('gas_capacity_booking_review_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('gas_capacity_booking_review_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gasCapacityBookingReviewGateStatus');
    expect(actionNames).not.toContain('gas-capacity-booking.submit');
    expect(actionNames).not.toContain('upstream-network-operator.submitBooking');
    expect(actionNames).not.toContain('vdmi.taskMutate');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes gas network decision-chain prompts to the read-only evidence projection', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Gasnetz Entscheidungskette fuer Kapazitaet und Fotojahr mit Stilllegungspfad, KANU EOG Evidenz, Buchwert, Owner und blockierter Folgeentscheidung.',
    });

    expect(result.capability).toBe('gas_network_decision_chain');
    expect(result.recommendedCapabilities[0].capability).toBe('gas_network_decision_chain');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gasNetworkDecisionChainStatus');
    expect(actionNames).not.toContain('gas-capacity-booking.submit');
    expect(actionNames).not.toContain('gas-transformation.executeDecommissioning');
    expect(actionNames).not.toContain('assets.applyOverride');
    expect(actionNames).not.toContain('investment.approve');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('keeps gas booking review wording on #260 route instead of gas network decision chain', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Gas-Kapazitaetsbestellung Review Gate mit Kaltjahr, RLM-Rebound, Engpasshistorie und VDMI-Abnahme.',
    });

    expect(result.capability).toBe('gas_capacity_booking_review_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gasCapacityBookingReviewGateStatus');
    expect(actionNames).not.toContain('dashboard-api.gasNetworkDecisionChainStatus');
  });

  it('routes water-pricing net-investment alignment prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe kalkulatorischer Wasserpreis Netzinvestition mit Pachtnetz Anlagenbuchhaltung Regulierungswirkung Gremienvorlage und Alignment Entscheidung.',
    });

    expect(result.capability).toBe('water_pricing_net_investment_alignment_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'water_pricing_net_investment_alignment_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.waterPricingNetInvestmentAlignmentStatus');
    expect(actionNames).not.toContain('water-pricing.calculate');
    expect(actionNames).not.toContain('asset-accounting.import');
    expect(actionNames).not.toContain('billing.release');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('tariff.mutate');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('keeps generic waterfall wording away from water-pricing alignment', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe investment waterfall governance fuer Budgetfreigabe, Ueberhang, Forecast und Gremienreife.',
    });

    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).not.toContain('dashboard-api.waterPricingNetInvestmentAlignmentStatus');
  });

  it('routes Areal network-integration offer prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Areal Netzeinbindung Angebotsgate mit Anschlusskapazitaet Zielnetzpfad Investitionsbedarf regulatorische Wirkung Angebotsannahmen Owner und Entscheidungstermin.',
    });

    expect(result.capability).toBe('areal_network_integration_offer_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'areal_network_integration_offer_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.arealNetworkIntegrationOfferGateStatus');
    expect(actionNames).not.toContain('offer.calculate');
    expect(actionNames).not.toContain('contract.accept');
    expect(actionNames).not.toContain('grid-capacity.reserve');
    expect(actionNames).not.toContain('investment.approve');
    expect(actionNames).not.toContain('billing.release');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('tariff.mutate');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes transformation financing scenario prompts to the read-only scenario view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Transformationsfinanzierung Szenario Sicht mit Gasnetzabwertung Rueckbaukosten Waermenetzausbau H2 Option Kapitalumschichtung kommunale Entnahmen Liquiditaet Stressszenario und Gremienreife.',
    });

    expect(result.capability).toBe('transformation_financing_scenario_view');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'transformation_financing_scenario_view'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.transformationFinancingScenarioViewStatus');
    expect(actionNames).not.toContain('finance.createBooking');
    expect(actionNames).not.toContain('treasury.executeTransfer');
    expect(actionNames).not.toContain('gas-assets.applyDecommissioning');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('billing.prepareInvoice');
    expect(actionNames).not.toContain('tariff.mutate');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes investment owner/deadline/budget prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Investitionsprozess Owner Frist Budget Gate fuer Massnahmenfreigabe, Budgetwirkung, blockierte Folgeentscheidung und naechste Eskalationsstufe.',
    });

    expect(result.capability).toBe('investment_owner_deadline_budget_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'investment_owner_deadline_budget_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.investmentOwnerDeadlineBudgetGateStatus');
    expect(actionNames).not.toContain('investment.approve');
    expect(actionNames).not.toContain('budget.release');
    expect(actionNames).not.toContain('finance.createBooking');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes No-Regret measure definition prompts to the read-only definition gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe No-Regret Massnahmen Definitionsgate fuer Transformationsprogramm Szenariowirkung Budgetwirkung regulatorische Anschlussfaehigkeit Priorisierungsrecht Datenqualitaet Kommunikationsregel und Review Gate.',
    });

    expect(result.capability).toBe('no_regret_measure_definition_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('no_regret_measure_definition_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.noRegretMeasureDefinitionGateStatus');
    expect(actionNames).not.toContain('measure.approve');
    expect(actionNames).not.toContain('budget.release');
    expect(actionNames).not.toContain('finance.createBooking');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Gasnetz transformation asset cockpit prompts to the read-only asset view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Gasnetztransformation VDMI Asset Cockpit fuer Gaszielnetz H2 Weiterverwendung Gasnetz Stilllegung Rueckbaukosten Cashflow Gasnetz Waermenetz Abhaengigkeit Stromnetz Abhaengigkeit und Gremiengate.',
    });

    expect(result.capability).toBe('gas_grid_transformation_asset_cockpit');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'gas_grid_transformation_asset_cockpit'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gasGridTransformationAssetCockpitStatus');
    expect(actionNames).not.toContain('gas-assets.applyDecommissioning');
    expect(actionNames).not.toContain('gas-grid.optimizeTargetNetwork');
    expect(actionNames).not.toContain('h2-feasibility.execute');
    expect(actionNames).not.toContain('investment.approve');
    expect(actionNames).not.toContain('finance.createBooking');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('billing.prepareInvoice');
    expect(actionNames).not.toContain('tariff.mutate');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes leadership delta cockpit prompts to the read-only dashboard view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'leadership_delta_cockpit Fuehrungscockpit Delta Steuerung fuer Sonderthemen mit Owner Frist Evidenzstatus blockierte Entscheidung Eskalation und Next Lever pruefen.',
    });

    expect(result.capability).toBe('leadership_delta_cockpit');
    expect(result.recommendedCapabilities[0].capability).toBe('leadership_delta_cockpit');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.leadershipDeltaCockpitStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('hitl.escalate');
    expect(actionNames).not.toContain('nova.apply');
    expect(actionNames).not.toContain('nova.approveDecision');
    expect(actionNames).not.toContain('vdmi.taskMutate');
    expect(actionNames).not.toContain('ms365.sync');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('billing.prepareInvoice');
    expect(actionNames).not.toContain('tariff.mutate');
    expect(actionNames).not.toContain('mako.dispatch');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes live update contract prompts to the read-only stream contract view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Live Update Stream Contract fuer UI Live State mit SSE EventSource WebSocket Polling Fallback Heartbeat Resume und Last-Event-ID readiness.',
    });

    expect(result.capability).toBe('live_update_stream_contract_status');
    expect(result.recommendedCapabilities[0].capability).toBe('live_update_stream_contract_status');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.liveUpdateStreamContractStatus');
    expect(actionNames).not.toContain('sse.openConnection');
    expect(actionNames).not.toContain('websocket.upgrade');
    expect(actionNames).not.toContain('stream.subscribe');
    expect(actionNames).not.toContain('event-emitter.emit');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('nova.apply');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes SMGW connector readiness prompts to the read-only readiness view', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe SMGW Connector Readiness fuer §14a BSI TR-03109 NES2 EEBUS TAF-7 Integration Scope Adapter Class Auth Boundary Audit Prerequisite und Go-No-Go Evidenz.',
    });

    expect(result.capability).toBe('smgw_connector_readiness_status');
    expect(result.recommendedCapabilities[0].capability).toBe('smgw_connector_readiness_status');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.smgwConnectorReadinessStatus');
    expect(actionNames).not.toContain('smgw.register');
    expect(actionNames).not.toContain('smgw.control');
    expect(actionNames).not.toContain('smgw.switch');
    expect(actionNames).not.toContain('taf7.dispatch');
    expect(actionNames).not.toContain('mqtt.publish');
    expect(actionNames).not.toContain('eebus.bridge');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('keeps target-grid transformation wording away from the Areal offer gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Netzanschlusspunkt Transformations-Gate mit division transformationOption dataQualityStatus investmentPath decommissionPath owner und nextAction.',
    });

    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).not.toContain('dashboard-api.arealNetworkIntegrationOfferGateStatus');
  });

  it('routes special grid usage prompts to the read-only impact map', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe besondere Netznutzung Paragraf 19 StromNEV mit Frist, Formular, Mengenbasis, Rueckverguetung, EOG Wirkung und Abrechnungswirkung.',
    });

    expect(result.capability).toBe('special_grid_usage_impact_map');
    expect(result.recommendedCapabilities[0].capability).toBe('special_grid_usage_impact_map');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.specialGridUsageImpactMapStatus');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('tariff.mutate');
    expect(actionNames).not.toContain('customer-service.send');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes liquidity planning governance prompts to the read-only evidence module', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Liquiditaetsplanung Governance mit Cash Planning, Cash Pool, Zinsplanung, SAP Sachkonto, TMS Darlehen, Umsatzsteuerlogik, Plausibilitaetscheck, Szenarioannahme und Korrekturworkflow.',
    });

    expect(result.capability).toBe('liquidity_planning_governance_module');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'liquidity_planning_governance_module'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.liquidityPlanningGovernanceStatus');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('payment.execute');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Energy-Sharing simulation prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Energy Sharing Simulation als Lernpilot und abrechnungsnah mit iMSys-Reife, MaLo Status, Bilanzkreislogik, A96 readiness, Teilnehmerdaten und Marktrollenrisiko.',
    });

    expect(result.capability).toBe('energy_sharing_simulation_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('energy_sharing_simulation_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.energySharingSimulationGateStatus');
    expect(actionNames).not.toContain('energy-sharing-allocation.allocate');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('billing.release');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes §42c cutover readiness prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe §42c Cutover Readiness fuer Energieteilen mit A96 Defaults, Spec Freeze, Pilot Tenant Hoeheinoed, Settlement Readiness Haertetest, Allokations Lasttest, Runbook, Compliance Sign-Off und Rollback DR Readiness.',
    });

    expect(result.capability).toBe('energy_sharing_42c_cutover_readiness');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'energy_sharing_42c_cutover_readiness'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.energySharing42cCutoverReadinessStatus');
    expect(actionNames).not.toContain('tenant.migrate');
    expect(actionNames).not.toContain('energy-sharing-allocation.allocate');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('billing.release');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('rollback.execute');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes EVU API migration diagnostics prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe EVU API Migration Diagnostics fuer Schnittstellenmigration mit OAuth Scope, Request Validation Error, Response Code und Endpoint /api/v2/malo/patch.',
    });

    expect(result.capability).toBe('evu_api_migration_diagnostics');
    expect(result.recommendedCapabilities[0].capability).toBe('evu_api_migration_diagnostics');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.evuApiMigrationDiagnosticsStatus');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('oauth.authorize');
    expect(actionNames).not.toContain('json-patch.apply');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('billing.release');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes NOVA decision lifecycle readiness prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe NOVA TRL-7 Production Readiness fuer Decision Lifecycle, Decision Source Catalogue, HITL Bridge Policy, Replay Audit Readiness und tenant-isolierte SSE Evidence.',
    });

    expect(result.capability).toBe('nova_decision_lifecycle_readiness');
    expect(result.recommendedCapabilities[0].capability).toBe('nova_decision_lifecycle_readiness');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.novaDecisionLifecycleReadinessStatus');
    expect(actionNames).not.toContain('nova.decisions.create');
    expect(actionNames).not.toContain('nova.decisions.transition');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('webhook.emit');
    expect(actionNames).not.toContain('nova.sse.emit');
    expect(actionNames).not.toContain('assets.applyOverride');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes investment two-track control prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Investitionsprozess Zwei Spuren fuer Budgetabgabe, Investitionsabgabe, Abgabesicherheit, Investdaten Datenqualitaet, ISO 55001 Zielbild, Freigabelogik und Vorstandsformat.',
    });

    expect(result.capability).toBe('investment_two_track_control');
    expect(result.recommendedCapabilities[0].capability).toBe('investment_two_track_control');
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
    expect(result.recommendedCapabilities[0].capability).toBe('sap_budget_psp_gate');
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
    expect(result.recommendedCapabilities[0].capability).toBe('energy_tax_information_package');
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
    expect(result.recommendedCapabilities[0].capability).toBe('investment_risk_translation_status');
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
    expect(result.recommendedCapabilities[0].capability).toBe('budget_waterfall_governance');
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
    expect(result.recommendedCapabilities[0].capability).toBe('gas_decommissioning_roadmap_status');
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
    expect(result.recommendedCapabilities[0].capability).toBe('jour_fixe_decision_closure_tracker');
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
    expect(result.recommendedCapabilities[0].capability).toBe('off_balancing_metering_pruefmatrix');
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
    expect(result.recommendedCapabilities[0].capability).toBe('controllability_submission_cockpit');
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
    expect(result.recommendedCapabilities[0].capability).toBe(
      'investment_committee_steering_cards'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.investmentCommitteeSteeringCardsStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('investment-planning.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('budget.release');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes investment data review queue prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Investdaten Pruefqueue Assetmanagement fuer Datenpaket und CAPEX Priorisierung pruefen: Datenqualitaet, Engpassbezug, Gremienfenster, Owner und blockierte Folgeentscheidung.',
    });

    expect(result.capability).toBe('investment_data_review_queue');
    expect(result.recommendedCapabilities[0].capability).toBe('investment_data_review_queue');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.investmentDataReviewQueueStatus');
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

  it('routes gas infrastructure risk governance prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Gas Infrastruktur Risiko Governance fuer Hochdruckleitung und Netzkopplung pruefen: Risikoregister, Monitoring, Nicht-Aufnahme, formale Risikoaufnahme, Schwellenwert, Eintrittswahrscheinlichkeit, Kritikalitaet, Owner und Entscheidungsfenster.',
    });

    expect(result.capability).toBe('gas_infrastructure_risk_governance');
    expect(result.recommendedCapabilities[0].capability).toBe('gas_infrastructure_risk_governance');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gasInfrastructureRiskGovernanceStatus');
    expect(actionNames).not.toContain('gas-risk-register.create');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes metering rollout process-indicator prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Sparten Zaehlkennzahlen Prozessindikator fuer Messstellenbetrieb und Zaehlwechsel-Rollout pruefen: Soll-Ist, Rueckstand, Datenqualitaet, Dienstleisterlast, CAPEX/OPEX, Owner und next control step.',
    });

    expect(result.capability).toBe('metering_rollout_process_indicator');
    expect(result.recommendedCapabilities[0].capability).toBe('metering_rollout_process_indicator');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.meteringRolloutProcessIndicatorStatus');
    expect(actionNames).not.toContain('datasource-registry.refresh');
    expect(actionNames).not.toContain('edm.importTimeseries');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes heat transformation line-asset model prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Waermetransformation Linienasset Modell pruefen: Linienasset ID segment-174, Geometrie-Referenz gis:poly-line-174, connectedPointAssetIds point-asset-1,point-asset-2, netzberechnung calc:hydraulic-174, datenqualitaet reviewed, transformationStatus repurpose, futureOption district_heating_network, investmentNeed 1500000, owner Assetmanagement Waerme und next decision Waermeplanung-Ausschuss-2026.',
    });

    expect(result.capability).toBe('heat_transformation_line_asset_model');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'heat_transformation_line_asset_model'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.heatTransformationLineAssetModelStatus');
    expect(actionNames).not.toContain('znp.createProject');
    expect(actionNames).not.toContain('znp.addLayer0');
    expect(actionNames).not.toContain('znp.addAssumption');
    expect(actionNames).not.toContain('assets.mutate');
    expect(actionNames).not.toContain('datapoint.mutate');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('investment-planning.createPlan');
    expect(actionNames).not.toContain('device-control.execute');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes to ki_floorwalker_governance when KI floorwalker or governance is requested', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte KI Floorwalker Governance fuer Use Case uc-165 und Process Owner Netzvertrieb pruefen: Use Case Priority high-priority, Allowed Dataspaces sap-sales,crm-contacts, Prompt Standards pattern-v1, Process Boundaries sales-intake-only, Roles & Responsibilities owner:netzvertrieb,gov:kicoord, Guided Application training-session-completed, Risk & Approval approved-conformant, Proof of Benefit time-saved-20-percent.',
    });

    expect(result.capability).toBe('ki_floorwalker_governance');
    expect(result.recommendedCapabilities[0].capability).toBe('ki_floorwalker_governance');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.kiFloorwalkerGovernanceStatus');
    expect(actionNames).not.toContain('openai.call');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes to investment_waterfall_governance when investment waterfall is requested', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte Investmittel Wasserfall fuer item-163 und targetProcess Netzplanung-v1 pruefen: Budget Amount 500000_eur, Bottleneck Reference hs-trafo-bottleneck, Committee Window q3-2026, Evidence Readiness all-clearance-provided, Owner Netzbetrieb/ZNP-Sparte, Next Action final-budget-approval, Mandate Status authorized, Risk If Delayed high-overload-probability.',
    });

    expect(result.capability).toBe('investment_waterfall_governance');
    expect(result.recommendedCapabilities[0].capability).toBe('investment_waterfall_governance');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.investmentWaterfallGovernanceStatus');
    expect(actionNames).not.toContain('pmo-budget.create');
    expect(actionNames).not.toContain('pmo-budget.allocate');
    expect(actionNames).not.toContain('pmo-budget.mutate');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('investment-planning.createPlan');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('budget.release');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('external.connector.call');
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
    expect(result.recommendedCapabilities[0].capability).toBe('gas_capacity_order_revision_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('gas-capacity-order-revision-gate.getStatus');
    expect(actionNames).toContain('gas-capacity-order-revision-gate.evaluate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes schedule management governance roadmap prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Fahrplanmanagement Governance Roadmap fuer melo-153: Ziel-Zustand, Faehigkeits-Reifegrad, Datenobjekt-Mapping, Systemintegrationen, Rollen-Matrix, Redispatch-Grenzbereich, fNAV-Schnittstelle, Verantwortlichkeit, naechste Schritte, Kapazitaetsmanagement-Luecken, Fahrplan-Elemente, Entscheidungsgremien und Quellenreferenzen.',
    });

    expect(result.capability).toBe('schedule_management_governance_roadmap');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'schedule_management_governance_roadmap'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.scheduleManagementGovernanceRoadmapStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('settlement.prepareBilling');
  });

  it('routes gas and heat transformation dependency map prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Gasnetztransformation Abhaengigkeitslandkarte fuer project-155: Sparte, Transformationsknoten, Abhaengigkeiten, Datenqualitaets-Luecken, Investitionspfade, Stilllegungs- und Umwidmungspfade, Kundengruppen, Owner, naechste Schritte, naechste Massnahme und Quellenreferenzen.',
    });

    expect(result.capability).toBe('gas_transformation_dependency_map');
    expect(result.recommendedCapabilities[0].capability).toBe('gas_transformation_dependency_map');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gasTransformationDependencyMapStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('assets.mutate');
    expect(actionNames).not.toContain('datapoint.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('personal-agent.execute');
    expect(actionNames).not.toContain('external.connector.call');
  });

  it('routes grid connection transformation gate prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Netzanschlusspunkt Transformations Gate fuer meteringPointId=melo-144: Sparte, Transformationsoption, Datenqualitaetsstatus, Investitionspfad, Stilllegungspfad, Owner, naechste Schritte, naechste Massnahme und Quellenreferenzen.',
    });

    expect(result.capability).toBe('grid_connection_transformation_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'grid_connection_transformation_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.gridConnectionTransformationGateStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('assets.mutate');
    expect(actionNames).not.toContain('datapoint.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('personal-agent.execute');
    expect(actionNames).not.toContain('external.connector.call');
  });

  it('routes Technisch Kaufmaennisches Angebots Cockpit prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Technisch Kaufmaennisches Angebots Cockpit fuer request-162: Request ID, Netzbetreiber ID, Zielnetzbezug, Grid Node, Technische Restriktion, Anfrageleistung, Technischer Status, Auslastung, fNAV Vertragslage, Kaufmännische Annahmen, Rechtsstatus, Legal Boundaries und Quellenreferenzen.',
    });

    expect(result.capability).toBe('tech_commercial_offer_cockpit');
    expect(result.recommendedCapabilities[0].capability).toBe('tech_commercial_offer_cockpit');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.techCommercialOfferCockpitStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('assets.mutate');
    expect(actionNames).not.toContain('datapoint.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('personal-agent.execute');
    expect(actionNames).not.toContain('external.connector.call');
  });

  it('routes Zaehlpark financing scenario prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Zaehlpark Finanzierung Szenario Cockpit fuer gridOperatorId=VNB-143 und scenarioId=sc-2026-rollout: iMSys Rollout, Gateway Finanzierung, mME, Wasser/Waerme, CAPEX, OPEX, TOTEX, Leasing und Quellenreferenzen.',
    });

    expect(result.capability).toBe('zaehlpark_finanzierung_szenario_cockpit');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'zaehlpark_finanzierung_szenario_cockpit'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.zaehlparkFinanzierungSzenarioCockpitStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('assets.mutate');
    expect(actionNames).not.toContain('datapoint.mutate');
    expect(actionNames).not.toContain('finance-agent.mutate');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes process sensitization readiness prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Prozess-Sensibilisierung Readiness Map fuer Netzanschluss Workshop: Rollenentscheidung offen, rote Linie Netzsicherheit, Systembruch und Evidenz fehlt vor Schulung.',
    });

    expect(result.capability).toBe('process_sensitization_readiness_map');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'process_sensitization_readiness_map'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.processSensitizationReadinessMapStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Netzprozess readiness gate prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Netzprozess Readiness Gate fuer Redispatch: Portalzugang ready, SFTP blockiert, Rollenfreigabe offen, IT Security Update und Fachschulung vor blockierter Folgeentscheidung.',
    });

    expect(result.capability).toBe('netzprozess_readiness_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('netzprozess_readiness_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.netzprozessReadinessGateStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('routes Grossspeicher Anschluss readiness prompts to the read-only evidence status path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Grossspeicher Anschluss Readiness Gate fuer BESS: NAP MaStR, fNAV Speicher, Speicherfahrplan, Netzsignal Vorrang, Steuerbarkeit Speicher und Control-Room Handover vor Anschlussentscheidung.',
    });

    expect(result.capability).toBe('grossspeicher_anschluss_readiness_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'grossspeicher_anschluss_readiness_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.grossspeicherAnschlussReadinessGateStatus');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('grid-operations.executeControl');
    expect(actionNames).not.toContain('forecast-engine.executeDispatch');
    expect(actionNames).not.toContain('flex.controlDevice');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route explicit storage device-control prompts to the read-only Grossspeicher gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Fuehre SMGW CLS device-control Steuerbefehl fuer Batteriespeicher aus und starte Dispatch Optimierung.',
    });

    expect(result.capability).not.toBe('grossspeicher_anschluss_readiness_gate');
  });

  it('routes Role-Permission / AccessManager readiness prompts to the read-only evidence path', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Role Permission Readiness fuer AccessManager reapproval, Portalzugang, sFTP Berechtigung, Rollenfreigabe, IT-Sicherheitsfreigabe und Fachschulungsnachweis.',
    });

    expect(result.capability).toBe('role_permission_access_readiness_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'role_permission_access_readiness_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.rolePermissionAccessReadinessGateStatus');
    expect(actionNames).not.toContain('access-manager.call');
    expect(actionNames).not.toContain('iam.provision');
    expect(actionNames).not.toContain('rbac.mutate');
    expect(actionNames).not.toContain('token.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route explicit IAM provisioning prompts to the read-only Role-Permission gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Provisioniere IAM Rollen, erstelle User und Tenant, speichere Credentials und fuehre AccessManager Sync aus.',
    });

    expect(result.capability).not.toBe('role_permission_access_readiness_gate');
  });

  it('routes Owner-Frist-Evidenz VNB signal prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Owner Frist Evidenz fuer VNB Signal: blockierte Folgeentscheidung, Frist Nachhaltung, Evidenz Cockpit, Source, linked entity und Management Nachhaltung.',
    });

    expect(result.capability).toBe('owner_deadline_evidence_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('owner_deadline_evidence_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.ownerDeadlineEvidenceGateStatus');
    expect(actionNames).not.toContain('mail.fetch');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('notification.send');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route mail ingestion or external connector prompts to the Owner-Frist-Evidenz gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Scrape Mail Teams und Loop, baue External Connector Ingestion und erstelle Workflow Eskalation fuer Owner Frist Evidenz.',
    });

    expect(result.capability).not.toBe('owner_deadline_evidence_gate');
  });

  it('does not route legal-opinion or AccessManager provisioning prompts to the Owner-Frist-Evidenz gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erstelle Rechtsgutachten und provisioniere AccessManager IAM Rollen mit Credentials fuer Frist Nachhaltung.',
    });

    expect(result.capability).not.toBe('owner_deadline_evidence_gate');
  });

  it('routes RPA Fehlerfolgen / automation risk prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe RPA Fehlerfolgen Gate fuer Automatisierungsfreigabe: Bot Stopfbarkeit, Rueckrollpfad, Rollback, Sonderfallkatalog, Edge Case Catalog, Massenlauf Risiko, Testabdeckung und Monitoring.',
    });

    expect(result.capability).toBe('automation_risk_gate');
    expect(result.recommendedCapabilities[0].capability).toBe('automation_risk_gate');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.automationRiskGateStatus');
    expect(actionNames).not.toContain('rpa.execute');
    expect(actionNames).not.toContain('bot.run');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route bot execution or workflow execution prompts to the automation risk gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Fuehre RPA Bot Run aus, starte Workflow Execute, sende Marktkommunikation und triggere External Connector fuer Automation Risk Gate.',
    });

    expect(result.capability).not.toBe('automation_risk_gate');
  });

  it('routes Redispatch Projektcontrolling KPI Cockpit prompts to the read-only gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Pruefe Redispatch Projektcontrolling KPI Cockpit als read-only Gate: Lastgang Evidenz, MaStR Evidenz, Datenquelle belastbar, Owner Faelligkeit Redispatch und Entscheidungsblocker Redispatch.',
    });

    expect(result.capability).toBe('redispatch_project_controlling_kpi_cockpit');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'redispatch_project_controlling_kpi_cockpit'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.redispatchProjectControllingKpiCockpitStatus');
    expect(actionNames).not.toContain('redispatch.execute');
    expect(actionNames).not.toContain('settlement.exportA96');
    expect(actionNames).not.toContain('settlement.prepareBilling');
    expect(actionNames).not.toContain('task.create');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route settlement execution or device-control prompts to the Redispatch KPI cockpit', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Fuehre fuer Redispatch KPI Cockpit Settlement aus, exportiere A96, erstelle Redispatch Order, sende Steuerbefehl und starte Workflow Execute.',
    });

    expect(result.capability).not.toBe('redispatch_project_controlling_kpi_cockpit');
  });

  it('routes Stadtwerk Mauer VDMI profile prompts to the read-only profile capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Erzeuge ein Stadtwerk Mauer VDMI Profile fuer 69256 Mauer mit Sparten Strom Gas Wasser Waerme, Rollen, Marktrollen, Evidenzluecken und Demo-Frage fuer Transformations- und Netzrisiken.',
    });

    expect(result.capability).toBe('stadtwerk_mauer_vdmi_profile');
    expect(result.recommendedCapabilities[0].capability).toBe('stadtwerk_mauer_vdmi_profile');
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.stadtwerkMauerVdmiProfileStatus');
    expect(actionNames).not.toContain('tenant.create');
    expect(actionNames).not.toContain('eve.runtime.execute');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route tenant provisioning or Eve runtime execution to the Stadtwerk Mauer profile', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Provisioniere Tenant stadtwerk-mauer, erstelle User und Token, schreibe Eve Agent Directory, starte Scheduler Channel Approval und fuehre Workflow aus.',
    });

    expect(result.capability).not.toBe('stadtwerk_mauer_vdmi_profile');
  });

  it('routes Stadtwerk Mauer capability projection prompts to the read-only projection capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Welche Cernion Capabilities hat Stadtwerk Mauer fuer Management, Grid Planning, Asset Management und Regulatory? Bitte Capability Projection mit read-only, advisory und consequential Follow-up Klassen anzeigen.',
    });

    expect(result.capability).toBe('stadtwerk_mauer_capability_projection');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'stadtwerk_mauer_capability_projection'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.stadtwerkMauerCapabilityProjectionStatus');
    expect(actionNames).not.toContain('eve.runtime.execute');
    expect(actionNames).not.toContain('task.create');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('nova.mutate');
    expect(actionNames).not.toContain('vdmi.mutate');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route event simulation or Eve artifact setup to the Stadtwerk Mauer projection', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Starte Event Simulation fuer Stadtwerk Mauer, schreibe Eve Agent File, waehle Artifact Placement, erstelle Task und fuehre Workflow aus.',
    });

    expect(result.capability).not.toBe('stadtwerk_mauer_capability_projection');
  });

  it('routes Stadtwerk Mauer event replay preview prompts to the read-only event catalog capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Zeige den Stadtwerk Mauer Event Replay Preview als read-only Ereigniskatalog mit seed=demo, synthetische Events, PV Elektriker Event, Lieferantenwechsel Simulation und Zaehlerablesung Demo.',
    });

    expect(result.capability).toBe('stadtwerk_mauer_event_replay_preview');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'stadtwerk_mauer_event_replay_preview'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('dashboard-api.stadtwerkMauerEventReplayPreviewStatus');
    expect(actionNames).not.toContain('scheduler.create');
    expect(actionNames).not.toContain('event.inject');
    expect(actionNames).not.toContain('eve.runtime.execute');
    expect(actionNames).not.toContain('workflow.execute');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route Stadtwerk Mauer scheduler or event injection prompts to the replay preview', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Starte fuer Stadtwerk Mauer den Scheduler, injiziere Events in eine Queue, persistiere den Event Stream, fuehre Eve Runtime aus und sende MaKo Nachrichten.',
    });

    expect(result.capability).not.toBe('stadtwerk_mauer_event_replay_preview');
  });

  it('routes ZNP production readiness prompts to the read-only evidence gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte ZNP Production Readiness Evidence Gate fuer Projekt znp-71 pruefen: Layer 1 Layer 2 G-Factor Validierung, Acceptance Evidence und NOVA handoff readiness als Status.',
    });

    expect(result.capability).toBe('znp_production_readiness_evidence_gate');
    expect(result.recommendedCapabilities[0].capability).toBe(
      'znp_production_readiness_evidence_gate'
    );
    const actionNames = result.recommendedPlan.map((step) => step.action);
    expect(actionNames).toContain('znp.productionReadinessStatus');
    expect(actionNames).not.toContain('znp.addLayer1');
    expect(actionNames).not.toContain('znp.addLayer2');
    expect(actionNames).not.toContain('nova.apply');
    expect(actionNames).not.toContain('hitl.create');
    expect(actionNames).not.toContain('external.connector.call');
    expect(actionNames).not.toContain('personal-agent.execute');
  });

  it('does not route Overpass/PDF/NOVA execution prompts to the ZNP readiness gate', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Starte Overpass Import, PDF Extraction, async job und NOVA apply fuer ZNP Production Readiness Layer 1 Layer 2.',
    });

    expect(result.capability).not.toBe('znp_production_readiness_evidence_gate');
  });
});
