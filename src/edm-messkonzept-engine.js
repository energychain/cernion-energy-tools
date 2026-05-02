/**
 * EDM Messkonzept-Engine
 * Evaluates virtual measurement formulas (SUM, DIFF, NET, CALC, CUSTOM)
 * from aligned input timeseries data
 */

/**
 * Validates CALC/CUSTOM formula syntax for security
 * Allows: +, -, *, /, (, ), Math.max, Math.min, Math.abs
 * Blocks: eval, Function, require, import, etc.
 * @param {string} formula - Formula to validate
 * @returns {boolean} true if valid
 * @throws {Error} if validation fails
 */
function validateCalcFormula(formula) {
  if (typeof formula !== 'string' || !formula.trim()) {
    throw new Error('Formula must be a non-empty string');
  }

  // Blocklist: dangerous identifiers — literal regex, no user input in pattern
  // Uses two separate literals to avoid /g lastIndex state issues between .test() and .match()
  const BLOCKLIST_RE_TEST = /\b(eval|Function|require|import|process|global|__dirname|__filename|fs|child_process|http|https|module|exports|console|setTimeout|setInterval)\b/;
  const BLOCKLIST_RE_MATCH = /\b(eval|Function|require|import|process|global|__dirname|__filename|fs|child_process|http|https|module|exports|console|setTimeout|setInterval)\b/g;
  if (BLOCKLIST_RE_TEST.test(formula)) {
    throw new Error(`Formula contains blocked identifiers: ${formula.match(BLOCKLIST_RE_MATCH).join(', ')}`);
  }

  // Allowlist: only +, -, *, /, (, ), numbers, decimals, spaces, v0-v99, Math.{max,min,abs}
  const tokens = formula.match(/[\w.]+|[+\-*/()]/g) || [];
  for (const token of tokens) {
    // Skip numbers, basic operators, parentheses, variable refs, and Math functions
    if (!/^\d+(\.\d+)?$/.test(token) && // not a number
        !/^[+\-*/()]$/.test(token) &&   // not an operator/paren
        !/^v\d+$/.test(token) &&        // not a variable ref (v0-v99)
        !/^Math\.(max|min|abs)$/.test(token)) { // not Math.function
      throw new Error(`Formula contains disallowed token: ${token}`);
    }
  }

  return true;
}

/**
 * Aligns timestamps from multiple input timeseries
 * Returns sorted unique timestamp set
 * @param {Object} inputData - { input1: [{ts, value}], input2: [...], ... }
 * @returns {number[]} Sorted unique timestamps (ms since epoch)
 */
function alignTimestamps(inputData) {
  const allTimestamps = new Set();

  for (const inputKey in inputData) {
    if (Array.isArray(inputData[inputKey])) {
      for (const point of inputData[inputKey]) {
        if (typeof point.ts === 'number') {
          allTimestamps.add(point.ts);
        }
      }
    }
  }

  return Array.from(allTimestamps).sort((a, b) => a - b);
}

/**
 * Merges aligned input timeseries into per-timestamp evaluation contexts
 * Each context has keys v0, v1, ..., vN for input variables
 * Missing values are set to null
 * @param {Object} inputData - { input1: [{ts, value}], input2: [...], ... }
 * @param {number[]} timestamps - Sorted unique timestamps
 * @returns {Object[]} Array of {ts, values: {v0, v1, ...}}
 */
function mergeByTimestamp(inputData, timestamps) {
  const inputKeys = Object.keys(inputData);
  const indexMaps = {};

  // Pre-build index maps for O(1) lookup
  for (let i = 0; i < inputKeys.length; i++) {
    const key = inputKeys[i];
    const varName = `v${i}`;
    indexMaps[varName] = {};
    if (Array.isArray(inputData[key])) {
      for (const point of inputData[key]) {
        indexMaps[varName][point.ts] = point.value;
      }
    }
  }

  const result = [];
  for (const ts of timestamps) {
    const values = {};
    for (let i = 0; i < inputKeys.length; i++) {
      const varName = `v${i}`;
      values[varName] = indexMaps[varName][ts] !== undefined ? indexMaps[varName][ts] : null;
    }
    result.push({ ts, values });
  }

  return result;
}

/**
 * Safely evaluates CALC/CUSTOM expressions with restricted scope
 * Variables: v0, v1, ..., vN (from mergedData.values)
 * Functions: Math.max, Math.min, Math.abs
 * @param {string} formula - Expression to evaluate
 * @param {Object} values - {v0, v1, ..., vN} values
 * @returns {number|null} Result, or null if any input is null or error occurs
 */
function evaluateCalcExpression(formula, values) {
  try {
    // Check for null values (propagate null)
    for (const key in values) {
      if (values[key] === null) {
        return null;
      }
    }

    // Extract variable names and values
    const varNames = Object.keys(values);
    const varValues = Object.values(values);

    // Create restricted Math object with only allowed functions
    const restrictedMath = {
      max: Math.max,
      min: Math.min,
      abs: Math.abs
    };

    // Create function code that uses the restricted Math
    // Pass Math as a parameter to avoid global namespace issues
    const funcCode = `return ${formula}`;

    // Add Math as a parameter to the function
    const func = new Function(...varNames, 'Math', funcCode);
    const result = func(...varValues, restrictedMath);

    return typeof result === 'number' && !isNaN(result) ? result : null;
  } catch (err) {
    // Return null on evaluation errors (formula syntax error, etc)
    return null;
  }
}

/**
 * Evaluates a messkonzept formula over aligned input timeseries
 * Dispatches to formula-type-specific logic
 * @param {Object} konzept - {type, formula, inputs}
 * @param {Object} inputData - {input1: [...], input2: [...], ...}
 * @returns {Object[]} Array of {ts, value, quality, source} output points
 * @throws {Error} if formula type unsupported or validation fails
 */
function evaluateMesskonzept(konzept, inputData) {
  const { type, formula, inputs } = konzept;

  if (!['SUM', 'DIFF', 'NET', 'CALC', 'CUSTOM'].includes(type)) {
    throw new Error(`Unsupported formula type: ${type}`);
  }

  // Validate CALC/CUSTOM formulas
  if (['CALC', 'CUSTOM'].includes(type)) {
    validateCalcFormula(formula);
  }

  // Align and merge inputs
  const timestamps = alignTimestamps(inputData);
  const mergedData = mergeByTimestamp(inputData, timestamps);

  const results = [];

  if (type === 'SUM') {
    // SUM: All inputs must be non-null (strict), result = sum
    for (const merged of mergedData) {
      let hasNull = false;
      let sum = 0;
      for (let i = 0; i < inputs.length; i++) {
        const val = merged.values[`v${i}`];
        if (val === null) {
          hasNull = true;
          break;
        }
        sum += val;
      }
      results.push({
        ts: merged.ts,
        value: hasNull ? null : sum,
        quality: hasNull ? 'missing_input' : 'virtual',
        source: 'messkonzept:sum'
      });
    }
  } else if (type === 'DIFF') {
    // DIFF: First input is main (must be non-null), rest are subs (null → 0)
    for (const merged of mergedData) {
      const main = merged.values.v0;
      if (main === null) {
        results.push({
          ts: merged.ts,
          value: null,
          quality: 'missing_input',
          source: 'messkonzept:diff'
        });
      } else {
        let diff = main;
        for (let i = 1; i < inputs.length; i++) {
          const sub = merged.values[`v${i}`];
          diff -= (sub !== null ? sub : 0);
        }
        results.push({
          ts: merged.ts,
          value: diff,
          quality: 'virtual',
          source: 'messkonzept:diff'
        });
      }
    }
  } else if (type === 'NET') {
    // NET: Two inputs, difference, both must be non-null
    if (inputs.length !== 2) {
      throw new Error('NET type requires exactly 2 inputs');
    }
    for (const merged of mergedData) {
      const v0 = merged.values.v0;
      const v1 = merged.values.v1;
      if (v0 === null || v1 === null) {
        results.push({
          ts: merged.ts,
          value: null,
          quality: 'missing_input',
          source: 'messkonzept:net'
        });
      } else {
        results.push({
          ts: merged.ts,
          value: v0 - v1,
          quality: 'virtual',
          source: 'messkonzept:net'
        });
      }
    }
  } else if (type === 'CALC' || type === 'CUSTOM') {
    // CALC/CUSTOM: Safe expression evaluation, null propagates
    for (const merged of mergedData) {
      const value = evaluateCalcExpression(formula, merged.values);
      results.push({
        ts: merged.ts,
        value,
        quality: value === null ? 'missing_input' : 'virtual',
        source: type === 'CUSTOM' ? 'messkonzept:custom' : 'messkonzept:calc'
      });
    }
  }

  return results;
}

module.exports = {
  validateCalcFormula,
  alignTimestamps,
  mergeByTimestamp,
  evaluateCalcExpression,
  evaluateMesskonzept
};
