'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
const jobStore = require('./job-store');
const { persistStateEvaluation } = require('./forecast-state-api');

// Only one CPU-heavy forecast worker per broker process; other jobs remain observable.
let lane = Promise.resolve();
let stopping = false;
const active = new Map();

async function executeForecast(payload, meta, jobId, options = {}) {
  const previous = lane;
  let release;
  lane = new Promise((resolve) => {
    release = resolve;
  });
  if (jobId) jobStore.appendLog(jobId, 'waiting_for_worker', 0, 'Waiting for forecast worker');
  await previous;
  try {
    if (stopping || (jobId && jobStore.getJob(jobId)?.cancelRequested))
      throw new Error('forecast_cancelled');
    return await new Promise((resolve, reject) => {
      const worker =
        options.portfolioTask || payload.configuration?.model_family === 'portfolio_catboost'
          ? require('./forecast-portfolio').createPortfolioWorker(payload, options.portfolioTask)
          : new Worker(
              options.workerFile || path.join(__dirname, 'forecast-evaluation-worker.js'),
              {
                workerData: { payload },
              }
            );
      let settled = false;
      let lastProgress = {};
      const configured = Number(
        options.timeoutMs ?? Number(process.env.FORECAST_JOB_TIMEOUT_SECONDS || 21600) * 1000
      );
      const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 21600000;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        active.delete(jobId || worker);
        worker.terminate().then(() => {
          if (error) reject(error);
          else if (jobId && jobStore.getJob(jobId)?.cancelRequested)
            reject(new Error('forecast_cancelled'));
          else resolve(result);
        }, reject);
      };
      const timer = setTimeout(
        () => finish(new Error('forecast_timeout: maximum worker runtime exceeded')),
        timeoutMs
      );
      active.set(jobId || worker, () => finish(new Error('forecast_cancelled')));
      if (jobId)
        jobStore.appendLog(jobId, 'preparing', 0, 'Loading features and validating time series');
      worker.on('message', (message) => {
        if (settled) return;
        try {
          if (message.type === 'progress') {
            const p = message.progress;
            lastProgress = { step: p.completed_days, totalSteps: p.total_days, payload: p };
            jobStore.appendLog(jobId, p.phase, p.percent, p.message, {
              step: p.completed_days,
              totalSteps: p.total_days,
              payload: p,
            });
          } else if (message.type === 'error') finish(new Error(message.message));
          else if (message.type === 'result') {
            if (jobId)
              jobStore.appendLog(
                jobId,
                'persisting',
                99,
                'Saving model artifacts and result',
                lastProgress
              );
            const result = options.portfolioTask
              ? message.result
              : persistStateEvaluation(message.result, meta);
            if (jobId)
              jobStore.appendLog(jobId, 'completed', 100, 'Forecast complete', lastProgress);
            finish(null, result);
          }
        } catch (error) {
          finish(error);
        }
      });
      worker.on('error', (error) => finish(error));
      worker.on('exit', (code) => {
        if (!settled) finish(new Error(`forecast_worker_exited: ${code}`));
      });
    });
  } finally {
    release();
  }
}

function startForecastJob(ctx) {
  // Preserve internal broker calls while also moving their CPU work off the main thread.
  return jobStore.startJob(ctx, { service: 'forecast-sandbox', action: 'runEvaluation' }, (jobId) =>
    executeForecast(ctx.params, { tenantId: ctx.meta?.tenantId }, jobId)
  );
}

function cancelForecastJob(ctx) {
  const job = jobStore.getJob(ctx.params.jobId);
  if (
    !job ||
    job.service !== 'forecast-sandbox' ||
    !['runEvaluation', 'productForecast'].includes(job.action) ||
    job.tenantId !== (ctx.meta?.tenantId || 'default')
  ) {
    ctx.meta.$statusCode = 404;
    return { success: false, message: 'Forecast job not found' };
  }
  if (job.action === 'productForecast') require('./forecast-product').tenant(ctx.meta);
  if (!['queued', 'running', 'recovery_pending'].includes(job.status))
    return { success: true, jobId: job.jobId, status: job.status };
  jobStore.updateJob(job.jobId, {
    cancelRequested: true,
    status: 'error',
    error: 'forecast_cancelled',
  });
  active.get(job.jobId)?.();
  return { success: true, jobId: job.jobId, status: 'error', error: 'forecast_cancelled' };
}

async function stopForecastWorkers() {
  stopping = true;
  for (const stop of active.values()) stop();
  await lane;
  stopping = false;
}

module.exports = { startForecastJob, cancelForecastJob, executeForecast, stopForecastWorkers };
