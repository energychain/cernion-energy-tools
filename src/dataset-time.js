'use strict';

const { timestampMillis } = require('./dataset-input');

function normalizeDatasetTimes(rows, field, timezone, expectedIntervalMinutes) {
  if (!field)
    return { utc: [], local: [], intervalMinutes: null, gaps: 0, duplicates: 0, transitions: [] };
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const localMillis = (instant) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value])
    );
    return Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second
    );
  };
  const offsets = new Map(),
    utc = [],
    local = [],
    transitions = [];
  let previous = -Infinity,
    previousOffset;
  for (const row of rows) {
    const original = row[field],
      wall = timestampMillis(original);
    if (wall == null) {
      utc.push(null);
      local.push(null);
      continue;
    }
    const explicit = /(?:Z|[+-]\d\d:\d\d)$/i.test(String(original));
    const day = Math.floor(wall / 86400000);
    if (!offsets.has(day))
      offsets.set(day, [
        ...new Set(
          [-86400000, 0, 86400000].map((delta) => localMillis(wall + delta) - wall - delta)
        ),
      ]);
    const candidates = explicit
      ? [wall]
      : offsets
          .get(day)
          .map((offset) => wall - offset)
          .filter((instant) => localMillis(instant) === wall)
          .sort((a, b) => a - b);
    const instant = candidates.find((candidate) => candidate > previous) ?? candidates[0];
    if (instant == null) throw new Error(`Ungültige Ortszeit ${original} in ${timezone}.`);
    const offset = localMillis(instant) - instant;
    if (previousOffset != null && offset !== previousOffset)
      transitions.push({ at: String(original), offsetMinutes: (offset - previousOffset) / 60000 });
    previousOffset = offset;
    previous = instant;
    utc.push(new Date(instant).toISOString());
    local.push(new Date(instant + offset).toISOString().slice(0, 19).replace('T', ' '));
  }
  const instants = utc.filter(Boolean).map(Date.parse),
    diffs = new Map();
  for (let i = 1; i < instants.length; i++) {
    const diff = instants[i] - instants[i - 1];
    if (diff > 0) diffs.set(diff, (diffs.get(diff) || 0) + 1);
  }
  const interval =
    expectedIntervalMinutes > 0
      ? expectedIntervalMinutes * 60000
      : [...diffs].sort((a, b) => b[1] - a[1])[0]?.[0];
  const unique = [...new Set(instants)].sort((a, b) => a - b);
  let gaps = 0;
  if (interval)
    for (let i = 1; i < unique.length; i++)
      gaps += Math.max(0, Math.round((unique[i] - unique[i - 1]) / interval) - 1);
  return {
    utc,
    local,
    intervalMinutes: interval ? interval / 60000 : null,
    gaps,
    duplicates: instants.length - unique.length,
    transitions,
  };
}

module.exports = { normalizeDatasetTimes };
