'use strict';

const { parseNumber } = require('./tabular-intelligence');

// Fixed numerical safeguards, independent of labels, language and subject matter.
const TOTAL_ABSOLUTE_TOLERANCE = 0.02;
const TOTAL_RELATIVE_TOLERANCE = 1e-8;
const KEY_DISTINCT_RATIO = 0.8;
const MAX_CONTROL_ROWS = 1000;
const MAX_CONTROL_BYTES = 4 * 1024 * 1024;
const blank = (value) => value == null || String(value).trim() === '';
const shape = (value) =>
  String(value)
    .replace(/\p{L}+/gu, 'L')
    .replace(/\p{N}+/gu, 'N');

function closeTotal(actual, expected) {
  return (
    Math.abs(actual - expected) <=
    Math.max(TOTAL_ABSOLUTE_TOLERANCE, Math.abs(expected) * TOTAL_RELATIVE_TOLERANCE)
  );
}

function emptyStats(fields) {
  return { count: 0, sums: fields.map(() => 0), present: fields.map(() => 0) };
}

function addStats(stats, row, fields) {
  stats.count++;
  fields.forEach((field, i) => {
    const value = parseNumber(row[field]);
    if (value != null) {
      stats.sums[i] += value;
      stats.present[i]++;
    }
  });
}

function subtractStats(after, before) {
  return {
    count: after.count - before.count,
    sums: after.sums.map((sum, i) => sum - before.sums[i]),
    present: after.present.map((count, i) => count - before.present[i]),
  };
}

function checkControl(row, fields, stats) {
  if (stats.count < 2) return null;
  const comparisons = fields.flatMap((field, i) => {
    const value = parseNumber(row[field]);
    return value == null
      ? []
      : [
          {
            field,
            expected: stats.sums[i],
            actual: value,
            delta: value - stats.sums[i],
            matched: stats.present[i] >= 2 && closeTotal(value, stats.sums[i]),
          },
        ];
  });
  const matched = comparisons.filter((item) => item.matched).length;
  // A discrepancy needs independent numerical corroboration in multiple columns.
  if (
    !comparisons.some((item) => Math.abs(item.expected) > TOTAL_ABSOLUTE_TOLERANCE) ||
    !matched ||
    (matched !== comparisons.length && (matched < 2 || matched / comparisons.length < 0.8))
  )
    return null;
  return { comparisons, matched: matched === comparisons.length, dataRows: stats.count };
}

function controlCandidate(row, columns, keyShapes, numericKeys) {
  const descriptors = columns.filter(
    (column) => column.type !== 'number' || column.sensitive || numericKeys.has(column.name)
  );
  if (!descriptors.length)
    descriptors.push(
      ...columns.filter(
        (column) => column.distinctRatio >= KEY_DISTINCT_RATIO && blank(row[column.name])
      )
    );
  if (!descriptors.length) return false;
  const filled = descriptors.filter((column) => !blank(row[column.name]));
  if (filled.length > 1 || filled.some((column) => column.type === 'timestamp')) return false;
  for (const column of filled) {
    const dominant = keyShapes.get(column.name);
    if (
      (column.sensitive || column.distinctRatio >= KEY_DISTINCT_RATIO) &&
      (!dominant || dominant === shape(row[column.name]))
    )
      return false;
  }
  return (
    descriptors.some((column) => blank(row[column.name]) && column.nullRatio < 1) ||
    filled.some((column) => keyShapes.get(column.name) !== shape(row[column.name]))
  );
}

// readRows yields { index, row }. Arrays and disk-backed streams use this same detector.
// Memory is bounded by schema width and the explicitly capped control metadata.
function detectControlRows(readRows, columns) {
  const fields = columns
    .filter((column) => column.type === 'number' && !column.sensitive)
    .map((column) => column.name);
  if (!fields.length) return [];
  const patterns = new Map();
  const numericSamples = new Map(
    columns
      .filter(
        (column) =>
          column.type === 'number' && column.nullCount && column.distinctRatio >= KEY_DISTINCT_RATIO
      )
      .map((column) => [column.name, []])
  );
  let sampled = 0;
  for (const { row } of readRows()) {
    for (const [field, values] of numericSamples) {
      const value = parseNumber(row[field]);
      if (value != null) values.push(value);
    }
    for (const column of columns.filter((entry) => entry.type !== 'number' || entry.sensitive)) {
      if (blank(row[column.name])) continue;
      if (!patterns.has(column.name)) patterns.set(column.name, new Map());
      const counts = patterns.get(column.name),
        pattern = shape(row[column.name]);
      counts.set(pattern, (counts.get(pattern) || 0) + 1);
    }
    if (++sampled >= 256) break;
  }
  const keyShapes = new Map(
    [...patterns].map(([field, counts]) => [field, [...counts].sort((a, b) => b[1] - a[1])[0][0]])
  );
  const numericKeys = new Set();
  for (const [field, values] of numericSamples) {
    if (values.length < 2 || !values.every(Number.isSafeInteger)) continue;
    const steps = new Map();
    for (let i = 1; i < values.length; i++) {
      const step = values[i] - values[i - 1];
      if (step) steps.set(step, (steps.get(step) || 0) + 1);
    }
    if (Math.max(0, ...steps.values()) / (values.length - 1) >= KEY_DISTINCT_RATIO) {
      numericKeys.add(field);
      keyShapes.set(field, shape(values[0]));
    }
  }
  const total = emptyStats(fields),
    candidates = [];
  let bytes = 0,
    end = 0;
  for (const { index, row } of readRows()) {
    end = index + 1;
    if (controlCandidate(row, columns, keyShapes, numericKeys)) {
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (candidates.length >= MAX_CONTROL_ROWS || bytes > MAX_CONTROL_BYTES) return [];
      candidates.push({ index, row, prefix: structuredClone(total) });
    } else addStats(total, row, fields);
  }
  const controls = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i],
      previous = candidates[i - 1],
      next = candidates[i + 1];
    const scopes = [
      {
        start: previous ? previous.index + 1 : 0,
        end: candidate.index,
        stats: subtractStats(candidate.prefix, previous?.prefix || emptyStats(fields)),
      },
      { start: 0, end: candidate.index, stats: candidate.prefix },
      {
        start: candidate.index + 1,
        end: next?.index ?? end,
        stats: subtractStats(next?.prefix || total, candidate.prefix),
      },
      { start: candidate.index + 1, end, stats: subtractStats(total, candidate.prefix) },
    ];
    const scope = scopes.find((entry) => checkControl(candidate.row, fields, entry.stats));
    if (scope)
      controls.push({
        rowNumber: candidate.index + 2,
        index: candidate.index,
        row: candidate.row,
        start: scope.start,
        end: scope.end,
        ...checkControl(candidate.row, fields, scope.stats),
      });
  }
  if (!controls.length) return [];
  // Put unproven sparse rows back into the numerical evidence before accepting any exclusion.
  const excluded = new Set(controls.map((entry) => entry.index));
  const boundaries = new Set(controls.flatMap((entry) => [entry.start, entry.end]));
  const snapshots = new Map(),
    verified = emptyStats(fields);
  for (const { index, row } of readRows()) {
    if (boundaries.has(index)) snapshots.set(index, structuredClone(verified));
    if (!excluded.has(index)) addStats(verified, row, fields);
  }
  snapshots.set(end, structuredClone(verified));
  for (const entry of controls) {
    const check = checkControl(
      entry.row,
      fields,
      subtractStats(snapshots.get(entry.end), snapshots.get(entry.start))
    );
    if (!check) return []; // Ambiguous dependencies: retain all rows as data.
    Object.assign(entry, check);
  }
  return controls;
}

function separateControlRows(rows, columns) {
  const controls = detectControlRows(function* () {
    for (const [index, row] of rows.entries()) yield { index, row };
  }, columns);
  const excluded = new Set(controls.map((entry) => entry.index));
  return { rows: rows.filter((_row, index) => !excluded.has(index)), controls };
}

function controlConfirmation(controls = []) {
  if (!controls.length) return '';
  return `${controls.length} Summenzeilen wurden als Kontrollsummen ausgeschlossen. ${
    controls.every((entry) => entry.matched)
      ? 'Summen stimmen mit der Datei überein.'
      : 'Kontrollsummen weichen von den Datensummen ab; bitte die Datei prüfen.'
  }`;
}

function datasetSheetTitle(title, sheet, explicit = sheet !== 'Sheet1') {
  return explicit && sheet ? `${title} – Blatt ${sheet}` : title;
}

module.exports = {
  MAX_CONTROL_ROWS,
  detectControlRows,
  separateControlRows,
  controlConfirmation,
  datasetSheetTitle,
  closeTotal,
  KEY_DISTINCT_RATIO,
  TOTAL_ABSOLUTE_TOLERANCE,
  TOTAL_RELATIVE_TOLERANCE,
};
