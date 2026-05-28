'use strict';

/**
 * Unit tests for personal-agent-work-log.js — T-PA-WOL-001 through T-PA-WOL-009
 */

const {
  WORK_LOG_ACTIONS,
  VALID_WORK_LOG_ACTIONS,
  WORK_LOG_METADATA_WHITELIST,
  createTurnWorkLog,
  sanitizeWorkLogEntry,
  sanitizeWorkLogMetadata,
  sanitizeMetadataField,
  validateWorkLogEntry,
} = require('../src/personal-agent-work-log');

// ---------------------------------------------------------------------------
// T-PA-WOL-001: createTurnWorkLog returns empty frozen array
// ---------------------------------------------------------------------------

describe('T-PA-WOL-001: createTurnWorkLog returns empty frozen array', () => {
  test('toArray returns empty array initially', () => {
    const wl = createTurnWorkLog();
    expect(wl.toArray()).toEqual([]);
  });

  test('returned array is frozen', () => {
    const wl = createTurnWorkLog();
    expect(Object.isFrozen(wl.toArray())).toBe(true);
  });

  test('mutating returned array does not affect a second toArray call', () => {
    const wl = createTurnWorkLog();
    wl.addEntry({
      action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
      label: 'Test',
      metadata: { targetDomain: 'grid', primaryIntent: 'check', reasonCode: 'INTENT_SIGNAL_DETECTED' },
    });
    const arr1 = wl.toArray();
    // Attempting to push to frozen array throws in strict mode, so test that
    // the internal state is unaffected by spreading or reading
    const copy = [...arr1];
    copy.push({ step: 99, action: 'fake' });
    const arr2 = wl.toArray();
    expect(arr2.length).toBe(1); // Still 1, not 2
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-002: addEntry records valid routing_classified entry
// ---------------------------------------------------------------------------

describe('T-PA-WOL-002: addEntry records valid routing_classified entry', () => {
  test('entry is recorded with correct shape', () => {
    const wl = createTurnWorkLog();
    wl.addEntry({
      action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
      label: 'Classified as grid operations inquiry',
      metadata: {
        targetDomain: 'grid_operations',
        primaryIntent: 'capacity_check',
        reasonCode: 'INTENT_SIGNAL_DETECTED',
      },
    });
    const entries = wl.toArray();
    expect(entries.length).toBe(1);
    expect(entries[0].step).toBe(1);
    expect(entries[0].action).toBe('routing_classified');
    expect(typeof entries[0].timestamp).toBe('string');
    expect(new Date(entries[0].timestamp).getTime()).not.toBeNaN();
    expect(entries[0].metadata.targetDomain).toBe('grid_operations');
    expect(entries[0].metadata.primaryIntent).toBe('capacity_check');
    expect(entries[0].metadata.reasonCode).toBe('INTENT_SIGNAL_DETECTED');
  });

  test('label exceeding 120 chars is truncated to 120', () => {
    const wl = createTurnWorkLog();
    const longLabel = 'A'.repeat(200);
    wl.addEntry({
      action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
      label: longLabel,
      metadata: {},
    });
    expect(wl.toArray()[0].label.length).toBe(120);
  });

  test('non-whitelisted metadata fields are stripped', () => {
    const wl = createTurnWorkLog();
    wl.addEntry({
      action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
      label: 'Test',
      metadata: {
        targetDomain: 'grid',
        primaryIntent: 'check',
        reasonCode: 'DEFAULT_ROUTE',
        extraField: 'should_be_removed',
        anotherExtra: 42,
      },
    });
    const meta = wl.toArray()[0].metadata;
    expect(meta.extraField).toBeUndefined();
    expect(meta.anotherExtra).toBeUndefined();
    expect(meta.targetDomain).toBe('grid');
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-003: addEntry drops unknown action — returns null, no throw
// ---------------------------------------------------------------------------

describe('T-PA-WOL-003: addEntry drops unknown action silently', () => {
  test('returns null for unknown action', () => {
    const wl = createTurnWorkLog();
    const result = wl.addEntry({
      action: 'totally_unknown_action',
      label: 'test',
      metadata: {},
    });
    expect(result).toBeNull();
  });

  test('no entry recorded for unknown action', () => {
    const wl = createTurnWorkLog();
    wl.addEntry({ action: 'invalid_action', label: 'test', metadata: {} });
    expect(wl.toArray().length).toBe(0);
  });

  test('does not throw on unknown action', () => {
    const wl = createTurnWorkLog();
    expect(() => {
      wl.addEntry({ action: 'bogus', label: 'x', metadata: {} });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-004: sanitizeWorkLogMetadata strips forbidden keys
// ---------------------------------------------------------------------------

describe('T-PA-WOL-004: sanitizeWorkLogMetadata strips forbidden/non-whitelisted keys', () => {
  const forbiddenInput = {
    personaId: '123',
    confidence: 0.95,
    toolsUsed: ['tool_a', 'tool_b'],
    warnings: ['some_warning'],
    questionId: 'q_001',
    tenantId: 'tenant_xyz',
    userId: 'user_abc',
    sessionId: 'sess_123',
    // valid whitelisted fields alongside forbidden ones
    targetDomain: 'grid',
    primaryIntent: 'check',
    reasonCode: 'DEFAULT_ROUTE',
  };

  test('forbidden keys are absent from sanitized output for routing_classified', () => {
    const result = sanitizeWorkLogMetadata('routing_classified', forbiddenInput);
    expect(result.personaId).toBeUndefined();
    expect(result.confidence).toBeUndefined();
    expect(result.toolsUsed).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(result.questionId).toBeUndefined();
    expect(result.tenantId).toBeUndefined();
    expect(result.userId).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });

  test('whitelisted keys with valid values are retained', () => {
    const result = sanitizeWorkLogMetadata('routing_classified', forbiddenInput);
    expect(result.targetDomain).toBe('grid');
    expect(result.primaryIntent).toBe('check');
    expect(result.reasonCode).toBe('DEFAULT_ROUTE');
  });

  test('unknown action returns empty object', () => {
    const result = sanitizeWorkLogMetadata('nonexistent_action', { targetDomain: 'x' });
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-005: sanitizeMetadataField enforces type per field spec
// ---------------------------------------------------------------------------

describe('T-PA-WOL-005: sanitizeMetadataField enforces types', () => {
  test('number field passed as string is dropped (invalid type throws)', () => {
    const fieldSpec = { type: 'number' };
    expect(() => sanitizeMetadataField('not_a_number', fieldSpec)).toThrow();
  });

  test('valid enum string is retained', () => {
    const fieldSpec = {
      type: 'string',
      maxLength: 64,
      enumValues: ['INTENT_SIGNAL_DETECTED', 'DEFAULT_ROUTE', 'FALLBACK_ROUTE'],
    };
    expect(sanitizeMetadataField('DEFAULT_ROUTE', fieldSpec)).toBe('DEFAULT_ROUTE');
  });

  test('invalid enum string throws', () => {
    const fieldSpec = {
      type: 'string',
      maxLength: 64,
      enumValues: ['INTENT_SIGNAL_DETECTED', 'DEFAULT_ROUTE', 'FALLBACK_ROUTE'],
    };
    expect(() => sanitizeMetadataField('FREE_TEXT', fieldSpec)).toThrow();
  });

  test('valid number is returned as number', () => {
    expect(sanitizeMetadataField(42, { type: 'number' })).toBe(42);
  });

  test('boolean field returns boolean', () => {
    expect(sanitizeMetadataField(true, { type: 'boolean' })).toBe(true);
    expect(sanitizeMetadataField(false, { type: 'boolean' })).toBe(false);
  });

  test('non-finite number throws', () => {
    expect(() => sanitizeMetadataField(NaN, { type: 'number' })).toThrow();
    expect(() => sanitizeMetadataField(Infinity, { type: 'number' })).toThrow();
  });

  test('unknown type throws', () => {
    expect(() => sanitizeMetadataField('x', { type: 'array' })).toThrow();
    expect(() => sanitizeMetadataField('x', { type: 'object' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-006: enum_array fields accept only defined codes
// ---------------------------------------------------------------------------

describe('T-PA-WOL-006: enum_array fields filter runtime strings', () => {
  test('warningCodes: valid and invalid codes mixed', () => {
    const fieldSpec = {
      type: 'enum_array',
      enumCodes: ['AMBIGUOUS_INTENT', 'LOW_SIGNAL', 'BRIDGE_PARTIAL'],
    };
    const result = sanitizeMetadataField(
      ['AMBIGUOUS_INTENT', 'INVALID_CODE', 'LOW_SIGNAL'],
      fieldSpec
    );
    expect(result).toEqual(['AMBIGUOUS_INTENT', 'LOW_SIGNAL']);
  });

  test('warningCodes: all invalid codes returns empty array', () => {
    const fieldSpec = {
      type: 'enum_array',
      enumCodes: ['AMBIGUOUS_INTENT', 'LOW_SIGNAL', 'BRIDGE_PARTIAL'],
    };
    const result = sanitizeMetadataField(['totally', 'wrong', 'values'], fieldSpec);
    expect(result).toEqual([]);
  });

  test('blockerCodes: valid single code retained', () => {
    const fieldSpec = {
      type: 'enum_array',
      enumCodes: ['PARAMS_INCOMPLETE', 'TENANT_UNRESOLVED', 'KNOWLEDGE_SCOPE_MISSING', 'HITL_PENDING'],
    };
    const result = sanitizeMetadataField(['PARAMS_INCOMPLETE'], fieldSpec);
    expect(result).toEqual(['PARAMS_INCOMPLETE']);
  });

  test('no free-text strings survive enum_array filter', () => {
    const fieldSpec = {
      type: 'enum_array',
      enumCodes: ['AMBIGUOUS_INTENT'],
    };
    const result = sanitizeMetadataField(['free text', 'another free string'], fieldSpec);
    expect(result).toEqual([]);
  });

  test('enum_array without enumCodes throws', () => {
    const fieldSpec = { type: 'enum_array' };
    expect(() => sanitizeMetadataField(['AMBIGUOUS_INTENT'], fieldSpec)).toThrow();
  });

  test('enum_array with non-array value throws', () => {
    const fieldSpec = { type: 'enum_array', enumCodes: ['A'] };
    expect(() => sanitizeMetadataField('not_array', fieldSpec)).toThrow();
  });

  test('via addEntry — warningCodes in metadata are filtered correctly', () => {
    const wl = createTurnWorkLog();
    wl.addEntry({
      action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
      label: 'Test',
      metadata: {
        warningCodes: ['AMBIGUOUS_INTENT', 'NOT_A_CODE', 'LOW_SIGNAL'],
      },
    });
    const meta = wl.toArray()[0].metadata;
    expect(meta.warningCodes).toEqual(['AMBIGUOUS_INTENT', 'LOW_SIGNAL']);
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-007: overflow strategy at 17+ entries
// ---------------------------------------------------------------------------

describe('T-PA-WOL-007: overflow strategy produces correct shape at 17+ entries', () => {
  function fillWorkLog(wl, count) {
    for (let i = 0; i < count; i++) {
      wl.addEntry({
        action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
        label: `Entry ${i + 1}`,
        metadata: { targetDomain: 'grid', primaryIntent: 'check', reasonCode: 'DEFAULT_ROUTE' },
      });
    }
  }

  test('25 entries results in exactly 16 retained entries', () => {
    const wl = createTurnWorkLog();
    fillWorkLog(wl, 25);
    expect(wl.toArray().length).toBe(16);
  });

  test('step-9 entry has action worklog_truncated', () => {
    const wl = createTurnWorkLog();
    fillWorkLog(wl, 25);
    const entries = wl.toArray();
    expect(entries[8].action).toBe('worklog_truncated');
  });

  test('totalActivities in truncation metadata is 25', () => {
    const wl = createTurnWorkLog();
    fillWorkLog(wl, 25);
    const truncEntry = wl.toArray()[8];
    expect(truncEntry.metadata.totalActivities).toBe(25);
  });

  test('droppedMiddle is correct (25 - 15 = 10)', () => {
    const wl = createTurnWorkLog();
    fillWorkLog(wl, 25);
    const truncEntry = wl.toArray()[8];
    expect(truncEntry.metadata.droppedMiddle).toBe(10);
  });

  test('first entry has step 1, last entry has step 16', () => {
    const wl = createTurnWorkLog();
    fillWorkLog(wl, 25);
    const entries = wl.toArray();
    expect(entries[0].step).toBe(1);
    expect(entries[15].step).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-008: totalActivities counter survives multiple overflow events
// ---------------------------------------------------------------------------

describe('T-PA-WOL-008: totalActivities counter survives multiple overflow events', () => {
  function addEntries(wl, count) {
    for (let i = 0; i < count; i++) {
      wl.addEntry({
        action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
        label: `Entry ${i + 1}`,
        metadata: { targetDomain: 'grid', primaryIntent: 'check', reasonCode: 'DEFAULT_ROUTE' },
      });
    }
  }

  test('totalActivities is 30 after 20 + 10 entries', () => {
    const wl = createTurnWorkLog();
    addEntries(wl, 20); // first overflow at 17
    addEntries(wl, 10); // second overflow
    const entries = wl.toArray();
    // Find the truncation entry
    const truncEntry = entries.find(e => e.action === 'worklog_truncated');
    expect(truncEntry).toBeDefined();
    expect(truncEntry.metadata.totalActivities).toBe(30);
  });

  test('toArray length is still 16 after double overflow', () => {
    const wl = createTurnWorkLog();
    addEntries(wl, 20);
    addEntries(wl, 10);
    expect(wl.toArray().length).toBe(16);
  });

  test('droppedMiddle reflects total-15 = 15 for 30 activities', () => {
    const wl = createTurnWorkLog();
    addEntries(wl, 20);
    addEntries(wl, 10);
    const truncEntry = wl.toArray().find(e => e.action === 'worklog_truncated');
    expect(truncEntry.metadata.droppedMiddle).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// T-PA-WOL-009: validateWorkLogEntry throws on forbidden keys and nested objects
// ---------------------------------------------------------------------------

describe('T-PA-WOL-009: validateWorkLogEntry throws on violations', () => {
  function makeValidEntry(overrides = {}) {
    return {
      step: 1,
      timestamp: new Date().toISOString(),
      action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
      label: 'Valid label',
      metadata: {},
      ...overrides,
    };
  }

  test('throws on tenantId in metadata', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ metadata: { tenantId: 'tenant_xyz' } }))
    ).toThrow(/Forbidden/);
  });

  test('throws on toolsUsed in metadata', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ metadata: { toolsUsed: ['a'] } }))
    ).toThrow(/Forbidden/);
  });

  test('throws on questionId in metadata', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ metadata: { questionId: 'q1' } }))
    ).toThrow(/Forbidden/);
  });

  test('throws on warnings in metadata', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ metadata: { warnings: ['x'] } }))
    ).toThrow(/Forbidden/);
  });

  test('throws on blockers in metadata', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ metadata: { blockers: ['x'] } }))
    ).toThrow(/Forbidden/);
  });

  test('throws on nested object in metadata', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ metadata: { nested: { obj: 1 } } }))
    ).toThrow(/Nested object/);
  });

  test('does not throw on valid entry with only whitelisted fields', () => {
    const wl = createTurnWorkLog();
    wl.addEntry({
      action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
      label: 'Valid entry',
      metadata: { targetDomain: 'grid', reasonCode: 'DEFAULT_ROUTE' },
    });
    const entry = wl.toArray()[0];
    expect(() => validateWorkLogEntry(entry)).not.toThrow();
  });

  test('throws on invalid action', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ action: 'not_valid' }))
    ).toThrow(/Invalid action/);
  });

  test('throws on label exceeding 120 chars', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ label: 'A'.repeat(121) }))
    ).toThrow(/Invalid label/);
  });

  test('throws on non-numeric step', () => {
    expect(() =>
      validateWorkLogEntry(makeValidEntry({ step: 'one' }))
    ).toThrow(/Invalid step/);
  });
});

// ---------------------------------------------------------------------------
// Sanity: WORK_LOG_ACTIONS and VALID_WORK_LOG_ACTIONS contract
// ---------------------------------------------------------------------------

describe('WORK_LOG_ACTIONS and VALID_WORK_LOG_ACTIONS contract', () => {
  test('WORK_LOG_ACTIONS is an Object.freeze enum with 15 entries', () => {
    expect(typeof WORK_LOG_ACTIONS).toBe('object');
    expect(Object.isFrozen(WORK_LOG_ACTIONS)).toBe(true);
    expect(Object.keys(WORK_LOG_ACTIONS).length).toBe(15);
  });

  test('VALID_WORK_LOG_ACTIONS is a Set covering all WORK_LOG_ACTIONS values', () => {
    expect(VALID_WORK_LOG_ACTIONS instanceof Set).toBe(true);
    for (const val of Object.values(WORK_LOG_ACTIONS)) {
      expect(VALID_WORK_LOG_ACTIONS.has(val)).toBe(true);
    }
  });

  test('WORK_LOG_METADATA_WHITELIST is frozen and covers all standard actions except worklog_truncated as system-only', () => {
    expect(Object.isFrozen(WORK_LOG_METADATA_WHITELIST)).toBe(true);
    expect(WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.ROUTING_CLASSIFIED]).toBeDefined();
    expect(WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.CONSULTATION_SYNTHESIS]).toBeDefined();
    expect(WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.PERSONA_RESOLVED]).toBeDefined();
    expect(WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.ONBOARDING_GAP_DETECTED]).toBeDefined();
  });

  test('consultation_synthesis whitelist has toolCount and sourceCategory but NOT toolsUsed', () => {
    const spec = WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.CONSULTATION_SYNTHESIS];
    expect(spec.toolCount).toBeDefined();
    expect(spec.sourceCategory).toBeDefined();
    expect(spec.toolsUsed).toBeUndefined();
  });

  test('onboarding_question_posed whitelist has no questionId', () => {
    const spec = WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.ONBOARDING_QUESTION_POSED];
    expect(spec.questionId).toBeUndefined();
    expect(spec.topic).toBeDefined();
  });

  test('routing_classified whitelist has warningCodes as enum_array', () => {
    const spec = WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.ROUTING_CLASSIFIED];
    expect(spec.warningCodes).toBeDefined();
    expect(spec.warningCodes.type).toBe('enum_array');
    expect(Array.isArray(spec.warningCodes.enumCodes)).toBe(true);
  });

  test('execution_readiness_assessed whitelist has blockerCodes as enum_array', () => {
    const spec = WORK_LOG_METADATA_WHITELIST[WORK_LOG_ACTIONS.EXECUTION_READINESS_ASSESSED];
    expect(spec.blockerCodes).toBeDefined();
    expect(spec.blockerCodes.type).toBe('enum_array');
    expect(Array.isArray(spec.blockerCodes.enumCodes)).toBe(true);
  });
});
