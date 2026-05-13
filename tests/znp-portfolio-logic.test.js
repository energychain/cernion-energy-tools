const {
  PORTFOLIO_WEG,
  computePortfolioAssessment,
} = require('../src/znp-portfolio-logic');

describe('znp-portfolio-logic', () => {
  it('returns portfolio.weg and all four dimension scores', () => {
    const result = computePortfolioAssessment({
      mastrAssetCount: 12,
      mastrCapacityKW: 420,
      controllableAssetCount: 4,
      hasLayer2Measurement: true,
      measuredPeakLoadKW: 300,
      assumptionCount: 1,
      assumptionCapacityKW: 120,
      missingFnavApproval: false,
      dataAgeHours: 8,
    });

    expect(result.portfolio.weg).toBe(PORTFOLIO_WEG);
    expect(result.dimensionScores).toEqual(
      expect.objectContaining({
        economic: expect.any(Number),
        regulatory: expect.any(Number),
        technical: expect.any(Number),
        temporal: expect.any(Number),
      })
    );
    expect(result.overallScore).toEqual(expect.any(Number));
  });

  it('emits provenance flags for all available layers', () => {
    const result = computePortfolioAssessment({
      mastrAssetCount: 10,
      mastrCapacityKW: 200,
      controllableAssetCount: 2,
      hasLayer2Measurement: true,
      measuredPeakLoadKW: 120,
      assumptionCount: 2,
      assumptionCapacityKW: 80,
      missingFnavApproval: false,
      dataAgeHours: 24,
    });

    const provenance = result.portfolio.provenanceFlags.map((item) => item.provenance);
    expect(provenance).toContain('mastr_layer_0');
    expect(provenance).toContain('inhouse_layer_2');
    expect(provenance).toContain('strategic_assumption');
  });

  it('penalizes regulatory score when fNAV approval is missing', () => {
    const approved = computePortfolioAssessment({
      mastrAssetCount: 8,
      mastrCapacityKW: 300,
      controllableAssetCount: 3,
      hasLayer2Measurement: true,
      measuredPeakLoadKW: 180,
      assumptionCount: 0,
      assumptionCapacityKW: 0,
      missingFnavApproval: false,
      dataAgeHours: 6,
    });

    const blocked = computePortfolioAssessment({
      mastrAssetCount: 8,
      mastrCapacityKW: 300,
      controllableAssetCount: 3,
      hasLayer2Measurement: true,
      measuredPeakLoadKW: 180,
      assumptionCount: 0,
      assumptionCapacityKW: 0,
      missingFnavApproval: true,
      dataAgeHours: 6,
    });

    expect(blocked.dimensionScores.regulatory).toBeLessThan(approved.dimensionScores.regulatory);
  });
});
