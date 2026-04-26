'use strict';

const EEG_TARIFFS_PV = [
  {
    from: '2024-02-01',
    to: '2024-07-31',
    tiers: [
      { maxKwp: 10, tariff: 8.11 },
      { maxKwp: 100, tariff: 7.03 },
      { maxKwp: 300, tariff: 5.74 },
      { maxKwp: 750, tariff: 4.59 },
    ],
  },
  {
    from: '2024-08-01',
    to: '2025-01-31',
    tiers: [
      { maxKwp: 10, tariff: 8.03 },
      { maxKwp: 100, tariff: 6.95 },
      { maxKwp: 300, tariff: 5.68 },
      { maxKwp: 750, tariff: 4.55 },
    ],
  },
  {
    from: '2025-02-01',
    to: '2025-07-31',
    tiers: [
      { maxKwp: 10, tariff: 7.94 },
      { maxKwp: 100, tariff: 6.88 },
      { maxKwp: 300, tariff: 5.61 },
      { maxKwp: 750, tariff: 4.49 },
    ],
  },
];

// Vereinfachte Tabellen (aktuelle Sätze als Platzhalter für spätere Erweiterung)
const EEG_TARIFFS_WIND = [
  {
    from: '2024-01-01',
    to: '2030-12-31',
    tiers: [{ maxKwp: Number.POSITIVE_INFINITY, tariff: 7.35 }],
  },
];

const EEG_TARIFFS_BIOMASS = [
  {
    from: '2024-01-01',
    to: '2030-12-31',
    tiers: [{ maxKwp: Number.POSITIVE_INFINITY, tariff: 13.2 }],
  },
];

const POST_EEG_RATES = {
  solar: 4.2,
  wind: 6.0,
  biomass: 9.0,
};

function toDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeType(type) {
  const normalized = String(type || 'solar').toLowerCase();
  if (normalized === 'pv') return 'solar';
  if (normalized === 'biomasse') return 'biomass';
  return normalized;
}

function pickTable(type) {
  const normalizedType = normalizeType(type);
  if (normalizedType === 'wind') return EEG_TARIFFS_WIND;
  if (normalizedType === 'biomass') return EEG_TARIFFS_BIOMASS;
  return EEG_TARIFFS_PV;
}

function pickTier(tiers, capacityKwp) {
  const value = Number(capacityKwp);
  const capacity = Number.isFinite(value) && value > 0 ? value : 0;
  const sorted = [...tiers].sort((a, b) => a.maxKwp - b.maxKwp);
  return sorted.find((tier) => capacity <= tier.maxKwp) || null;
}

function isPostEeg(commissioningDate) {
  const date = toDate(commissioningDate);
  if (!date) return false;

  const boundary = new Date();
  boundary.setUTCFullYear(boundary.getUTCFullYear() - 20);
  return date < boundary;
}

function getPostEegRate(type) {
  const normalizedType = normalizeType(type);
  return POST_EEG_RATES[normalizedType] || POST_EEG_RATES.solar;
}

function getEegTariff(commissioningDate, capacityKwp, type = 'solar') {
  const date = toDate(commissioningDate);
  if (!date) return null;

  if (isPostEeg(commissioningDate)) {
    return getPostEegRate(type);
  }

  const table = pickTable(type);
  const period = table.find((item) => {
    const from = toDate(item.from);
    const to = toDate(item.to);
    return from && to && date >= from && date <= to;
  });

  if (!period) return null;

  const tier = pickTier(period.tiers, capacityKwp);
  return tier ? tier.tariff : null;
}

module.exports = {
  EEG_TARIFFS_PV,
  EEG_TARIFFS_WIND,
  EEG_TARIFFS_BIOMASS,
  getEegTariff,
  getPostEegRate,
  isPostEeg,
};
