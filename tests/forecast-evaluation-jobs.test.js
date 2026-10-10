'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-jobs-'));
process.env.JOB_STORE_DIR = path.join(root, 'jobs');
const store = require('../src/job-store');
const {
  executeForecast,
  startForecastJob,
  cancelForecastJob,
  stopForecastWorkers,
} = require('../src/forecast-evaluation-jobs');
const { runEvaluation } = require('../src/forecast-evaluation');
const busyWorker = path.join(root, 'busy.cjs');
fs.writeFileSync(
  busyWorker,
  `const {parentPort}=require('worker_threads');parentPort.postMessage({type:'progress',progress:{phase:'busy',completed_days:0,total_days:1,percent:0,message:'CPU work'}});while(true){Math.sqrt(Math.random());}`
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function payload() {
  const from = Date.parse('2024-12-01T00:00:00Z');
  return {
    payload_fit_confirmed: true,
    datasets: [
      {
        series_id: 'job-test',
        unit: 'kWh',
        timezone: 'UTC',
        period_from: '2024-12-01',
        period_until: '2025-01-03',
        values: Array.from({ length: 34 * 96 }, (_, i) => ({
          timestamp: new Date(from + i * 900000).toISOString(),
          value: 10,
        })),
      },
    ],
    configuration: {
      mode: 'rolling_day_ahead',
      relationship_mode: 'manual',
      feature_set: ['history'],
      forecast_period_from: '2025-01-01',
      forecast_period_until: '2025-01-03',
    },
  };
}
async function waitFor(jobId, predicate) {
  for (let i = 0; i < 200; i++) {
    const job = store.getJob(jobId);
    if (predicate(job)) return job;
    await sleep(20);
  }
  throw new Error('Job did not reach expected state');
}
afterAll(async () => {
  await stopForecastWorkers();
  fs.rmSync(root, { recursive: true, force: true });
});

test('worker predictions match direct evaluation; day progress does not alter calculations', async () => {
  const events = [];
  const expected = runEvaluation(payload(), (p) => events.push(p));
  const actual = await executeForecast(payload(), {}, null);
  expect(
    actual.results[0].forecast_values.map((v) => [
      v.timestamp,
      v.predicted_value,
      v.training_data_until,
    ])
  ).toEqual(
    expected.results[0].forecast_values.map((v) => [
      v.timestamp,
      v.predicted_value,
      v.training_data_until,
    ])
  );
  expect(
    events.filter((e) => e.phase === 'forecast_day_completed').map((e) => e.completed_days)
  ).toEqual([1, 2, 3]);
  expect(events.every((e) => e.total_days === 3)).toBe(true);
});

test('standard job descriptor returns 202 and completes in existing store', async () => {
  const ctx = { params: payload(), meta: { $gateway: true, tenantId: 'forecast-job-tests' } };
  const accepted = await startForecastJob(ctx);
  expect(ctx.meta.$statusCode).toBe(202);
  expect(accepted.statusUrl).toBe(`/api/jobs/${accepted.jobId}/status`);
  const job = await waitFor(accepted.jobId, (j) => ['completed', 'error'].includes(j.status));
  expect(job.status).toBe('completed');
  expect(job.logs.some((l) => l.phase === 'forecast_day_completed')).toBe(true);
  expect(store.getResult(job.jobId).results[0].forecast_values).toHaveLength(288);
});

test('worker errors become terminal job errors, not successful results', async () => {
  const ctx = {
    params: { ...payload(), payload_fit_confirmed: false },
    meta: { $gateway: true, tenantId: 'forecast-job-tests' },
  };
  const accepted = await startForecastJob(ctx);
  const job = await waitFor(accepted.jobId, (j) => j.status === 'error');
  expect(job.error).toContain('payload_fit_confirmed');
  expect(store.getResult(job.jobId)).toBeNull();
});

test('CPU busy worker leaves event loop responsive and can be cancelled with tenant check', async () => {
  const jobId = store.createJob({
    service: 'forecast-sandbox',
    action: 'runEvaluation',
    tenantId: 'one',
  });
  store.updateJob(jobId, { status: 'running' });
  const work = executeForecast({}, {}, jobId, { workerFile: busyWorker });
  const outcome = work.catch((e) => e);
  await waitFor(jobId, (j) => j.phase === 'busy');
  const unauthorized = { params: { jobId }, meta: { tenantId: 'two' } };
  expect(cancelForecastJob(unauthorized).success).toBe(false);
  expect(unauthorized.meta.$statusCode).toBe(404);
  expect(cancelForecastJob({ params: { jobId }, meta: { tenantId: 'one' } }).error).toBe(
    'forecast_cancelled'
  );
  expect((await outcome).message).toBe('forecast_cancelled');
});

test('hard timeout terminates a silent busy worker', async () => {
  await expect(
    executeForecast({}, {}, null, { workerFile: busyWorker, timeoutMs: 100 })
  ).rejects.toThrow('forecast_timeout');
});

test('unexpected worker exit is a failure and cancelled queued jobs do not start', async () => {
  const exiting = path.join(root, 'exit.cjs');
  fs.writeFileSync(exiting, 'process.exit(2)');
  await expect(executeForecast({}, {}, null, { workerFile: exiting })).rejects.toThrow(
    'forecast_worker_exited'
  );
  const jobId = store.createJob({
    service: 'forecast-sandbox',
    action: 'runEvaluation',
    tenantId: 'one',
  });
  cancelForecastJob({ params: { jobId }, meta: { tenantId: 'one' } });
  await expect(executeForecast({}, {}, jobId)).rejects.toThrow('forecast_cancelled');
});
