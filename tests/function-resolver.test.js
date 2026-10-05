'use strict';

const { resolveFunctions } = require('../src/function-resolver');
const model = {
  functions: [
    {
      functionId: 'fn-old-name',
      label: 'Function A',
      keywords: ['shared phrase'],
      aliases: ['alternate phrase'],
    },
    { functionId: 'fn-b', label: 'Function B', keywords: ['shared phrase'] },
  ],
};

test('matches only labels, model keywords and semantic aliases; IDs are opaque', () => {
  expect(resolveFunctions('Function A', { model })).toMatchObject({
    status: 'resolved',
    matches: [{ functionId: 'fn-old-name', confidence: 1 }],
  });
  expect(resolveFunctions('alternate phrase', { model })).toMatchObject({
    status: 'resolved',
    matches: [{ matchedBy: 'alias' }],
  });
  expect(resolveFunctions('shared phrase', { model })).toMatchObject({
    status: 'ambiguous',
    totalMatches: 2,
  });
  expect(resolveFunctions('fn-old-name', { model })).toMatchObject({ status: 'none' });
  expect(resolveFunctions('FN-OLD-NAME', { model })).toMatchObject({ status: 'none' });
  expect(resolveFunctions('old name', { model })).toMatchObject({ status: 'none' });
});

test('normalizes case, Unicode and label separators without changing identity', () => {
  const fixture = { functions: [{ functionId: 'fn-z', label: 'Café_Example', keywords: [] }] };
  expect(resolveFunctions('CAFÉ example', { model: fixture })).toMatchObject({
    status: 'resolved',
    matches: [{ functionId: 'fn-z' }],
  });
});

test('ambiguous matches are bounded, deterministic and do not guess from order', () => {
  const fixture = {
    functions: Array.from({ length: 10 }, (_, i) => ({
      functionId: `fn-${i}`,
      label: 'Same label',
      keywords: [],
    })),
  };
  const result = resolveFunctions('Same label', { model: fixture, maxCandidates: 5 });
  expect(result).toMatchObject({ status: 'ambiguous', totalMatches: 10 });
  expect(result.matches).toHaveLength(5);
  expect(
    resolveFunctions('Same label', {
      model: { functions: fixture.functions.reverse() },
      maxCandidates: 5,
    })
  ).toEqual(result);
});

test('weights rare semantic tokens and supports configurable separation and compound fragments', () => {
  const fixture = {
    functions: [
      {
        functionId: 'fn-a',
        label: 'Example Planning',
        domains: ['shared'],
        departments: ['portfolio'],
        keywords: ['compoundplanning'],
      },
      {
        functionId: 'fn-b',
        label: 'Other',
        domains: ['shared'],
        keywords: ['portfolio', 'example'],
      },
    ],
  };
  expect(resolveFunctions('portfolio', { model: fixture })).toMatchObject({
    status: 'resolved',
    matches: [{ functionId: 'fn-a' }],
  });
  expect(resolveFunctions('shared', { model: fixture })).toMatchObject({ status: 'ambiguous' });
  expect(resolveFunctions('example', { model: fixture, minScoreGap: 1 })).toMatchObject({
    status: 'ambiguous',
  });
  expect(resolveFunctions('compound', { model: fixture })).toMatchObject({
    status: 'resolved',
    matches: [{ functionId: 'fn-a' }],
  });
});
