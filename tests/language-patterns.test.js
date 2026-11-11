'use strict';

const {
  compare,
  countFile,
  inventory,
  isLanguagePattern,
} = require('../scripts/check-language-patterns');
const baseline = require('../scripts/language-patterns.baseline.json');

test('language patterns in the conversation path do not grow beyond the baseline', () => {
  const result = compare(inventory(), baseline);
  expect(result.grown).toEqual([]);
});

test('word patterns count as language, format and identifier patterns do not', () => {
  expect(isLanguagePattern('\\b(?:status|stand|bearbeitungsstand)\\b')).toBe(true);
  expect(isLanguagePattern('^\\s*\\|.*\\|\\s*$')).toBe(false);
  expect(isLanguagePattern('\\bF-\\d+\\b')).toBe(false);
  expect(
    countFile("if (/\\b(?:bitte|danke)\\b/iu.test(text)) x(); const y = s.replace(/\\s+/g, ' ');")
  ).toBe(1);
});

test('a file with more language patterns than recorded is reported', () => {
  const result = compare({ 'src/a.js': 3, 'src/b.js': 1 }, { 'src/a.js': 2, 'src/b.js': 4 });
  expect(result.grown).toEqual([{ file: 'src/a.js', baseline: 2, current: 3 }]);
});
