'use strict';

const TENANT_ID = 'gemeindewerk-mauer-demo';
const TENANT_NAME = 'Gemeindewerk Mauer (Beispiel)';
const ASSET_COUNT = 750;

function isDemoAssetId(assetId) {
  return /^gwm-\d{4}$/.test(String(assetId || ''));
}

function assetIndex(assetId) {
  if (!isDemoAssetId(assetId)) return null;
  return Number(String(assetId).slice(4));
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pickWeighted(rnd, entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rnd() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function technologyProfile(technology) {
  switch (technology) {
    case 'wind_onshore':
      return { minKw: 1800, maxKw: 5200, aw: 7.35, fullLoadHours: 2450 };
    case 'wind_offshore':
      return { minKw: 6500, maxKw: 11000, aw: 8.15, fullLoadHours: 3900 };
    case 'biomass':
      return { minKw: 300, maxKw: 1800, aw: 14.2, fullLoadHours: 5600 };
    case 'storage_hybrid':
      return { minKw: 500, maxKw: 4500, aw: 6.2, fullLoadHours: 900 };
    case 'pv_freiflaeche':
      return { minKw: 850, maxKw: 9500, aw: 5.7, fullLoadHours: 1020 };
    case 'pv_rooftop':
    default:
      return { minKw: 25, maxKw: 740, aw: 8.6, fullLoadHours: 890 };
  }
}

function getDemoAsset(assetId) {
  const index = assetIndex(assetId);
  if (!index || index < 1 || index > ASSET_COUNT) return null;

  const rnd = random(0x06082026);
  let selected = null;
  for (let i = 1; i <= index; i++) {
    const technology = pickWeighted(rnd, [
      ['pv_rooftop', 300],
      ['pv_freiflaeche', 170],
      ['wind_onshore', 145],
      ['biomass', 75],
      ['storage_hybrid', 45],
      ['wind_offshore', 15],
    ]);
    const profile = technologyProfile(technology);
    const capacityKw =
      Math.round((profile.minKw + rnd() * (profile.maxKw - profile.minKw)) * 100) / 100;
    rnd();
    selected = { technology, profile, capacityKw };
  }

  const { technology, profile, capacityKw } = selected;
  const commissioningDate = `${2012 + (index % 13)}-${String((index % 12) + 1).padStart(2, '0')}-15`;
  const name = `${TENANT_NAME} ${technology.replace(/_/g, '-')} ${String(index).padStart(4, '0')}`;
  const asset = {
    assetId,
    mastrNummer: `SEE-DEMO-${String(index).padStart(6, '0')}`,
    name,
    bezeichnung: name,
    technology,
    capacityKw,
    capacityKW: capacityKw,
    awCentsPerKwh: profile.aw,
    commissioningDate,
    tenantId: TENANT_ID,
    tenantName: TENANT_NAME,
    source: 'rcs-demo',
  };

  return {
    success: true,
    assetId,
    tenantId: TENANT_ID,
    tenantName: TENANT_NAME,
    sourceTrail: { source: 'rcs-demo', appliedOverrides: [] },
    ...asset,
    asset: {
      'Asset-ID': assetId,
      'SEE Nummer': asset.mastrNummer,
      Name: name,
      Anlagentyp: technology,
      Technologie: technology,
      'Leistung kW': capacityKw,
      Inbetriebnahmedatum: commissioningDate,
      tenantId: TENANT_ID,
      tenantName: TENANT_NAME,
    },
  };
}

function getDemoPrices(from, to) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const rows = [];
  for (let ts = start; ts < end; ts += 60 * 60 * 1000) {
    const hour = new Date(ts).getUTCHours();
    const day = Math.floor(ts / 86400000);
    const solarDip = hour >= 10 && hour <= 15 ? -35 : 0;
    const eveningPeak = hour >= 18 && hour <= 21 ? 32 : 0;
    const wave = Math.sin(((day % 14) / 14) * Math.PI * 2) * 18;
    const priceEurMwh = Math.round((38 + wave + solarDip + eveningPeak) * 100) / 100;
    rows.push({ timestamp: new Date(ts).toISOString(), priceEurMwh });
  }
  return rows;
}

function getDemoTimeseries(meloId, from, to, resolution = '15min') {
  const asset = getDemoAsset(meloId);
  if (!asset) return null;

  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const stepMs = resolution === 'daily' ? 86400000 : resolution === 'hourly' ? 3600000 : 15 * 60000;
  const rows = [];
  const profile = technologyProfile(asset.technology);
  const intervalHours = stepMs / 3600000;

  for (let ts = start; ts < end; ts += stepMs) {
    const d = new Date(ts);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const dayOfYear = Math.floor((ts - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000);
    let capacityFactor = 0.15;

    if (asset.technology.startsWith('pv_')) {
      const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
      const seasonal = 0.72 + 0.28 * Math.sin(((dayOfYear - 80) / 365) * Math.PI * 2);
      capacityFactor = daylight * seasonal * 0.82;
    } else if (asset.technology.startsWith('wind_')) {
      capacityFactor = 0.28 + 0.18 * Math.sin((dayOfYear / 9 + hour / 24) * Math.PI * 2);
      if (asset.technology === 'wind_offshore') capacityFactor += 0.16;
    } else if (asset.technology === 'biomass') {
      capacityFactor = 0.62 + 0.04 * Math.sin((hour / 24) * Math.PI * 2);
    } else if (asset.technology === 'storage_hybrid') {
      capacityFactor = hour >= 18 && hour <= 22 ? 0.42 : hour >= 11 && hour <= 15 ? 0.12 : 0.04;
    }

    const volumeKwh = Math.max(0, asset.capacityKw * capacityFactor * intervalHours);
    rows.push({
      timestamp: new Date(ts).toISOString(),
      volumeKwh: Math.round(volumeKwh * 10000) / 10000,
      value: Math.round(volumeKwh * 10000) / 10000,
      quality: 'synthetic',
      source: 'rcs-demo',
    });
  }

  return rows;
}

module.exports = {
  TENANT_ID,
  TENANT_NAME,
  ASSET_COUNT,
  isDemoAssetId,
  getDemoAsset,
  getDemoPrices,
  getDemoTimeseries,
};
