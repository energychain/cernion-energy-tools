'use strict';

const { evaluateGovernancePolicy } = require('../src/governance-policy-evaluator');

module.exports = {
  name: 'governance',

  actions: {
    evaluatePolicy: {
      params: {
        capability: { type: 'any', optional: true },
        controlCase: { type: 'any', optional: true },
        action: { type: 'string', optional: true },
        context: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        summary: 'Evaluate governance policy without executing the action',
        tags: ['Governance'],
      },
      handler(ctx) {
        return {
          ...evaluateGovernancePolicy(ctx.params),
          safety: 'read_only_policy_evaluation',
          sideEffects: 'none',
        };
      },
    },
  },
};
