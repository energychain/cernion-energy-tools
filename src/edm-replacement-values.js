'use strict';

const { interpolateLinear } = require('./edm-validation-rules');

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(ts) {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function buildSortedRows(rows) {
  return (rows || [])
    .map((row) => ({ ...row, _ms: toMs(row.ts), _value: Number(row.value) }))
    .filter((row) => row._ms !== null && Number.isFinite(row._value))
    .sort((a, b) => a._ms - b._ms);
}

function findNeighbors(sortedRows, targetMs) {
  let before = null;
  let after = null;

  for (const row of sortedRows) {
    if (row._ms < targetMs) before = row;
    if (row._ms > targetMs) {
      after = row;
      break;
    }
  }

  return { before, after };
}

function mapPreviousDay(previousDayData) {
  const map = new Map();
  for (const row of previousDayData || []) {
    const ms = toMs(row.ts);
    const value = Number(row.value);
    if (ms === null || !Number.isFinite(value)) continue;

    const plusOneDayIso = new Date(ms + DAY_MS).toISOString();
    map.set(plusOneDayIso, value);
  }
  return map;
}

function resolveSlpValues(slpProfile) {
  if (Array.isArray(slpProfile)) return slpProfile;
  if (Array.isArray(slpProfile?.values)) return slpProfile.values;
  return null;
}

function resolveSlpScale(slpValues, availableData) {
  if (!Array.isArray(slpValues) || slpValues.length !== 96) return 1;

  const valuesBySlot = new Map();
  for (const row of availableData || []) {
    const ms = toMs(row.ts);
    const value = Number(row.value);
    if (ms === null || !Number.isFinite(value)) continue;

    const date = new Date(ms);
    const slot = date.getUTCHours() * 4 + Math.floor(date.getUTCMinutes() / 15);
    valuesBySlot.set(slot, value);
  }

  let numerator = 0;
  let denominator = 0;

  for (const [slot, actual] of valuesBySlot.entries()) {
    const expected = Number(slpValues[slot]);
    if (!Number.isFinite(expected) || expected <= 0) continue;
    numerator += actual;
    denominator += expected;
  }

  if (denominator <= 0) return 1;
  return numerator / denominator;
}

function chooseMethodOrder(preferredMethod) {
  switch (preferredMethod) {
    case 'interpolate':
      return ['INTERPOLATE', 'ZERO'];
    case 'previous_day':
      return ['PREVIOUS_DAY', 'ZERO'];
    case 'slp':
      return ['SLP_BASED', 'ZERO'];
    default:
      return ['INTERPOLATE', 'PREVIOUS_DAY', 'SLP_BASED', 'ZERO'];
  }
}

function generateReplacementValues(gaps, context = {}) {
  const sortedAvailable = buildSortedRows(context.availableData || []);
  const previousDayMap = mapPreviousDay(context.previousDayData || []);
  const slpValues = resolveSlpValues(context.slpProfile);
  const slpScale = resolveSlpScale(slpValues, context.availableData || []);
  const preferredMethod = context.preferredMethod || 'auto';
  const methodOrder = chooseMethodOrder(preferredMethod);
  const slpMethodId = context.slpMethodId || 'slp_h0';

  const replacements = [];

  for (const gap of gaps || []) {
    const ts = typeof gap === 'string' ? gap : gap?.ts;
    const targetMs = toMs(ts);
    if (targetMs === null) continue;

    let replacement = null;

    for (const strategy of methodOrder) {
      if (strategy === 'INTERPOLATE') {
        const { before, after } = findNeighbors(sortedAvailable, targetMs);
        const interpolated = before && after
          ? interpolateLinear(
            { ts: before.ts, value: before._value },
            { ts: after.ts, value: after._value },
            ts
          )
          : null;

        if (Number.isFinite(interpolated)) {
          replacement = {
            ts,
            value: Number(interpolated.toFixed(8)),
            quality: 'interpolated',
            method: 'linear_interpolation',
            source: 'validation',
          };
        }
      }

      if (strategy === 'PREVIOUS_DAY' && !replacement) {
        const prevDayValue = previousDayMap.get(new Date(targetMs).toISOString());
        if (Number.isFinite(prevDayValue)) {
          replacement = {
            ts,
            value: Number(prevDayValue.toFixed(8)),
            quality: 'estimated',
            method: 'previous_day',
            source: 'validation',
          };
        }
      }

      if (strategy === 'SLP_BASED' && !replacement && Array.isArray(slpValues) && slpValues.length === 96) {
        const date = new Date(targetMs);
        const slot = date.getUTCHours() * 4 + Math.floor(date.getUTCMinutes() / 15);
        const base = Number(slpValues[slot]);

        if (Number.isFinite(base)) {
          replacement = {
            ts,
            value: Number((base * slpScale).toFixed(8)),
            quality: 'estimated',
            method: slpMethodId,
            source: 'validation',
          };
        }
      }

      if (strategy === 'ZERO' && !replacement) {
        replacement = {
          ts,
          value: 0,
          quality: 'estimated',
          method: 'zero_fallback',
          source: 'validation',
        };
      }

      if (replacement) break;
    }

    if (replacement) {
      replacements.push(replacement);
      sortedAvailable.push({
        ts: replacement.ts,
        value: replacement.value,
        _ms: toMs(replacement.ts),
        _value: Number(replacement.value),
      });
      sortedAvailable.sort((a, b) => a._ms - b._ms);
    }
  }

  return replacements;
}

module.exports = {
  generateReplacementValues,
  FIFTEEN_MINUTES_MS,
};
