'use strict';

const { assessTopologyHop, determineRequiredVoltageLevel } = require('../src/cya-topology-hop');

describe('cya-topology-hop', () => {
  describe('determineRequiredVoltageLevel', () => {
    it('resolves 5 MW to MS tier (10 kV)', () => {
      const result = determineRequiredVoltageLevel(5);
      expect(result.voltageClass).toBe('MS');
      expect(result.voltageKv).toBe('10 kV');
      expect(result.severity).toBe('none');
    });

    it('resolves 15 MW to MS tier (20 kV)', () => {
      const result = determineRequiredVoltageLevel(15);
      expect(result.voltageClass).toBe('MS');
      expect(result.voltageKv).toBe('20 kV');
      expect(result.severity).toBe('info');
    });

    it('resolves 60 MW to HS tier (110 kV)', () => {
      const result = determineRequiredVoltageLevel(60);
      expect(result.voltageClass).toBe('HS');
      expect(result.voltageKv).toBe('110 kV');
      expect(result.severity).toBe('warning');
    });

    it('resolves 200 MW to HöS tier (220/380 kV)', () => {
      const result = determineRequiredVoltageLevel(200);
      expect(result.voltageClass).toBe('HöS');
      expect(result.voltageKv).toBe('220/380 kV');
      expect(result.severity).toBe('critical');
    });

    it('handles edge case: 10 MW at MS tier (20 kV)', () => {
      const result = determineRequiredVoltageLevel(10);
      expect(result.voltageClass).toBe('MS');
      expect(result.voltageKv).toBe('20 kV');
    });

    it('handles edge case: 49.99 MW stays in MS tier', () => {
      const result = determineRequiredVoltageLevel(49.99);
      expect(result.voltageClass).toBe('MS');
      expect(result.voltageKv).toBe('20 kV');
    });

    it('handles edge case: 50 MW crosses to HS tier', () => {
      const result = determineRequiredVoltageLevel(50);
      expect(result.voltageClass).toBe('HS');
      expect(result.voltageKv).toBe('110 kV');
    });

    it('handles edge case: 149.99 MW stays in HS tier', () => {
      const result = determineRequiredVoltageLevel(149.99);
      expect(result.voltageClass).toBe('HS');
      expect(result.voltageKv).toBe('110 kV');
    });

    it('handles edge case: 150 MW crosses to HöS tier', () => {
      const result = determineRequiredVoltageLevel(150);
      expect(result.voltageClass).toBe('HöS');
      expect(result.voltageKv).toBe('220/380 kV');
    });

    it('handles null or undefined', () => {
      expect(determineRequiredVoltageLevel(null)).toBeNull();
      expect(determineRequiredVoltageLevel(undefined)).toBeNull();
    });
  });

  describe('assessTopologyHop', () => {
    it('returns needsHop:false for capacity below 50 MW (MS-only)', async () => {
      const ctx = { call: jest.fn(), meta: { cernionToken: 'test-token' } };
      const result = await assessTopologyHop(ctx, { location: 'Mauer', capacityMw: 25 });

      expect(result.needsHop).toBe(false);
      expect(result.reason).toBe('capacity_below_hs_threshold');
      expect(result.voltageClass).toBe('MS');
      expect(result.voltageKv).toBe('20 kV');
      expect(ctx.call).not.toHaveBeenCalled();
    });

    it('requires hop for 60 MW asset (HS tier)', async () => {
      const ctx = {
        meta: { cernionToken: 'test-token' },
        call: jest.fn().mockResolvedValue({
          nearestSubstations: [
            {
              osmId: 'way/123456',
              name: 'UW Meckesheim',
              lat: 49.31,
              lon: 8.81,
              distance_km: 8.5,
            },
          ],
          operatorName: 'Netze BW',
        }),
      };

      const result = await assessTopologyHop(ctx, { location: 'Mauer', capacityMw: 60 });

      expect(result.needsHop).toBe(true);
      expect(result.voltageClass).toBe('HS');
      expect(result.voltageKv).toBe('110 kV');
      expect(result.severity).toBe('warning');
      expect(result.targetVoltage).toBe('HS');
      expect(result.physicalConnectionPoint.name).toBe('UW Meckesheim');
      expect(result.inferredOperator).toBe('Netze BW');
      expect(result.dataProvenance).toBe('osm');
      expect(ctx.call).toHaveBeenCalledWith(
        'osm-geo.substationFinder',
        { location: 'Mauer', voltageLevel: 'HS', maxResults: 5 },
        { meta: { cernionToken: 'test-token' } }
      );
    });

    it('routes 200 MW asset to HöS tier (critical severity)', async () => {
      const ctx = {
        meta: { cernionToken: 'test-token' },
        call: jest.fn().mockResolvedValue({
          nearestSubstations: [
            {
              osmId: 'way/654321',
              name: 'UW Großkraftwerk',
              lat: 49.5,
              lon: 9.0,
              distance_km: 12.3,
            },
          ],
          operatorName: 'TransnetBW',
        }),
      };

      const result = await assessTopologyHop(ctx, { location: 'Ludwigshafen', capacityMw: 200 });

      expect(result.needsHop).toBe(true);
      expect(result.voltageClass).toBe('HöS');
      expect(result.voltageKv).toBe('220/380 kV');
      expect(result.severity).toBe('critical');
      expect(result.targetVoltage).toBe('HöS');
      expect(result.dataProvenance).toBe('osm');
    });

    it('degrades gracefully when OSM call fails', async () => {
      const ctx = {
        meta: { cernionToken: 'test-token' },
        call: jest.fn().mockRejectedValue(new Error('Overpass timeout')),
      };

      const result = await assessTopologyHop(ctx, { location: 'Mauer', capacityMw: 75 });

      expect(result.needsHop).toBe(true);
      expect(result.voltageClass).toBe('HS');
      expect(result.reason).toBe('osm_unavailable');
      expect(result.dataProvenance).toBe('inferred');
      expect(result.error).toBeDefined();
      // Pipeline must not throw
    });

    it('returns no-substation result when OSM finds none', async () => {
      const ctx = {
        meta: { cernionToken: 'test-token' },
        call: jest.fn().mockResolvedValue({
          nearestSubstations: [],
        }),
      };

      const result = await assessTopologyHop(ctx, { location: 'RemoteArea', capacityMw: 80 });

      expect(result.needsHop).toBe(true);
      expect(result.reason).toBe('no_substations_found');
      expect(result.dataProvenance).toBe('inferred');
    });

    it('returns insufficient_input when location missing', async () => {
      const ctx = { call: jest.fn(), meta: { cernionToken: 'test-token' } };
      const result = await assessTopologyHop(ctx, { location: null, capacityMw: 100 });

      expect(result.needsHop).toBe(false);
      expect(result.reason).toBe('insufficient_input');
      expect(ctx.call).not.toHaveBeenCalled();
    });
  });
});
