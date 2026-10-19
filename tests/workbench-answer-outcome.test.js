'use strict';
const { safeConclusion } = require('../src/workbench-answer-outcome');
const { buildTurnMemory, safeTurnMemory } = require('../src/workbench-turn-memory');
const { renderCaseMemory } = require('../src/workbench-case-search');
const fallback =
  'Aus den verfügbaren Dokumentabschnitten lässt sich diese Frage gerade nicht zuverlässig beantworten.';

test('current fallback status excludes any wording from case conclusions', () => {
  expect(safeConclusion('Beliebige Antwort', { answerStatus: 'fallback' })).toBe('');
  expect(safeConclusion('Beliebige Antwort', { metadata: { degraded: true } })).toBe('');
  expect(safeConclusion(fallback)).toBe('');
  const memory = buildTurnMemory({
    classification: { responseText: 'Beliebige Antwort', answerStatus: 'fallback' },
    previousMemory: { lastSafeConclusion: 'Früherer belegter Stand.' },
  });
  expect(memory.lastSafeConclusion).toBe('Früherer belegter Stand.');
});

test('legacy fallback conclusions disappear from both safe memory and case overview', () => {
  expect(safeTurnMemory({ lastSafeConclusion: fallback }).lastSafeConclusion).toBeUndefined();
  expect(
    buildTurnMemory({ previousMemory: { lastSafeConclusion: fallback } }).lastSafeConclusion
  ).toBeUndefined();
  const text = renderCaseMemory(
    {
      topic: 'Objekt Nord',
      memory: { situation: 'Unterlage liegt vor.', lastSafeConclusion: fallback },
    },
    'F-1'
  );
  expect(text).not.toContain('nicht zuverlässig');
  expect(text).not.toContain('Letzte Einordnung');
});

test('internal descriptions, structural errors and bare titles are not last conclusions', () => {
  expect(safeConclusion('Der Benutzer möchte vorhandene Angaben einordnen.')).toBe('');
  expect(safeConclusion('Beliebige Fehlermeldung', { answerStatus: 'error' })).toBe('');
  expect(
    safeTurnMemory({ topic: 'Objekt Nord', lastSafeConclusion: 'Objekt Nord' }).lastSafeConclusion
  ).toBeUndefined();
});
