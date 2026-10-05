'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const DatapointService = require('../services/datapoint.service');

test('datapoint stops its scheduler and closes its real database exactly once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'datapoint-lifecycle-'));
  const previous = process.env.DATAPOINT_SCHEDULER_ENABLED;
  delete process.env.DATAPOINT_SCHEDULER_ENABLED;
  const broker = new ServiceBroker({ logger: false, transporter: null });
  const service = broker.createService(DatapointService, { settings: { dbPath: directory } });
  const close = jest.spyOn(service.db, 'close');
  const warn = jest.spyOn(service.logger, 'warn');
  const clear = jest.spyOn(global, 'clearInterval');
  try {
    await broker.start();
    const timer = service.schedulerInterval;
    expect(timer).toBeDefined();
    await broker.stop();
    expect(clear).toHaveBeenCalledWith(timer);
    expect(service.schedulerInterval).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    expect(service.db._closed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  } finally {
    if (broker.started) await broker.stop();
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.DATAPOINT_SCHEDULER_ENABLED;
    else process.env.DATAPOINT_SCHEDULER_ENABLED = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
