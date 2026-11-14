#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadProjectionSource, defaultManagementDatabase } = require('../lib/kanban-source');
const { readRoomRegistry } = require('../lib/context-links');
const { ScopedApprovalReader } = require('../lib/scoped-approval-reader');
const { readArtifactRegistry } = require('../lib/topic-projector');
const { ProjectionRunner } = require('../lib/projection-runner');

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, maximum);
}

function parseArgs(argv) {
  const options = {
    once: false,
    projectionChild: false,
    intervalSeconds: positiveInteger(process.env.PROJECTION_INTERVAL_SECONDS, 120, 180),
    budgetSeconds: positiveInteger(process.env.PROJECTION_BUDGET_SECONDS, 100, 100),
    backoffSeconds: positiveInteger(process.env.PROJECTION_BACKOFF_SECONDS, 30, 180),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--once') options.once = true;
    else if (arg === '--projection-child') options.projectionChild = true;
    else if (arg === '--hermes-home') options.hermesHome = argv[++index];
    else if (arg === '--database') options.database = argv[++index];
    else if (arg === '--scope-ledger') options.scopeLedger = argv[++index];
    else if (arg === '--artifact-registry') options.artifactRegistryPath = argv[++index];
    else if (arg === '--room-registry') options.roomRegistryPath = argv[++index];
    else if (arg === '--interval-seconds')
      options.intervalSeconds = positiveInteger(argv[++index], 120, 180);
    else if (arg === '--budget-seconds')
      options.budgetSeconds = positiveInteger(argv[++index], 100, 100);
    else if (arg === '--backoff-seconds')
      options.backoffSeconds = positiveInteger(argv[++index], 30, 180);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function log(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields })}\n`
  );
}

function sleep(milliseconds, state) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    state.cancelSleep = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function cadenceDelayMs(durationMs, failed, options) {
  const cadence = failed
    ? Math.min(options.backoffSeconds, options.intervalSeconds)
    : options.intervalSeconds;
  return Math.max(0, cadence * 1000 - durationMs);
}

function resolveRuntime(options) {
  const hermesHome = path.resolve(
    options.hermesHome || process.env.HERMES_HOME || '/home/clawd/.hermes'
  );
  return {
    hermesHome,
    database: path.resolve(options.database || defaultManagementDatabase(hermesHome)),
    artifactRegistry: readArtifactRegistry(
      path.resolve(
        options.artifactRegistryPath || path.join(hermesHome, 'agent-os-artifact-registry.json')
      )
    ),
    roomRegistry: readRoomRegistry(
      path.resolve(options.roomRegistryPath || path.join(hermesHome, 'matrix-agent-rooms.json'))
    ),
  };
}

function createRunner(options, runtime = resolveRuntime(options)) {
  return new ProjectionRunner({
    database: runtime.database,
    maxDurationMs: options.budgetSeconds * 1000,
    projectionOptions: {
      artifactRegistry: runtime.artifactRegistry,
      roomRegistry: runtime.roomRegistry,
    },
    loadSource: ({ timeoutMs } = {}) => {
      const raw = loadProjectionSource({
        hermesHome: runtime.hermesHome,
        timeout: Math.max(
          1,
          Math.min(options.budgetSeconds * 1000, Number(timeoutMs) || options.budgetSeconds * 1000)
        ),
      });
      return new ScopedApprovalReader({ ledgerPath: options.scopeLedger }).load().enrichSource(raw);
    },
  });
}

function terminateChild(child, signal = 'SIGTERM') {
  if (!child || child.killed) return;
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function persistProjectionFailure(database, startedAt, errorCode) {
  return new ProjectionRunner({
    database,
    loadSource: () => ({ boards: [], errors: [] }),
  }).recordFailure(startedAt, errorCode);
}

function superviseProjectionRun(options, runtime, dependencies = {}) {
  const spawnChild =
    dependencies.spawnChild ||
    (() =>
      spawn(process.execPath, [__filename, '--projection-child', ...process.argv.slice(2)], {
        cwd: path.resolve(__dirname, '..'),
        env: process.env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      }));
  const persistFailure = dependencies.persistFailure || persistProjectionFailure;
  const retryDelayMs = Number(dependencies.retryDelayMs ?? 100);
  const child = spawnChild();
  const startedAt = Math.floor(Date.now() / 1000);
  if (dependencies.onChild) dependencies.onChild(child);
  return new Promise((resolve) => {
    let settled = false;
    let result = null;
    let timer = null;
    let timedOut = false;
    let finalizing = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const persistAndFinish = async (errorCode, extra = {}) => {
      if (settled || finalizing) return;
      finalizing = true;
      let persistenceError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await persistFailure(runtime.database, startedAt, errorCode);
          persistenceError = null;
          break;
        } catch (_) {
          persistenceError = 'PROJECTION_HEALTH_WRITE_FAILED';
          if (attempt < 2) await new Promise((resume) => setTimeout(resume, retryDelayMs));
        }
      }
      finish({ status: 'failed', errorCode, persistenceError, ...extra });
    };
    child.on('message', (message) => {
      if (message?.type === 'projection-result') result = message.result;
    });
    child.once('error', () => {
      void persistAndFinish('PROJECTION_CHILD_FAILED');
    });
    child.once('exit', (code, signal) => {
      if (result && !timedOut) return finish(result);
      const errorCode = timedOut
        ? 'RUN_BUDGET_EXCEEDED'
        : signal
          ? 'PROJECTION_CHILD_TERMINATED'
          : 'PROJECTION_CHILD_FAILED';
      void persistAndFinish(errorCode, { exitCode: code });
    });
    timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child, 'SIGKILL');
    }, options.budgetSeconds * 1000);
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runtime = resolveRuntime(options);
  if (options.projectionChild) {
    const result = createRunner(options, runtime).runOnce();
    if (process.send) process.send({ type: 'projection-result', result });
    else log('projection_child_result', result);
    return result;
  }

  const state = { stopping: false, cancelSleep: null, activeChild: null };
  const stop = (signal) => {
    state.stopping = true;
    if (state.cancelSleep) state.cancelSleep();
    if (state.activeChild) terminateChild(state.activeChild);
    log('projection_loop_stopping', { signal });
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));

  do {
    const started = Date.now();
    const result = await superviseProjectionRun(options, runtime, {
      onChild(child) {
        state.activeChild = child;
      },
    });
    state.activeChild = null;
    const durationMs = Date.now() - started;
    log('projection_run_completed', {
      status: result.status,
      errorCode: result.errorCode || null,
      unchanged: Boolean(result.unchanged),
      durationMs,
    });
    if (options.once || state.stopping) break;
    const failed = ['failed', 'locked'].includes(result.status);
    await sleep(cadenceDelayMs(durationMs, failed, options), state);
  } while (!state.stopping);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: 'projection_loop_failed',
        errorCode: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'PROJECTION_LOOP_FAILED',
      })}\n`
    );
    process.exitCode = 1;
  });
}

module.exports = {
  cadenceDelayMs,
  main,
  parseArgs,
  positiveInteger,
  superviseProjectionRun,
  terminateChild,
};
