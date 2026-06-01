'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_AUDIENCES = new Set(['end_user', 'grid_operator', 'internal']);
const RESOLVE_METHODS = new Set(['llm_extraction', 'static_default', 'context_lookup']);
const MAPPING_STRATEGIES = new Set(['find_lowest_contiguous_average', 'pluck', 'filter']);

// ─── Blueprint Validator ──────────────────────────────────────────────────────

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateBlueprintInputs(inputs, errors) {
  if (inputs == null) return;
  if (!isPlainObject(inputs)) {
    errors.push({ field: 'inputs', message: 'inputs must be an object when provided.' });
    return;
  }
  for (const [paramName, paramDef] of Object.entries(inputs)) {
    const field = `inputs.${paramName}`;
    if (!isPlainObject(paramDef)) {
      errors.push({ field, message: 'Each input definition must be an object.' });
      continue;
    }
    const allowedTypes = new Set(['string', 'number', 'boolean', 'object']);
    if (paramDef.type != null && !allowedTypes.has(paramDef.type)) {
      errors.push({
        field: `${field}.type`,
        message: `type must be one of: ${[...allowedTypes].join(', ')}.`,
      });
    }
    if (paramDef.resolveStrategy != null) {
      if (!isPlainObject(paramDef.resolveStrategy)) {
        errors.push({
          field: `${field}.resolveStrategy`,
          message: 'resolveStrategy must be an object.',
        });
      } else if (
        paramDef.resolveStrategy.method != null &&
        !RESOLVE_METHODS.has(paramDef.resolveStrategy.method)
      ) {
        errors.push({
          field: `${field}.resolveStrategy.method`,
          message: `method must be one of: ${[...RESOLVE_METHODS].join(', ')}.`,
        });
      }
    }
  }
}

function validateBlueprintSteps(steps, errors) {
  const stepIds = new Set();
  steps.forEach((step, i) => {
    const field = `execution.steps[${i}]`;
    if (!isPlainObject(step)) {
      errors.push({ field, message: 'Each step must be an object.' });
      return;
    }
    if (typeof step.id !== 'string' || !step.id.trim()) {
      errors.push({ field: `${field}.id`, message: 'Step id is required.' });
    } else if (stepIds.has(step.id.trim())) {
      errors.push({ field: `${field}.id`, message: `Duplicate step id: ${step.id.trim()}.` });
    } else {
      stepIds.add(step.id.trim());
    }
    if (typeof step.action !== 'string' || !step.action.trim()) {
      errors.push({ field: `${field}.action`, message: 'Step action is required.' });
    }
    if (step.params != null && !isPlainObject(step.params)) {
      errors.push({
        field: `${field}.params`,
        message: 'Step params must be an object when provided.',
      });
    }
  });
}

function validateBlueprintPostProcessing(pp, errors) {
  if (pp == null) return;
  if (!isPlainObject(pp)) {
    errors.push({
      field: 'postProcessing',
      message: 'postProcessing must be an object when provided.',
    });
    return;
  }
  if (pp.calculations != null) {
    if (!isPlainObject(pp.calculations)) {
      errors.push({
        field: 'postProcessing.calculations',
        message: 'calculations must be an object.',
      });
    } else {
      for (const [key, formula] of Object.entries(pp.calculations)) {
        if (typeof formula !== 'string' || !formula.trim()) {
          errors.push({
            field: `postProcessing.calculations.${key}`,
            message: 'Formula must be a non-empty string.',
          });
        }
      }
    }
  }
  if (pp.mappings != null) {
    if (!isPlainObject(pp.mappings)) {
      errors.push({ field: 'postProcessing.mappings', message: 'mappings must be an object.' });
    } else {
      for (const [key, mapping] of Object.entries(pp.mappings)) {
        const mField = `postProcessing.mappings.${key}`;
        if (!isPlainObject(mapping)) {
          errors.push({ field: mField, message: 'Each mapping must be an object.' });
          continue;
        }
        if (!MAPPING_STRATEGIES.has(mapping.strategy)) {
          errors.push({
            field: `${mField}.strategy`,
            message: `strategy must be one of: ${[...MAPPING_STRATEGIES].join(', ')}.`,
          });
        }
        if (typeof mapping.source !== 'string' || !mapping.source.trim()) {
          errors.push({ field: `${mField}.source`, message: 'source is required.' });
        }
      }
    }
  }
}

function validateBlueprint(blueprint) {
  const errors = [];

  if (!isPlainObject(blueprint)) {
    return {
      valid: false,
      errors: [{ field: 'blueprint', message: 'Blueprint must be a plain object.' }],
    };
  }

  if (typeof blueprint.id !== 'string' || !blueprint.id.trim()) {
    errors.push({ field: 'id', message: 'id is required.' });
  }

  if (typeof blueprint.version !== 'string' || !blueprint.version.trim()) {
    errors.push({ field: 'version', message: 'version is required.' });
  }

  if (!isPlainObject(blueprint.meta)) {
    errors.push({ field: 'meta', message: 'meta is required and must be an object.' });
  } else {
    if (typeof blueprint.meta.title !== 'string' || !blueprint.meta.title.trim()) {
      errors.push({ field: 'meta.title', message: 'meta.title is required.' });
    }
    if (typeof blueprint.meta.description !== 'string' || !blueprint.meta.description.trim()) {
      errors.push({ field: 'meta.description', message: 'meta.description is required.' });
    }
    if (!TARGET_AUDIENCES.has(blueprint.meta.targetAudience)) {
      errors.push({
        field: 'meta.targetAudience',
        message: `meta.targetAudience must be one of: ${[...TARGET_AUDIENCES].join(', ')}.`,
      });
    }
  }

  if (!isPlainObject(blueprint.execution)) {
    errors.push({ field: 'execution', message: 'execution is required and must be an object.' });
  } else {
    if (!Array.isArray(blueprint.execution.steps) || blueprint.execution.steps.length === 0) {
      errors.push({
        field: 'execution.steps',
        message: 'execution.steps must be a non-empty array.',
      });
    } else {
      validateBlueprintSteps(blueprint.execution.steps, errors);
    }
  }

  validateBlueprintInputs(blueprint.inputs, errors);
  validateBlueprintPostProcessing(blueprint.postProcessing, errors);

  return { valid: errors.length === 0, errors };
}

// ─── Scope & Template Resolution ─────────────────────────────────────────────

function resolvePathInScope(path, scope) {
  if (typeof path !== 'string' || !path.trim()) return undefined;
  return path
    .trim()
    .split('.')
    .reduce((acc, segment) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return acc[segment];
    }, scope);
}

function renderTemplate(template, scope) {
  if (typeof template !== 'string') return template;
  return template.replace(/{{\s*([^}]+)\s*}}/g, (_, rawPath) => {
    const value = resolvePathInScope(rawPath.trim(), scope);
    return value == null ? '' : String(value);
  });
}

function renderParams(params, scope) {
  if (!isPlainObject(params)) return {};
  const rendered = {};
  for (const [key, value] of Object.entries(params)) {
    rendered[key] = typeof value === 'string' ? renderTemplate(value, scope) : value;
  }
  return rendered;
}

// ─── Safe Arithmetic Expression Evaluator ────────────────────────────────────
// Supports: +, -, *, /, %, parentheses, numeric literals, dot-path identifiers.
// No eval() used.

class ExpressionParser {
  constructor(expr, scope) {
    this._tokens = this._tokenize(String(expr || '').trim());
    this._pos = 0;
    this._scope = scope;
  }

  _tokenize(expr) {
    const tokens = [];
    let i = 0;
    while (i < expr.length) {
      const ch = expr[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (/[+\-*\/()%]/.test(ch)) {
        tokens.push({ type: 'op', value: ch });
        i++;
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr[i + 1] || ''))) {
        let num = '';
        while (i < expr.length && /[0-9.]/.test(expr[i])) num += expr[i++];
        tokens.push({ type: 'num', value: parseFloat(num) });
        continue;
      }
      if (/[a-zA-Z_$]/.test(ch)) {
        let id = '';
        while (i < expr.length && /[a-zA-Z0-9_.$]/.test(expr[i])) id += expr[i++];
        tokens.push({ type: 'id', value: id });
        continue;
      }
      throw new Error(`Unexpected character in expression: '${ch}'`);
    }
    tokens.push({ type: 'eof' });
    return tokens;
  }

  _peek() {
    return this._tokens[this._pos];
  }
  _consume() {
    return this._tokens[this._pos++];
  }

  parse() {
    const result = this._parseAddSub();
    if (this._peek().type !== 'eof') {
      throw new Error(
        `Unexpected token at position ${this._pos}: ${JSON.stringify(this._peek().value)}`
      );
    }
    return result;
  }

  _parseAddSub() {
    let left = this._parseMulDiv();
    while (
      this._peek().type === 'op' &&
      (this._peek().value === '+' || this._peek().value === '-')
    ) {
      const op = this._consume().value;
      const right = this._parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  _parseMulDiv() {
    let left = this._parseUnary();
    while (
      this._peek().type === 'op' &&
      (this._peek().value === '*' || this._peek().value === '/' || this._peek().value === '%')
    ) {
      const op = this._consume().value;
      const right = this._parseUnary();
      if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      } else if (op === '%') {
        left = left % right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  _parseUnary() {
    if (this._peek().type === 'op' && this._peek().value === '-') {
      this._consume();
      return -this._parsePrimary();
    }
    if (this._peek().type === 'op' && this._peek().value === '+') {
      this._consume();
      return this._parsePrimary();
    }
    return this._parsePrimary();
  }

  _parsePrimary() {
    const tok = this._peek();
    if (tok.type === 'num') {
      this._consume();
      return tok.value;
    }
    if (tok.type === 'id') {
      this._consume();
      const val = resolvePathInScope(tok.value, this._scope);
      if (val == null) throw new Error(`Missing value at path '${tok.value}'`);
      const num = Number(val);
      if (Number.isNaN(num)) throw new Error(`Non-numeric value at path '${tok.value}': ${val}`);
      return num;
    }
    if (tok.type === 'op' && tok.value === '(') {
      this._consume();
      const inner = this._parseAddSub();
      const close = this._consume();
      if (!close || close.value !== ')') throw new Error('Missing closing parenthesis');
      return inner;
    }
    throw new Error(`Unexpected token: ${JSON.stringify(tok)}`);
  }
}

function evaluateExpression(expr, scope) {
  return new ExpressionParser(expr, scope).parse();
}

// ─── PostProcessing: Mappings ─────────────────────────────────────────────────

function findLowestContiguousAverage(data, windowSize) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const wSize = Number(windowSize);
  if (!Number.isInteger(wSize) || wSize < 1 || wSize > data.length) return null;

  const nums = data.map((v) => Number(v));
  let currentSum = nums.slice(0, wSize).reduce((s, v) => s + v, 0);
  let bestSum = currentSum;
  let bestStart = 0;

  for (let i = 1; i <= nums.length - wSize; i++) {
    currentSum = currentSum - nums[i - 1] + nums[i + wSize - 1];
    if (currentSum < bestSum) {
      bestSum = currentSum;
      bestStart = i;
    }
  }

  return {
    startIndex: bestStart,
    endIndex: bestStart + wSize - 1,
    windowSize: wSize,
    averageValue: bestSum / wSize,
    values: nums.slice(bestStart, bestStart + wSize),
  };
}

function applyMapping(mapping, scope) {
  const sourceData = resolvePathInScope(mapping.source, scope);

  switch (mapping.strategy) {
    case 'find_lowest_contiguous_average': {
      let resolvedWindowSize = mapping.windowSize;
      if (typeof resolvedWindowSize === 'string') {
        // Render template strings like {{inputs.chargingDurationHours}}
        const rendered = renderTemplate(resolvedWindowSize, scope);
        const asNumber = Number(rendered);
        if (!Number.isNaN(asNumber)) {
          resolvedWindowSize = asNumber;
        } else {
          // Try path resolution for bare paths like "inputs.chargingDurationHours"
          resolvedWindowSize = resolvePathInScope(resolvedWindowSize, scope) ?? resolvedWindowSize;
        }
      }
      return findLowestContiguousAverage(sourceData, resolvedWindowSize);
    }
    case 'pluck': {
      if (!Array.isArray(sourceData)) return null;
      const pluckField = mapping.field;
      if (!pluckField) return sourceData;
      return sourceData.map((item) => resolvePathInScope(pluckField, item));
    }
    case 'filter': {
      if (!Array.isArray(sourceData)) return null;
      const filterField = mapping.field;
      const filterValue = mapping.value;
      if (!filterField) return sourceData;
      return sourceData.filter((item) => resolvePathInScope(filterField, item) === filterValue);
    }
    default:
      throw new Error(`Unknown mapping strategy: ${mapping.strategy}`);
  }
}

// ─── Core Executor ────────────────────────────────────────────────────────────

async function executeBlueprint(blueprint, { inputs = {}, callAction } = {}) {
  if (typeof callAction !== 'function') {
    throw new TypeError('callAction must be a function');
  }

  const validation = validateBlueprint(blueprint);
  if (!validation.valid) {
    return {
      success: false,
      blueprintId: blueprint?.id || null,
      errors: validation.errors,
    };
  }

  const stepResults = {};
  const executionTrace = [];

  const buildScope = () => ({ inputs, steps: stepResults });

  // Execute each step sequentially
  for (const step of blueprint.execution.steps) {
    const scope = buildScope();
    const renderedParams = renderParams(step.params || {}, scope);

    const stepTrace = {
      id: step.id,
      action: step.action,
      params: renderedParams,
      status: 'pending',
    };

    try {
      const output = await callAction(step.action, renderedParams);
      stepResults[step.id] = { output, params: renderedParams };
      stepTrace.status = 'success';
      stepTrace.output = output;
    } catch (err) {
      stepResults[step.id] = { error: err.message, params: renderedParams };
      stepTrace.status = 'error';
      stepTrace.error = err.message;
    }

    executionTrace.push(stepTrace);
  }

  // Post-processing calculations and mappings
  const postProcessingResults = {};
  const scope = buildScope();

  if (isPlainObject(blueprint.postProcessing)) {
    if (isPlainObject(blueprint.postProcessing.calculations)) {
      for (const [key, formula] of Object.entries(blueprint.postProcessing.calculations)) {
        try {
          postProcessingResults[key] = evaluateExpression(formula, scope);
        } catch (err) {
          postProcessingResults[key] = { error: `Calculation error: ${err.message}` };
        }
      }
    }

    if (isPlainObject(blueprint.postProcessing.mappings)) {
      const mappingScope = { ...scope, postProcessing: postProcessingResults };
      for (const [key, mapping] of Object.entries(blueprint.postProcessing.mappings)) {
        try {
          postProcessingResults[key] = applyMapping(mapping, mappingScope);
        } catch (err) {
          postProcessingResults[key] = { error: `Mapping error: ${err.message}` };
        }
      }
    }
  }

  // Synthesis
  const synthScope = { ...scope, postProcessing: postProcessingResults };

  const evidenceRequired = Array.isArray(blueprint.synthesis?.evidenceRequired)
    ? blueprint.synthesis.evidenceRequired
    : [];
  const missingEvidence = evidenceRequired.filter((key) => {
    const val = resolvePathInScope(key, synthScope);
    return val == null || (isPlainObject(val) && 'error' in val);
  });

  const hasStepErrors = executionTrace.some((t) => t.status === 'error');
  const successful = !hasStepErrors && missingEvidence.length === 0;

  const synthesisTemplate = successful
    ? blueprint.synthesis?.templates?.success || ''
    : blueprint.synthesis?.templates?.error || '';

  // Persistence: collect L3 facts
  const l3Facts = {};
  if (isPlainObject(blueprint.persistence?.l3_facts)) {
    for (const [factName, path] of Object.entries(blueprint.persistence.l3_facts)) {
      l3Facts[factName] = resolvePathInScope(path, synthScope);
    }
  }

  return {
    success: successful,
    blueprintId: blueprint.id,
    version: blueprint.version,
    inputs,
    steps: stepResults,
    executionTrace,
    postProcessing: postProcessingResults,
    missingEvidence,
    synthesis: {
      message: renderTemplate(synthesisTemplate, synthScope),
    },
    l3Facts,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  validateBlueprint,
  executeBlueprint,
  evaluateExpression,
  renderTemplate,
  renderParams,
  findLowestContiguousAverage,
  applyMapping,
  resolvePathInScope,
};
