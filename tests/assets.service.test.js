/**
 * Assets Service Tests
 */

// Top-level mock so byDirektvermarkter can stub callWithAutoPoll.
// Existing tests that go through the broker's energy-market service are unaffected.
jest.mock('../src/async-job-poller', () => ({
  callWithAutoPoll: jest.fn(),
}));

const { ServiceBroker } = require('moleculer');
const { callWithAutoPoll } = require('../src/async-job-poller');
const Service = require('../services/assets.service');

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

describe('Assets Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService({ name: 'energy-market', actions: {} });
    broker.createService(createObjectStoreMockService());
    broker.createService(createHitlMockService());
    broker.createService(Service);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should have correct service name', () => {
    expect(Service.name).toBe('assets');
  });

  it('should expose actions', () => {
    const service = broker.getLocalService('assets');
    expect(service.actions.list).toBeDefined();
  });
});

describe('Assets Service — NAP enrichment and netzbetreiberpruefungStatus', () => {
  let broker;
  const capturedCalls = [];

  const napDataFixture = {
    napMastrNummer: 'SAN914634531048',
    messlokation: 'DE0003976706990000000000000073131',
    spannungsebene: 354,
    spannungsebeneLabel: 'Niederspannung (LV)',
    nettoengpassleistung: 6.15,
    netzMastrNummer: 'SNE985057905075',
    netzbetreiberMastrNummer: 'SNB935578300972',
  };

  const solarFixture = [
    {
      mastrNummer: 'SEE988149395570',
      name: 'PV 2 Weiler',
      bruttoleistung: 6150,
      einheitBetriebsstatus: '35',
      latitude: 49.4744,
      longitude: 8.4349,
      netzbetreiberpruefungStatus: 2954,
      napData: napDataFixture,
    },
    {
      mastrNummer: 'SEE900000000002',
      name: 'PV Altanlage 2003',
      bruttoleistung: 3800,
      einheitBetriebsstatus: '35',
      latitude: 49.4093,
      longitude: 8.6942,
      netzbetreiberpruefungStatus: null,
      napData: undefined,
    },
  ];

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });

    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          async handler(ctx) {
            capturedCalls.push({ params: { ...ctx.params } });
            return solarFixture;
          },
        },
      },
    });

    broker.createService(createObjectStoreMockService());
    broker.createService(createHitlMockService());
    broker.createService(Service);
    await broker.start();
  });

  beforeEach(() => {
    capturedCalls.length = 0;
  });

  afterAll(async () => {
    await broker.stop();
  });

  // ── includeNapData pass-through ──────────────────────────────────────────

  it('should pass includeNapData: true to energy-market.installations by default', async () => {
    await broker.call('assets.solar', { location: '10115' });
    expect(capturedCalls.length).toBeGreaterThan(0);
    expect(capturedCalls[0].params.includeNapData).toBe(true);
  });

  it('should pass includeNapData: false when explicitly set to false', async () => {
    await broker.call('assets.solar', { location: '10115', includeNapData: false });
    expect(capturedCalls[0].params.includeNapData).toBe(false);
  });

  // ── GPS coordinates ──────────────────────────────────────────────────────

  it('should map latitude to Breitengrad and longitude to Längengrad', async () => {
    const result = await broker.call('assets.solar', { location: '10115' });
    const item = result.find((r) => r['SEE Nummer'] === 'SEE988149395570');
    expect(item['Breitengrad']).toBe(49.4744);
    expect(item['Längengrad']).toBe(8.4349);
  });

  // ── netzbetreiberpruefungStatus ─────────────────────────────────────────

  it('should map code 2954 → Geprüft', async () => {
    const result = await broker.call('assets.solar', { location: '10115' });
    const item = result.find((r) => r['SEE Nummer'] === 'SEE988149395570');
    expect(item['Netzbetreiberpruefung Status']).toBe(2954);
    expect(item['Netzbetreiberpruefung Status Name']).toBe('Geprüft');
  });

  it('should map null netzbetreiberpruefungStatus → null and null label', async () => {
    const result = await broker.call('assets.solar', { location: '10115' });
    const item = result.find((r) => r['SEE Nummer'] === 'SEE900000000002');
    expect(item['Netzbetreiberpruefung Status']).toBeNull();
    expect(item['Netzbetreiberpruefung Status Name']).toBeNull();
  });

  it('should map code 2955 → In Prüfung', async () => {
    capturedCalls.length = 0;
    const originalFixture = solarFixture[0].netzbetreiberpruefungStatus;
    solarFixture[0].netzbetreiberpruefungStatus = 2955;
    const result = await broker.call('assets.solar', { location: '10115' });
    const item = result.find((r) => r['SEE Nummer'] === 'SEE988149395570');
    expect(item['Netzbetreiberpruefung Status']).toBe(2955);
    expect(item['Netzbetreiberpruefung Status Name']).toBe('In Prüfung');
    solarFixture[0].netzbetreiberpruefungStatus = originalFixture;
  });

  it('should map code 3075 → Nicht vorgesehen', async () => {
    const originalFixture = solarFixture[0].netzbetreiberpruefungStatus;
    solarFixture[0].netzbetreiberpruefungStatus = 3075;
    const result = await broker.call('assets.solar', { location: '10115' });
    const item = result.find((r) => r['SEE Nummer'] === 'SEE988149395570');
    expect(item['Netzbetreiberpruefung Status']).toBe(3075);
    expect(item['Netzbetreiberpruefung Status Name']).toBe('Nicht vorgesehen');
    solarFixture[0].netzbetreiberpruefungStatus = originalFixture;
  });

  // ── NAP / MeLo fields ───────────────────────────────────────────────────

  it('should flatten napData fields into German column names', async () => {
    const result = await broker.call('assets.solar', { location: '10115' });
    const item = result.find((r) => r['SEE Nummer'] === 'SEE988149395570');
    expect(item['NAP MaStR Nummer']).toBe('SAN914634531048');
    expect(item['Messlokation (MeLo)']).toBe('DE0003976706990000000000000073131');
    expect(item['Spannungsebene NAP']).toBe('Niederspannung (LV)');
    expect(item['Nettoengpassleistung kW']).toBe(6.15);
    expect(item['Netz MaStR Nummer']).toBe('SNE985057905075');
    expect(item['Netzbetreiber NAP MaStR']).toBe('SNB935578300972');
  });

  it('should return null NAP fields for installations without napData', async () => {
    const result = await broker.call('assets.solar', { location: '10115' });
    const item = result.find((r) => r['SEE Nummer'] === 'SEE900000000002');
    expect(item['NAP MaStR Nummer']).toBeNull();
    expect(item['Messlokation (MeLo)']).toBeNull();
    expect(item['Spannungsebene NAP']).toBeNull();
    expect(item['Nettoengpassleistung kW']).toBeNull();
    expect(item['Netz MaStR Nummer']).toBeNull();
  });

  // ── includeNapData default behaviour across different endpoints ──────────

  it('should pass includeNapData: true by default for wind endpoint', async () => {
    await broker.call('assets.wind', { location: '10115' });
    expect(capturedCalls[0].params.includeNapData).toBe(true);
  });

  it('should pass includeNapData: true by default for storage endpoint', async () => {
    await broker.call('assets.storage', { location: '10115' });
    expect(capturedCalls[0].params.includeNapData).toBe(true);
  });

  // ── netzbetreiberPruefungStatus pass-through ─────────────────────────────

  it('should pass netzbetreiberPruefungStatus to energy-market.installations when provided', async () => {
    await broker.call('assets.solar', { location: '10115', netzbetreiberPruefungStatus: '2955' });
    expect(capturedCalls[0].params.netzbetreiberPruefungStatus).toBe('2955');
  });

  it('should NOT pass netzbetreiberPruefungStatus when not provided', async () => {
    await broker.call('assets.solar', { location: '10115' });
    expect(capturedCalls[0].params.netzbetreiberPruefungStatus).toBeUndefined();
  });

  // ── offset / pagination pass-through ────────────────────────────────────

  it('should pass offset to energy-market.installations when provided', async () => {
    await broker.call('assets.solar', { location: '10115', offset: 1000 });
    expect(capturedCalls[0].params.offset).toBe(1000);
  });

  it('should NOT pass offset when not provided', async () => {
    await broker.call('assets.solar', { location: '10115' });
    expect(capturedCalls[0].params.offset).toBeUndefined();
  });

  it('should pass offset for wind endpoint', async () => {
    await broker.call('assets.wind', { location: '10115', offset: 500 });
    expect(capturedCalls[0].params.offset).toBe(500);
  });

  it('should pass offset for storage endpoint', async () => {
    await broker.call('assets.storage', { location: '10115', offset: 2000 });
    expect(capturedCalls[0].params.offset).toBe(2000);
  });

  it('should forward non-13-digit bdewCode as gridOperatorBdewCode', async () => {
    await broker.call('assets.solar', { bdewCode: '10002954' });
    expect(capturedCalls[0].params.gridOperatorBdewCode).toBe('10002954');
  });

  it('should forward non-PLZ location as location (not postleitzahl)', async () => {
    await broker.call('assets.solar', { location: 'Ludwigshafen' });
    expect(capturedCalls[0].params.location).toBe('Ludwigshafen');
    expect(capturedCalls[0].params.postleitzahl).toBeUndefined();
  });
});

describe('Assets Service — byDirektvermarkter', () => {
  let broker;

  const direktvermarkterFixture = [
    {
      EinheitMastrNummer: 'SEE900000111001',
      name: 'PV NextKraftwerke 1',
      bruttoleistung: 750,
      einheitBetriebsstatus: '35',
      type: 'solar',
      inbetriebnahmedatum: '2025-03-15T00:00:00Z',
      postleitzahl: '68165',
      ort: 'Mannheim',
      bundesland: 'Baden-Württemberg',
      direktvermarkterName: 'Next Kraftwerke GmbH',
      direktvermarkterMastrNummer: 'ABR123456789',
      direktvermarktungBeginn: '2024-01-01',
      direktvermarktungStatus: 'Aktiv',
    },
    {
      EinheitMastrNummer: 'SWE900000111002',
      name: 'WEA Hunsrück',
      bruttoleistung: 3400,
      einheitBetriebsstatus: '35',
      type: 'wind',
      inbetriebnahmedatum: '2025-01-22T00:00:00Z',
      postleitzahl: '55483',
      ort: 'Hunsrück',
      bundesland: 'Rheinland-Pfalz',
      direktvermarkterName: 'Next Kraftwerke GmbH',
      direktvermarkterMastrNummer: 'ABR123456789',
      direktvermarktungBeginn: '2024-06-01',
      direktvermarktungStatus: 'Aktiv',
    },
  ];

  beforeAll(async () => {
    callWithAutoPoll.mockResolvedValue({
      success: true,
      data: { installations: direktvermarkterFixture, stats: { count: 2 } },
    });

    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({ name: 'energy-market', actions: {} });
    broker.createService(createObjectStoreMockService());
    broker.createService(createHitlMockService());
    broker.createService(Service);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('should throw when neither direktvermarkterName nor direktvermarkterMastrId is provided', async () => {
    await expect(broker.call('assets.byDirektvermarkter', {})).rejects.toThrow(
      '"direktvermarkterName" or "direktvermarkterMastrId"'
    );
  });

  it('should return mapped installations for byDirektvermarkter call', async () => {
    const result = await broker.call('assets.byDirektvermarkter', {
      direktvermarkterName: 'Next Kraftwerke',
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);

    const solarItem = result.find((r) => r['SEE Nummer'] === 'SEE900000111001');
    expect(solarItem).toBeDefined();
    expect(solarItem['Direktvermarkter']).toBe('Next Kraftwerke GmbH');
    expect(solarItem['Direktvermarkter MaStR']).toBe('ABR123456789');
    expect(solarItem['Direktvermarktung Status']).toBe('Aktiv');
    expect(solarItem['Datum Netzzugang']).toBe('2025-03-15');
    expect(solarItem['Betriebsstatus Name']).toBe('In Betrieb');
  });

  it('should correctly identify wind item type via item.type field', async () => {
    const result = await broker.call('assets.byDirektvermarkter', {
      direktvermarkterMastrId: 'ABR123456789',
      installationType: 'wind',
    });

    const windItem = result.find((r) => r['SEE Nummer'] === 'SWE900000111002');
    expect(windItem).toBeDefined();
    expect(windItem['Anlagentyp']).toBe('wind');
  });

  it('should call cernion_installations_local with direktvermarkterName param', async () => {
    callWithAutoPoll.mockClear();
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: { installations: [], stats: { count: 0 } },
    });

    await broker.call('assets.byDirektvermarkter', {
      direktvermarkterName: 'Statkraft',
      installationType: 'solar',
    });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_installations_local',
      expect.objectContaining({
        direktvermarkterName: 'Statkraft',
        type: 'solar',
        format: 'detailed',
      }),
      expect.any(Object),
      undefined
    );
  });

  it('should expose the action with correct REST path', () => {
    const svc = broker.getLocalService('assets');
    expect(svc.actions.byDirektvermarkter).toBeDefined();
  });
});

// ── assets.redispatchCount ────────────────────────────────────────────────────

describe('Assets Service — redispatchCount', () => {
  let broker;

  const redispatchFixture = [
    {
      EinheitMastrNummer: 'SEE900000200001',
      bruttoleistung: 8200,
      einheitBetriebsstatus: '35',
      type: 'solar',
    },
    {
      EinheitMastrNummer: 'SWE900000200002',
      bruttoleistung: 42000,
      einheitBetriebsstatus: '35',
      type: 'wind',
    },
    {
      EinheitMastrNummer: 'SWE900000200003',
      bruttoleistung: 18500,
      einheitBetriebsstatus: '35',
      type: 'combustion',
    },
    {
      EinheitMastrNummer: 'SBE900000200004',
      bruttoleistung: 4700,
      einheitBetriebsstatus: '35',
      type: 'biomass',
    },
  ];

  beforeAll(async () => {
    callWithAutoPoll.mockResolvedValue({
      success: true,
      data: { installations: redispatchFixture },
    });

    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({ name: 'energy-market', actions: {} });
    broker.createService(createObjectStoreMockService());
    broker.createService(createHitlMockService());
    broker.createService(Service);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    callWithAutoPoll.mockClear();
  });

  it('exposes redispatchCount action with GET /redispatch-count rest path', () => {
    const svc = broker.getLocalService('assets');
    expect(svc.actions.redispatchCount).toBeDefined();
  });

  it('returns count, totalCapacityMW and byType for a valid gridOperatorId', async () => {
    const res = await broker.call('assets.redispatchCount', {
      gridOperatorId: 'SNB935578300972',
    });

    expect(res.count).toBe(4);
    expect(res.totalCapacityMW).toBe(73.4); // (8200+42000+18500+4700)/1000 = 73.4
    expect(res.byType).toBeDefined();
    expect(res.byType.solar.count).toBe(1);
    expect(res.byType.solar.capacityKW).toBe(8200);
    expect(res.byType.wind.count).toBe(1);
    expect(res.byType.wind.capacityKW).toBe(42000);
    expect(res.byType.combustion.count).toBe(1);
    expect(res.byType.combustion.capacityKW).toBe(18500);
    expect(res.byType.biomass.count).toBe(1);
    expect(res.byType.biomass.capacityKW).toBe(4700);
  });

  it('passes gridOperatorMastrId to cernion_installations_local', async () => {
    await broker.call('assets.redispatchCount', { gridOperatorId: 'SNB935578300972' });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_installations_local',
      expect.objectContaining({
        gridOperatorMastrId: 'SNB935578300972',
        type: 'all',
        minCapacity: 100,
        status: 'InBetrieb',
        format: 'detailed',
      }),
      expect.any(Object),
      undefined
    );
  });

  it('passes gridOperatorBdewCode when only bdewCode is given', async () => {
    await broker.call('assets.redispatchCount', { bdewCode: '9907473000008' });

    expect(callWithAutoPoll).toHaveBeenCalledWith(
      'cernion_installations_local',
      expect.objectContaining({ gridOperatorBdewCode: '9907473000008' }),
      expect.any(Object),
      undefined
    );
  });

  it('returns count:0 and empty byType when MCP returns empty installations', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: { installations: [] },
    });

    const res = await broker.call('assets.redispatchCount', {
      gridOperatorId: 'SNB000000000000',
    });

    expect(res.count).toBe(0);
    expect(res.totalCapacityMW).toBe(0);
    expect(res.byType).toEqual({});
  });

  it('returns error shape when MCP call throws', async () => {
    callWithAutoPoll.mockRejectedValueOnce(new Error('MCP session failed'));

    const res = await broker.call('assets.redispatchCount', {
      gridOperatorId: 'SNB935578300972',
    });

    expect(res.count).toBeNull();
    expect(res.totalCapacityMW).toBeNull();
    expect(res.error).toMatch('MCP session failed');
  });

  it('returns error shape when neither gridOperatorId nor bdewCode provided', async () => {
    const res = await broker.call('assets.redispatchCount', {});
    expect(res.count).toBeNull();
    expect(res.error).toMatch('required');
  });

  it('rejects invalid gridOperatorId pattern', async () => {
    await expect(
      broker.call('assets.redispatchCount', { gridOperatorId: 'INVALID123' })
    ).rejects.toThrow();
  });

  it('rejects bdewCode with fewer than 7 digits', async () => {
    await expect(broker.call('assets.redispatchCount', { bdewCode: '12345' })).rejects.toThrow();
  });

  it('normalises items returned as top-level array (alternate MCP shape)', async () => {
    callWithAutoPoll.mockResolvedValueOnce([
      { bruttoleistung: 500, type: 'solar' },
      { bruttoleistung: 1000, type: 'wind' },
    ]);

    const res = await broker.call('assets.redispatchCount', {
      gridOperatorId: 'SNB935578300972',
    });

    expect(res.count).toBe(2);
    expect(res.totalCapacityMW).toBe(1.5);
  });

  it('translates raw MaStR Energieträger codes to readable byType labels', async () => {
    callWithAutoPoll.mockResolvedValueOnce({
      success: true,
      data: {
        installations: [
          { bruttoleistung: 8200, type: '2495' }, // → solar
          { bruttoleistung: 42000, type: '2484' }, // → wind (onshore)
          { bruttoleistung: 18500, type: '2490' }, // → combustion
          { bruttoleistung: 4700, type: '2485' }, // → biomass
          { bruttoleistung: 1200, type: '2491' }, // → storage
        ],
      },
    });

    const res = await broker.call('assets.redispatchCount', {
      gridOperatorId: 'SNB935578300972',
    });

    // readable keys must be present
    expect(res.byType.solar).toBeDefined();
    expect(res.byType.wind).toBeDefined();
    expect(res.byType.combustion).toBeDefined();
    expect(res.byType.biomass).toBeDefined();
    expect(res.byType.storage).toBeDefined();

    // raw numeric codes must NOT appear as keys
    expect(res.byType['2495']).toBeUndefined();
    expect(res.byType['2484']).toBeUndefined();
    expect(res.byType['2490']).toBeUndefined();
    expect(res.byType['2485']).toBeUndefined();
    expect(res.byType['2491']).toBeUndefined();

    // capacity check for one type
    expect(res.byType.solar.count).toBe(1);
    expect(res.byType.solar.capacityKW).toBe(8200);
  });
});
