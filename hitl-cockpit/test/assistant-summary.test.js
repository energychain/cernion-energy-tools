'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildAssistantSummary, sanitizeSummaryText } = require('../lib/assistant-summary');

test('summary is deterministic, bounded, and contains all five continuity sections', () => {
  const messages = [
    {
      role: 'user',
      content:
        'Ziel: Einführung bis Freitag. Aufgabe: Anja prüft den Entwurf. Evidenz: Test 42 ist grün. Offene Frage: Wer gibt frei?',
    },
    { role: 'assistant', content: 'Entscheidung: Wir beginnen mit einem read-only Pilot.' },
  ];
  const first = buildAssistantSummary(messages, { maxChars: 240 });
  const second = buildAssistantSummary(messages, { maxChars: 240 });
  assert.equal(first, second);
  assert.ok(first.length <= 240);
  assert.match(first, /Ziele:/);
  assert.match(first, /Entscheidungen:/);
  assert.match(first, /Offene Aufgaben:/);
  assert.match(first, /Evidenz:/);
  assert.match(first, /Offene Fragen:/);
  assert.equal(first.split('\n').length, 5);
});

test('summary strips credentials and TWL/private material without leaking it', () => {
  assert.doesNotMatch(
    sanitizeSummaryText(
      'token=abcdef123456789 password is hunter2 Bearer header.payload.signature https://user:pass@example.test'
    ),
    /abcdef|hunter2|header|user:pass/
  );
  for (const text of ['TWL Netze intern', 'twl-netze-private', 'PRIVATE: Kundendaten']) {
    const summary = buildAssistantSummary([{ role: 'user', content: `Ziel: ${text}` }]);
    assert.doesNotMatch(summary, /twl|netze|private|kundendaten/i);
    assert.match(summary, /\[REDACTED\]/);
  }
});

test('summary keeps only complete bounded lines and never mutates source messages', () => {
  const messages = [{ role: 'user', content: `Ziel: ${'x'.repeat(300)}` }];
  const copy = JSON.stringify(messages);
  const summary = buildAssistantSummary(messages, { maxChars: 120 });
  assert.ok(summary.length <= 120);
  assert.equal(JSON.stringify(messages), copy);
  assert.equal(summary.split('\n').length, 5);
});
