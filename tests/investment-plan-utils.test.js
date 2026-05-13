const {
  INVESTMENT_TRIGGER_THRESHOLD_EUR,
  PROVENANCE,
  buildSollBaselines,
  buildSollIstComparison,
  detectInvestmentTriggers,
  detectMandateAlignment,
} = require('../src/investment-plan-utils');

describe('investment-plan-utils', () => {
  it('builds hybrid Soll baseline with provenance flags', () => {
    const result = buildSollBaselines({
      redispatchTargetEur: 1200000,
      financeBudgetEur: 800000,
    });

    expect(result.sollEur).toBe(1000000);
    expect(result.provenanceFlags.map((item) => item.provenance)).toEqual(
      expect.arrayContaining([PROVENANCE.REDISPATCH_TARGET, PROVENANCE.FINANCE_BUDGET])
    );
  });

  it('computes Soll-Ist delta', () => {
    const result = buildSollIstComparison({ sollEur: 1000000, istEur: 1300000 });

    expect(result.deltaEur).toBe(300000);
    expect(result.deltaPercent).toBe(30);
  });

  it('triggers only for strict greater-than threshold', () => {
    const triggers = detectInvestmentTriggers(
      [
        { measureId: 'm1', capexEur: INVESTMENT_TRIGGER_THRESHOLD_EUR, avoidedCostsEur: 0 },
        { measureId: 'm2', capexEur: 1000001, avoidedCostsEur: 0 },
      ],
      INVESTMENT_TRIGGER_THRESHOLD_EUR
    );

    expect(triggers).toHaveLength(1);
    expect(triggers[0].measureId).toBe('m2');
  });

  it('detects missing mandate roles from VDMI task assignments', () => {
    const alignment = detectMandateAlignment(
      [
        {
          tasks: [
            {
              verantwortlich: [{ actorId: 'ROLE_NETZPLANUNG' }],
              durchfuehrend: [],
              mitwirkend: [],
              information: [],
            },
          ],
        },
      ],
      ['ROLE_KAUFMAENNISCHE_LEITUNG', 'ROLE_NETZPLANUNG']
    );

    expect(alignment.aligned).toBe(false);
    expect(alignment.missingRoles).toEqual(['ROLE_KAUFMAENNISCHE_LEITUNG']);
  });
});
