'use strict';

const INTERVAL_MINUTES = 15;
const INTERVAL_HOURS = INTERVAL_MINUTES / 60;

const DEFAULT_OPTIONS = {
  threshold: 0.85,
  minPowerKw: 4.2,
  maxDurationMinutes: 120,
  cooldownMinutes: 120,
  priorityOrder: ['storage', 'wallbox', 'heat_pump'],
};

const DEVICE_LABELS = {
  storage: 'Speicher',
  wallbox: 'Wallbox/Ladeeinrichtung',
  heat_pump: 'Wärmepumpe',
  solar_with_storage: 'PV mit Speicherpotenzial',
};

const TYPE_ORDER = {
  storage: 0,
  wallbox: 1,
  heat_pump: 2,
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value, 0) * factor) / factor;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseLoadKw(row) {
  if (row == null || typeof row !== 'object') return 0;
  if (Number.isFinite(Number(row.valueKw))) return Number(row.valueKw);
  if (Number.isFinite(Number(row.loadKw))) return Number(row.loadKw);
  if (Number.isFinite(Number(row.value))) return Number(row.value);
  return 0;
}

function getPriorityScore(type, priorityOrder) {
  const idx = priorityOrder.indexOf(type);
  if (idx >= 0) return idx;
  if (Object.prototype.hasOwnProperty.call(TYPE_ORDER, type)) return TYPE_ORDER[type];
  return Number.MAX_SAFE_INTEGER;
}

function normalizeDevices(devices) {
  if (!Array.isArray(devices)) return [];

  return devices
    .map((device) => ({
      deviceId: String(device?.deviceId || device?.id || ''),
      type: String(device?.type || 'other'),
      capacityKw: toNumber(device?.capacityKw, 0),
      minDimmingKw: toNumber(device?.minDimmingKw, DEFAULT_OPTIONS.minPowerKw),
      meloId: device?.meloId || null,
      status: device?.status || 'active',
    }))
    .filter((device) => device.deviceId && device.capacityKw > 0 && device.status === 'active');
}

function normalizeForecast(loadForecast) {
  if (!Array.isArray(loadForecast)) return [];

  return loadForecast
    .map((row) => {
      const ts = normalizeTimestamp(row?.ts || row?.timestamp || row?.time);
      return {
        ts,
        value: parseLoadKw(row),
      };
    })
    .filter((row) => row.ts)
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

function mergeOptions(options = {}) {
  return {
    threshold: toNumber(options.threshold, DEFAULT_OPTIONS.threshold),
    minPowerKw: toNumber(options.minPowerKw, DEFAULT_OPTIONS.minPowerKw),
    maxDurationMinutes: toNumber(options.maxDurationMinutes, DEFAULT_OPTIONS.maxDurationMinutes),
    cooldownMinutes: toNumber(options.cooldownMinutes, DEFAULT_OPTIONS.cooldownMinutes),
    priorityOrder:
      Array.isArray(options.priorityOrder) && options.priorityOrder.length > 0
        ? options.priorityOrder
        : DEFAULT_OPTIONS.priorityOrder,
  };
}

function canDimNow(state, tsMs, options) {
  if (!Number.isFinite(state.lastEventEndMs)) return true;

  const isContinuous = tsMs === state.lastEventEndMs;
  if (isContinuous) {
    return state.currentContinuousMinutes + INTERVAL_MINUTES <= options.maxDurationMinutes;
  }

  const pauseMinutes = (tsMs - state.lastEventEndMs) / 60000;
  return pauseMinutes >= options.cooldownMinutes;
}

function updateStateAfterEvent(state, tsMs) {
  if (tsMs === state.lastEventEndMs) {
    state.currentContinuousMinutes += INTERVAL_MINUTES;
  } else {
    state.currentContinuousMinutes = INTERVAL_MINUTES;
  }
  state.lastEventEndMs = tsMs + INTERVAL_MINUTES * 60000;
}

function calculateDimmingPlan(devices, loadForecast, gridCapacity, options = {}) {
  const normalizedDevices = normalizeDevices(devices);
  const forecast = normalizeForecast(loadForecast);
  const resolvedOptions = mergeOptions(options);
  const gridCapacityKw = toNumber(gridCapacity, 0);
  const limitKw = gridCapacityKw * resolvedOptions.threshold;

  const sortedDevices = [...normalizedDevices].sort(
    (a, b) =>
      getPriorityScore(a.type, resolvedOptions.priorityOrder) -
      getPriorityScore(b.type, resolvedOptions.priorityOrder)
  );

  const states = new Map(
    sortedDevices.map((device) => [
      device.deviceId,
      {
        lastEventEndMs: null,
        currentContinuousMinutes: 0,
      },
    ])
  );

  const events = [];
  let totalReductionKwh = 0;
  let peakLoadKw = 0;
  let peakLoadWithDimmingKw = 0;

  for (const point of forecast) {
    const tsMs = new Date(point.ts).getTime();
    const intervalLoadKw = toNumber(point.value, 0);
    peakLoadKw = Math.max(peakLoadKw, intervalLoadKw);

    let remainingReductionKw = Math.max(0, intervalLoadKw - limitKw);
    let intervalReductionKw = 0;

    if (remainingReductionKw > 0) {
      for (const device of sortedDevices) {
        if (remainingReductionKw <= 0) break;

        const state = states.get(device.deviceId);
        if (!canDimNow(state, tsMs, resolvedOptions)) {
          continue;
        }

        const minPowerKw = Math.max(resolvedOptions.minPowerKw, device.minDimmingKw);
        const maxReductionKw = Math.max(0, device.capacityKw - minPowerKw);
        if (maxReductionKw <= 0) {
          continue;
        }

        const reductionKw = Math.min(maxReductionKw, remainingReductionKw);
        const dimmedPowerKw = Math.max(minPowerKw, device.capacityKw - reductionKw);

        events.push({
          deviceId: device.deviceId,
          deviceType: device.type,
          meloId: device.meloId,
          start: point.ts,
          end: new Date(tsMs + INTERVAL_MINUTES * 60000).toISOString(),
          durationMinutes: INTERVAL_MINUTES,
          originalPowerKw: round(device.capacityKw),
          dimmedPowerKw: round(dimmedPowerKw),
          reductionKw: round(reductionKw),
          reason: 'grid_congestion',
        });

        updateStateAfterEvent(state, tsMs);

        remainingReductionKw -= reductionKw;
        intervalReductionKw += reductionKw;
      }
    }

    totalReductionKwh += intervalReductionKw * INTERVAL_HOURS;
    peakLoadWithDimmingKw = Math.max(
      peakLoadWithDimmingKw,
      Math.max(0, intervalLoadKw - intervalReductionKw)
    );
  }

  const affectedDevices = new Set(events.map((event) => event.deviceId)).size;
  const reductionPercent =
    peakLoadKw > 0 ? ((peakLoadKw - peakLoadWithDimmingKw) / peakLoadKw) * 100 : 0;

  return {
    events,
    summary: {
      totalEvents: events.length,
      totalReductionKwh: round(totalReductionKwh),
      affectedDevices,
      peakLoadKw: round(peakLoadKw),
      peakLoadWithDimmingKw: round(peakLoadWithDimmingKw),
      reductionPercent: round(reductionPercent, 2),
    },
  };
}

function mapByTs(rows) {
  const map = new Map();
  if (!Array.isArray(rows)) return map;

  for (const row of rows) {
    const ts = normalizeTimestamp(row?.ts || row?.timestamp || row?.time);
    if (!ts) continue;
    map.set(ts, parseLoadKw(row));
  }
  return map;
}

function calculateReliefProof(dimmingEvents, loadBefore, loadAfter) {
  const events = Array.isArray(dimmingEvents) ? dimmingEvents : [];
  const beforeMap = mapByTs(loadBefore);
  const afterMap = mapByTs(loadAfter);

  const proofEvents = [];
  let totalReliefKwh = 0;
  let totalReliefKw = 0;
  let effectiveEvents = 0;

  for (const event of events) {
    const start = normalizeTimestamp(event?.start) || String(event?.start || '');
    const end = normalizeTimestamp(event?.end) || start;
    const beforeKw = beforeMap.has(start)
      ? beforeMap.get(start)
      : toNumber(event?.loadBefore_kw ?? event?.originalPowerKw, 0);
    const afterKw = afterMap.has(start)
      ? afterMap.get(start)
      : Math.max(0, beforeKw - toNumber(event?.reductionKw, 0));

    const reliefKw = Math.max(0, beforeKw - afterKw);
    const durationMinutes = Math.max(1, toNumber(event?.durationMinutes, INTERVAL_MINUTES));
    const reliefKwh = reliefKw * (durationMinutes / 60);
    const effective = reliefKw > 0;

    if (effective) effectiveEvents += 1;
    totalReliefKw += reliefKw;
    totalReliefKwh += reliefKwh;

    proofEvents.push({
      deviceId: event?.deviceId || null,
      start,
      end,
      loadBefore_kw: round(beforeKw),
      loadAfter_kw: round(afterKw),
      relief_kw: round(reliefKw),
      effective,
    });
  }

  const totalEvents = proofEvents.length;
  const avgReliefKw = totalEvents > 0 ? totalReliefKw / totalEvents : 0;
  const effectivenessRate = totalEvents > 0 ? effectiveEvents / totalEvents : 0;

  return {
    events: proofEvents,
    summary: {
      totalEvents,
      effectiveEvents,
      totalRelief_kwh: round(totalReliefKwh),
      avgRelief_kw: round(avgReliefKw),
      effectivenessRate: round(effectivenessRate, 4),
    },
  };
}

function calculateTariffReduction(device, annualHours) {
  const normalizedDevice = device || {};
  const deviceType = String(normalizedDevice.type || 'other');
  const capacityKw = toNumber(normalizedDevice.capacityKw, 0);
  const hours = Math.max(1, toNumber(annualHours, 8760));

  const basisByType = {
    wallbox: {
      performancePriceEurPerKwYear: 14.5,
      reductionFactor: 1.0,
      corridorEurPerYear: '110-190',
    },
    heat_pump: {
      performancePriceEurPerKwYear: 20,
      reductionFactor: 0.95,
      corridorEurPerYear: '150-250',
    },
    storage: {
      performancePriceEurPerKwYear: 12,
      reductionFactor: 0.9,
      corridorEurPerYear: '80-150',
    },
    air_conditioning: {
      performancePriceEurPerKwYear: 10,
      reductionFactor: 0.85,
      corridorEurPerYear: '70-140',
    },
    other: {
      performancePriceEurPerKwYear: 8,
      reductionFactor: 0.8,
      corridorEurPerYear: '50-120',
    },
  };

  const basis = basisByType[deviceType] || basisByType.other;
  const annualizationFactor = Math.min(1.1, Math.max(0.5, hours / 8760));
  const annualReduction =
    capacityKw * basis.performancePriceEurPerKwYear * basis.reductionFactor * annualizationFactor;

  return {
    annualReduction_eur: round(annualReduction, 2),
    monthlyReduction_eur: round(annualReduction / 12, 2),
    basis: {
      deviceType,
      capacityKw: round(capacityKw),
      annualHours: round(hours, 0),
      performancePriceEurPerKwYear: basis.performancePriceEurPerKwYear,
      reductionFactor: basis.reductionFactor,
      annualizationFactor: round(annualizationFactor, 3),
      typicalCorridorEurPerYear: basis.corridorEurPerYear,
    },
    explanation:
      'Netzentgelt-Reduktion ≈ Leistungspreis × Reduktionsfaktor × Jahresnutzungsfaktor gemäß §14a-Modul.',
  };
}

function classifyDevice(installationData) {
  const data = installationData || {};
  const type = String(data.type || data.installationType || '').toLowerCase();
  const name = String(data.name || data.EinheitName || '').toLowerCase();
  const capacityKw = toNumber(
    data.capacityKw ?? data.nettonennleistung ?? data.NettoNennleistung,
    0
  );

  if (type === 'storage' && capacityKw >= DEFAULT_OPTIONS.minPowerKw) {
    return {
      deviceType: 'storage',
      section14aEligible: true,
      minPowerKw: DEFAULT_OPTIONS.minPowerKw,
      label: DEVICE_LABELS.storage,
    };
  }

  if (
    (name.includes('wallbox') || name.includes('ladeeinrichtung')) &&
    capacityKw >= DEFAULT_OPTIONS.minPowerKw
  ) {
    return {
      deviceType: 'wallbox',
      section14aEligible: true,
      minPowerKw: DEFAULT_OPTIONS.minPowerKw,
      label: DEVICE_LABELS.wallbox,
    };
  }

  if (
    (name.includes('wärmepumpe') || name.includes('waermepumpe') || name.includes('heat')) &&
    capacityKw >= DEFAULT_OPTIONS.minPowerKw
  ) {
    return {
      deviceType: 'heat_pump',
      section14aEligible: true,
      minPowerKw: DEFAULT_OPTIONS.minPowerKw,
      label: DEVICE_LABELS.heat_pump,
    };
  }

  if (type === 'solar' && capacityKw >= 25) {
    return {
      deviceType: 'solar_with_storage',
      section14aEligible: false,
      minPowerKw: DEFAULT_OPTIONS.minPowerKw,
      label: DEVICE_LABELS.solar_with_storage,
    };
  }

  return {
    deviceType: null,
    section14aEligible: false,
    minPowerKw: DEFAULT_OPTIONS.minPowerKw,
    label: 'Nicht steuerbar',
  };
}

module.exports = {
  DEFAULT_OPTIONS,
  INTERVAL_MINUTES,
  calculateDimmingPlan,
  calculateReliefProof,
  calculateTariffReduction,
  classifyDevice,
};
