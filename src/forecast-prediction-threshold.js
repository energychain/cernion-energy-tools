'use strict';

// PT15M energy is an interval quantity; kW is average power over that interval.
function thresholdInUnit(watts, unit) {
  if (!['kWh', 'kW'].includes(unit)) throw new Error('Unsupported forecast unit');
  return (watts / 1000) * (unit === 'kWh' ? 0.25 : 1);
}

function thresholdPrediction(value, unit, watts = 0) {
  if (!Number.isFinite(value) || !Number.isFinite(watts) || watts < 0)
    throw new Error('Prediction and nonnegative threshold must be finite numbers');
  if (watts === 0) return { predicted_value: value };
  const zeroed = value !== 0 && Math.abs(value) < thresholdInUnit(watts, unit);
  return {
    predicted_value: zeroed ? 0 : value,
    raw_predicted_value: value,
    prediction_zeroed: zeroed,
  };
}

const thresholdSchema = {
  type: 'number',
  minimum: 0,
  default: 0,
  example: 50,
  description:
    'Prediction-only deadband in watts. Strictly smaller absolute predictions become zero; actuals and training remain unchanged. 50 W = 0.05 kW = 0.0125 kWh per PT15M. 0 disables filtering. Persisted with state-model artifacts.',
};
module.exports = { thresholdInUnit, thresholdPrediction, thresholdSchema };
