'use strict';

const catalog = require('./tool-display.json');

function displayValue(field, value) {
  if (field.values?.[value]) return field.values[value];
  if (!field.lookup) return '';
  const label = require(`./${field.lookup.module}`).resolveLabel(field.lookup.field, value);
  return !label || label === String(value)
    ? ''
    : label.charAt(0).toLocaleLowerCase('de-DE') + label.slice(1);
}

function readableToolFilters(operation, parameters = {}) {
  const config = catalog[operation];
  if (!config) return '';
  const values = { ...config.defaults, ...parameters };
  return Object.keys(config.fields)
    .filter((name) => Object.hasOwn(values, name))
    .map((name) => [name, values[name]])
    .flatMap(([name, value]) => {
      const field = config.fields[name];
      if (!field || value == null || value === '') return [];
      if (field.values || field.lookup)
        return String(value)
          .split(',')
          .map((code) => displayValue(field, code))
          .filter(Boolean);
      return [
        `${field.prefix || ''}${typeof value === 'number' ? value.toLocaleString('de-DE') : value}${field.suffix || ''}`,
      ];
    })
    .join(', ');
}

function readableToolData(operation, data) {
  const config = catalog[operation];
  if (!config) return data;
  if (Array.isArray(data)) return data.map((value) => readableToolData(operation, value));
  if (!data || typeof data !== 'object') return data;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      const field = config.fields[config.resultFields?.[key]];
      return [key, (field && displayValue(field, value)) || readableToolData(operation, value)];
    })
  );
}

module.exports = { readableToolFilters, readableToolData, catalog };
