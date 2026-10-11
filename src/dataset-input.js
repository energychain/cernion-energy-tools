'use strict';

const XLSX = require('xlsx');
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
    { reason }
  );
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
  if (missing / (count * columns.length) > threshold) return 'Der Anteil leerer Werte ist zu hoch.';
  if (rows?.some((row) => Object.values(row).some(truncatedDatasetValue)))
    return 'Zahlen oder Restfelder sind abgeschnitten.';
  return null;
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
  if (!header.includes(';')) {
    if (lines.some((line) => /^\s*None\s*:/i.test(line)))
      damagedDataset('Restfeld ohne eindeutige Kopfzeile');
    return raw;
  }
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
  if (headerIndex < 0 || nonempty.length < headerIndex + 2) return null;
  let header = nonempty[headerIndex].map((cell) => String(cell ?? '').trim());
  if (header.some((name) => !name || /^none$/i.test(name)))
    damagedDataset('Ungültige Spaltennamen');
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
  if (damage) damagedDataset(damage);
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
  return { rows, profile: profileRows(rows), hash: hashValue(rows) };
}

function parseDatasetText(text, name = 'Tabelle') {
  const source = String(text || '')
    .trim()
    .replace(/^\uFEFF/, '');
  const raw = restoreDelimitedPairs(source);
  const sheetMarkers = [
    ...raw.matchAll(/^(?:#{1,3}\s*)?(?:Sheet|Blatt|Worksheet)\s*[:：]\s*(.+)$/gim),
  ];
  if (sheetMarkers.length)
    if (Buffer.byteLength(raw) > datasetSetting('MAX_BYTES', 8000000))
      datasetLimit('Die Datei überschreitet das Bytebudget.');
  if (sheetMarkers.length)
    return sheetMarkers.flatMap((marker, i) =>
      parseDatasetText(
        raw.slice(marker.index + marker[0].length, sheetMarkers[i + 1]?.index),
        name
      ).map((table) => ({ ...table, sheet: marker[1].trim() }))
    );
  // Probe the shape before imposing table-specific limits on ordinary documents.
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const markdown = lines.findIndex((line) => /^\s*\|?\s*:?-{3,}/.test(line));
  const pairs = lines.filter((line) => /^\s*[^:;|\t]+:\s*.+/.test(line));
  const delimited = lines.slice(0, 10).find((line) => /[;\t]|^[^,]+,[^,]+/.test(line));
  if (markdown < 1 && pairs.length < 2 && !delimited) return [];
  if (Buffer.byteLength(raw) > datasetSetting('MAX_BYTES', 8000000))
    datasetLimit('Die Datei überschreitet das Bytebudget.');
  let matrix;
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
    if (records.length < 2) return [];
    const names = [...new Set(records.flatMap(Object.keys))];
    matrix = [names, ...records.map((row) => names.map((key) => row[key] ?? null))];
  } else {
    if (!delimited) return [];
    const workbook = XLSX.read(raw, {
      type: 'string',
      raw: true,
      FS: delimited.includes(';') ? ';' : delimited.includes('\t') ? '\t' : ',',
    });
    return workbook.SheetNames.flatMap((sheet) => {
      const parsed = matrixRows(
        XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, raw: true, defval: null })
      );
      return parsed ? [{ ...parsed, name, sheet }] : [];
    });
  }
  const parsed = matrixRows(matrix);
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
