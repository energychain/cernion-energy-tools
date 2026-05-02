'use strict';

const { getObisDirection, getObisUnit } = require('./obis-codes');

function toMs(ts) {
  const date = new Date(ts);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function findGaps(timestamps, intervalSeconds = 900) {
  const intervalMs = Number(intervalSeconds) * 1000;
  const sorted = (timestamps || [])
    .map((ts) => ({ ts, ms: toMs(ts) }))
    .filter((item) => item.ms !== null)
    .sort((a, b) => a.ms - b.ms);

  if (sorted.length < 2) return [];

  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1].ms;
    const curr = sorted[i].ms;
    for (let t = prev + intervalMs; t < curr; t += intervalMs) {
      gaps.push(new Date(t).toISOString());
    }
  }

  return gaps;
}

function interpolateLinear(before, after, targetTs) {
  const tBefore = toMs(before?.ts);
  const tAfter = toMs(after?.ts);
  const tTarget = toMs(targetTs);

  if (tBefore === null || tAfter === null || tTarget === null) return null;
  if (tAfter <= tBefore) return null;

  const vBefore = Number(before?.value);
  const vAfter = Number(after?.value);
  if (!Number.isFinite(vBefore) || !Number.isFinite(vAfter)) return null;

  const ratio = (tTarget - tBefore) / (tAfter - tBefore);
  return vBefore + (vAfter - vBefore) * ratio;
}

function calculateRMSE(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return 0;

  const length = Math.min(actual.length, expected.length);
  if (length === 0) return 0;

  let sumSquared = 0;
  let used = 0;

  for (let i = 0; i < length; i += 1) {
    const a = Number(actual[i]);
    const e = Number(expected[i]);
    if (!Number.isFinite(a) || !Number.isFinite(e)) continue;

    const diff = a - e;
    sumSquared += diff * diff;
    used += 1;
  }

  if (used === 0) return 0;
  return Math.sqrt(sumSquared / used);
}

function isEnergyRegister(obis) {
  return String(obis || '').includes('.8.');
}

function isPowerRegister(obis) {
  return String(obis || '').includes('.29.');
}

function resolveCapacity(context) {
  const candidate = Number(context?.capacityKw);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

const VALIDATION_RULES = [
  {
    id: 'BANDWIDTH_CHECK',
    name: 'Bandbreiten-Prüfung',
    description: 'Wert innerhalb erwarteter Min/Max-Grenzen',
    severity: 'warning',
    autoFix: null,
    check(value, context = {}) {
      if (value === null || value === undefined || value === '') return true;

      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return false;

      const capacityKw = resolveCapacity(context);
      if (capacityKw <= 0) return true;

      const obis = String(context.obis || '');
      let min = 0;
      let max = capacityKw * 0.25 * 1.2;

      if (obis === '1-0:2.8.0') {
        max = capacityKw * 0.25 * 1.1;
      } else if (obis === '1-0:1.8.0') {
        max = capacityKw * 0.25 * 1.2;
      } else if (isPowerRegister(obis)) {
        max = capacityKw * 1.1;
      }

      return numericValue >= min && numericValue <= max;
    },
  },
  {
    id: 'GAP_DETECTION',
    name: 'Lückenerkennung',
    description: 'Erkennt fehlende Viertelstundenwerte in der Zeitreihe',
    severity: 'error',
    autoFix: 'interpolate',
    check(_value, context = {}) {
      const gaps = findGaps(context.timestamps || [], context.intervalSeconds || 900);
      return gaps.length === 0;
    },
  },
  {
    id: 'MONOTONY_CHECK',
    name: 'Monotonie-Prüfung',
    description: 'Zählerstand darf nicht sinken (außer Überlauf)',
    severity: 'error',
    autoFix: null,
    check(value, context = {}) {
      const obis = String(context.obis || '');
      if (!isEnergyRegister(obis)) return true;

      const current = Number(value);
      if (!Number.isFinite(current)) return false;

      if (!Number.isFinite(Number(context.previousValue))) return true;
      const previousValue = Number(context.previousValue);
      if (current >= previousValue) return true;

      const counterMax = Number(context.counterMax);
      const assumedMax = Number.isFinite(counterMax) && counterMax > 0 ? counterMax : 1_000_000_000;
      return previousValue >= assumedMax * 0.95 && current <= assumedMax * 0.05;
    },
  },
  {
    id: 'DUPLICATE_CHECK',
    name: 'Duplikat-Prüfung',
    description: 'Erkennt doppelte Zeitstempel pro MeLo und OBIS',
    severity: 'info',
    autoFix: 'keep_latest',
    check(_value, context = {}) {
      return context.isDuplicate !== true;
    },
  },
  {
    id: 'SLP_PLAUSIBILITY',
    name: 'SLP-Plausibilisierung',
    description: 'Vergleicht Tagesgang mit SLP-Referenzprofil per RMSE',
    severity: 'warning',
    autoFix: null,
    check(_value, context = {}) {
      const actual = context.actualValues || [];
      const expected = context.expectedValues || [];
      if (!actual.length || !expected.length) return true;

      const rmse = calculateRMSE(actual, expected);
      const mean = actual.reduce((sum, item) => sum + Number(item || 0), 0) / actual.length;
      const threshold = Number(context.threshold);
      const normalizedThreshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 0.3;

      return rmse <= Math.abs(mean) * normalizedThreshold;
    },
  },
  {
    id: 'NEGATIVE_VALUE_CHECK',
    name: 'Negativwert-Prüfung',
    description: 'Energiezählerwerte dürfen nicht negativ sein',
    severity: 'error',
    autoFix: null,
    check(value, context = {}) {
      if (value === null || value === undefined || value === '') return true;

      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return false;

      const obis = String(context.obis || '');
      const unit = context.unit || getObisUnit(obis);
      const direction = context.direction || getObisDirection(obis);

      if (unit === 'kWh' || isEnergyRegister(obis)) {
        return numericValue >= 0;
      }

      if (unit === 'kW' || isPowerRegister(obis)) {
        if (direction === 'consumption' && obis.startsWith('1-0:1.')) {
          return true;
        }
        return numericValue >= 0;
      }

      return numericValue >= 0;
    },
  },
];

module.exports = {
  VALIDATION_RULES,
  findGaps,
  interpolateLinear,
  calculateRMSE,
};
