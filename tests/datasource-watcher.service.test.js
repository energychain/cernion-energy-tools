const path = require('path');
const fs = require('fs');
const os = require('os');
const { ServiceBroker } = require('moleculer');

const DatasourceWatcherService = require('../services/datasource-watcher.service');

describe('datasource-watcher service', () => {
  let broker;
  let tmpDir;
  let refreshed;

  async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  beforeEach(async () => {
    refreshed = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-watcher-'));

    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      name: 'datasource-registry',
      actions: {
        list: {
          handler() {
            return {
              data: [
                {
                  id: 'source-a',
                  connectorConfig: { path: path.join(tmpDir, 'portfolio.csv') },
                },
              ],
            };
          },
        },
      },
    });

    broker.createService({
      name: 'datasource-cache',
      actions: {
        refresh: {
          params: { sourceId: 'string' },
          handler(ctx) {
            refreshed.push(ctx.params.sourceId);
            return { success: true };
          },
        },
      },
    });

    broker.createService({
      ...DatasourceWatcherService,
      settings: {
        ...DatasourceWatcherService.settings,
        watchDir: tmpDir,
        debounceMs: 25,
      },
    });

    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    if (broker) {
      await broker.stop();
    }
  });

  it('refreshes mapped datasource on file change', async () => {
    const service = broker.getLocalService('datasource-watcher');
    await service.onFileChange(path.join(tmpDir, 'portfolio.csv'));

    expect(refreshed).toContain('source-a');
  });

  it('debounces repeated file change events', async () => {
    const service = broker.getLocalService('datasource-watcher');

    service.scheduleFileChange(path.join(tmpDir, 'portfolio.csv'));
    service.scheduleFileChange(path.join(tmpDir, 'portfolio.csv'));

    await wait(60);

    expect(refreshed).toEqual(['source-a']);
  });

  it('ignores unmapped file changes', async () => {
    const service = broker.getLocalService('datasource-watcher');

    service.scheduleFileChange(path.join(tmpDir, 'unmapped.csv'));
    await wait(60);

    expect(refreshed).toEqual([]);
  });
});
