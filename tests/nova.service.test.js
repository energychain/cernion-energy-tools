'use strict';

const { EventEmitter } = require('events');
const { ServiceBroker } = require('moleculer');
const NovaService = require('../services/nova.service');
const ZnpService = require('../services/znp.service');

describe('NOVA Service', () => {
  let broker;
  let projectId;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false, nodeID: `nova-test-${Date.now()}` });
    broker.createService({
      ...ZnpService,
      settings: {
        ...ZnpService.settings,
        dbPath: `./data/znp-test-nova-${Date.now()}`,
      },
    });
    broker.createService(NovaService);
    await broker.start();

    const project = await broker.call('znp.createProject', {
      bbox: { south: 49.47, west: 8.43, north: 49.52, east: 8.52 },
    });
    projectId = project.projectId;

    await broker.call('znp.addLayer0', {
      projectId,
      assets: [
        { mastrNummer: 'SEE900PV00001', capacity: 500, assetType: 'solar', lat: 49.49, lon: 8.47 },
        { mastrNummer: 'SEE900PV00002', capacity: 400, assetType: 'solar', lat: 49.5, lon: 8.48 },
        {
          mastrNummer: 'SEE900WB00003',
          capacity: 300,
          assetType: 'wallbox',
          lat: 49.51,
          lon: 8.49,
        },
      ],
    });

    const znpSvc = broker.services.find((service) => service.name === 'znp');
    const { graph } = znpSvc.activeGraphs.get(projectId);
    graph.setNodeAttribute('SUB_1', 'thermalLimitKW', 850);
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('returns dynamic pending decisions for project overloads', async () => {
    const result = await broker.call('nova.pendingDecisions', { projectId });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const types = result.map((item) => item.type);
    expect(types).toContain('QU');
    expect(types).toContain('rONT');
    expect(types).toContain('RD_CURTAILMENT');

    const rd = result.find((item) => item.type === 'RD_CURTAILMENT');
    expect(rd.description).toContain('Redispatch-fähige Großanlagen (>100 kW)');
    expect(rd.description).toContain('Abregelung um 30%');

    for (const decision of result) {
      expect(decision).toHaveProperty('id');
      expect(decision).toHaveProperty('type');
      expect(decision).toHaveProperty('gridNode');
      expect(decision).toHaveProperty('description');
      expect(decision).toHaveProperty('capex');
      expect(decision).toHaveProperty('capacity_gain_kw');
      expect(decision.gridNode).toBe('SUB_1');
    }
  });

  it('applies an rONT decision and mutates graph state', async () => {
    const pending = await broker.call('nova.pendingDecisions', { projectId });
    const rontDecision = pending.find((item) => item.type === 'rONT');

    const result = await broker.call('nova.apply', {
      projectId,
      id: rontDecision.id,
    });

    expect(result).toEqual({
      success: true,
      id: rontDecision.id,
    });

    const znpSvc = broker.services.find((service) => service.name === 'znp');
    const { graph } = znpSvc.activeGraphs.get(projectId);
    expect(graph.getNodeAttribute('SUB_1', 'is_rONT')).toBe(true);
  });

  it('applies RD curtailment to eligible >100kW solar/wind/biomass edges', async () => {
    const project = await broker.call('znp.createProject', {
      bbox: { south: 49.47, west: 8.43, north: 49.52, east: 8.52 },
    });
    const rdProjectId = project.projectId;

    await broker.call('znp.addLayer0', {
      projectId: rdProjectId,
      assets: [
        { mastrNummer: 'SEE900RDPV001', capacity: 500, assetType: 'solar', lat: 49.49, lon: 8.47 },
        { mastrNummer: 'SEE900RDPV002', capacity: 400, assetType: 'solar', lat: 49.5, lon: 8.48 },
        {
          mastrNummer: 'SEE900RDWB003',
          capacity: 300,
          assetType: 'wallbox',
          lat: 49.51,
          lon: 8.49,
        },
      ],
    });

    const znpSvc = broker.services.find((service) => service.name === 'znp');
    const { graph: rdGraph } = znpSvc.activeGraphs.get(rdProjectId);
    rdGraph.setNodeAttribute('SUB_1', 'thermalLimitKW', 850);

    const pending = await broker.call('nova.pendingDecisions', { projectId: rdProjectId });
    const rdDecision = pending.find((item) => item.type === 'RD_CURTAILMENT');
    expect(rdDecision).toBeDefined();

    const result = await broker.call('nova.apply', {
      projectId: rdProjectId,
      id: rdDecision.id,
    });

    expect(result).toEqual({
      success: true,
      id: rdDecision.id,
    });

    const { graph } = znpSvc.activeGraphs.get(rdProjectId);
    const pvEdge1 = graph.edge('mastr:SEE900RDPV001', 'SUB_1');
    const pvEdge2 = graph.edge('mastr:SEE900RDPV002', 'SUB_1');
    const wallboxEdge = graph.edge('mastr:SEE900RDWB003', 'SUB_1');

    expect(graph.getEdgeAttribute(pvEdge1, 'gFactor')).toBe(0.7);
    expect(graph.getEdgeAttribute(pvEdge2, 'gFactor')).toBe(0.7);
    expect(graph.getEdgeAttribute(wallboxEdge, 'gFactor')).toBeUndefined();

    expect(graph.getNodeAttribute('mastr:SEE900RDPV001', 'is_rd_curtailed')).toBe(true);
    expect(graph.getNodeAttribute('mastr:SEE900RDPV002', 'is_rd_curtailed')).toBe(true);
    expect(graph.getNodeAttribute('mastr:SEE900RDWB003', 'is_rd_curtailed')).toBeUndefined();

    const graphDoc = await znpSvc.db.get(`znp:graph:${rdProjectId}`);
    const pvEdgeDoc = graphDoc.graphData.edges.find(
      (edge) => edge.source === 'mastr:SEE900RDPV001' && edge.target === 'SUB_1'
    );
    expect(pvEdgeDoc).toBeDefined();
    expect(pvEdgeDoc.attributes.gFactor).toBe(0.7);
    expect(pvEdgeDoc.attributes.is_rd_curtailed).toBe(true);
  });

  it('does not expose the removed legacy action nova.applyDecision', async () => {
    await expect(broker.call('nova.applyDecision', { id: 'dec_001' })).rejects.toMatchObject({
      code: 404,
    });
  });

  it('streams znp.project.updated via SSE', async () => {
    const req = new EventEmitter();
    const stream = await broker.call('nova.stream', {}, { meta: { $req: req } });

    let raw = '';
    stream.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });

    broker.emit('znp.project.updated', {
      type: 'assumption-confirmed',
      data: { id: 'abc', text: 'sample' },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    req.emit('close');

    expect(raw).toContain('event: znp.project.updated');
    expect(raw).toContain('"type":"assumption-confirmed"');
  });

  it('returns 404 for unknown decision id in project scope', async () => {
    await expect(
      broker.call('nova.apply', { projectId, id: 'dec_does_not_exist' })
    ).rejects.toMatchObject({
      code: 404,
      type: 'NOVA_DECISION_NOT_FOUND',
    });
  });
});
