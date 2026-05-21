#!/usr/bin/env node
'use strict';

const PersonalAgentService = require('../services/personal-agent.service');

const MIN_GROUNDEDNESS = 0.75;
const MAX_UNCERTAINTY = 0.35;

function fail(message, details = {}) {
  const payload = {
    success: false,
    gate: 'personal-agent-quality',
    message,
    ...details,
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

function pass(details = {}) {
  const payload = {
    success: true,
    gate: 'personal-agent-quality',
    details,
  };
  console.log(JSON.stringify(payload, null, 2));
}

function main() {
  const buildQualitySummary = PersonalAgentService?.methods?.buildQualitySummary;
  if (typeof buildQualitySummary !== 'function') {
    fail('buildQualitySummary method is not available');
  }

  const strongEvidence = buildQualitySummary({
    evidencePlan: {
      confidence: 0.82,
      gaps: [],
    },
    execution: { status: 'completed' },
  });

  const groundednessScore = strongEvidence?.groundedness?.score;
  const uncertaintyScore = strongEvidence?.uncertainty?.score;

  if (typeof groundednessScore !== 'number' || typeof uncertaintyScore !== 'number') {
    fail('Quality summary did not return numeric scores', { strongEvidence });
  }

  if (groundednessScore < MIN_GROUNDEDNESS) {
    fail('Groundedness score below release threshold', {
      expectedMin: MIN_GROUNDEDNESS,
      groundednessScore,
      strongEvidence,
    });
  }

  if (uncertaintyScore > MAX_UNCERTAINTY) {
    fail('Uncertainty score above release threshold', {
      expectedMax: MAX_UNCERTAINTY,
      uncertaintyScore,
      strongEvidence,
    });
  }

  const weakEvidence = buildQualitySummary({
    evidencePlan: {
      confidence: 0.35,
      gaps: [{ id: 'missing_grid_data' }],
    },
    execution: { status: 'partial' },
  });

  if (weakEvidence?.uncertainty?.requiresHITL !== true) {
    fail('Weak evidence case must require HITL', { weakEvidence });
  }

  pass({
    thresholds: {
      minGroundedness: MIN_GROUNDEDNESS,
      maxUncertainty: MAX_UNCERTAINTY,
    },
    strongEvidence,
    weakEvidence,
  });
}

main();
