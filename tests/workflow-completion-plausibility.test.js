'use strict';

const {
  evaluateWorkflowCompletionPlausibility,
  STATUS,
  CATEGORY,
} = require('../src/workflow-completion-plausibility');

describe('workflow-completion-plausibility', () => {
  test('returns not_configured when no rules are supplied', () => {
    const result = evaluateWorkflowCompletionPlausibility({ rules: [], fields: { a: '1' } });
    expect(result.status).toBe(STATUS.NOT_CONFIGURED);
    expect(result.hints).toEqual([]);
    expect(result.counts).toEqual({ missingRequired: 0, implausibleValue: 0, total: 0 });
  });

  test('returns not_configured when rules/fields are omitted entirely', () => {
    const result = evaluateWorkflowCompletionPlausibility();
    expect(result.status).toBe(STATUS.NOT_CONFIGURED);
  });

  test('returns not_configured when fields is not a plain object', () => {
    const result = evaluateWorkflowCompletionPlausibility({
      rules: [{ ruleId: 'r1', type: 'required', fieldKey: 'summary' }],
      fields: null,
    });
    expect(result.status).toBe(STATUS.NOT_CONFIGURED);
  });

  describe('required rule', () => {
    const rules = [{ ruleId: 'summary_required', type: 'required', fieldKey: 'summary' }];

    test('flags missing_required when the field is absent', () => {
      const result = evaluateWorkflowCompletionPlausibility({ rules, fields: {} });
      expect(result.status).toBe(STATUS.HINTS_FOUND);
      expect(result.hints).toHaveLength(1);
      expect(result.hints[0]).toMatchObject({
        category: CATEGORY.MISSING_REQUIRED,
        fieldKey: 'summary',
        ruleId: 'summary_required',
        messageKey: 'field_required_missing',
        guidanceKey: 'provide_required_field',
        severity: 'warning',
      });
      expect(result.counts).toEqual({ missingRequired: 1, implausibleValue: 0, total: 1 });
    });

    test('flags missing_required for an empty string', () => {
      const result = evaluateWorkflowCompletionPlausibility({ rules, fields: { summary: '   ' } });
      expect(result.status).toBe(STATUS.HINTS_FOUND);
      expect(result.counts.missingRequired).toBe(1);
    });

    test('passes when the field is present', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules,
        fields: { summary: 'looks complete' },
      });
      expect(result.status).toBe(STATUS.OK);
      expect(result.hints).toEqual([]);
    });
  });

  describe('number_range rule', () => {
    const rules = [
      { ruleId: 'qty_range', type: 'number_range', fieldKey: 'quantity', min: 0, max: 100 },
    ];

    test('passes for an in-range numeric value', () => {
      const result = evaluateWorkflowCompletionPlausibility({ rules, fields: { quantity: 42 } });
      expect(result.status).toBe(STATUS.OK);
    });

    test('flags implausible_value when out of range', () => {
      const result = evaluateWorkflowCompletionPlausibility({ rules, fields: { quantity: 150 } });
      expect(result.status).toBe(STATUS.HINTS_FOUND);
      expect(result.hints[0]).toMatchObject({
        category: CATEGORY.IMPLAUSIBLE_VALUE,
        fieldKey: 'quantity',
        ruleId: 'qty_range',
        messageKey: 'value_outside_expected_range',
        guidanceKey: 'review_value_against_expected_range',
      });
      expect(result.counts).toEqual({ missingRequired: 0, implausibleValue: 1, total: 1 });
    });

    test('flags implausible_value for a non-numeric value', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules,
        fields: { quantity: 'not-a-number' },
      });
      expect(result.status).toBe(STATUS.HINTS_FOUND);
      expect(result.hints[0].category).toBe(CATEGORY.IMPLAUSIBLE_VALUE);
    });

    test('skips the range check (no hint) when the field is absent — that is a required rule concern', () => {
      const result = evaluateWorkflowCompletionPlausibility({ rules, fields: {} });
      expect(result.status).toBe(STATUS.OK);
      expect(result.hints).toEqual([]);
    });
  });

  describe('less_than_or_equal cross-field rule', () => {
    const rules = [
      {
        ruleId: 'start_before_end',
        type: 'less_than_or_equal',
        fieldKey: 'startValue',
        relatedFieldKey: 'endValue',
      },
    ];

    test('passes when startValue <= endValue', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules,
        fields: { startValue: 5, endValue: 10 },
      });
      expect(result.status).toBe(STATUS.OK);
    });

    test('flags implausible_value with relatedFieldKey when startValue > endValue', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules,
        fields: { startValue: 20, endValue: 10 },
      });
      expect(result.status).toBe(STATUS.HINTS_FOUND);
      expect(result.hints[0]).toMatchObject({
        category: CATEGORY.IMPLAUSIBLE_VALUE,
        fieldKey: 'startValue',
        relatedFieldKey: 'endValue',
        ruleId: 'start_before_end',
        messageKey: 'value_exceeds_related_field',
        guidanceKey: 'review_value_against_related_field',
      });
    });

    test('skips when either side is absent', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules,
        fields: { startValue: 20 },
      });
      expect(result.status).toBe(STATUS.OK);
    });
  });

  describe('clean passing case with multiple rule types', () => {
    test('returns ok with empty hints when all rules are satisfied', () => {
      const rules = [
        { ruleId: 'summary_required', type: 'required', fieldKey: 'summary' },
        { ruleId: 'qty_range', type: 'number_range', fieldKey: 'quantity', min: 0, max: 100 },
        {
          ruleId: 'start_before_end',
          type: 'less_than_or_equal',
          fieldKey: 'startValue',
          relatedFieldKey: 'endValue',
        },
      ];
      const result = evaluateWorkflowCompletionPlausibility({
        rules,
        fields: { summary: 'done', quantity: 50, startValue: 1, endValue: 2 },
      });
      expect(result.status).toBe(STATUS.OK);
      expect(result.hints).toEqual([]);
      expect(result.counts).toEqual({ missingRequired: 0, implausibleValue: 0, total: 0 });
    });
  });

  describe('malformed / unsupported rules fail closed', () => {
    test('unsupported rule type returns check_unavailable with no hints', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules: [{ ruleId: 'r1', type: 'regex_match', fieldKey: 'summary' }],
        fields: { summary: 'x' },
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
      expect(result.hints).toEqual([]);
    });

    test('missing fieldKey returns check_unavailable', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules: [{ ruleId: 'r1', type: 'required' }],
        fields: {},
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('rule with disallowed extra key (e.g. an executable callback) fails closed', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules: [
          {
            ruleId: 'r1',
            type: 'required',
            fieldKey: 'summary',
            check: () => true,
          },
        ],
        fields: { summary: 'x' },
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test.each([
      [
        'Date instance',
        Object.assign(new Date('2026-07-19T00:00:00.000Z'), {
          ruleId: 'r1',
          type: 'required',
          fieldKey: 'summary',
        }),
      ],
      [
        'custom-prototype object',
        Object.assign(Object.create({ inheritedCheck: () => true }), {
          ruleId: 'r1',
          type: 'required',
          fieldKey: 'summary',
        }),
      ],
    ])('%s is not accepted as a plain rule object', (_label, rule) => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules: [rule],
        fields: { summary: 'x' },
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('rule with a non-enumerable extra key fails closed', () => {
      const rule = { ruleId: 'r1', type: 'required', fieldKey: 'summary' };
      Object.defineProperty(rule, 'check', {
        value: () => true,
        enumerable: false,
      });

      const result = evaluateWorkflowCompletionPlausibility({
        rules: [rule],
        fields: { summary: 'x' },
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('rule with a symbol key fails closed', () => {
      const rule = {
        ruleId: 'r1',
        type: 'required',
        fieldKey: 'summary',
        [Symbol('check')]: () => true,
      };

      const result = evaluateWorkflowCompletionPlausibility({
        rules: [rule],
        fields: { summary: 'x' },
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('fieldKey with invalid characters (traversal/injection attempt) fails closed', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules: [{ ruleId: 'r1', type: 'required', fieldKey: '__proto__.polluted' }],
        fields: {},
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('number_range with min > max fails closed', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules: [{ ruleId: 'r1', type: 'number_range', fieldKey: 'x', min: 10, max: 5 }],
        fields: { x: 7 },
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('less_than_or_equal referencing itself fails closed', () => {
      const result = evaluateWorkflowCompletionPlausibility({
        rules: [{ ruleId: 'r1', type: 'less_than_or_equal', fieldKey: 'x', relatedFieldKey: 'x' }],
        fields: { x: 1 },
      });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('too many rules fails closed', () => {
      const rules = Array.from({ length: 51 }, (_, i) => ({
        ruleId: `r${i}`,
        type: 'required',
        fieldKey: `field${i}`,
      }));
      const result = evaluateWorkflowCompletionPlausibility({ rules, fields: {} });
      expect(result.status).toBe(STATUS.CHECK_UNAVAILABLE);
    });

    test('never throws on malformed rules or fields', () => {
      expect(() =>
        evaluateWorkflowCompletionPlausibility({ rules: 'not-an-array', fields: {} })
      ).not.toThrow();
      expect(() =>
        evaluateWorkflowCompletionPlausibility({ rules: [null, undefined, 42], fields: {} })
      ).not.toThrow();
    });
  });

  describe('no sensitive/free-form content leaks into the output', () => {
    test('submitted field values never appear in the serialized result', () => {
      const rules = [
        { ruleId: 'summary_required', type: 'required', fieldKey: 'summary' },
        { ruleId: 'qty_range', type: 'number_range', fieldKey: 'quantity', min: 0, max: 10 },
      ];
      const secretValue = 'Kunde Max Mustermann, IBAN DE00-SECRET-1234, Case #999-confidential';
      const result = evaluateWorkflowCompletionPlausibility({
        rules,
        fields: { summary: '', quantity: secretValue, notes: secretValue },
      });

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('Mustermann');
      expect(serialized).not.toContain('SECRET');
      expect(serialized).not.toContain('confidential');
      expect(serialized).not.toContain(secretValue);
    });

    test('result only contains the bounded allowlisted hint shape', () => {
      const rules = [{ ruleId: 'summary_required', type: 'required', fieldKey: 'summary' }];
      const result = evaluateWorkflowCompletionPlausibility({ rules, fields: {} });
      const allowedHintKeys = [
        'category',
        'fieldKey',
        'relatedFieldKey',
        'ruleId',
        'messageKey',
        'guidanceKey',
        'severity',
      ];
      for (const hint of result.hints) {
        expect(Object.keys(hint).every((key) => allowedHintKeys.includes(key))).toBe(true);
      }
    });
  });

  test('does not mutate the input rules or fields', () => {
    const rules = [{ ruleId: 'summary_required', type: 'required', fieldKey: 'summary' }];
    const fields = { summary: '' };
    const rulesCopy = JSON.parse(JSON.stringify(rules));
    const fieldsCopy = JSON.parse(JSON.stringify(fields));

    evaluateWorkflowCompletionPlausibility({ rules, fields });

    expect(rules).toEqual(rulesCopy);
    expect(fields).toEqual(fieldsCopy);
  });
});
