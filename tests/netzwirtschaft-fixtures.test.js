'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  generateNetzwirtschaftFixtures,
  writeNetzwirtschaftFixtures,
} = require('../scripts/generate-netzwirtschaft-fixtures');
const { generatePracticeCatalog } = require('../scripts/generate-practice-evaluation-fixtures');

const DIR = path.join(__dirname, 'fixtures/netzwirtschaft');
const files = () =>
  fs
    .readdirSync(DIR)
    .map((name) => ({ name, text: fs.readFileSync(path.join(DIR, name), 'utf8') }));
const scenarios = () =>
  generatePracticeCatalog().scenarios.filter((scenario) => scenario.id.startsWith('nw-'));

test('committed department fixtures match their generator', () => {
  expect(writeNetzwirtschaftFixtures({ check: true })).toEqual([]);
});

// The repository is public: department data must stay recognisably synthetic.
test('department fixtures and scenarios contain no real-looking personal or company data', () => {
  const texts = [
    ...files(),
    ...scenarios().map((scenario) => ({ name: scenario.id, text: JSON.stringify(scenario) })),
  ];
  const patterns = [
    ['e-mail', /[\w.+-]+@[\w-]+\.[\w.]+/u],
    ['phone', /(?:\+49|0049|\b0\d{2,4})[\s/-]?\d{3,}/u],
    ['url', /\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(?:de|com|net|org|eu)\b/iu],
    ['iban', /\b[A-Z]{2}\d{2}(?:\s?\d{4}){4,}/u],
    ['market location id', /\b\d{11}\b/u],
    ['metering point id', /\bDE\d{5,}[A-Z0-9]{10,}\b/u],
    ['legal form', /\b(?:GmbH|AG|KG|e\.V\.|mbH)\b(?!-)/u],
    ['personal name', /\b(?:Frau|Herr|Herrn)\s+\p{Lu}\p{Ll}+/u],
  ];
  const denylistFile = process.env.ANONYMITY_DENYLIST_FILE;
  const denylist = denylistFile
    ? fs
        .readFileSync(denylistFile, 'utf8')
        .split('\n')
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const findings = texts.flatMap(({ name, text }) => [
    ...patterns.filter(([, pattern]) => pattern.test(text)).map(([kind]) => `${name}: ${kind}`),
    ...denylist.filter((term) => text.toLowerCase().includes(term)).map(() => `${name}: denylist`),
  ]);
  expect(findings).toEqual([]);
});

test('expected answers follow from the seeded findings', () => {
  const { expected } = generateNetzwirtschaftFixtures();
  expect(expected.nna.openInvoices).toEqual([
    'NNA-SYN-003',
    'NNA-SYN-005',
    'NNA-SYN-008',
    'NNA-SYN-011',
  ]);
  expect(expected.nna.openAmount).toBe(5385);
  expect(expected.nna.rejectedWithoutCorrection).toEqual(['NNA-SYN-005']);
  expect(expected.kpi.slowest).toBe('Rechnungskorrektur');
  expect(expected.kpi.highestErrorRate).toBe('Stammdatenänderung');
  expect(expected.mako).toMatchObject({
    rows: 9,
    uniqueCases: 8,
    duplicates: ['MK-SYN-02'],
    pending: 7,
    overdue: ['MK-SYN-01', 'MK-SYN-02', 'MK-SYN-04'],
  });
});

test('every role duty has at least three scenarios with a named work package', () => {
  const byPackage = new Map();
  for (const scenario of scenarios())
    byPackage.set(scenario.workPackage, (byPackage.get(scenario.workPackage) || 0) + 1);
  for (const workPackage of ['role', 'WP2', 'WP3', 'WP4', 'WP5', 'WP6'])
    expect(byPackage.get(workPackage)).toBeGreaterThanOrEqual(3);
  // Capabilities that are not released yet stay visible as pending, never silently skipped.
  for (const scenario of scenarios())
    expect(Boolean(scenario.pending)).toBe(scenario.workPackage !== 'role');
});

test('scenario attachments resolve to department fixtures', () => {
  const { practiceDocument } = require('../scripts/generate-practice-evaluation-fixtures');
  for (const scenario of scenarios())
    for (const turn of scenario.turns)
      for (const document of [turn.document, ...(turn.documents || [])].filter(Boolean))
        expect(practiceDocument(document).length).toBeGreaterThan(50);
});
