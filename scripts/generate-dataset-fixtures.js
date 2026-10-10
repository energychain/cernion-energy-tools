'use strict';

const fs = require('node:fs');
const path = require('node:path');

function generateDatasetFixture(format = 'csv', corrected = false) {
  const headers = ['Zeitstempel (Beginn)', 'Wirkleistung Bezug [kW]'];
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const rows = [];
  const missing = new Set([
    '12.03.2025 09:00',
    '12.03.2025 09:15',
    '03.07.2025 14:30',
    '20.11.2025 02:45',
  ]);
  const peak = '14.01.2025 18:15';
  let sumTenths = 0;
  for (
    let instant = Date.parse('2024-12-31T23:00:00Z');
    instant < Date.parse('2025-12-31T23:00:00Z');
    instant += 900000
  ) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value])
    );
    const local = `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
    let value = missing.has(local) ? null : local === peak ? 12437 : 3971;
    if (value != null) sumTenths += value;
    rows.push([local, value]);
  }
  // Integer tenth-kW arithmetic: 3,478.874 MWh / .25h * 1000 * 10.
  const target = 139154960;
  let remainder = target - sumTenths;
  for (const row of rows) {
    if (row[1] == null || row[0] === peak) continue;
    const adjustment = Math.max(-1, Math.min(1, remainder));
    row[1] += adjustment;
    remainder -= adjustment;
    if (!remainder) break;
  }
  if (remainder) throw new Error('Synthetic fixture adjustment exceeds capacity');
  if (corrected) rows[0][1] += 10;
  const value = (number) => (number == null ? '' : (number / 10).toFixed(1).replace('.', ','));
  if (format === 'markdown')
    return `| ${headers.join(' | ')} |\n| --- | --- |\n${rows.map((row) => `| ${row[0]} | ${value(row[1])} |`).join('\n')}`;
  if (format === 'pairs')
    return rows
      .map((row) => `${headers[0]}: ${row[0]}\n${headers[1]}: ${value(row[1])}`)
      .join('\n\n');
  return `${headers.join(';')}\n${rows.map((row) => `${row[0]};${value(row[1])}`).join('\n')}`;
}

function fixtureManifest() {
  return {
    synthetic: true,
    generator: 'scripts/generate-dataset-fixtures.js',
    rows: 35040,
    peakKW: 1243.7,
    peakLocal: '14.01.2025 18:15',
    energyMWh: 3478.874,
    missingValues: 4,
    timezone: 'Europe/Berlin',
    formats: ['csv', 'markdown', 'pairs'],
  };
}

if (require.main === module) {
  const destination = path.join(__dirname, '../tests/fixtures/dataset-reference.generated.json');
  const output = JSON.stringify(fixtureManifest(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== output)
      process.exitCode = 1;
  } else fs.writeFileSync(destination, output);
}

module.exports = { generateDatasetFixture, fixtureManifest };
