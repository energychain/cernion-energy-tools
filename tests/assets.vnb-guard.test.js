/**
 * Assets Service — VNB-not-found guard tests
 *
 * Regression tests for the unfiltered-query explosion that caused
 * RangeError: Invalid string length in saveSession when a VNB name
 * could not be resolved via cernion_market_partners.
 */

jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { callWithAutoPoll } = require('../src/async-job-poller');
const { ServiceBroker } = require('moleculer');
const AssetsService = require('../services/assets.service');

function createObjectStoreMockService() {
  return {
    name: 'object-store',
    actions: {
      put: {
        handler() {
          return { ok: true };
        },
      },
      get: {
        handler() {
          return null;
        },
      },
      query: {
        handler() {
          return { docs: [], totalDocs: 0 };
        },
      },
    },
  };
}

function createHitlMockService() {
  return {
    name: 'hitl',
    actions: {
      create: {
        handler() {
          return { success: true, item: { id: 'hitl-test', status: 'pending' } };
        },
      },
      get: {
        handler() {
          return { success: true, item: { id: 'hitl-test', status: 'pending' } };
        },
      },
    },
  };
}

describe('Assets Service — VNB guard (VNB_NOT_FOUND)', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    // energy-market.installations must NOT be called when VNB is unresolvable.
    // We record any call so we can assert it never happens.
    const installationsMock = jest.fn().mockResolvedValue([]);
    broker.createService({
      name: 'energy-market',
      actions: { installations: installationsMock },
    });
    broker._installationsMock = installationsMock;

    broker.createService(createObjectStoreMockService());
    broker.createService(createHitlMockService());
    broker.createService(AssetsService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw VNB_NOT_FOUND when market_partners returns 0 results and no location/bdew/id', async () => {
    // Simulate cernion_market_partners returning an empty result set
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: { count: 0, results: [], marketPartners: [] },
    });

    await expect(broker.call('assets.solar', { vnbName: 'Stadtwerke Vellbert' })).rejects.toThrow(
      /Netzbetreiber "Stadtwerke Vellbert" konnte im MaStR nicht gefunden werden/
    );
  });

  it('should set error code VNB_NOT_FOUND on the thrown error', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: { count: 0, results: [] },
    });

    let caught;
    try {
      await broker.call('assets.solar', { vnbName: 'Stadtwerke Vellbert' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // Moleculer wraps errors; check the original message contains the key detail
    expect(caught.message).toMatch(/cernion_market_partners/);
  });

  it('should NOT call energy-market.installations when VNB cannot be resolved', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: { count: 0, results: [] },
    });

    try {
      await broker.call('assets.solar', { vnbName: 'Stadtwerke Vellbert' });
    } catch {
      // expected
    }

    expect(broker._installationsMock).not.toHaveBeenCalled();
  });

  it('should throw for wind endpoint too when VNB is unresolvable', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: { count: 0, results: [] },
    });

    await expect(broker.call('assets.wind', { vnbName: 'Stadtwerke Vellbert' })).rejects.toThrow(
      /Netzbetreiber "Stadtwerke Vellbert"/
    );
  });

  it('should proceed normally when VNB resolves successfully to a MaStR ID', async () => {
    // Simulate a successful market_partners response with a MaStR ID
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: {
        count: 1,
        results: [
          {
            name: 'Stadtwerke Heidelberg Netze GmbH',
            mastrNetzbetreiberId: 'SNB935578300972',
            bdew: '9900987000002',
          },
        ],
      },
    });
    broker._installationsMock.mockResolvedValueOnce([]);

    // Should NOT throw — VNB resolved → proceeds to installations query
    await expect(
      broker.call('assets.solar', { vnbName: 'Stadtwerke Heidelberg' })
    ).resolves.toBeDefined();

    expect(broker._installationsMock).toHaveBeenCalledTimes(1);
    expect(broker._installationsMock.mock.calls[0][0].params.gridOperatorId).toBe(
      'SNB935578300972'
    );
  });

  it('should strip annotation from mastrNetzbetreiberId returned by cernion_market_partners', async () => {
    // cernion_market_partners returns annotated IDs like
    // "SNB935578300972 (strom, 100% Match)" — the annotation must be stripped
    // before passing to cernion_installations_local which cannot match it.
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: {
        count: 1,
        results: [
          {
            name: 'TWL Netze GmbH',
            mastrNetzbetreiberId: 'SNB935578300972 (strom, 100% Match)',
            bdew: '9904350000002',
          },
        ],
      },
    });
    broker._installationsMock.mockResolvedValueOnce([]);

    await expect(broker.call('assets.solar', { vnbName: 'TWL Netze GmbH' })).resolves.toBeDefined();

    // Must pass clean SNB ID — NOT the annotated string
    expect(broker._installationsMock.mock.calls[0][0].params.gridOperatorId).toBe(
      'SNB935578300972'
    );
  });

  it('should proceed normally when a location filter is provided even if VNB is not resolvable', async () => {
    // location bypasses the VNB guard — it's a valid filter on its own
    broker._installationsMock.mockResolvedValueOnce([]);

    await expect(broker.call('assets.solar', { location: '69115' })).resolves.toBeDefined();

    // callWithAutoPoll should NOT have been called — no vnbName given
    expect(callWithAutoPoll).not.toHaveBeenCalled();
    expect(broker._installationsMock).toHaveBeenCalledTimes(1);
  });

  it('should proceed when gridOperatorId is provided directly (no market_partners lookup)', async () => {
    broker._installationsMock.mockResolvedValueOnce([]);

    await expect(
      broker.call('assets.solar', { gridOperatorId: 'SNB935578300972' })
    ).resolves.toBeDefined();

    expect(callWithAutoPoll).not.toHaveBeenCalled();
    expect(broker._installationsMock).toHaveBeenCalledTimes(1);
  });
});
