'use strict';

const {
  validateRuleSet,
  listRuleSets,
  getRuleSet,
  resolveRuleSet,
  registerRuleSet,
  unregisterRuleSet,
  _resetCache,
} = require('../src/rcs-rule-registry');

beforeEach(() => {
  _resetCache();
});

// ── File-based rule loading ───────────────────────────────────────────────────

describe('listRuleSets — file-based rules', () => {
  test('returns at least the two bundled rule sets', () => {
    const list = listRuleSets();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  test('each entry has required summary fields', () => {
    for (const entry of listRuleSets()) {
      expect(typeof entry.id).toBe('string');
      expect(typeof entry.version).toBe('string');
      expect(typeof entry.effectiveFrom).toBe('string');
      expect(typeof entry.status).toBe('string');
    }
  });

  test('sorted descending by effectiveFrom (newest first)', () => {
    const list = listRuleSets();
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].effectiveFrom >= list[i].effectiveFrom).toBe(true);
    }
  });
});

// ── getRuleSet ────────────────────────────────────────────────────────────────

describe('getRuleSet', () => {
  test('returns june draft by id', () => {
    const rule = getRuleSet('eeg2027-draft-2026-06');
    expect(rule).not.toBeNull();
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(4);
    expect(rule.parameters.technologyFloors.wind_onshore).toBe(2.0);
  });

  test('returns april draft by id', () => {
    const rule = getRuleSet('eeg2027-draft-2026-04');
    expect(rule).not.toBeNull();
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(6);
    expect(rule.parameters.technologyFloors.wind_onshore).toBe(1.5);
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

  test('unknown id returns null', () => {
    expect(resolveRuleSet('does-not-exist')).toBeNull();
  });
});

// ── registerRuleSet / runtime overlay ────────────────────────────────────────

describe('registerRuleSet', () => {
  const validRule = {
    id: 'eeg2027-test-rule',
    version: '1.0.0',
    status: 'active',
    effectiveFrom: '2027-01-01',
    calculationMode: 'simulation',
    parameters: {
      s51ConsecutiveNegHours: 3,
      technologyFloors: { solar: 0, wind_onshore: 3.0, wind_offshore: 1.0, biomass: 2.0 },
      supportedTechnologies: ['solar', 'wind_onshore', 'wind_offshore', 'biomass'],
    },
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
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(3);
  });

  test('runtime rule takes priority over file rule when same id', () => {
    const override = { ...validRule, id: 'eeg2027-draft-2026-04', parameters: { ...validRule.parameters } };
    registerRuleSet(override);
    const rule = getRuleSet('eeg2027-draft-2026-04');
    expect(rule.parameters.s51ConsecutiveNegHours).toBe(3); // from runtime, not 6 from file
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
  const base = {
    id: 'eeg2027-valid',
    version: '1.0.0',
    status: 'draft',
    effectiveFrom: '2027-01-01',
    calculationMode: 'simulation',
    parameters: {
      s51ConsecutiveNegHours: 4,
      technologyFloors: { solar: 0, wind_onshore: 2.0 },
      supportedTechnologies: ['solar'],
    },
  };

  test('accepts a complete valid rule', () => {
    expect(validateRuleSet(base).valid).toBe(true);
  });

  test('rejects null', () => {
    expect(validateRuleSet(null).valid).toBe(false);
  });

  test('rejects invalid id (uppercase)', () => {
    const result = validateRuleSet({ ...base, id: 'INVALID_ID' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'id')).toBe(true);
  });

  test('rejects missing effectiveFrom', () => {
    const { effectiveFrom: _, ...rest } = base;
    const result = validateRuleSet(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'effectiveFrom')).toBe(true);
  });

  test('rejects invalid calculationMode', () => {
    const result = validateRuleSet({ ...base, calculationMode: 'magic' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'calculationMode')).toBe(true);
  });

  test('rejects s51ConsecutiveNegHours <= 0', () => {
    const result = validateRuleSet({
      ...base,
      parameters: { ...base.parameters, s51ConsecutiveNegHours: 0 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'parameters.s51ConsecutiveNegHours')).toBe(true);
  });

  test('rejects missing technologyFloors', () => {
    const result = validateRuleSet({
      ...base,
      parameters: { ...base.parameters, technologyFloors: null },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'parameters.technologyFloors')).toBe(true);
  });

  test('rejects empty supportedTechnologies', () => {
    const result = validateRuleSet({
      ...base,
      parameters: { ...base.parameters, supportedTechnologies: [] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'parameters.supportedTechnologies')).toBe(true);
  });

  test('registers only if valid (rejects invalid via registerRuleSet)', () => {
    const result = registerRuleSet({ ...base, id: 'BAD_ID' });
    expect(result.valid).toBe(false);
    expect(listRuleSets().find((r) => r.id === 'BAD_ID')).toBeUndefined();
  });
});
