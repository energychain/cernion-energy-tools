'use strict';
test('feature cache preserves model coefficients across a later historical revision', () => {
  const assert = require('assert/strict');
  const { clock, STEP, forecastOrigin, shiftDate } = require('../src/forecast-evaluation-time');
  const { createRelationshipSelector } = require('../src/forecast-relationship-selection');
  const time = clock('UTC'),
    start = time.midnight('2024-01-01');
  const rows = [];
  for (let ms = start; ms < time.midnight('2024-09-02'); ms += STEP) {
    const local = time.parts(ms),
      price = ((Math.floor((ms - start) / 86400000) * 37) % 91) - 20;
    rows.push({
      ms,
      ...local,
      value: 100 - 0.3 * price,
      eligible: time.midnight(shiftDate(local.date, 1)),
    });
  }
  const revision = time.midnight('2024-09-01'),
    changed = time.midnight('2024-08-20');
  let cachedCalls = 0,
    plainCalls = 0;
  function features(cached) {
    return {
      calendarEnabled: false,
      weatherEnabled: false,
      contextEnabled: true,
      calendarAttributes: () => ({}),
      historicalWeather: () => ({}),
      forecastWeather: () => ({}),
      externalContext(ms, issue) {
        cached ? cachedCalls++ : plainCalls++;
        return {
          day_ahead_price:
            ms === changed && issue >= revision
              ? 1000
              : ((Math.floor((ms - start) / 86400000) * 37) % 91) - 20,
        };
      },
      ...(cached
        ? {
            observationValidity(row, issue) {
              return row.ms !== changed
                ? [-Infinity, Infinity]
                : issue < revision
                  ? [-Infinity, revision]
                  : [revision, Infinity];
            },
          }
        : {}),
    };
  }
  const config = { mode: 'rolling_day_ahead', issue_time: '18:00' };
  const cached = createRelationshipSelector({ time, config, features: features(true) }),
    plain = createRelationshipSelector({ time, config, features: features(false) });
  let before, after;
  for (const date of ['2024-09-01', '2024-09-02']) {
    const issue = forecastOrigin(time, date, config),
      cutoff = time.midnight(shiftDate(date, -1));
    const eligible = rows.filter((r) => r.ms < cutoff && r.eligible <= issue);
    const a = cached.forDay(eligible, issue, date),
      b = plain.forDay(eligible, issue, date);
    assert.deepEqual(a.model.snapshot, b.model.snapshot);
    assert(a.model.spec.groups.includes('day_ahead_price'));
    if (!before) before = a.model.coefficients.day_ahead_price;
    else after = a.model.coefficients.day_ahead_price;
  }
  assert.notEqual(before, after);
  assert(cachedCalls < plainCalls);
  expect(cachedCalls).toBeLessThan(plainCalls / 2);
}, 60000);

test('cache validity intersects weather, context and calendar publication windows', () => {
  const { featureContext } = require('../src/forecast-evaluation');
  const stamp = '2024-01-01T00:00:00Z';
  const row = { ms: Date.parse(stamp), date: '2024-01-01', weekday: 1, slot: '00:00' };
  const features = featureContext(
    {
      feature_set: ['history', 'calendar', 'weather', 'context'],
      calendar: {
        source: 'test',
        version: '1',
        country: 'DE',
        region: 'BY',
        days: [{ date: row.date, known_at: '2024-01-05T00:00:00Z', special_day: 'revision' }],
      },
      weather: {
        source: 'test',
        version: '1',
        region: 'BY',
        observations: [
          { timestamp: stamp, temperature: 1, available_at: stamp },
          { timestamp: stamp, temperature: 5, available_at: '2024-01-03T00:00:00Z' },
        ],
      },
      context: {
        source: 'test',
        version: '1',
        region: 'DE',
        rows: [
          { timestamp: stamp, day_ahead_price: 10, available_at: '2024-01-02T00:00:00Z' },
          { timestamp: stamp, day_ahead_price: 20, available_at: '2024-01-04T00:00:00Z' },
        ],
      },
    },
    { weather_region: 'BY' }
  );
  const ranges = [
    ['2024-01-02T12:00:00Z', '2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z'],
    ['2024-01-04T12:00:00Z', '2024-01-04T00:00:00Z', '2024-01-05T00:00:00Z'],
  ];
  for (const [issue, from, until] of ranges)
    expect(features.observationValidity(row, Date.parse(issue))).toEqual([
      Date.parse(from),
      Date.parse(until),
    ]);
});

test('heating hints use the combined cold-weather slope, not a collinear component alone', () => {
  const { interpretFeatures } = require('../src/forecast-feature-interpretation');
  const hints = interpretFeatures(['temperature'], { temperature: 3, heating_degree_18: 1 });
  expect(hints[0].pattern).toBe('lower_net_import_in_cold_weather');
  expect(hints[0].equipment_confirmed).toBe(false);
});
