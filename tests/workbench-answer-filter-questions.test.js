'use strict';

const { asksQuestion, filterAnswer } = require('../src/workbench-answer-filter');

test('a question mark closing a word asks a question', () => {
  expect(asksQuestion('Liegt dir die Originalnachricht vor?')).toBe(true);
  expect(asksQuestion('Welche Lokation ist gemeint? Danach prüfen wir weiter.')).toBe(true);
});

test('question marks inside or after identifiers mark unreadable characters', () => {
  expect(asksQuestion('Prüfe Bezug REQ-DEV-17? und Lokation LOC-DEV-BE?A gegen den Index.')).toBe(
    false
  );
  expect(asksQuestion('Die Antwortreferenz ANS-DEV-17? ist im Scan unvollständig.')).toBe(false);
});

test('a step naming unreadable identifiers stays in the answer', () => {
  const parsed = {
    interpretation: [],
    expectation: [],
    nextSteps: [
      {
        text: 'Gleiche Bezug REQ-DEV-17? und Lokation LOC-DEV-BE?A gegen den Originalindex ab.',
        origin: 'model',
        supported: 'model',
        evidenceIds: [],
        completedAction: false,
        specific: false,
      },
    ],
    assumptions: [],
    draft: [],
  };
  const counts = new Map();
  filterAnswer(parsed, {
    evidence: [],
    answerEvidence: [],
    unresolved: [],
    message: 'Ordne den Scan nur zu, wenn Referenz und Lokation eindeutig passen.',
    normalizeCondition: (value) => value,
    counts,
  });
  expect(counts.has('nextSteps:question_in_claim')).toBe(false);
  expect(parsed.nextSteps).toHaveLength(1);
});
