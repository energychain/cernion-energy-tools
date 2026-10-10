'use strict';

// Associations in a net meter do not identify installed equipment. Competing
// explanations must remain visible, even after out-of-time predictive validation.
function interpretFeatures(groups, coefficients = {}) {
  const hints = [];
  const add = (feature, pattern, alternatives) =>
    hints.push({
      feature,
      pattern,
      alternatives,
      status: 'predictive_pattern_only',
      equipment_confirmed: false,
      causal_claim: false,
    });
  if (groups.includes('season'))
    add('season', 'seasonal_consumption', ['operating calendar', 'weather', 'occupancy']);
  if (groups.includes('day_ahead_price') && coefficients.day_ahead_price < 0)
    add('day_ahead_price', 'lower_import_at_higher_prices', [
      'EMS demand response',
      'shared market/operating drivers',
    ]);
  if (groups.includes('grid_load_lag2'))
    add('grid_load_lag2', 'national_load_association', [
      'shared calendar/weather',
      'economic activity',
    ]);
  if (groups.includes('global_radiation') && coefficients.global_radiation < 0)
    add('global_radiation', 'lower_net_import_with_sunlight', [
      'behind_meter_PV',
      'lighting demand',
      'occupancy',
    ]);
  const heating = groups.includes('heating_degree_days_18')
    ? coefficients.heating_degree_days_18
    : groups.includes('temperature')
      ? (coefficients.heating_degree_18 || 0) - (coefficients.temperature || 0)
      : undefined;
  if (heating > 0)
    add('heating', 'higher_import_in_cold_weather', [
      'heat_pump',
      'electric_heating',
      'seasonal_operation',
    ]);
  if (heating < 0)
    add('heating', 'lower_net_import_in_cold_weather', [
      'heat_led_CHP',
      'seasonal_operation',
      'occupancy',
    ]);
  return hints;
}
module.exports = { interpretFeatures };
