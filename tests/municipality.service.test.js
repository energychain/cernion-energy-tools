'use strict';

/**
 * Tests for services/municipality.service.js
 */

jest.mock('axios');

const axios = require('axios');
const { ServiceBroker } = require('moleculer');
const MunicipalityService = require('../services/municipality.service');

const HOCKENHEIM_NOMINATIM_FIXTURE = {
  name: 'Hockenheim',
  display_name: 'Hockenheim, VVG der Stadt Hockenheim, Rhein-Neckar-Kreis, Baden-Württemberg, 68766, Deutschland',
  address: {
    town: 'Hockenheim',
    county: 'Rhein-Neckar-Kreis',
    state: 'Baden-Württemberg',
    postcode: '68766',
    country: 'Deutschland',
    country_code: 'de',
  },
  extratags: {
    admin_level: '8',
    'de:amtlicher_gemeindeschluessel': '08226032',
  },
};

const OCEAN_NOMINATIM_FIXTURE = { error: 'Unable to geocode' };

// ---------------------------------------------------------------------------
describe('Municipality Service — structure', () => {
  it('has correct service name', () => {
    expect(MunicipalityService.name).toBe('municipality');
  });

  it('exposes lookup and reverseGeocode actions', () => {
    expect(MunicipalityService.actions).toHaveProperty('lookup');
    expect(MunicipalityService.actions).toHaveProperty('reverseGeocode');
  });

  it('both actions are GET (read-only)', () => {
    expect(MunicipalityService.actions.lookup.rest).toMatch(/GET/);
    expect(MunicipalityService.actions.reverseGeocode.rest).toMatch(/GET/);
  });

  it('both actions have OpenAPI tags pointing to Municipality', () => {
    for (const [, action] of Object.entries(MunicipalityService.actions)) {
      expect(action.openapi.tags).toContain('Municipality');
    }
  });
});

// ---------------------------------------------------------------------------
describe('Municipality Service — action handlers', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(MunicipalityService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    axios.get.mockReset();
  });

  // ------------------------------------------------------------------
  // lookup
  // ------------------------------------------------------------------
  describe('lookup', () => {
    it('resolves a known municipality by name', async () => {
      const result = await broker.call('municipality.lookup', { municipality: 'Hockenheim' });
      expect(result.found).toBe(true);
      expect(result.ags).toBe('08226032');
      expect(result.state).toBe('Baden-Württemberg');
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('resolves a known municipality by PLZ', async () => {
      const result = await broker.call('municipality.lookup', { municipality: '68766' });
      expect(result.found).toBe(true);
      expect(result.name).toBe('Hockenheim');
    });

    it('resolves a known municipality by AGS', async () => {
      const result = await broker.call('municipality.lookup', { ags: '08226032' });
      expect(result.found).toBe(true);
      expect(result.name).toBe('Hockenheim');
    });

    it('returns found:false for an unresolvable name', async () => {
      const result = await broker.call('municipality.lookup', {
        municipality: 'NichtExistierendeGemeindeXYZ',
      });
      expect(result.found).toBe(false);
    });

    it('rejects when neither municipality nor ags is given', async () => {
      await expect(broker.call('municipality.lookup', {})).rejects.toMatchObject({ code: 422 });
    });
  });

  // ------------------------------------------------------------------
  // reverseGeocode
  // ------------------------------------------------------------------
  describe('reverseGeocode', () => {
    it('resolves AGS + full GV100 profile from coordinates', async () => {
      axios.get.mockResolvedValueOnce({ data: HOCKENHEIM_NOMINATIM_FIXTURE });
      const result = await broker.call('municipality.reverseGeocode', {
        lat: 49.3183,
        lon: 8.5495,
      });
      expect(result.found).toBe(true);
      expect(result.ags).toBe('08226032');
      expect(result.name).toBe('Hockenheim');
      expect(result.population).toBeGreaterThan(0);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('nominatim'),
        expect.objectContaining({ params: expect.objectContaining({ lat: 49.3183, lon: 8.5495 }) })
      );
    });

    it('sends a non-empty User-Agent header (Overpass 406 lesson)', async () => {
      axios.get.mockResolvedValueOnce({ data: HOCKENHEIM_NOMINATIM_FIXTURE });
      await broker.call('municipality.reverseGeocode', { lat: 49.3183, lon: 8.5495 });
      const [, config] = axios.get.mock.calls[0];
      expect(config.headers['User-Agent']).toBeTruthy();
    });

    it('returns found:false when Nominatim has no match (e.g. open water)', async () => {
      axios.get.mockResolvedValueOnce({ data: OCEAN_NOMINATIM_FIXTURE });
      const result = await broker.call('municipality.reverseGeocode', { lat: 0, lon: 0 });
      expect(result.found).toBe(false);
      expect(result.sourceStatus).toBe('geocoding-no-ags-match');
    });

    it('returns found:false when Nominatim 404s', async () => {
      const err = new Error('Not found');
      err.response = { status: 404 };
      axios.get.mockRejectedValueOnce(err);
      const result = await broker.call('municipality.reverseGeocode', { lat: 0, lon: 0 });
      expect(result.found).toBe(false);
    });

    it('propagates non-404 errors (e.g. Nominatim outage)', async () => {
      const err = new Error('Service unavailable');
      err.response = { status: 503 };
      axios.get.mockRejectedValueOnce(err);
      await expect(
        broker.call('municipality.reverseGeocode', { lat: 49.3183, lon: 8.5495 })
      ).rejects.toThrow();
    });

    it('validates lat/lon ranges', async () => {
      await expect(
        broker.call('municipality.reverseGeocode', { lat: 200, lon: 8.5495 })
      ).rejects.toMatchObject({ type: 'VALIDATION_ERROR' });
    });

    it('surfaces geocoding-only-no-gv100-match when AGS is not in the local GV100 snapshot', async () => {
      axios.get.mockResolvedValueOnce({
        data: {
          ...HOCKENHEIM_NOMINATIM_FIXTURE,
          extratags: { admin_level: '8', 'de:amtlicher_gemeindeschluessel': '99999999' },
        },
      });
      const result = await broker.call('municipality.reverseGeocode', {
        lat: 49.3183,
        lon: 8.5495,
      });
      expect(result.found).toBe(true);
      expect(result.ags).toBe('99999999');
      expect(result.sourceStatus).toBe('geocoding-only-no-gv100-match');
      expect(result.population).toBeNull();
    });
  });
});
