'use strict';

const {
  buildExecutionPlan,
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
});
