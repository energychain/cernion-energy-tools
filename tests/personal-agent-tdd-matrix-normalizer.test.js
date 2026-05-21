'use strict';

const fs = require('fs');
const ApiService = require('../services/api.service');

const {
  DEFAULT_MATRIX_FILE,
  parseTddMatrixFile,
  extractRequiredTddIds,
} = require('../src/personal-agent-tdd-matrix-parser');
const {
  MATRIX_NORMALIZATION_VERSION,
  getNormalizationMap,
  getNormalizedTestIds,
  normalizeRouteSpec,
  normalizeMatrixTestCase,
} = require('../src/personal-agent-tdd-matrix-normalizer');

describe('personal-agent-tdd-matrix-normalizer', () => {
  it('has version marker for release tracking', () => {
    expect(MATRIX_NORMALIZATION_VERSION).toBe('0.52.5');
  });

  it('normalizes /api route specs to alias format', () => {
    expect(normalizeRouteSpec('post /api/foo/bar')).toBe('POST /foo/bar');
    expect(normalizeRouteSpec('GET /foo/bar')).toBe('GET /foo/bar');
  });

  it('contains fixed mappings for all required matrix IDs (70)', () => {
    const markdown = fs.readFileSync(DEFAULT_MATRIX_FILE, 'utf8');
    const required = extractRequiredTddIds(markdown);
    const mapIds = getNormalizedTestIds();
    expect(required).toHaveLength(70);
    expect(mapIds).toEqual(required);
  });

  it('maps each parsed testcase to at least one alias', () => {
    const cases = parseTddMatrixFile(DEFAULT_MATRIX_FILE);
    for (const testCase of cases) {
      const normalized = normalizeMatrixTestCase(testCase);
      expect(normalized.notes).not.toBe('UNMAPPED_TESTCASE_ID');
      expect(normalized.aliases.length).toBeGreaterThan(0);
    }
  });

  it('preserves normalized turn metadata for multi-turn scenarios', () => {
    const cases = parseTddMatrixFile(DEFAULT_MATRIX_FILE).filter(
      (testCase) => testCase.id === 'MT-JOU-01'
    );
    const normalized = normalizeMatrixTestCase(cases[0]);

    expect(normalized.executionMode).toBe('auto');
    expect(normalized.expectedReplyKeywords).toEqual(['versorgungssicherheit', 'stand']);
    expect(Array.isArray(normalized.turns)).toBe(true);
    expect(normalized.turns).toHaveLength(4);
    expect(normalized.turns[3].id).toBe('MT-JOU-04');
    expect(normalized.turns[3].aliases).toEqual(['POST /personal-agent/chat']);
  });

  it('uses executable aliases present in api.service route map', () => {
    const aliases = new Set(
      (ApiService?.settings?.routes || [])
        .flatMap((r) => Object.keys(r.aliases || {}))
        .map((a) => String(a).trim())
        .filter(Boolean)
    );
    const map = getNormalizationMap();

    for (const [id, def] of Object.entries(map)) {
      for (const alias of def.aliases || []) {
        expect(aliases.has(normalizeRouteSpec(alias))).toBe(true);
      }
      expect(id).toMatch(/^(T|MT)-[A-Z]+-\d{2}$/);
      expect(def.intentClass).toBeTruthy();
    }
  });
});
