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
    version: '1',
    status: 'active',

    matchConditions: {
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

    requiredInputs: [
      { field: 'city', label: 'Ort/Gemeinde', priority: 'critical', required: false },
      { field: 'bdewCode', label: 'BDEW-Code', priority: 'critical', required: false },
      { field: 'vnbName', label: 'Netzbetreiber-Name', priority: 'normal', required: false },
    ],

    toolPlan: {
      steps: [
        {
          step: 1,
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
          evidence: { requirement: 'completed', fields: ['vnbName', 'bdew'] },
          fallbackActions: ['grid-operations.marketPartners'],
        },
      ],
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
    createdAt: new Date().toISOString(),
  },
]);

module.exports = {
  RECEIPT_SEEDS,
};
