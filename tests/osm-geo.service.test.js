const { ServiceBroker } = require('moleculer');

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const { callWithNewSession } = require('../src/mcp-client');
const OsmGeoService = require('../services/osm-geo.service');

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
              summary: { nearestSubstationMeters: 184, dominantOperator: 'TWL' },
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
                dominantOperator: 'TWL',
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
        registeredGridOperatorName: 'TWL Netze GmbH',
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
        gridOperator: 'TWL Netze GmbH',
      });
      expect(result.success).toBe(true);
    });

    it('should accept gridOperator as sole scope parameter', async () => {
      const result = await broker.call('osm-geo.substationFinder', {
        gridOperator: 'TWL Netze GmbH',
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

    it('should return topology metrics for a location', async () => {
      const result = await broker.call('osm-geo.gridTopology', {
        location: 'Ludwigshafen am Rhein',
        voltageLevel: 'MS',
      });
      expect(result.success).toBe(true);
      expect(result.data.topologyMetrics).toHaveProperty('topologyType');
      expect(result.data.topologyMetrics).toHaveProperty('nodes');
      expect(result.data.topologyMetrics).toHaveProperty('edges');
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_grid_topology',
        expect.objectContaining({ location: 'Ludwigshafen am Rhein', voltageLevel: 'MS' }),
        undefined
      );
    });

    it('should accept boundingBox scope', async () => {
      const result = await broker.call('osm-geo.gridTopology', {
        boundingBox: { north: 49.548, south: 49.427, east: 8.477, west: 8.298 },
        voltageLevel: 'MS',
        includeGraphData: true,
      });
      expect(result.success).toBe(true);
    });

    it('should accept gridOperator as sole scope parameter', async () => {
      const result = await broker.call('osm-geo.gridTopology', {
        gridOperator: 'TWL Netze GmbH',
      });
      expect(result.success).toBe(true);
    });

    it('should pass path analysis parameters through', async () => {
      await broker.call('osm-geo.gridTopology', {
        location: 'Ludwigshafen am Rhein',
        voltageLevel: 'MS',
        fromOsmId: 'node/123456789',
        toOsmId: 'node/987654321',
        includePathAnalysis: true,
      });
      expect(callWithNewSession).toHaveBeenCalledWith(
        'osm_grid_topology',
        expect.objectContaining({
          fromOsmId: 'node/123456789',
          toOsmId: 'node/987654321',
          includePathAnalysis: true,
        }),
        undefined
      );
    });

    it('should validate voltageLevel enum', async () => {
      await expect(
        broker.call('osm-geo.gridTopology', {
          location: 'Berlin',
          voltageLevel: 'INVALID',
        })
      ).rejects.toThrow();
    });

    it('should propagate MCP error response', async () => {
      callWithNewSession.mockResolvedValueOnce({
        success: false,
        error: { code: 'OVERPASS_TIMEOUT', message: 'Area too large' },
      });
      const result = await broker.call('osm-geo.gridTopology', {
        location: 'Bayern',
      });
      expect(result.success).toBe(false);
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
