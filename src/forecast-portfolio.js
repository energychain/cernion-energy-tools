'use strict';
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { prepareDataset, EvaluationError, BOUNDARY } = require('./forecast-evaluation');
const { dateOnly, shiftDate } = require('./forecast-evaluation-time');
const { normalizeMethod } = require('./forecast-portfolio-contract');
const VERSION = 'portfolio_regime_0700_v3';

function preparePortfolio(payload) {
  const c = payload.configuration || {};
  const allowed = [
    'model_family',
    'mode',
    'relationship_mode',
    'issue_time',
    'feature_set',
    'forecast_period_from',
    'forecast_period_until',
    'history_from',
    'portfolio_stress_test',
    'portfolio_method',
  ];
  const check = (ok, message) => {
    if (!ok) throw new EvaluationError('validation_failed', message);
  };
  check(
    Object.keys(c).every((k) => allowed.includes(k)),
    'Unsupported portfolio configuration; v2 uses history/calendar only and no post-filter.'
  );
  check(
    c.model_family === 'portfolio_catboost' &&
      c.mode === 'rolling_day_ahead' &&
      c.relationship_mode === 'auto' &&
      c.issue_time === '07:00',
    'Portfolio requires rolling auto mode at D-1 07:00.'
  );
  check(
    Array.isArray(c.feature_set) &&
      c.feature_set.length === 2 &&
      c.feature_set.includes('history') &&
      c.feature_set.includes('calendar'),
    'Portfolio requires history and calendar.'
  );
  check(
    c.portfolio_stress_test === undefined || typeof c.portfolio_stress_test === 'boolean',
    'portfolio_stress_test must be boolean.'
  );
  check(
    !c.history_from || (dateOnly(c.history_from) && c.history_from <= c.forecast_period_from),
    'Invalid history_from.'
  );
  check(
    payload.payload_fit_confirmed === true,
    'Confirm reviewed inputs before running the portfolio.'
  );
  check(
    dateOnly(c.forecast_period_from) &&
      dateOnly(c.forecast_period_until) &&
      c.forecast_period_from <= c.forecast_period_until &&
      c.forecast_period_from >= '2020-01-01' &&
      c.forecast_period_until <= '2025-12-31',
    'Invalid portfolio backtest period (2020–2025).'
  );
  check(
    Array.isArray(payload.datasets) &&
      payload.datasets.length >= 2 &&
      payload.datasets.length <= 16,
    'Joint forecasting requires 2–16 datasets.'
  );
  check(
    new Set(payload.datasets.map((d) => d.series_id)).size === payload.datasets.length,
    'Portfolio series IDs must be unique.'
  );
  check(
    new Set(payload.datasets.map((d) => `${d.timezone}:${d.unit}`)).size === 1,
    'Portfolio datasets must share timezone and unit.'
  );
  const series = payload.datasets.map((dataset) => {
    const p = prepareDataset(dataset);
    check(
      p.validation.validation_status !== 'fail' && !p.rows.some((r) => r.value < 0),
      'Invalid portfolio dataset.'
    );
    const start = p.time.midnight(c.forecast_period_from),
      end = p.time.midnight(shiftDate(c.forecast_period_until, 1));
    check(
      p.rows.filter((r) => r.ms >= start && r.ms < end).length === (end - start) / 900000,
      'Complete evaluation actuals required; mask historical inputs with stress scenarios instead.'
    );
    return {
      series_id: dataset.series_id,
      unit: dataset.unit,
      timezone: dataset.timezone,
      validation: p.validation,
      rows: p.rows
        .filter((r) => r.date >= (c.history_from || '2020-01-01'))
        .map((r) => [
          r.ms,
          r.value,
          Math.max(r.available ?? -Infinity, p.time.midnight(shiftDate(r.date, 1))),
        ]),
    };
  });
  return {
    configuration: {
      ...c,
      portfolio_method: normalizeMethod(c.portfolio_method),
      portfolio_stress_test: c.portfolio_stress_test ?? true,
    },
    series,
    testcaseBoundary: BOUNDARY,
  };
}

// Same lifecycle as a Worker: the existing serial job lane owns timeout/cancel.
// Termination kills the Python process and waits for close, leaving no orphan fits.
function resolvePortfolioPython() {
  const localPython = path.join(__dirname, '../.venv-forecast/bin/python');
  return process.env.FORECAST_PYTHON || (fs.existsSync(localPython) ? localPython : 'python3');
}

function createPortfolioWorker(payload, task) {
  const prepared = task || preparePortfolio(payload);
  const worker = new EventEmitter();
  const python = resolvePortfolioPython();
  const publicFailure = (details) => {
    const diagnosticId = randomUUID();
    console.error('Forecast portfolio worker failed', { diagnosticId, python, details });
    const code = /ModuleNotFoundError|ImportError/.test(String(details))
      ? 'portfolio_runtime_unavailable'
      : 'portfolio_failed';
    return `${code}: Forecast worker failed. Diagnostic ID: ${diagnosticId}`;
  };
  const child = spawn(
    python,
    ['-u', path.join(__dirname, '../tools/forecast-portfolio/engine.py')],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FORECAST_PARENT_PID: String(process.pid) },
    }
  );
  let errors = '',
    closed = false;
  const close = new Promise((resolve) =>
    child.once('close', (code) => {
      closed = true;
      resolve(code);
      worker.emit('exit', code);
    })
  );
  worker.terminate = async () => {
    if (!closed) child.kill('SIGKILL');
    return close;
  };
  child.on('error', (error) =>
    worker.emit('error', new Error(publicFailure(`${error.code || ''}: ${error.message}`)))
  );
  child.stdin.on('error', (error) => {
    if (!closed) worker.emit('error', new Error(publicFailure(error.message)));
  });
  child.stderr.on('data', (chunk) => {
    errors = (errors + chunk).slice(-4000);
  });
  let pending = '';
  let oversized = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    if (oversized) return;
    pending += chunk;
    if (pending.length > 8 * 1024 * 1024) {
      oversized = true;
      child.kill('SIGKILL');
      worker.emit(
        'error',
        new Error('portfolio_worker_message_too_large: use durable result files')
      );
      return;
    }
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      try {
        const message = JSON.parse(line);
        if (message.type === 'error') message.message = publicFailure(message.message);
        worker.emit('message', message);
      } catch (error) {
        worker.emit('error', new Error(publicFailure(error.message)));
      }
    }
  });
  child.on('exit', (code) => {
    if (code)
      worker.emit('message', {
        type: 'error',
        message: publicFailure(errors || `Python worker exited with code ${code}`),
      });
  });
  // Defer so job handlers are attached even for immediate failures.
  setImmediate(() => child.stdin.end(JSON.stringify(prepared)));
  return worker;
}
module.exports = { VERSION, preparePortfolio, createPortfolioWorker, resolvePortfolioPython };
