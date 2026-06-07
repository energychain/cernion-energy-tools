'use strict';

const { runCalculation } = require('../src/eeg-clawback-calculator');

module.exports = {
  name: 'eeg-clawback-calculator',

  actions: {
    /**
     * Layer 1 — pure mathematical core.
     * Accepts pre-fetched timeseries directly; performs no I/O.
     */
    calculate: {
      rest: 'POST /calculate',
      params: {
        asset: {
          type: 'object',
          props: {
            technology: {
              type: 'enum',
              values: ['solar', 'wind_onshore', 'wind_offshore', 'biomass'],
            },
            capacityKw: { type: 'number', positive: true },
            awCentsPerKwh: { type: 'number', positive: true },
            commissioningDate: { type: 'string' },
          },
        },
        prices: { type: 'array' },
        injection: { type: 'array' },
        options: { type: 'object', optional: true },
      },
      handler(ctx) {
        return runCalculation(ctx.params.asset, ctx.params.prices, ctx.params.injection);
      },
    },

    /**
     * Layer 2-style orchestrator — fetches data from assets / energy-market / edm,
     * then delegates to the pure calculate action.
     * Maps to: POST /api/vnb/rcs/simulate
     */
    simulate: {
      rest: 'POST /simulate',
      params: {
        assetId: { type: 'string', min: 1 },
        timeframe: {
          type: 'object',
          props: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
        },
        options: { type: 'object', optional: true },
      },
      async handler(ctx) {
        const { assetId, timeframe, options } = ctx.params;

        const [assetRaw, pricesRaw, injectionRaw] = await Promise.all([
          ctx.call('assets.effective', { assetId }),
          ctx.call('energy-market.prices', {
            start: timeframe.start,
            end: timeframe.end,
            market: 'day-ahead',
            resolution: 'hourly',
          }),
          ctx.call('edm.getTimeseries', {
            meloId: assetId,
            from: timeframe.start,
            to: timeframe.end,
            resolution: '15min',
          }),
        ]);

        const asset = {
          technology: assetRaw.technology ?? assetRaw.tech,
          capacityKw: assetRaw.capacityKw ?? assetRaw.capacity_kw ?? assetRaw.capacityKW,
          awCentsPerKwh:
            assetRaw.awCentsPerKwh ??
            assetRaw.aw_cents_per_kwh ??
            assetRaw.anzulegenderWertCentsKwh,
          commissioningDate:
            assetRaw.commissioningDate ??
            assetRaw.commissioning_date ??
            assetRaw.inbetriebnahmedatum,
        };

        const prices = Array.isArray(pricesRaw)
          ? pricesRaw
          : Array.isArray(pricesRaw?.data)
            ? pricesRaw.data
            : [];

        const injection = Array.isArray(injectionRaw)
          ? injectionRaw
          : Array.isArray(injectionRaw?.data)
            ? injectionRaw.data
            : [];

        const result = runCalculation(asset, prices, injection);

        return {
          assetId,
          assetName: assetRaw.name ?? assetRaw.bezeichnung ?? assetId,
          timeframe,
          blueprintId: 'rcs-eeg2027-clawback-v1',
          options: options ?? null,
          ...result,
        };
      },
    },
  },
};
