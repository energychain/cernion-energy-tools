'use strict';
const { fail } = require('./errors');
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'description',
  'format',
  'title',
]);
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}
function validFormat(value, format) {
  if (format === 'date') return validDate(value);
  const pattern =
    /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  return pattern.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function schemaCheck(schema, node, budget, depth = 0) {
  budget.tick(node);
  const reject = () => fail('FORBIDDEN_SYNTAX', 'Invalid or unsupported input schema', node);
  if (depth > 30 || !object(schema) || Object.keys(schema).some((key) => !KEYS.has(key))) reject();
  checkKeywords(schema, reject);
  if (schema.properties)
    for (const sub of Object.values(schema.properties)) schemaCheck(sub, node, budget, depth + 1);
  if (schema.items) schemaCheck(schema.items, node, budget, depth + 1);
  if (object(schema.additionalProperties))
    schemaCheck(schema.additionalProperties, node, budget, depth + 1);
}
function checkKeywords(schema, reject) {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !types.length ||
      types.some((type) => !TYPES.has(type)) ||
      new Set(types).size !== types.length
    )
      reject();
  }
  if (schema.properties !== undefined && !object(schema.properties)) reject();
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some((key) => typeof key !== 'string') ||
      new Set(schema.required).size !== schema.required.length)
  )
    reject();
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== 'boolean' &&
    !object(schema.additionalProperties)
  )
    reject();
  if (schema.items !== undefined && !object(schema.items)) reject();
  checkLimits(schema, reject);
}
function checkLimits(schema, reject) {
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'])
    if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || schema[key] < 0))
      reject();
  for (const key of ['minimum', 'maximum'])
    if (
      schema[key] !== undefined &&
      (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))
    )
      reject();
  for (const key of ['description', 'title'])
    if (schema[key] !== undefined && typeof schema[key] !== 'string') reject();
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) reject();
  if (schema.format !== undefined && !['date', 'date-time'].includes(schema.format)) reject();
}
function equal(left, right, budget) {
  budget.tick();
  if (left === right) return true;
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key], budget))
  );
}
function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return object(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
function stringCheck(schema, value, budget) {
  if (schema.format && !validFormat(value, schema.format)) return false;
  if (schema.minLength === undefined && schema.maxLength === undefined) return true;
  let length = 0;
  for (const _character of value) {
    if (length % 32 === 0) budget.tick();
    length++;
  }
  return !(length < (schema.minLength ?? 0) || length > (schema.maxLength ?? Infinity));
}
function objectCheck(schema, value, budget) {
  if ((schema.required || []).some((key) => !Object.hasOwn(value, key))) return false;
  for (const [key, item] of Object.entries(value)) {
    budget.tick();
    const rule = schema.properties?.[key];
    if (rule) {
      if (!validate(rule, item, budget)) return false;
      continue;
    }
    if (schema.additionalProperties === false) return false;
    if (object(schema.additionalProperties) && !validate(schema.additionalProperties, item, budget))
      return false;
  }
  return true;
}
function validate(schema, value, budget) {
  budget.tick();
  if (value === undefined) return false;
  if (
    schema.type !== undefined &&
    !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((type) =>
      typeMatches(value, type)
    )
  )
    return false;
  if (Object.hasOwn(schema, 'const') && !equal(value, schema.const, budget)) return false;
  if (schema.enum && !schema.enum.some((item) => equal(value, item, budget))) return false;
  return validateKind(schema, value, budget);
}
function validateKind(schema, value, budget) {
  if (typeof value === 'number')
    return (
      Number.isFinite(value) &&
      value >= (schema.minimum ?? -Infinity) &&
      value <= (schema.maximum ?? Infinity)
    );
  if (typeof value === 'string') return stringCheck(schema, value, budget);
  if (Array.isArray(value))
    return (
      value.length >= (schema.minItems ?? 0) &&
      value.length <= (schema.maxItems ?? Infinity) &&
      (!schema.items || value.every((item) => validate(schema.items, item, budget)))
    );
  if (object(value)) return objectCheck(schema, value, budget);
  return true;
}
function inputValidator(schema, node, budget) {
  schemaCheck(schema, node, budget);
  return (value) => validate(schema, value, budget);
}
module.exports = { inputValidator };
