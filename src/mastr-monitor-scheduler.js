'use strict';

/**
 * MaStR Monitor — Scheduler / cron matcher
 * Determines whether a watch is due to run based on its schedule config
 * and optional last-run timestamp.
 */

const PRESETS = {
  daily_morning: '0 6 * * *',
  weekday_morning: '0 6 * * 1-5',
  weekly_monday: '0 6 * * 1',
  monthly_first: '0 6 1 * *',
};

/** Debounce: skip if last run was within the same hour */
const DEBOUNCE_MS = 60 * 60 * 1000;

/**
 * Resolve a preset name to its cron expression.
 * Throws if preset is unknown.
 * @param {string} preset
 * @returns {string}
 */
function resolvePreset(preset) {
  const expr = PRESETS[preset];
  if (!expr) {
    throw new Error(`Unknown schedule preset: "${preset}"`);
  }
  return expr;
}

/**
 * Parse a 5-field cron expression into its parts.
 * @param {string} expr  e.g. "0 6 * * 1-5"
 * @returns {{ minute: string, hour: string, dayOfMonth: string, month: string, dayOfWeek: string }}
 */
function parseCronExpression(expr) {
  const parts = String(expr || '')
    .trim()
    .split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (must have 5 fields): "${expr}"`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/**
 * Check whether a single cron field matches the given numeric value.
 * Supports: wildcard (*), exact number, range (1-5), comma list (1,3,5).
 * @param {string} field
 * @param {number} value
 * @returns {boolean}
 */
function matchField(field, value) {
  if (field === '*') return true;

  const str = String(field);

  // comma-separated list
  if (str.includes(',')) {
    return str.split(',').some((part) => matchField(part.trim(), value));
  }

  // range "a-b"
  if (str.includes('-')) {
    const [lo, hi] = str.split('-').map(Number);
    return value >= lo && value <= hi;
  }

  // exact
  return Number(str) === value;
}

/**
 * Determine whether a watch schedule is due to fire right now.
 *
 * @param {object} schedule   Watch schedule config { type, expression?, preset?, timezone? }
 * @param {string|null} lastRun  ISO timestamp of last execution (or null)
 * @param {Date}   [now]      Injection point for testing (default: new Date())
 * @returns {boolean}
 */
function isDue(schedule, lastRun, now = new Date()) {
  if (!schedule) return false;

  // Debounce: if last run was within the past hour, skip
  if (lastRun) {
    const lastMs = Date.parse(lastRun);
    if (!Number.isNaN(lastMs) && now.getTime() - lastMs < DEBOUNCE_MS) {
      return false;
    }
  }

  // Resolve cron expression
  let expression;
  try {
    if (schedule.type === 'preset') {
      expression = resolvePreset(schedule.preset);
    } else {
      expression = schedule.expression;
    }
  } catch (err) {
    process.stderr.write(
      `[mastr-monitor-scheduler] silent-catch-fallback (line 103): ${err && err.message}\n`
    );
    return false;
  }

  let fields;
  try {
    fields = parseCronExpression(expression);
  } catch (err) {
    process.stderr.write(
      `[mastr-monitor-scheduler] silent-catch-fallback (line 110): ${err && err.message}\n`
    );
    return false;
  }

  const tz = schedule.timezone || 'Europe/Berlin';

  // Get local time parts in the target timezone
  const localStr = now.toLocaleString('en-US', { timeZone: tz });
  const local = new Date(localStr);

  const minute = local.getMinutes();
  const hour = local.getHours();
  const dayOfMonth = local.getDate();
  const month = local.getMonth() + 1; // 1-based
  const dayOfWeek = local.getDay(); // 0 = Sunday

  return (
    matchField(fields.minute, minute) &&
    matchField(fields.hour, hour) &&
    matchField(fields.dayOfMonth, dayOfMonth) &&
    matchField(fields.month, month) &&
    matchField(fields.dayOfWeek, dayOfWeek)
  );
}

module.exports = {
  PRESETS,
  DEBOUNCE_MS,
  resolvePreset,
  parseCronExpression,
  matchField,
  isDue,
};
