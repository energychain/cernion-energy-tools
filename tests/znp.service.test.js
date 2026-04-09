'use strict';

/**
 * tests/znp.service.test.js
 * Unit tests for the Zielnetzplanung (ZNP) Workspace API service.
 *
 * Coverage targets:
 *  - createProject: UUID returned, graph initialised, SUB_1 pre-seeded, PouchDB written
 *  - addLayer0: nodes/edges added, idempotency (duplicate skip), 404 on unknown project
 *  - addLayer2: Measurement node added, Layer 2 short-circuit in calculateGFactor, 404
 *  - addLayer1: building nodes + edges, cluster heuristics, gFactorAdjustment stored, 404
 *  - calculateGFactor: capacity sum, simultaneity factor lookup, layer short-circuiting,
 *                       empty graph, unknown substation, project-not-found,
 *                       Layer 1 cluster multiplier, Layer 2 measured short-circuit
 *  - listProjects / getProjectMeta: correct output shape
 *  - getSimultaneityFactor: all bracket boundaries
 */

// ─── Mock external dependencies ──────────────────────────────────────────────
// These are mocked before the service module is loaded (jest hoisting).

jest.mock('../src/znp-pdf-extractor', () => ({
  extractPeakLoadFromFile: jest.fn().mockResolvedValue(650),
}));

jest.mock('../src/znp-osm-buildings', () => ({
  fetchBuildingsForBbox: jest.fn().mockResolvedValue([]),
  mapAssetsToBuildings:  jest.fn().mockReturnValue([]),
}));

jest.mock('../src/znp-clustering-heuristics', () => ({
  detectClusters:           jest.fn().mockReturnValue([]),
  computeGFactorAdjustment: jest.fn().mockReturnValue(1.0),
}));

// Mock centralized llm-client (Issue 2 + 3: strategicPrompts, addAssumption)
const mockGenerateStructured = jest.fn();
jest.mock('../src/llm-client', () => ({
  generateStructured: mockGenerateStructured,
  SchemaType: {
    OBJECT: 'OBJECT', ARRAY: 'ARRAY',
    STRING: 'STRING', NUMBER: 'NUMBER', BOOLEAN: 'BOOLEAN',
  },
}));

const { extractPeakLoadFromFile }  = require('../src/znp-pdf-extractor');
const { fetchBuildingsForBbox, mapAssetsToBuildings } = require('../src/znp-osm-buildings');
const { detectClusters, computeGFactorAdjustment }   = require('../src/znp-clustering-heuristics');

const { ServiceBroker } = require('moleculer');
const ZnpService = require('../services/znp.service');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBbox() {
  return { south: 49.47, west: 8.43, north: 49.52, east: 8.52 };
}

function makeAssets(count = 3, baseCapacity = 10, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    mastrNummer: `SEE9001${String(offset + i).padStart(8, '0')}`,
    capacity: baseCapacity + i,
    assetType: 'solar',
    lat: 49.49 + (offset + i) * 0.001,
    lon: 8.47 + (offset + i) * 0.001,
  }));
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('ZNP Service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      // Use a unique in-memory PouchDB path per test run to avoid conflicts
      nodeID: `znp-test-${Date.now()}`,
    });
    broker.createService({
      ...ZnpService,
      settings: {
        ...ZnpService.settings,
        dbPath: `./data/znp-test-${Date.now()}`,
      },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  // ─── createProject ────────────────────────────────────────────────────────

  describe('createProject', () => {
    it('returns a projectId (UUID format) and bbox echo', async () => {
      const bbox = makeBbox();
      const result = await broker.call('znp.createProject', { bbox });

      expect(result.projectId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(result.bbox).toEqual(bbox);
      expect(result.createdAt).toBeDefined();
    });

    it('returns graphStats with 1 node (SUB_1) and 0 edges initially', async () => {
      const result = await broker.call('znp.createProject', { bbox: makeBbox() });
      expect(result.graphStats.nodes).toBe(1);
      expect(result.graphStats.edges).toBe(0);
    });

    it('uses the provided name when given', async () => {
      const result = await broker.call('znp.createProject', {
        bbox: makeBbox(),
        name: 'Testprojekt Nord',
      });
      expect(result.name).toBe('Testprojekt Nord');
    });

    it('generates a default name when name is omitted', async () => {
      const result = await broker.call('znp.createProject', { bbox: makeBbox() });
      expect(result.name).toMatch(/^ZNP Project /);
    });

    it('each call produces a unique projectId', async () => {
      const r1 = await broker.call('znp.createProject', { bbox: makeBbox() });
      const r2 = await broker.call('znp.createProject', { bbox: makeBbox() });
      expect(r1.projectId).not.toBe(r2.projectId);
    });

    // ── Issue 1: bbox string coercion (convert:true) ──────────────────────
    it('accepts bbox fields as string numbers (coercion — Issue 1)', async () => {
      const result = await broker.call('znp.createProject', {
        bbox: { south: '49.47', west: '8.43', north: '49.52', east: '8.52' },
      });
      expect(result.projectId).toBeDefined();
      expect(result.bbox.south).toBe(49.47);
      expect(result.bbox.west).toBe(8.43);
    });
  });

  // ─── addLayer0 ────────────────────────────────────────────────────────────

  describe('addLayer0', () => {
    let projectId;

    beforeEach(async () => {
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
    });

    it('adds the correct number of nodes and edges', async () => {
      const assets = makeAssets(3);
      const result = await broker.call('znp.addLayer0', { projectId, assets });

      expect(result.nodesAdded).toBe(3);
      expect(result.edgesAdded).toBe(3);
      // totalNodes = 3 assets + 1 SUB_1
      expect(result.totalNodes).toBe(4);
      expect(result.totalEdges).toBe(3);
      expect(result.skipped).toBe(0);
    });

    it('skips duplicate mastrNummer entries (idempotent)', async () => {
      const assets = makeAssets(2);
      await broker.call('znp.addLayer0', { projectId, assets });

      // Call again with the same assets + 1 new one
      const result = await broker.call('znp.addLayer0', {
        projectId,
        assets: [...assets, makeAssets(1, 99, 100)[0]], // offset=100 → unique mastrNummer
      });

      expect(result.nodesAdded).toBe(1);
      expect(result.edgesAdded).toBe(1);
      expect(result.skipped).toBe(2);
    });

    it('returns correct totalNodes and totalEdges after two batches', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(5) });
      const result = await broker.call('znp.addLayer0', {
        projectId,
        assets: makeAssets(3, 100, 5), // offset=5 → mastrNummers 00000005..7, no overlap
      });
      // 5 + 3 assets + 1 SUB_1
      expect(result.totalNodes).toBe(9);
      expect(result.totalEdges).toBe(8);
    });

    it('throws 404 ZNP_PROJECT_NOT_FOUND for an unknown projectId', async () => {
      await expect(
        broker.call('znp.addLayer0', {
          projectId: '00000000-0000-0000-0000-000000000000',
          assets: makeAssets(1),
        })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });

    // ── Issue 2: per-item validation → 400 INVALID_ASSET ─────────────────
    it('throws 400 INVALID_ASSET for asset with non-positive capacity', async () => {
      await expect(
        broker.call('znp.addLayer0', {
          projectId,
          assets: [{ mastrNummer: 'SEE900BAD0001', capacity: 0, assetType: 'solar' }],
        })
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_ASSET' });
    });

    it('throws 400 INVALID_ASSET for asset with negative capacity', async () => {
      await expect(
        broker.call('znp.addLayer0', {
          projectId,
          assets: [{ mastrNummer: 'SEE900BAD0002', capacity: -5, assetType: 'solar' }],
        })
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_ASSET' });
    });

    it('throws 400 INVALID_ASSET for asset with empty mastrNummer', async () => {
      await expect(
        broker.call('znp.addLayer0', {
          projectId,
          assets: [{ mastrNummer: '', capacity: 10, assetType: 'solar' }],
        })
      ).rejects.toMatchObject({ code: 400, type: 'INVALID_ASSET' });
    });

    it('coerces string capacity to number (convert:true — Issue 2)', async () => {
      const result = await broker.call('znp.addLayer0', {
        projectId,
        assets: [{ mastrNummer: 'SEE900STR0001', capacity: '12.5', assetType: 'solar', lat: 49.49, lon: 8.47 }],
      });
      expect(result.nodesAdded).toBe(1);
    });
  });

  // ─── calculateGFactor ─────────────────────────────────────────────────────

  describe('calculateGFactor', () => {
    let projectId;
    const CAPACITY_PER_ASSET = 10; // kW

    beforeEach(async () => {
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
    });

    it('returns totalCapacityKW = sum of all asset capacities (Layer 0)', async () => {
      // 3 assets at 10, 11, 12 kW → total 33 kW
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3, CAPACITY_PER_ASSET) });
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });

      expect(result.totalCapacityKW).toBe(33);
      expect(result.assetCount).toBe(3);
    });

    it('applies correct simultaneity factor for n=3 (g=0.80)', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3, CAPACITY_PER_ASSET) });
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });

      expect(result.simultaneityFactor).toBe(0.80);
      // 33 * 0.80 = 26.4
      expect(result.adjustedCapacityKW).toBeCloseTo(26.4, 2);
    });

    it('returns 0 capacity when no assets have been loaded', async () => {
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });
      expect(result.totalCapacityKW).toBe(0);
      expect(result.assetCount).toBe(0);
      expect(result.simultaneityFactor).toBe(0);
      expect(result.adjustedCapacityKW).toBe(0);
    });

    it('returns projectId and substationId in the response', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(1) });
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });

      expect(result.projectId).toBe(projectId);
      expect(result.substationId).toBe('SUB_1');
      expect(result.targetLayer).toBe(0);
    });

    it('throws 404 ZNP_PROJECT_NOT_FOUND for an unknown projectId', async () => {
      await expect(
        broker.call('znp.calculateGFactor', {
          projectId: '00000000-0000-0000-0000-000000000000',
          target_layer: 0,
        })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });

    it('throws 404 ZNP_SUBSTATION_NOT_FOUND for an unknown substationId', async () => {
      await expect(
        broker.call('znp.calculateGFactor', {
          projectId,
          target_layer: 0,
          substationId: 'NONEXISTENT',
        })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_SUBSTATION_NOT_FOUND' });
    });

    it('applies Layer 1 gFactorAdjustment multiplier when target_layer=1', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3, CAPACITY_PER_ASSET) });
      // Inject a cluster adjustment directly into project state
      const svc = broker.services.find((s) => s.name === 'znp');
      svc.activeGraphs.get(projectId).layer1GFactorAdjustment = 0.85;

      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 1 });
      // VDE factor for n=3 is 0.80; cluster multiplier 0.85 → combined 0.68
      expect(result.simultaneityFactor).toBeCloseTo(0.68, 2);
      // 33 * 0.80 * 0.85 = 22.44
      expect(result.adjustedCapacityKW).toBeCloseTo(22.44, 1);
    });

    it('uses measured load (Layer 2 short-circuit) when target_layer=2', async () => {
      jest.clearAllMocks();
      extractPeakLoadFromFile.mockResolvedValue(650);
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(5, 100) });
      await broker.call('znp.addLayer2', { projectId, filePath: '/uploads/r.pdf' });

      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 2 });
      expect(result.layer2ShortCircuit).toBe(true);
      expect(result.measuredPeakLoadKW).toBe(650);
      expect(result.adjustedCapacityKW).toBe(650);
      // g = 650 / (100+101+102+103+104) = 650 / 510 ≈ 1.275
      expect(result.simultaneityFactor).toBeCloseTo(650 / 510, 2);
    });
  });

  // ─── calculateGFactor — target_layer param naming (Issue 3) ──────────────

  describe('calculateGFactor — target_layer param (Issue 3)', () => {
    let projectId;

    beforeEach(async () => {
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3, 10) });
    });

    it('honours target_layer=0 (snake_case REST convention)', async () => {
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });
      expect(result.targetLayer).toBe(0);
      expect(result.assetCount).toBe(3);
    });

    it('honours target_layer=1 — not silently defaulted to 0 (regression guard)', async () => {
      // Before fix, ?target_layer=1 was silently ignored → result.targetLayer was always 0
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 1 });
      expect(result.targetLayer).toBe(1);
    });

    it('accepts target_layer as a string "0" (from REST query param coercion)', async () => {
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: '0' });
      expect(result.targetLayer).toBe(0);
    });

    it('accepts target_layer as a string "2" (Layer 2 query param coercion)', async () => {
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: '2' });
      expect(result.targetLayer).toBe(2);
    });

    it('defaults target_layer to 0 when omitted', async () => {
      const result = await broker.call('znp.calculateGFactor', { projectId });
      expect(result.targetLayer).toBe(0);
    });
  });

  // ─── calculateGFactor — Immutable Stacking / Query-Time Short-Circuiting ─────────────────────

  describe('calculateGFactor — Immutable Stacking', () => {
    it('targetLayer=0 only counts layer-0 edges even when higher layers are present (short-circuit)', async () => {
      // Create project and load layer 0 with 2 assets
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      const pid = r.projectId;
      await broker.call('znp.addLayer0', { projectId: pid, assets: makeAssets(2, 50) });

      // Manually inject a fake layer-1 edge directly onto the graph to simulate
      // a future addLayer1 call, then verify that calculateGFactor with targetLayer=0
      // ignores it.
      const project = broker.services.find((s) => s.name === 'znp');
      const { graph } = project.activeGraphs.get(pid);
      graph.addNode('FAKE_LAYER1_ASSET', { type: 'mastr_asset', capacity: 9999, layer: 1 });
      graph.addEdge('FAKE_LAYER1_ASSET', 'SUB_1', { relationship: 'CONTRIBUTES_LOAD', layer: 1 });

      const result = await broker.call('znp.calculateGFactor', { projectId: pid, target_layer: 0 });

      // Layer 1 asset (capacity 9999) must NOT be included
      expect(result.assetCount).toBe(2);
      expect(result.totalCapacityKW).toBe(101); // 50 + 51
    });

    it('targetLayer=1 includes both layer-0 and layer-1 edges', async () => {
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      const pid = r.projectId;
      await broker.call('znp.addLayer0', { projectId: pid, assets: makeAssets(2, 50) });

      const project = broker.services.find((s) => s.name === 'znp');
      const { graph } = project.activeGraphs.get(pid);
      graph.addNode('LAYER1_ASSET', { type: 'mastr_asset', capacity: 100, layer: 1 });
      graph.addEdge('LAYER1_ASSET', 'SUB_1', { relationship: 'CONTRIBUTES_LOAD', layer: 1 });

      const result = await broker.call('znp.calculateGFactor', { projectId: pid, target_layer: 1 });

      expect(result.assetCount).toBe(3);
      expect(result.totalCapacityKW).toBe(201); // 50 + 51 + 100
    });
  });

  // ─── listProjects / getProjectMeta ────────────────────────────────────────

  describe('listProjects', () => {
    it('includes newly created projects', async () => {
      const { projectId } = await broker.call('znp.createProject', { bbox: makeBbox(), name: 'ListTest' });
      const result = await broker.call('znp.listProjects', {});
      const found = result.projects.find((p) => p.projectId === projectId);
      expect(found).toBeDefined();
      expect(found.name).toBe('ListTest');
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getProjectMeta', () => {
    it('returns correct bbox, name, and graphStats', async () => {
      const bbox = makeBbox();
      const { projectId } = await broker.call('znp.createProject', { bbox, name: 'MetaTest' });
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(4) });

      const result = await broker.call('znp.getProjectMeta', { projectId });

      expect(result.projectId).toBe(projectId);
      expect(result.name).toBe('MetaTest');
      expect(result.bbox).toEqual(bbox);
      expect(result.graphStats.nodes).toBe(5); // 4 assets + SUB_1
      expect(result.graphStats.edges).toBe(4);
    });

    it('throws 404 for an unknown projectId', async () => {
      await expect(
        broker.call('znp.getProjectMeta', { projectId: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });
  });

  // ─── addLayer2 ─────────────────────────────────────────────────────────────

  describe('addLayer2', () => {
    let projectId;

    beforeEach(async () => {
      jest.clearAllMocks();
      extractPeakLoadFromFile.mockResolvedValue(650);
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
    });

    it('adds a Measurement node (layer=2) to the graph', async () => {
      await broker.call('znp.addLayer2', { projectId, filePath: '/uploads/report.pdf' });

      const svc = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      expect(graph.hasNode('measurement:peak_load:SUB_1')).toBe(true);
      const attrs = graph.getNodeAttributes('measurement:peak_load:SUB_1');
      expect(attrs.value).toBe(650);
      expect(attrs.unit).toBe('kW');
      expect(attrs.layer).toBe(2);
    });

    it('adds an oeo_measures edge from Measurement to SUB_1', async () => {
      await broker.call('znp.addLayer2', { projectId, filePath: '/uploads/report.pdf' });

      const svc = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      expect(graph.hasEdge('measurement:peak_load:SUB_1', 'SUB_1')).toBe(true);
    });

    it('returns projectId, measurementKey, and peakLoadKw', async () => {
      const result = await broker.call('znp.addLayer2', { projectId, filePath: '/uploads/r.pdf' });
      expect(result.projectId).toBe(projectId);
      expect(result.peakLoadKw).toBe(650);
      expect(result.measurementKey).toBe('measurement:peak_load:SUB_1');
    });

    it('calls extractPeakLoadFromFile with the given filePath', async () => {
      await broker.call('znp.addLayer2', { projectId, filePath: '/uploads/abc.pdf' });
      expect(extractPeakLoadFromFile).toHaveBeenCalledWith('/uploads/abc.pdf');
    });

    it('updates the Measurement value idempotently on re-load', async () => {
      await broker.call('znp.addLayer2', { projectId, filePath: '/uploads/r.pdf' });
      extractPeakLoadFromFile.mockResolvedValueOnce(720);
      await broker.call('znp.addLayer2', { projectId, filePath: '/uploads/r2.pdf' });

      const svc = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      expect(graph.getNodeAttributes('measurement:peak_load:SUB_1').value).toBe(720);
    });

    it('throws 404 ZNP_PROJECT_NOT_FOUND for an unknown projectId', async () => {
      await expect(
        broker.call('znp.addLayer2', {
          projectId: '00000000-0000-0000-0000-000000000000',
          filePath: '/uploads/r.pdf',
        })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });

    it('propagates extraction errors from the LLM helper', async () => {
      extractPeakLoadFromFile.mockRejectedValueOnce(new Error('LLM timeout'));
      await expect(
        broker.call('znp.addLayer2', { projectId, filePath: '/uploads/bad.pdf' })
      ).rejects.toThrow('LLM timeout');
    });
  });

  // ─── addLayer1 ─────────────────────────────────────────────────────────────

  describe('addLayer1', () => {
    let projectId;

    beforeEach(async () => {
      jest.clearAllMocks();
      fetchBuildingsForBbox.mockResolvedValue([]);
      mapAssetsToBuildings.mockReturnValue([]);
      detectClusters.mockReturnValue([]);
      computeGFactorAdjustment.mockReturnValue(1.0);
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
    });

    it('returns projectId and cluster stats (empty buildings = 0 clusters)', async () => {
      const result = await broker.call('znp.addLayer1', { projectId });
      expect(result.projectId).toBe(projectId);
      expect(result.buildingNodesAdded).toBe(0);
      expect(result.clusterCount).toBe(0);
      expect(result.gFactorAdjustment).toBe(1.0);
    });

    it('stores gFactorAdjustment on the project state', async () => {
      computeGFactorAdjustment.mockReturnValueOnce(0.85);
      await broker.call('znp.addLayer1', { projectId });

      const svc = broker.services.find((s) => s.name === 'znp');
      expect(svc.activeGraphs.get(projectId).layer1GFactorAdjustment).toBe(0.85);
    });

    it('adds OSM_Building nodes and oeo_located_in edges from mappings', async () => {
      const fakeMappings = [{
        assetNodeKey: 'mastr:SEE900100000000',
        buildingOsmId: 'way/123456',
        building: { osmId: 'way/123456', centroid: { lat: 49.49, lon: 8.47 }, geoJsonPolygon: {} },
      }];
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(1) });
      mapAssetsToBuildings.mockReturnValueOnce(fakeMappings);

      const result = await broker.call('znp.addLayer1', { projectId });
      expect(result.buildingNodesAdded).toBe(1);
      expect(result.locatedInEdgesAdded).toBe(1);

      const svc = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      expect(graph.hasNode('osm:way/123456')).toBe(true);
    });

    it('passes asset nodes to detectClusters', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3) });
      await broker.call('znp.addLayer1', { projectId });
      expect(detectClusters).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'mastr_asset' })])
      );
    });

    it('throws 404 ZNP_PROJECT_NOT_FOUND for an unknown projectId', async () => {
      await expect(
        broker.call('znp.addLayer1', { projectId: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });
  });

  // ─── getSimultaneityFactor ────────────────────────────────────────────────

  describe('getSimultaneityFactor (method)', () => {
    let svc;

    beforeAll(() => {
      svc = broker.services.find((s) => s.name === 'znp');
    });

    it.each([
      [0,   0   ],
      [1,   1.00],
      [2,   0.80],
      [5,   0.80],
      [6,   0.65],
      [10,  0.65],
      [11,  0.55],
      [25,  0.55],
      [26,  0.45],
      [50,  0.45],
      [51,  0.38],
      [100, 0.38],
      [101, 0.30],
      [500, 0.30],
    ])('n=%i → g=%s', (n, expected) => {
      expect(svc.getSimultaneityFactor(n)).toBe(expected);
    });
  });

  // ─── Issue 1: Graph Hydration & Persistence ───────────────────────────────

  describe('graph persistence — Issue 1 (v0.23)', () => {
    it('createProject writes a znp:graph: document to PouchDB', async () => {
      const { projectId } = await broker.call('znp.createProject', { bbox: makeBbox() });
      const svc           = broker.services.find((s) => s.name === 'znp');
      const graphDoc      = await svc.db.get(`znp:graph:${projectId}`);
      expect(graphDoc.graphData).toBeDefined();
      expect(Array.isArray(graphDoc.graphData.nodes)).toBe(true);
    });

    it('createProject writes a znp:meta: document (not znp:) to PouchDB', async () => {
      const { projectId } = await broker.call('znp.createProject', { bbox: makeBbox() });
      const svc           = broker.services.find((s) => s.name === 'znp');
      const metaDoc       = await svc.db.get(`znp:meta:${projectId}`);
      expect(metaDoc.projectId).toBe(projectId);
      // Must NOT contain the graph blob
      expect(metaDoc.graphData).toBeUndefined();
    });

    it('addLayer0 updates znp:graph: with the new nodes', async () => {
      const { projectId } = await broker.call('znp.createProject', { bbox: makeBbox() });
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(2) });
      const svc      = broker.services.find((s) => s.name === 'znp');
      const graphDoc = await svc.db.get(`znp:graph:${projectId}`);
      // SUB_1 + 2 mastr_asset nodes
      expect(graphDoc.graphData.nodes.length).toBe(3);
    });

    it('hydrates graph from PouchDB on _hydrateGraphs() (round-trip)', async () => {
      const { projectId } = await broker.call('znp.createProject', {
        bbox: makeBbox(), name: 'Hydration Test',
      });
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3) });

      // Simulate restart: clear in-memory map then re-hydrate
      const svc = broker.services.find((s) => s.name === 'znp');
      svc.activeGraphs.clear();
      expect(svc.activeGraphs.has(projectId)).toBe(false);

      await svc._hydrateGraphs();

      expect(svc.activeGraphs.has(projectId)).toBe(true);
      const { graph } = svc.activeGraphs.get(projectId);
      expect(graph.order).toBe(4); // SUB_1 + 3 assets
      expect(graph.size).toBe(3);
    });

    it('hydration restores project name and bbox', async () => {
      const bbox = makeBbox();
      const { projectId } = await broker.call('znp.createProject', {
        bbox, name: 'Restore Name Test',
      });
      const svc = broker.services.find((s) => s.name === 'znp');
      svc.activeGraphs.clear();
      await svc._hydrateGraphs();

      const project = svc.activeGraphs.get(projectId);
      expect(project.name).toBe('Restore Name Test');
      expect(project.bbox).toEqual(bbox);
    });

    it('skips projects with null graphData during hydration (non-fatal)', async () => {
      const { projectId } = await broker.call('znp.createProject', { bbox: makeBbox() });
      const svc = broker.services.find((s) => s.name === 'znp');

      // Corrupt the graph doc
      const graphDocId = `znp:graph:${projectId}`;
      const doc        = await svc.db.get(graphDocId);
      await svc.db.put({ ...doc, graphData: null });

      svc.activeGraphs.clear();
      await expect(svc._hydrateGraphs()).resolves.not.toThrow();
      // Project was skipped — not in activeGraphs
      expect(svc.activeGraphs.has(projectId)).toBe(false);
    });

    it('hydrates layer1GFactorAdjustment from metadata', async () => {
      const { projectId } = await broker.call('znp.createProject', { bbox: makeBbox() });
      // Inject adjustment directly into the project and persist it via updateProjectMeta
      const svc     = broker.services.find((s) => s.name === 'znp');
      const project = svc.activeGraphs.get(projectId);
      project.layer1GFactorAdjustment = 0.77;
      await svc.updateProjectMeta(projectId, project.graph, 'layer1');

      svc.activeGraphs.clear();
      await svc._hydrateGraphs();

      expect(svc.activeGraphs.get(projectId).layer1GFactorAdjustment).toBe(0.77);
    });
  });

  // ─── Issue 2: strategicPrompts ────────────────────────────────────────────

  describe('strategicPrompts — Issue 2 (v0.23)', () => {
    let projectId;

    beforeEach(async () => {
      jest.clearAllMocks();
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3) });
    });

    it('returns an array of questions and graphSummary', async () => {
      mockGenerateStructured.mockResolvedValueOnce({
        questions: ['Gibt es Anschlussbegehren für Rechenzentren?', 'Planen Sie §14a-konforme Ladepunkte?'],
      });
      const result = await broker.call('znp.strategicPrompts', { projectId });
      expect(Array.isArray(result.questions)).toBe(true);
      expect(result.questions.length).toBe(2);
      expect(result.graphSummary).toBeDefined();
      expect(result.graphSummary.assetTypes).toBeDefined();
    });

    it('invokes generateStructured exactly once', async () => {
      mockGenerateStructured.mockResolvedValueOnce({ questions: ['Frage 1'] });
      await broker.call('znp.strategicPrompts', { projectId });
      expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
    });

    it('graphSummary includes totalCapacityKW and layers', async () => {
      mockGenerateStructured.mockResolvedValueOnce({ questions: ['Frage 1'] });
      const result = await broker.call('znp.strategicPrompts', { projectId });
      expect(typeof result.graphSummary.totalCapacityKW).toBe('number');
      expect(Array.isArray(result.graphSummary.layers)).toBe(true);
    });

    it('returns empty questions array when LLM returns non-array', async () => {
      mockGenerateStructured.mockResolvedValueOnce({ questions: null });
      const result = await broker.call('znp.strategicPrompts', { projectId });
      expect(result.questions).toEqual([]);
    });

    it('propagates LLM_NOT_CONFIGURED (503) from llm-client', async () => {
      const { MoleculerError } = require('moleculer').Errors;
      mockGenerateStructured.mockRejectedValueOnce(
        new MoleculerError('No key', 503, 'LLM_NOT_CONFIGURED')
      );
      await expect(
        broker.call('znp.strategicPrompts', { projectId })
      ).rejects.toMatchObject({ code: 503, type: 'LLM_NOT_CONFIGURED' });
    });

    it('throws 404 ZNP_PROJECT_NOT_FOUND for unknown projectId', async () => {
      await expect(
        broker.call('znp.strategicPrompts', { projectId: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });
  });

  // ─── Issue 3: addAssumption ───────────────────────────────────────────────

  describe('addAssumption — Issue 3 (v0.23)', () => {
    let projectId;

    beforeEach(async () => {
      jest.clearAllMocks();
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
    });

    it('inserts a StrategicAssumption node (layer=2.5) into the graph', async () => {
      mockGenerateStructured.mockResolvedValueOnce({
        assetType: 'storage', capacityKW: 5000, status: 'planned', hasFlexibleNav: true,
      });
      const result = await broker.call('znp.addAssumption', {
        projectId, text: 'Wir planen einen 5MW Speicher mit flexiblem NAV am Brückweg',
      });

      expect(result.assumptionId).toBeDefined();
      expect(result.hasFlexibleNav).toBe(true);
      expect(result.extracted.assetType).toBe('storage');

      const svc   = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      expect(graph.hasNode(`assumption:${result.assumptionId}`)).toBe(true);
      const attrs = graph.getNodeAttributes(`assumption:${result.assumptionId}`);
      expect(attrs.capacity).toBe(5000);
      expect(attrs.hasFlexibleNav).toBe(true);
      expect(attrs.layer).toBe(2.5);
    });

    it('connects the assumption node to SUB_1 via CONTRIBUTES_LOAD', async () => {
      mockGenerateStructured.mockResolvedValueOnce({
        assetType: 'datacenter', capacityKW: 10000, status: 'planned', hasFlexibleNav: false,
      });
      const result = await broker.call('znp.addAssumption', {
        projectId, text: '10 MW Rechenzentrum im Gewerbegebiet Nord',
      });
      const svc   = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      expect(graph.hasEdge(`assumption:${result.assumptionId}`, 'SUB_1')).toBe(true);
    });

    it('persists the graph to znp:graph: after assumption insertion', async () => {
      mockGenerateStructured.mockResolvedValueOnce({
        assetType: 'heatpump', capacityKW: 8, status: 'planned', hasFlexibleNav: false,
      });
      const result = await broker.call('znp.addAssumption', {
        projectId, text: 'Wärmepumpe 8 kW geplant',
      });
      const svc      = broker.services.find((s) => s.name === 'znp');
      const graphDoc = await svc.db.get(`znp:graph:${projectId}`);
      const node     = graphDoc.graphData.nodes.find(
        (n) => n.key === `assumption:${result.assumptionId}`
      );
      expect(node).toBeDefined();
    });

    it('throws 422 ASSUMPTION_EXTRACTION_FAILED for non-positive capacityKW', async () => {
      mockGenerateStructured.mockResolvedValueOnce({
        assetType: 'storage', capacityKW: -1, status: 'planned', hasFlexibleNav: false,
      });
      await expect(
        broker.call('znp.addAssumption', { projectId, text: 'Ungültige Anlage ohne Kapazität' })
      ).rejects.toMatchObject({ code: 422, type: 'ASSUMPTION_EXTRACTION_FAILED' });
    });

    it('throws 404 ZNP_PROJECT_NOT_FOUND for unknown projectId', async () => {
      await expect(
        broker.call('znp.addAssumption', {
          projectId: '00000000-0000-0000-0000-000000000000',
          text:      'Irgendeine Anlage',
        })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });

    it('propagates LLM_NOT_CONFIGURED (503) from llm-client', async () => {
      const { MoleculerError } = require('moleculer').Errors;
      mockGenerateStructured.mockRejectedValueOnce(
        new MoleculerError('No key', 503, 'LLM_NOT_CONFIGURED')
      );
      await expect(
        broker.call('znp.addAssumption', { projectId, text: 'Geplante Anlage ohne Key' })
      ).rejects.toMatchObject({ code: 503, type: 'LLM_NOT_CONFIGURED' });
    });
  });

  // ─── Issue 3: calculateGFactor — §14a flexible NAV ───────────────────────

  describe('calculateGFactor — §14a flexible NAV (Issue 3 v0.23)', () => {
    let projectId;

    beforeEach(async () => {
      jest.clearAllMocks();
      const r = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = r.projectId;
      // Load 3 assets at ~100 kW each
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3, 100) });
    });

    it('returns flexNavExcluded=0 when no assumptions are present', async () => {
      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });
      expect(result.flexNavExcluded).toBe(0);
    });

    it('excludes a flex-NAV assumption node from peak load (g=0.0)', async () => {
      const svc       = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      graph.addNode('assumption:flex-test', {
        type: 'assumption', capacity: 5000, hasFlexibleNav: true, layer: 2.5,
      });
      graph.addEdge('assumption:flex-test', 'SUB_1', {
        relationship: 'CONTRIBUTES_LOAD', layer: 2.5,
      });

      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 2 });
      // 5000 kW flex-NAV must NOT inflate totalCapacityKW
      expect(result.flexNavExcluded).toBe(1);
      expect(result.totalCapacityKW).toBeLessThan(5000);
    });

    it('includes a non-flex assumption node in peak load (g=1.0)', async () => {
      const svc       = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      graph.addNode('assumption:nonflex-test', {
        type: 'assumption', capacity: 500, hasFlexibleNav: false, layer: 2.5,
      });
      graph.addEdge('assumption:nonflex-test', 'SUB_1', {
        relationship: 'CONTRIBUTES_LOAD', layer: 2.5,
      });

      const base  = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });
      const after = await broker.call('znp.calculateGFactor', { projectId, target_layer: 2 });
      // Non-flex assumption adds 500 kW → totalCapacityKW is higher at target_layer=2
      expect(after.totalCapacityKW).toBeGreaterThan(base.totalCapacityKW);
      expect(after.flexNavExcluded).toBe(0);
    });

    it('does NOT include assumption nodes at target_layer=0', async () => {
      const svc       = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      graph.addNode('assumption:gate-test', {
        type: 'assumption', capacity: 9999, hasFlexibleNav: false, layer: 2.5,
      });
      graph.addEdge('assumption:gate-test', 'SUB_1', {
        relationship: 'CONTRIBUTES_LOAD', layer: 2.5,
      });

      const result = await broker.call('znp.calculateGFactor', { projectId, target_layer: 0 });
      // 9999 kW assumption must be excluded at layer 0
      expect(result.totalCapacityKW).toBeLessThan(9000);
      expect(result.flexNavExcluded).toBe(0);
    });
  });

  // ─── getProjectAssets ───────────────────────────────────────────────────────────────────────

  describe('getProjectAssets', () => {
    let projectId;

    beforeEach(async () => {
      const result = await broker.call('znp.createProject', { bbox: makeBbox() });
      projectId = result.projectId;
    });

    it('returns 404 for unknown projectId', async () => {
      await expect(
        broker.call('znp.getProjectAssets', { projectId: 'does-not-exist' })
      ).rejects.toMatchObject({ code: 404, type: 'ZNP_PROJECT_NOT_FOUND' });
    });

    it('returns all assets with the correct response shape and field set', async () => {
      const assets = makeAssets(3);
      assets[0].status = 'InBetrieb';
      assets[0].commissioningDate = '2022-01-15';
      await broker.call('znp.addLayer0', { projectId, assets });

      const result = await broker.call('znp.getProjectAssets', { projectId });
      expect(result.totalCount).toBe(3);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(100);
      expect(result.assets).toHaveLength(3);

      const first = result.assets[0];
      expect(first).toHaveProperty('mastrNummer');
      expect(first).toHaveProperty('capacity');
      expect(first).toHaveProperty('assetType');
      expect(first).toHaveProperty('status');
      expect(first).toHaveProperty('commissioningDate');
      expect(first).toHaveProperty('lat');
      expect(first).toHaveProperty('lon');
    });

    it('sorts by capacity desc by default (highest capacity first)', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3, 10) });
      const result = await broker.call('znp.getProjectAssets', { projectId, sortByCapacity: 'desc' });
      const caps = result.assets.map((a) => a.capacity);
      expect(caps[0]).toBeGreaterThanOrEqual(caps[1]);
      expect(caps[1]).toBeGreaterThanOrEqual(caps[2]);
    });

    it('sorts by capacity asc when specified', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(3, 10) });
      const result = await broker.call('znp.getProjectAssets', { projectId, sortByCapacity: 'asc' });
      const caps = result.assets.map((a) => a.capacity);
      expect(caps[0]).toBeLessThanOrEqual(caps[1]);
      expect(caps[1]).toBeLessThanOrEqual(caps[2]);
    });

    it('filters by status — returns only matching nodes', async () => {
      const assets = makeAssets(3);
      assets[0].status = 'In Planung';
      assets[1].status = 'InBetrieb';
      // assets[2].status is not set → stored as null
      await broker.call('znp.addLayer0', { projectId, assets });

      const result = await broker.call('znp.getProjectAssets', { projectId, status: 'In Planung' });
      expect(result.totalCount).toBe(1);
      expect(result.assets[0].status).toBe('In Planung');
    });

    it('supports offset/limit pagination', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(5, 10) });
      const result = await broker.call('znp.getProjectAssets', { projectId, limit: 2, offset: 2 });
      expect(result.totalCount).toBe(5);
      expect(result.assets).toHaveLength(2);
      expect(result.offset).toBe(2);
      expect(result.limit).toBe(2);
    });

    it('excludes strategic assumption nodes (type !== mastr_asset)', async () => {
      await broker.call('znp.addLayer0', { projectId, assets: makeAssets(2) });
      // Manually inject an assumption node directly into the in-memory graph
      const svc       = broker.services.find((s) => s.name === 'znp');
      const { graph } = svc.activeGraphs.get(projectId);
      graph.addNode('assumption:excl-test', {
        type: 'assumption', capacity: 9999, hasFlexibleNav: false, layer: 2.5,
      });

      const result = await broker.call('znp.getProjectAssets', { projectId });
      expect(result.totalCount).toBe(2); // only the 2 mastr_asset nodes
      expect(result.assets.every((a) => a.mastrNummer !== undefined)).toBe(true);
    });
  });

});
