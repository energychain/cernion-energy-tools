'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MATRIX_FILE = path.join(
  __dirname,
  '..',
  'docs',
  'v0.52-implementation-plans',
  'personal-agent-v052-architecture-tdd.md'
);

/**
 * Parse a markdown table row using a pipe-aware scanner.
 * Supports escaped pipes (\|) and ignores the outer table pipes.
 *
 * @param {string} row
 * @returns {string[]}
 */
function splitMarkdownTableRow(row) {
  const trimmed = String(row || '').trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return [];
  }

  const inner = trimmed.slice(1, -1);
  const cells = [];
  let buffer = '';
  let escaped = false;

  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];

    if (escaped) {
      buffer += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '|') {
      cells.push(buffer.trim());
      buffer = '';
      continue;
    }

    buffer += ch;
  }

  cells.push(buffer.trim());
  return cells;
}

/**
 * Extract inline code spans (`...`) from a markdown cell.
 *
 * @param {string} cell
 * @returns {string[]}
 */
function extractCodeSpans(cell) {
  const matches = [];
  const regex = /`([^`]+)`/g;
  let match;
  while ((match = regex.exec(String(cell || ''))) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

/**
 * Parse route-like call specs from a service-calls cell.
 *
 * Example outputs:
 *  - POST /api/grid-connection/validate
 *  - GET /api/jobs/:jobId/status
 *
 * @param {string} serviceCallsCell
 * @returns {string[]}
 */
function extractServiceCallSpecs(serviceCallsCell) {
  const codeSpans = extractCodeSpans(serviceCallsCell);
  const calls = [];
  for (const span of codeSpans) {
    const compact = span.replace(/\s+/g, ' ').trim();
    if (/^(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(compact)) {
      calls.push(compact.replace(/^([a-z]+)\s+/, (_, m) => `${m.toUpperCase()} `));
    }
  }
  return calls;
}

/**
 * Parse all TDD matrix test cases from markdown text.
 * Only rows with IDs matching T-XXX-00 are considered executable test cases.
 *
 * @param {string} markdown
 * @returns {Array<{id:string,prompt:string,intentClass:string,serviceCallsSpec:string[],expectedResult:string,rawServiceCalls:string}>}
 */
function parseTddMatrixFromMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const cases = [];

  for (const line of lines) {
    const maybeRow = line.trim();
    if (!maybeRow.startsWith('| T-')) continue;

    const cells = splitMarkdownTableRow(maybeRow);
    // Expected columns: ID | Prompt | Intent | Service-Calls | Expected Ergebnis
    if (cells.length < 5) continue;

    const id = String(cells[0] || '').trim();
    if (!/^T-[A-Z]+-\d{2}$/.test(id)) continue;

    const prompt = String(cells[1] || '').trim();
    const intentCell = String(cells[2] || '').trim();
    const serviceCallsCell = String(cells[3] || '').trim();
    const expectedResult = String(cells[4] || '').trim();

    const intentCode = extractCodeSpans(intentCell)[0] || intentCell.replace(/`/g, '').trim();
    const serviceCallsSpec = extractServiceCallSpecs(serviceCallsCell);

    cases.push({
      id,
      prompt,
      intentClass: intentCode,
      serviceCallsSpec,
      expectedResult,
      rawServiceCalls: serviceCallsCell,
    });
  }

  return cases;
}

/**
 * Parse test cases from markdown file path.
 *
 * @param {string} [filePath]
 * @returns {ReturnType<typeof parseTddMatrixFromMarkdown>}
 */
function parseTddMatrixFile(filePath = DEFAULT_MATRIX_FILE) {
  const markdown = fs.readFileSync(filePath, 'utf8');
  return parseTddMatrixFromMarkdown(markdown);
}

/**
 * Extract unique required TDD IDs from markdown (independent regex path).
 * Used by strict coverage gates.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
function extractRequiredTddIds(markdown) {
  const found = new Set();
  const regex = /\|\s*(T-[A-Z]+-\d{2})\s*\|/g;
  let match;
  while ((match = regex.exec(String(markdown || ''))) !== null) {
    found.add(match[1]);
  }
  return Array.from(found).sort();
}

module.exports = {
  DEFAULT_MATRIX_FILE,
  splitMarkdownTableRow,
  extractCodeSpans,
  extractServiceCallSpecs,
  parseTddMatrixFromMarkdown,
  parseTddMatrixFile,
  extractRequiredTddIds,
};
