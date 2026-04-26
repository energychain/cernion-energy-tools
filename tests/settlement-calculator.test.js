'use strict';

const {
  calculateRedispatchCompensation,
  calculateEegRevenue,
  prepareA96Export,
} = require('../src/settlement-calculator');

describe('settlement-calculator', () => {
  test('calculateRedispatchCompensation: einfaches Beispiel', () => {
    const events = [{
      installationMastrNummer: 'SEE123',
      start: '2026-04-01T14:00:00Z',
      end: '2026-04-01T16:00:00Z',
    }];
    const forecastData = [
      { ts: '2026-04-01T14:00:00Z', value: 500 },
      { ts: '2026-04-01T14:15:00Z', value: 520 },
      { ts: '2026-04-01T14:30:00Z', value: 510 },
      { ts: '2026-04-01T14:45:00Z', value: 490 },
      { ts: '2026-04-01T15:00:00Z', value: 450 },
      { ts: '2026-04-01T15:15:00Z', value: 430 },
      { ts: '2026-04-01T15:30:00Z', value: 400 },
      { ts: '2026-04-01T15:45:00Z', value: 380 },
    ];
    const actualData = [
      { ts: '2026-04-01T14:00:00Z', value: 200 },
      { ts: '2026-04-01T14:15:00Z', value: 210 },
      { ts: '2026-04-01T14:30:00Z', value: 200 },
      { ts: '2026-04-01T14:45:00Z', value: 190 },
      { ts: '2026-04-01T15:00:00Z', value: 180 },
      { ts: '2026-04-01T15:15:00Z', value: 170 },
      { ts: '2026-04-01T15:30:00Z', value: 160 },
      { ts: '2026-04-01T15:45:00Z', value: 150 },
    ];
    const marketPrices = [
      { hour: '2026-04-01T14:00:00Z', price_eur_mwh: 45.20 },
      { hour: '2026-04-01T15:00:00Z', price_eur_mwh: 42.80 },
    ];

    const result = calculateRedispatchCompensation(
      events,
      forecastData,
      actualData,
      marketPrices
    );

    expect(result.events.length).toBe(1);
    expect(result.summary.totalLostKwh).toBeGreaterThan(0);
    expect(result.summary.totalCompensation_eur).toBeGreaterThan(0);
    expect(result.summary.totalCompensation_eur).toBeGreaterThan(50);
    expect(result.summary.totalCompensation_eur).toBeLessThan(200);
  });

  test('calculateEegRevenue: Monatsberechnung', () => {
    const feedinData = Array.from({ length: 96 * 30 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 3, 1) + i * 900000).toISOString(),
      value: Math.max(0, Math.sin((i / 96) * Math.PI) * 10),
    }));
    const result = calculateEegRevenue(feedinData, 8.11, 30);
    expect(result.revenue_eur).toBeGreaterThan(0);
    expect(result.feedinKwh).toBeGreaterThan(0);
  });

  test('prepareA96Export: generiert CSV-kompatible Rows', () => {
    const compensationResult = {
      events: [{
        installationMastrNummer: 'SEE123',
        from: '2026-04-01T14:00:00Z',
        to: '2026-04-01T16:00:00Z',
        forecast_kwh: 3680,
        actual_kwh: 1460,
        lost_kwh: 2220,
        marketPrice_eur_mwh: 44.0,
        compensation_eur: 97.68,
      }],
    };
    const rows = prepareA96Export(compensationResult, {
      mastrNummer: 'SEE123',
      meloId: 'DE000...',
    });
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveProperty('mastrNummer');
    expect(rows[0]).toHaveProperty('compensation_eur');
  });
});
