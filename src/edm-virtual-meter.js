'use strict';

const QUARTER_HOURS_PER_DAY = 96;
const MILLIS_15_MIN = 15 * 60 * 1000;

function normalizeDayWindow(date) {
  if (typeof date !== 'string' || !date.trim()) {
    throw new Error('date is required (YYYY-MM-DD)');
  }

  const day = date.slice(0, 10);
  const from = `${day}T00:00:00.000Z`;
  const to = `${day}T23:59:59.999Z`;

  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw new Error(`Invalid date: ${date}`);
  }

  return { from, to, day };
}

function buildQuarterHourTimestamps(day) {
  const base = new Date(`${day}T00:00:00.000Z`).getTime();
  if (Number.isNaN(base)) {
    throw new Error(`Invalid day: ${day}`);
  }

  const values = [];
  for (let i = 0; i < QUARTER_HOURS_PER_DAY; i += 1) {
    values.push(new Date(base + i * MILLIS_15_MIN).toISOString());
  }
  return values;
}

function buildTimeseriesRows(timestamps, values, options = {}) {
  if (!Array.isArray(timestamps) || timestamps.length !== QUARTER_HOURS_PER_DAY) {
    throw new Error('timestamps must be an array of 96 values');
  }
  if (!Array.isArray(values) || values.length !== QUARTER_HOURS_PER_DAY) {
    throw new Error('values must be an array of 96 values');
  }

  const quality = options.quality || 'synthetic';
  const source = options.source || 'virtual:auto';

  return timestamps.map((ts, index) => {
    const numeric = Number(values[index]);
    return {
      ts,
      value: Number.isFinite(numeric) ? numeric : 0,
      quality,
      source,
    };
  });
}

function buildRowsFromSlp(day, slpValues, options = {}) {
  const timestamps = buildQuarterHourTimestamps(day);
  return buildTimeseriesRows(timestamps, slpValues, options);
}

module.exports = {
  QUARTER_HOURS_PER_DAY,
  normalizeDayWindow,
  buildQuarterHourTimestamps,
  buildTimeseriesRows,
  buildRowsFromSlp,
};
