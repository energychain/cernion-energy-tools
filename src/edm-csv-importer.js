'use strict';

function splitCsvLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current.trim());
  return values;
}

function lastSundayOfMonth(year, month) {
  const date = new Date(Date.UTC(year, month + 1, 0, 0, 0, 0));
  while (date.getUTCDay() !== 0) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.getUTCDate();
}

function isBerlinSummerTimeLocal(year, month, day, hour) {
  if (month < 3 || month > 10) return false;
  if (month > 3 && month < 10) return true;

  const marchLastSunday = lastSundayOfMonth(year, 2);
  const octoberLastSunday = lastSundayOfMonth(year, 9);

  if (month === 3) {
    if (day > marchLastSunday) return true;
    if (day < marchLastSunday) return false;
    return hour >= 2;
  }

  if (month === 10) {
    if (day < octoberLastSunday) return true;
    if (day > octoberLastSunday) return false;
    return hour < 3;
  }

  return false;
}

function parseGermanDateTime(value, timezone) {
  const match = String(value || '').trim().match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;

  const utcLocalMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let offsetHours = 0;

  if (timezone === 'Europe/Berlin') {
    offsetHours = isBerlinSummerTimeLocal(year, month, day, hour) ? 2 : 1;
  }

  const utcDate = new Date(utcLocalMs - offsetHours * 60 * 60 * 1000);
  if (Number.isNaN(utcDate.getTime())) return null;
  return utcDate;
}

function parseIsoDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const localLike = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!localLike) return null;

  const year = Number(localLike[1]);
  const month = Number(localLike[2]);
  const day = Number(localLike[3]);
  const hour = Number(localLike[4]);
  const minute = Number(localLike[5]);
  const second = Number(localLike[6] || 0);

  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0));
}

function parseTimestamp(value, timestampFormat, timezone) {
  if (timestampFormat === 'DD.MM.YYYY HH:mm') {
    return parseGermanDateTime(value, timezone);
  }

  if (timestampFormat === 'ISO') {
    return parseIsoDateTime(value);
  }

  return parseGermanDateTime(value, timezone) ||
    parseIsoDateTime(value);
}

function parseValue(rawValue, decimalSeparator) {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
    return { value: null, quality: 'missing' };
  }

  const normalized = decimalSeparator === ','
    ? String(rawValue).trim().replace(',', '.')
    : String(rawValue).trim();

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return { value: null, quality: 'invalid' };
  }

  return { value: parsed, quality: 'measured' };
}

function parseCsvTimeseries(data, config = {}) {
  const options = {
    delimiter: ';',
    timestampColumn: 'Zeitstempel',
    timestampFormat: 'DD.MM.YYYY HH:mm',
    valueColumn: 'Wert_kWh',
    qualityColumn: null,
    skipRows: 0,
    timezone: 'Europe/Berlin',
    decimalSeparator: '.',
    ...config,
  };

  const delimiter = options.delimiter || ';';
  const lines = String(data || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const rows = [];
  const errors = [];

  const headerLineIndex = Math.max(0, Number(options.skipRows) || 0);
  const header = splitCsvLine(lines[headerLineIndex] || '', delimiter);
  const timestampIndex = header.indexOf(options.timestampColumn);
  const valueIndex = header.indexOf(options.valueColumn);
  const qualityIndex = options.qualityColumn ? header.indexOf(options.qualityColumn) : -1;

  if (timestampIndex < 0 || valueIndex < 0) {
    return {
      rows: [],
      errors: [{ line: headerLineIndex + 1, reason: 'Required columns not found in CSV header' }],
      stats: { total: 0, parsed: 0, skipped: 0, invalid: 0 },
    };
  }

  let total = 0;
  let parsed = 0;
  let skipped = 0;
  let invalid = 0;

  for (let i = headerLineIndex + 1; i < lines.length; i += 1) {
    const sourceLine = lines[i];
    if (!sourceLine || sourceLine.trim() === '') {
      skipped += 1;
      continue;
    }

    total += 1;
    const columns = splitCsvLine(sourceLine, delimiter);
    const timestampRaw = columns[timestampIndex];
    const timestamp = parseTimestamp(timestampRaw, options.timestampFormat || 'auto', options.timezone);

    if (!timestamp || Number.isNaN(timestamp.getTime())) {
      skipped += 1;
      errors.push({ line: i + 1, reason: `Invalid timestamp: ${timestampRaw}` });
      continue;
    }

    const valueParsed = parseValue(columns[valueIndex], options.decimalSeparator);
    const qualityFromColumn = qualityIndex >= 0 ? String(columns[qualityIndex] || '').trim() : '';
    const quality = qualityFromColumn || valueParsed.quality;

    if (quality === 'invalid') {
      invalid += 1;
    }

    rows.push({
      ts: timestamp.toISOString(),
      value: valueParsed.value,
      quality,
    });
    parsed += 1;
  }

  return {
    rows,
    errors,
    stats: {
      total,
      parsed,
      skipped,
      invalid,
    },
  };
}

module.exports = {
  parseCsvTimeseries,
};
