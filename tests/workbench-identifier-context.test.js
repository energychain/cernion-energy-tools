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
  expect(safe.reidentMap.size).toBe(2);
  const clean = scrubPromptText(prompt);
  expect(clean).not.toContain('alice@example.org');
  const restored = restoreContext(JSON.parse(clean), safe.reidentMap);
  expect(restored.identifiers[0].value).toBe('99000000001');
  expect(restored.message).toContain('99000000001');
  expect(restored.message).toContain('alice@example.org');
});

test('masking keeps surrounding email tokens intact for facade removal', () => {
  const safe = opaqueContext({ message: 'Referenz 99000000001; 99000000001@example.org' });
  expect(JSON.stringify(safe.value)).not.toContain('99000000001@example.org');
  const clean = scrubPromptText(JSON.stringify(safe.value));
  const restored = restoreContext(JSON.parse(clean), safe.reidentMap);
  expect(restored.message).toContain('Referenz 99000000001');
  expect(restored.message).toContain('99000000001@example.org');
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
    'X[Angabe] [Angabe] [Angabe]'
  );
});

test.each(['\n', '\t', '\r', '"', '\\'])(
  'masks plaintext identifiers after escape %j without corrupting JSON',
  (escape) => {
    const original = {
      12345: [
        { m: `a${escape}12345 Ort`, unicode: `Grüße 東京${escape}Ä12345 Text` },
        `Zeile1${escape}DE0001234567890 Text`,
        `Kontakt${escape}alice@example.org`,
        null,
        12345,
        true,
      ],
    };
    const safe = opaqueContext(original);
    const wire = JSON.stringify(safe.value);
    expect(safe.value).toHaveProperty('12345');
    expect(safe.value['12345'][0].m).not.toContain('12345');
    expect(safe.value['12345'][0].unicode).not.toContain('Ä12345');
    expect(wire).not.toContain('DE0001234567890');
    expect(wire).not.toContain('alice@example.org');
    expect(restoreContext(JSON.parse(wire), safe.reidentMap)).toEqual(original);
    expect(original['12345'][0].m).toBe(`a${escape}12345 Ort`);
  }
);

test('repeated nested identifiers share masks and schema keys remain intact', () => {
  const original = { 'alice@example.org': ['58095', { again: '58095', date: '2026-10-08' }] };
  const safe = opaqueContext(original);
  expect(safe.value['alice@example.org'][0]).toBe(safe.value['alice@example.org'][1].again);
  expect(safe.value['alice@example.org'][1].date).toBe('2026-10-08');
  expect(restoreContext(safe.value, safe.reidentMap)).toEqual(original);
});
