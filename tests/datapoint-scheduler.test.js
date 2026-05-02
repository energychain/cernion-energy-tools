'use strict';

/**
 * Tests for Datapoint Scheduler (AP3 — interval refresh strategy)
 *
 * Tests cover:
 *  - DATAPOINT_SCHEDULER_ENABLED env-var toggle
 *  - setInterval / clearInterval lifecycle (started / stopped)
 *  - runScheduledRefreshes: skip manual strategy, skip non-overdue, fire overdue
 *  - activeRefreshes Set concurrency guard
 *  - cleanup on stopped()
 *
 * NOTE: Uses a unique temp PouchDB path to avoid interference with other test
 * suites or the production .datapoints/ directory.
 */

const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

// Use a unique temp path so PouchDB creates files in /tmp (not ./.datapoints)
// This must be set BEFORE requiring the service module.
const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-dp-sched-${Date.now()}`);
process.env.DATAPOINT_DB_PATH = TEST_DB_PATH;

const DatapointService = require('../services/datapoint.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/**
 * Create a broker with the datapoint service, replace its PouchDB with a
 * stub, disable the scheduler, start the broker, then return { broker, svc }.
 *
 * The original PouchDB instance created by `created()` is closed immediately
 * to prevent file-handle leaks.
 */
async function createBrokerWithDocs(docs = []) {
  const stub = {
    createIndex: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue({}),
    allDocs: jest.fn().mockResolvedValue({ rows: docs.map((doc) => ({ doc })) }),
    get: jest.fn().mockImplementation((id) => {
      const doc = docs.find((d) => d._id === id);
      if (!doc) {
        const err = new Error('Not found');
        err.status = 404;
        return Promise.reject(err);
      }
      return Promise.resolve(doc);
    }),
    put: jest.fn().mockResolvedValue({ rev: '2-abc' }),
  };

  const broker = new ServiceBroker({ logger: false, transporter: null });
  const svc = broker.createService(DatapointService);

  // Close the real PouchDB created in created() to avoid open-handle leaks
  await svc.db.close();
  svc.db = stub;

  // Prevent the scheduler ticker from auto-starting during broker.start()
  process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
  await broker.start();
  delete process.env.DATAPOINT_SCHEDULER_ENABLED;

  return { broker, svc };
}

// ---------------------------------------------------------------------------
// Lifecycle tests (scheduler start/stop)
// ---------------------------------------------------------------------------
describe('Datapoint Scheduler — lifecycle', () => {
  let broker;
  let svc;

  afterEach(async () => {
    if (broker) {
      await broker.stop();
      broker = null;
    }
    jest.restoreAllMocks();
  });

  it('initialises activeRefreshes as an empty Set in created()', async () => {
    ({ broker, svc } = await createBrokerWithDocs());
    expect(svc.activeRefreshes).toBeInstanceOf(Set);
    expect(svc.activeRefreshes.size).toBe(0);
  });

  it('starts a 60 s interval when DATAPOINT_SCHEDULER_ENABLED is not "false"', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    broker = new ServiceBroker({ logger: false, transporter: null });
    svc = broker.createService(DatapointService);
    await svc.db.close();
    svc.db = {
      createIndex: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue({}),
    };

    delete process.env.DATAPOINT_SCHEDULER_ENABLED;
    await broker.start();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
  });

  it('does NOT start the interval when DATAPOINT_SCHEDULER_ENABLED=false', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    process.env.DATAPOINT_SCHEDULER_ENABLED = 'false';
    broker = new ServiceBroker({ logger: false, transporter: null });
    svc = broker.createService(DatapointService);
    await svc.db.close();
    svc.db = {
      createIndex: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue({}),
    };
    await broker.start();
    delete process.env.DATAPOINT_SCHEDULER_ENABLED;

    // 60_000 ms interval must NOT have been registered
    const calledWith60k = setIntervalSpy.mock.calls.some(([, ms]) => ms === 60_000);
    expect(calledWith60k).toBe(false);
  });

  it('clears the scheduler interval in stopped()', async () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    broker = new ServiceBroker({ logger: false, transporter: null });
    svc = broker.createService(DatapointService);
    await svc.db.close();
    svc.db = {
      createIndex: jest.fn().mockResolvedValue({}),
      close: jest.fn().mockResolvedValue({}),
    };

    delete process.env.DATAPOINT_SCHEDULER_ENABLED;
    await broker.start();
    await broker.stop();
    broker = null; // prevent double-stop in afterEach

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runScheduledRefreshes() unit tests
// ---------------------------------------------------------------------------
describe('Datapoint Scheduler — runScheduledRefreshes', () => {
  let broker;
  let svc;

  afterEach(async () => {
    if (broker) {
      await broker.stop();
      broker = null;
      svc = null;
    }
    jest.restoreAllMocks();
  });

  it('skips datapoints with strategy=manual', async () => {
    const docs = [
      {
        _id: 'dp:manual-dp',
        name: 'manual-dp',
        refresh: { strategy: 'manual' },
        lastRun: { timestamp: minutesAgo(120), status: 'success' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    const callSpy = jest.spyOn(broker, 'call').mockResolvedValue({ success: true });

    await svc.runScheduledRefreshes();

    expect(callSpy).not.toHaveBeenCalledWith('datapoint.refresh', expect.anything());
  });

  it('skips interval datapoints that are not yet overdue', async () => {
    const docs = [
      {
        _id: 'dp:fresh-dp',
        name: 'fresh-dp',
        refresh: { strategy: 'interval', intervalMinutes: 60 },
        // Only 10 minutes old — still 50 min until due
        lastRun: { timestamp: minutesAgo(10), status: 'success' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    const callSpy = jest.spyOn(broker, 'call').mockResolvedValue({ success: true });

    await svc.runScheduledRefreshes();

    expect(callSpy).not.toHaveBeenCalledWith('datapoint.refresh', expect.anything());
  });

  it('fires refresh for overdue interval datapoints', async () => {
    const docs = [
      {
        _id: 'dp:overdue-dp',
        name: 'overdue-dp',
        refresh: { strategy: 'interval', intervalMinutes: 30 },
        // 90 minutes old — 60 minutes overdue
        lastRun: { timestamp: minutesAgo(90), status: 'success' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    const callSpy = jest.spyOn(broker, 'call').mockResolvedValue({ success: true });

    await svc.runScheduledRefreshes();

    expect(callSpy).toHaveBeenCalledWith('datapoint.refresh', { name: 'overdue-dp' });
  });

  it('concurrency guard: skips datapoints already in activeRefreshes', async () => {
    const docs = [
      {
        _id: 'dp:in-flight-dp',
        name: 'in-flight-dp',
        refresh: { strategy: 'interval', intervalMinutes: 30 },
        lastRun: { timestamp: minutesAgo(90), status: 'success' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    // Simulate an in-flight refresh
    svc.activeRefreshes.add('in-flight-dp');

    const callSpy = jest.spyOn(broker, 'call').mockResolvedValue({ success: true });

    await svc.runScheduledRefreshes();

    expect(callSpy).not.toHaveBeenCalledWith('datapoint.refresh', expect.anything());
  });

  it('removes datapoint from activeRefreshes after refresh completes', async () => {
    const docs = [
      {
        _id: 'dp:cleanup-dp',
        name: 'cleanup-dp',
        refresh: { strategy: 'interval', intervalMinutes: 30 },
        lastRun: { timestamp: minutesAgo(90), status: 'success' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    jest.spyOn(broker, 'call').mockResolvedValue({ success: true });

    await svc.runScheduledRefreshes();

    // Flush the microtask queue so .finally() has a chance to run
    await new Promise((r) => setImmediate(r));

    expect(svc.activeRefreshes.has('cleanup-dp')).toBe(false);
  });

  it('removes datapoint from activeRefreshes even after refresh error', async () => {
    const docs = [
      {
        _id: 'dp:error-dp',
        name: 'error-dp',
        refresh: { strategy: 'interval', intervalMinutes: 30 },
        lastRun: { timestamp: minutesAgo(90), status: 'success' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    jest.spyOn(broker, 'call').mockRejectedValue(new Error('Simulated refresh failure'));

    await svc.runScheduledRefreshes();
    await new Promise((r) => setImmediate(r));

    expect(svc.activeRefreshes.has('error-dp')).toBe(false);
  });

  it('handles DB allDocs errors gracefully (does not throw)', async () => {
    ({ broker, svc } = await createBrokerWithDocs([]));
    svc.db.allDocs = jest.fn().mockRejectedValue(new Error('PouchDB unavailable'));

    await expect(svc.runScheduledRefreshes()).resolves.toBeUndefined();
  });

  it('treats never-run datapoints (lastRun.timestamp=null) as immediately overdue', async () => {
    const docs = [
      {
        _id: 'dp:never-run-dp',
        name: 'never-run-dp',
        refresh: { strategy: 'interval', intervalMinutes: 60 },
        lastRun: { timestamp: null, status: 'never' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    const callSpy = jest.spyOn(broker, 'call').mockResolvedValue({ success: true });

    await svc.runScheduledRefreshes();

    expect(callSpy).toHaveBeenCalledWith('datapoint.refresh', { name: 'never-run-dp' });
  });

  it('skips datapoints with intervalMinutes=0', async () => {
    const docs = [
      {
        _id: 'dp:zero-interval-dp',
        name: 'zero-interval-dp',
        refresh: { strategy: 'interval', intervalMinutes: 0 },
        lastRun: { timestamp: minutesAgo(999), status: 'success' },
      },
    ];
    ({ broker, svc } = await createBrokerWithDocs(docs));

    const callSpy = jest.spyOn(broker, 'call').mockResolvedValue({ success: true });

    await svc.runScheduledRefreshes();

    expect(callSpy).not.toHaveBeenCalledWith('datapoint.refresh', expect.anything());
  });
});
