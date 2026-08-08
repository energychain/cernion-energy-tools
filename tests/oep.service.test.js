'use strict';

/**
 * Tests for services/oep.service.js (AP2 — OEP connector)
 */

jest.mock('axios');

const axios = require('axios');
const { ServiceBroker } = require('moleculer');
const OepService = require('../services/oep.service');
const { CERNION_RELEVANT_OEP_TABLES } = require('../src/oep-tables');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SCHEMAS_FIXTURE = ['model_draft', 'scenario', 'supply', 'demand', 'grid'];

const TABLES_FIXTURE = [
  { name: 'oed_scenario_bundle', description: 'Energy scenario bundles (NEP, TYNDP)' },
  { name: 'oed_datatype', description: 'OED data type registry' },
  { name: 'photovoltaik_einspeisezeitreihe', description: 'PV feed-in time series' },
];

const META_FIXTURE = {
  name: 'oed_scenario_bundle',
  schema: 'model_draft',
  fields: [
    { name: 'id', type: 'integer', description: 'Primary key' },
    { name: 'scenario', type: 'text', description: 'Scenario name' },
    { name: 'year', type: 'integer', description: 'Target year' },
  ],
};

const ROWS_FIXTURE = [
  { id: 1, scenario: 'NEP 2035 B', year: 2035 },
  { id: 2, scenario: 'TYNDP 2030', year: 2030 },
];

const OEP_COMPARE_ROWS_FIXTURE = [
  {
    id: 101,
    name: 'PV Höheinöd Nord',
    capacity_mw: 1.0,
    postal_code: '66989',
    city: 'Höheinöd',
    commissioning_year: 2022,
    latitude: 49.3201,
    longitude: 7.6051,
  },
  {
    id: 102,
    name: 'Wind Höheinöd West',
    capacity_mw: 2.2,
    postal_code: '66989',
    city: 'Höheinöd',
    commissioning_year: 2021,
    latitude: 49.331,
    longitude: 7.592,
  },
];

const MASTR_COMPARE_INSTALLATIONS_FIXTURE = [
  {
    mastrNummer: 'SEE0001',
    name: 'PV Höheinöd Nord',
    bruttoleistung: 1000,
    postleitzahl: '66989',
    ort: 'Höheinöd',
    inbetriebnahmejahr: 2022,
    latitude: 49.3202,
    longitude: 7.6052,
    einheitBetriebsstatus: '35',
  },
  {
    mastrNummer: 'SEE0002',
    name: 'PV Höheinöd Süd',
    bruttoleistung: 850,
    postleitzahl: '66989',
    ort: 'Höheinöd',
    inbetriebnahmejahr: 2023,
    latitude: 49.318,
    longitude: 7.61,
    einheitBetriebsstatus: '35',
  },
];

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
describe('OEP Service — structure', () => {
  it('has correct service name', () => {
    expect(OepService.name).toBe('oep');
  });

  it('exposes all 5 required actions', () => {
    expect(OepService.actions).toHaveProperty('listSchemas');
    expect(OepService.actions).toHaveProperty('listTables');
    expect(OepService.actions).toHaveProperty('getTableMeta');
    expect(OepService.actions).toHaveProperty('query');
    expect(OepService.actions).toHaveProperty('search');
    expect(OepService.actions).toHaveProperty('energyTables');
    expect(OepService.actions).toHaveProperty('compareWithMastr');
  });

  it('all actions have REST aliases', () => {
    expect(OepService.actions.listSchemas.rest).toMatch(/GET/);
    expect(OepService.actions.listTables.rest).toMatch(/GET/);
    expect(OepService.actions.getTableMeta.rest).toMatch(/GET/);
    expect(OepService.actions.query.rest).toMatch(/GET/);
    expect(OepService.actions.search.rest).toMatch(/GET/);
    expect(OepService.actions.energyTables.rest).toMatch(/GET/);
    expect(OepService.actions.compareWithMastr.rest).toMatch(/POST/);
  });

  it('all actions have OpenAPI tags pointing to OEP', () => {
    for (const [, action] of Object.entries(OepService.actions)) {
      expect(action.openapi.tags).toContain('OEP (Open Energy Platform)');
    }
  });
});

// ---------------------------------------------------------------------------
// Broker-integrated handler tests
// ---------------------------------------------------------------------------
describe('OEP Service — action handlers', () => {
  let broker;
  let oepSvc;
  let installationsMock;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    installationsMock = jest.fn();
    broker.createService({
      name: 'energy-market',
      actions: {
        installations: {
          handler(ctx) {
            return installationsMock(ctx.params);
          },
        },
      },
    });
    oepSvc = broker.createService(OepService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    // Clear instance-level cache between tests to prevent cache leakage
    if (oepSvc) oepSvc._cache.clear();
    axios.get.mockReset();
    installationsMock.mockReset();
    installationsMock.mockResolvedValue({
      success: true,
      data: {
        installations: MASTR_COMPARE_INSTALLATIONS_FIXTURE,
        stats: { count: MASTR_COMPARE_INSTALLATIONS_FIXTURE.length },
      },
    });
  });

  // ------------------------------------------------------------------
  // listSchemas
  // ------------------------------------------------------------------
  describe('listSchemas', () => {
    it('returns schemas from OEP', async () => {
      axios.get.mockResolvedValueOnce({ data: SCHEMAS_FIXTURE });
      const result = await broker.call('oep.listSchemas');
      expect(Array.isArray(result.schemas)).toBe(true);
      expect(result.schemas).toEqual(SCHEMAS_FIXTURE);
    });

    it('calls OEP /schema/ endpoint', async () => {
      axios.get.mockResolvedValueOnce({ data: SCHEMAS_FIXTURE });
      await broker.call('oep.listSchemas');
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/schema/'),
        expect.any(Object)
      );
    });

    it('returns empty array if OEP returns non-array', async () => {
      axios.get.mockResolvedValueOnce({ data: { error: 'unexpected format' } });
      const result = await broker.call('oep.listSchemas');
      expect(result.schemas).toEqual([]);
    });

    it('throws a clean 404 instead of a raw AxiosError when OEP schema listing is unavailable', async () => {
      const err = new Error('Not found');
      err.response = { status: 404 };
      axios.get.mockRejectedValueOnce(err);
      await expect(broker.call('oep.listSchemas')).rejects.toMatchObject({ code: 404 });
    });
  });

  // ------------------------------------------------------------------
  // listTables
  // ------------------------------------------------------------------
  describe('listTables', () => {
    it('returns tables for a schema', async () => {
      axios.get.mockResolvedValueOnce({ data: TABLES_FIXTURE });
      const result = await broker.call('oep.listTables', { schema: 'model_draft' });
      expect(result.schema).toBe('model_draft');
      expect(Array.isArray(result.tables)).toBe(true);
      expect(result.tables).toHaveLength(3);
    });

    it('throws 404 when schema not found', async () => {
      const err = new Error('Not found');
      err.response = { status: 404 };
      axios.get.mockRejectedValueOnce(err);
      await expect(
        broker.call('oep.listTables', { schema: 'nonexistent_schema' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ------------------------------------------------------------------
  // getTableMeta
  // ------------------------------------------------------------------
  describe('getTableMeta', () => {
    it('returns table metadata', async () => {
      axios.get.mockResolvedValueOnce({ data: META_FIXTURE });
      const result = await broker.call('oep.getTableMeta', {
        schema: 'model_draft',
        table: 'oed_scenario_bundle',
      });
      expect(result.schema).toBe('model_draft');
      expect(result.table).toBe('oed_scenario_bundle');
      expect(result.meta).toEqual(META_FIXTURE);
    });

    it('throws 404 when table not found', async () => {
      const err = new Error('Not found');
      err.response = { status: 404 };
      axios.get.mockRejectedValueOnce(err);
      await expect(
        broker.call('oep.getTableMeta', { schema: 'model_draft', table: 'ghost_table' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ------------------------------------------------------------------
  // query
  // ------------------------------------------------------------------
  describe('query', () => {
    it('returns rows from OEP table', async () => {
      axios.get.mockResolvedValueOnce({ data: ROWS_FIXTURE });
      const result = await broker.call('oep.query', {
        schema: 'model_draft',
        table: 'oed_scenario_bundle',
      });
      expect(result.schema).toBe('model_draft');
      expect(result.table).toBe('oed_scenario_bundle');
      expect(result.rows).toEqual(ROWS_FIXTURE);
      expect(result.rowCount).toBe(2);
    });

    it('passes limit and offset to OEP', async () => {
      axios.get.mockResolvedValueOnce({ data: [] });
      await broker.call('oep.query', {
        schema: 'model_draft',
        table: 'oed_scenario_bundle',
        limit: 50,
        offset: 100,
      });
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ params: expect.objectContaining({ limit: 50, offset: 100 }) })
      );
    });

    it('passes where filter to OEP when provided', async () => {
      axios.get.mockResolvedValueOnce({ data: [] });
      await broker.call('oep.query', {
        schema: 'model_draft',
        table: 'oed_scenario_bundle',
        where: 'year=2035',
      });
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ params: expect.objectContaining({ where: 'year=2035' }) })
      );
    });

    it('returns empty rows array if OEP returns non-array', async () => {
      axios.get.mockResolvedValueOnce({ data: { error: 'unexpected' } });
      const result = await broker.call('oep.query', {
        schema: 'model_draft',
        table: 'oed_scenario_bundle',
      });
      expect(result.rows).toEqual([]);
      expect(result.rowCount).toBe(0);
    });

    it('throws 404 when table not found', async () => {
      const err = new Error('Not found');
      err.response = { status: 404 };
      axios.get.mockRejectedValueOnce(err);
      await expect(
        broker.call('oep.query', { schema: 'model_draft', table: 'ghost_table' })
      ).rejects.toMatchObject({ code: 404 });
    });
  });

  // ------------------------------------------------------------------
  // energyTables
  // ------------------------------------------------------------------
  describe('energyTables', () => {
    it('returns an array with at least 3 entries', async () => {
      const result = await broker.call('oep.energyTables');
      expect(Array.isArray(result.tables)).toBe(true);
      expect(result.tables.length).toBeGreaterThanOrEqual(3);
    });

    it('every entry has all required fields', async () => {
      const result = await broker.call('oep.energyTables');
      for (const entry of result.tables) {
        expect(typeof entry.schema).toBe('string');
        expect(typeof entry.table).toBe('string');
        expect(typeof entry.description).toBe('string');
        expect(typeof entry.cernionUseCase).toBe('string');
        expect(typeof entry.oeoClass).toBe('string');
      }
    });

    it('every oeoClass begins with oeo:', async () => {
      const result = await broker.call('oep.energyTables');
      for (const entry of result.tables) {
        expect(entry.oeoClass).toMatch(/^oeo:/);
      }
    });

    it('count matches tables array length', async () => {
      const result = await broker.call('oep.energyTables');
      expect(result.count).toBe(result.tables.length);
    });
  });

  // ------------------------------------------------------------------
  // search — searches the curated table catalog, no OEP call
  // ------------------------------------------------------------------
  describe('search', () => {
    it('finds a curated table by name substring without calling OEP', async () => {
      const result = await broker.call('oep.search', { q: 'zensus_population_per_bkg' });
      expect(axios.get).not.toHaveBeenCalled();
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.results.some((r) => r.schema === 'society')).toBe(true);
    });

    it('finds a curated table by description substring', async () => {
      const result = await broker.call('oep.search', { q: 'Gemeindeschlüssel' });
      expect(result.results.some((r) => r.table.includes('zensus_population'))).toBe(true);
    });

    it('respects the schema filter', async () => {
      const result = await broker.call('oep.search', { q: 'de', schema: 'society' });
      for (const r of result.results) {
        expect(r.schema).toBe('society');
      }
    });

    it('returns an empty result set for a non-matching term', async () => {
      const result = await broker.call('oep.search', { q: 'xyznonexistentterm' });
      expect(result.total).toBe(0);
      expect(result.results).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // compareWithMastr
  // ------------------------------------------------------------------
  describe('compareWithMastr', () => {
    it('returns oep.available and mastr.available in response', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      const result = await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
      });
      expect(result).toHaveProperty('oep');
      expect(result).toHaveProperty('mastr');
      expect(typeof result.oep.available).toBe('boolean');
      expect(typeof result.mastr.available).toBe('boolean');
      expect(result.mastr.available).toBe(true);
    });

    it('oep.available is true when oep.query fulfills', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      const result = await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
      });
      expect(result.oep.available).toBe(true);
    });

    it('oep.available is false (graceful) when oep.query rejects', async () => {
      const oepErr = new Error('OEP offline');
      axios.get.mockRejectedValueOnce(oepErr);
      const result = await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
      });
      expect(result.oep.available).toBe(false);
      expect(result.oep.count).toBe(0);
      expect(result.delta).toBeNull();
    });

    it('returns a structured delta output for matched and unmatched rows', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      const result = await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
      });
      expect(result.delta).toEqual(
        expect.objectContaining({
          matchedPairs: 1,
          mastrOnly: 1,
          oepOnly: 1,
        })
      );
      expect(result.delta.fieldDeltas.capacityKw).toEqual(
        expect.objectContaining({ mean: 0, max: 0 })
      );
      expect(Array.isArray(result._evidence)).toBe(true);
    });

    it('oeoMappingNote is present and mentions oeo:PowerPlant', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      const result = await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
      });
      expect(typeof result.oeoMappingNote).toBe('string');
      expect(result.oeoMappingNote).toMatch(/oeo:PowerPlant/);
    });

    it('oep.source reflects schema.table default', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      const result = await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
      });
      expect(result.oep.source).toBe('supply.ego_dp_res_powerplant');
    });

    it('mastr.source always references MaStR', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      const result = await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
      });
      expect(result.mastr.source).toMatch(/MaStR/);
    });

    it('passes installationType all through to energy-market.installations', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      await broker.call('oep.compareWithMastr', {
        gridOperatorId: 'SNB924510006275',
        installationType: 'all',
      });

      expect(installationsMock).toHaveBeenCalledWith(
        expect.objectContaining({ installationType: 'all', includeNapData: false })
      );
    });

    it('returns async job descriptor for REST callers with large requests', async () => {
      axios.get.mockResolvedValueOnce({ data: OEP_COMPARE_ROWS_FIXTURE });
      const result = await broker.call(
        'oep.compareWithMastr',
        {
          gridOperatorId: 'SNB924510006275',
          installationType: 'all',
          limit: 'all',
        },
        { meta: { $gateway: true } }
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          status: 'queued',
          jobId: expect.any(String),
        })
      );
    });
  });
});

// ---------------------------------------------------------------------------
// CERNION_RELEVANT_OEP_TABLES module tests
// ---------------------------------------------------------------------------
describe('CERNION_RELEVANT_OEP_TABLES', () => {
  it('contains at least 3 entries', () => {
    expect(CERNION_RELEVANT_OEP_TABLES.length).toBeGreaterThanOrEqual(3);
  });

  it('all entries have all required fields', () => {
    for (const entry of CERNION_RELEVANT_OEP_TABLES) {
      expect(typeof entry.schema).toBe('string');
      expect(typeof entry.table).toBe('string');
      expect(typeof entry.description).toBe('string');
      expect(typeof entry.cernionUseCase).toBe('string');
      expect(entry.oeoClass).toMatch(/^oeo:/);
    }
  });

  it('no duplicate schema+table combinations', () => {
    const seen = new Set();
    for (const entry of CERNION_RELEVANT_OEP_TABLES) {
      const key = `${entry.schema}.${entry.table}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ---------------------------------------------------------------------------
// RULE 13 agent prompt tests
// ---------------------------------------------------------------------------
describe('RULE 13 in agent.service.js', () => {
  const agentSource = require('fs').readFileSync(
    require('path').join(__dirname, '../services/agent.service.js'),
    'utf8'
  );

  it('prompt contains oep.compareWithMastr', () => {
    expect(agentSource).toContain('oep.compareWithMastr');
  });

  it('prompt contains oep.energyTables', () => {
    expect(agentSource).toContain('oep.energyTables');
  });
});
