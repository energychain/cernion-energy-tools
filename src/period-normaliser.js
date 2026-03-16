const MONTH_MAP = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function isValidIsoDate(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() + 1 === month && dt.getUTCDate() === day;
}

/**
 * Normalise a human-readable period string to an ISO date string
 * representing the start of that period.
 * Returns null if the format is not recognised.
 *
 * @param {string} value e.g. 'Feb 2026', '2026-Q2', '2026-03-15'
 * @returns {string|null}
 */
function normalisePeriod(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const monthYear = raw.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);
  if (monthYear) {
    const month = MONTH_MAP[monthYear[1].toLowerCase()];
    const year = Number(monthYear[2]);
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  const quarter = raw.match(/^(\d{4})-Q([1-4])$/i);
  if (quarter) {
    const year = Number(quarter[1]);
    const q = Number(quarter[2]);
    const month = (q - 1) * 3 + 1;
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }

  const yearMonth = raw.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    if (month < 1 || month > 12) return null;
    return `${year}-${yearMonth[2]}-01`;
  }

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (!isValidIsoDate(year, month, day)) return null;
    return raw;
  }

  return null;
}

/**
 * Detect whether a column in a set of sample rows contains
 * period-format values (not pure ISO timestamps).
 * Returns true if > 50% of non-empty values match period patterns.
 *
 * @param {Array<object>} rows
 * @param {string} columnName
 * @returns {boolean}
 */
function isPeriodColumn(rows, columnName) {
  if (!Array.isArray(rows) || rows.length === 0 || !columnName) return false;

  let nonEmpty = 0;
  let periodMatches = 0;

  for (const row of rows) {
    const value = row?.[columnName];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (!text) continue;

    nonEmpty += 1;

    const isIsoTimestamp =
      /^\d{4}-\d{2}-\d{2}(?:[t\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?(?:z|[+-]\d{2}:?\d{2})?)?$/i.test(
        text
      ) && !/^\d{4}-Q[1-4]$/i.test(text);

    if (isIsoTimestamp) continue;

    if (normalisePeriod(text)) periodMatches += 1;
  }

  if (nonEmpty === 0) return false;
  return periodMatches / nonEmpty > 0.5;
}

module.exports = {
  normalisePeriod,
  isPeriodColumn,
};
