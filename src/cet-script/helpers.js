'use strict';
const { normalizeDatasetTimes } = require('../dataset-time');
const units = require('../dataset-units.json');
const { fail } = require('./errors');
const v = require('./values');
const { namespace } = require('./builtins');
function helpers(budget, asOf) {
  const fn = (work) =>
    v.capability((args, node) => {
      budget.tick(node);
      const result = work(...args);
      return v.copy(result, budget);
    });
  const numeric = (array) => {
    if (
      !Array.isArray(array) ||
      array.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    )
      fail('RUNTIME_ERROR', 'Expected finite numbers');
    budget.tick(null, array.length);
    return array;
  };
  const sum = (array) => numeric(array).reduce((total, value) => total + value, 0);
  const mean = (array) => (array.length ? sum(array) / array.length : null);
  const quantile = (array, q) => {
    numeric(array);
    if (typeof q !== 'number' || q < 0 || q > 1) fail('RUNTIME_ERROR', 'Invalid quantile');
    if (!array.length) return null;
    const sorted = array.slice().sort((a, b) => a - b),
      offset = (sorted.length - 1) * q,
      lower = Math.floor(offset);
    return sorted[lower] + (sorted[Math.ceil(offset)] - sorted[lower]) * (offset - lower);
  };
  const groupBy = (rows, key) => {
    if (!Array.isArray(rows)) fail('RUNTIME_ERROR', 'Expected rows');
    const groups = v.record();
    for (const row of rows) {
      budget.tick();
      const group = v.keyOf(row[v.keyOf(key)]);
      (groups[group] ||= []).push(row);
    }
    return groups;
  };
  const text = (value) => {
    if (typeof value !== 'string') fail('RUNTIME_ERROR', 'Expected text');
    budget.bound('valueBytes', value.length * 2);
    return value;
  };
  const tokens = (value) => {
    const words = [],
      whitespace = ' \n\r\t.,;:!?()[]{}"\'';
    let current = '';
    for (const character of text(value).normalize('NFKC').toLowerCase()) {
      budget.tick();
      if (whitespace.includes(character)) {
        if (current) words.push(current);
        current = '';
      } else current += character;
    }
    if (current) words.push(current);
    return words;
  };
  const parse = (value, options = {}) => {
    if (typeof value !== 'string' && typeof value !== 'number')
      fail('RUNTIME_ERROR', 'Expected explicit timestamp');
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('RUNTIME_ERROR', 'Invalid timestamp');
      return new Date(value).toISOString();
    }
    const normalized = normalizeDatasetTimes(
      [{ t: value }],
      't',
      options.timezone || 'Europe/Berlin'
    ).utc[0];
    if (!normalized) fail('RUNTIME_ERROR', 'Invalid timestamp');
    return normalized;
  };
  const format = (value, options = {}) =>
    normalizeDatasetTimes([{ t: parse(value, options) }], 't', options.timezone || 'Europe/Berlin')
      .local[0];
  const bucket = (value, step, options = {}) => {
    const wall = format(value, options);
    if (step === 'P1M') return parse(wall.slice(0, 7) + '-01T00:00:00', options);
    if (step === 'P1D') return parse(wall.slice(0, 10) + 'T00:00:00', options);
    const size = { PT15M: 900000, PT1H: 3600000 }[step];
    if (!size) fail('RUNTIME_ERROR', 'Invalid time step');
    return new Date(Math.floor(Date.parse(parse(value, options)) / size) * size).toISOString();
  };
  const next = (value, step, options) => {
    const size = { PT15M: 900000, PT1H: 3600000 }[step];
    if (size) return new Date(Date.parse(value) + size).toISOString();
    const date = new Date(format(value, options).replace(' ', 'T') + 'Z');
    if (step === 'P1D') date.setUTCDate(date.getUTCDate() + 1);
    else if (step === 'P1M') date.setUTCMonth(date.getUTCMonth() + 1);
    else fail('RUNTIME_ERROR', 'Invalid time step');
    return parse(date.toISOString().slice(0, 19), options);
  };
  return {
    units: namespace({
      convert: fn((value, from, to) => {
        numeric([value]);
        const source = units[v.keyOf(from)],
          target = units[v.keyOf(to)];
        if (!source || !target || source.dimension !== target.dimension)
          fail('RUNTIME_ERROR', 'Incompatible units');
        return (value * source.factor) / target.factor;
      }),
    }),
    stats: namespace({
      sum: fn(sum),
      mean: fn(mean),
      median: fn((array) => quantile(array, 0.5)),
      quantile: fn(quantile),
      min: fn((array) => numeric(array).reduce((a, b) => (a === null ? b : Math.min(a, b)), null)),
      max: fn((array) => numeric(array).reduce((a, b) => (a === null ? b : Math.max(a, b)), null)),
      stddev: fn((array) => {
        const average = mean(array);
        return average === null
          ? null
          : Math.sqrt(sum(array.map((value) => (value - average) ** 2)) / array.length);
      }),
      groupBy: fn(groupBy),
      pivot: fn((rows, rowKey, colKey, valueKey, aggregation = 'sum') => {
        const result = [];
        for (const [key, group] of Object.entries(groupBy(rows, rowKey))) {
          const row = v.record();
          row[v.keyOf(rowKey)] = key;
          for (const [column, items] of Object.entries(groupBy(group, colKey))) {
            const values = items.map((item) => item[v.keyOf(valueKey)]);
            const aggregate = {
              sum,
              mean,
              min: (list) => numeric(list).reduce((a, b) => Math.min(a, b), Infinity),
              max: (list) => numeric(list).reduce((a, b) => Math.max(a, b), -Infinity),
              count: (list) => list.length,
            }[v.keyOf(aggregation)];
            if (!aggregate) fail('RUNTIME_ERROR', 'Unknown aggregation');
            row[v.keyOf(column)] = aggregate(values);
          }
          result.push(row);
        }
        return result;
      }),
    }),
    text: namespace({
      includes: fn((value, search) => text(value).includes(text(search))),
      normalize: fn((value) => text(value).normalize('NFKC').toLowerCase().trim()),
      tokens: fn(tokens),
      similarity: fn((left, right) => {
        const a = new Set(tokens(left)),
          b = new Set(tokens(right));
        const union = new Set([...a, ...b]);
        return union.size ? [...a].filter((word) => b.has(word)).length / union.size : 1;
      }),
    }),
    time: namespace({
      asOf,
      parse: fn(parse),
      format: fn(format),
      bucket: fn(bucket),
      range: fn((from, to, step, options = {}) => {
        const result = [],
          end = parse(to, options);
        for (
          let instant = parse(from, options);
          instant < end;
          instant = next(instant, step, options)
        ) {
          budget.tick();
          result.push(instant);
          budget.bound('collectionItems', result.length);
        }
        return result;
      }),
    }),
  };
}
module.exports = { helpers };
