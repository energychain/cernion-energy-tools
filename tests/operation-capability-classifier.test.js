'use strict';

const {
  OPERATION_KINDS,
  CONSEQUENCE_LEVELS,
  EXECUTION_MODES,
  classifyOperation,
  deriveServiceSlug,
  deriveActionRef,
} = require('../src/operation-capability-classifier');

function buildOp(overrides = {}) {
  return {
    path: '/api/example/thing',
    method: 'GET',
    operationId: 'example_thing',
    summary: 'Get a thing',
    description: '',
    tags: ['Example'],
    parameters: [],
    requestBody: null,
    'x-ui-page': null,
    'x-oeo-class': null,
    ...overrides,
  };
}

describe('operation-capability-classifier', () => {
  // -------------------------------------------------------------------------
  // deriveServiceSlug / deriveActionRef
  // -------------------------------------------------------------------------
  describe('deriveServiceSlug', () => {
    it('extracts the service segment from a normal API path', () => {
      expect(deriveServiceSlug('/api/gas-storage/country-storage')).toBe('gas-storage');
    });
    it('maps agent-manifest meta paths to the agent-manifest service', () => {
      expect(deriveServiceSlug('/api/_agent/capabilities')).toBe('agent-manifest');
    });
    it('falls back to unknown for unrecognized paths', () => {
      expect(deriveServiceSlug('/health')).toBe('unknown');
    });
  });

  describe('deriveActionRef', () => {
    it('builds service.action from a `${service}_${action}` operationId', () => {
      expect(deriveActionRef('gas-storage', 'gas-storage_countryStorage')).toBe(
        'gas-storage.countryStorage'
      );
    });
    it('returns null when the operationId has no service prefix', () => {
      expect(deriveActionRef('gas-storage', 'someCustomId')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // operationKind classification, by representative category
  // -------------------------------------------------------------------------
  describe('operationKind classification', () => {
    it('classifies a plain GET as data_read', () => {
      const result = classifyOperation(buildOp());
      expect(result.operationKind).toBe('data_read');
      expect(result.consequenceLevel).toBe('none');
      expect(result.recommendedExecutionMode).toBe('direct');
    });

    it('classifies a GET tagged for the dashboard as dashboard_read', () => {
      const result = classifyOperation(
        buildOp({ path: '/api/dashboard-api/overview', operationId: 'dashboard-api_overview', tags: ['Dashboard API'] })
      );
      expect(result.operationKind).toBe('dashboard_read');
    });

    it('classifies a POST on a curated read-only-query service as data_read, not a write', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/energy-market/prices',
          method: 'POST',
          operationId: 'energy-market_prices',
          summary: 'Electricity market prices (day-ahead, intraday, futures)',
          tags: ['Energy Market Data'],
        })
      );
      expect(result.operationKind).toBe('data_read');
      expect(result.consequenceLevel).toBe('none');
      expect(result.recommendedExecutionMode).toBe('direct');
    });

    it('keeps deterministic tabular plan execution read-only despite the execute verb', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/tabular/execute-plan',
          method: 'POST',
          operationId: 'tabular_executePlan',
          summary: 'Execute a validated tabular plan deterministically',
          tags: ['Tabular Intelligence'],
        })
      );
      expect(result.operationKind).toBe('data_read');
      expect(result.sideEffects).toEqual([]);
      expect(result.requiredScopes).toEqual(['tabular:read']);
    });

    // Regression test: "start"/"stop" and other generic English words
    // appearing inside prose parameter documentation (not the operation's
    // own summary/tags/operationId/path) must not misclassify an otherwise
    // read-only query as a mutating operation. See MUTATING_VERB_PATTERN /
    // structuredTextBlob in operation-capability-classifier.js.
    it('does not let a mutating word inside free-text description prose flip a read-only query to a write', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/energy-market/production',
          method: 'POST',
          operationId: 'energy-market_production',
          summary: 'Electricity generation data by energy source',
          description:
            'Query generation data.\n- **startDate**: Start date (YYYY-MM-DD)\n- **endDate**: End date (YYYY-MM-DD)\n' +
            'Range start (YYYY-MM-DD) to range end. Excel import with format=csv.',
          tags: ['Energy Market Data'],
        })
      );
      expect(result.operationKind).toBe('data_read');
    });

    it('classifies a mutating verb in the summary as a write even on a curated read-only-query service', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/assets/thing/override',
          method: 'POST',
          operationId: 'assets_createOverride',
          summary: 'Create persistent asset override',
          tags: ['Assets'],
        })
      );
      expect(result.operationKind).not.toBe('data_read');
      expect(result.operationKind).toBe('object_store_write');
    });

    it('classifies a draft/intent write as draft_write with prepare execution mode', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/blueprints/draft',
          method: 'POST',
          operationId: 'blueprints_proposeDraft',
          summary: 'Propose a draft blueprint intent',
          tags: ['Blueprints'],
        })
      );
      expect(result.operationKind).toBe('draft_write');
      expect(result.recommendedExecutionMode).toBe('prepare');
      expect(result.sideEffects).toContain('creates_draft_or_intent');
    });

    it('classifies a plain object store write as object_store_write', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/agent-persona/thing',
          method: 'POST',
          operationId: 'agent-persona_update',
          summary: 'Update an actor persona',
          tags: ['Actor Personas'],
        })
      );
      expect(result.operationKind).toBe('object_store_write');
      expect(result.consequenceLevel).toBe('medium');
    });

    it('classifies a process-start verb as process_start with confirm execution mode', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/vdmi/matrix/start',
          method: 'POST',
          operationId: 'vdmi_startMatrix',
          summary: 'Start a VDMI decision matrix process',
          tags: ['VDMI'],
        })
      );
      expect(result.operationKind).toBe('process_start');
      expect(result.consequenceLevel).toBe('high');
      expect(result.recommendedExecutionMode).toBe('confirm');
    });

    it('classifies a process-step verb (approve/reject/rollback) as process_step', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/vdmi/matrix/approve',
          method: 'POST',
          operationId: 'vdmi_approveMatrix',
          summary: 'Approve a pending VDMI matrix step',
          tags: ['VDMI'],
        })
      );
      expect(result.operationKind).toBe('process_step');
    });

    it('classifies admin/quota/backup operations as admin with confirm execution mode', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/backup-orchestrator/snapshot',
          method: 'POST',
          operationId: 'backup-orchestrator_snapshot',
          summary: 'Create a full backup snapshot (all data stores)',
          tags: ['Backup & Restore'],
        })
      );
      expect(result.operationKind).toBe('admin');
      expect(result.consequenceLevel).toBe('high');
      expect(result.recommendedExecutionMode).toBe('confirm');
    });

    it('classifies external-system-facing operations as external_effect', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/nomination-gateway/send',
          method: 'POST',
          operationId: 'nomination-gateway_send',
          summary: 'Send an email notification for an ENTSO-E nomination',
          tags: ['Nomination Gateway'],
        })
      );
      expect(result.operationKind).toBe('external_effect');
      expect(result.recommendedExecutionMode).toBe('confirm');
    });

    it('classifies system-internal spec endpoints as internal and non-agentable', () => {
      const result = classifyOperation(buildOp({ path: '/api/openapi.json', method: 'GET', operationId: 'openapi_json' }));
      expect(result.operationKind).toBe('internal');
      expect(result.agentable).toBe(false);
      expect(result.nonAgentableReason).toEqual(expect.any(String));
      expect(result.recommendedExecutionMode).toBe('explain_only');
    });

    it('bumps a DELETE to confirm execution mode regardless of its base kind', () => {
      const result = classifyOperation(
        buildOp({
          path: '/api/backup-orchestrator/snapshot/1',
          method: 'DELETE',
          operationId: 'backup-orchestrator_delete',
          summary: 'Delete a backup snapshot',
          tags: ['Backup & Restore'],
        })
      );
      expect(result.recommendedExecutionMode).toBe('confirm');
    });
  });

  // -------------------------------------------------------------------------
  // enum + shape invariants (protects the "never silently mis-shape" contract)
  // -------------------------------------------------------------------------
  describe('output shape invariants', () => {
    it('always returns a value from the documented enums', () => {
      const result = classifyOperation(buildOp());
      expect(OPERATION_KINDS).toContain(result.operationKind);
      expect(CONSEQUENCE_LEVELS).toContain(result.consequenceLevel);
      expect(EXECUTION_MODES).toContain(result.recommendedExecutionMode);
    });

    it('always includes parameters.required / parameters.optional arrays', () => {
      const result = classifyOperation(
        buildOp({
          method: 'POST',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['country'],
                  properties: {
                    country: { type: 'string', description: 'ISO country code' },
                    limit: { type: 'number' },
                  },
                },
              },
            },
          },
        })
      );
      expect(result.parameters.required.map((p) => p.name)).toEqual(['country']);
      expect(result.parameters.optional.map((p) => p.name)).toEqual(['limit']);
    });

    it('gives every operation non-empty rankingSignals.examples', () => {
      const result = classifyOperation(buildOp());
      expect(result.rankingSignals.examples.length).toBeGreaterThan(0);
    });
  });
});
