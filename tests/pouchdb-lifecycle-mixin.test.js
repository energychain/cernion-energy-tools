'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPouchDbLifecycleMixin } = require('../src/pouchdb-lifecycle-mixin');

describe('PouchDB lifecycle shutdown', () => {
  const mixin = createPouchDbLifecycleMixin({ defaultDbPath: './unused' });
  let directory;
  let service;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pouchdb-lifecycle-'));
    service = {
      name: 'fixture',
      settings: { dbPath: directory },
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
    };
    mixin.created.call(service);
  });

  afterEach(async () => {
    if (!service.db._closed) await service.db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('closes an open database once without warning', async () => {
    const close = jest.spyOn(service.db, 'close');
    await mixin.started.call(service);
    await service.db.put({ _id: 'persisted', value: 1 });
    await expect(mixin.stopped.call(service)).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    expect(service.db._closed).toBe(true);
    expect(service.logger.warn).not.toHaveBeenCalled();
  });

  it('logs at debug and resolves when the real database was already closed', async () => {
    await service.db.close();
    await expect(mixin.stopped.call(service)).resolves.toBeUndefined();
    expect(service.logger.debug).toHaveBeenCalledWith(
      '[fixture] PouchDB db already closed',
      expect.objectContaining({ message: 'database is closed' })
    );
  });

  it('supports repeated shutdown with a custom database property and label', async () => {
    const custom = createPouchDbLifecycleMixin({
      defaultDbPath: directory,
      dbProperty: 'store',
      logLabel: 'custom',
    });
    service.store = service.db;
    await custom.stopped.call(service);
    await expect(custom.stopped.call(service)).resolves.toBeUndefined();
    expect(service.logger.debug).toHaveBeenCalledWith(
      '[custom] PouchDB store already closed',
      expect.any(Error)
    );
  });

  it('still propagates unrelated close failures', async () => {
    const error = new Error('disk I/O failure');
    jest.spyOn(service.db, 'close').mockRejectedValueOnce(error);
    await expect(mixin.stopped.call(service)).rejects.toBe(error);
    expect(service.logger.warn).not.toHaveBeenCalled();
  });

  it('allows shutdown before a database has been assigned', async () => {
    await expect(mixin.stopped.call({})).resolves.toBeUndefined();
  });
});
