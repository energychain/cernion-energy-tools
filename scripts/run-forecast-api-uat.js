#!/usr/bin/env node
'use strict';

// All forecast operations go through HTTP. --local starts the actual CET gateway
// and sandbox on loopback; it does not replace routes, middleware or computations.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');

const local = process.argv.includes('--local');
const outIndex = process.argv.indexOf('--out');
const output =
  outIndex >= 0
    ? path.resolve(process.argv[outIndex + 1])
    : fs.mkdtempSync(path.join(os.tmpdir(), 'cernion-forecast-api-uat-'));
fs.mkdirSync(output, { recursive: true });
const report = {
  started_at: new Date().toISOString(),
  transport: 'HTTP',
  data: 'synthetic',
  target: local ? 'isolated_local_gateway' : 'configured_api',
  authentication: local ? 'not_tested_local_gateway_defaults' : 'configured_bearer',
  requests: [],
  checks: [],
  status: 'running',
};

function save(name, value) {
  fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2));
}
function check(name, condition) {
  assert.ok(condition, name);
  report.checks.push({ name, status: 'passed' });
  process.stdout.write(`PASS ${name}\n`);
}

async function main() {
  let broker;
  let base = process.env.CET_BASE_URL;
  const token = local ? null : process.env.CET_API_TOKEN || process.env.CERNION_TOKEN;
  try {
    if (local) {
      // All quota files are isolated from the running installation.
      process.env.RATE_QUOTA_DRIVER = 'file';
      process.env.RATE_QUOTA_DIR = path.join(output, 'rate-quotas');
      process.env.TRACING_ENABLED = 'false';
      const { ServiceBroker } = require('moleculer');
      const apiSchema = require('../services/api.service');
      broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 180000 });
      const api = broker.createService({
        ...apiSchema,
        settings: { ...apiSchema.settings, port: 0, ip: '127.0.0.1' },
      });
      broker.createService(require('../services/forecast-sandbox.service'));
      await broker.start();
      base = `http://127.0.0.1:${api.server.address().port}`;
      // Moleculer-Web regenerates automatic REST aliases after a debounce.
      for (let attempt = 0; attempt < 40; attempt++) {
        const ready = await fetch(`${base}/api/forecast-sandbox/openapi.json`);
        await ready.arrayBuffer();
        if (ready.ok) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    assert.ok(base, 'Set CET_BASE_URL or use --local.');
    const url = new URL(base);
    assert.ok(
      ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash,
      'CET_BASE_URL must be an HTTP(S) base URL without credentials or query parameters.'
    );
    base = base.replace(/\/$/, '');
    report.base_url = base;
    if (!local)
      assert.ok(
        token,
        'Set CET_API_TOKEN to an API token, or CERNION_TOKEN if it is a suitable gateway token.'
      );

    async function call(name, endpoint, payload, expectedStatus = 200) {
      const started = Date.now();
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const response = await fetch(`${base}${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(180000),
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
      });
      const text = await response.text();
      report.requests.push({
        name,
        method: body ? 'POST' : 'GET',
        path: endpoint,
        http_status: response.status,
        elapsed_ms: Date.now() - started,
        request_bytes: body ? Buffer.byteLength(body) : 0,
        request_sha256: body ? createHash('sha256').update(body).digest('hex') : null,
        response_bytes: Buffer.byteLength(text),
        response_sha256: createHash('sha256').update(text).digest('hex'),
      });
      assert.equal(
        response.status,
        expectedStatus,
        `${name}: HTTP ${response.status}, expected ${expectedStatus}`
      );
      const result = JSON.parse(text);
      save(`${name}.json`, result);
      return result;
    }
    const root = '/api/forecast-sandbox';
    const operation = `${root}/consumption/evaluation`;
    const spec = await call('openapi', `${root}/openapi.json`);
    check(
      'Both evaluation endpoints are deployed',
      Boolean(spec.paths?.[`${operation}/validate`]?.post && spec.paths?.[`${operation}/run`]?.post)
    );

    const fixture = execFileSync(
      process.execPath,
      [path.join(__dirname, 'create-forecast-evaluation-fixture.js')],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    fs.writeFileSync(path.join(output, 'request.json'), fixture);
    const payload = JSON.parse(fixture);
    payload.payload_fit_confirmed = false;
    const validated = await call('validation', `${operation}/validate`, payload);
    check(
      'Complete 2020–2025 dataset validates over HTTP',
      validated.status === 'data_validated' &&
        validated.validations[0].missing_intervals === 0 &&
        validated.validations[0].duplicate_intervals === 0
    );
    report.input_intervals = payload.datasets[0].values.length;
    payload.payload_fit_confirmed = true;

    const rolling = await call('rolling', `${operation}/run`, payload);
    const result = rolling.results[0];
    check(
      'Annual rolling forecast has 365 days and 35040 intervals',
      result.daily_results.length === 365 && result.forecast_values.length === 35040
    );
    check(
      'Day-ahead cutoffs are D-2, including year boundary',
      result.daily_results[0].training_data_until === '2024-12-30T22:45:00.000Z' &&
        result.daily_results[2].training_data_until === '2025-01-01T22:45:00.000Z' &&
        result.daily_results.every((d) => d.training_data_until < d.training_cutoff_exclusive)
    );
    check(
      'DST days contain 92 and 100 distinct instants',
      result.daily_results.find((d) => d.forecast_for === '2025-03-30').intervals === 92 &&
        result.daily_results.find((d) => d.forecast_for === '2025-10-26').intervals === 100 &&
        new Set(result.forecast_values.map((v) => v.timestamp)).size === 35040
    );
    check(
      'Metrics, curves and dossier are returned',
      ['mae', 'rmse', 'mape', 'bias', 'max_error', 'cumulative_error'].every((k) =>
        Number.isFinite(result.backtest[k])
      ) &&
        result.readiness_dossier.status === 'readiness_dossier_created' &&
        result.worst_days.length === 10
    );
    check(
      'Missing weather is disclosed and forecast completes',
      !result.forecast_run.uses_weather_features &&
        result.readiness_dossier.warnings.some((w) => w.includes('missing_weather_data'))
    );
    check(
      'Deviation energy carries the required proxy boundary',
      result.deviation_energy.unit === 'kWh' &&
        result.deviation_energy.note ===
          'Die AE-/Kostenbewertung ist ein Proxy und keine Abrechnungs-, Beschaffungs- oder Handelsentscheidung.'
    );

    payload.configuration.mode = 'static_year_forecast';
    const frozen = (await call('static', `${operation}/run`, payload)).results[0];
    check(
      'Static history stays frozen at 2024 year-end',
      frozen.daily_results.every((d) => d.training_data_until === '2024-12-31T22:45:00.000Z')
    );
    report.comparison = {
      rolling_mae: result.backtest.mae,
      static_mae: frozen.backtest.mae,
      difference_mae: result.backtest.mae - frozen.backtest.mae,
      interpretation: 'Synthetic scenario only; improvement is not guaranteed for other series.',
    };
    check(
      'History updates improve this synthetic load-change scenario',
      result.backtest.mae < frozen.backtest.mae
    );

    payload.configuration.mode = 'rolling_day_ahead';
    payload.configuration.forecast_period_until = '2025-01-03';
    for (const row of payload.datasets[0].values) {
      if (row.timestamp >= '2025-01-01T23:00:00.000Z') row.value += 10000;
    }
    const changed = (await call('future-actual-mutation', `${operation}/run`, payload)).results[0];
    check(
      'Future actual mutations cannot alter earlier forecasts',
      changed.forecast_values.every(
        (v, i) => v.predicted_value === result.forecast_values[i].predicted_value
      )
    );

    payload.datasets[0].values.push({ ...payload.datasets[0].values[0] });
    const invalid = await call('duplicate-validation', `${operation}/validate`, payload);
    check(
      'Duplicate intervals fail dataset validation',
      invalid.status === 'validation_failed' && invalid.validations[0].duplicate_intervals === 1
    );
    const rejected = await call('duplicate-run-rejected', `${operation}/run`, payload, 400);
    check('Invalid data cannot start a forecast', rejected.status === 'validation_failed');
    payload.datasets[0].values.pop();

    // Small independent temperature fixture, using UTC instants and explicit issue times.
    const temperaturePayload = {
      payload_fit_confirmed: true,
      datasets: [
        {
          series_id: 'weather-uat',
          unit: 'kW',
          timezone: 'Europe/Berlin',
          weather_region: 'synthetic-region',
          period_from: '2024-12-01',
          period_until: '2025-01-01',
          values: [],
        },
      ],
      configuration: {
        mode: 'rolling_day_ahead',
        relationship_mode: 'manual',
        forecast_period_from: '2025-01-01',
        forecast_period_until: '2025-01-01',
        feature_set: ['history', 'weather'],
        weather: {
          source: 'synthetic-archive',
          version: '1',
          region: 'synthetic-region',
          observations: [],
          forecasts: [],
        },
      },
    };
    const weather = temperaturePayload.configuration.weather;
    for (
      let ms = Date.parse('2024-12-01T00:00:00+01:00');
      ms < Date.parse('2025-01-02T00:00:00+01:00');
      ms += 900000
    ) {
      const timestamp = new Date(ms).toISOString();
      const temperature = new Date(ms).getUTCDate();
      temperaturePayload.datasets[0].values.push({ timestamp, value: 20 + 2 * temperature });
      weather.observations.push({
        timestamp,
        temperature,
        available_at: new Date(ms + 900000).toISOString(),
      });
      if (ms >= Date.parse('2025-01-01T00:00:00+01:00')) {
        weather.forecasts.push({ timestamp, temperature: 5, issued_at: '2024-12-30T12:00:00Z' });
      }
    }
    const temperatureResult = (await call('weather', `${operation}/run`, temperaturePayload))
      .results[0];
    check(
      'Archived temperature forecasts are used',
      temperatureResult.forecast_run.uses_weather_features &&
        temperatureResult.forecast_values.every((v) => Math.abs(v.predicted_value - 30) < 1e-8)
    );
    weather.forecasts.push(
      ...weather.forecasts.map((v) => ({
        ...v,
        temperature: 999,
        issued_at: '2025-01-01T00:00:00Z',
      }))
    );
    const futureWeather = (
      await call('future-weather-mutation', `${operation}/run`, temperaturePayload)
    ).results[0];
    check(
      'Future-issued weather cannot leak into the forecast',
      futureWeather.forecast_values.every(
        (v, i) => v.predicted_value === temperatureResult.forecast_values[i].predicted_value
      )
    );
    check(
      'kW deviations convert to kWh with factor 0.25',
      Math.abs(
        temperatureResult.deviation_energy.cumulative_deviation -
          temperatureResult.backtest.cumulative_error * 0.25
      ) < 1e-8
    );
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = error.message;
    process.exitCode = 1;
    process.stderr.write(`UAT failed: ${error.message}\n`);
  } finally {
    if (broker) await broker.stop();
    report.finished_at = new Date().toISOString();
    save('report.json', report);
    process.stdout.write(`Report: ${path.join(output, 'report.json')}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
