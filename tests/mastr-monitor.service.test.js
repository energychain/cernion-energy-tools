'use strict';

const { ServiceBroker } = require('moleculer');
const MastrMonitorService = require('../services/mastr-monitor.service');

function createObjectStoreMock() {
  const buckets = new Map();

  function getBucket(namespace) {
    if (!buckets.has(namespace)) {
      buckets.set(namespace, new Map());
    }
    return buckets.get(namespace);
  }

  return {
    name: 'object-store',
    actions: {
      put: {
        params: {
          namespace: { type: 'string' },
          key: { type: 'string' },
          payload: { type: 'object' },
        },
        handler(ctx) {
          const bucket = getBucket(ctx.params.namespace);
          bucket.set(ctx.params.key, {
            namespace: ctx.params.namespace,
            key: ctx.params.key,
            payload: ctx.params.payload,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          return bucket.get(ctx.params.key);
        },
      },

      get: {
        params: {
          namespace: { type: 'string' },
          key: { type: 'string' },
        },
        handler(ctx) {
          const bucket = getBucket(ctx.params.namespace);
          const item = bucket.get(ctx.params.key);
          if (!item) {
            const err = new Error('OBJECT_NOT_FOUND');
            err.code = 404;
            err.type = 'OBJECT_NOT_FOUND';
            throw err;
          }
          return item;
        },
      },

      query: {
        params: {
          namespace: { type: 'string' },
          selector: { type: 'object', optional: true },
          limit: { type: 'number', optional: true },
          skip: { type: 'number', optional: true },
        },
        handler(ctx) {
          const selector = ctx.params.selector || {};
          const bucket = getBucket(ctx.params.namespace);
          const docs = [...bucket.values()].filter((doc) => {
            return Object.entries(selector).every(([path, expected]) => {
              if (path === 'ns') return true;
              const actual = path.split('.').reduce((acc, segment) => {
                if (!acc || typeof acc !== 'object') return undefined;
                return acc[segment];
              }, doc);
              return actual === expected;
            });
          });

          const skip = Number(ctx.params.skip || 0);
          const limit = Number(ctx.params.limit || docs.length || 50);
          return {
            docs: docs.slice(skip, skip + limit),
            totalDocs: docs.length,
          };
        },
      },

      delete: {
        params: {
          namespace: { type: 'string' },
          key: { type: 'string' },
        },
        handler(ctx) {
          const bucket = getBucket(ctx.params.namespace);
          bucket.delete(ctx.params.key);
          return { success: true, namespace: ctx.params.namespace, key: ctx.params.key };
        },
      },
    },
  };
}

describe('mastr-monitor.service', () => {
  let broker;
  let mockedInstallations;
  let installationCallCount;

  beforeAll(async () => {
    mockedInstallations = [];
    installationCallCount = 0;
    broker = new ServiceBroker({ logger: false });
    broker.createService(createObjectStoreMock());
    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler() {
            installationCallCount += 1;
            return {
              success: true,
              data: {
                installations: mockedInstallations,
              },
            };
          },
        },
      },
    });
    broker.createService(MastrMonitorService);
    await broker.start();
  });

  beforeEach(() => {
    installationCallCount = 0;
  });

  afterAll(async () => {
    await broker.stop();
  });

  it("has service name 'mastr-monitor'", () => {
    const service = broker.getLocalService('mastr-monitor');
    expect(service).toBeTruthy();
    expect(service.name).toBe('mastr-monitor');
  });

  it('has 12 actions', () => {
    const service = broker.getLocalService('mastr-monitor');
    expect(Object.keys(service.actions || {})).toHaveLength(12);
  });

  it('createWatch validates input', async () => {
    await expect(
      broker.call('mastr-monitor.createWatch', {
        name: 'ab',
        query: {},
      })
    ).rejects.toBeTruthy();
  });

  it('createWatch rejects cron schedules more frequent than daily', async () => {
    await expect(
      broker.call('mastr-monitor.createWatch', {
        name: 'Too Frequent Schedule',
        query: { type: 'solar' },
        schedule: {
          type: 'cron',
          expression: '*/5 * * * *',
          timezone: 'Europe/Berlin',
        },
      })
    ).rejects.toMatchObject({ code: 422, type: 'INVALID_SCHEDULE' });
  });

  it('createWatch accepts daily cron schedule', async () => {
    const result = await broker.call('mastr-monitor.createWatch', {
      name: 'Daily Cron Schedule',
      query: { type: 'solar' },
      schedule: {
        type: 'cron',
        expression: '0 6 * * *',
        timezone: 'Europe/Berlin',
      },
    });

    expect(result.success).toBe(true);
    expect(result.watchId).toBeTruthy();
  });

  it('service defaults max installations per watch to 50000', () => {
    const service = broker.getLocalService('mastr-monitor');
    expect(service.settings.maxInstallationsPerWatch).toBe(50000);
  });

  it('fetchInstallationsForWatch respects remaining limit across types', async () => {
    const service = broker.getLocalService('mastr-monitor');
    const originalMax = service.settings.maxInstallationsPerWatch;
    service.settings.maxInstallationsPerWatch = 5;

    mockedInstallations = Array.from({ length: 10 }, (_, index) => ({ mastrNummer: `SEE${index}` }));

    try {
      const rows = await service.fetchInstallationsForWatch({ query: { type: 'all' } }, {});
      expect(rows).toHaveLength(5);
      expect(installationCallCount).toBe(1);
    } finally {
      service.settings.maxInstallationsPerWatch = originalMax;
    }
  });

  it('createWatch stores watch and returns watchId format', async () => {
    const result = await broker.call('mastr-monitor.createWatch', {
      name: 'TWL Solar >100kW Monitoring',
      query: {
        gridOperatorMastrId: 'SNB935578300972',
        type: 'solar',
        minCapacity: 100,
      },
    });

    expect(result.success).toBe(true);
    expect(result.watchId).toMatch(/^twl-solar-100kw-monitoring_[a-f0-9]{8}$/);
    expect(result.status).toBe('pending_baseline');
  });

  it('createWatch applies default watchFields', async () => {
    const created = await broker.call('mastr-monitor.createWatch', {
      name: 'Defaults Monitoring',
      query: { type: 'all' },
    });

    const watch = await broker.call('mastr-monitor.getWatch', {
      watchId: created.watchId,
    });

    expect(Array.isArray(watch.watchFields)).toBe(true);
    expect(watch.watchFields).toContain('einheitBetriebsstatus');
    expect(watch.watchFields).toContain('lastUpdatedAt');
  });

  it('getWatch returns created watch', async () => {
    const created = await broker.call('mastr-monitor.createWatch', {
      name: 'Get Watch Example',
      query: { type: 'wind' },
    });

    const watch = await broker.call('mastr-monitor.getWatch', {
      watchId: created.watchId,
    });

    expect(watch.watchId).toBe(created.watchId);
    expect(watch.name).toBe('Get Watch Example');
  });

  it('getWatch returns 404 for unknown watch', async () => {
    await expect(
      broker.call('mastr-monitor.getWatch', { watchId: 'does_not_exist' })
    ).rejects.toMatchObject({ code: 404, type: 'WATCH_NOT_FOUND' });
  });

  it('listWatches returns list (empty and after creation)', async () => {
    const emptyBroker = new ServiceBroker({ logger: false });
    emptyBroker.createService(createObjectStoreMock());
    emptyBroker.createService(MastrMonitorService);
    await emptyBroker.start();

    const emptyList = await emptyBroker.call('mastr-monitor.listWatches');
    expect(emptyList.watches).toEqual([]);
    expect(emptyList.total).toBe(0);

    await emptyBroker.call('mastr-monitor.createWatch', {
      name: 'List Watch Example',
      query: { type: 'solar' },
    });

    const populated = await emptyBroker.call('mastr-monitor.listWatches');
    expect(populated.total).toBe(1);

    await emptyBroker.stop();
  });

  it('deleteWatch deletes watch', async () => {
    const created = await broker.call('mastr-monitor.createWatch', {
      name: 'Delete Watch Example',
      query: { type: 'biomass' },
    });

    const removed = await broker.call('mastr-monitor.deleteWatch', {
      watchId: created.watchId,
    });

    expect(removed.success).toBe(true);

    await expect(
      broker.call('mastr-monitor.getWatch', { watchId: created.watchId })
    ).rejects.toMatchObject({ code: 404 });
  });

  it('subscribe creates pending confirmation subscription', async () => {
    const created = await broker.call('mastr-monitor.createWatch', {
      name: 'Subscription Watch',
      query: { type: 'storage' },
    });

    const sub = await broker.call('mastr-monitor.subscribe', {
      watchId: created.watchId,
      email: 'test@example.com',
      onlyOnChanges: true,
      language: 'de',
    });

    expect(sub.success).toBe(true);
    expect(sub.status).toBe('pending_confirmation');
    expect(typeof sub.token).toBe('string');
  });

  it('confirmSubscription sets status to confirmed', async () => {
    const created = await broker.call('mastr-monitor.createWatch', {
      name: 'Confirm Subscription Watch',
      query: { type: 'solar' },
    });

    const sub = await broker.call('mastr-monitor.subscribe', {
      watchId: created.watchId,
      email: 'confirm@example.com',
      onlyOnChanges: true,
      language: 'de',
    });

    const html = await broker.call('mastr-monitor.confirmSubscription', {
      token: sub.token,
    });

    expect(typeof html).toBe('string');
    expect(html).toContain('Anmeldung bestätigt');

    const rows = await broker.call('object-store.query', {
      namespace: 'mastr_subscriptions',
      selector: { 'payload.watchId': created.watchId },
      limit: 50,
      skip: 0,
    });

    const confirmed = rows.docs.find((doc) => doc.payload.email === 'confirm@example.com');
    expect(confirmed.payload.status).toBe('confirmed');
  });

  it('unsubscribe deletes subscription by token', async () => {
    const created = await broker.call('mastr-monitor.createWatch', {
      name: 'Unsubscribe Watch',
      query: { type: 'wind' },
    });

    const sub = await broker.call('mastr-monitor.subscribe', {
      watchId: created.watchId,
      email: 'unsubscribe@example.com',
      onlyOnChanges: true,
      language: 'de',
    });

    const result = await broker.call('mastr-monitor.unsubscribe', {
      watchId: created.watchId,
      token: sub.token,
    });

    expect(result.success).toBe(true);

    await expect(
      broker.call('mastr-monitor.unsubscribe', {
        watchId: created.watchId,
        token: sub.token,
      })
    ).rejects.toMatchObject({ code: 404, type: 'SUBSCRIPTION_NOT_FOUND' });
  });

  it('stores chunked snapshots and deltas and hydrates payloads', async () => {
    const service = broker.getLocalService('mastr-monitor');
    const originalChunking = service.settings.chunkingEnabled;
    const originalChunkSize = service.settings.chunkSize;
    service.settings.chunkingEnabled = true;
    service.settings.chunkSize = 2;

    const snapshotKey = 'chunk-watch:2026-04-17';
    const snapshot = {
      watchId: 'chunk-watch',
      snapshotKey,
      timestamp: '2026-04-17T06:00:00.000Z',
      count: 5,
      entries: Array.from({ length: 5 }, (_, index) => ({ mastrNummer: `SEE-S-${index}` })),
    };

    const delta = {
      watchId: 'chunk-watch',
      deltaId: '2026-04-17',
      deltaKey: snapshotKey,
      baseline: '2026-04-16T06:00:00.000Z',
      timestamp: '2026-04-17T06:00:00.000Z',
      summary: { added: 5, changed: 3, removed: 4 },
      added: Array.from({ length: 5 }, (_, index) => ({ mastrNummer: `SEE-A-${index}` })),
      changed: Array.from({ length: 3 }, (_, index) => ({ mastrNummer: `SEE-C-${index}` })),
      removed: Array.from({ length: 4 }, (_, index) => ({ mastrNummer: `SEE-R-${index}` })),
    };

    try {
      await service.persistSnapshot(snapshotKey, snapshot);
      await service.persistDelta(snapshotKey, delta);

      const storedSnapshot = await service.getPayload('mastr_snapshots', snapshotKey);
      const storedDelta = await service.getPayload('mastr_deltas', snapshotKey);

      expect(storedSnapshot.chunked).toBe(true);
      expect(storedDelta.chunked).toBe(true);

      const hydratedSnapshot = await service.hydrateSnapshotPayload(storedSnapshot);
      const hydratedDelta = await service.hydrateDeltaPayload(storedDelta);

      expect(hydratedSnapshot.entries).toHaveLength(5);
      expect(hydratedDelta.added).toHaveLength(5);
      expect(hydratedDelta.changed).toHaveLength(3);
      expect(hydratedDelta.removed).toHaveLength(4);
    } finally {
      service.settings.chunkingEnabled = originalChunking;
      service.settings.chunkSize = originalChunkSize;
    }
  });

  describe('runWatch (integration)', () => {
    it('creates baseline on first run and delta on second run', async () => {
      const service = broker.getLocalService('mastr-monitor');
      const originalStartBaselineSnapshotJob = service.startBaselineSnapshotJob;
      service.startBaselineSnapshotJob = async () => ({ success: true, status: 'queued' });
      try {
        const created = await broker.call('mastr-monitor.createWatch', {
          name: 'Run Watch Integration',
          query: {
            type: 'solar',
          },
          watchFields: [
            'einheitBetriebsstatus',
            'netzbetreiberpruefungStatus',
            'lastUpdatedAt',
          ],
        });

        mockedInstallations = [
          {
            mastrNummer: 'SEE100',
            name: 'PV 100',
            ort: 'Ludwigshafen',
            postleitzahl: '67061',
            einheitBetriebsstatus: '35',
            netzbetreiberpruefungStatus: 2955,
            lastUpdatedAt: '2026-04-17T06:00:00.000Z',
          },
          {
            mastrNummer: 'SEE200',
            name: 'PV 200',
            ort: 'Ludwigshafen',
            postleitzahl: '67061',
            einheitBetriebsstatus: '35',
            netzbetreiberpruefungStatus: 2954,
            lastUpdatedAt: '2026-04-17T06:00:00.000Z',
          },
          {
            mastrNummer: 'SEE300',
            name: 'PV 300',
            ort: 'Ludwigshafen',
            postleitzahl: '67061',
            einheitBetriebsstatus: '35',
            netzbetreiberpruefungStatus: 2955,
            lastUpdatedAt: '2026-04-17T06:00:00.000Z',
          },
        ];

        const first = await broker.call('mastr-monitor.runWatch', {
          watchId: created.watchId,
        });

        expect(first.success).toBe(true);
        expect(first.snapshot.count).toBe(3);
        expect(first.delta).toBeNull();

        mockedInstallations = [
          {
            mastrNummer: 'SEE100',
            name: 'PV 100',
            ort: 'Ludwigshafen',
            postleitzahl: '67061',
            einheitBetriebsstatus: '35',
            netzbetreiberpruefungStatus: 2954,
            lastUpdatedAt: '2026-04-18T06:00:00.000Z',
          },
          {
            mastrNummer: 'SEE200',
            name: 'PV 200',
            ort: 'Ludwigshafen',
            postleitzahl: '67061',
            einheitBetriebsstatus: '35',
            netzbetreiberpruefungStatus: 2954,
            lastUpdatedAt: '2026-04-17T06:00:00.000Z',
          },
          {
            mastrNummer: 'SEE300',
            name: 'PV 300',
            ort: 'Ludwigshafen',
            postleitzahl: '67061',
            einheitBetriebsstatus: '35',
            netzbetreiberpruefungStatus: 2955,
            lastUpdatedAt: '2026-04-17T06:00:00.000Z',
          },
          {
            mastrNummer: 'SEE400',
            name: 'PV 400',
            ort: 'Ludwigshafen',
            postleitzahl: '67061',
            einheitBetriebsstatus: '35',
            netzbetreiberpruefungStatus: 2955,
            lastUpdatedAt: '2026-04-18T06:00:00.000Z',
          },
        ];

        const second = await broker.call('mastr-monitor.runWatch', {
          watchId: created.watchId,
        });

        expect(second.success).toBe(true);
        expect(second.delta).toMatchObject({ added: 1, changed: 1, removed: 0 });

        const deltas = await broker.call('mastr-monitor.getDeltas', { watchId: created.watchId });
        const latestDelta = deltas.deltas[0];

        expect(latestDelta.added).toHaveLength(1);
        expect(latestDelta.changed).toHaveLength(1);

        const field = latestDelta.changed[0].fields.find(
          (f) => f.field === 'netzbetreiberpruefungStatus'
        );
        expect(field.from).toBe(2955);
        expect(field.to).toBe(2954);
      } finally {
        service.startBaselineSnapshotJob = originalStartBaselineSnapshotJob;
      }
    });
  });
});
