'use strict';

/**
 * EV/CO2 Synthesis Adapter
 *
 * Extracted from personal-agent.service.js (Phase 3 L3-Core Entschlackung).
 * Provides the grounded reply builder for EV charging CO2 optimization results.
 * Called by the L3 layer through the generic synthesis dispatcher — the L3
 * personal-agent service itself contains no EV/CO2 domain logic.
 */

function buildGroundedReceiptReply(_message, receiptSelection, executionResult) {
  const steps = Array.isArray(executionResult?.steps) ? executionResult.steps : [];
  const co2Step = steps.find((step) => step?.action === 'energy-market.co2Intensity');
  if (!co2Step) {
    return null;
  }

  const rawResult = co2Step?.outcome?.result || co2Step?.result || null;
  const findCo2Payload = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 6) {
      return null;
    }
    if (
      value.recommendation ||
      value.bestWindow ||
      value.window ||
      value.avgCo2gPerKWh ||
      value.co2gPerKWh ||
      value.co2_intensity_gco2eq_kwh ||
      value.forecast_next_24h_gco2eq_kwh ||
      value.forecast
    ) {
      return value;
    }
    return (
      findCo2Payload(value.data, depth + 1) ||
      findCo2Payload(value.result, depth + 1) ||
      findCo2Payload(value.outcome, depth + 1)
    );
  };
  const data = findCo2Payload(rawResult);
  if (!data || typeof data !== 'object') {
    return null;
  }

  const normalizeComparableLocation = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, ' ')
      .trim();
  const promptLocationMatch = String(_message || '').match(
    /\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]+){0,2})\b/
  );
  const expectedPostalCode =
    co2Step?.params?.postalCode ||
    co2Step?.params?.postleitzahl ||
    promptLocationMatch?.[1] ||
    null;
  const expectedCity =
    co2Step?.params?.city || co2Step?.params?.location || promptLocationMatch?.[2] || null;
  const evidencePostalCode =
    data.postalCode || data.postleitzahl || data.zip || rawResult?.data?.postalCode || null;
  const evidenceCity =
    data.city ||
    data.gemeinde ||
    data.location ||
    rawResult?.data?.city ||
    rawResult?.data?.location ||
    null;
  const postalMismatch = Boolean(
    expectedPostalCode &&
    evidencePostalCode &&
    String(expectedPostalCode) !== String(evidencePostalCode)
  );
  const cityMismatch = Boolean(
    expectedCity &&
    evidenceCity &&
    normalizeComparableLocation(expectedCity) !== normalizeComparableLocation(evidenceCity)
  );

  if (postalMismatch || cityMismatch) {
    const expectedLocation = [expectedPostalCode, expectedCity].filter(Boolean).join(' ').trim();
    const evidenceLocation = [evidencePostalCode, evidenceCity].filter(Boolean).join(' ').trim();
    return [
      `Ich kann daraus keine Ladeempfehlung für ${expectedLocation || 'den angefragten Standort'} ableiten, weil die CO₂-Evidenz einen anderen Standort betrifft (${evidenceLocation || 'abweichender Standort'}).`,
      `Bitte die CO₂-/Grünstrom-Prognose für ${expectedLocation || 'den angefragten Standort'} erneut abrufen; Evidenz aus einem anderen Ort verwende ich nicht für diese Empfehlung.`,
    ].join(' ');
  }

  const parseIsoDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const extractNumeric = (item) => {
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object') return null;
    const value =
      item.gCO2eqPerKWh ??
      item.gco2eqPerKWh ??
      item.gco2eq_kwh ??
      item.gCO2eq_kWh ??
      item.co2_intensity_gco2eq_kwh ??
      item.co2gPerKWh ??
      item.avgCo2gPerKWh ??
      item.value ??
      null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const buildForecastPoints = (payload) => {
    const baseTimestamp =
      payload?.timestamp ||
      payload?.generatedAt ||
      payload?.data?.timestamp ||
      rawResult?.timestamp ||
      rawResult?.data?.timestamp ||
      null;
    const baseDate = parseIsoDate(baseTimestamp);
    const forecastCandidates = [
      payload?.forecast,
      payload?.data?.forecast,
      payload?.forecast_next_24h_gco2eq_kwh,
      payload?.data?.forecast_next_24h_gco2eq_kwh,
      payload?.forecastNext24h,
      payload?.data?.forecastNext24h,
    ].filter(Array.isArray);
    const points = [];

    forecastCandidates.forEach((forecast) => {
      forecast.forEach((item, index) => {
        const value = extractNumeric(item);
        if (value === null) return;
        const timestamp =
          typeof item === 'object'
            ? item.timestamp || item.time || item.validFrom || item.from || item.start || null
            : null;
        const date =
          parseIsoDate(timestamp) ||
          (baseDate ? new Date(baseDate.getTime() + index * 60 * 60 * 1000) : null);
        if (!date) return;
        points.push({
          start: date,
          end: parseIsoDate(
            typeof item === 'object' ? item.end || item.to || item.validTo || null : null
          ),
          value,
        });
      });
    });

    return points.sort((left, right) => left.start.getTime() - right.start.getTime());
  };

  const inferStepMs = (points) => {
    const deltas = [];
    for (let index = 1; index < points.length; index += 1) {
      const delta = points[index].start.getTime() - points[index - 1].start.getTime();
      if (delta > 0) deltas.push(delta);
    }
    if (deltas.length === 0) return 60 * 60 * 1000;
    deltas.sort((left, right) => left - right);
    return deltas[Math.floor(deltas.length / 2)] || 60 * 60 * 1000;
  };

  const deriveBestForecastWindow = (points) => {
    if (!Array.isArray(points) || points.length === 0) return null;
    const stepMs = inferStepMs(points);
    const minValue = Math.min(...points.map((point) => point.value));
    const minPoints = points.filter((point) => point.value === minValue);
    const runs = [];
    let currentRun = [];

    minPoints.forEach((point) => {
      const previous = currentRun[currentRun.length - 1];
      const contiguous =
        previous && point.start.getTime() - previous.start.getTime() <= stepMs * 1.5;
      if (!previous || contiguous) {
        currentRun.push(point);
      } else {
        runs.push(currentRun);
        currentRun = [point];
      }
    });
    if (currentRun.length > 0) runs.push(currentRun);

    const bestRun = runs.reduce((best, run) => {
      if (!best) return run;
      return run.length > best.length ? run : best;
    }, null);
    if (!bestRun || bestRun.length === 0) return null;

    const startPoint = bestRun[0];
    const lastPoint = bestRun[bestRun.length - 1];
    const end = lastPoint.end || new Date(lastPoint.start.getTime() + stepMs);
    const allValues = points.map((point) => point.value);
    return {
      start: startPoint.start,
      end,
      minValue,
      rangeMin: Math.min(...allValues),
      rangeMax: Math.max(...allValues),
    };
  };

  const berlinParts = (date) => {
    if (!date) return null;
    const parts = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
    const localAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute)
    );
    const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60000);
    return {
      date: `${parts.day}.${parts.month}.${parts.year}`,
      time: `${parts.hour}:${parts.minute}`,
      zone: offsetMinutes === 120 ? 'CEST' : offsetMinutes === 60 ? 'CET' : 'Europe/Berlin',
    };
  };

  const formatBerlinWindow = (startDate, endDate) => {
    const startParts = berlinParts(startDate);
    const endParts = berlinParts(endDate);
    if (!startParts || !endParts) return null;
    const dateSuffix =
      startParts.date === endParts.date
        ? ` (${startParts.date})`
        : ` (${startParts.date}–${endParts.date})`;
    return `${startParts.time}–${endParts.time} ${endParts.zone}${dateSuffix}`;
  };

  const formatUtcWindow = (startDate, endDate) => {
    if (!startDate || !endDate) return null;
    const formatTime = (date) => date.toISOString().slice(11, 16);
    return `${formatTime(startDate)}–${formatTime(endDate)} UTC`;
  };

  const parseRequestedKwh = (message) => {
    const match = String(message || '').match(/(\d+(?:[.,]\d+)?)\s*k\s*wh\b/i);
    if (!match) return null;
    const value = Number(match[1].replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const recommendation =
    data.recommendation && typeof data.recommendation === 'object' ? data.recommendation : data;
  const bestWindow =
    recommendation.bestWindow && typeof recommendation.bestWindow === 'object'
      ? recommendation.bestWindow
      : recommendation.window && typeof recommendation.window === 'object'
        ? recommendation.window
        : null;
  const source = data.source || data.provider || data.dataset || 'GrünstromIndex/CO₂-Prognose';
  const start = bestWindow?.start || bestWindow?.from || bestWindow?.dateFrom || null;
  const end = bestWindow?.end || bestWindow?.to || bestWindow?.dateTo || null;
  const intensity =
    bestWindow?.avgCo2gPerKWh ??
    bestWindow?.co2gPerKWh ??
    bestWindow?.co2Intensity ??
    recommendation?.avgCo2gPerKWh ??
    recommendation?.co2gPerKWh ??
    null;
  const forecastWindow = deriveBestForecastWindow(buildForecastPoints(data));
  const concreteWindow = forecastWindow
    ? formatBerlinWindow(forecastWindow.start, forecastWindow.end)
    : null;
  const utcWindow = forecastWindow
    ? formatUtcWindow(forecastWindow.start, forecastWindow.end)
    : null;
  const concreteIntensity = forecastWindow?.minValue ?? intensity;
  const requestedKwh = parseRequestedKwh(_message);
  const postalCode = co2Step?.params?.postalCode || data.postalCode || null;
  const city = co2Step?.params?.city || data.city || data.location || null;
  const location = [postalCode, city].filter(Boolean).join(' ').trim();

  const evidenceBits = [];
  if (location) {
    evidenceBits.push(`Standort ${location}`);
  }
  if (concreteWindow) {
    evidenceBits.push(`bestes Ladefenster ${concreteWindow}`);
  } else if (start || end) {
    evidenceBits.push(`bestes Ladefenster ${[start, end].filter(Boolean).join('–')}`);
  }
  if (concreteIntensity !== null && concreteIntensity !== undefined) {
    evidenceBits.push(`${concreteIntensity} g CO₂/kWh im Minimum`);
  }
  if (forecastWindow && forecastWindow.rangeMax !== forecastWindow.rangeMin) {
    evidenceBits.push(
      `Forecast-Spanne ${forecastWindow.rangeMin}–${forecastWindow.rangeMax} g CO₂/kWh`
    );
  }
  if (utcWindow) {
    evidenceBits.push(`entspricht ${utcWindow}`);
  }
  if (requestedKwh && concreteIntensity !== null && concreteIntensity !== undefined) {
    const emissionsKg = (requestedKwh * Number(concreteIntensity)) / 1000;
    if (Number.isFinite(emissionsKg)) {
      evidenceBits.push(`bei ${requestedKwh} kWh etwa ${emissionsKg.toFixed(2)} kg CO₂e`);
    }
  }

  const receiptLabel = receiptSelection?.receiptId || 'EV/CO₂-Optimierung';
  const summary =
    evidenceBits.length > 0 ? evidenceBits.join(', ') : 'Forecast erfolgreich ausgewertet';
  return `Auf Basis der Tool-Evidenz (${source}, Receipt ${receiptLabel}) empfehle ich: ${summary}. Handlungsempfehlung: Lade bevorzugt im genannten Fenster und verschiebe flexible Ladevorgänge außerhalb dieses Zeitraums nur, wenn Komfort- oder Netzrestriktionen das erzwingen. Ich stütze diese Aussage auf die ausgeführte CO₂-/Grünstrom-Prognose und nicht auf eine ungestützte Annahme.`;
}

module.exports = { buildGroundedReceiptReply };
