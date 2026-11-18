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

test('column names and values copied from the attached material are no tool output', () => {
  const evidence = [
    {
      source: 'verification-result.csv',
      retrievalSource: 'documents',
      value: 'document_id,verified_request_reference,verification_status\nDOC-1,REQ-B,verified',
    },
  ];
  expect(
    internalToolText(
      'Laut Tabelle ist `verified_request_reference` = REQ-B und `verification_status` = verified.',
      evidence
    )
  ).toBe(false);
  // An internal field name that the material does not contain is still recognised.
  expect(internalToolText('Das Feld internal_case_flag ist gesetzt.', evidence)).toBe(true);
  // Tool output does not whitelist its own parameter names.
  expect(
    internalToolText('Abfrage mit tenant_scope_id lieferte nichts.', [
      { retrievalSource: 'capability-read', value: 'tenant_scope_id=1' },
    ])
  ).toBe(true);
});
