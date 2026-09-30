'use strict';
const { EvaluationError } = require('./forecast-evaluation');
const defaults = {
  latest_measurement_lag: 3,
  feature_profile: 'e2_v1',
  selection_objective: 'mae',
  candidate_set: 'extended',
  training_mode: 'rolling',
};
const options = {
  latest_measurement_lag: [2, 3],
  feature_profile: ['legacy_v1', 'e2_v1'],
  selection_objective: ['rmse', 'mae'],
  candidate_set: ['existing', 'hgb', 'extended', 'regime'],
  training_mode: ['rolling', 'frozen'],
};
function normalizeMethod(value = {}) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !Object.hasOwn(defaults, key))
  ) {
    throw new EvaluationError('validation_failed', 'Unsupported portfolio_method fields');
  }
  const result = { ...defaults, ...value };
  for (const [key, allowed] of Object.entries(options)) {
    if (!allowed.includes(result[key])) {
      throw new EvaluationError('validation_failed', `Invalid portfolio_method.${key}`);
    }
  }
  return result;
}
const methodSchema = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(
    Object.entries(options).map(([key, values]) => [
      key,
      {
        type: key === 'latest_measurement_lag' ? 'integer' : 'string',
        enum: values,
        default: defaults[key],
      },
    ])
  ),
};
module.exports = { normalizeMethod, methodSchema };
