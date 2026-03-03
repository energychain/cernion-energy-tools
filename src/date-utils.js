/**
 * Date Utilities — relative date alias resolution
 *
 * Resolves human-friendly date aliases to ISO 8601 YYYY-MM-DD strings so that
 * API consumers (e.g. Power Automate flows, dashboards) can use natural
 * expressions instead of hard-coded dates.
 *
 * Supported aliases (case-insensitive):
 *
 *   today         → current date  (YYYY-MM-DD in UTC)
 *   yesterday     → today - 1 day
 *   tomorrow      → today + 1 day
 *   today+N       → today + N days  (e.g. "today+2", "today+30")
 *   today-N       → today - N days  (e.g. "today-7", "today-90")
 *
 * Any other value is returned unchanged (assumed to be a literal YYYY-MM-DD).
 *
 * Examples:
 *   resolveDateAlias('today')      → '2026-03-03'
 *   resolveDateAlias('today+2')    → '2026-03-05'
 *   resolveDateAlias('today-7')    → '2026-02-24'
 *   resolveDateAlias('yesterday')  → '2026-03-02'
 *   resolveDateAlias('tomorrow')   → '2026-03-04'
 *   resolveDateAlias('2026-01-01') → '2026-01-01'  (pass-through)
 */

/**
 * Add (or subtract) a number of days to/from a UTC Date.
 * @param {Date} date
 * @param {number} days
 * @returns {Date}
 */
function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Format a Date as YYYY-MM-DD (UTC).
 * @param {Date} date
 * @returns {string}
 */
function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolve a date string that may contain a relative alias.
 * Returns a YYYY-MM-DD string. Non-string / null / undefined values are
 * returned as-is so callers never have to guard before calling.
 *
 * @param {string|*} value - Date alias or literal date string
 * @returns {string|*} Resolved YYYY-MM-DD string, or the original value
 */
function resolveDateAlias(value) {
  if (!value || typeof value !== 'string') return value;

  const v = value.trim().toLowerCase();

  // Build today in UTC (no time component)
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (v === 'today') return toISODate(today);
  if (v === 'yesterday') return toISODate(addDays(today, -1));
  if (v === 'tomorrow') return toISODate(addDays(today, 1));

  // today+N  /  today-N
  const match = v.match(/^today([+-]\d+)$/);
  if (match) {
    const offset = parseInt(match[1], 10);
    return toISODate(addDays(today, offset));
  }

  // Not a recognised alias — return unchanged
  return value;
}

/**
 * Convenience: resolve both dateFrom and dateTo in a params object.
 * Mutates and returns the same object.
 *
 * @param {object} params
 * @returns {object}
 */
function resolveDateParams(params) {
  if (!params || typeof params !== 'object') return params;
  if (params.dateFrom !== undefined) params.dateFrom = resolveDateAlias(params.dateFrom);
  if (params.dateTo !== undefined) params.dateTo = resolveDateAlias(params.dateTo);
  return params;
}

module.exports = { resolveDateAlias, resolveDateParams };
