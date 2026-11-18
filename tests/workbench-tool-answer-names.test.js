'use strict';

const { internalToolText } = require('../src/workbench-tool-answer');

test('names of documents are no internal tool output', () => {
  const evidence = [{ source: 'scanned-response.pdf' }, { metadata: { name: 'Prüfprotokoll Q3' } }];
  expect(
    internalToolText('Prüfe den Scan aus scanned-response.pdf gegen den Index.', evidence)
  ).toBe(false);
  expect(internalToolText('Laut archive-a-search.png liegt nur die Quittung vor.')).toBe(false);
  expect(internalToolText('Abgleich mit transaction-register-initial.csv, Version 1.')).toBe(false);
});

test('internal identifiers stay recognised next to document names', () => {
  expect(internalToolText('Die Abfrage dataset.query lieferte keinen Treffer.')).toBe(true);
  expect(internalToolText('Laut scanned-response.pdf fehlt das Feld REQUEST_ID.')).toBe(true);
  expect(internalToolText('Siehe fn_lookup_case in scanned-response.pdf.')).toBe(true);
});
