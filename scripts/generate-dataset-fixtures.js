'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function generateDatasetFixture(format = 'csv', corrected = false) {
  if (format === 'openwebui') {
    const csv = generateDatasetFixture('csv', corrected);
    // Reproduce the actual wrong delimiter used by the Python CSV loader.
    const result = spawnSync(
      '/usr/bin/python3',
      [
        '-c',
        `import csv, sys
for row in csv.DictReader(sys.stdin, delimiter=','):
    for key, value in row.items():
        if key is None:
            value = ', '.join(value)
        print(f'{key}: {value}')
    print()
`,
      ],
      { input: csv, encoding: 'utf8', maxBuffer: 8000000 }
    );
    if (result.status !== 0) throw new Error('Synthetic Open-WebUI generator failed');
    return result.stdout;
  }
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

function generateDatasetWorkbookFixture() {
  const XLSX = require('xlsx');
  const book = XLSX.utils.book_new();
  for (const [name, values] of [
    ['Lager', [7, 11]],
    ['Vertrieb', [23, 41]],
  ])
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['Produkt', 'Menge [Stück]'],
        ...values.map((value, i) => [`Synthetisches Produkt ${i + 1}`, value]),
      ]),
      name
    );
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

function generateDatasetSafetyFixture(kind) {
  const matrix = {
    empty: [
      ['Produkt', 'Menge', 'Preis'],
      ['A', '', ''],
      ['B', '', ''],
    ],
    none: [
      ['Produkt', 'None'],
      ['A', 1],
      ['B', 2],
    ],
    unnamedUnits: [
      ['Produkt', ''],
      ['[Text]', '[Stück]'],
      ['A', 1],
      ['B', 2],
    ],
    unnamed: [
      ['Produkt', ''],
      ['A', 1],
      ['B', 2],
    ],
    truncated: [
      ['Produkt', 'Menge'],
      ['A', '123,'],
      ['B', '456,'],
    ],
    sparse: [
      ['Produkt', 'Menge', 'Preis'],
      ['A', '', ''],
      ['B', '', 3],
    ],
    blankMeasure: [
      ['Produkt', 'Menge'],
      ['A', ''],
      ['B', ''],
    ],
    healthy: [
      ['Produkt', 'Menge'],
      ...Array.from({ length: 20 }, (_, i) => [`Produkt ${i}`, i + 1]),
    ],
  }[kind];
  if (kind === 'irreversible')
    return generateDatasetFixture('openwebui').replace('None: 2', 'None: 2, 9');
  if (!matrix) throw new Error('Unknown synthetic safety fixture');
  return matrix.map((row) => row.join(';')).join('\n');
}

function generateDatasetLegacyFixture(record) {
  return {
    ...record,
    columns: record.columns.map((column) => ({ ...column, nullCount: record.rowCount })),
    quality: { ...record.quality, missingValues: record.rowCount * record.columns.length },
  };
}

function generateDatasetRoutingFixture() {
  return {
    synthetic: true,
    title: 'Lastgang Hauptstraße 2025',
    filename: 'synthetic-hauptstrasse-2025.csv',
    anchors: ['Hauptstraße'],
    questions: [
      { kind: 'overview', question: 'Gibt es Auffälligkeiten?' },
      { kind: 'peak', question: 'Wie hoch war die Spitzenlast und wann?' },
      { kind: 'energy', question: 'Wie hoch war die Jahresenergie 2025?' },
      {
        kind: 'external',
        question:
          'Wie viele Solaranlagen über 100 kW sind laut Marktstammdatenregister in Uslar in Betrieb?',
      },
      { kind: 'memory', question: 'Was wissen wir insgesamt zum Ahornweg?' },
    ],
    fact: {
      id: 'synthetic-ahornweg-fact',
      type: 'tenant_memory_fact',
      tenantId: 'synthetic-dataset-validation',
      status: 'valid',
      sensitivityLevel: 'tenant_internal',
      text: 'Für den Ahornweg ist eine gemeinsame Bestandsprüfung beschlossen.',
      commitment: 'decided',
      anchors: [{ value: 'Ahornweg', qualifier: '', aliases: [] }],
      anchorKeys: [JSON.stringify(['ahornweg', ''])],
      relationIds: [],
      person: {
        actorId: 'synthetic-planner',
        name: 'Synthetische Planung',
        functionLabel: 'Planung',
      },
      at: '2025-01-02T10:00:00.000Z',
      time: {},
    },
  };
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
    formats: ['csv', 'markdown', 'pairs', 'openwebui', 'xlsx'],
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

module.exports = {
  generateDatasetFixture,
  generateDatasetRoutingFixture,
  generateDatasetWorkbookFixture,
  generateDatasetSafetyFixture,
  fixtureManifest,
  generateDatasetLegacyFixture,
};
