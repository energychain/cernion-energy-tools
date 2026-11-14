'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { cadenceDelayMs, parseArgs, superviseProjectionRun } = require('../bin/run-projection-loop');

test('loop enforces bounded start-to-start cadence and subtracts run duration', () => {
  const options = { intervalSeconds: 120, backoffSeconds: 30 };
  assert.equal(cadenceDelayMs(25_000, false, options), 95_000);
  assert.equal(cadenceDelayMs(125_000, false, options), 0);
  assert.equal(cadenceDelayMs(5_000, true, options), 25_000);
  assert.ok(options.intervalSeconds <= 180);
});

test('loop arguments cap cadence at three minutes and hard budget at 100 seconds', () => {
  const parsed = parseArgs(['--interval-seconds', '999', '--budget-seconds', '999']);
  assert.equal(parsed.intervalSeconds, 180);
  assert.equal(parsed.budgetSeconds, 100);
});

test('supervisor kills a blocked child at the hard budget and persists failure', async () => {
  const child = new EventEmitter();
  child.pid = null;
  child.killed = false;
  child.kill = (signal) => {
    child.killed = signal;
    setImmediate(() => child.emit('exit', null, signal));
  };
  const failures = [];
  const started = Date.now();
  const result = await superviseProjectionRun(
    { budgetSeconds: 0.02 },
    { database: '/tmp/not-written.db' },
    {
      spawnChild: () => child,
      persistFailure: (database, startedAt, errorCode) =>
        failures.push({ database, startedAt, errorCode }),
    }
  );
  assert.equal(result.errorCode, 'RUN_BUDGET_EXCEEDED');
  assert.equal(child.killed, 'SIGKILL');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].errorCode, 'RUN_BUDGET_EXCEEDED');
  assert.ok(Date.now() - started < 500);
});

test('supervisor persists child exit failures after termination and retries a busy health write', async () => {
  const child = new EventEmitter();
  child.pid = null;
  child.killed = false;
  let attempts = 0;
  const resultPromise = superviseProjectionRun(
    { budgetSeconds: 1 },
    { database: '/tmp/not-written.db' },
    {
      spawnChild: () => child,
      retryDelayMs: 1,
      persistFailure: (_database, _startedAt, errorCode) => {
        attempts += 1;
        assert.equal(errorCode, 'PROJECTION_CHILD_FAILED');
        if (attempts < 3) throw new Error('busy');
      },
    }
  );
  child.emit('exit', 1, null);
  const result = await resultPromise;
  assert.equal(result.errorCode, 'PROJECTION_CHILD_FAILED');
  assert.equal(result.persistenceError, null);
  assert.equal(attempts, 3);
});
