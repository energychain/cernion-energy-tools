#!/usr/bin/env node
'use strict';

// Synthetic public UAT fixture, written to stdout; no customer data or external I/O.
// Usage: node scripts/create-forecast-evaluation-fixture.js > /tmp/forecast-uat.json
const { clock, STEP } = require('../src/forecast-evaluation-time');
const time = clock('Europe/Berlin');
const values = [];
const end = time.midnight('2026-01-01');
for (let ms = time.midnight('2020-01-01'); ms < end; ms += STEP) {
  const local = time.parts(ms);
  const hour = Number(local.slot.slice(0, 2)) + Number(local.slot.slice(3)) / 60;
  const weekdayFactor = local.weekday === 0 || local.weekday === 6 ? 0.7 : 1;
  const drift = local.date >= '2025-01-01' ? 1.2 : 1;
  const value = (12 + 4 * Math.cos(((hour - 12) / 24) * 2 * Math.PI)) * weekdayFactor * drift;
  values.push({ timestamp: new Date(ms).toISOString(), value: Math.round(value * 1000) / 1000 });
}
process.stdout.write(
  JSON.stringify({
    datasets: [
      {
        series_id: 'synthetic-uat-001',
        timezone: 'Europe/Berlin',
        unit: 'kWh',
        customer_type: 'synthetic',
        period_from: '2020-01-01',
        period_until: '2025-12-31',
        values,
      },
    ],
    payload_fit_confirmed: true,
    configuration: {
      mode: 'rolling_day_ahead',
      history_from: '2020-01-01',
      forecast_period_from: '2025-01-01',
      forecast_period_until: '2025-12-31',
      feature_set: ['history', 'calendar'],
      calendar: {
        source: 'synthetic-weekday-only',
        version: '1',
        country: 'DE',
        region: 'BW',
        features: ['weekday'],
        days: [],
      },
    },
  })
);
