'use strict';

/**
 * Agent Receipts Seeds
 *
 * Seeded receipts that are registered on service startup.
 * v0.54.3 introduces the first production receipt: vnb-lookup-v1
 */

const RECEIPT_SEEDS = Object.freeze([
  {
    receiptId: 'vnb-lookup-v1',
    version: 1,
    status: 'active',
    title: 'VNB lookup baseline',
    description:
      'Deterministic VNB/BDEW lookup receipt with conservative fallback and optional knowledge support.',
    domain: 'grid-operations',

    matching: {
      domains: ['grid-operations'],
      triggerTerms: [
        'vnb',
        'bdew',
        'netzbetreiber',
        'netzgebiet',
        'zuständig',
        'stromnetz',
        'ünb',
        'verteilnetz',
      ],
      workflowTypes: ['vnb_identification'],
      requiredEntities: [],
    },

    requiredInputs: [],

    toolPlan: {
      steps: [
        {
          action: 'grid-operations.vnbLookup',
          description: 'Primary lookup by BDEW, city, or name',
          paramMapping: {
            bdew: {
              source: 'context',
              contextField: 'bdewCode',
              derivationHint: 'Use BDEW if provided',
            },
            city: {
              source: 'context',
              contextField: 'city',
              derivationHint: 'Use municipality if provided',
            },
            vnbName: {
              source: 'context',
              contextField: 'vnbName',
              derivationHint: 'Grid operator name',
            },
          },
          required: true,
          evidence: {
            requiredOutputFields: ['vnbName', 'bdew'],
          },
          fallbackActions: ['grid-operations.marketPartners'],
        },
      ],
    },

    knowledgeQueries: [
      {
        id: 'vnb-regulatory-context',
        queryType: 'semantic',
        query: 'VNB Zuständigkeit Netzgebiet BDEW {{context.knownContext.city}} {{context.knownContext.bdew}} {{message}}',
        limit: 2,
        summaryMaxChars: 220,
      },
    ],

    knowledgeEvidencePolicy: {
      required: false,
      timeoutBehavior: 'degraded',
    },

    evidencePolicy: {
      verifyingObservations: [
        {
          action: 'grid-operations.vnbLookup',
          requiredStatus: 'completed',
          requiredFields: ['vnbName', 'bdew'],
        },
      ],
      partialAcceptance: {
        name_found_no_code: 'Grid operator name found; BDEW code missing',
        code_found_no_name: 'BDEW code found; operator name missing',
      },
      unverifiedAnswer: 'No grid operator found for given input; ask for location or BDEW code',
    },

    forbiddenInferences: ['unverified_vnb_claim'],

    responsePolicy: {
      verified: 'Return full VNB record with BDEW, name, contact',
      partial: 'Surface which field is missing (name vs. code)',
      unverified: 'Ask for missing context: "Für welchen Ort/BDEW-Code suchst du?"',
      timeout: 'Grid lookup timed out; try again or contact support',
    },

    tags: ['grid-operations', 'vnb', 'bdew', 'location', 'v0.54.3'],
    defaults: {},
    metadata: {},
  },
]);

module.exports = {
  RECEIPT_SEEDS,
};
