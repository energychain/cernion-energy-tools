'use strict';

/**
 * Evidence Router Service (issue energychain/cernion-energy-tools#272).
 *
 * Read-only Evidence Router / Lookup-Service contract for foreign orchestrators
 * (OpenClaw, CoPilot, Hermes, ...). See src/evidence-router.js for the matching
 * logic and src/evidence-endpoint-catalog.js for the curated endpoint catalog.
 *
 * Completely separate from the Process Intake / Write Boundary contract
 * (services/copilot-process.service.js#prepareProcessIntent) — different
 * service, different response shape (`resolved.kind: 'evidence_plan'` vs
 * `'process_intake'`), never mutates, never creates process side effects,
 * never synthesizes the final user-facing answer.
 */

const { routeEvidence } = require('../src/evidence-router');

const OPENAPI_TAG = 'Evidence Router';

module.exports = {
  name: 'evidence-router',

  actions: {
    route: {
      rest: 'POST /route',
      params: {
        question: { type: 'string', min: 1, trim: true, max: 8000 },
        context: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        operationId: 'evidenceRouterRoute',
        tags: [OPENAPI_TAG],
        summary: 'Recommend read-only evidence endpoints for a request (never executes, never answers)',
        description:
          'Infers which evidence type(s) (resultKind, e.g. time_series, asset_table, market_signal) the request needs, ' +
          'then matches them against a curated read-only endpoint catalog. Recommends one or more approved read-only ' +
          'endpoints with fachliche result semantics, and reports coverage/missing evidence types. Never substitutes ' +
          'an unrelated endpoint when the required evidence type is unavailable (coverage.noSubstitution is always true). ' +
          'Never mutates state, never creates process side effects, never synthesizes the final user-facing answer — ' +
          'that remains the responsibility of the consuming agent/orchestrator. ' +
          'Distinct from the Process Intake / Write Boundary contract (POST /api/copilot-process/intents): this action ' +
          'only ever recommends GET/POST read-only lookups, never process/write intents.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['question'],
                properties: {
                  question: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 8000,
                    description: 'Natural-language request describing the evidence needed.',
                    example: 'Wie hoch ist die CO2-Intensität in den nächsten 24 Stunden in 69168?',
                  },
                  context: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'Optional canonical input values (location, dateFrom, dateTo, assetType, ...).',
                  },
                },
              },
              examples: {
                timeSeries: {
                  summary: 'Time-series / CO2 evidence request',
                  value: {
                    question: 'Wie hoch ist die CO2-Intensität in den nächsten 24 Stunden in 69168?',
                    context: { location: '69168' },
                  },
                },
                assetTable: {
                  summary: 'Asset-table evidence request',
                  value: {
                    question: 'Liste aller Solaranlagen in 69168',
                    context: { assetType: 'solar', location: '69168' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Evidence Router response — recommendation, never an executed result or final answer.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'resolved', 'requiredEvidenceTypes', 'recommendedEndpoints', 'coverage', 'nextStep'],
                  properties: {
                    success: { type: 'boolean' },
                    resolved: {
                      type: 'object',
                      properties: {
                        kind: { type: 'string', example: 'evidence_plan' },
                        source: { type: 'string', example: 'evidence_router' },
                      },
                    },
                    requiredEvidenceTypes: { type: 'array', items: { type: 'string' } },
                    recommendedEndpoints: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          purpose: { type: 'string' },
                          method: { type: 'string' },
                          path: { type: 'string' },
                          query: { type: 'object', additionalProperties: true },
                          resultKind: { type: 'string' },
                          semanticFacts: { type: 'array', items: { type: 'string' } },
                          freshness: { type: 'string' },
                          granularity: { type: 'string' },
                          timeRangeSupport: { type: 'boolean' },
                          requiredInputs: { type: 'array', items: { type: 'string' } },
                          optionalInputs: { type: 'array', items: { type: 'string' } },
                          policy: {
                            type: 'object',
                            properties: {
                              readOnly: { type: 'boolean' },
                              sideEffects: { type: 'string' },
                              tenantScoped: { type: 'boolean' },
                              externalSideEffects: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                    coverage: {
                      type: 'object',
                      properties: {
                        coveredEvidenceTypes: { type: 'array', items: { type: 'string' } },
                        missingEvidenceTypes: { type: 'array', items: { type: 'string' } },
                        noSubstitution: { type: 'boolean', example: true },
                      },
                    },
                    nextStep: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return routeEvidence({
          question: ctx.params.question,
          context: ctx.params.context || {},
          broker: ctx.broker,
        });
      },
    },
  },
};
