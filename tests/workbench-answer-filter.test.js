'use strict';

test('section headings that repeat request words are structure, a copied sentence is not', () => {
  const { isInternalDescription } = require('../src/workbench-answer-filter');
  const context = [
    'Bereite mein Briefing vor: offene Entscheidungen, Risiken, Fristen.',
    'Die Person bittet um die Vorbereitung eines Briefings für den nächsten Termin.',
  ];
  expect(
    isInternalDescription('Risiken\n1. Ein Rückstau gefährdet Fristen (Dokument A).', context)
  ).toBe(false);
  expect(
    isInternalDescription(
      'Die Person bittet um die Vorbereitung eines Briefings für den nächsten Termin.',
      context
    )
  ).toBe(true);
});
