'use strict';

const { MoleculerClientError } = require('moleculer').Errors;
const {
  calculateBalance,
  calculateVirtualBkBalance,
  calculateSettlementReadiness,
} = require('../src/bilanzkreis-calculator');

const NS_BILANZKREISE = 'bilanzkreise';
const NS_BK_RESULTS = 'bk_results';
const OBIS_CONSUMPTION = '1-0:1.8.0';
const OBIS_FEEDIN = '1-0:2.8.0';
const OPENAPI_TAG = 'Settlement (Abrechnung)';

function toIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseRows(response) {
  if (!response) return [];
  if (Array.isArray(response.values)) return response.values;
  if (Array.isArray(response.data)) return response.data;
  return [];
}

function maxGapHours(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return 0;

  const sorted = rows
    .map((row) => new Date(row.ts).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  let maxGap = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }

  return maxGap / 3600000;
}

function resultKey(id, from, to) {
  const fromPart = String(from).replace(/[:.]/g, '-');
  const toPart = String(to).replace(/[:.]/g, '-');
  return `${id}_${fromPart}_${toPart}`;
}

module.exports = {
  name: 'bilanzkreis',
  timeout: 120000,
  dependencies: ['edm'],
  settings: {},

  actions: {
    create: {
      rest: 'POST /',
      params: {
        id: { type: 'string', pattern: /^[a-z0-9_]+$/, max: 64 },
        name: { type: 'string', min: 1 },
        type: {
          type: 'enum',
          values: [
            'real',
            'virtual_energy_sharing',
            'virtual_mieterstrom',
            'virtual_arealnetz',
            'virtual_vpp',
          ],
        },
        participants: {
          type: 'array',
          min: 1,
          items: {
            type: 'object',
            props: {
              meloId: { type: 'string' },
              role: { type: 'enum', values: ['producer', 'consumer', 'prosumer'] },
              share: {
                type: 'number',
                optional: true,
                default: 1.0,
                min: 0,
                max: 1,
                convert: true,
              },
              label: { type: 'string', optional: true },
            },
          },
        },
        gridOperatorMastrId: { type: 'string', optional: true },
        validFrom: { type: 'string', optional: true },
        validTo: { type: 'string', optional: true },
        metadata: { type: 'object', optional: true },
      },
      openapi: {
        summary: 'Create a Bilanzkreis (real or virtual)',
        tags: [OPENAPI_TAG],
        description:
          'Creates a balance group definition. Real BKs map to MaBiS interfaces. Virtual BKs aggregate multiple MeLos for internal settlement.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'name', 'type', 'participants'],
                properties: {
                  id: { type: 'string', example: 'bk_es_test' },
                  name: { type: 'string', example: 'Energy Sharing Test-Quartier' },
                  type: {
                    type: 'string',
                    enum: [
                      'real',
                      'virtual_energy_sharing',
                      'virtual_mieterstrom',
                      'virtual_arealnetz',
                      'virtual_vpp',
                    ],
                    example: 'virtual_energy_sharing',
                  },
                  participants: {
                    type: 'array',
                    example: [
                      { meloId: 'BK_TEST_PV', role: 'producer', share: 1.0 },
                      { meloId: 'BK_TEST_CONSUMER', role: 'consumer', share: 1.0 },
                    ],
                    items: { type: 'object' },
                  },
                  gridOperatorMastrId: { type: 'string', example: 'SNB935578300972' },
                  validFrom: { type: 'string', example: '2026-01-01' },
                  validTo: { type: 'string', example: '2026-12-31' },
                  metadata: { type: 'object', example: { source: 'manual' } },
                },
              },
              examples: {
                default: {
                  value: {
                    id: 'bk_es_test',
                    name: 'Energy Sharing Test-Quartier',
                    type: 'virtual_energy_sharing',
                    participants: [
                      { meloId: 'BK_TEST_PV', role: 'producer', share: 1.0 },
                      { meloId: 'BK_TEST_CONSUMER', role: 'consumer', share: 1.0 },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { id, participants } = ctx.params;

        const existing = await this.getStoredObject(ctx, NS_BILANZKREISE, id, false);
        if (existing) {
          throw new MoleculerClientError('Bilanzkreis already exists', 409, 'BILANZKREIS_EXISTS');
        }

        for (const participant of participants) {
          try {
            await ctx.call('edm.getMelo', { meloId: participant.meloId });
          } catch (error) {
            if (error?.code === 404 || error?.type === 'MELO_NOT_FOUND') {
              throw new MoleculerClientError(
                `MeLo not found: ${participant.meloId}`,
                404,
                'MELO_NOT_FOUND'
              );
            }
            throw error;
          }
        }

        const consumerShareSum = participants
          .filter((participant) => participant.role === 'consumer')
          .reduce((sum, participant) => sum + toNumber(participant.share, 1), 0);

        if (consumerShareSum > 1.0 + Number.EPSILON) {
          throw new MoleculerClientError(
            'Sum of consumer shares must be <= 1.0',
            422,
            'INVALID_SHARE_SUM'
          );
        }

        const payload = {
          id: ctx.params.id,
          name: ctx.params.name,
          type: ctx.params.type,
          participants: participants.map((participant) => ({
            ...participant,
            share: toNumber(participant.share, 1),
          })),
          gridOperatorMastrId: ctx.params.gridOperatorMastrId || null,
          validFrom: ctx.params.validFrom || null,
          validTo: ctx.params.validTo || null,
          metadata: ctx.params.metadata || {},
          createdAt: new Date().toISOString(),
          status: 'active',
        };

        await this.putStoredObject(ctx, NS_BILANZKREISE, id, payload);

        return {
          success: true,
          id,
          type: payload.type,
          participantCount: payload.participants.length,
        };
      },
    },

    list: {
      rest: 'GET /',
      params: {
        type: { type: 'string', optional: true },
        status: { type: 'enum', values: ['active', 'archived'], optional: true },
      },
      openapi: {
        summary: 'List Bilanzkreise',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'virtual_energy_sharing' },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['active', 'archived'], example: 'active' },
          },
        ],
      },
      async handler(ctx) {
        const docs = await this.listNamespace(ctx, NS_BILANZKREISE);

        const filtered = docs.filter((doc) => {
          const payload = doc.payload || {};
          if (ctx.params.type && payload.type !== ctx.params.type) return false;
          if (ctx.params.status && payload.status !== ctx.params.status) return false;
          return true;
        });

        return {
          success: true,
          count: filtered.length,
          data: filtered,
        };
      },
    },

    get: {
      rest: 'GET /:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Get a Bilanzkreis',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'bk_es_test' },
          },
        ],
      },
      async handler(ctx) {
        const payload = await this.getStoredObject(ctx, NS_BILANZKREISE, ctx.params.id, true);
        return {
          success: true,
          id: ctx.params.id,
          payload,
        };
      },
    },

    delete: {
      rest: 'DELETE /:id',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        summary: 'Delete a Bilanzkreis',
        tags: [OPENAPI_TAG],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'bk_es_test' },
          },
        ],
      },
      async handler(ctx) {
        await ctx.call('object-store.delete', {
          namespace: NS_BILANZKREISE,
          key: ctx.params.id,
        });
        return { success: true, id: ctx.params.id };
      },
    },

    calculate: {
      rest: 'POST /:id/calculate',
      params: {
        id: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
      openapi: {
        summary: 'Calculate balance for a Bilanzkreis over a time period',
        tags: [OPENAPI_TAG],
        description:
          'Loads timeseries for all participants from EDM, calculates saldo per 15-min interval, and returns summary with self-consumption and autarky rates.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'from', 'to'],
                properties: {
                  id: { type: 'string', example: 'bk_es_test' },
                  from: { type: 'string', example: '2026-04-01T00:00:00Z' },
                  to: { type: 'string', example: '2026-04-01T01:00:00Z' },
                },
              },
              examples: {
                default: {
                  value: {
                    id: 'bk_es_test',
                    from: '2026-04-01T00:00:00Z',
                    to: '2026-04-01T01:00:00Z',
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { id, from, to } = ctx.params;
        const fromIso = toIso(from);
        const toIsoValue = toIso(to);

        if (!fromIso || !toIsoValue) {
          throw new MoleculerClientError('Invalid from/to timestamp', 422, 'INVALID_PERIOD');
        }

        const bilanzkreis = await this.getStoredObject(ctx, NS_BILANZKREISE, id, true);
        const participants = bilanzkreis.participants || [];

        let calculation;
        if (bilanzkreis.type === 'real') {
          const feedinSeries = [];
          const consumptionSeries = [];

          for (const participant of participants) {
            if (participant.role === 'producer' || participant.role === 'prosumer') {
              const rows = await this.getTimeseries(
                ctx,
                participant.meloId,
                OBIS_FEEDIN,
                fromIso,
                toIsoValue
              );
              feedinSeries.push(rows);
            }
            if (participant.role === 'consumer' || participant.role === 'prosumer') {
              const rows = await this.getTimeseries(
                ctx,
                participant.meloId,
                OBIS_CONSUMPTION,
                fromIso,
                toIsoValue
              );
              consumptionSeries.push(rows);
            }
          }

          calculation = calculateBalance(
            this.mergeSeries(feedinSeries),
            this.mergeSeries(consumptionSeries),
            '15min'
          );
        } else {
          const participantData = [];

          for (const participant of participants) {
            if (participant.role === 'producer') {
              const data = await this.getTimeseries(
                ctx,
                participant.meloId,
                OBIS_FEEDIN,
                fromIso,
                toIsoValue
              );
              participantData.push({ ...participant, data });
            } else if (participant.role === 'consumer') {
              const data = await this.getTimeseries(
                ctx,
                participant.meloId,
                OBIS_CONSUMPTION,
                fromIso,
                toIsoValue
              );
              participantData.push({ ...participant, data });
            } else {
              const feedinData = await this.getTimeseries(
                ctx,
                participant.meloId,
                OBIS_FEEDIN,
                fromIso,
                toIsoValue
              );
              const consumptionData = await this.getTimeseries(
                ctx,
                participant.meloId,
                OBIS_CONSUMPTION,
                fromIso,
                toIsoValue
              );
              participantData.push({
                ...participant,
                feedinData,
                consumptionData,
              });
            }
          }

          calculation = calculateVirtualBkBalance(participantData, '15min');
        }

        const key = resultKey(id, fromIso, toIsoValue);
        await this.putStoredObject(ctx, NS_BK_RESULTS, key, {
          id,
          type: bilanzkreis.type,
          from: fromIso,
          to: toIsoValue,
          ...calculation,
          createdAt: new Date().toISOString(),
        });

        return {
          success: true,
          id,
          type: bilanzkreis.type,
          from: fromIso,
          to: toIsoValue,
          summary: calculation.summary,
        };
      },
    },

    checkReadiness: {
      rest: 'GET /:id/readiness',
      params: {
        id: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
      openapi: {
        summary: 'Check settlement readiness for a Bilanzkreis',
        tags: [OPENAPI_TAG],
        description:
          'Verifies data completeness and quality for all participants before running settlement calculations.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'bk_es_test' },
          },
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-04-01T00:00:00Z' },
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', example: '2026-04-01T01:00:00Z' },
          },
        ],
      },
      async handler(ctx) {
        const { id, from, to } = ctx.params;
        const fromIso = toIso(from);
        const toIsoValue = toIso(to);

        if (!fromIso || !toIsoValue) {
          throw new MoleculerClientError('Invalid from/to timestamp', 422, 'INVALID_PERIOD');
        }

        const bilanzkreis = await this.getStoredObject(ctx, NS_BILANZKREISE, id, true);
        const participantStatus = [];

        for (const participant of bilanzkreis.participants || []) {
          let rows = [];

          if (participant.role === 'producer') {
            rows = await this.getTimeseries(
              ctx,
              participant.meloId,
              OBIS_FEEDIN,
              fromIso,
              toIsoValue
            );
          } else if (participant.role === 'consumer') {
            rows = await this.getTimeseries(
              ctx,
              participant.meloId,
              OBIS_CONSUMPTION,
              fromIso,
              toIsoValue
            );
          } else {
            const feedinRows = await this.getTimeseries(
              ctx,
              participant.meloId,
              OBIS_FEEDIN,
              fromIso,
              toIsoValue
            );
            const consumptionRows = await this.getTimeseries(
              ctx,
              participant.meloId,
              OBIS_CONSUMPTION,
              fromIso,
              toIsoValue
            );
            rows = [...feedinRows, ...consumptionRows].sort((a, b) =>
              String(a.ts).localeCompare(String(b.ts))
            );
          }

          const measuredCount = rows.filter(
            (row) => String(row.quality || '').toLowerCase() === 'measured'
          ).length;
          const dataQuality = rows.length > 0 ? measuredCount / rows.length : 0;

          participantStatus.push({
            meloId: participant.meloId,
            hasData: rows.length > 0,
            dataQuality,
            gapHours: maxGapHours(rows),
            msconsComplete: true,
          });
        }

        const readiness = calculateSettlementReadiness(
          { participants: participantStatus },
          bilanzkreis
        );

        return {
          ...readiness,
          participantStatus,
        };
      },
    },
  },

  methods: {
    async putStoredObject(ctx, namespace, key, payload) {
      await ctx.call('object-store.put', {
        namespace,
        key,
        payload,
      });
    },

    async getStoredObject(ctx, namespace, key, throwIfMissing = true) {
      try {
        const result = await ctx.call('object-store.get', {
          namespace,
          key,
        });
        return result?.payload || result?.value || result?.data || null;
      } catch (error) {
        if (error?.code === 404 || error?.type === 'OBJECT_NOT_FOUND') {
          if (!throwIfMissing) return null;
          throw new MoleculerClientError('Bilanzkreis not found', 404, 'BILANZKREIS_NOT_FOUND');
        }
        throw error;
      }
    },

    async listNamespace(ctx, namespace) {
      try {
        const result = await ctx.call('object-store.list', { namespace });
        if (Array.isArray(result?.data)) return result.data;
        if (Array.isArray(result)) return result;
      } catch (_error) {
        // fallback to query for current object-store implementation
      }

      const result = await ctx.call('object-store.query', {
        namespace,
        selector: {},
        limit: 1000,
        skip: 0,
      });

      const docs = Array.isArray(result?.docs) ? result.docs : [];
      return docs.map((doc) => ({
        key: doc.key,
        payload: doc.payload,
      }));
    },

    async getTimeseries(ctx, meloId, obis, from, to) {
      const response = await ctx.call('edm.getTimeseries', {
        meloId,
        obis,
        from,
        to,
        resolution: '15min',
        format: 'json',
      });
      return parseRows(response);
    },

    mergeSeries(seriesList) {
      const byTs = new Map();

      for (const series of seriesList || []) {
        for (const row of series || []) {
          if (!row?.ts) continue;
          const ts = new Date(row.ts).toISOString();
          const current = byTs.get(ts) || { ts, value: 0, quality: 'measured', source: 'calc' };
          current.value += toNumber(row.value, 0);
          byTs.set(ts, current);
        }
      }

      return [...byTs.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    },
  },
};
