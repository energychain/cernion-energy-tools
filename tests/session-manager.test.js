'use strict';

const {
  pushPlanFrame,
  mergeResolvedParamsIntoPlan,
  assertNoRecentIntentLoop,
  resumeParentPlanFrame,
} = require('../src/session-manager');

describe('session-manager plan stack helpers', () => {
  it('merges resolved params into resumed plan placeholders and direct params', () => {
    const plan = {
      status: 'ready',
      steps: [
        {
          action: 'grid-operations.vnbLookup',
          paramsTemplate: {
            query: '{{gridOperatorName}}',
            bdew: '__resolved.gridOperatorBdew',
            param1: '__resolved.param1',
          },
          params: {
            param1: null,
          },
        },
      ],
    };

    const merged = mergeResolvedParamsIntoPlan(plan, {
      gridOperatorName: 'value-grid',
      gridOperatorBdew: '9901234567890',
      param1: 'value123',
    });

    expect(merged.steps[0].paramsTemplate.query).toBe('value-grid');
    expect(merged.steps[0].paramsTemplate.bdew).toBe('9901234567890');
    expect(merged.steps[0].paramsTemplate.param1).toBe('value123');
    expect(merged.steps[0].params.param1).toBe('value123');
  });

  it('detects recent intent loops for duplicate resolve intents', () => {
    const stack = [
      {
        frameId: 'pf_1',
        intent: 'resolve_grid_operator_identity',
        status: 'completed',
        plan: { steps: [] },
      },
      {
        frameId: 'pf_2',
        intent: 'grid_connection_planning',
        status: 'suspended',
        plan: { steps: [] },
      },
    ];

    expect(() => assertNoRecentIntentLoop(stack, 'resolve_grid_operator_identity')).toThrow(
      /Plan stack loop detected/i
    );
  });

  it('resumeParentPlanFrame marks parent resumed and returns merged parent plan', () => {
    const stack = [
      {
        frameId: 'pf_parent',
        intent: 'grid_connection_planning',
        status: 'suspended',
        routing: {
          requestedDomains: ['project-development', 'grid-connection'],
        },
        plan: {
          status: 'ready',
          steps: [
            {
              action: 'grid-operations.vnbLookup',
              paramsTemplate: {
                query: '{{gridOperatorName}}',
              },
            },
          ],
        },
      },
      {
        frameId: 'pf_intermediate',
        parentFrameId: 'pf_parent',
        intent: 'resolve_grid_operator_identity',
        status: 'completed',
        routing: {
          requestedDomains: ['grid-connection'],
        },
        plan: { status: 'ready', steps: [] },
      },
    ];

    const resumed = resumeParentPlanFrame(stack, {
      gridOperatorName: 'Stadtwerke Walldorf',
    });

    expect(resumed.resumed).toBe(true);
    expect(resumed.parentFrame.intent).toBe('grid_connection_planning');
    expect(resumed.planStack.find((frame) => frame.frameId === 'pf_parent')?.status).toBe(
      'resumed'
    );
    expect(resumed.plan.steps[0].paramsTemplate.query).toBe('Stadtwerke Walldorf');
  });

  it('pushPlanFrame enforces max depth of 5 frames', () => {
    let stack = [];
    for (let i = 0; i < 7; i += 1) {
      stack = pushPlanFrame(stack, {
        frameId: `pf_${i}`,
        intent: `intent_${i}`,
        status: 'suspended',
        plan: { steps: [] },
      });
    }

    expect(stack.length).toBe(5);
    expect(stack[0].frameId).toBe('pf_2');
    expect(stack[4].frameId).toBe('pf_6');
  });
});
