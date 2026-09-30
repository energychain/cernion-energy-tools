'use strict';
const { compareAdaptive } = require('../src/forecast-adaptive-guard');
function report(errors, mae) {
  return {
    historical_quality: {
      confirmation: {
        valid: true,
        mae,
        folds: errors.map((rmse, i) => ({ from: String(i), until_exclusive: String(i + 1), rmse })),
      },
    },
  };
}
test('a failed extra-window search cannot replace the better established calendar forecast', () => {
  expect(
    compareAdaptive(report([0.17, 0.17, 0.17, 0.17], 0.074), report([0.26, 0.26, 0.26, 0.26], 0.15))
      .supported
  ).toBe(false);
  expect(
    compareAdaptive(report([1, 1, 1, 1], 0.5), report([0.8, 0.8, 0.8, 0.8], 0.49)).supported
  ).toBe(true);
});
test('replacement requires stable RMSE gains and MAE protection', () => {
  expect(
    compareAdaptive(report([1, 1, 1, 1], 0.5), report([0.8, 0.8, 0.8, 0.8], 0.52)).supported
  ).toBe(false);
  expect(
    compareAdaptive(report([1, 1, 1, 1], 0.5), report([0.6, 0.6, 1.1, 1.1], 0.4)).supported
  ).toBe(false);
  const candidate = report([0.1, 0.1, 0.1, 0.1], 0.1);
  candidate.historical_quality.confirmation.folds[0].from = 'different';
  expect(compareAdaptive(report([1, 1, 1, 1], 1), candidate).reason).toBe(
    'no_aligned_confirmation'
  );
});
