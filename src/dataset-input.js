'use strict';

const { parseRecords, parseCsvLine } = require('./csv-text');
const { Errors } = require('moleculer');
const { profileRows, hashValue, parseNumber, parseDate } = require('./tabular-intelligence');

function datasetSetting(name, fallback) {
  const value = Number(process.env[`WORKBENCH_DATASET_${name}`] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid dataset ${name}`);
  return value;
}

function datasetLimit(message) {
  throw new Errors.MoleculerClientError(
    `${message} Die Tabelle wurde nicht gekürzt oder gespeichert. Bitte nutze eine kleinere Datei; ein eigener Datei-Upload-Weg folgt später.`,
    422,
    'WORKBENCH_DATASET_LIMIT'
  );
}

function damagedDataset(reason) {
  throw new Errors.MoleculerClientError(
    'Die Datei kam beschädigt an; bitte lade sie erneut hoch oder schalte den Dateikanal ein.',
    422,
    'WORKBENCH_DATASET_DAMAGED',
    { reason, openWebUI: true }
  );
}

// A recognized but implausible table is refused as a normal chat response.
function unusableDataset(reason) {
  const error = new Error('Die Tabelle ist beschädigt oder unplausibel; bitte prüfe die Datei.');
  error.type = 'WORKBENCH_DATASET_UNUSABLE';
  error.data = { reason };
  throw error;
}

function tableRatio() {
  const value = Number(process.env.WORKBENCH_DATASET_MIN_TABLE_RATIO ?? 0.75);
  if (!Number.isFinite(value) || value <= 0.5 || value > 1)
    throw new Error('Invalid dataset MIN_TABLE_RATIO');
  return value;
}

// Shared by table input and cleanup of previously accepted catalog records.
function datasetPlausibility(record, rows) {
  const columns = record.columns || record.profile?.columns || [];
  const count = record.rowCount ?? rows?.length ?? 0;
  const threshold = Number(process.env.WORKBENCH_DATASET_MAX_EMPTY_RATIO ?? 0.5);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('Invalid dataset MAX_EMPTY_RATIO');
  if (!columns.length || !count) return 'Datensatz enthält keine verwendbare Tabelle.';
  if (columns.some((column) => !String(column.name ?? '').trim() || /^none$/i.test(column.name)))
    return 'Spaltennamen fehlen oder enthalten Restfelder.';
  if (rows && record.rowCount != null && rows.length !== record.rowCount)
    return 'Die gespeicherten Zeilen stimmen nicht mit dem Katalog überein.';
  const missing = rows
    ? rows.reduce(
        (sum, row) =>
          sum +
          columns.filter(
            (column) => row[column.name] == null || String(row[column.name]).trim() === ''
          ).length,
        0
      )
    : columns.reduce((sum, column) => sum + (column.nullCount || 0), 0);
  if (missing / (count * columns.length) > threshold) {
    // Larger exports often include columns that are empty in every row. They hold no
    // information and must not count as damage; tiny tables keep the strict rule.
    const empty = emptyColumnNames(columns, rows, count);
    const filled = columns.length - empty.length;
    const minRows = datasetSetting('EMPTY_COLUMN_MIN_ROWS', 10);
    if (
      count < minRows ||
      filled < 2 ||
      (missing - empty.length * count) / (count * filled) > threshold
    )
      return 'Der Anteil leerer Werte ist zu hoch.';
  }
  if (rows?.some((row) => Object.values(row).some(truncatedDatasetValue)))
    return 'Zahlen oder Restfelder sind abgeschnitten.';
  return null;
}

function emptyColumnNames(columns, rows, count) {
  return columns
    .filter((column) =>
      rows
        ? rows.every((row) => row[column.name] == null || String(row[column.name]).trim() === '')
        : (column.nullCount || 0) >= count
    )
    .map((column) => column.name);
}

function truncatedDatasetValue(value) {
  const text = String(value ?? '').trim();
  return (
    /^None\s*:/i.test(text) ||
    /^[+-]?\d+[.,]$/.test(text) ||
    /^[+-]?\d+(?:[.,]\d+)?e[+-]?$/i.test(text)
  );
}

function restoreDelimitedPairs(raw) {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const boundary = lines[0]?.indexOf(':') ?? -1;
  const header = boundary >= 0 ? lines[0].slice(0, boundary) : '';
  // Only the repeated header-before-colon pattern proves the loader split a CSV.
  // A lone labelled line or orphan None field provides no such evidence.
  const records = lines.filter((line) => !/^\s*None\s*:/i.test(line));
  if (
    !header.includes(';') ||
    records.length < 2 ||
    records.some((line) => !line.startsWith(header + ':'))
  )
    return raw;
  const names = header.split(';');
  if (names.some((name) => !name.trim() || /[",]/.test(name)))
    damagedDataset('Mehrdeutige Kopfzeile');
  const values = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(header + ':')) damagedDataset('Uneinheitliche zerlegte Zeile');
    let value = lines[i].slice(header.length + 1).replace(/^ /, '');
    if (value.split(';').length !== names.length || /[",]/.test(value))
      damagedDataset('Mehrdeutige zerlegte Felder');
    if (/^\s*None\s*:/i.test(lines[i + 1] || '')) {
      const rest = lines[++i].replace(/^\s*None\s*:\s*/i, '').trim();
      const fraction = /^\[(['"])\d+\1\]$/.test(rest) ? rest.slice(2, -2) : rest;
      if (!/^\d+$/.test(fraction) || !/^[+-]?\d+$/.test(value.split(';').at(-1)))
        damagedDataset('Restfeld kann nicht verlustfrei zugeordnet werden');
      value += ',' + fraction;
    }
    values.push(value);
  }
  return [header, ...values].join('\n');
}

function matrixRows(matrix) {
  const nonempty = matrix.filter((row) => row.some((cell) => String(cell ?? '').trim()));
  const headerIndex =
    nonempty[0]?.length >= 2
      ? 0
      : nonempty.findIndex((row) => row.filter((cell) => String(cell ?? '').trim()).length >= 2);
  if (headerIndex < 0 || nonempty.length < headerIndex + 3) return null;
  const width = nonempty[headerIndex].length;
  const matching = nonempty.slice(headerIndex + 1).filter((row) => row.length === width);
  if (matching.length < 2 || (matching.length + 1) / nonempty.length < tableRatio()) return null;
  let header = nonempty[headerIndex].map((cell) => String(cell ?? '').trim());
  if (header.some((name) => !name || /^none$/i.test(name)))
    unusableDataset('Ungültige Spaltennamen');
  let start = headerIndex + 1;
  // A second header carrying units is joined to the column label.
  if (nonempty[start]?.some((cell) => /^\s*[[(][^\])]+[\])]\s*$/.test(String(cell)))) {
    header = header.map((name, i) => `${name} ${nonempty[start][i] || ''}`.trim());
    start++;
  }
  if (header.length > datasetSetting('MAX_COLUMNS', 128)) datasetLimit('Zu viele Spalten.');
  const names = header;
  if (new Set(names).size !== names.length) throw new Error('Mehrdeutige doppelte Spaltennamen.');
  const body = nonempty.slice(start);
  if (body.length < 2 || body.some((row) => row.length !== names.length)) return null;
  if (body.length > datasetSetting('MAX_ROWS', 50000)) datasetLimit('Zu viele Zeilen.');
  if (
    body.some(
      (row) => row.length > names.length && row.slice(names.length).some((cell) => cell !== '')
    )
  )
    throw new Error('Die Zeilen haben mehr Felder als die Kopfzeile.');
  const rows = body.map((row) =>
    Object.fromEntries(names.map((name, i) => [name, row[i] ?? null]))
  );
  const profile = profileRows(rows);
  const damage = datasetPlausibility({ profile }, rows);
  if (damage) unusableDataset(damage);
  if (!rows.length) return null;
  // Canonical typed cells make CSV, Markdown and key/value representations identical.
  for (const row of rows)
    for (const column of profile.columns) {
      const value = row[column.name];
      row[column.name] =
        value == null || String(value).trim() === ''
          ? null
          : column.type === 'number'
            ? parseNumber(value)
            : String(value).trim();
    }
  const finalProfile = profileRows(rows);
  const emptyColumns = emptyColumnNames(finalProfile.columns, rows, rows.length);
  return {
    rows,
    profile: finalProfile,
    hash: hashValue(rows),
    ...(emptyColumns.length ? { emptyColumns } : {}),
  };
}

function parseDatasetText(text, name = 'Tabelle') {
  try {
    return parseTableText(text, name);
  } catch (error) {
    if (
      [
        'WORKBENCH_DATASET_DAMAGED',
        'WORKBENCH_DATASET_UNUSABLE',
        'WORKBENCH_DATASET_LIMIT',
      ].includes(error.type)
    )
      throw error;
    return [];
  }
}

function parseTableText(text, name) {
  const source = String(text || '')
    .trim()
    .replace(/^\uFEFF/, '');
  const raw = restoreDelimitedPairs(source);
  const sheetMarkers = [
    ...raw.matchAll(/^(?:#{1,3}\s*)?(?:Sheet|Blatt|Worksheet)\s*[:：]\s*(.+)$/gim),
  ];
  if (sheetMarkers.length) {
    const tables = sheetMarkers.flatMap((marker, i) =>
      parseDatasetText(
        raw.slice(marker.index + marker[0].length, sheetMarkers[i + 1]?.index),
        name
      ).map((table) => ({ ...table, sheet: marker[1].trim() }))
    );
    if (tables.length && Buffer.byteLength(raw) > datasetSetting('MAX_BYTES', 8000000))
      datasetLimit('Die Datei überschreitet das Bytebudget.');
    return tables;
  }
  // Probe the shape before imposing table-specific limits on ordinary documents.
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const markdown = lines.findIndex((line) => /^\s*\|?\s*:?-{3,}/.test(line));
  const pairs = lines.filter((line) => /^\s*[^:;|\t]+:\s*.+/.test(line));
  const delimited = lines.slice(0, 10).find((line) => /[;\t]|^[^,]+,[^,]+/.test(line));
  if (markdown < 1 && pairs.length < 2 && !delimited) return [];
  let matrix;
  let labelledRecords = false;
  if (markdown >= 1) {
    const cells = (line) =>
      line
        .trim()
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replace(/\\\|/g, '|'));
    matrix = [cells(lines[markdown - 1]), ...lines.slice(markdown + 1).map(cells)];
  } else if (pairs.length >= 2 && /^\s*[^:;|\t]+:\s*/.test(lines[0])) {
    const records = [];
    let record = {};
    for (const line of lines.flatMap((line) => line.split(/;\s*(?=[^:;]+:\s*)/))) {
      const match = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      if (Object.hasOwn(record, key)) {
        records.push(record);
        record = {};
      }
      record[key] = match[2].trim();
    }
    if (Object.keys(record).length) records.push(record);
    // A single labelled block can be correspondence metadata, rather than a table.
    if (records.length < 2 || pairs.length / lines.length < tableRatio()) return [];
    const keys = Object.keys(records[0]);
    if (
      keys.length < 2 ||
      records.some(
        (row) =>
          Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))
      )
    )
      return [];
    labelledRecords = true;
    const names = [...new Set(records.flatMap(Object.keys))];
    matrix = [names, ...records.map((row) => names.map((key) => row[key] ?? null))];
  } else {
    if (!delimited) return [];
    const records = parseRecords(raw);
    // Score every delimiter: a weak parse that turns the real header into a
    // dropped row or a data row into the header must not win by list order.
    let best = null;
    let failure = null;
    for (const delimiter of [';', '\t', ',']) {
      let candidate;
      try {
        candidate = matrixRows(records.map((line) => parseCsvLine(line, delimiter)));
      } catch (error) {
        failure ||= error;
        continue;
      }
      if (!candidate) continue;
      const score = [candidate.rows.length, candidate.profile.columns.length];
      if (
        !best ||
        score[0] > best.score[0] ||
        (score[0] === best.score[0] && score[1] > best.score[1])
      )
        best = { candidate, score };
    }
    if (!best) {
      if (failure) throw failure;
      return [];
    }
    if (Buffer.byteLength(raw) > datasetSetting('MAX_BYTES', 8000000))
      datasetLimit('Die Datei überschreitet das Bytebudget.');
    return [{ ...best.candidate, name, sheet: 'Sheet1' }];
  }
  const parsed = matrixRows(matrix);
  // Uniform labelled prose alone does not prove a table. The established pair
  // representation requires a measurable column, rather than only metadata.
  if (
    labelledRecords &&
    parsed &&
    !parsed.profile.columns.some((column) => column.type === 'number' && !column.sensitive)
  )
    return [];
  if (parsed && Buffer.byteLength(raw) > datasetSetting('MAX_BYTES', 8000000))
    datasetLimit('Die Datei überschreitet das Bytebudget.');
  return parsed ? [{ ...parsed, name, sheet: 'Sheet1' }] : [];
}

function disposableDataset(table, question) {
  return (
    table.rows.length < datasetSetting('DISPOSABLE_ROWS', 20) &&
    !table.profile.columns.some(
      (column) =>
        column.type === 'timestamp' ||
        column.sensitive ||
        (column.distinctRatio === 1 && /kennung|nummer|code/i.test(column.name))
    ) &&
    /\?|rechne|berechne|summe|mittel/i.test(question) &&
    !/ablegen|speichern|merken|fassung/i.test(question)
  );
}

function timestampMillis(value) {
  const raw = String(value || '');
  const dottedDate = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dottedDate || iso) {
    const parts = dottedDate
      ? [+dottedDate[3], +dottedDate[2], +dottedDate[1]]
      : [+iso[1], +iso[2], +iso[3]];
    const calendar = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (
      calendar.getUTCFullYear() !== parts[0] ||
      calendar.getUTCMonth() + 1 !== parts[1] ||
      calendar.getUTCDate() !== parts[2]
    )
      throw new Error('Ungültiges Kalenderdatum in der Tabelle.');
    const suffix = raw.slice((dottedDate || iso)[0].length);
    const clock = suffix.match(/^(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,3}))?)?)?$/);
    if (clock) {
      const hour = Number(clock[1] || 0),
        minute = Number(clock[2] || 0),
        second = Number(clock[3] || 0);
      if (hour > 23 || minute > 59 || second > 59)
        throw new Error('Ungültige Uhrzeit in der Tabelle.');
      // Floating wall clocks are independent of the server timezone. Explicit
      // offsets continue through the shared parser and retain their instant.
      return Date.UTC(
        parts[0],
        parts[1] - 1,
        parts[2],
        hour,
        minute,
        second,
        Number((clock[4] || '').padEnd(3, '0'))
      );
    }
  }
  return parseDate(value)?.getTime() ?? null;
}

module.exports = {
  parseDatasetText,
  disposableDataset,
  datasetSetting,
  datasetLimit,
  timestampMillis,
  datasetPlausibility,
  damagedDataset,
};
