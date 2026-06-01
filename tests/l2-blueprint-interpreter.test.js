'use strict';

const {
  validateBlueprint,
  executeBlueprint,
  evaluateExpression,
  renderTemplate,
  renderParams,
  findLowestContiguousAverage,
  applyMapping,
  resolvePathInScope,
} = require('../src/l2-blueprint-interpreter');

// ─── Test Fixtures ────────────────────────────────────────────────────────────

function makeMinimalBlueprint(overrides = {}) {
  return {
    id: 'ev-charging-co2-optimization-v1',
    version: '1.0.0',
    meta: {
      title: 'CO2-optimiertes EV-Laden',
      description: 'Ermittelt das günstigste CO2-Fenster zum Laden eines Elektrofahrzeugs.',
      targetAudience: 'end_user',
    },
    execution: {
      steps: [
        {
          id: 'fetch_co2',
          action: 'energy-market.co2Forecast',
          params: { postalCode: '{{inputs.postalCode}}', hours: 24 },
        },
      ],
    },
    ...overrides,
  };
}

function makeFullEVBlueprint() {
  return {
    id: 'ev-charging-co2-optimization-v1',
    version: '1.0.0',
    meta: {
      title: 'CO2-optimiertes EV-Laden',
      description: 'Ermittelt das günstigste CO2-Fenster zum Laden eines Elektrofahrzeugs.',
      targetAudience: 'end_user',
    },
    routing: {
      intentSignals: ['laden', 'wallbox', 'elektroauto', 'EV', 'CO2'],
      negativeSignals: ['gasheizung'],
      priorityBoost: 5,
    },
    inputs: {
      postalCode: {
        type: 'string',
        required: true,
        semanticType: 'OEO:PostalCode',
        resolveStrategy: {
          method: 'llm_extraction',
          prompt: 'Bitte nenne deine Postleitzahl.',
        },
      },
      chargingDurationHours: {
        type: 'number',
        required: true,
        semanticType: 'OEO:Duration',
        resolveStrategy: {
          method: 'static_default',
          defaultValue: 4,
        },
      },
    },
    execution: {
      steps: [
        {
          id: 'fetch_co2',
          action: 'energy-market.co2Forecast',
          params: { postalCode: '{{inputs.postalCode}}', hours: 24 },
        },
        {
          id: 'fetch_price',
          action: 'energy-market.spotPrice',
          params: { postalCode: '{{inputs.postalCode}}' },
        },
      ],
    },
    postProcessing: {
      calculations: {
        chargingEnergy: 'inputs.chargingDurationHours * 11',
        costEstimate: 'inputs.chargingDurationHours * 11 * 0.30',
      },
      mappings: {
        optimalWindow: {
          strategy: 'find_lowest_contiguous_average',
          source: 'steps.fetch_co2.output.forecast',
          windowSize: '{{inputs.chargingDurationHours}}',
        },
      },
    },
    synthesis: {
      evidenceRequired: ['steps.fetch_co2.output', 'postProcessing.optimalWindow'],
      templates: {
        success:
          'Optimales Ladefenster: {{postProcessing.optimalWindow.startIndex}} Uhr – {{postProcessing.optimalWindow.endIndex}} Uhr (⌀ {{postProcessing.optimalWindow.averageValue}} g CO₂/kWh). Geschätzte Energie: {{postProcessing.chargingEnergy}} kWh.',
        error: 'Keine Daten verfügbar. Bitte erneut versuchen.',
      },
    },
    persistence: {
      l3_facts: {
        optimalChargingWindow: 'postProcessing.optimalWindow',
        postalCode: 'inputs.postalCode',
      },
    },
  };
}

// ─── resolvePathInScope ───────────────────────────────────────────────────────

describe('resolvePathInScope', () => {
  test('resolves simple key', () => {
    expect(resolvePathInScope('city', { city: 'Berlin' })).toBe('Berlin');
  });

  test('resolves nested path', () => {
    expect(resolvePathInScope('a.b.c', { a: { b: { c: 42 } } })).toBe(42);
  });

  test('returns undefined for missing path', () => {
    expect(resolvePathInScope('a.b', { a: {} })).toBeUndefined();
  });

  test('returns undefined for null scope', () => {
    expect(resolvePathInScope('a', null)).toBeUndefined();
  });

  test('returns undefined for empty path', () => {
    expect(resolvePathInScope('', { a: 1 })).toBeUndefined();
  });

  test('resolves array-type value', () => {
    expect(resolvePathInScope('data', { data: [1, 2, 3] })).toEqual([1, 2, 3]);
  });
});

// ─── renderTemplate ────────────────────────────────────────────────────────────

describe('renderTemplate', () => {
  test('replaces single placeholder', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  test('replaces multiple placeholders', () => {
    expect(renderTemplate('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 })).toBe('1 + 2 = 3');
  });

  test('replaces nested path placeholder', () => {
    expect(renderTemplate('PLZ: {{inputs.postalCode}}', { inputs: { postalCode: '68259' } })).toBe(
      'PLZ: 68259'
    );
  });

  test('returns empty string for missing placeholder', () => {
    expect(renderTemplate('Hello {{missing}}!', {})).toBe('Hello !');
  });

  test('handles whitespace in placeholder', () => {
    expect(renderTemplate('{{ name }}', { name: 'test' })).toBe('test');
  });

  test('returns non-string input unchanged', () => {
    expect(renderTemplate(42, {})).toBe(42);
  });

  test('handles template with no placeholders', () => {
    expect(renderTemplate('plain text', {})).toBe('plain text');
  });
});

// ─── renderParams ──────────────────────────────────────────────────────────────

describe('renderParams', () => {
  test('renders string values with templates', () => {
    const result = renderParams(
      { postalCode: '{{inputs.postalCode}}', hours: 24 },
      { inputs: { postalCode: '68259' } }
    );
    expect(result).toEqual({ postalCode: '68259', hours: 24 });
  });

  test('leaves non-string values untouched', () => {
    const result = renderParams({ count: 5, flag: true, obj: { x: 1 } }, {});
    expect(result).toEqual({ count: 5, flag: true, obj: { x: 1 } });
  });

  test('returns empty object for null params', () => {
    expect(renderParams(null, {})).toEqual({});
  });

  test('returns empty object for non-object params', () => {
    expect(renderParams('invalid', {})).toEqual({});
  });
});

// ─── evaluateExpression ────────────────────────────────────────────────────────

describe('evaluateExpression', () => {
  test('evaluates numeric literals', () => {
    expect(evaluateExpression('42', {})).toBe(42);
  });

  test('evaluates addition', () => {
    expect(evaluateExpression('1 + 2', {})).toBe(3);
  });

  test('evaluates subtraction', () => {
    expect(evaluateExpression('10 - 3', {})).toBe(7);
  });

  test('evaluates multiplication', () => {
    expect(evaluateExpression('3 * 4', {})).toBe(12);
  });

  test('evaluates division', () => {
    expect(evaluateExpression('10 / 4', {})).toBe(2.5);
  });

  test('evaluates modulo', () => {
    expect(evaluateExpression('10 % 3', {})).toBe(1);
  });

  test('respects operator precedence (* before +)', () => {
    expect(evaluateExpression('2 + 3 * 4', {})).toBe(14);
  });

  test('respects parentheses', () => {
    expect(evaluateExpression('(2 + 3) * 4', {})).toBe(20);
  });

  test('resolves path from scope', () => {
    expect(evaluateExpression('inputs.energyKWh', { inputs: { energyKWh: 44 } })).toBe(44);
  });

  test('evaluates formula with scope values', () => {
    expect(evaluateExpression('inputs.hours * 11', { inputs: { hours: 4 } })).toBe(44);
  });

  test('evaluates complex formula', () => {
    expect(evaluateExpression('inputs.hours * 11 * 0.30', { inputs: { hours: 4 } })).toBeCloseTo(
      13.2
    );
  });

  test('throws for missing path', () => {
    expect(() => evaluateExpression('inputs.missing * 5', { inputs: {} })).toThrow(
      "Missing value at path 'inputs.missing'"
    );
  });

  test('handles unary minus', () => {
    expect(evaluateExpression('-5 + 10', {})).toBe(5);
  });

  test('handles float literals', () => {
    expect(evaluateExpression('3.14 * 2', {})).toBeCloseTo(6.28);
  });

  test('throws on division by zero', () => {
    expect(() => evaluateExpression('10 / 0', {})).toThrow('Division by zero');
  });

  test('throws on unexpected character', () => {
    expect(() => evaluateExpression('10 @ 2', {})).toThrow('Unexpected character');
  });

  test('throws on non-numeric scope value', () => {
    expect(() => evaluateExpression('inputs.name + 1', { inputs: { name: 'Berlin' } })).toThrow(
      'Non-numeric'
    );
  });
});

// ─── findLowestContiguousAverage ─────────────────────────────────────────────

describe('findLowestContiguousAverage', () => {
  test('finds the lowest window in simple array', () => {
    const data = [10, 8, 3, 2, 7, 9];
    const result = findLowestContiguousAverage(data, 2);
    expect(result.startIndex).toBe(2);
    expect(result.endIndex).toBe(3);
    expect(result.windowSize).toBe(2);
    expect(result.averageValue).toBe(2.5);
    expect(result.values).toEqual([3, 2]);
  });

  test('returns entire array as window when windowSize equals array length', () => {
    const data = [5, 3, 4];
    const result = findLowestContiguousAverage(data, 3);
    expect(result.startIndex).toBe(0);
    expect(result.windowSize).toBe(3);
    expect(result.values).toEqual([5, 3, 4]);
  });

  test('handles window of size 1 (minimum)', () => {
    const data = [10, 2, 7, 5];
    const result = findLowestContiguousAverage(data, 1);
    expect(result.startIndex).toBe(1);
    expect(result.averageValue).toBe(2);
  });

  test('returns null for empty array', () => {
    expect(findLowestContiguousAverage([], 2)).toBeNull();
  });

  test('returns null for windowSize larger than array', () => {
    expect(findLowestContiguousAverage([1, 2], 5)).toBeNull();
  });

  test('returns null for non-array input', () => {
    expect(findLowestContiguousAverage(null, 2)).toBeNull();
  });

  test('returns null for windowSize of 0', () => {
    expect(findLowestContiguousAverage([1, 2, 3], 0)).toBeNull();
  });

  test('CO2 scenario: 4h charging window in 24h forecast', () => {
    const forecast = [
      350, 320, 300, 290, 280, 270, 260, 250, 240, 230, 220, 200, 210, 230, 270, 300, 320, 340, 360,
      380, 370, 360, 340, 320,
    ];
    const result = findLowestContiguousAverage(forecast, 4);
    expect(result).not.toBeNull();
    expect(result.windowSize).toBe(4);
    expect(result.startIndex).toBeGreaterThanOrEqual(0);
    expect(result.endIndex).toBe(result.startIndex + 3);
    const manualAvg = result.values.reduce((s, v) => s + v, 0) / 4;
    expect(result.averageValue).toBeCloseTo(manualAvg);
  });

  test('picks first window on tie', () => {
    const data = [5, 5, 5, 5];
    const result = findLowestContiguousAverage(data, 2);
    expect(result.startIndex).toBe(0);
  });
});

// ─── applyMapping ─────────────────────────────────────────────────────────────

describe('applyMapping', () => {
  describe('find_lowest_contiguous_average', () => {
    test('resolves numeric windowSize', () => {
      const scope = {
        steps: { fetch_co2: { output: { forecast: [8, 3, 5, 2, 7] } } },
      };
      const mapping = {
        strategy: 'find_lowest_contiguous_average',
        source: 'steps.fetch_co2.output.forecast',
        windowSize: 2,
      };
      const result = applyMapping(mapping, scope);
      expect(result.startIndex).toBe(2);
      expect(result.averageValue).toBe(3.5);
    });

    test('resolves string path windowSize from scope', () => {
      const scope = {
        inputs: { chargingDurationHours: 3 },
        steps: { fetch_co2: { output: { forecast: [9, 4, 2, 3, 8, 7] } } },
      };
      const mapping = {
        strategy: 'find_lowest_contiguous_average',
        source: 'steps.fetch_co2.output.forecast',
        windowSize: 'inputs.chargingDurationHours',
      };
      const result = applyMapping(mapping, scope);
      expect(result.windowSize).toBe(3);
    });
  });

  describe('pluck', () => {
    test('extracts field from each array item', () => {
      const scope = {
        steps: {
          fetch: { output: { items: [{ co2: 10 }, { co2: 20 }, { co2: 30 }] } },
        },
      };
      const mapping = {
        strategy: 'pluck',
        source: 'steps.fetch.output.items',
        field: 'co2',
      };
      expect(applyMapping(mapping, scope)).toEqual([10, 20, 30]);
    });

    test('returns null for non-array source', () => {
      const scope = { steps: { fetch: { output: { items: 'not-array' } } } };
      const mapping = { strategy: 'pluck', source: 'steps.fetch.output.items', field: 'co2' };
      expect(applyMapping(mapping, scope)).toBeNull();
    });

    test('returns source array when no field specified', () => {
      const scope = { steps: { fetch: { output: { items: [1, 2, 3] } } } };
      const mapping = { strategy: 'pluck', source: 'steps.fetch.output.items' };
      expect(applyMapping(mapping, scope)).toEqual([1, 2, 3]);
    });
  });

  describe('filter', () => {
    test('filters array by field value', () => {
      const scope = {
        steps: {
          fetch: {
            output: {
              items: [
                { type: 'solar', value: 10 },
                { type: 'wind', value: 20 },
                { type: 'solar', value: 30 },
              ],
            },
          },
        },
      };
      const mapping = {
        strategy: 'filter',
        source: 'steps.fetch.output.items',
        field: 'type',
        value: 'solar',
      };
      expect(applyMapping(mapping, scope)).toEqual([
        { type: 'solar', value: 10 },
        { type: 'solar', value: 30 },
      ]);
    });

    test('returns null for non-array source', () => {
      const scope = { steps: { fetch: { output: { items: null } } } };
      const mapping = {
        strategy: 'filter',
        source: 'steps.fetch.output.items',
        field: 'type',
        value: 'solar',
      };
      expect(applyMapping(mapping, scope)).toBeNull();
    });

    test('correctly looks up values from dictionary using dictionary_lookup', () => {
      const scope = { steps: { validate: { output: { decision: 'GO_CONDITIONAL' } } } };
      const mapping = {
        strategy: 'dictionary_lookup',
        source: 'steps.validate.output.decision',
        dictionary: {
          GO_CONDITIONAL: 'Genehmigt mit Auflagen',
          GO_DIRECT: 'Direkt genehmigt',
        },
        defaultValue: 'Standard-Fall',
      };
      expect(applyMapping(mapping, scope)).toBe('Genehmigt mit Auflagen');
    });

    test('falls back to defaultValue if key is missing from dictionary', () => {
      const scope = { steps: { validate: { output: { decision: 'UNKNOWN_DECISION' } } } };
      const mapping = {
        strategy: 'dictionary_lookup',
        source: 'steps.validate.output.decision',
        dictionary: {
          GO_CONDITIONAL: 'Genehmigt mit Auflagen',
        },
        defaultValue: 'Standard-Fall',
      };
      expect(applyMapping(mapping, scope)).toBe('Standard-Fall');
    });

    test('falls back to sourceData if key is missing and defaultValue is not specified', () => {
      const scope = { steps: { validate: { output: { decision: 'UNKNOWN_DECISION' } } } };
      const mapping = {
        strategy: 'dictionary_lookup',
        source: 'steps.validate.output.decision',
        dictionary: {
          GO_CONDITIONAL: 'Genehmigt mit Auflagen',
        },
      };
      expect(applyMapping(mapping, scope)).toBe('UNKNOWN_DECISION');
    });
  });

  test('throws for unknown strategy', () => {
    expect(() => applyMapping({ strategy: 'unknown', source: 'x' }, {})).toThrow(
      'Unknown mapping strategy'
    );
  });
});

// ─── validateBlueprint ────────────────────────────────────────────────────────

describe('validateBlueprint', () => {
  test('accepts a valid minimal blueprint', () => {
    const result = validateBlueprint(makeMinimalBlueprint());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('accepts the full EV charging blueprint', () => {
    const result = validateBlueprint(makeFullEVBlueprint());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('rejects null input', () => {
    const result = validateBlueprint(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('blueprint');
  });

  test('rejects array input', () => {
    const result = validateBlueprint([]);
    expect(result.valid).toBe(false);
  });

  test('requires id', () => {
    const result = validateBlueprint(makeMinimalBlueprint({ id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'id')).toBe(true);
  });

  test('requires version', () => {
    const result = validateBlueprint(makeMinimalBlueprint({ version: undefined }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'version')).toBe(true);
  });

  test('requires meta object', () => {
    const result = validateBlueprint(makeMinimalBlueprint({ meta: null }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'meta')).toBe(true);
  });

  test('requires meta.title', () => {
    const bp = makeMinimalBlueprint({
      meta: { title: '', description: 'x', targetAudience: 'end_user' },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'meta.title')).toBe(true);
  });

  test('requires valid targetAudience', () => {
    const bp = makeMinimalBlueprint({
      meta: { title: 'T', description: 'D', targetAudience: 'unknown' },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'meta.targetAudience')).toBe(true);
  });

  test('accepts all valid targetAudience values', () => {
    for (const audience of ['end_user', 'grid_operator', 'internal']) {
      const bp = makeMinimalBlueprint({
        meta: { title: 'T', description: 'D', targetAudience: audience },
      });
      expect(validateBlueprint(bp).valid).toBe(true);
    }
  });

  test('requires execution object', () => {
    const result = validateBlueprint(makeMinimalBlueprint({ execution: null }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'execution')).toBe(true);
  });

  test('requires at least one execution step', () => {
    const result = validateBlueprint(makeMinimalBlueprint({ execution: { steps: [] } }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'execution.steps')).toBe(true);
  });

  test('rejects duplicate step ids', () => {
    const bp = makeMinimalBlueprint({
      execution: {
        steps: [
          { id: 'step1', action: 'service.action' },
          { id: 'step1', action: 'service.action2' },
        ],
      },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Duplicate step id'))).toBe(true);
  });

  test('requires step action', () => {
    const bp = makeMinimalBlueprint({
      execution: { steps: [{ id: 'step1', action: '' }] },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
  });

  test('validates input resolveStrategy method', () => {
    const bp = makeMinimalBlueprint({
      inputs: {
        param1: {
          type: 'string',
          required: true,
          resolveStrategy: { method: 'invalid_method' },
        },
      },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('resolveStrategy.method'))).toBe(true);
  });

  test('rejects invalid postProcessing.mappings strategy', () => {
    const bp = makeMinimalBlueprint({
      postProcessing: {
        mappings: {
          result: { strategy: 'bad_strategy', source: 'steps.x.output' },
        },
      },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('strategy'))).toBe(true);
  });

  test('rejects mapping without source', () => {
    const bp = makeMinimalBlueprint({
      postProcessing: {
        mappings: {
          result: { strategy: 'pluck' },
        },
      },
    });
    const result = validateBlueprint(bp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('.source'))).toBe(true);
  });
});

// ─── executeBlueprint ─────────────────────────────────────────────────────────

describe('executeBlueprint', () => {
  test('throws if callAction is not a function', async () => {
    const bp = makeMinimalBlueprint();
    await expect(
      executeBlueprint(bp, { inputs: {}, callAction: 'not-a-function' })
    ).rejects.toThrow('callAction must be a function');
  });

  test('returns validation errors for invalid blueprint', async () => {
    const result = await executeBlueprint(null, { inputs: {}, callAction: jest.fn() });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('executes a single step and returns output', async () => {
    const mockOutput = { forecast: [350, 300, 250] };
    const callAction = jest.fn().mockResolvedValue(mockOutput);
    const blueprint = makeMinimalBlueprint();

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259' },
      callAction,
    });

    expect(callAction).toHaveBeenCalledWith('energy-market.co2Forecast', {
      postalCode: '68259',
      hours: 24,
    });
    expect(result.success).toBe(true);
    expect(result.steps.fetch_co2.output).toEqual(mockOutput);
    expect(result.executionTrace[0].status).toBe('success');
  });

  test('template substitution in step params uses inputs', async () => {
    const callAction = jest.fn().mockResolvedValue({ data: [] });
    const blueprint = makeMinimalBlueprint();

    await executeBlueprint(blueprint, {
      inputs: { postalCode: '12345' },
      callAction,
    });

    expect(callAction).toHaveBeenCalledWith('energy-market.co2Forecast', {
      postalCode: '12345',
      hours: 24,
    });
  });

  test('marks step as error when callAction throws', async () => {
    const callAction = jest.fn().mockRejectedValue(new Error('Service unavailable'));
    const blueprint = makeMinimalBlueprint();

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259' },
      callAction,
    });

    expect(result.success).toBe(false);
    expect(result.executionTrace[0].status).toBe('error');
    expect(result.executionTrace[0].error).toBe('Service unavailable');
    expect(result.steps.fetch_co2.error).toBe('Service unavailable');
  });

  test('continues to next step when a step fails', async () => {
    const blueprint = {
      ...makeMinimalBlueprint(),
      execution: {
        steps: [
          { id: 'step1', action: 'service.failAction', params: {} },
          { id: 'step2', action: 'service.okAction', params: {} },
        ],
      },
    };
    const callAction = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ ok: true });

    const result = await executeBlueprint(blueprint, { inputs: {}, callAction });

    expect(result.executionTrace).toHaveLength(2);
    expect(result.executionTrace[0].status).toBe('error');
    expect(result.executionTrace[1].status).toBe('success');
  });

  test('executes post-processing calculations', async () => {
    const blueprint = {
      ...makeMinimalBlueprint(),
      postProcessing: {
        calculations: {
          chargingEnergy: 'inputs.hours * 11',
          costEstimate: 'inputs.hours * 11 * 0.30',
        },
      },
    };
    const callAction = jest.fn().mockResolvedValue({ ok: true });

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259', hours: 4 },
      callAction,
    });

    expect(result.postProcessing.chargingEnergy).toBe(44);
    expect(result.postProcessing.costEstimate).toBeCloseTo(13.2);
  });

  test('executes post-processing mappings', async () => {
    const forecast = [
      350, 320, 300, 280, 260, 240, 220, 200, 210, 230, 250, 270, 290, 310, 330, 350, 370, 380, 370,
      360, 340, 320, 300, 280,
    ];
    const blueprint = {
      ...makeMinimalBlueprint(),
      postProcessing: {
        mappings: {
          optimalWindow: {
            strategy: 'find_lowest_contiguous_average',
            source: 'steps.fetch_co2.output.forecast',
            windowSize: 4,
          },
        },
      },
    };
    const callAction = jest.fn().mockResolvedValue({ forecast });

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259' },
      callAction,
    });

    expect(result.postProcessing.optimalWindow).not.toBeNull();
    expect(result.postProcessing.optimalWindow.windowSize).toBe(4);
    expect(result.postProcessing.optimalWindow.values).toHaveLength(4);
  });

  test('renders synthesis success template', async () => {
    const blueprint = {
      ...makeMinimalBlueprint(),
      postProcessing: {
        calculations: { energy: 'inputs.hours * 11' },
      },
      synthesis: {
        evidenceRequired: ['steps.fetch_co2.output'],
        templates: {
          success: 'Energie: {{postProcessing.energy}} kWh für PLZ {{inputs.postalCode}}.',
          error: 'Fehler: keine Daten.',
        },
      },
    };
    const callAction = jest.fn().mockResolvedValue({ ok: true });

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259', hours: 4 },
      callAction,
    });

    expect(result.success).toBe(true);
    expect(result.synthesis.message).toBe('Energie: 44 kWh für PLZ 68259.');
  });

  test('renders synthesis error template when step fails', async () => {
    const blueprint = {
      ...makeMinimalBlueprint(),
      synthesis: {
        evidenceRequired: ['steps.fetch_co2.output'],
        templates: {
          success: 'OK',
          error: 'Fehler: {{inputs.postalCode}} nicht verfügbar.',
        },
      },
    };
    const callAction = jest.fn().mockRejectedValue(new Error('timeout'));

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '99999' },
      callAction,
    });

    expect(result.success).toBe(false);
    expect(result.synthesis.message).toBe('Fehler: 99999 nicht verfügbar.');
  });

  test('collects l3Facts from persistence config', async () => {
    const forecast = [
      300, 250, 200, 220, 280, 320, 340, 360, 350, 330, 310, 290, 270, 250, 230, 210, 200, 190, 200,
      220, 250, 280, 300, 320,
    ];
    const blueprint = {
      ...makeMinimalBlueprint(),
      postProcessing: {
        mappings: {
          optimalWindow: {
            strategy: 'find_lowest_contiguous_average',
            source: 'steps.fetch_co2.output.forecast',
            windowSize: 4,
          },
        },
      },
      persistence: {
        l3_facts: {
          optimalChargingWindow: 'postProcessing.optimalWindow',
          postalCode: 'inputs.postalCode',
        },
      },
    };
    const callAction = jest.fn().mockResolvedValue({ forecast });

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259' },
      callAction,
    });

    expect(result.l3Facts.postalCode).toBe('68259');
    expect(result.l3Facts.optimalChargingWindow).not.toBeNull();
    expect(result.l3Facts.optimalChargingWindow.windowSize).toBe(4);
  });

  test('detects missing evidence', async () => {
    const blueprint = {
      ...makeMinimalBlueprint(),
      synthesis: {
        evidenceRequired: ['steps.fetch_co2.output.forecast', 'steps.missing_step.output'],
        templates: { success: 'OK', error: 'Missing evidence.' },
      },
    };
    const callAction = jest.fn().mockResolvedValue({ ok: true });

    const result = await executeBlueprint(blueprint, {
      inputs: { postalCode: '68259' },
      callAction,
    });

    expect(result.success).toBe(false);
    expect(result.missingEvidence).toContain('steps.missing_step.output');
  });

  test('blueprintId is set in result', async () => {
    const callAction = jest.fn().mockResolvedValue({});
    const result = await executeBlueprint(makeMinimalBlueprint(), { inputs: {}, callAction });
    expect(result.blueprintId).toBe('ev-charging-co2-optimization-v1');
  });

  test('version is propagated to result', async () => {
    const callAction = jest.fn().mockResolvedValue({});
    const result = await executeBlueprint(makeMinimalBlueprint(), { inputs: {}, callAction });
    expect(result.version).toBe('1.0.0');
  });

  test('inputs are reflected in result', async () => {
    const callAction = jest.fn().mockResolvedValue({});
    const result = await executeBlueprint(makeMinimalBlueprint(), {
      inputs: { postalCode: '68259', extra: 'val' },
      callAction,
    });
    expect(result.inputs.postalCode).toBe('68259');
    expect(result.inputs.extra).toBe('val');
  });

  // ── Full EV Charging CO2 Optimization Integration Test ─────────────────────

  describe('EV Charging CO2 Optimization - Full Blueprint', () => {
    const co2Forecast = [
      350, 330, 310, 290, 270, 250, 230, 210, 195, 190, 200, 220, 240, 260, 280, 300, 320, 340, 360,
      370, 360, 340, 320, 300,
    ];
    const spotPrices = { current: 0.28, peak: 0.35 };

    let callAction;
    let result;

    beforeAll(async () => {
      callAction = jest.fn().mockImplementation((action, params) => {
        if (action === 'energy-market.co2Forecast') {
          return Promise.resolve({
            forecast: co2Forecast,
            unit: 'g_CO2/kWh',
            postalCode: params.postalCode,
          });
        }
        if (action === 'energy-market.spotPrice') {
          return Promise.resolve(spotPrices);
        }
        return Promise.reject(new Error(`Unknown action: ${action}`));
      });

      result = await executeBlueprint(makeFullEVBlueprint(), {
        inputs: { postalCode: '68259', chargingDurationHours: 4 },
        callAction,
      });
    });

    test('succeeds', () => {
      expect(result.success).toBe(true);
    });

    test('called both L1 services', () => {
      expect(callAction).toHaveBeenCalledTimes(2);
      expect(callAction).toHaveBeenCalledWith('energy-market.co2Forecast', {
        postalCode: '68259',
        hours: 24,
      });
      expect(callAction).toHaveBeenCalledWith('energy-market.spotPrice', { postalCode: '68259' });
    });

    test('calculates chargingEnergy correctly (4h * 11 kW = 44 kWh)', () => {
      expect(result.postProcessing.chargingEnergy).toBe(44);
    });

    test('calculates costEstimate correctly (44 kWh * €0.30 = €13.20)', () => {
      expect(result.postProcessing.costEstimate).toBeCloseTo(13.2);
    });

    test('finds optimal 4-hour CO2 window', () => {
      const window = result.postProcessing.optimalWindow;
      expect(window).not.toBeNull();
      expect(window.windowSize).toBe(4);
      expect(window.values).toHaveLength(4);
      const allAvgs = [];
      for (let i = 0; i <= co2Forecast.length - 4; i++) {
        const slice = co2Forecast.slice(i, i + 4);
        allAvgs.push(slice.reduce((s, v) => s + v, 0) / 4);
      }
      const minAvg = Math.min(...allAvgs);
      expect(window.averageValue).toBeCloseTo(minAvg);
    });

    test('optimal window is in expected overnight low range (hours 8–11)', () => {
      expect(result.postProcessing.optimalWindow.startIndex).toBeGreaterThanOrEqual(7);
      expect(result.postProcessing.optimalWindow.startIndex).toBeLessThanOrEqual(10);
    });

    test('renders meaningful synthesis message', () => {
      expect(result.synthesis.message).toContain('Uhr');
      expect(result.synthesis.message).toContain('kWh');
      expect(result.synthesis.message).toMatch(/\d/);
    });

    test('stores l3Facts with postalCode', () => {
      expect(result.l3Facts.postalCode).toBe('68259');
    });

    test('stores optimalChargingWindow in l3Facts', () => {
      expect(result.l3Facts.optimalChargingWindow).toEqual(result.postProcessing.optimalWindow);
    });

    test('execution trace has 2 successful steps', () => {
      expect(result.executionTrace).toHaveLength(2);
      expect(result.executionTrace.every((t) => t.status === 'success')).toBe(true);
    });
  });
});
