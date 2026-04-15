'use strict';

const { assessTopologyHop, MW_THRESHOLD_110KV } = require('../src/cya-topology-hop');

describe('cya-topology-hop', () => {
  it('returns needsHop:false for capacity below threshold', async () => {
    const ctx = { call: jest.fn() };
    const result = await assessTopologyHop(ctx, { location: 'Mauer', capacityMw: 5 });

    expect(result.needsHop).toBe(false);
    expect(result.reason).toBe('capacity_below_threshold');
    expect(result.thresholdMw).toBe(MW_THRESHOLD_110KV);
    expect(ctx.call).not.toHaveBeenCalled();
  });

  it('returns needsHop:true with physicalConnectionPoint for >= 10 MW', async () => {
    const ctx = {
      call: jest.fn().mockResolvedValue({
        data: {
          substations: [
            {
              osmId: 'way/123456',
              name: 'UW Meckesheim',
              location: { lat: 49.31, lon: 8.81 },
              voltageLevel: 'HS',
              operator: 'Netze BW',
            },
          ],
          summary: {
            dominantOperator: 'Netze BW',
            totalSubstations: 1,
          },
        },
      }),
    };

    const result = await assessTopologyHop(ctx, { location: 'Mauer', capacityMw: 10 });

    expect(result.needsHop).toBe(true);
    expect(result.targetVoltage).toBe('HS');
    expect(result.inferredOperator).toBe('Netze BW');
    expect(result.physicalConnectionPoint.name).toBe('UW Meckesheim');
    expect(result.dataProvenance).toBe('osm');
    expect(ctx.call).toHaveBeenCalledWith('osm-geo.substationFinder', {
      location: 'Mauer',
      voltageLevel: 'HS',
      maxResults: 5,
    });
  });

  it('degrades gracefully when OSM call throws', async () => {
    const ctx = {
      call: jest.fn().mockRejectedValue(new Error('Overpass timeout')),
    };

    const result = await assessTopologyHop(ctx, { location: 'Mauer', capacityMw: 10 });

    expect(result.needsHop).toBe(true);
    expect(result.targetVoltage).toBe('HS');
    expect(result.physicalConnectionPoint).toBeNull();
    expect(result.reason).toBe('osm_unavailable');
    expect(result.dataProvenance).toBe('inferred');
    // Pipeline must not throw
  });

  it('returns needsHop:false with reason insufficient_input when location missing', async () => {
    const ctx = { call: jest.fn() };
    const result = await assessTopologyHop(ctx, { location: null, capacityMw: 15 });

    expect(result.needsHop).toBe(false);
    expect(result.reason).toBe('insufficient_input');
    expect(ctx.call).not.toHaveBeenCalled();
  });
});
