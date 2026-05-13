'use strict';

const {
  normalizeDisturbancePattern,
  normalizeDisturbanceSeverity,
} = require('../src/disturbance-schema');
const { createFinding } = require('../src/validation-findings');

module.exports = {
  name: 'blindflug-radar',
  version: 1,

  settings: {
    rest: '/v1/blindflug-radar',
  },

  actions: {
    scan: {
      rest: 'POST /scan',
      params: {
        vnbId: { type: 'string' },
      },
      openapi: {
        summary: 'Scan disturbance signals for blind-flight anomalies',
        tags: ['Blindflug Radar'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['vnbId'],
                properties: {
                  vnbId: { type: 'string', example: 'VNB-123' },
                },
              },
              examples: {
                default: {
                  value: {
                    vnbId: 'VNB-123',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { vnbId } = ctx.params;
        const findings = [];
        const disturbances = [];

        // Mock disturbance for Phase 4 MVP
        // Reusing patterns from redispatch-expost and mastr-monitor
        const sigId = `SIG-${Date.now()}-001`;

        disturbances.push({
          id: sigId,
          vnbId,
          pattern: normalizeDisturbancePattern('CAPACITY_BOTTLENECK'),
          severity: normalizeDisturbanceSeverity('high'),
          timestamp: new Date().toISOString(),
          description: 'Detected recurring capacity constraint in Redispatch logs',
          source: 'redispatch-expost',
        });

        findings.push(
          createFinding(
            1,
            'blindflug-scan',
            'BLINDFLUG_ANOMALY_DETECTED',
            'warning',
            'Blindflug Radar identified an anomaly',
            'Disturbance pattern CAPACITY_BOTTLENECK detected.',
            { disturbanceId: sigId }
          )
        );

        return {
          vnbId,
          scannedAt: new Date().toISOString(),
          disturbances,
          findings,
        };
      },
    },
  },
};
