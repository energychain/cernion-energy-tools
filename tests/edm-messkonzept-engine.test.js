/**
 * EDM Messkonzept Engine Tests
 * Unit tests for formula evaluation logic
 */

const engine = require('../src/edm-messkonzept-engine');

describe('EDM Messkonzept Engine', () => {
  describe('validateCalcFormula', () => {
    it('should accept valid formulas with +, -, *, /', () => {
      expect(() => engine.validateCalcFormula('v0 + v1')).not.toThrow();
      expect(() => engine.validateCalcFormula('v0 - v1')).not.toThrow();
      expect(() => engine.validateCalcFormula('(v0 + v1) * 2')).not.toThrow();
    });

    it('should accept Math.max, Math.min, Math.abs', () => {
      expect(() => engine.validateCalcFormula('Math.max(v0, v1)')).not.toThrow();
      expect(() => engine.validateCalcFormula('Math.min(v0, 100)')).not.toThrow();
      expect(() => engine.validateCalcFormula('Math.abs(v0 - v1)')).not.toThrow();
    });

    it('should reject eval, Function, require', () => {
      expect(() => engine.validateCalcFormula('eval("v0")')).toThrow();
      expect(() => engine.validateCalcFormula('Function("return v0")')).toThrow();
      expect(() => engine.validateCalcFormula('require("fs")')).toThrow();
    });

    it('should reject empty string', () => {
      expect(() => engine.validateCalcFormula('')).toThrow();
      expect(() => engine.validateCalcFormula('   ')).toThrow();
    });

    it('should reject non-string input', () => {
      expect(() => engine.validateCalcFormula(123)).toThrow();
      expect(() => engine.validateCalcFormula(null)).toThrow();
    });
  });

  describe('alignTimestamps', () => {
    it('should return sorted unique timestamps', () => {
      const inputData = {
        input1: [
          { ts: 1000, value: 10 },
          { ts: 3000, value: 30 },
        ],
        input2: [
          { ts: 2000, value: 20 },
          { ts: 3000, value: 30 },
        ],
      };

      const result = engine.alignTimestamps(inputData);
      expect(result).toEqual([1000, 2000, 3000]);
    });

    it('should handle empty inputs', () => {
      const result = engine.alignTimestamps({});
      expect(result).toEqual([]);
    });

    it('should handle inputs with empty arrays', () => {
      const inputData = {
        input1: [],
        input2: [],
      };
      const result = engine.alignTimestamps(inputData);
      expect(result).toEqual([]);
    });

    it('should handle non-array inputs gracefully', () => {
      const inputData = {
        input1: [{ ts: 1000, value: 10 }],
        input2: null,
      };
      const result = engine.alignTimestamps(inputData);
      expect(result).toEqual([1000]);
    });
  });

  describe('mergeByTimestamp', () => {
    it('should merge inputs with same timestamps', () => {
      const inputData = {
        input1: [{ ts: 1000, value: 10 }],
        input2: [{ ts: 1000, value: 20 }],
      };
      const timestamps = [1000];

      const result = engine.mergeByTimestamp(inputData, timestamps);
      expect(result).toEqual([
        {
          ts: 1000,
          values: { v0: 10, v1: 20 },
        },
      ]);
    });

    it('should set null for missing values', () => {
      const inputData = {
        input1: [{ ts: 1000, value: 10 }],
        input2: [{ ts: 2000, value: 20 }],
      };
      const timestamps = [1000, 2000];

      const result = engine.mergeByTimestamp(inputData, timestamps);
      expect(result).toEqual([
        {
          ts: 1000,
          values: { v0: 10, v1: null },
        },
        {
          ts: 2000,
          values: { v0: null, v1: 20 },
        },
      ]);
    });

    it('should handle empty timestamp array', () => {
      const inputData = {
        input1: [{ ts: 1000, value: 10 }],
      };
      const result = engine.mergeByTimestamp(inputData, []);
      expect(result).toEqual([]);
    });
  });

  describe('evaluateCalcExpression', () => {
    it('should evaluate simple arithmetic', () => {
      expect(engine.evaluateCalcExpression('v0 + v1', { v0: 5, v1: 3 })).toBe(8);
      expect(engine.evaluateCalcExpression('v0 - v1', { v0: 10, v1: 4 })).toBe(6);
      expect(engine.evaluateCalcExpression('v0 * v1', { v0: 3, v1: 4 })).toBe(12);
      expect(engine.evaluateCalcExpression('v0 / v1', { v0: 20, v1: 4 })).toBe(5);
    });

    it('should support Math.max, Math.min, Math.abs', () => {
      expect(engine.evaluateCalcExpression('Math.max(v0, v1)', { v0: 5, v1: 10 })).toBe(10);
      expect(engine.evaluateCalcExpression('Math.min(v0, v1)', { v0: 5, v1: 10 })).toBe(5);
      expect(engine.evaluateCalcExpression('Math.abs(v0 - v1)', { v0: 5, v1: 15 })).toBe(10);
    });

    it('should return null if any value is null', () => {
      expect(engine.evaluateCalcExpression('v0 + v1', { v0: 5, v1: null })).toBeNull();
      expect(engine.evaluateCalcExpression('v0 + v1', { v0: null, v1: 10 })).toBeNull();
    });

    it('should return null on formula evaluation error', () => {
      expect(engine.evaluateCalcExpression('invalid', { v0: 5 })).toBeNull();
      expect(engine.evaluateCalcExpression('v0 +', { v0: 5 })).toBeNull();
    });

    it('should return null if result is NaN', () => {
      expect(engine.evaluateCalcExpression('0 / 0', {})).toBeNull();
    });
  });

  describe('evaluateMesskonzept - SUM type', () => {
    it('should sum all inputs when non-null', () => {
      const konzept = {
        type: 'SUM',
        formula: null,
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [
          { ts: 1000, value: 10 },
          { ts: 2000, value: 20 },
        ],
        b: [
          { ts: 1000, value: 5 },
          { ts: 2000, value: 5 },
        ],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result).toEqual([
        { ts: 1000, value: 15, quality: 'virtual', source: 'messkonzept:sum' },
        { ts: 2000, value: 25, quality: 'virtual', source: 'messkonzept:sum' },
      ]);
    });

    it('should return null if any input is null', () => {
      const konzept = {
        type: 'SUM',
        formula: null,
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 10 }],
        b: [{ ts: 1000, value: null }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBeNull();
      expect(result[0].quality).toBe('missing_input');
    });
  });

  describe('evaluateMesskonzept - DIFF type', () => {
    it('should calculate difference: main - sub1 - sub2', () => {
      const konzept = {
        type: 'DIFF',
        formula: null,
        inputs: [{ ref: 'main' }, { ref: 'sub1' }, { ref: 'sub2' }],
      };
      const inputData = {
        main: [{ ts: 1000, value: 100 }],
        sub1: [{ ts: 1000, value: 30 }],
        sub2: [{ ts: 1000, value: 20 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(50); // 100 - 30 - 20
    });

    it('should treat null subs as 0', () => {
      const konzept = {
        type: 'DIFF',
        formula: null,
        inputs: [{ ref: 'main' }, { ref: 'sub' }],
      };
      const inputData = {
        main: [{ ts: 1000, value: 100 }],
        sub: [{ ts: 1000, value: null }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(100);
    });

    it('should return null if main is null', () => {
      const konzept = {
        type: 'DIFF',
        formula: null,
        inputs: [{ ref: 'main' }, { ref: 'sub' }],
      };
      const inputData = {
        main: [{ ts: 1000, value: null }],
        sub: [{ ts: 1000, value: 20 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBeNull();
    });
  });

  describe('evaluateMesskonzept - NET type', () => {
    it('should calculate v0 - v1', () => {
      const konzept = {
        type: 'NET',
        formula: null,
        inputs: [{ ref: 'in' }, { ref: 'out' }],
      };
      const inputData = {
        in: [{ ts: 1000, value: 100 }],
        out: [{ ts: 1000, value: 30 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(70);
    });

    it('should handle negative net values', () => {
      const konzept = {
        type: 'NET',
        formula: null,
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 30 }],
        b: [{ ts: 1000, value: 100 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(-70);
    });

    it('should return null if either input is null', () => {
      const konzept = {
        type: 'NET',
        formula: null,
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 50 }],
        b: [{ ts: 1000, value: null }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBeNull();
    });

    it('should reject NET with more than 2 inputs', () => {
      const konzept = {
        type: 'NET',
        formula: null,
        inputs: [{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 10 }],
        b: [{ ts: 1000, value: 10 }],
        c: [{ ts: 1000, value: 10 }],
      };

      expect(() => engine.evaluateMesskonzept(konzept, inputData)).toThrow('exactly 2 inputs');
    });
  });

  describe('evaluateMesskonzept - CALC type', () => {
    it('should evaluate custom formula', () => {
      const konzept = {
        type: 'CALC',
        formula: 'v0 * 1.5 + v1',
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 10 }],
        b: [{ ts: 1000, value: 5 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(20); // 10 * 1.5 + 5
    });

    it('should return null if any input is null', () => {
      const konzept = {
        type: 'CALC',
        formula: 'v0 + v1',
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 10 }],
        b: [{ ts: 1000, value: null }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBeNull();
    });

    it('should reject invalid CALC formulas', () => {
      const konzept = {
        type: 'CALC',
        formula: 'eval("danger")',
        inputs: [{ ref: 'a' }],
      };
      const inputData = { a: [{ ts: 1000, value: 10 }] };

      expect(() => engine.evaluateMesskonzept(konzept, inputData)).toThrow();
    });
  });

  describe('evaluateMesskonzept - CUSTOM type', () => {
    it('should evaluate custom formula like CALC', () => {
      const konzept = {
        type: 'CUSTOM',
        formula: 'Math.max(v0, v1)',
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 10 }],
        b: [{ ts: 1000, value: 20 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(20);
      expect(result[0].source).toBe('messkonzept:custom');
    });
  });

  describe('evaluateMesskonzept - edge cases', () => {
    it('should handle 0 values correctly', () => {
      const konzept = {
        type: 'SUM',
        formula: null,
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: 0 }],
        b: [{ ts: 1000, value: 0 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(0);
    });

    it('should handle negative values', () => {
      const konzept = {
        type: 'SUM',
        formula: null,
        inputs: [{ ref: 'a' }, { ref: 'b' }],
      };
      const inputData = {
        a: [{ ts: 1000, value: -10 }],
        b: [{ ts: 1000, value: 25 }],
      };

      const result = engine.evaluateMesskonzept(konzept, inputData);
      expect(result[0].value).toBe(15);
    });

    it('should reject unknown formula type', () => {
      const konzept = {
        type: 'UNKNOWN',
        formula: null,
        inputs: [],
      };

      expect(() => engine.evaluateMesskonzept(konzept, {})).toThrow('Unsupported formula type');
    });
  });
});
