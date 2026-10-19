'use strict';
const { evidenceComparisons } = require('../src/tenant-evidence-comparison');
const doc = (value) => ({
  value,
  metadata: { sourceId: 'doc-a', sourceLabel: 'Unterlage.txt', location: 'Stand, Abschnitt A' },
});
const table = (value, quantityFields = [{ name: 'Umfang (kg)', unit: 'kg' }]) => ({
  value,
  metadata: {
    sourceId: 'table-a',
    sourceLabel: 'Daten.csv, Blatt A',
    location: 'Blatt A',
    quantityFields,
  },
});

test('states common/different literal quantities with both origins and the open basis', () => {
  const result = evidenceComparisons([
    doc('# Objekt Nord\n## Umfang\nDer Umfang beträgt 80 kg.'),
    table(
      'Minimum (Umfang (kg)): 80 kg am 2025-01-03. Maximum (Umfang (kg)): 95 kg am 2025-01-01.'
    ),
  ]);
  expect(result).toHaveLength(1);
  expect(result[0].text).toMatch(/80 kg.*Unterlage\.txt.*80 kg, 95 kg.*Daten\.csv/u);
  expect(result[0].text).toMatch(/Übereinstimmung: 80 kg/u);
  expect(result[0].text).toMatch(/weichen ab/u);
  expect(result[0].text).toMatch(/bleibt offen/u);
  expect(result[0].text).not.toMatch(/15 kg/u);
});

test('normalizes equivalent decimal/grouped numbers using the prose numeric guard', () => {
  const result = evidenceComparisons([
    doc('Umfang: 1.000,5 kg.'),
    table('Maximum (Umfang (kg)): 1000.50 kg.'),
  ]);
  expect(result[0].text).toContain('Übereinstimmung');
  expect(result[0].text).not.toContain('weichen ab');
});

test('preserves a stated negative sign and does not turn it into agreement', () => {
  const result = evidenceComparisons([doc('Umfang: −80 kg.'), table('Umfang: 80 kg.')]);
  expect(result[0].text).toContain('-80 kg');
  expect(result[0].text).toContain('weichen ab');
  expect(result[0].text).not.toContain('Übereinstimmung');
});

test('does not mix fields, units, identifiers, or values mentioned after another field', () => {
  expect(evidenceComparisons([doc('Umfang: 80 g.'), table('Umfang: 95 kg.')])).toEqual([]);
  expect(evidenceComparisons([doc('Nebenwert: 80 kg.'), table('Umfang: 95 kg.')])).toEqual([]);
  const result = evidenceComparisons([
    doc('Umfang: 80 kg; Rest: 10 kg.'),
    table('Umfang: 95 kg. Rest: 12 kg.', [
      { name: 'Umfang', unit: 'kg' },
      { name: 'Rest', unit: 'kg' },
    ]),
  ]);
  expect(result).toHaveLength(2);
  expect(result[0].text).not.toMatch(/10 kg|12 kg/u);
  expect(result[1].text).not.toMatch(/80 kg|95 kg/u);
  expect(evidenceComparisons([doc('Umfang: 80 kg.')])).toEqual([]);
});

test('uses an executor field binding for scalar prose without guessing between fields', () => {
  const value = table('Der höchste Wert beträgt 95 kg.');
  value.metadata.sourceType = 'dataset';
  expect(evidenceComparisons([doc('Umfang: 80 kg.'), value])).toHaveLength(1);
  value.metadata.quantityFields.push({ name: 'Rest', unit: 'kg' });
  expect(evidenceComparisons([doc('Umfang: 80 kg.'), value])).toEqual([]);
});
