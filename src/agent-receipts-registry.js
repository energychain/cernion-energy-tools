'use strict';

const crypto = require('crypto');

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result = {};
  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

function stableHash(value) {
  const canonical = canonicalize(value);
  const payload = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function normalizeScalarType(type) {
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') return 'array';
  if (type === 'object') return 'object';
  return 'string';
}

function toJsonSchemaProperty(definition) {
  if (typeof definition === 'string') {
    return { type: normalizeScalarType(definition) };
  }

  const source = isPlainObject(definition) ? definition : {};
  const property = {
    type: normalizeScalarType(source.type),
  };

  if (Array.isArray(source.values) && source.values.length > 0) {
    property.enum = source.values.slice(0, 200);
  }

  if (source.type === 'array') {
    if (isPlainObject(source.items)) {
      property.items = toJsonSchemaProperty(source.items);
    } else {
      property.items = { type: 'string' };
    }
  }

  if (source.type === 'object' && isPlainObject(source.props)) {
    const nested = moleculerParamsToJsonSchema(source.props);
    property.properties = nested.properties;
    property.required = nested.required;
  }

  return property;
}

function moleculerParamsToJsonSchema(paramsDef) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {},
    required: [],
  };

  if (!isPlainObject(paramsDef)) {
    return schema;
  }

  for (const [param, definition] of Object.entries(paramsDef)) {
    schema.properties[param] = toJsonSchemaProperty(definition);

    if (!(isPlainObject(definition) && definition.optional)) {
      schema.required.push(param);
    }
  }

  return schema;
}

function toActionSignature(actionInfo) {
  return stableHash({
    action: actionInfo.action,
    paramsSchema: actionInfo.paramsSchema,
  });
}

function buildActionRegistry(broker) {
  const registry = {};
  if (!broker?.registry || typeof broker.registry.getServiceList !== 'function') {
    return registry;
  }

  const services = broker.registry.getServiceList({ withActions: true });

  for (const service of services) {
    if (!service?.actions) continue;

    for (const actionName of Object.keys(service.actions)) {
      const action = service.actions[actionName] || {};
      const shortName = actionName.includes('.') ? actionName.split('.').pop() : actionName;
      const fullAction = `${service.name}.${shortName}`;
      const schemaAction =
        service?.schema?.actions?.[shortName] || service?.schema?.actions?.[actionName];
      const paramsDef =
        (isPlainObject(action.params) && action.params) ||
        (isPlainObject(schemaAction?.params) && schemaAction.params) ||
        null;

      const paramsSchema = moleculerParamsToJsonSchema(paramsDef);

      const info = {
        service: service.name,
        action: fullAction,
        paramsSchema,
      };

      registry[fullAction] = {
        ...info,
        signature: toActionSignature(info),
      };
    }
  }

  return registry;
}

function getActionInfo(registry, actionRef) {
  if (!isPlainObject(registry)) return null;
  return registry[actionRef] || null;
}

module.exports = {
  buildActionRegistry,
  getActionInfo,
  stableHash,
};
