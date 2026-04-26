'use strict';

const {
  calculateBalance,
  calculateVirtualBkBalance,
  calculateSettlementReadiness,
} = require('../src/bilanzkreis-calculator');

describe('bilanzkreis-calculator', () => {
  test('calculateBalance: positiver Saldo = Export', () => {
    const feedin = [
      { ts: '2026-04-01T12:00:00Z', value: 100 },
      { ts: '2026-04-01T12:15:00Z', value: 120 },
    ];
    const consumption = [
      { ts: '2026-04-01T12:00:00Z', value: 30 },
      { ts: '2026-04-01T12:15:00Z', value: 35 },
    ];

    const result = calculateBalance(feedin, consumption);

    expect(result.intervals[0].direction).toBe('export');
    expect(result.intervals[0].balance_kwh).toBe(70);
    expect(result.summary.netBalance_kwh).toBeGreaterThan(0);
  });

  test('calculateBalance: negativer Saldo = Import', () => {
    const feedin = [{ ts: '2026-04-01T20:00:00Z', value: 0 }];
    const consumption = [{ ts: '2026-04-01T20:00:00Z', value: 50 }];

    const result = calculateBalance(feedin, consumption);

    expect(result.intervals[0].direction).toBe('import');
    expect(result.summary.netBalance_kwh).toBeLessThan(0);
  });

  test('calculateBalance: selfConsumptionRate berechnet', () => {
    const feedin = [{ ts: '2026-04-01T12:00:00Z', value: 100 }];
    const consumption = [{ ts: '2026-04-01T12:00:00Z', value: 40 }];

    const result = calculateBalance(feedin, consumption);

    expect(result.summary.selfConsumptionRate).toBeCloseTo(0.4, 2);
  });

  test('calculateVirtualBkBalance: Energy Sharing 2 Producer + 3 Consumer', () => {
    const participants = [
      {
        meloId: 'PV1',
        role: 'producer',
        share: 1.0,
        data: [{ ts: '2026-04-01T12:00:00Z', value: 100 }],
      },
      {
        meloId: 'PV2',
        role: 'producer',
        share: 1.0,
        data: [{ ts: '2026-04-01T12:00:00Z', value: 50 }],
      },
      {
        meloId: 'C1',
        role: 'consumer',
        share: 0.4,
        data: [{ ts: '2026-04-01T12:00:00Z', value: 30 }],
      },
      {
        meloId: 'C2',
        role: 'consumer',
        share: 0.3,
        data: [{ ts: '2026-04-01T12:00:00Z', value: 25 }],
      },
      {
        meloId: 'C3',
        role: 'consumer',
        share: 0.3,
        data: [{ ts: '2026-04-01T12:00:00Z', value: 20 }],
      },
    ];

    const result = calculateVirtualBkBalance(participants);

    expect(result.summary.totalShared_kwh).toBeGreaterThan(0);
    expect(result.summary.sharingQuote).toBeGreaterThan(0);
    expect(result.summary.producerCount).toBe(2);
    expect(result.summary.consumerCount).toBe(3);
  });

  test('calculateSettlementReadiness: vollständige Daten → ready', () => {
    const bkData = {
      participants: [
        { meloId: 'M1', hasData: true, dataQuality: 0.98, gapHours: 0 },
        { meloId: 'M2', hasData: true, dataQuality: 0.96, gapHours: 0 },
      ],
    };

    const result = calculateSettlementReadiness(bkData);

    expect(result.ready).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  test('calculateSettlementReadiness: fehlende Daten → nicht ready', () => {
    const bkData = {
      participants: [
        { meloId: 'M1', hasData: true, dataQuality: 0.98, gapHours: 0 },
        { meloId: 'M2', hasData: false, dataQuality: 0, gapHours: 24 },
      ],
    };

    const result = calculateSettlementReadiness(bkData);

    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
