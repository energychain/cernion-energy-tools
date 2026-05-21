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

describe('v0.52.5 TDD matrix executable coverage', () => {
  const cases = parseTddMatrixFile(DEFAULT_MATRIX_FILE).filter((testCase) =>
    testCase.id.startsWith('T-')
  );
  const aliases = collectApiAliases();
  const requiredIds = cases.map((c) => c.id).sort();
  const passedIds = [];

  afterAll(() => {
    let existing = {};
    if (fs.existsSync(ARTIFACT_PATH)) {
      existing = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
    }

    const mergedRequiredIds = Array.from(
      new Set([...(existing.requiredIds || []), ...requiredIds])
    ).sort();
    const mergedPassedIds = Array.from(
      new Set([...(existing.passedIds || []), ...passedIds])
    ).sort();
    const payload = {
      generatedAt: new Date().toISOString(),
      normalizationVersion: MATRIX_NORMALIZATION_VERSION,
      requiredIds: mergedRequiredIds,
      passedIds: mergedPassedIds,
      passedCount: mergedPassedIds.length,
      requiredCount: mergedRequiredIds.length,
    };
    fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
    fs.writeFileSync(ARTIFACT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  });

  it('contains full fixed normalization coverage for all required TDD IDs', () => {
    const markdown = fs.readFileSync(DEFAULT_MATRIX_FILE, 'utf8');
    const regexRequiredIds = extractRequiredTddIds(markdown).filter((id) => id.startsWith('T-'));
    const normalizedIds = getNormalizedTestIds().filter((id) => id.startsWith('T-'));

    expect(regexRequiredIds).toEqual(requiredIds);
    expect(normalizedIds).toEqual(requiredIds);
  });

  it('parses exactly 58 executable single-turn matrix testcases', () => {
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
