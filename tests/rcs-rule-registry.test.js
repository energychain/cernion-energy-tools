'use strict';

const {
  validateRuleSet,
  listRuleSets,
  getRuleSet,
  resolveRuleSet,
  registerRuleSet,
  unregisterRuleSet,
  _resetCache,
  LEGAL_STATUS_VALUES,
} = require('../src/rcs-rule-registry');

beforeEach(() => {
  _resetCache();
});

// ── Base fixture (valid rule with all required fields) ────────────────────────

const BASE_VALID_RULE = {
  id: 'eeg2027-valid',
  version: '1.0.0',
  status: 'draft',
  legalStatus: 'referentenentwurf',
  effectiveFrom: '2027-01-01',
  effectiveTo: null,
  supersedes: null,
  calculationMode: 'eeg2027_clawback',
  sourceReference: 'Test reference',
  sourceUrl: null,
  notes: [],
  parameters: {
    s51ConsecutiveNegHours: 4,
    technologyFloors: { solar: 0, wind_onshore: 2.0 },
    supportedTechnologies: ['solar'],
  },
};

// ── File-based rule loading ───────────────────────────────────────────────────

describe('listRuleSets — file-based rules', () => {
  test('returns at least the two bundled rule sets', () => {
    const list = listRuleSets();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  test('each entry has all summary fields including new metadata', () => {
    for (const entry of listRuleSets()) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.version).toBe('string');
      expect(typeof entry.effectiveFrom).toBe('string');
      expect(typeof entry.status).toBe('string');
      expect(entry).toHaveProperty('legalStatus');
      expect(entry).toHaveProperty('effectiveTo');
      expect(entry).toHaveProperty('supersedes');
      expect(entry).toHaveProperty('sourceUrl');
      expect(Array.isArray(entry.notes)).toBe(true);
    }
  });

  test('sorted descending by effectiveFrom (newest first)', () => {
    const list = listRuleSets();
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].effectiveFrom >= list[i].effectiveFrom).toBe(true);
    }
  });

  test('june rule has legalStatus referentenentwurf', () => {
    const entry = listRuleSets().find((r) => r.id === 'eeg2027-draft-2026-06');
    expect(entry.legalStatus).toBe('referentenentwurf');
  });

  test('june rule supersedes april rule', () => {
    const entry = listRuleSets().find((r) => r.id === 'eeg2027-draft-2026-06');
    expect(entry.supersedes).toBe('eeg2027-draft-2026-04');
  });

  test('june rule has notes array with content', () => {
    const entry = listRuleSets().find((r) => r.id === 'eeg2027-draft-2026-06');
    expect(entry.notes.length).toBeGreaterThan(0);
  });

  test('april rule has effectiveTo set', () => {
    const entry = listRuleSets().find((r) => r.id === 'eeg2027-draft-2026-04');
    expect(entry.effectiveTo).not.toBeNull();
  });

  test('june rule has effectiveTo null (still active)', () => {
    const entry = listRuleSets().find((r) => r.id === 'eeg2027-draft-2026-06');
    expect(entry.effectiveTo).toBeNull();
  });
});

// ── getRuleSet ────────────────────────────────────────────────────────────────

describe('getRuleSet', () => {
  test('returns june draft by id with all metadata', () => {
    const rule = getRuleSet('eeg2027-draft-2026-06');
    expect(rule).not.toBeNull();
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(4);
    expect(rule.parameters.technologyFloors.wind_onshore).toBe(2.0);
    expect(rule.legalStatus).toBe('referentenentwurf');
    expect(rule.supersedes).toBe('eeg2027-draft-2026-04');
  });

  test('returns april draft by id', () => {
    const rule = getRuleSet('eeg2027-draft-2026-04');
    expect(rule).not.toBeNull();
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(6);
    expect(rule.status).toBe('superseded');
  });

  test('returns null for unknown id', () => {
    expect(getRuleSet('nonexistent-rule-xyz')).toBeNull();
  });
});

// ── resolveRuleSet ────────────────────────────────────────────────────────────

describe('resolveRuleSet', () => {
  test("'latest' resolves to newest active rule (june, not april/superseded)", () => {
    const rule = resolveRuleSet('latest');
    expect(rule.id).toBe('eeg2027-draft-2026-06');
  });

  test('falsy input also resolves latest', () => {
    expect(resolveRuleSet(null)?.id).toBe('eeg2027-draft-2026-06');
    expect(resolveRuleSet(undefined)?.id).toBe('eeg2027-draft-2026-06');
    expect(resolveRuleSet('')?.id).toBe('eeg2027-draft-2026-06');
  });

  test('explicit id returns that rule regardless of status', () => {
    const rule = resolveRuleSet('eeg2027-draft-2026-04');
    expect(rule.id).toBe('eeg2027-draft-2026-04');
    expect(rule.status).toBe('superseded');
  });

  test('superseded rule is NOT returned by latest', () => {
    const rule = resolveRuleSet('latest');
    expect(rule.id).not.toBe('eeg2027-draft-2026-04');
  });

  test('unknown id returns null', () => {
    expect(resolveRuleSet('does-not-exist')).toBeNull();
  });

  test('draft status rule does NOT qualify for latest', () => {
    const draftRule = {
      ...BASE_VALID_RULE,
      id: 'eeg2027-future-draft',
      status: 'draft',
      effectiveFrom: '2030-01-01', // newer date but draft
    };
    registerRuleSet(draftRule);
    const rule = resolveRuleSet('latest');
    expect(rule.id).not.toBe('eeg2027-future-draft');
  });
});

// ── registerRuleSet / runtime overlay ────────────────────────────────────────

describe('registerRuleSet', () => {
  const validRule = {
    ...BASE_VALID_RULE,
    id: 'eeg2027-test-rule',
    status: 'active',
    effectiveFrom: '2027-01-01',
  };

  test('registers a valid rule and it appears in listRuleSets', () => {
    const result = registerRuleSet(validRule);
    expect(result.valid).toBe(true);
    expect(listRuleSets().find((r) => r.id === 'eeg2027-test-rule')).toBeDefined();
  });

  test('registered rule is marked as runtime source', () => {
    registerRuleSet(validRule);
    const entry = listRuleSets().find((r) => r.id === 'eeg2027-test-rule');
    expect(entry.source).toBe('runtime');
  });

  test('registered rule can be retrieved via getRuleSet', () => {
    registerRuleSet(validRule);
    const rule = getRuleSet('eeg2027-test-rule');
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(4);
  });

  test('runtime rule takes priority over file rule when same id', () => {
    const override = {
      ...validRule,
      id: 'eeg2027-draft-2026-04',
      parameters: { ...validRule.parameters, s51ConsecutiveNegHours: 3 },
    };
    registerRuleSet(override);
    const rule = getRuleSet('eeg2027-draft-2026-04');
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(3);
  });

  test('registered active rule with future effectiveFrom wins resolveRuleSet latest', () => {
    registerRuleSet(validRule); // effectiveFrom 2027-01-01 > 2026-06-01
    const rule = resolveRuleSet('latest');
    expect(rule.id).toBe('eeg2027-test-rule');
  });

  test('unregisterRuleSet removes the runtime rule', () => {
    registerRuleSet(validRule);
    unregisterRuleSet('eeg2027-test-rule');
    expect(getRuleSet('eeg2027-test-rule')).toBeNull();
  });
});

// ── validateRuleSet ───────────────────────────────────────────────────────────

describe('validateRuleSet', () => {
  test('accepts a complete valid rule', () => {
    expect(validateRuleSet(BASE_VALID_RULE).valid).toBe(true);
  });

  test('accepts eeg2027_clawback as calculationMode', () => {
    expect(validateRuleSet({ ...BASE_VALID_RULE, calculationMode: 'eeg2027_clawback' }).valid).toBe(
      true
    );
  });

  test('rejects null', () => {
    expect(validateRuleSet(null).valid).toBe(false);
  });

  test('rejects invalid id (uppercase)', () => {
    const result = validateRuleSet({ ...BASE_VALID_RULE, id: 'INVALID_ID' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'id')).toBe(true);
  });

  test('rejects missing legalStatus', () => {
    const { legalStatus: _, ...rest } = BASE_VALID_RULE;
    const result = validateRuleSet(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'legalStatus')).toBe(true);
  });

  test('rejects invalid legalStatus value', () => {
    const result = validateRuleSet({ ...BASE_VALID_RULE, legalStatus: 'xyz-unknown' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'legalStatus')).toBe(true);
  });

  test('LEGAL_STATUS_VALUES exports all valid values', () => {
    expect(Array.isArray(LEGAL_STATUS_VALUES)).toBe(true);
    expect(LEGAL_STATUS_VALUES).toContain('referentenentwurf');
    expect(LEGAL_STATUS_VALUES).toContain('in_kraft');
  });

  test('rejects missing effectiveFrom', () => {
    const { effectiveFrom: _, ...rest } = BASE_VALID_RULE;
    const result = validateRuleSet(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'effectiveFrom')).toBe(true);
  });

  test('rejects invalid calculationMode', () => {
    const result = validateRuleSet({ ...BASE_VALID_RULE, calculationMode: 'magic' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'calculationMode')).toBe(true);
  });

  test('rejects s51ConsecutiveNegHours <= 0', () => {
    const result = validateRuleSet({
      ...BASE_VALID_RULE,
      parameters: { ...BASE_VALID_RULE.parameters, s51ConsecutiveNegHours: 0 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'parameters.s51ConsecutiveNegHours')).toBe(true);
  });

  test('rejects missing technologyFloors', () => {
    const result = validateRuleSet({
      ...BASE_VALID_RULE,
      parameters: { ...BASE_VALID_RULE.parameters, technologyFloors: null },
    });
    expect(result.valid).toBe(false);
  });

  test('rejects empty supportedTechnologies', () => {
    const result = validateRuleSet({
      ...BASE_VALID_RULE,
      parameters: { ...BASE_VALID_RULE.parameters, supportedTechnologies: [] },
    });
    expect(result.valid).toBe(false);
  });

  test('registers only if valid (rejects invalid via registerRuleSet)', () => {
    const result = registerRuleSet({ ...BASE_VALID_RULE, id: 'BAD_ID' });
    expect(result.valid).toBe(false);
    expect(listRuleSets().find((r) => r.id === 'BAD_ID')).toBeUndefined();
  });
});
