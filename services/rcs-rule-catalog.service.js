'use strict';

const {
  listRuleSets: registryList,
  getRuleSet: registryGet,
  resolveRuleSet,
} = require('../src/rcs-rule-registry');
const { rcsError } = require('../src/rcs-errors');

/**
 * RCS Rule Catalog service — exposes rule registry via REST (v0.60.7 WP1).
 * Stateless: wraps src/rcs-rule-registry.js with no additional persistence.
 *
 * Routes:
 *   GET /api/vnb/rcs/rules              → listRuleSets
 *   GET /api/vnb/rcs/rules/:ruleSetId   → getRuleSet
 */
module.exports = {
  name: 'rcs-rule-catalog',

  actions: {
    /**
     * List available rule sets.
     * Superseded rules are hidden by default; use includeSuperseded=true to show them.
     */
    listRuleSets: {
      rest: 'GET /rules',
      params: {
        status: { type: 'string', optional: true },
        legalStatus: { type: 'string', optional: true },
        calculationMode: { type: 'string', optional: true },
        includeSuperseded: { type: 'boolean', optional: true, default: false },
      },
      handler(ctx) {
        const { status, legalStatus, calculationMode, includeSuperseded } = ctx.params;

        const latest = resolveRuleSet('latest');
        const latestId = latest?.id ?? null;

        let items = registryList();

        if (!includeSuperseded) {
          items = items.filter((r) => r.status !== 'superseded' && r.status !== 'deprecated');
        }
        if (status) items = items.filter((r) => r.status === status);
        if (legalStatus) items = items.filter((r) => r.legalStatus === legalStatus);
        if (calculationMode) items = items.filter((r) => r.calculationMode === calculationMode);

        return {
          success: true,
          latestRuleSetId: latestId,
          total: items.length,
          items: items.map((r) => ({ ...r, isLatest: r.id === latestId })),
        };
      },
    },

    /**
     * Get a single rule set by ID, including full parameters.
     * Returns RCS_RULE_SET_NOT_FOUND (404) for unknown IDs.
     */
    getRuleSet: {
      rest: 'GET /rules/:ruleSetId',
      params: { ruleSetId: { type: 'string', min: 1 } },
      handler(ctx) {
        const { ruleSetId } = ctx.params;
        const rule = registryGet(ruleSetId);
        if (!rule) {
          throw rcsError('RCS_RULE_SET_NOT_FOUND', `Rule set '${ruleSetId}' not found.`, {
            ruleSetId,
          });
        }
        const latest = resolveRuleSet('latest');
        return { ...rule, isLatest: rule.id === latest?.id };
      },
    },
  },
};
