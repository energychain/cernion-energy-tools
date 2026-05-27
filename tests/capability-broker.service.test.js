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
      task: 'Erstelle einen Potenzialvergleich zwischen Netze BW und TWL Netze anhand der EWK KPI-Kennzahlen (Anschlussdauer, Digitalisierungsindex, Umsetzungsquote)',
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

  it('routes Netzsignal-Vorrang Vertragsgate prompts to the Phase-5 fNAV capability', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task:
        'Bitte fNAV Netzfahrplan mit Netzsignal Vorrang Vertragsgate für einen flexiblen Netzanschlussvertrag prüfen.',
    });

    expect(result.recommendedCapabilities[0].capability).toBe('netzfahrplan_fnav_assessment');
    expect(result.recommendedPlan[0].action).toBe('grid-connection.fnavValidate');
  });

  it('routes A96 reconciliation prompts to settlement.reconcileA96 and hydrates knownContext', async () => {
    const result = await broker.call('capability-broker.recommend', {
      task: 'Bitte A96 Abgleich per anlageId/timeSlice durchführen und Deltas zeigen.',
      knownContext: {
        settlementId: 'redispatch_2026q2_SEE999952467552',
        incomingRows: [{ anlageId: 'SEE999952467552', timeSlice: '2026-04-01T00:00:00.000Z/2026-04-01T01:00:00.000Z' }],
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
});
