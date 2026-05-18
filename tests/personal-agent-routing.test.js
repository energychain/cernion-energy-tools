'use strict';

const {
  buildExecutionPlan,
  applyMissingContextFallback,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  getMissingInputs,
} = require('../src/personal-agent-routing');

describe('personal-agent-routing', () => {
  it('extracts location and asserted grid operator separately from natural language', () => {
    const plan = buildExecutionPlan({
      message: 'Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW',
      brokerRecommendation: null,
    });

    expect(plan.promptHints.location).toBe('Frankenthal');
    expect(plan.promptHints.gridOperatorName).toBe('TWL Netze');
    expect(plan.promptHints.gridOperatorName).not.toBe('Frankenthal');
    expect(plan.promptHints.requestedCapacityKW).toBe(12000);
    expect(plan.promptHints.query).toBe('TWL Netze');
  });

  it('does not treat natural language location phrases as project IDs', () => {
    const plan = buildExecutionPlan({
      message: 'Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein',
      brokerRecommendation: null,
    });

    expect(plan.promptHints.projectId).toBeUndefined();
    expect(plan.promptHints.location).toBe('Frankenthal');
  });

  it('ignores non-numeric pseudo BDEW values from generic code labels', () => {
    const plan = buildExecutionPlan({
      message: 'Code: NETZBETREIBER, Standort Frankenthal',
      brokerRecommendation: null,
    });

    expect(plan.promptHints.bdewCode).toBeUndefined();
    expect(plan.promptHints.gridOperatorBdew).toBeUndefined();
  });

  it('prefers extracted operator hints over full prompt text for market partner lookup', () => {
    const message = 'Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW';
    const plan = buildExecutionPlan({
      message,
      brokerRecommendation: null,
    });

    const params = fillTemplateWithContext(
      { query: message },
      'grid-operations.marketPartners',
      {},
      plan.promptHints,
      { stepResults: {} }
    );

    expect(params.query).toBe('TWL Netze');
  });

  it('treats unresolved __step dependencies as missing inputs for dependent lookup steps', () => {
    const params = pruneUndefinedDeep(
      fillTemplateWithContext(
        {
          bdew: '__step_1.data.results[0].bdewCode',
          city: '__step_1.data.results[0].contacts[0].city',
        },
        'grid-operations.vnbLookup',
        {},
        {},
        { stepResults: {} }
      )
    );

    expect(params).toEqual({});
    expect(getMissingInputs('grid-operations.vnbLookup', params)).toEqual([
      'oneOf:bdew|city|vnbName|query',
    ]);
  });

  it('resolves bdew placeholder from wrapped step result data.data.results path', () => {
    const params = pruneUndefinedDeep(
      fillTemplateWithContext(
        {
          bdew: '__step_1.data.results[0].bdewCode',
        },
        'grid-operations.vnbLookup',
        {},
        {},
        {
          stepResults: {
            1: {
              data: {
                success: true,
                data: {
                  results: [
                    {
                      bdewCode: '9904350000002',
                      contacts: [{ city: 'Ludwigshafen' }],
                    },
                  ],
                },
              },
            },
          },
        }
      )
    );

    expect(params.bdew).toBe('9904350000002');
  });

  it('resolves city from step result contact context and not from prompt location fallback', () => {
    const params = pruneUndefinedDeep(
      fillTemplateWithContext(
        {
          city: '__step_1.data.results[0].contacts[0].city',
        },
        'grid-operations.vnbLookup',
        { location: 'Frankenthal' },
        { location: 'Frankenthal' },
        {
          stepResults: {
            1: {
              data: {
                results: [
                  {
                    bdewCode: '9904350000002',
                    contacts: [{ city: 'Ludwigshafen' }],
                  },
                ],
              },
            },
          },
        }
      )
    );

    expect(params.city).toBe('Ludwigshafen');
  });

  it('keeps resolved bdew dependency and avoids replacing unresolved city with prompt location', () => {
    const params = pruneUndefinedDeep(
      fillTemplateWithContext(
        {
          bdew: '__step_1.data.results[0].bdewCode',
          city: '__step_1.data.results[0].contacts[0].city',
          limit: 5,
        },
        'grid-operations.vnbLookup',
        { location: 'Frankenthal' },
        { location: 'Frankenthal' },
        {
          stepResults: {
            1: {
              data: {
                results: [{ bdewCode: '9904350000002', contacts: [] }],
              },
            },
          },
        }
      )
    );

    expect(params.bdew).toBe('9904350000002');
    expect(params.city).toBeUndefined();
    expect(params.limit).toBe(5);
  });

  it('adds regulatory contextNote on relevant steps when knowledgeContext provides a regulatory frame', () => {
    const plan = buildExecutionPlan({
      message: 'Bitte fNAV und Finance für TWL Netze bewerten',
      brokerRecommendation: null,
      knowledgeContext: {
        regulatoryFrame: 'EnWG-Rahmen',
      },
    });

    expect(plan.routeKey).toBe('fnav-finance');
    expect(plan.steps[0].action).toBe('grid-connection.fnavValidate');
    expect(plan.steps[1].action).toBe('finance-agent.fnavEconomics');
    expect(plan.steps[0].contextNote).toContain('EnWG-Rahmen');
    expect(plan.steps[1].contextNote).toContain('EnWG-Rahmen');
  });

  it('keeps broker-selected VDMI role-boundary governance intent in execution plan', () => {
    const plan = buildExecutionPlan({
      message: 'Rollen und Schnittstellen klären: ohne Netzanschlussbegehren keine Zusage',
      brokerRecommendation: {
        recommendedCapabilities: [
          {
            capability: 'vdmi_role_boundary_governance',
          },
        ],
        recommendedPlan: [
          {
            action: 'vdmi.agentRole',
            params: {
              processType: 'grid-connection-governance',
            },
          },
        ],
      },
    });

    expect(plan.source).toBe('capability-broker');
    expect(plan.routeLabel).toBe('vdmi_role_boundary_governance');
    expect(plan.primaryIntent).toBe('vdmi_role_boundary_governance');
    expect(plan.primaryIntent).not.toBe('resolve_grid_operator_identity');
    expect(plan.steps[0].action).toBe('vdmi.agentRole');
  });

  it('selects VDMI asset-validation governance in fallback routing for asset/evidence prompts', () => {
    const plan = buildExecutionPlan({
      message: 'Asset-Validierung für Anlage TR-17 mit Evidenzlücken, Risikofaktoren und verbotenen Annahmen erstellen',
      brokerRecommendation: null,
    });

    expect(plan.source).toBe('capability-broker');
    expect(plan.routeLabel).toBe('vdmi_asset_validation_governance');
    expect(plan.primaryIntent).toBe('vdmi_asset_validation_governance');
    expect(plan.steps[0].action).toBe('vdmi.dossier');
  });

  it('selects VDMI grid-connection decision governance in fallback routing for formal decision prompts', () => {
    const plan = buildExecutionPlan({
      message: 'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage oder Kapazitaetszusage geben?',
      brokerRecommendation: null,
    });

    expect(plan.source).toBe('capability-broker');
    expect(plan.routeLabel).toBe('vdmi_grid_connection_decision_governance');
    expect(plan.primaryIntent).toBe('vdmi_grid_connection_decision_governance');
    expect(plan.steps.map((step) => step.action)).toEqual(
      expect.arrayContaining(['vdmi.dossier', 'vdmi.negotiationTrace', 'vdmi.agentRole'])
    );
  });

  it('keeps broker-selected VDMI asset-validation governance intent in execution plan', () => {
    const plan = buildExecutionPlan({
      message: 'Bitte Task asset-1 validieren',
      brokerRecommendation: {
        recommendedCapabilities: [
          {
            capability: 'vdmi_asset_validation_governance',
          },
        ],
        recommendedPlan: [
          {
            action: 'vdmi.dossier',
            params: {
              taskId: 'asset-1',
            },
          },
        ],
      },
    });

    expect(plan.source).toBe('capability-broker');
    expect(plan.routeLabel).toBe('vdmi_asset_validation_governance');
    expect(plan.primaryIntent).toBe('vdmi_asset_validation_governance');
    expect(plan.steps[0].action).toBe('vdmi.dossier');
    expect(plan.steps[0].paramsTemplate.taskId).toBe('asset-1');
  });

  it('keeps broker-selected VDMI decision governance intent in execution plan', () => {
    const plan = buildExecutionPlan({
      message: 'Entscheidung zur Anschlusszusage prüfen',
      brokerRecommendation: {
        recommendedCapabilities: [
          {
            capability: 'vdmi_grid_connection_decision_governance',
          },
        ],
        recommendedPlan: [
          {
            action: 'vdmi.dossier',
            params: {
              taskId: 'network-operator-decision',
            },
          },
          {
            action: 'vdmi.negotiationTrace',
            params: {
              taskId: 'network-operator-decision',
            },
          },
          {
            action: 'vdmi.agentRole',
            params: {
              taskId: 'network-operator-decision',
              processType: 'grid-connection-governance',
            },
          },
        ],
      },
    });

    expect(plan.routeLabel).toBe('vdmi_grid_connection_decision_governance');
    expect(plan.primaryIntent).toBe('vdmi_grid_connection_decision_governance');
    expect(plan.steps[2].action).toBe('vdmi.agentRole');
    expect(plan.steps[2].paramsTemplate.taskId).toBe('network-operator-decision');
  });

  it('injects a MISSING_CONTEXT routing control step in AUTO mode when required inputs are missing', () => {
    const plan = buildExecutionPlan({
      message: 'Bitte fNAV und Finance für TWL Netze bewerten',
      brokerRecommendation: null,
    });

    const routed = applyMissingContextFallback(plan, {
      executionMode: 'auto',
      knownContext: {
        gridOperatorName: 'TWL Netze',
        voltageLevel: 'MS',
      },
    });

    const missingStep = routed.steps.find((step) => step.action === 'MISSING_CONTEXT');
    expect(missingStep).toBeTruthy();
    expect(missingStep.blockedAction).toBe('grid-connection.fnavValidate');
    expect(missingStep.missingParams).toEqual(['fnavProfile']);
    expect(routed.missingContext).toMatchObject({
      blockedAction: 'grid-connection.fnavValidate',
      missingParams: ['fnavProfile'],
    });
  });
});
