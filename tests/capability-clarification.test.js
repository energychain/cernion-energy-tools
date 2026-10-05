'use strict';
const {
  choiceCandidates,
  confirmedCapability,
  choiceText,
} = require('../src/capability-clarification');
const model = {
  functions: Array.from({ length: 8 }, (_, index) => ({
    functionId: `fn-${index}`,
    capabilities: [`internal-${index}`],
    displayLabel: `Readable task ${index}`,
  })),
};
const classification = {
  uncertain: true,
  candidateCapabilities: model.functions.map((row) => ({ capability: row.capabilities[0] })),
};
const previous = { lastClassification: classification };

test('shows at most five catalog-derived labels, without capability codes', () => {
  const text = choiceText(classification, model);
  expect(choiceCandidates(classification, model)).toHaveLength(5);
  expect(text).toContain('5. Readable task 4');
  expect(text).not.toContain('Readable task 5');
  expect(text).not.toContain('internal-');
});
test.each(['1', 'Nummer 1', 'Readable task 0'])(
  'chooses only a persisted displayed candidate: %s',
  (message) => {
    expect(confirmedCapability(message, previous, model)).toEqual({ capability: 'internal-0' });
  }
);
test.each(['6', 'Readable task 5', 'internal-0', 'unlisted task'])(
  'rejects undisplayed or forged choices: %s',
  (message) => {
    expect(confirmedCapability(message, previous, model)).toBeNull();
  }
);
test('a resolved case cannot be reselected using a stale number', () => {
  expect(
    confirmedCapability('1', { lastClassification: { ...classification, uncertain: false } }, model)
  ).toBeNull();
});
