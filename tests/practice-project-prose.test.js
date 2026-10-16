'use strict';

const { projectEvidenceChecks } = require('../scripts/generate-project-manifest-fixtures');
const rule = { selected: true, file: 'original.csv', catalog: 'Katalog A' };
const text =
  'Ich habe dafür die Projektakte „Projekt A“ herangezogen. Aus der Projektakte stammen 23 kW (original.csv, Blatt A). Der Referenzwert aus Katalog A beträgt 41.';
function reply() {
  return {
    projectSelection: { projectId: 'p-a' },
    evidence: [
      {
        source: 'dataset.query',
        value: '23 kW; Datei: original.csv; Fundstelle: Blatt A; Hash: abc.',
        metadata: {
          filename: 'original.csv',
          hash: 'a'.repeat(64),
          nodeId: 'n-a',
          location: { sheet: 'Blatt A' },
        },
      },
      { source: 'practice-reference.read', value: 'Aus Katalog A: 41.' },
    ],
  };
}

test('practice accepts prose with file citation and complete structured provenance', () => {
  expect(projectEvidenceChecks(rule, reply(), text).every((check) => check.passed)).toBe(true);
});

test.each(['hash', 'location', 'nodeId'])('practice still rejects missing structured %s', (key) => {
  const result = reply();
  delete result.evidence[0].metadata[key];
  expect(
    projectEvidenceChecks(rule, result, text).find((check) => check.id === 'project-provenance')
      .passed
  ).toBe(false);
});

test('practice rejects an uncited file and omitted catalog source', () => {
  const checks = projectEvidenceChecks(
    rule,
    reply(),
    text.replace('original.csv', 'Datei').replace('Katalog A', 'Quelle')
  );
  expect(checks.filter((check) => !check.passed).map((check) => check.id)).toEqual([
    'project-provenance',
    'project-separated-catalog',
  ]);
});
