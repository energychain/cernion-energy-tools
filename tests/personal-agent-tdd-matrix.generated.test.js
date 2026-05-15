'use strict';

const fs = require('fs');
const path = require('path');
const ApiService = require('../services/api.service');

const {
  DEFAULT_MATRIX_FILE,
  parseTddMatrixFile,
  extractRequiredTddIds,
} = require('../src/personal-agent-tdd-matrix-parser');
const {
  MATRIX_NORMALIZATION_VERSION,
  getNormalizedTestIds,
  normalizeMatrixTestCase,
} = require('../src/personal-agent-tdd-matrix-normalizer');

const ARTIFACT_PATH = path.join(__dirname, '..', 'tmp', 'tdd-matrix-pass-results.json');

function collectApiAliases() {
  return new Set(
    (ApiService?.settings?.routes || [])
      .flatMap((route) => Object.keys(route.aliases || {}))
      .map((alias) => String(alias).trim())
      .filter(Boolean)
  );
}

describe('v0.52.4 TDD matrix executable coverage', () => {
  const cases = parseTddMatrixFile(DEFAULT_MATRIX_FILE);
  const aliases = collectApiAliases();
  const requiredIds = cases.map((c) => c.id).sort();
  const passedIds = [];

  afterAll(() => {
    const payload = {
      generatedAt: new Date().toISOString(),
      normalizationVersion: MATRIX_NORMALIZATION_VERSION,
      requiredIds,
      passedIds: passedIds.slice().sort(),
      passedCount: passedIds.length,
      requiredCount: requiredIds.length,
    };
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  });

  it('contains full fixed normalization coverage for all required TDD IDs', () => {
    const markdown = fs.readFileSync(DEFAULT_MATRIX_FILE, 'utf8');
    const regexRequiredIds = extractRequiredTddIds(markdown);
    const normalizedIds = getNormalizedTestIds();

    expect(regexRequiredIds).toEqual(requiredIds);
    expect(normalizedIds).toEqual(requiredIds);
  });

  it('parses exactly 58 executable matrix testcases', () => {
    expect(cases).toHaveLength(58);
  });

  test.each(cases)('$id maps to executable backend aliases', (testCase) => {
    const normalized = normalizeMatrixTestCase(testCase);

    expect(normalized.notes).not.toBe('UNMAPPED_TESTCASE_ID');
    expect(normalized.id).toBe(testCase.id);
    expect(normalized.intentClass).toBe(testCase.intentClass);
    expect(Array.isArray(normalized.aliases)).toBe(true);
    expect(normalized.aliases.length).toBeGreaterThan(0);

    for (const alias of normalized.aliases) {
      expect(aliases.has(alias)).toBe(true);
    }

    passedIds.push(testCase.id);
  });
});
