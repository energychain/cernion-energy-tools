'use strict';

const Ajv = require('ajv');
const ajv = new Ajv({ strict: false });
const validators = new WeakMap();

function validate(schema, result) {
  if (!validators.has(schema)) validators.set(schema, ajv.compile(schema));
  const validator = validators.get(schema);
  if (!validator(result)) throw new Error(JSON.stringify(validator.errors));
  return result;
}

function complete(schema, value) {
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [key, complete(child, value?.[key])])
    );
  if (schema.type === 'array') return (value || []).map((item) => complete(schema.items, item));
  if (value !== undefined) return value;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'boolean') return false;
  if (['integer', 'number'].includes(schema.type)) return schema.minimum || 0;
  return '';
}

module.exports = { complete, validate };
