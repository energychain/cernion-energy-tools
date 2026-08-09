const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));
jest.mock('axios');

const { callWithNewSession } = require('../src/mcp-client');
const axios = require('axios');
const OsmGeoService = require('../services/osm-geo.service');

// gridTopology now computes locally (Overpass + Nominatim via axios) instead
// of proxying to mcp.cernion.de — see src/osm-grid-topology.js.
const NOMINATIM_SEARCH_FIXTURE = [
  {
    boundingbox: ['49.273', '49.363', '8.483', '8.621'],
    lat: '49.3188892',
    lon: '8.5475467',
    display_name: 'Hockenheim, VVG der Stadt Hockenheim, Rhein-Neckar-Kreis, Baden-Württemberg',
  },
];

const GRID_TOPOLOGY_OVERPASS_FIXTURE = {
  elements: [
    { type: 'node', id: 1738604612, lat: 49.3, lon: 8.5, tags: { power: 'transformer' } },
    { type: 'node', id: 1738604613, lat: 49.31, lon: 8.51, tags: { power: 'transformer' } },
    { type: 'node', id: 1746960840, lat: 49.32, lon: 8.52, tags: { power: 'substation' } },
    { type: 'node', id: 9999999999, lat: 49.305, lon: 8.505, tags: { power: 'tower' } },
    {
      type: 'way',
      id: 500,
      nodes: [1738604612, 9999999999, 1738604613],
      tags: { power: 'line', voltage: '110000', ref: 'HOCKN-RHEIN', operator: 'Netze BW' },
    },
    {
      type: 'way',
      id: 501,
      nodes: [1738604613, 1746960840],
      tags: { power: 'minor_line', voltage: '20000' },
    },
  ],
};

describe('OSM Geo Service', () => {
  let broker;

  beforeAll(async () => {
    callWithNewSession.mockImplementation(async (toolName) => {
      switch (toolName) {
        case 'osm_geo_validate':
          return {
            success: true,
            data: {
              mastrNummer: 'SEE900012345678',
              validation: {
                verdict: 'CONSISTENT',
                confidenceScore: 72,
                flags: [],
                layer1_vnbdigital: { queried: true, match: true, authoritative: true },
                layer2_osm: { queried: true, osmObjectsFound: 3 },
              },
              dataQuality: { layer1Coverage: 'FULL', layer2Coverage: 'MEDIUM' },
            },
          };
        case 'osm_infrastructure_nearby':
          return {
            success: true,
            data: {
              queryCenter: { lat: 49.481, lon: 8.432 },
              radiusMeters: 1000,
              totalFound: 4,
              summary: { nearestSubstationMeters: 184, dominantOperator: 'STROMDAO' },
              infrastructure: [],
              dataQuality: { coverageLabel: 'MEDIUM' },
            },
          };
        case 'osm_substation_finder':
          return {
            success: true,
            data: {
              summary: {
                totalSubstations: 312,
                returnedSubstations: 200,
                dominantOperator: 'STROMDAO',
                dominantOperatorShare: 0.92,
                densityAssessment: { label: 'URBAN' },
              },
              substations: [],
              dataQuality: { coverageLabel: 'MEDIUM' },
            },
          };
        case 'osm_grid_topology':
          return {
            success: true,
            data: {
              area: 'Ludwigshafen am Rhein',
              topologyMetrics: {
                nodes: 847,
                edges: 1203,
                avgNodeDegree: 2.84,
                topologyType: 'RING',
                topologyIndicator: 0.84,
              },
              pathAnalysis: { requested: false },
              dataQuality: { coverageLabel: 'MEDIUM', osmEdgeCoverageEstimate: 0.47 },
            },
          };
        default:
          return { success: true, data: {} };
      }
    });

    broker = new ServiceBroker({ logger: false });
    broker.createService(OsmGeoService);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
  });

  // ─── validate ────────────────────────────────────────────────────────────────

  describe('validate action', () => {
    it('should be defined', () => {
      expect(broker.getLocalService('osm-geo').schema.actions.validate).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('osm-geo').schema.actions.validate;
      expect(action.rest).toBe('POST /validate');
    });

    it('should reject when neither mastrNummer nor coordinates are provided', async () => {
      await expect(broker.call('osm-geo.validate', {})).rejects.toThrow();
    });

    it('should accept mastrNummer as sole input', async () => {
      const result = await broker.call('osm-geo.validate', {
        mastrNummer: 'SEE900012345678',
      });
      expect(result.success).toBe(true);
      expect(result.data.validation.verdict).toBe('CONSISTENT');
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_geo_validate',
        expect.objectContaining({ mastrNummer: 'SEE900012345678' }),
        undefined
      );
    });

    it('should accept explicit latitude + longitude', async () => {
      const result = await broker.call('osm-geo.validate', {
        latitude: 49.481,
        longitude: 8.432,
        registeredGridOperatorName: 'STROMDAO Netze GmbH',
      });
      expect(result.success).toBe(true);
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_geo_validate',
        expect.objectContaining({ latitude: 49.481, longitude: 8.432 }),
        undefined
      );
    });

    it('should pass skipOsmLayer flag through to MCP', async () => {
      await broker.call('osm-geo.validate', {
        mastrNummer: 'SEE900012345678',
        skipOsmLayer: true,
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_geo_validate',
        expect.objectContaining({ skipOsmLayer: true }),
        undefined
      );
    });

    it('should enforce radiusMeters max of 5000', async () => {
      await expect(
        broker.call('osm-geo.validate', {
          mastrNummer: 'SEE900012345678',
          radiusMeters: 9999,
        })
      ).rejects.toThrow();
    });

    it('should propagate cernionToken from meta', async () => {
      callWithNewSession.mockResolvedValueOnce({ success: true, data: {} });
      await broker.call(
        'osm-geo.validate',
        { mastrNummer: 'SEE900012345678' },
        { meta: { cernionToken: 'test-token-xyz' } }
      );
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_geo_validate',
        expect.any(Object),
        'test-token-xyz'
      );
    });

    it('should return MCP error response as-is when success is false', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: false,
        error: { code: 'OVERPASS_RATE_LIMITED', message: 'Too many requests' },
      });
      const result = await broker.call('osm-geo.validate', {
        mastrNummer: 'SEE900012345678',
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── infrastructureNearby ────────────────────────────────────────────────────

  describe('infrastructureNearby action', () => {
    it('should be defined', () => {
      expect(broker.getLocalService('osm-geo').schema.actions.infrastructureNearby).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('osm-geo').schema.actions.infrastructureNearby;
      expect(action.rest).toBe('POST /infrastructure-nearby');
    });

    it('should reject when no coordinate source is provided', async () => {
      await expect(broker.call('osm-geo.infrastructureNearby', {})).rejects.toThrow();
    });

    it('should accept latitude + longitude', async () => {
      const result = await broker.call('osm-geo.infrastructureNearby', {
        latitude: 49.481,
        longitude: 8.432,
        radiusMeters: 500,
      });
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('totalFound');
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_infrastructure_nearby',
        expect.objectContaining({ latitude: 49.481, longitude: 8.432 }),
        undefined
      );
    });

    it('should accept location string', async () => {
      const result = await broker.call('osm-geo.infrastructureNearby', {
        location: '49.481,8.432',
        radiusMeters: 1000,
      });
      expect(result.success).toBe(true);
    });

    it('should accept mastrNummer as coordinate source', async () => {
      const result = await broker.call('osm-geo.infrastructureNearby', {
        mastrNummer: 'SEE900012345678',
        radiusMeters: 3000,
        infraTypes: ['line', 'cable'],
        include_geometry: true,
      });
      expect(result.success).toBe(true);
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_infrastructure_nearby',
        expect.objectContaining({ mastrNummer: 'SEE900012345678', include_geometry: true }),
        undefined
      );
    });

    it('should enforce radiusMeters max of 10000', async () => {
      await expect(
        broker.call('osm-geo.infrastructureNearby', {
          latitude: 49.481,
          longitude: 8.432,
          radiusMeters: 20000,
        })
      ).rejects.toThrow();
    });

    it('should pass constrainToBbox through to MCP', async () => {
      await broker.call('osm-geo.infrastructureNearby', {
        latitude: 49.481,
        longitude: 8.432,
        constrainToBbox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_infrastructure_nearby',
        expect.objectContaining({
          constrainToBbox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
        }),
        undefined
      );
    });
  });

  // ─── substationFinder ────────────────────────────────────────────────────────

  describe('substationFinder action', () => {
    it('should be defined', () => {
      expect(broker.getLocalService('osm-geo').schema.actions.substationFinder).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('osm-geo').schema.actions.substationFinder;
      expect(action.rest).toBe('POST /substation-finder');
    });

    it('should reject when no scope parameter is provided', async () => {
      await expect(broker.call('osm-geo.substationFinder', {})).rejects.toThrow();
    });

    it('should accept location name', async () => {
      const result = await broker.call('osm-geo.substationFinder', {
        location: 'Ludwigshafen am Rhein',
      });
      expect(result.success).toBe(true);
      expect(result.data.summary).toHaveProperty('totalSubstations');
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_substation_finder',
        expect.objectContaining({ location: 'Ludwigshafen am Rhein' }),
        undefined
      );
    });

    it('should accept boundingBox scope', async () => {
      const result = await broker.call('osm-geo.substationFinder', {
        boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
        gridOperator: 'STROMDAO Netze GmbH',
      });
      expect(result.success).toBe(true);
    });

    it('should accept gridOperator as sole scope parameter', async () => {
      const result = await broker.call('osm-geo.substationFinder', {
        gridOperator: 'STROMDAO Netze GmbH',
      });
      expect(result.success).toBe(true);
    });

    it('should pass voltageLevel and substationType filters through', async () => {
      await broker.call('osm-geo.substationFinder', {
        location: 'München',
        voltageLevel: 'HS',
        substationType: 'transmission',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_substation_finder',
        expect.objectContaining({ voltageLevel: 'HS', substationType: 'transmission' }),
        undefined
      );
    });

    it('should validate substationType enum', async () => {
      await expect(
        broker.call('osm-geo.substationFinder', {
          location: 'München',
          substationType: 'invalid-type',
        })
      ).rejects.toThrow();
    });
  });

  // ─── gridTopology ────────────────────────────────────────────────────────────

  describe('gridTopology action', () => {
    it('should be defined', () => {
      expect(broker.getLocalService('osm-geo').schema.actions.gridTopology).toBeDefined();
    });

    it('should have correct REST endpoint', () => {
      const action = broker.getLocalService('osm-geo').schema.actions.gridTopology;
      expect(action.rest).toBe('POST /grid-topology');
    });

    it('should reject when no scope parameter is provided', async () => {
      await expect(broker.call('osm-geo.gridTopology', {})).rejects.toThrow();
    });

    it('should return topology metrics for a location (geocoded via Nominatim)', async () => {
      axios.get.mockResolvedValueOnce({ data: NOMINATIM_SEARCH_FIXTURE });
      axios.post.mockResolvedValueOnce({ data: GRID_TOPOLOGY_OVERPASS_FIXTURE });
      const result = await broker.call('osm-geo.gridTopology', {
        location: 'Hockenheim',
      });
      expect(result.success).toBe(true);
      expect(result.data.scopeSource).toBe('location_name');
      expect(result.data.topologyMetrics).toHaveProperty('topologyType');
      expect(result.data.topologyMetrics.nodes).toBe(3);
      // The tower node (id 9999999999) is not a topology node — the line still
      // yields an edge between the two transformer nodes it connects.
      expect(result.data.topologyMetrics.edges).toBe(2);
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('nominatim'),
        expect.objectContaining({ params: expect.objectContaining({ q: 'Hockenheim' }) })
      );
    });

    it('should accept boundingBox scope directly, without geocoding', async () => {
      axios.post.mockResolvedValueOnce({ data: GRID_TOPOLOGY_OVERPASS_FIXTURE });
      const result = await broker.call('osm-geo.gridTopology', {
        boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
        voltageLevel: 'MS',
        includeGraphData: true,
      });
      expect(result.success).toBe(true);
      expect(result.data.scopeSource).toBe('explicit_bbox');
      expect(axios.get).not.toHaveBeenCalled();
      // voltageLevel:MS should keep only the 20kV minor_line edge (501), not the 110kV one.
      expect(result.data.graphData.edges).toHaveLength(1);
      expect(result.data.graphData.edges[0].voltageLevel).toBe('MS');
    });

    it('should accept gridOperator as sole scope parameter (geocoded as a place-name hint)', async () => {
      axios.get.mockResolvedValueOnce({ data: NOMINATIM_SEARCH_FIXTURE });
      axios.post.mockResolvedValueOnce({ data: GRID_TOPOLOGY_OVERPASS_FIXTURE });
      const result = await broker.call('osm-geo.gridTopology', {
        gridOperator: 'STROMDAO Netze GmbH',
      });
      expect(result.success).toBe(true);
      expect(result.data.scopeSource).toBe('grid_operator_name');
    });

    it('computes path analysis between two real topology nodes', async () => {
      axios.post.mockResolvedValueOnce({ data: GRID_TOPOLOGY_OVERPASS_FIXTURE });
      const result = await broker.call('osm-geo.gridTopology', {
        boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
        fromOsmId: 'node/1738604612',
        toOsmId: 'node/1746960840',
        includePathAnalysis: true,
      });
      expect(result.data.pathAnalysis.requested).toBe(true);
      expect(result.data.pathAnalysis.found).toBe(true);
      expect(result.data.pathAnalysis.hopCount).toBe(2);
      expect(result.data.pathAnalysis.path).toEqual([
        'node/1738604612',
        'node/1738604613',
        'node/1746960840',
      ]);
    });

    it('should validate voltageLevel enum', async () => {
      await expect(
        broker.call('osm-geo.gridTopology', {
          location: 'Berlin',
          voltageLevel: 'INVALID',
        })
      ).rejects.toThrow();
    });

    it('should return a degraded response when Overpass fails', async () => {
      axios.post.mockRejectedValueOnce(new Error('OVERPASS_TIMEOUT: query stalled'));
      const result = await broker.call('osm-geo.gridTopology', {
        boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
      });
      expect(result.success).toBe(false);
      expect(result.degradedReason).toBe('OVERPASS_TIMEOUT');
    });

    it('should return GEOCODING_FAILED when Nominatim finds no match', async () => {
      axios.get.mockResolvedValueOnce({ data: [] });
      const result = await broker.call('osm-geo.gridTopology', {
        location: 'NichtExistierenderOrtXYZ',
      });
      expect(result.success).toBe(false);
      expect(result.degradedReason).toBe('GEOCODING_FAILED');
    });

    it('should reject bounding boxes larger than the area guard', async () => {
      const result = await broker.call('osm-geo.gridTopology', {
        boundingBox: { north: 55, south: 47, east: 15, west: 5 }, // ~all of Germany
      });
      expect(result.success).toBe(false);
      expect(result.degradedReason).toBe('AREA_TOO_BROAD');
    });

    it('gives an honest dataQuality message (no fabricated coverage %) when 0 edges are derived', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          elements: [
            { type: 'node', id: 1, lat: 49.3, lon: 8.5, tags: { power: 'transformer' } },
          ],
        },
      });
      const result = await broker.call('osm-geo.gridTopology', {
        boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
      });
      expect(result.success).toBe(true);
      expect(result.data.topologyMetrics.edges).toBe(0);
      expect(result.data.dataQuality.osmEdgeCoverageEstimate).toBeNull();
      expect(result.data.dataQuality.warning).not.toMatch(/0% in OSM erfasst/);
    });
  });

  // ─── Meckesheim / 74909 regression (issue #273) ─────────────────────────────

  describe('Meckesheim narrow-locality regression (issue #273)', () => {
    it('substationFinder: postalCode + location combined into location string sent to MCP', async () => {
      await broker.call('osm-geo.substationFinder', {
        location: 'Meckesheim',
        postalCode: '74909',
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_substation_finder',
        expect.objectContaining({ location: '74909 Meckesheim' }),
        undefined
      );
    });

    it('substationFinder: postalCode alone used as location when no location provided', async () => {
      await broker.call('osm-geo.substationFinder', { postalCode: '74909' });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_substation_finder',
        expect.objectContaining({ location: '74909' }),
        undefined
      );
    });

    it('substationFinder: MCP exception returns structured degraded response', async () => {
      callWithNewSession.mockRejectedValueOnce(new Error('server-side abort'));
      const result = await broker.call('osm-geo.substationFinder', {
        location: 'Meckesheim',
        postalCode: '74909',
      });
      expect(result.success).toBe(false);
      expect(result.degradedReason).toBe('SERVICE_ABORT');
      expect(result.degradedReasonDetail).toMatch(/abort/i);
    });

    it('substationFinder: Overpass timeout error classified correctly', async () => {
      callWithNewSession.mockRejectedValueOnce(new Error('OVERPASS_TIMEOUT: query exceeded limit'));
      const result = await broker.call('osm-geo.substationFinder', {
        location: 'Meckesheim',
        postalCode: '74909',
      });
      expect(result.success).toBe(false);
      expect(result.degradedReason).toBe('OVERPASS_TIMEOUT');
    });

    it('substationFinder: hanging MCP call returns timeout degraded response', async () => {
      const previousTimeout = process.env.OSM_GEO_MCP_TIMEOUT_MS;
      process.env.OSM_GEO_MCP_TIMEOUT_MS = '100';
      callWithNewSession.mockImplementationOnce(() => new Promise(() => {}));
      try {
        const result = await broker.call('osm-geo.substationFinder', {
          location: 'Meckesheim',
          postalCode: '74909',
        });
        expect(result.success).toBe(false);
        expect(result.degradedReason).toBe('OVERPASS_TIMEOUT');
        expect(result.degradedReasonDetail).toMatch(/OSM_GEO_MCP_TIMEOUT/);
      } finally {
        if (previousTimeout === undefined) delete process.env.OSM_GEO_MCP_TIMEOUT_MS;
        else process.env.OSM_GEO_MCP_TIMEOUT_MS = previousTimeout;
      }
    });

    it('substationFinder: MCP success:false enriched with degradedReason', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: false,
        error: { code: 'GEOCODING_FAILED', message: 'Place not found: 74909 Meckesheim' },
      });
      const result = await broker.call('osm-geo.substationFinder', {
        location: 'Meckesheim',
        postalCode: '74909',
      });
      expect(result.success).toBe(false);
      expect(result.degradedReason).toBe('GEOCODING_FAILED');
    });

    it('gridTopology: postalCode + location combined into the geocoded location string', async () => {
      axios.get.mockResolvedValueOnce({ data: NOMINATIM_SEARCH_FIXTURE });
      axios.post.mockResolvedValueOnce({ data: GRID_TOPOLOGY_OVERPASS_FIXTURE });
      await broker.call('osm-geo.gridTopology', {
        location: 'Meckesheim',
        postalCode: '74909',
        includePathAnalysis: false,
        includeGraphData: false,
      });
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('nominatim'),
        expect.objectContaining({ params: expect.objectContaining({ q: '74909 Meckesheim' }) })
      );
    });

    it('gridTopology: Overpass exception returns structured degraded response', async () => {
      axios.get.mockResolvedValueOnce({ data: NOMINATIM_SEARCH_FIXTURE });
      axios.post.mockRejectedValueOnce(new Error('OVERPASS_TIMEOUT: narrow query stalled'));
      const result = await broker.call('osm-geo.gridTopology', {
        location: 'Meckesheim',
        postalCode: '74909',
      });
      expect(result.success).toBe(false);
      expect(result.degradedReason).toBe('OVERPASS_TIMEOUT');
    });

    it('substationFinder: accepts postalCode as sole scope (no location, boundingBox, or gridOperator)', async () => {
      const result = await broker.call('osm-geo.substationFinder', { postalCode: '74909' });
      expect(result.success).toBe(true);
    });

    it('gridTopology: accepts postalCode as sole scope', async () => {
      axios.get.mockResolvedValueOnce({ data: NOMINATIM_SEARCH_FIXTURE });
      axios.post.mockResolvedValueOnce({ data: GRID_TOPOLOGY_OVERPASS_FIXTURE });
      const result = await broker.call('osm-geo.gridTopology', { postalCode: '74909' });
      expect(result.success).toBe(true);
    });
  });

  // ─── OpenAPI metadata ────────────────────────────────────────────────────────

  describe('OpenAPI metadata', () => {
    it('should tag all actions as OSM Geo (OpenStreetMap)', () => {
      const schema = OsmGeoService;
      for (const [actionName, action] of Object.entries(schema.actions)) {
        expect(action.openapi).toBeDefined();
        expect(action.openapi.tags).toContain('OSM Geo (OpenStreetMap)');
        expect(action.openapi.summary).toBeTruthy();
        expect(action.openapi.description).toBeTruthy();
        expect(actionName).toBeTruthy();
      }
    });

    it('should have requestBody defined for all actions', () => {
      for (const action of Object.values(OsmGeoService.actions)) {
        expect(action.openapi.requestBody).toBeDefined();
        expect(action.openapi.requestBody.content['application/json']).toBeDefined();
      }
    });

    it('should have responses.200 defined for all actions', () => {
      for (const action of Object.values(OsmGeoService.actions)) {
        expect(action.openapi.responses['200']).toBeDefined();
      }
    });
  });
});
