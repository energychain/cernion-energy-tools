/**
 * Assets Service Tests
 */

const { ServiceBroker } = require('moleculer');
const Service = require('../services/assets.service');

describe('Assets Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: null,
    });
    broker.createService({ name: 'energy-market', actions: {} });
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
});
