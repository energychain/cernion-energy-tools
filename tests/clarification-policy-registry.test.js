'use strict';

const {
  findClarificationPolicyMatch,
  loadClarificationPolicy,
  validateClarificationPolicy,
  _resetCache,
} = require('../src/clarification-policy-registry');

describe('clarification-policy-registry', () => {
  beforeEach(() => {
    _resetCache();
  });

  test('loads and validates EV charging objective disambiguation policy', () => {
    const policy = loadClarificationPolicy('ev-charging-objective-disambiguation-v1');
    expect(policy).not.toBeNull();
    expect(validateClarificationPolicy(policy)).toEqual({ valid: true, errors: [] });
  });

  test('matches generic EV charging question without objective', () => {
    const match = findClarificationPolicyMatch({
      message: 'Wann soll ich mein Auto laden?',
      knownContext: {},
      chatMode: 'consultation',
    });
    expect(match?.policy?.id).toBe('ev-charging-objective-disambiguation-v1');
  });

  test('does not match when CO2 objective is explicit', () => {
    const match = findClarificationPolicyMatch({
      message: 'Wann soll ich mein Auto laden, um möglichst wenig CO2 zu verursachen?',
      knownContext: {},
      chatMode: 'consultation',
    });
    expect(match).toBeNull();
  });

  test('does not match when price objective is explicit', () => {
    const match = findClarificationPolicyMatch({
      message: 'Wann soll ich mein Auto mit dem günstigsten Börsenpreis laden?',
      knownContext: {},
      chatMode: 'consultation',
    });
    expect(match).toBeNull();
  });
});
