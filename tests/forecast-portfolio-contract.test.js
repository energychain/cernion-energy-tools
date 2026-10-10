'use strict';
const { normalizeMethod, methodSchema } = require('../src/forecast-portfolio-contract');
const { preparePortfolio } = require('../src/forecast-portfolio');
test('method contract is explicit, validates all options and rejects silent drift', () => {
  expect(normalizeMethod()).toEqual({
    latest_measurement_lag: 3,
    feature_profile: 'e2_v1',
    selection_objective: 'mae',
    candidate_set: 'extended',
    training_mode: 'rolling',
  });
  expect(
    normalizeMethod({ latest_measurement_lag: 2, training_mode: 'frozen' }).latest_measurement_lag
  ).toBe(2);
  for (const value of [
    null,
    [],
    { latest_measurement_lag: 1 },
    { latest_measurement_lag: true },
    { candidate_set: 'magic' },
    { selection_objective: 'wape' },
    { extra: true },
  ]) {
    expect(() => normalizeMethod(value)).toThrow();
  }
  expect(methodSchema.additionalProperties).toBe(false);
  expect(typeof preparePortfolio).toBe('function');
});
