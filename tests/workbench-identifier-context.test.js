'use strict';

const { opaqueContext, restoreContext } = require('../src/workbench-identifier-context');
const { scrubPromptText } = require('../src/prompt-scrubber');

test('opaque reference survives facade PII scrub without sending the reidentification map', () => {
  const original = {
    message: 'Referenz 99000000001, Kontakt alice@example.org',
    identifiers: [{ value: '99000000001' }],
  };
  const safe = opaqueContext(original);
  const prompt = JSON.stringify(safe.value);
  expect(prompt).not.toContain('99000000001');
  expect(safe.reidentMap.size).toBe(1);
  const clean = scrubPromptText(prompt);
  expect(clean).not.toContain('alice@example.org');
  const restored = restoreContext(JSON.parse(clean), safe.reidentMap);
  expect(restored.identifiers[0].value).toBe('99000000001');
  expect(restored.message).toContain('99000000001');
  expect(restored.message).not.toContain('alice@example.org');
});

test('masking keeps surrounding email tokens intact for facade removal', () => {
  const safe = opaqueContext({ message: 'Referenz 99000000001; 99000000001@example.org' });
  expect(JSON.stringify(safe.value)).toContain('99000000001@example.org');
  const clean = scrubPromptText(JSON.stringify(safe.value));
  const restored = restoreContext(JSON.parse(clean), safe.reidentMap);
  expect(restored.message).toContain('Referenz 99000000001');
  expect(restored.message).not.toContain('@example.org');
});

test('one entry cannot smuggle several questions into the three-question budget', () => {
  const { questionsFor } = require('../src/workbench-understanding');
  expect(
    questionsFor({
      missingInformation: [
        { blocking: true, key: 'two', question: 'Welche Referenz? Wann empfangen?' },
        { blocking: true, key: 'one', question: 'Welche Referenz?' },
      ],
    })
  ).toEqual([{ blocking: true, key: 'one', question: 'Welche Referenz?' }]);
});

test('known masks survive dropped brackets without inventing unknown or prefixed references', () => {
  const safe = opaqueContext({ message: 'Marktlokation 99000000001' });
  const [mask] = safe.reidentMap.keys();
  const bare = mask.slice(1, -1);
  expect(
    restoreContext({ text: `Referenz ${bare}.`, [bare]: 'unchanged key' }, safe.reidentMap)
  ).toEqual({ text: 'Referenz 99000000001.', [bare]: 'unchanged key' });
  expect(restoreContext(`X${bare} ${bare}9 MASKED-unknown`, safe.reidentMap)).toBe(
    `X${bare} ${bare}9 MASKED-unknown`
  );
});
