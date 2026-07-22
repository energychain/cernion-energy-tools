'use strict';

const crypto = require('crypto');

const PLAN_SCHEMA_VERSION = '1.0';
const MAX_OPERATIONS = 20;
const MAX_SOURCE_ROWS = 50000;
const MAX_OUTPUT_ROWS = 500;
const ALLOWED_FILTERS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'contains',
  'isNull',
  'notNull',
]);
const ALLOWED_AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max']);
const ALLOWED_OPERATIONS = new Set([
  'select',
  'filter',
  'sort',
  'limit',
  'aggregate',
  'timeBucket',
  'join',
  'detectMissingIntervals',
  'detectDuplicates',
  'detectOutliers',
]);
const ALLOWED_BUCKETS = new Set(['15min', 'hour', 'day', 'week', 'month']);
// detectMissingIntervals.intervalMinutes bounds - mirrors the existing
// qualityReport Moleculer schema (services/tabular-intelligence.service.js)
// so a raw supplied plan cannot bypass that boundary via queryPlan/executePlan.
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 10080;
// Conservative filter value bounds: keep evidence bounded and prevent
// resource-amplifying plans without adding regex/expression evaluation.
const MAX_FILTER_STRING_LENGTH = 500;
const MAX_FILTER_IN_VALUES = 100;

function canonicalize(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Invalid Date value cannot be canonicalized');
    }
    // Tagged so a Date instance stays distinct from an ordinary ISO string
    // at the same instant, while equal instants still hash identically.
    return { $date: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function hashValue(value) {
  return `sha256:${crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function tenantBinding(tenantId) {
  return hashValue({ tenantId: String(tenantId || 'default') });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/\s/g, '');
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const german = raw.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):?(\d{1,2})?(?::?(\d{1,2}))?)?$/
  );
  if (german) {
    const date = new Date(
      Date.UTC(
        Number(german[3]),
        Number(german[2]) - 1,
        Number(german[1]),
        Number(german[4] || 0),
        Number(german[5] || 0),
        Number(german[6] || 0)
      )
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inferType(values) {
  const present = values.filter((value) => value !== null && value !== undefined && value !== '');
  if (!present.length) return 'empty';
  if (
    present.every((value) => typeof value === 'boolean' || /^(true|false)$/i.test(String(value)))
  ) {
    return 'boolean';
  }
  if (present.every((value) => parseNumber(value) !== null)) return 'number';
  if (present.every((value) => parseDate(value))) return 'timestamp';
  return 'string';
}

function isIdentifierLike(name, values = []) {
  if (/(^|[_\s-])(id|uuid|name|email|iban|adresse|address|malo|melo|mastr)([_\s-]|$)/i.test(name)) {
    return true;
  }
  const present = values.filter((value) => value !== null && value !== undefined && value !== '');
  if (!present.length) return false;
  const idMatches = present.filter((value) =>
    /^(?:DE\d{10,}|S(?:EE|WE|AN|NB)[A-Z0-9]+|[0-9a-f]{8}-[0-9a-f-]{27,})$/i.test(
      String(value).trim()
    )
  );
  return idMatches.length / present.length >= 0.8;
}

function profileRows(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const dictionaryFields = Array.isArray(options.dictionaryFields) ? options.dictionaryFields : [];
  const dictionaryByName = new Map(dictionaryFields.map((field) => [field.name, field]));
  const names = new Set();
  safeRows.forEach((row) => Object.keys(row || {}).forEach((name) => names.add(name)));

  const columns = [...names].sort().map((name) => {
    const values = safeRows.map((row) => row?.[name]);
    const present = values.filter(
      (value) => value !== null && value !== undefined && String(value).trim() !== ''
    );
    const type = inferType(values);
    const numeric = type === 'number' ? present.map(parseNumber).filter((v) => v !== null) : [];
    const timestamps =
      type === 'timestamp'
        ? present
            .map(parseDate)
            .filter(Boolean)
            .sort((a, b) => a - b)
        : [];
    const fieldMeta = dictionaryByName.get(name) || {};
    const sensitive = fieldMeta.privacyFlag === true || isIdentifierLike(name, present);
    const distinct = new Set(present.map((value) => stableStringify(value))).size;
    const column = {
      name,
      type,
      nullable: present.length !== values.length,
      nullCount: values.length - present.length,
      nullRatio: values.length
        ? Number(((values.length - present.length) / values.length).toFixed(6))
        : 0,
      distinctCount: distinct,
      distinctRatio: present.length ? Number((distinct / present.length).toFixed(6)) : 0,
      sensitive,
      semanticRole: fieldMeta.semanticRole || null,
    };

    if (numeric.length) {
      const sum = numeric.reduce((total, value) => total + value, 0);
      column.numeric = {
        min: Math.min(...numeric),
        max: Math.max(...numeric),
        mean: Number((sum / numeric.length).toFixed(9)),
      };
    }
    if (timestamps.length) {
      column.timestamp = {
        min: timestamps[0].toISOString(),
        max: timestamps[timestamps.length - 1].toISOString(),
      };
    }
    if (!sensitive) {
      column.examples = [...new Set(present.map((value) => String(value).slice(0, 80)))].slice(
        0,
        3
      );
    }
    return column;
  });

  const profile = {
    schemaVersion: '1.0',
    sourceId: options.sourceId || null,
    sampledRowCount: safeRows.length,
    totalRows: Number.isFinite(options.totalRows) ? options.totalRows : safeRows.length,
    privacyContext: options.privacyContext || 'ai-agent',
    classification: options.classification || null,
    columns,
    warnings: [],
  };
  profile.hashes = {
    input: hashValue(safeRows),
    profile: hashValue({ ...profile, hashes: undefined }),
  };
  return profile;
}

function buildLlmContext(profiles, options = {}) {
  const maxTokens = Math.max(128, Math.min(8000, Number(options.maxTokens) || 2000));
  const maxChars = maxTokens * 4;
  const compact = (profiles || []).map((profile) => ({
    sourceId: profile.sourceId,
    rowCount: profile.totalRows,
    sampledRowCount: profile.sampledRowCount,
    classification: profile.classification
      ? {
          domainId: profile.classification.domainId || null,
          confidence: profile.classification.confidence ?? null,
          fieldMappings: profile.classification.fieldMappings || {},
        }
      : null,
    columns: (profile.columns || []).map((column) => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      nullRatio: column.nullRatio,
      distinctRatio: column.distinctRatio,
      numeric: column.numeric,
      timestamp: column.timestamp,
      sensitive: column.sensitive,
      examples: column.sensitive ? undefined : column.examples,
    })),
  }));

  const envelope = {
    purpose: 'CET tabular query planning; calculations must be executed by CET',
    planSchemaVersion: PLAN_SCHEMA_VERSION,
    allowedOperations: [...ALLOWED_OPERATIONS],
    profiles: compact,
  };
  let context = stableStringify(envelope);
  let truncated = false;

  if (context.length > maxChars) {
    compact.forEach((profile) => profile.columns.forEach((column) => delete column.examples));
    context = stableStringify(envelope);
    truncated = true;
  }
  while (context.length > maxChars && compact.some((profile) => profile.columns.length > 1)) {
    const largest = [...compact].sort((a, b) => b.columns.length - a.columns.length)[0];
    largest.columns.pop();
    context = stableStringify(envelope);
    truncated = true;
  }
  if (context.length > maxChars) {
    context = context.slice(0, Math.max(0, maxChars - 1)) + '…';
    truncated = true;
  }

  return {
    context,
    estimatedTokens: Math.ceil(context.length / 4),
    maxTokens,
    truncated,
    profileCount: compact.length,
  };
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertField(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new Error(`${label} must be a non-empty field name`);
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// eq/neq/in-item rule: exactly one JSON scalar. Null semantics belong to
// isNull/notNull instead, so null/undefined are deliberately rejected here.
function assertScalarFilterValue(value, label) {
  const valid =
    typeof value === 'boolean' ||
    isFiniteNumber(value) ||
    (typeof value === 'string' && value.length <= MAX_FILTER_STRING_LENGTH);
  if (!valid) {
    throw new Error(
      `${label} must be a boolean, finite number, or string of at most ${MAX_FILTER_STRING_LENGTH} characters`
    );
  }
}

function assertComparableFilterValue(value, label) {
  const validNumber = isFiniteNumber(value);
  const validString =
    typeof value === 'string' && value.trim() !== '' && value.length <= MAX_FILTER_STRING_LENGTH;
  if (!validNumber && !validString) {
    throw new Error(
      `${label} must be a finite number or non-empty string of at most ${MAX_FILTER_STRING_LENGTH} characters`
    );
  }
}

function validateFilterValue(operation, label) {
  const hasValue = Object.prototype.hasOwnProperty.call(operation, 'value');
  if (operation.operator === 'isNull' || operation.operator === 'notNull') {
    if (hasValue) throw new Error(`${label}.value must not be supplied for ${operation.operator}`);
    return;
  }
  if (!hasValue) {
    throw new Error(`${label}.value is required for operator ${operation.operator}`);
  }
  const { value } = operation;
  if (operation.operator === 'eq' || operation.operator === 'neq') {
    assertScalarFilterValue(value, `${label}.value`);
    return;
  }
  if (['gt', 'gte', 'lt', 'lte'].includes(operation.operator)) {
    assertComparableFilterValue(value, `${label}.value`);
    return;
  }
  if (operation.operator === 'contains') {
    if (typeof value !== 'string' || !value.length || value.length > MAX_FILTER_STRING_LENGTH) {
      throw new Error(
        `${label}.value must be a non-empty string of at most ${MAX_FILTER_STRING_LENGTH} characters for contains`
      );
    }
    return;
  }
  if (operation.operator === 'in') {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILTER_IN_VALUES) {
      throw new Error(
        `${label}.value must be an array of 1 to ${MAX_FILTER_IN_VALUES} values for in`
      );
    }
    value.forEach((item, itemIndex) =>
      assertScalarFilterValue(item, `${label}.value[${itemIndex}]`)
    );
  }
}

function validateOperation(operation, index) {
  assertPlainObject(operation, `operations[${index}]`);
  if (!ALLOWED_OPERATIONS.has(operation.op)) {
    throw new Error(`Unsupported operation: ${operation.op}`);
  }
  const label = `operations[${index}]`;
  if (operation.op === 'select') {
    if (!Array.isArray(operation.columns) || !operation.columns.length) {
      throw new Error(`${label}.columns must be a non-empty array`);
    }
    operation.columns.forEach((field) => assertField(field, `${label}.columns`));
  }
  if (operation.op === 'filter') {
    assertField(operation.field, `${label}.field`);
    if (!ALLOWED_FILTERS.has(operation.operator)) {
      throw new Error(`${label}.operator is not allowed`);
    }
    validateFilterValue(operation, label);
  }
  if (operation.op === 'sort') {
    if (!Array.isArray(operation.by) || !operation.by.length) {
      throw new Error(`${label}.by must be a non-empty array`);
    }
    operation.by.forEach((sort) => {
      assertField(sort.field, `${label}.by.field`);
      if (sort.direction && !['asc', 'desc'].includes(sort.direction)) {
        throw new Error(`${label}.by.direction must be asc or desc`);
      }
    });
  }
  if (operation.op === 'limit') {
    if (
      !Number.isInteger(operation.count) ||
      operation.count < 1 ||
      operation.count > MAX_OUTPUT_ROWS
    ) {
      throw new Error(`${label}.count must be between 1 and ${MAX_OUTPUT_ROWS}`);
    }
  }
  if (operation.op === 'aggregate') {
    if (!Array.isArray(operation.metrics) || !operation.metrics.length) {
      throw new Error(`${label}.metrics must be a non-empty array`);
    }
    if (operation.groupBy && !Array.isArray(operation.groupBy)) {
      throw new Error(`${label}.groupBy must be an array`);
    }
    (operation.groupBy || []).forEach((field) => assertField(field, `${label}.groupBy`));
    operation.metrics.forEach((metric) => {
      if (!ALLOWED_AGGREGATES.has(metric.fn))
        throw new Error(`Unsupported aggregate: ${metric.fn}`);
      if (metric.fn !== 'count' || metric.field)
        assertField(metric.field, `${label}.metrics.field`);
      assertField(metric.as, `${label}.metrics.as`);
    });
  }
  if (operation.op === 'timeBucket') {
    assertField(operation.field, `${label}.field`);
    assertField(operation.as, `${label}.as`);
    if (!ALLOWED_BUCKETS.has(operation.interval))
      throw new Error(`Unsupported interval: ${operation.interval}`);
  }
  if (operation.op === 'join') {
    ['left', 'right', 'leftField', 'rightField'].forEach((key) =>
      assertField(operation[key], `${label}.${key}`)
    );
    if (
      operation.matchMode &&
      !['exact', 'hourly-time', 'daily-date'].includes(operation.matchMode)
    ) {
      throw new Error(`${label}.matchMode is not allowed`);
    }
    if (operation.joinType && !['left', 'inner'].includes(operation.joinType)) {
      throw new Error(`${label}.joinType is not allowed`);
    }
  }
  if (['detectMissingIntervals', 'detectOutliers'].includes(operation.op)) {
    assertField(operation.field, `${label}.field`);
  }
  if (operation.op === 'detectMissingIntervals') {
    if (
      !Number.isInteger(operation.intervalMinutes) ||
      operation.intervalMinutes < MIN_INTERVAL_MINUTES ||
      operation.intervalMinutes > MAX_INTERVAL_MINUTES
    ) {
      throw new Error(
        `${label}.intervalMinutes must be an integer between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}`
      );
    }
  }
  if (operation.op === 'detectDuplicates') {
    if (!Array.isArray(operation.fields) || !operation.fields.length) {
      throw new Error(`${label}.fields must be a non-empty array`);
    }
    operation.fields.forEach((field) => assertField(field, `${label}.fields`));
  }
}

function validateAndBindPlan(input, tenantId) {
  assertPlainObject(input, 'plan');
  const plan = clone(input);
  if (plan.schemaVersion && plan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new Error(`Unsupported plan schemaVersion: ${plan.schemaVersion}`);
  }
  plan.schemaVersion = PLAN_SCHEMA_VERSION;
  if (!Array.isArray(plan.sources) || !plan.sources.length || plan.sources.length > 2) {
    throw new Error('plan.sources must contain one or two sources');
  }
  const aliases = new Set();
  plan.sources.forEach((source, index) => {
    assertPlainObject(source, `sources[${index}]`);
    assertField(source.alias, `sources[${index}].alias`);
    assertField(source.sourceId, `sources[${index}].sourceId`);
    if (aliases.has(source.alias)) throw new Error(`Duplicate source alias: ${source.alias}`);
    aliases.add(source.alias);
    if (source.privacyContext && !['ai-agent', 'public'].includes(source.privacyContext)) {
      throw new Error('Only ai-agent or public privacy contexts are allowed');
    }
    source.privacyContext = source.privacyContext || 'ai-agent';
  });
  if (!Array.isArray(plan.operations) || plan.operations.length > MAX_OPERATIONS) {
    throw new Error(`plan.operations must contain at most ${MAX_OPERATIONS} operations`);
  }
  plan.operations.forEach(validateOperation);
  const joins = plan.operations.filter((operation) => operation.op === 'join');
  if (joins.length > 1) throw new Error('Only one join operation is allowed');
  if (plan.sources.length > 1 && joins.length !== 1)
    throw new Error('Two sources require one join');
  if (joins.length && plan.operations[0].op !== 'join')
    throw new Error('Join must be the first operation');
  if (joins.length && (!aliases.has(joins[0].left) || !aliases.has(joins[0].right))) {
    throw new Error('Join aliases must reference declared sources');
  }
  plan.output = plan.output || {};
  plan.output.maxRows = Math.max(
    1,
    Math.min(MAX_OUTPUT_ROWS, Number(plan.output.maxRows) || MAX_OUTPUT_ROWS)
  );
  const expectedBinding = tenantBinding(tenantId);
  if (plan.tenantBinding && plan.tenantBinding !== expectedBinding) {
    const error = new Error('Plan tenant binding does not match request tenant');
    error.code = 'TABULAR_TENANT_MISMATCH';
    throw error;
  }
  plan.tenantBinding = expectedBinding;
  return plan;
}

function compareValues(left, right) {
  const leftNumber = parseNumber(left);
  const rightNumber = parseNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  const leftDate = parseDate(left);
  const rightDate = parseDate(right);
  if (leftDate && rightDate) return leftDate - rightDate;
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function applyFilter(row, operation) {
  const value = row?.[operation.field];
  const target = operation.value;
  switch (operation.operator) {
    case 'eq':
      return compareValues(value, target) === 0;
    case 'neq':
      return compareValues(value, target) !== 0;
    case 'gt':
      return compareValues(value, target) > 0;
    case 'gte':
      return compareValues(value, target) >= 0;
    case 'lt':
      return compareValues(value, target) < 0;
    case 'lte':
      return compareValues(value, target) <= 0;
    case 'in':
      return (
        Array.isArray(target) && target.some((candidate) => compareValues(value, candidate) === 0)
      );
    case 'contains':
      return String(value ?? '')
        .toLowerCase()
        .includes(String(target ?? '').toLowerCase());
    case 'isNull':
      return value === null || value === undefined || value === '';
    case 'notNull':
      return value !== null && value !== undefined && value !== '';
    default:
      return false;
  }
}

function isoWeekStart(date) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

function bucketDate(value, interval) {
  const date = parseDate(value);
  if (!date) return null;
  const bucket = new Date(date.getTime());
  bucket.setUTCSeconds(0, 0);
  if (interval === '15min') bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 15) * 15);
  if (interval === 'hour') bucket.setUTCMinutes(0);
  if (interval === 'day') bucket.setUTCHours(0, 0, 0, 0);
  if (interval === 'week') return isoWeekStart(bucket).toISOString();
  if (interval === 'month') {
    bucket.setUTCDate(1);
    bucket.setUTCHours(0, 0, 0, 0);
  }
  return bucket.toISOString();
}

function aggregateRows(rows, operation) {
  const groupBy = operation.groupBy || [];
  const groups = new Map();
  rows.forEach((row) => {
    const keyValues = groupBy.map((field) => row?.[field] ?? null);
    const key = stableStringify(keyValues);
    if (!groups.has(key)) groups.set(key, { keyValues, rows: [] });
    groups.get(key).rows.push(row);
  });
  if (!groups.size && groupBy.length === 0) groups.set('[]', { keyValues: [], rows: [] });

  return [...groups.values()].map((group) => {
    const output = {};
    groupBy.forEach((field, index) => {
      output[field] = group.keyValues[index];
    });
    operation.metrics.forEach((metric) => {
      const values = metric.field
        ? group.rows.map((row) => parseNumber(row?.[metric.field])).filter((v) => v !== null)
        : [];
      if (metric.fn === 'count') {
        output[metric.as] = metric.field ? values.length : group.rows.length;
      } else if (!values.length) {
        output[metric.as] = null;
      } else if (metric.fn === 'sum') {
        output[metric.as] = values.reduce((sum, value) => sum + value, 0);
      } else if (metric.fn === 'avg') {
        output[metric.as] = values.reduce((sum, value) => sum + value, 0) / values.length;
      } else if (metric.fn === 'min') {
        output[metric.as] = Math.min(...values);
      } else if (metric.fn === 'max') {
        output[metric.as] = Math.max(...values);
      }
    });
    return output;
  });
}

function missingIntervals(rows, operation) {
  // intervalMinutes is guaranteed to be a bounded positive integer by
  // validateAndBindPlan/validateOperation before this ever runs.
  const intervalMinutes = operation.intervalMinutes;
  const expectedMs = intervalMinutes * 60000;
  const dates = rows
    .map((row) => parseDate(row?.[operation.field]))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const missing = [];
  for (let index = 1; index < dates.length; index += 1) {
    let cursor = dates[index - 1].getTime() + expectedMs;
    while (cursor < dates[index].getTime() && missing.length < 1000) {
      missing.push(new Date(cursor).toISOString());
      cursor += expectedMs;
    }
  }
  return { intervalMinutes, missingCount: missing.length, missing: missing.slice(0, 100) };
}

function duplicateSummary(rows, operation) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = stableStringify(operation.fields.map((field) => row?.[field] ?? null));
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const duplicateGroups = [...counts.values()].filter((count) => count > 1);
  return {
    fields: operation.fields,
    duplicateGroupCount: duplicateGroups.length,
    duplicateRowCount: duplicateGroups.reduce((sum, count) => sum + count, 0),
  };
}

function outlierSummary(rows, operation) {
  const values = rows
    .map((row) => parseNumber(row?.[operation.field]))
    .filter((value) => value !== null);
  if (values.length < 3)
    return { field: operation.field, method: 'zscore', threshold: 3, count: 0, values: [] };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  const threshold = Number(operation.threshold) > 0 ? Number(operation.threshold) : 3;
  const outliers = stddev
    ? values.filter((value) => Math.abs((value - mean) / stddev) > threshold)
    : [];
  return {
    field: operation.field,
    method: 'zscore',
    threshold,
    mean,
    stddev,
    count: outliers.length,
    values: outliers.slice(0, 20),
  };
}

function executeOperations(inputRows, operations, outputMaxRows = MAX_OUTPUT_ROWS) {
  let rows = clone(Array.isArray(inputRows) ? inputRows : []);
  const trace = [];
  const warnings = [];

  for (const operation of operations) {
    const before = rows.length;
    let details = null;
    if (operation.op === 'select') {
      rows = rows.map((row) =>
        operation.columns.reduce((result, field) => {
          result[field] = row?.[field] ?? null;
          return result;
        }, {})
      );
    } else if (operation.op === 'filter') {
      rows = rows.filter((row) => applyFilter(row, operation));
    } else if (operation.op === 'sort') {
      rows.sort((left, right) => {
        for (const sort of operation.by) {
          const comparison = compareValues(left?.[sort.field], right?.[sort.field]);
          if (comparison !== 0) return sort.direction === 'desc' ? -comparison : comparison;
        }
        return 0;
      });
    } else if (operation.op === 'limit') {
      rows = rows.slice(0, operation.count);
    } else if (operation.op === 'aggregate') {
      rows = aggregateRows(rows, operation);
    } else if (operation.op === 'timeBucket') {
      rows = rows.map((row) => ({
        ...row,
        [operation.as]: bucketDate(row?.[operation.field], operation.interval),
      }));
      const invalidCount = rows.filter((row) => row[operation.as] === null).length;
      if (invalidCount)
        warnings.push(`${invalidCount} rows had unparseable timestamps in ${operation.field}`);
    } else if (operation.op === 'detectMissingIntervals') {
      details = missingIntervals(rows, operation);
      if (details.missingCount) warnings.push(`${details.missingCount} missing intervals detected`);
    } else if (operation.op === 'detectDuplicates') {
      details = duplicateSummary(rows, operation);
      if (details.duplicateRowCount)
        warnings.push(`${details.duplicateRowCount} duplicate rows detected`);
    } else if (operation.op === 'detectOutliers') {
      details = outlierSummary(rows, operation);
      if (details.count) warnings.push(`${details.count} outliers detected in ${operation.field}`);
    }
    trace.push({ op: operation.op, inputRows: before, outputRows: rows.length, details });
  }

  const truncated = rows.length > outputMaxRows;
  if (truncated) warnings.push(`Result truncated to ${outputMaxRows} rows`);
  return { rows: rows.slice(0, outputMaxRows), trace, warnings, fullResultRowCount: rows.length };
}

function deterministicAnswer(execution) {
  const rows = execution.resultTable || [];
  if (!rows.length) return 'Deterministic execution produced no result rows.';
  if (rows.length === 1) {
    const metrics = Object.entries(rows[0])
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => `${key}=${value}`);
    if (metrics.length) return `Deterministic execution produced: ${metrics.join(', ')}.`;
  }
  return `Deterministic execution produced ${execution.evidence?.resultRowCount ?? rows.length} result rows.`;
}

function heuristicPlan(question, profile, sourceId) {
  const text = String(question || '').toLowerCase();
  const columns = profile?.columns || [];
  const numeric = columns.filter((column) => column.type === 'number');
  const mentioned =
    numeric.find((column) => text.includes(column.name.toLowerCase())) || numeric[0];
  let fn = 'count';
  if (/(sum|summe|gesamt)/.test(text) && mentioned) fn = 'sum';
  else if (/(avg|average|mittel|durchschnitt)/.test(text) && mentioned) fn = 'avg';
  else if (/(maximum|max|höchst)/.test(text) && mentioned) fn = 'max';
  else if (/(minimum|min|niedrig)/.test(text) && mentioned) fn = 'min';
  const metric = { fn, as: fn === 'count' ? 'rowCount' : `${fn}_${mentioned.name}` };
  if (fn !== 'count') metric.field = mentioned.name;
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    sources: [{ alias: 'table', sourceId, privacyContext: 'ai-agent' }],
    operations: [{ op: 'aggregate', groupBy: [], metrics: [metric] }],
    output: { maxRows: MAX_OUTPUT_ROWS },
  };
}

module.exports = {
  PLAN_SCHEMA_VERSION,
  MAX_SOURCE_ROWS,
  MAX_OUTPUT_ROWS,
  hashValue,
  tenantBinding,
  parseNumber,
  parseDate,
  profileRows,
  buildLlmContext,
  validateAndBindPlan,
  executeOperations,
  deterministicAnswer,
  heuristicPlan,
};
