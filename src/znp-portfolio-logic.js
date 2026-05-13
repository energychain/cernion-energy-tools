'use strict';

const PORTFOLIO_WEG = 'hybrid_layered_v1';

const PROVENANCE_DEFINITIONS = Object.freeze({
  mastr_layer_0: {
    reliability: 0.9,
    source: 'MaStR Layer 0',
  },
  inhouse_layer_2: {
    reliability: 0.98,
    source: 'Inhouse PDF Layer 2',
  },
  strategic_assumption: {
    reliability: 0.55,
    source: 'Strategic Assumption Layer 2.5',
  },
});

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 100) return 100;
  return Math.round(numeric * 10) / 10;
}

function safeShare(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  if (!Number.isFinite(numerator) || numerator <= 0) return 0;
  return numerator / denominator;
}

function buildProvenanceFlags(metrics) {
  const flags = [];

  if (metrics.mastrAssetCount > 0) {
    flags.push({
      provenance: 'mastr_layer_0',
      source: PROVENANCE_DEFINITIONS.mastr_layer_0.source,
      reliability: PROVENANCE_DEFINITIONS.mastr_layer_0.reliability,
      assetCount: metrics.mastrAssetCount,
      capacityKW: Math.round(metrics.mastrCapacityKW * 100) / 100,
    });
  }

  if (metrics.hasLayer2Measurement) {
    flags.push({
      provenance: 'inhouse_layer_2',
      source: PROVENANCE_DEFINITIONS.inhouse_layer_2.source,
      reliability: PROVENANCE_DEFINITIONS.inhouse_layer_2.reliability,
      measurementCount: 1,
      measuredPeakLoadKW: Math.round(metrics.measuredPeakLoadKW * 100) / 100,
    });
  }

  if (metrics.assumptionCount > 0) {
    flags.push({
      provenance: 'strategic_assumption',
      source: PROVENANCE_DEFINITIONS.strategic_assumption.source,
      reliability: PROVENANCE_DEFINITIONS.strategic_assumption.reliability,
      assumptionCount: metrics.assumptionCount,
      capacityKW: Math.round(metrics.assumptionCapacityKW * 100) / 100,
    });
  }

  return flags;
}

function computeReliabilityScore(flags) {
  if (!Array.isArray(flags) || flags.length === 0) return 0;

  const total = flags.reduce((acc, flag) => acc + (flag.reliability || 0), 0);
  return clampScore((total / flags.length) * 100);
}

function computeEconomicScore(metrics) {
  const controllableShare = safeShare(metrics.controllableAssetCount, metrics.mastrAssetCount);
  const measuredBonus = metrics.hasLayer2Measurement ? 9 : 0;
  const strategicPenalty = Math.min(18, metrics.assumptionCount * 4);

  return clampScore(58 + controllableShare * 32 + measuredBonus - strategicPenalty);
}

function computeRegulatoryScore(metrics) {
  const base = 82;
  const fnavPenalty = metrics.missingFnavApproval ? 45 : 0;
  const strategicPenalty = metrics.assumptionCount > 0 ? 8 : 0;
  const measuredBonus = metrics.hasLayer2Measurement ? 6 : 0;

  return clampScore(base + measuredBonus - strategicPenalty - fnavPenalty);
}

function computeTechnicalScore(metrics) {
  const measuredRatio = safeShare(metrics.measuredPeakLoadKW, metrics.mastrCapacityKW);
  const ratioStability = measuredRatio > 0 ? Math.max(0, 1 - Math.abs(1 - measuredRatio)) : 0.65;
  const assumptionPenalty = Math.min(20, metrics.assumptionCount * 3.5);

  return clampScore(52 + ratioStability * 36 - assumptionPenalty);
}

function computeTemporalScore(metrics) {
  const ageHours = Number.isFinite(metrics.dataAgeHours) ? metrics.dataAgeHours : 24 * 30;
  const freshnessScore = Math.max(0, 1 - Math.min(ageHours, 24 * 90) / (24 * 90));
  const measuredBonus = metrics.hasLayer2Measurement ? 10 : 0;

  return clampScore(50 + freshnessScore * 40 + measuredBonus);
}

function computePortfolioAssessment(metrics) {
  const provenanceFlags = buildProvenanceFlags(metrics);
  const dimensionScores = {
    economic: computeEconomicScore(metrics),
    regulatory: computeRegulatoryScore(metrics),
    technical: computeTechnicalScore(metrics),
    temporal: computeTemporalScore(metrics),
  };

  const overallScore = clampScore(
    (dimensionScores.economic +
      dimensionScores.regulatory +
      dimensionScores.technical +
      dimensionScores.temporal) /
      4
  );

  return {
    portfolio: {
      weg: PORTFOLIO_WEG,
      provenanceFlags,
      reliabilityScore: computeReliabilityScore(provenanceFlags),
    },
    dimensionScores,
    overallScore,
  };
}

module.exports = {
  PORTFOLIO_WEG,
  PROVENANCE_DEFINITIONS,
  computePortfolioAssessment,
};
