#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { parseMscons } = require('../../src/edm-mscons-parser');
const { tokenizeSegments } = require('../../src/edifact-base');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeUnit(unit) {
  const value = String(unit || '')
    .trim()
    .toUpperCase();
  if (value === 'KWH') return 'kWh';
  if (value === 'KW') return 'kW';
  return null;
}

function isoNoMillis(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('.000Z', '+00:00');
}

function buildDataset(inputPath, seriesId) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const segments = tokenizeSegments(raw);
  if (segments.filter((segment) => segment.tag === 'UNH').length !== 1) {
    fail('MSCONS input must contain exactly one message');
  }
  for (const segment of segments) {
    if (segment.tag === 'LOC' && segment.elements?.[0]?.[0] !== '172') {
      fail('MSCONS forecast import requires LOC+172');
    }
    if (segment.tag === 'QTY') {
      const quantity = segment.elements?.[0]?.[1];
      if (!quantity?.trim() || !Number.isFinite(Number(quantity.replace(',', '.')))) {
        fail('MSCONS input contains an invalid QTY value');
      }
    }
  }
  const parsed = parseMscons(raw);
  if (parsed.parseWarnings?.length) {
    fail(`MSCONS input requires clarification: ${parsed.parseWarnings.join('; ')}`);
  }
  const locations = parsed.locations || [];
  if (locations.length !== 1) {
    fail('MSCONS input must contain exactly one LOC+172 location for forecast import');
  }
  const location = locations[0];
  const series = (location.timeseries || []).filter((item) => item.obisEquivalent);
  if (series.length !== 1) {
    fail('MSCONS input must contain exactly one supported metering timeseries');
  }
  const timeseries = series[0];
  const values = (timeseries.values || []).map((row) => {
    const unit = normalizeUnit(row.unit);
    if (!unit) fail(`Unsupported MSCONS unit: ${row.unit || 'n/a'}`);
    const from = Date.parse(row.from);
    const to = Date.parse(row.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to - from !== 15 * 60 * 1000) {
      fail('MSCONS input requires explicit 15-minute intervals, not cumulative register readings');
    }
    return {
      timestamp: isoNoMillis(row.from),
      value: row.value,
      quality: row.quality || 'unknown',
      msconsStatus: row.status || null,
    };
  });
  if (!values.length) fail('MSCONS input contains no forecast-compatible values');
  const units = new Set(values.map((_, index) => normalizeUnit(timeseries.values[index].unit)));
  if (units.size !== 1) fail('MSCONS input mixes units in one timeseries');
  const source = {
    format: 'mscons',
    messageRef: parsed.messageRef || null,
    documentNumber: parsed.documentNumber || null,
    documentDate: parsed.documentDate || null,
    sender: parsed.sender || { id: null, qualifier: null },
    receiver: parsed.receiver || { id: null, qualifier: null },
    meloId: location.meloId || null,
    locQualifier: '172',
    cciCode: timeseries.cciCode || null,
    obisEquivalent: timeseries.obisEquivalent || null,
    parseWarnings: parsed.parseWarnings || [],
  };
  return {
    series_id: seriesId || location.meloId,
    unit: [...units][0],
    timezone: 'Europe/Berlin',
    value_semantics: [...units][0] === 'kW' ? 'average_power' : 'interval_energy',
    source,
    source_envelope: {
      format: 'MSCONS',
      message_ref: source.messageRef,
      document_number: source.documentNumber,
      document_date: source.documentDate,
      sender: source.sender,
      receiver: source.receiver,
      location: { melo_id: source.meloId, loc_qualifier: source.locQualifier },
      cci_code: source.cciCode,
      obis: source.obisEquivalent,
      parse_warnings: source.parseWarnings,
    },
    values,
  };
}

if (process.argv.length < 3 || process.argv.length > 4) {
  fail('Usage: mscons_dataset.js input.mscons [series-id]');
}

try {
  process.stdout.write(JSON.stringify(buildDataset(process.argv[2], process.argv[3] || null)));
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
