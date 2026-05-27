'use strict';

const {
  buildExecutionPlan,
  applyMissingContextFallback,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  getMissingInputs,
  isMissingRequired,
  runExecutionPreflight,
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
      message:
        'Asset-Validierung für Anlage TR-17 mit Evidenzlücken, Risikofaktoren und verbotenen Annahmen erstellen',
      brokerRecommendation: null,
    });

    expect(plan.source).toBe('capability-broker');
    expect(plan.routeLabel).toBe('vdmi_asset_validation_governance');
    expect(plan.primaryIntent).toBe('vdmi_asset_validation_governance');
    expect(plan.steps[0].action).toBe('vdmi.dossier');
  });

  it('selects VDMI grid-connection decision governance in fallback routing for formal decision prompts', () => {
    const plan = buildExecutionPlan({
      message:
        'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage oder Kapazitaetszusage geben?',
      brokerRecommendation: null,
    });

    expect(plan.source).toBe('capability-broker');
    expect(plan.routeLabel).toBe('vdmi_grid_connection_decision_governance');
    expect(plan.primaryIntent).toBe('vdmi_grid_connection_decision_governance');
    expect(plan.steps.map((step) => step.action)).toEqual(
      expect.arrayContaining(['vdmi.dossier', 'vdmi.negotiationTrace', 'vdmi.agentRole'])
    );
  });

  it('selects financier due-diligence capability in fallback routing instead of interface placeholder', () => {
    const plan = buildExecutionPlan({
      message: 'Erstelle ein vorläufiges Risk Assessment für den Kreditausschuss (Due Diligence).',
      brokerRecommendation: null,
    });

    expect(plan.source).toBe('capability-broker');
    expect(plan.routeLabel).toBe('financier_due_diligence_assessment');
    expect(plan.primaryIntent).toBe('financier_due_diligence_assessment');
    expect(plan.steps[0].action).toBe('finance-agent.analyze');
  });

  it('marks critical capability steps as mandatory HITL checkpoints', () => {
    const plan = buildExecutionPlan({
      message: 'Due Diligence für den Kreditausschuss vorbereiten',
      brokerRecommendation: null,
    });

    expect(plan.routeLabel).toBe('financier_due_diligence_assessment');
    expect(plan.steps[0].action).toBe('finance-agent.analyze');
    expect(plan.steps[0].hitlRequired).toBe(true);
    expect(plan.steps[0].criticalityClass).toBe('financial_commitment');
  });

  it('hydrates finance-agent.analyze query and vdmi decision task defaults in template filling', () => {
    const financeParams = pruneUndefinedDeep(
      fillTemplateWithContext(
        {},
        'finance-agent.analyze',
        {
          lastUserMessage: 'Erstelle ein Risk Assessment für den Kreditausschuss.',
        },
        {
          query: 'Erstelle ein Risk Assessment für den Kreditausschuss.',
        },
        { stepResults: {} }
      )
    );

    expect(financeParams.query).toMatch(/Risk Assessment|Kreditausschuss/i);

    const vdmiParams = pruneUndefinedDeep(
      fillTemplateWithContext(
        {},
        'vdmi.dossier',
        {
          lastUserMessage:
            'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage geben?',
        },
        {
          query:
            'Kann der Netzbetreiber ohne formales §17 EnWG Netzanschlussbegehren eine belastbare Anschlusszusage geben?',
        },
        { stepResults: {} }
      )
    );

    expect(vdmiParams.taskId).toBe('network-operator-decision');
  });

  it('hydrates settlement.reconcileA96 params from knownContext aliases', () => {
    const params = pruneUndefinedDeep(
      fillTemplateWithContext(
        {
          settlementId: null,
          incomingRows: null,
          toleranceEur: 0.01,
        },
        'settlement.reconcileA96',
        {
          settlementId: 'redispatch_2026q2_SEE999952467552',
          a96Rows: [
            {
              anlageId: 'SEE999952467552',
              timeSlice: '2026-04-01T00:00:00.000Z/2026-04-01T01:00:00.000Z',
            },
          ],
        },
        {},
        { stepResults: {} }
      )
    );

    expect(params).toEqual(
      expect.objectContaining({
        settlementId: 'redispatch_2026q2_SEE999952467552',
      })
    );
    expect(Array.isArray(params.incomingRows)).toBe(true);
    expect(params.incomingRows[0].anlageId).toBe('SEE999952467552');
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

describe('getMissingInputs — znp.assessPortfolio', () => {
  it('returns [projectId] when projectId is absent', () => {
    expect(getMissingInputs('znp.assessPortfolio', {})).toEqual(['projectId']);
  });

  it('returns [projectId] when projectId is undefined', () => {
    expect(getMissingInputs('znp.assessPortfolio', { projectId: undefined })).toEqual(['projectId']);
  });

  it('returns [projectId] when projectId is null', () => {
    // null is treated as missing — a null projectId is not a valid project reference
    const params = { projectId: null, kaufmaennischeFreigabeFnav: false };
    expect(getMissingInputs('znp.assessPortfolio', params)).toEqual(['projectId']);
  });

  it('returns [] when projectId is present with a valid value', () => {
    expect(getMissingInputs('znp.assessPortfolio', { projectId: 'znp-proj-001' })).toEqual([]);
  });

  it('applyMissingContextFallback detects missing projectId for znp.assessPortfolio', () => {
    const plan = {
      source: 'capability-broker',
      status: 'ready',
      steps: [
        {
          step: 1,
          action: 'znp.assessPortfolio',
          paramsTemplate: { kaufmaennischeFreigabeFnav: false },
          source: 'capability-broker',
        },
      ],
      promptHints: {},
    };

    const routed = applyMissingContextFallback(plan, {
      executionMode: 'auto',
      knownContext: {},
    });

    expect(routed.status).toBe('missing-context');
    expect(routed.missingContext).toMatchObject({
      blockedAction: 'znp.assessPortfolio',
      missingParams: ['projectId'],
    });
    const missingStep = routed.steps.find((s) => s.action === 'MISSING_CONTEXT');
    expect(missingStep).toBeDefined();
    expect(missingStep.missingParams).toEqual(['projectId']);
  });

  it('does NOT add MISSING_CONTEXT when projectId is provided via knownContext', () => {
    // Template must include the projectId slot (undefined) so fillTemplateWithContext
    // hydrates it from knownContext before getMissingInputs runs
    const plan = {
      source: 'capability-broker',
      status: 'ready',
      steps: [
        {
          step: 1,
          action: 'znp.assessPortfolio',
          paramsTemplate: { projectId: undefined, kaufmaennischeFreigabeFnav: false },
          source: 'capability-broker',
        },
      ],
      promptHints: {},
    };

    const routed = applyMissingContextFallback(plan, {
      executionMode: 'auto',
      knownContext: { projectId: 'znp-proj-001' },
    });

    expect(routed.status).toBe('ready');
    expect(routed.missingContext).toBeUndefined();
  });
});

describe('isMissingRequired', () => {
  it('returns true for null', () => {
    expect(isMissingRequired(null)).toBe(true);
  });

  it('returns true for undefined', () => {
    expect(isMissingRequired(undefined)).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isMissingRequired('')).toBe(true);
  });

  it('returns true for whitespace-only string', () => {
    expect(isMissingRequired('   ')).toBe(true);
  });

  it('returns true for empty array', () => {
    expect(isMissingRequired([])).toBe(true);
  });

  it('returns true for empty object', () => {
    expect(isMissingRequired({})).toBe(true);
  });

  it('returns false for a non-empty string', () => {
    expect(isMissingRequired('znp-proj-001')).toBe(false);
  });

  it('returns false for a non-empty array', () => {
    expect(isMissingRequired(['item'])).toBe(false);
  });

  it('returns false for a non-empty object', () => {
    expect(isMissingRequired({ key: 'val' })).toBe(false);
  });

  it('returns false for a number (0 is falsy but not "missing")', () => {
    expect(isMissingRequired(0)).toBe(false);
  });
});

describe('runExecutionPreflight — generic param validation', () => {
  // allOf: required param absent
  it('returns missing-inputs when required param is absent (no key)', () => {
    const result = runExecutionPreflight('znp.assessPortfolio', {});
    expect(result.outcome).toBe('missing-inputs');
    expect(result.missingParams).toContain('projectId');
  });

  // allOf: required param undefined
  it('returns missing-inputs when required param is undefined', () => {
    const result = runExecutionPreflight('znp.assessPortfolio', { projectId: undefined });
    expect(result.outcome).toBe('missing-inputs');
    expect(result.missingParams).toContain('projectId');
  });

  // allOf: required param null
  it('returns missing-inputs when required param is null', () => {
    const result = runExecutionPreflight('znp.assessPortfolio', { projectId: null });
    expect(result.outcome).toBe('missing-inputs');
    expect(result.missingParams).toContain('projectId');
  });

  // allOf: required string param empty
  it('returns missing-inputs when required string param is empty string', () => {
    const result = runExecutionPreflight('znp.assessPortfolio', { projectId: '' });
    expect(result.outcome).toBe('missing-inputs');
    expect(result.missingParams).toContain('projectId');
  });

  // allOf: whitespace-only string is also missing
  it('returns missing-inputs when required string param is whitespace only', () => {
    const result = runExecutionPreflight('znp.assessPortfolio', { projectId: '   ' });
    expect(result.outcome).toBe('missing-inputs');
    expect(result.missingParams).toContain('projectId');
  });

  // allOf: valid value passes
  it('returns ok when all required params are present and non-empty', () => {
    const result = runExecutionPreflight('znp.assessPortfolio', { projectId: 'znp-proj-001' });
    expect(result.outcome).toBe('ok');
    expect(result.missingParams).toEqual([]);
  });

  // anyOf: all missing → missing-inputs
  it('returns missing-inputs for anyOf action when all candidates are absent', () => {
    const result = runExecutionPreflight('grid-operations.vnbLookup', {});
    expect(result.outcome).toBe('missing-inputs');
    expect(result.missingParams[0]).toMatch(/oneOf:/);
  });

  // anyOf: null value is not considered satisfied
  it('returns missing-inputs for anyOf when all values are null', () => {
    const result = runExecutionPreflight('grid-operations.vnbLookup', {
      bdew: null,
      city: null,
      vnbName: null,
      query: null,
    });
    expect(result.outcome).toBe('missing-inputs');
  });

  // anyOf: empty string is not considered satisfied
  it('returns missing-inputs for anyOf when all values are empty string', () => {
    const result = runExecutionPreflight('grid-operations.vnbLookup', {
      bdew: '',
      city: '',
      vnbName: '',
      query: '',
    });
    expect(result.outcome).toBe('missing-inputs');
  });

  // anyOf: at least one valid value passes
  it('returns ok for anyOf when at least one value is present and non-empty', () => {
    const result = runExecutionPreflight('grid-operations.vnbLookup', { city: 'Wiesloch' });
    expect(result.outcome).toBe('ok');
  });

  // Action without ACTION_REQUIREMENTS entry → always ok
  it('returns ok for unknown action (no requirements registered)', () => {
    const result = runExecutionPreflight('some.unknownAction', { anything: 'goes' });
    expect(result.outcome).toBe('ok');
  });

  // scope-blocked
  it('returns scope-blocked when a required scope is missing from contextScopes', () => {
    const result = runExecutionPreflight(
      'znp.assessPortfolio',
      { projectId: 'znp-proj-001' },
      { requiredScopes: ['operatorScope'], contextScopes: { operatorScope: false } }
    );
    expect(result.outcome).toBe('scope-blocked');
    expect(result.missingParams).toContain('operatorScope');
  });

  // scope satisfied → ok
  it('returns ok when required scope is satisfied in contextScopes', () => {
    const result = runExecutionPreflight(
      'znp.assessPortfolio',
      { projectId: 'znp-proj-001' },
      { requiredScopes: ['operatorScope'], contextScopes: { operatorScope: true } }
    );
    expect(result.outcome).toBe('ok');
  });

  // missing-inputs takes precedence over scope-blocked
  it('returns missing-inputs even when scope is blocked (params checked first)', () => {
    const result = runExecutionPreflight(
      'znp.assessPortfolio',
      { projectId: null },
      { requiredScopes: ['operatorScope'], contextScopes: { operatorScope: false } }
    );
    expect(result.outcome).toBe('missing-inputs');
  });
});
