'use strict';

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_MATRIX_FILE,
  splitMarkdownTableRow,
  extractCodeSpans,
  extractServiceCallSpecs,
  parseTddMatrixFromMarkdown,
  parseTddMatrixFile,
  extractRequiredTddIds,
} = require('../src/personal-agent-tdd-matrix-parser');

describe('personal-agent-tdd-matrix-parser', () => {
  it('splits markdown table rows safely', () => {
    const row = '| T-INV-01 | Prompt | `intent.class` | 1. `POST /api/foo` | Ergebnis |';
    const cells = splitMarkdownTableRow(row);
    expect(cells).toEqual([
      'T-INV-01',
      'Prompt',
      '`intent.class`',
      '1. `POST /api/foo`',
      'Ergebnis',
    ]);
  });

  it('extracts code spans from markdown cells', () => {
    const spans = extractCodeSpans('1. `POST /api/x` 2. Poll `GET /api/y`');
    expect(spans).toEqual(['POST /api/x', 'GET /api/y']);
  });

  it('extracts only route-like service call specs', () => {
    const calls = extractServiceCallSpecs('1. `POST /api/x` 2. `foo.bar` 3. `GET /api/y`');
    expect(calls).toEqual(['POST /api/x', 'GET /api/y']);
  });

  it('parses testcase rows from markdown tables', () => {
    const markdown = [
      '| ID | Prompt | Intent | Service-Calls | Ergebnis |',
      '|----|--------|--------|---------------|----------|',
      '| T-INV-01 | Plane X | `investment.create` | 1. `POST /api/a` | done |',
    ].join('\n');

    const cases = parseTddMatrixFromMarkdown(markdown);
    expect(cases).toHaveLength(1);
    expect(cases[0].id).toBe('T-INV-01');
    expect(cases[0].intentClass).toBe('investment.create');
    expect(cases[0].serviceCallsSpec).toEqual(['POST /api/a']);
  });

  it('extracts unique required IDs using independent regex', () => {
    const markdown = [
      '| T-INV-01 | ... |',
      '| T-INV-01 | ... |',
      '| T-ZNP-02 | ... |',
    ].join('\n');
    expect(extractRequiredTddIds(markdown)).toEqual(['T-INV-01', 'T-ZNP-02']);
  });

  it('parses the real architecture matrix file and finds 58 testcases', () => {
    const cases = parseTddMatrixFile(DEFAULT_MATRIX_FILE);
    expect(Array.isArray(cases)).toBe(true);
    expect(cases).toHaveLength(58);

    const ids = new Set(cases.map((c) => c.id));
    expect(ids.size).toBe(58);
    expect(ids.has('T-INV-01')).toBe(true);
    expect(ids.has('T-QUE-04')).toBe(true);
  });

  it('required ID extractor returns the same 58 IDs for the real matrix file', () => {
    const markdown = fs.readFileSync(path.resolve(DEFAULT_MATRIX_FILE), 'utf8');
    const required = extractRequiredTddIds(markdown);
    expect(required).toHaveLength(58);
    expect(required[0]).toMatch(/^T-/);
  });
});
