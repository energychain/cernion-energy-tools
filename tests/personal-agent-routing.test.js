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
});
