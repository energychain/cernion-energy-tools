'use strict';
const { compareConfirmation } = require('../src/forecast-context-selection');
function report(rmse, mae, groups = []) {
  return {
    status: 'validated_relationships',
    selected_groups: groups,
    historical_quality: {
      confirmation: {
        valid: true,
        mae,
        folds: Array.from({ length: 4 }, (_, i) => ({
          from: String(i),
          until_exclusive: String(i + 1),
          rmse,
        })),
      },
    },
  };
}
test('new features must improve on the established automatic model, not only the simple mean', () => {
  expect(compareConfirmation(report(1, 1), report(2, 2, ['season'])).supported).toBe(false);
  expect(compareConfirmation(report(1, 1), report(0.5, 0.5, ['day_ahead_price'])).supported).toBe(
    true
  );
  expect(compareConfirmation(report(1, 1), report(0.5, 1.03, ['temperature'])).supported).toBe(
    false
  );
  expect(
    compareConfirmation(report(1, 1), {
      ...report(0.1, 0.1, ['season']),
      status: 'baseline_retained',
    }).supported
  ).toBe(false);
});
test('unaligned confirmation periods cannot be compared', () => {
  const candidate = report(0.5, 0.5, ['temperature']);
  candidate.historical_quality.confirmation.folds[0].from = 'other';
  expect(compareConfirmation(report(1, 1), candidate).reason).toBe('no_aligned_valid_confirmation');
});
