'use strict';

const { Errors } = require('moleculer');
const { normalizeDayWindow, buildRowsFromSlp } = require('../src/edm-virtual-meter');

const { MoleculerClientError } = Errors;

module.exports = {
  name: 'edm-virtual',
  timeout: 120000,
  dependencies: ['edm', 'slp'],

  actions: {
    populateBySlp: {
      rest: 'POST /virtual/populate-slp',
      params: {
        meloId: { type: 'string', min: 1 },
        date: { type: 'string', min: 10 },
        profileId: { type: 'string', optional: true, default: 'H0' },
        annualConsumptionKwh: { type: 'number', convert: true, optional: true, default: 3500 },
        obis: { type: 'string', optional: true, default: '1-0:1.8.0' },
        overwriteExisting: { type: 'boolean', convert: true, optional: true, default: true },
        quality: { type: 'string', optional: true, default: 'synthetic' },
      },
      openapi: {
        summary: 'Populate one virtual/dummy MeLo from SLP profile',
        tags: ['EDM (Energiedatenmanagement)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['meloId', 'date'],
                properties: {
                  meloId: { type: 'string', example: 'VIRTUAL_1' },
                  date: { type: 'string', example: '2026-05-01' },
                  profileId: { type: 'string', example: 'H0', default: 'H0' },
                  annualConsumptionKwh: { type: 'number', example: 3200, default: 3500 },
                  obis: { type: 'string', example: '1-0:1.8.0', default: '1-0:1.8.0' },
                  overwriteExisting: { type: 'boolean', default: true },
                  quality: { type: 'string', example: 'synthetic', default: 'synthetic' },
                },
              },
              examples: {
                default: {
                  value: {
                    meloId: 'VIRTUAL_1',
                    date: '2026-05-01',
                    profileId: 'H0',
                    annualConsumptionKwh: 3200,
                    overwriteExisting: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Virtual timeseries imported' },
          404: { description: 'MeLo not found' },
          422: { description: 'MeLo type not supported' },
        },
      },
      async handler(ctx) {
        const { meloId, date, profileId, annualConsumptionKwh, overwriteExisting, quality } =
          ctx.params;
        const meloRes = await ctx.call('edm.getMelo', { meloId });
        const melo = meloRes.data;

        if (!['virtual', 'dummy'].includes(melo.type)) {
          throw new MoleculerClientError(
            'Only virtual or dummy MeLos can be auto-populated',
            422,
            'MELO_TYPE_NOT_SUPPORTED'
          );
        }

        const { day } = normalizeDayWindow(date);
        const profile = await ctx.call('slp.generateTimeseries', {
          profileId,
          date: day,
          annualConsumptionKwh,
        });

        const obis =
          ctx.params.obis ||
          (Array.isArray(melo.obisRegisters) &&
            melo.obisRegisters[0] &&
            melo.obisRegisters[0].obis) ||
          '1-0:1.8.0';

        const data = buildRowsFromSlp(day, profile.values, {
          quality,
          source: `virtual:slp:${profileId}`,
        });

        const imported = await ctx.call('edm.importTimeseries', {
          meloId,
          obis,
          format: 'json',
          data,
          overwriteExisting,
        });

        return {
          success: true,
          meloId,
          date: day,
          profileId,
          imported: imported.imported,
          skipped: imported.skipped,
          partitions: imported.partitions,
        };
      },
    },

    autoPopulateDay: {
      rest: 'POST /virtual/auto-populate/day',
      params: {
        date: { type: 'string', min: 10 },
        profileId: { type: 'string', optional: true, default: 'H0' },
        annualConsumptionKwh: { type: 'number', convert: true, optional: true, default: 3500 },
        typeFilter: {
          type: 'enum',
          values: ['virtual', 'dummy', 'all'],
          optional: true,
          default: 'virtual',
        },
        includeCalc: { type: 'boolean', convert: true, optional: true, default: true },
        includeSlp: { type: 'boolean', convert: true, optional: true, default: true },
        overwriteExisting: { type: 'boolean', convert: true, optional: true, default: false },
        limit: {
          type: 'number',
          convert: true,
          integer: true,
          optional: true,
          default: 100,
          min: 1,
          max: 1000,
        },
      },
      openapi: {
        summary: 'Auto-populate virtual meter data for one day',
        tags: ['EDM (Energiedatenmanagement)'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['date'],
                properties: {
                  date: { type: 'string', example: '2026-05-01' },
                  profileId: { type: 'string', example: 'H0', default: 'H0' },
                  annualConsumptionKwh: { type: 'number', example: 3200, default: 3500 },
                  typeFilter: {
                    type: 'string',
                    enum: ['virtual', 'dummy', 'all'],
                    default: 'virtual',
                  },
                  includeCalc: { type: 'boolean', default: true },
                  includeSlp: { type: 'boolean', default: true },
                  overwriteExisting: { type: 'boolean', default: false },
                  limit: { type: 'integer', default: 100 },
                },
              },
              examples: {
                default: {
                  value: {
                    date: '2026-05-01',
                    profileId: 'H0',
                    annualConsumptionKwh: 3200,
                    typeFilter: 'virtual',
                    includeCalc: true,
                    includeSlp: true,
                    overwriteExisting: false,
                    limit: 100,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Auto-population summary' },
        },
      },
      async handler(ctx) {
        const {
          date,
          profileId,
          annualConsumptionKwh,
          typeFilter,
          includeCalc,
          includeSlp,
          overwriteExisting,
          limit,
        } = ctx.params;

        const { from, to, day } = normalizeDayWindow(date);
        const failures = [];
        let calcEvaluated = 0;

        if (includeCalc) {
          try {
            const evaluated = await ctx.call('edm-messkonzept.evaluateAll', { from, to });
            calcEvaluated = Number(evaluated.evaluated || 0);
          } catch (err) {
            failures.push({ type: 'calc', error: err.message });
          }
        }

        if (!includeSlp) {
          return {
            success: failures.length === 0,
            date: day,
            calcEvaluated,
            slpPopulated: 0,
            failures,
          };
        }

        const listParams = typeFilter === 'all' ? {} : { type: typeFilter };
        const meloList = await ctx.call('edm.listMelos', listParams);
        const candidates = (meloList.data || [])
          .filter((melo) => ['virtual', 'dummy'].includes(melo.type))
          .filter((melo) => melo.sourceType !== 'calc')
          .slice(0, limit);

        let slpPopulated = 0;
        for (const melo of candidates) {
          try {
            await ctx.call('edm-virtual.populateBySlp', {
              meloId: melo.meloId,
              date: day,
              profileId,
              annualConsumptionKwh,
              obis: melo.obisRegisters?.[0]?.obis || '1-0:1.8.0',
              overwriteExisting,
            });
            slpPopulated += 1;
          } catch (err) {
            failures.push({ meloId: melo.meloId, type: 'slp', error: err.message });
          }
        }

        return {
          success: failures.length === 0,
          date: day,
          calcEvaluated,
          slpPopulated,
          failures,
        };
      },
    },
  },
};
