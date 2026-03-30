'use strict';

/**
 * Tests for services/oep.service.js (AP2 — OEP connector)
 */

jest.mock('axios');

const axios = require('axios');
const { ServiceBroker } = require('moleculer');
const OepService = require('../services/oep.service');

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
  });

  it('all actions have REST aliases', () => {
    expect(OepService.actions.listSchemas.rest).toMatch(/GET/);
    expect(OepService.actions.listTables.rest).toMatch(/GET/);
    expect(OepService.actions.getTableMeta.rest).toMatch(/GET/);
    expect(OepService.actions.query.rest).toMatch(/GET/);
    expect(OepService.actions.search.rest).toMatch(/GET/);
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

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
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
  // search
  // ------------------------------------------------------------------
  describe('search', () => {
    it('finds tables matching search term in name', async () => {
      // listSchemas call
      axios.get.mockResolvedValueOnce({ data: ['model_draft'] });
      // listTables call for model_draft
      axios.get.mockResolvedValueOnce({ data: TABLES_FIXTURE });

      const result = await broker.call('oep.search', { q: 'photovoltaik' });
      expect(result.query).toBe('photovoltaik');
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].table).toBe('photovoltaik_einspeisezeitreihe');
    });

    it('finds tables matching search term in description', async () => {
      axios.get.mockResolvedValueOnce({ data: ['model_draft'] });
      axios.get.mockResolvedValueOnce({ data: TABLES_FIXTURE });

      const result = await broker.call('oep.search', { q: 'NEP' });
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].matchedOn).toMatch(/description/);
    });

    it('is case-insensitive', async () => {
      axios.get.mockResolvedValueOnce({ data: ['model_draft'] });
      axios.get.mockResolvedValueOnce({ data: TABLES_FIXTURE });

      const result = await broker.call('oep.search', { q: 'SCENARIO' });
      expect(result.results.length).toBeGreaterThan(0);
    });

    it('returns empty results for non-matching term', async () => {
      axios.get.mockResolvedValueOnce({ data: ['model_draft'] });
      axios.get.mockResolvedValueOnce({ data: TABLES_FIXTURE });

      const result = await broker.call('oep.search', { q: 'xyzzyquux99' });
      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('restricts search to given schema when schemaFilter is provided', async () => {
      // Only one listTables call should happen (not listSchemas)
      axios.get.mockResolvedValueOnce({ data: TABLES_FIXTURE });

      const result = await broker.call('oep.search', {
        q: 'scenario',
        schema: 'model_draft',
      });
      expect(result.schemaFilter).toBe('model_draft');
      // axios.get called only once (listTables), not twice (listSchemas + listTables)
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('respects limit parameter', async () => {
      const manyTables = Array.from({ length: 30 }, (_, i) => ({
        name: `scenario_table_${i}`,
        description: 'scenario data',
      }));
      axios.get.mockResolvedValueOnce({ data: ['model_draft'] });
      axios.get.mockResolvedValueOnce({ data: manyTables });

      const result = await broker.call('oep.search', { q: 'scenario', limit: 5 });
      expect(result.results.length).toBeLessThanOrEqual(5);
    });
  });
});
