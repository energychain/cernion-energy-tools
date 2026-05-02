'use strict';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function toIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toTimestampMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const iso = toIso(row?.ts);
    if (!iso) continue;
    map.set(iso, toNumber(row?.value, 0));
  }
  return map;
}

function sortedUnionKeys(...maps) {
  const keys = new Set();
  for (const map of maps) {
    for (const key of map.keys()) keys.add(key);
  }
  return [...keys].sort((a, b) => String(a).localeCompare(String(b)));
}

function getTemperatureFactor(temperatureCelsius) {
  if (!Number.isFinite(temperatureCelsius)) return 1;
  if (temperatureCelsius < 15) {
    return 1 + (15 - temperatureCelsius) * 0.02;
  }
  if (temperatureCelsius > 25) {
    return 1 + (temperatureCelsius - 25) * 0.01;
  }
  return 1;
}

function getRatingFromMape(mape) {
  if (mape < 10) return 'excellent';
  if (mape < 20) return 'good';
  if (mape < 30) return 'acceptable';
  return 'poor';
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildPriceMap(marketPrices) {
  const map = new Map();
  for (const row of marketPrices || []) {
    const key = toIso(row?.hour || row?.ts || row?.timestamp);
    if (!key) continue;
    const hourKey = key.slice(0, 13);
    map.set(hourKey, toNumber(row?.price_eur_mwh, null));
  }
  return map;
}

function getHourPrice(priceMap, ts) {
  const key = String(ts).slice(0, 13);
  return priceMap.has(key) ? priceMap.get(key) : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateLoadForecast(historicalData, slpProfile, options = {}) {
  const annualConsumptionKwh = toNumber(options.annualConsumptionKwh, 3500);
  const profileId = options.profileId || 'H0';
  const date = options.date || new Date().toISOString().slice(0, 10);
  const temperatureCelsius = Number.isFinite(options.temperatureCelsius)
    ? Number(options.temperatureCelsius)
    : null;

  const slpValues = Array.isArray(slpProfile?.values)
    ? slpProfile.values.map((value) => toNumber(value, 0))
    : [];

  if (slpValues.length !== 96) {
    throw new Error('SLP profile must contain exactly 96 quarter-hour values');
  }

  const slpSum = slpValues.reduce((sum, value) => sum + value, 0);
  if (slpSum <= 0) {
    throw new Error('SLP profile values must sum to > 0');
  }

  const dailyKwh = annualConsumptionKwh / 365;
  const baseSeries = slpValues.map((value) => (value / slpSum) * dailyKwh);

  const historicalRows = Array.isArray(historicalData) ? historicalData : [];
  const historicalActive = historicalRows.length >= 96;

  let correctionFactor = null;
  let correctedSeries = baseSeries.slice();
  let method = 'slp_only';

  if (historicalActive && options.correctionEnabled !== false) {
    const historicalAvg = average(
      historicalRows
        .map((row) => toNumber(row?.value, 0))
        .filter((value) => Number.isFinite(value) && value >= 0)
    );
    const slpAvg = average(baseSeries);

    if (slpAvg > 0) {
      correctionFactor = round(historicalAvg / slpAvg, 6);
      correctedSeries = baseSeries.map((value) => value * correctionFactor);
      method = 'slp_corrected';
    }
  }

  const temperatureFactor = getTemperatureFactor(temperatureCelsius);
  if (temperatureFactor !== 1) {
    correctedSeries = correctedSeries.map((value) => value * temperatureFactor);
    method = 'slp_temperature_corrected';
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const values = correctedSeries.map((value, index) => ({
    ts: new Date(dayStart + index * 15 * 60 * 1000).toISOString(),
    value: round(value, 6),
    quality: 'forecast',
  }));

  const totalKwh = round(values.reduce((sum, row) => sum + row.value, 0), 6);
  const peakKw = round(Math.max(...values.map((row) => row.value)) * 4, 4);

  return {
    date,
    profileId,
    values,
    totalKwh,
    peakKw,
    method,
    correctionFactor,
  };
}

function calculateResidualLoad(loadForecast, generationForecast) {
  const loadMap = toTimestampMap(loadForecast);
  const generationMap = toTimestampMap(generationForecast);
  const keys = sortedUnionKeys(loadMap, generationMap);

  let peakImportKw = 0;
  let peakExportKw = 0;
  let totalImportKwh = 0;
  let totalExportKwh = 0;
  let balancePointCount = 0;
  let previousDirection = null;
  let totalLoadKwh = 0;
  let selfSuppliedKwh = 0;

  const intervals = keys.map((ts) => {
    const loadKw = toNumber(loadMap.get(ts), 0);
    const generationKw = toNumber(generationMap.get(ts), 0);
    const residualKw = loadKw - generationKw;
    const direction = residualKw >= 0 ? 'import' : 'export';

    if (previousDirection && previousDirection !== direction) {
      balancePointCount += 1;
    }
    previousDirection = direction;

    peakImportKw = Math.max(peakImportKw, residualKw > 0 ? residualKw : 0);
    peakExportKw = Math.max(peakExportKw, residualKw < 0 ? Math.abs(residualKw) : 0);

    if (residualKw > 0) totalImportKwh += residualKw * 0.25;
    if (residualKw < 0) totalExportKwh += Math.abs(residualKw) * 0.25;

    totalLoadKwh += loadKw * 0.25;
    selfSuppliedKwh += Math.min(loadKw, generationKw) * 0.25;

    return {
      ts,
      load_kw: round(loadKw, 4),
      generation_kw: round(generationKw, 4),
      residual_kw: round(residualKw, 4),
      direction,
    };
  });

  return {
    intervals,
    summary: {
      peakImport_kw: round(peakImportKw, 4),
      peakExport_kw: round(peakExportKw, 4),
      totalImport_kwh: round(totalImportKwh, 6),
      totalExport_kwh: round(totalExportKwh, 6),
      balancePoint_count: balancePointCount,
      autarkyRate: totalLoadKwh > 0 ? round(selfSuppliedKwh / totalLoadKwh, 6) : 0,
    },
  };
}

function calculateForecastQuality(forecast, actual) {
  const forecastValues = Array.isArray(forecast) ? forecast : [];
  const actualValues = Array.isArray(actual) ? actual : [];
  const sampleSize = Math.min(forecastValues.length, actualValues.length);

  if (sampleSize === 0) {
    return {
      rmse: 0,
      mae: 0,
      mape: 0,
      bias: 0,
      correlation: 0,
      sampleSize: 0,
      rating: 'poor',
    };
  }

  let sumSquaredError = 0;
  let sumAbsoluteError = 0;
  let sumAbsolutePercentageError = 0;
  let percentageCount = 0;
  let sumBias = 0;

  const f = [];
  const a = [];

  for (let i = 0; i < sampleSize; i += 1) {
    const forecastValue = toNumber(forecastValues[i]?.value, 0);
    const actualValue = toNumber(actualValues[i]?.value, 0);
    const error = forecastValue - actualValue;

    f.push(forecastValue);
    a.push(actualValue);

    sumSquaredError += error ** 2;
    sumAbsoluteError += Math.abs(error);
    sumBias += error;

    if (actualValue !== 0) {
      sumAbsolutePercentageError += Math.abs(error / actualValue) * 100;
      percentageCount += 1;
    }
  }

  const rmse = Math.sqrt(sumSquaredError / sampleSize);
  const mae = sumAbsoluteError / sampleSize;
  const mape = percentageCount > 0 ? sumAbsolutePercentageError / percentageCount : 0;
  const bias = sumBias / sampleSize;

  const meanF = average(f);
  const meanA = average(a);

  let numerator = 0;
  let varianceF = 0;
  let varianceA = 0;

  for (let i = 0; i < sampleSize; i += 1) {
    const diffF = f[i] - meanF;
    const diffA = a[i] - meanA;
    numerator += diffF * diffA;
    varianceF += diffF ** 2;
    varianceA += diffA ** 2;
  }

  const denominator = Math.sqrt(varianceF * varianceA);
  const correlation = denominator > 0 ? numerator / denominator : 0;

  return {
    rmse: round(rmse, 6),
    mae: round(mae, 6),
    mape: round(mape, 6),
    bias: round(bias, 6),
    correlation: round(correlation, 6),
    sampleSize,
    rating: getRatingFromMape(mape),
  };
}

function generateDayAheadSchedule(residualLoad, marketPrices, storageConfig) {
  const residualIntervals = Array.isArray(residualLoad) ? residualLoad : [];
  const priceMap = buildPriceMap(marketPrices);

  const hasStorage = Boolean(storageConfig);
  const capacityKwh = hasStorage ? toNumber(storageConfig.capacityKwh, 0) : 0;
  const maxChargePowerKw = hasStorage ? toNumber(storageConfig.maxChargePowerKw, 0) : 0;
  const maxDischargePowerKw = hasStorage ? toNumber(storageConfig.maxDischargePowerKw, 0) : 0;
  const efficiency = hasStorage ? clamp(toNumber(storageConfig.efficiency, 0.92), 0.5, 1) : 1;

  let socPercent = hasStorage ? clamp(toNumber(storageConfig.currentSocPercent, 50), 0, 100) : 0;
  const minSocPercent = hasStorage ? 10 : 0;
  const maxSocPercent = hasStorage ? 90 : 100;

  const schedule = [];

  let totalGridImportKwh = 0;
  let totalGridExportKwh = 0;
  let dischargeEnergyKwh = 0;
  let estimatedCostEur = 0;
  let estimatedRevenueEur = 0;
  let baselineCostEur = 0;
  let baselineRevenueEur = 0;

  for (const row of residualIntervals) {
    const ts = row?.ts;
    const residualKw = toNumber(row?.residual_kw, toNumber(row?.residualKw, 0));
    const marketPrice = getHourPrice(priceMap, ts);
    const marketPricePerKwh = marketPrice === null ? null : marketPrice / 1000;

    let storageAction = 'idle';
    let storagePowerKw = 0;
    let gridFlowKw = residualKw;

    if (hasStorage && capacityKwh > 0) {
      const availableChargeKwh = ((maxSocPercent - socPercent) / 100) * capacityKwh;
      const availableDischargeKwh = ((socPercent - minSocPercent) / 100) * capacityKwh;

      if (residualKw < 0 && availableChargeKwh > 0) {
        const chargeFromSurplusKw = Math.min(Math.abs(residualKw), maxChargePowerKw, availableChargeKwh / 0.25);
        if (chargeFromSurplusKw > 0) {
          storageAction = 'charge';
          storagePowerKw = chargeFromSurplusKw;
          const chargedKwh = chargeFromSurplusKw * 0.25 * efficiency;
          socPercent = clamp(socPercent + (chargedKwh / capacityKwh) * 100, minSocPercent, maxSocPercent);
          gridFlowKw = residualKw + chargeFromSurplusKw;
        }
      } else if (residualKw > 0 && availableDischargeKwh > 0) {
        const dischargeKw = Math.min(residualKw, maxDischargePowerKw, availableDischargeKwh / 0.25);
        if (dischargeKw > 0) {
          storageAction = 'discharge';
          storagePowerKw = dischargeKw;
          const dischargedKwh = dischargeKw * 0.25;
          socPercent = clamp(socPercent - (dischargedKwh / efficiency / capacityKwh) * 100, minSocPercent, maxSocPercent);
          gridFlowKw = residualKw - dischargeKw;
          dischargeEnergyKwh += dischargedKwh;
        }
      }
    }

    const importKwh = gridFlowKw > 0 ? gridFlowKw * 0.25 : 0;
    const exportKwh = gridFlowKw < 0 ? Math.abs(gridFlowKw) * 0.25 : 0;

    totalGridImportKwh += importKwh;
    totalGridExportKwh += exportKwh;

    const baselineImportKwh = residualKw > 0 ? residualKw * 0.25 : 0;
    const baselineExportKwh = residualKw < 0 ? Math.abs(residualKw) * 0.25 : 0;

    if (marketPricePerKwh !== null) {
      estimatedCostEur += importKwh * marketPricePerKwh;
      estimatedRevenueEur += exportKwh * marketPricePerKwh;
      baselineCostEur += baselineImportKwh * marketPricePerKwh;
      baselineRevenueEur += baselineExportKwh * marketPricePerKwh;
    }

    schedule.push({
      ts,
      residual_kw: round(residualKw, 6),
      storageAction,
      storagePower_kw: round(storagePowerKw, 6),
      gridFlow_kw: round(gridFlowKw, 6),
      soc_percent: round(socPercent, 6),
      marketPrice_eur_mwh: marketPrice,
    });
  }

  return {
    schedule,
    summary: {
      totalGridImport_kwh: round(totalGridImportKwh, 6),
      totalGridExport_kwh: round(totalGridExportKwh, 6),
      storageCycles: capacityKwh > 0 ? round(dischargeEnergyKwh / capacityKwh, 6) : 0,
      estimatedCost_eur: priceMap.size > 0 ? round(estimatedCostEur, 6) : null,
      estimatedRevenue_eur: priceMap.size > 0 ? round(estimatedRevenueEur, 6) : null,
      savingsVsNoStorage_eur:
        priceMap.size > 0
          ? round((baselineCostEur - estimatedCostEur) + (estimatedRevenueEur - baselineRevenueEur), 6)
          : null,
    },
  };
}

function optimizeStorageDispatch(residualLoad, storageConfig, marketPrices) {
  const intervals = Array.isArray(residualLoad) ? residualLoad : [];
  const normalized = intervals.map((row) => ({
    ts: row.ts,
    residual_kw: toNumber(row.residual_kw, toNumber(row.residualKw, 0)),
  }));

  const result = generateDayAheadSchedule(normalized, marketPrices || null, storageConfig || null);

  return {
    schedule: result.schedule,
    summary: result.summary,
  };
}

module.exports = {
  calculateLoadForecast,
  calculateResidualLoad,
  calculateForecastQuality,
  generateDayAheadSchedule,
  optimizeStorageDispatch,
};
