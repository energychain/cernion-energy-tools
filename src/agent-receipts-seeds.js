'use strict';

/**
 * Agent Receipts Seeds
 *
 * Seeded receipts that are registered on service startup.
 *
 * v0.54.3: vnb-lookup-v1 — direct VNB lookup when operatorScope (bdew/vnbName) is available.
 * v0.54.6: vnb-resolution-chain-v1 — 2-step VNB resolution for city/location-only queries.
 *
 * Scope model:
 *   vnb-lookup-v1               → requires operatorScope (bdew OR vnbName)
 *   vnb-resolution-chain-v1     → requires locationScope; resolves operatorScope via step 1
 */

const RECEIPT_SEEDS = Object.freeze([
  {
    receiptId: 'vnb-lookup-v1',
    version: 2,
    status: 'active',
    title: 'VNB lookup (operator scope — bdew or vnbName required)',
    description:
      'Direct deterministic VNB/BDEW lookup. Requires operator identity context (bdew or vnbName). ' +
      'For city/location-only queries use vnb-resolution-chain-v1 instead.',
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
          step: 1,
          action: 'grid-operations.vnbLookup',
          description: 'Direct lookup by BDEW code or VNB name (operator scope)',
          // Domain rule: operatorScope required. city alone is NOT sufficient for this step.
          requiredScopes: ['operatorScope'],
          paramMapping: {
            bdew: {
              source: 'context',
              contextField: 'bdewCode',
              derivationHint: 'Use BDEW code if provided — must be 5–13 digits',
            },
            vnbName: {
              source: 'context',
              contextField: 'vnbName',
              derivationHint: 'Grid operator name (e.g. Netze BW, Bayernwerk)',
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
        query: 'VNB Zuständigkeit Netzgebiet BDEW {{context.knownContext.bdew}} {{context.knownContext.vnbName}} {{message}}',
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
      unverifiedAnswer: 'No grid operator found. Provide BDEW code or operator name.',
    },

    forbiddenInferences: ['unverified_vnb_claim'],

    responsePolicy: {
      verified: 'Return full VNB record with BDEW, name, contact',
      partial: 'Surface which field is missing (name vs. code)',
      unverified: 'Ask for BDEW code or operator name: "Welchen Netzbetreiber oder BDEW-Code meinst du?"',
      timeout: 'Grid lookup timed out; try again or contact support',
    },

    tags: ['grid-operations', 'vnb', 'bdew', 'operator-scope', 'v0.54.6'],
    defaults: {},
    metadata: {},
  },

  {
    receiptId: 'vnb-resolution-chain-v1',
    version: 1,
    status: 'active',
    title: 'VNB Resolution Chain (location scope — city/postalCode)',
    description:
      'Two-step VNB resolution for city/location-only queries. ' +
      'Step 1: marketPartners resolves operator candidates from locationScope. ' +
      'Step 2: vnbLookup confirms identity using step 1 result (operatorScope). ' +
      'city/postalCode alone never substitutes for operator identity (bdew/vnbName).',
    domain: 'grid-operations',

    matching: {
      domains: ['grid-operations'],
      triggerTerms: [
        'vnb',
        'netzbetreiber',
        'netzgebiet',
        'zuständig',
        'stromnetz',
        'verteilnetz',
        'wer ist',
        'wer bedient',
      ],
      workflowTypes: ['vnb_identification'],
      requiredEntities: [],
    },

    requiredInputs: [],

    toolPlan: {
      steps: [
        {
          step: 1,
          action: 'grid-operations.marketPartners',
          description: 'Resolve operator candidates from location (locationScope)',
          // This step uses locationScope to produce operator candidates
          requiredScopes: ['locationScope'],
          paramMapping: {
            query: {
              source: 'context',
              contextField: 'city',
              derivationHint: 'Use city/municipality as search query',
            },
            limit: {
              source: 'default',
              defaultKey: 'marketPartnersLimit',
              value: 5,
            },
          },
          required: true,
          evidence: {
            requiredOutputFields: ['results'],
          },
        },
        {
          step: 2,
          action: 'grid-operations.vnbLookup',
          description: 'Confirm VNB identity using resolved operator from step 1 (operatorScope)',
          // This step requires operatorScope — resolved via __step_1 references
          requiredScopes: ['operatorScope'],
          paramMapping: {
            bdew: {
              source: 'fixed',
              value: '__step_1.data.results[0].bdewCode',
              derivationHint: 'Use BDEW code from top marketPartners candidate (VNB-ordered)',
            },
            city: {
              source: 'fixed',
              value: '__step_1.data.results[0].contacts[0].city',
              derivationHint: 'Use city from top marketPartners candidate for disambiguation',
            },
          },
          required: true,
          evidence: {
            requiredOutputFields: ['vnbName', 'bdew'],
          },
        },
      ],
    },

    knowledgeQueries: [
      {
        id: 'vnb-resolution-context',
        queryType: 'semantic',
        query: 'VNB Zuständigkeit Netzgebiet Ort {{context.knownContext.city}} {{message}}',
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
        candidates_only: 'marketPartners returned candidates but vnbLookup not confirmed',
      },
      unverifiedAnswer:
        'No confirmed VNB found for location. Provide operator name or BDEW code for a direct lookup.',
    },

    forbiddenInferences: ['unverified_vnb_claim'],

    responsePolicy: {
      verified: 'Return confirmed VNB with BDEW, name, contact from vnbLookup result',
      partial: 'Show marketPartners candidates with note that identity is not confirmed',
      unverified:
        'Ask for disambiguation: "Welchen Netzbetreiber meinst du?" or provide BDEW code',
      timeout: 'VNB resolution timed out; provide BDEW code for a direct lookup',
    },

    tags: ['grid-operations', 'vnb', 'location-scope', 'resolution-chain', 'v0.54.6'],
    defaults: {
      marketPartnersLimit: 5,
    },
    metadata: {},
  },

  {
    receiptId: 'netzbetreiber-flexibility-potential-v1',
    version: 1,
    status: 'active',
    title: 'Netzbetreiber-Flexibilitätspotenzial Executive Briefing',
    description:
      'Toolplan für Geschäftsführer-/Leiter-Netz-Dialoge: §14a, Redispatch 2.0, MaStR/Assets, Rückspeisespitzen und Ansiedlungsempfehlung mit Zahlen- und Quellenpflicht.',
    domain: 'grid-operations',

    matching: {
      domains: ['grid-operations'],
      triggerTerms: [
        'netzbetreiber',
        'geschäftsführer',
        'geschaeftsfuehrer',
        'leiter netz',
        'stadtwerke tübingen',
        'stadtwerke tuebingen',
        'flexibilitätspotenzial',
        'flexibilitaetspotenzial',
        '§14a',
        '14a',
        'redispatch 2.0',
        'rückspeisespitzen',
        'rueckspeisespitzen',
        'netzausbaukosten',
        'großverbraucher',
        'grossverbraucher',
        'gleichzeitigkeitsfaktor',
      ],
      workflowTypes: [
        'grid_operator_executive_briefing',
        'flexibility_potential_assessment',
        'network_planning_preparation',
      ],
      requiredEntities: [],
    },

    requiredInputs: [],

    toolPlan: {
      steps: [
        {
          step: 1,
          action: 'grid-operations.vnbLookup',
          description: 'Resolve or confirm grid operator identity before numeric conclusions',
          requiredScopes: ['operatorScope'],
          paramMapping: {
            vnbName: {
              source: 'context',
              contextField: 'vnbName',
              derivationHint: 'Use operator name, e.g. Stadtwerke Tübingen',
            },
            bdew: {
              source: 'context',
              contextField: 'bdewCode',
              derivationHint: 'Use BDEW code if available',
            },
            query: {
              source: 'context',
              contextField: 'city',
              derivationHint: 'Use city/municipality only as a fallback search term',
            },
            limit: {
              source: 'default',
              defaultKey: 'operatorLookupLimit',
              value: 5,
            },
          },
          required: true,
          evidence: {
            requiredOutputFields: ['vnbName', 'bdew', 'mastrId'],
          },
          fallbackActions: ['grid-operations.marketPartners'],
        },
        {
          step: 2,
          action: 'grid-operations.operatorAnalysis',
          description:
            'Collect operator-level installation, feed-in pattern, capacity-map and Redispatch analysis',
          paramMapping: {
            gridOperator: {
              source: 'context',
              contextField: 'vnbName',
              derivationHint: 'Operator name when MaStR/BDEW identity is not yet available',
            },
            gridOperatorId: {
              source: 'fixed',
              value: '__step_1.data.mastrId',
              derivationHint: 'Use confirmed MaStR grid operator ID from identity lookup',
            },
            gridOperatorBdewCode: {
              source: 'fixed',
              value: '__step_1.data.bdew',
              derivationHint: 'Use confirmed BDEW code from identity lookup',
            },
            includeRedispatch: {
              source: 'fixed',
              value: true,
            },
            includeFeedInPatterns: {
              source: 'fixed',
              value: true,
            },
            includeCapacityMap: {
              source: 'fixed',
              value: true,
            },
          },
          required: true,
          evidence: {
            requiredOutputFields: ['installations', 'redispatch', 'feedInPatterns'],
          },
        },
        {
          step: 3,
          action: 'assets.redispatchCount',
          description:
            'Fast numeric aggregation of Redispatch 2.0 eligible assets (>=100 kW) with capacity by type',
          paramMapping: {
            gridOperatorId: {
              source: 'fixed',
              value: '__step_1.data.mastrId',
              derivationHint: 'Use confirmed MaStR grid operator ID when available',
            },
            bdewCode: {
              source: 'fixed',
              value: '__step_1.data.bdew',
              derivationHint: 'Fallback to confirmed BDEW code',
            },
          },
          required: true,
          evidence: {
            requiredOutputFields: ['count', 'totalCapacityMW', 'byType'],
          },
        },
        {
          step: 4,
          action: 'dashboard-api.redispatchMeteringCockpit',
          description:
            'Readiness cockpit for Redispatch, metering, master data and governance blockers',
          paramMapping: {
            gridOperatorId: {
              source: 'fixed',
              value: '__step_1.data.mastrId',
              derivationHint: 'Use confirmed MaStR grid operator ID when available',
            },
            bdewCode: {
              source: 'fixed',
              value: '__step_1.data.bdew',
              derivationHint: 'Fallback to confirmed BDEW code',
            },
          },
          required: false,
          evidence: {
            requiredOutputFields: ['decisionReadiness', 'evidence', 'blockingEvidenceGaps'],
          },
        },
        {
          step: 5,
          action: 'grid-operations.controlMeasures',
          description: 'Query §14a control measures for controllable load flexibility',
          paramMapping: {
            searchType: {
              source: 'fixed',
              value: 'vnb',
            },
            vnbId: {
              source: 'fixed',
              value: '__step_1.data.mastrId',
              derivationHint: 'Use confirmed VNB/MaStR ID for §14a control measures',
            },
          },
          required: false,
          evidence: {
            requiredOutputFields: ['result', 'measures'],
          },
        },
      ],
    },

    knowledgeQueries: [
      {
        id: 'netzbetreiber-flexibility-context',
        queryType: 'semantic',
        query:
          'Netzbetreiber Flexibilitätspotenzial §14a Redispatch 2.0 Rückspeisespitzen Großverbraucher {{context.knownContext.vnbName}} {{context.knownContext.city}} {{message}}',
        limit: 3,
        summaryMaxChars: 260,
      },
    ],

    knowledgeEvidencePolicy: {
      required: false,
      timeoutBehavior: 'degraded',
    },

    evidencePolicy: {
      verifyingObservations: [
        {
          action: 'assets.redispatchCount',
          requiredStatus: 'completed',
          requiredFields: ['count', 'totalCapacityMW'],
        },
        {
          action: 'grid-operations.operatorAnalysis',
          requiredStatus: 'completed',
          requiredFields: ['installations', 'redispatch'],
        },
      ],
      partialAcceptance: {
        identity_only:
          'Operator identity resolved, but asset/flexibility evidence is still incomplete',
        redispatch_only:
          'Redispatch eligible capacity is known, but §14a controllable load evidence is missing',
        section14a_only:
          '§14a control-measure evidence is known, but Redispatch asset capacity is missing',
      },
      unverifiedAnswer:
        'No numeric flexibility claim may be made without MaStR/asset, Redispatch and §14a evidence.',
    },

    forbiddenInferences: [
      'unverified_mw_capacity_claim',
      'topology_free_grid_capacity_commitment',
      'ee_growth_harmless_without_congestion_evidence',
    ],

    responsePolicy: {
      verified:
        'Lead with a Markdown table: metric, value, source, confidence, decision relevance; then give executive recommendation.',
      partial:
        'Lead with available verified numbers and mark missing values as evidence gaps, not assumptions.',
      unverified:
        'Do not estimate MW potential. Ask for operator ID/BDEW and asset/topology evidence.',
      timeout:
        'Return the available evidence table and list timed-out sources separately.',
    },

    tags: [
      'grid-operations',
      'netzbetreiber',
      'flexibility',
      'redispatch',
      '14a',
      'executive-briefing',
      'v0.55.x',
    ],
    defaults: {
      operatorLookupLimit: 5,
    },
    metadata: {
      blueprintId: 'netzbetreiber-flexibility-potential-v1',
      sourcePriority: [
        'MaStR/Assets',
        'Redispatch Metering Cockpit',
        'VNBdigital §14a',
        'Grid operator analysis',
      ],
      tableFirst: true,
    },
  },
]);

module.exports = {
  RECEIPT_SEEDS,
};
