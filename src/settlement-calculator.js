'use strict';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(toNumber(value) * factor) / factor;
}

function toIsoHour(ts) {
  const date = new Date(ts);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function toTsMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!row?.ts) continue;
    map.set(new Date(row.ts).toISOString(), toNumber(row.value));
  }
  return map;
}

function toPriceMap(marketPrices) {
  const map = new Map();
  for (const item of marketPrices || []) {
    const hour = item?.hour || item?.timestamp || item?.ts;
    if (!hour) continue;
    map.set(toIsoHour(hour), toNumber(item.price_eur_mwh ?? item.price));
  }
  return map;
}

function getEventRows(rowsMap, from, to) {
  const selected = [];
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();

  for (const [ts, value] of rowsMap.entries()) {
    const tsMs = new Date(ts).getTime();
    if (tsMs >= fromMs && tsMs < toMs) {
      selected.push({ ts, value });
    }
  }

  return selected.sort((a, b) => a.ts.localeCompare(b.ts));
}

function average(values, fallback = 0) {
  if (!values.length) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calcCompensationByMethod(marketCompensation, eegMinimumCompensation, compensationMethod) {
  if (compensationMethod === 'market_price') {
    return { value: marketCompensation, method: 'market_price' };
  }
  if (compensationMethod === 'eeg_minimum') {
    return { value: eegMinimumCompensation, method: 'eeg_minimum' };
  }
  if (eegMinimumCompensation > marketCompensation) {
    return { value: eegMinimumCompensation, method: 'eeg_minimum' };
  }
  return { value: marketCompensation, method: 'market_price' };
}

function calculateRedispatchCompensation(
  curtailmentEvents,
  forecastData,
  actualData,
  marketPrices
) {
  const forecastMap = toTsMap(forecastData || []);
  const actualMap = toTsMap(actualData || []);
  const marketPriceMap = toPriceMap(marketPrices || []);
  const defaultMarketPrice = average([...marketPriceMap.values()], 50);

  const events = (curtailmentEvents || []).map((event) => {
    const from = event.start || event.from;
    const to = event.end || event.to;

    const forecastRows = getEventRows(forecastMap, from, to);
    const actualRows = getEventRows(actualMap, from, to);

    const actualByTs = new Map(actualRows.map((row) => [row.ts, row.value]));

    let forecastKwh = 0;
    let actualKwh = 0;
    let lostKwh = 0;
    let weightedPrice = 0;

    for (const row of forecastRows) {
      const actualValue = actualByTs.has(row.ts) ? actualByTs.get(row.ts) : 0;
      const diff = Math.max(0, row.value - actualValue);
      const priceHour = toIsoHour(row.ts);
      const priceEurMwh = marketPriceMap.has(priceHour)
        ? marketPriceMap.get(priceHour)
        : defaultMarketPrice;

      forecastKwh += row.value;
      actualKwh += actualValue;
      lostKwh += diff;
      weightedPrice += priceEurMwh * diff;
    }

    const avgEventMarketPriceEurMwh = lostKwh > 0 ? weightedPrice / lostKwh : defaultMarketPrice;
    const marketCompensation = lostKwh * (avgEventMarketPriceEurMwh / 1000);

    const eegTariff = toNumber(event.eegTariff_cent_kwh);
    const eegMinimumCompensation = lostKwh * (eegTariff / 100);

    const compensation = calcCompensationByMethod(
      marketCompensation,
      eegMinimumCompensation,
      event.compensationMethod || 'actual_loss'
    );

    return {
      installationMastrNummer: event.installationMastrNummer,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      duration_h: round((new Date(to).getTime() - new Date(from).getTime()) / 3600000, 4),
      forecast_kwh: round(forecastKwh, 4),
      actual_kwh: round(actualKwh, 4),
      lost_kwh: round(lostKwh, 4),
      marketPrice_eur_mwh: round(avgEventMarketPriceEurMwh, 4),
      eegTariff_cent_kwh: round(eegTariff, 4),
      compensation_eur: round(compensation.value, 2),
      method: compensation.method,
      calculation:
        `lost_kwh(${round(lostKwh, 4)}) * market_price(${round(avgEventMarketPriceEurMwh, 4)}/1000)` +
        `; eeg_min=${round(eegMinimumCompensation, 2)}; method=${compensation.method}`,
    };
  });

  const totalLostKwh = events.reduce((sum, item) => sum + toNumber(item.lost_kwh), 0);
  const totalCompensation = events.reduce((sum, item) => sum + toNumber(item.compensation_eur), 0);

  return {
    events,
    summary: {
      totalEvents: events.length,
      totalLostKwh: round(totalLostKwh, 4),
      totalCompensation_eur: round(totalCompensation, 2),
      avgMarketPrice_eur_mwh: round(defaultMarketPrice, 4),
      period: {
        from: events[0]?.from || null,
        to: events.length ? events[events.length - 1].to : null,
      },
    },
  };
}

function calculateEegRevenue(feedinData, tariffCentPerKwh, periodDays) {
  const rows = Array.isArray(feedinData) ? feedinData : [];
  const feedinKwh = rows.reduce((sum, row) => sum + Math.max(0, toNumber(row.value)), 0);
  const revenueEur = feedinKwh * (toNumber(tariffCentPerKwh) / 100);
  const days = Math.max(1, toNumber(periodDays));

  return {
    feedinKwh: round(feedinKwh, 4),
    tariffCentPerKwh: toNumber(tariffCentPerKwh),
    revenue_eur: round(revenueEur, 2),
    period: {
      from: rows[0]?.ts || null,
      to: rows[rows.length - 1]?.ts || null,
    },
    dailyAvgKwh: round(feedinKwh / days, 4),
    monthlyEstimate_eur: round((revenueEur / days) * 30, 2),
  };
}

function prepareA96Export(compensationResult, installationData = {}) {
  const events = compensationResult?.events || [];

  return events.map((event, index) => ({
    rowId: index + 1,
    format: 'A96',
    mastrNummer: installationData.mastrNummer || event.installationMastrNummer || null,
    meloId: installationData.meloId || null,
    from: event.from,
    to: event.to,
    forecast_kwh: event.forecast_kwh,
    actual_kwh: event.actual_kwh,
    lost_kwh: event.lost_kwh,
    marketPrice_eur_mwh: event.marketPrice_eur_mwh,
    eegTariff_cent_kwh: event.eegTariff_cent_kwh,
    compensation_eur: event.compensation_eur,
    method: event.method,
  }));
}

module.exports = {
  calculateRedispatchCompensation,
  calculateEegRevenue,
  prepareA96Export,
};
