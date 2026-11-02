'use strict';

const { withoutStatedCodes } = require('../src/workbench-understanding');

const statement = {
  retrievalSource: 'tenant-memory',
  value:
    'Person (Funktion, 02.11.2026); Herkunft: Nutzerangabe: „Für Aufgabe X bin ich verantwortlich (V); Team Y führt durch (D); Team Z wirkt mit (M); Stelle W wird informiert (I).“ (gültig).',
};

test('a combined token whose parts the stored statement names is no code to explain', () => {
  const situation = {
    codeMeaningQuestion: true,
    codeReferences: [{ value: 'V/D/M/I', family: 'Code-Familie zur Klärung' }],
    codeResolutions: [{ value: 'V/D/M/I', status: 'unresolved' }],
  };
  const result = withoutStatedCodes(situation, [statement]);
  expect(result.codeReferences).toEqual([]);
  expect(result.codeMeaningQuestion).toBe(false);
});

test('a code the statement does not name stays a code question', () => {
  const situation = {
    codeMeaningQuestion: true,
    codeReferences: [{ value: 'Z29', family: 'Fehlercode' }],
  };
  expect(withoutStatedCodes(situation, [statement]).codeMeaningQuestion).toBe(true);
});
