'use strict';
const v = require('./values');
const { fail } = require('./errors');
const { parseText } = require('./json');
const STRING_METHODS = new Set([
  'at',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'includes',
  'startsWith',
  'endsWith',
  'indexOf',
  'lastIndexOf',
  'slice',
  'substring',
  'split',
  'trim',
  'trimStart',
  'trimEnd',
  'toLowerCase',
  'toUpperCase',
  'normalize',
  'repeat',
  'padStart',
  'padEnd',
  'replace',
  'replaceAll',
  'concat',
  'localeCompare',
]);
const ARRAY_METHODS = new Set([
  'forEach',
  'map',
  'filter',
  'reduce',
  'reduceRight',
  'flatMap',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'some',
  'every',
  'sort',
  'slice',
  'flat',
  'concat',
  'includes',
  'indexOf',
  'lastIndexOf',
  'join',
  'at',
  'entries',
  'keys',
  'values',
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'reverse',
  'fill',
]);
const CALLBACKS = new Set([
  'forEach',
  'map',
  'filter',
  'reduce',
  'reduceRight',
  'flatMap',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'some',
  'every',
]);
function objectOnly(value, node, mutable = false) {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== null ||
    v.capabilities.has(value) ||
    v.functions.has(value) ||
    v.deferred.has(value) ||
    v.collections.has(value) ||
    (mutable && Object.isFrozen(value))
  )
    fail('CONTAINER_VIOLATION', 'Expected a plain script object', node);
  return value;
}
function setMember(value, key, next, runtime, node) {
  key = v.keyOf(key, node);
  if (Array.isArray(value)) {
    if (key === 'length') {
      if (!Number.isSafeInteger(next) || next < 0)
        fail('RUNTIME_ERROR', 'Invalid array length', node);
      runtime.budget.bound('collectionItems', next, node);
    } else {
      if (!/^(?:0|[1-9]\d*)$/.test(key))
        fail('CONTAINER_VIOLATION', 'Only array indices are writable', node);
      runtime.budget.bound('collectionItems', Number(key) + 1, node);
    }
  } else objectOnly(value, node, true);
  if (Object.isFrozen(value)) fail('CONTAINER_VIOLATION', 'Immutable value', node);
  runtime.budget.allocate(32, node);
  value[key] = next;
  runtime.budget.bound('collectionItems', Object.keys(value).length, node);
  return next;
}
async function callback(runtime, fn, args, node) {
  const definition = v.functions.get(fn);
  if (!definition || definition.node.async)
    fail('RUNTIME_ERROR', 'Expected synchronous script callback', node);
  return runtime.invoke(fn, args, node);
}
async function reduction(array, name, args, runtime, node) {
  let initialized = args.length > 1,
    accumulator = args[1];
  const values = name === 'reduceRight' ? array.slice().reverse() : array;
  for (let i = 0; i < values.length; i++) {
    runtime.budget.tick(node);
    if (!initialized) {
      accumulator = values[i];
      initialized = true;
    } else
      accumulator = await callback(
        runtime,
        args[0],
        [accumulator, values[i], name === 'reduceRight' ? array.length - i - 1 : i, array],
        node
      );
  }
  if (!initialized) fail('RUNTIME_ERROR', 'Empty reduction', node);
  return accumulator;
}
function collectMapped(output, name, mapped, value, runtime, node) {
  if (name === 'map') output.push(mapped);
  if (name === 'flatMap') {
    const items = Array.isArray(mapped) ? mapped : [mapped];
    runtime.budget.bound('collectionItems', output.length + items.length, node);
    runtime.budget.allocate(items.length * 16, node);
    for (const item of items) output.push(item);
  }
  if (name === 'filter' && mapped) output.push(value);
}
function earlyCallback(name, mapped, value, index) {
  if (mapped && ['find', 'findLast'].includes(name)) return { value };
  if (mapped && ['findIndex', 'findLastIndex'].includes(name)) return { value: index };
  if (name === 'some' && mapped) return { value: true };
  if (name === 'every' && !mapped) return { value: false };
  return null;
}
async function arrayCallback(array, name, args, runtime, node) {
  if (['reduce', 'reduceRight'].includes(name)) return reduction(array, name, args, runtime, node);
  const reverse = ['findLast', 'findLastIndex'].includes(name),
    output = [];
  const length = array.length;
  for (let turn = 0; turn < length; turn++) {
    runtime.budget.tick(node);
    const index = reverse ? length - turn - 1 : turn,
      value = array[index];
    const mapped = await callback(runtime, args[0], [value, index, array], node);
    collectMapped(output, name, mapped, value, runtime, node);
    runtime.budget.bound('collectionItems', output.length, node);
    const early = earlyCallback(name, mapped, value, index);
    if (early) return early.value;
  }
  const empty = {
    every: true,
    some: false,
    find: undefined,
    findLast: undefined,
    findIndex: -1,
    findLastIndex: -1,
    forEach: undefined,
  };
  return Object.hasOwn(empty, name) ? empty[name] : output;
}
async function sort(array, comparator, runtime, node) {
  if (!v.functions.has(comparator) || v.functions.get(comparator).node.async)
    fail('FORBIDDEN_SYNTAX', 'sort requires a script comparator', node);
  let source = array.slice();
  for (let width = 1; width < source.length; width *= 2) {
    const target = [];
    for (let start = 0; start < source.length; start += width * 2) {
      let left = start,
        right = Math.min(start + width, source.length);
      const middle = right,
        end = Math.min(start + width * 2, source.length);
      while (left < middle || right < end) {
        runtime.budget.tick(node);
        const takeLeft =
          right >= end ||
          (left < middle &&
            Number(
              v.primitive(
                await callback(runtime, comparator, [source[left], source[right]], node),
                node
              )
            ) <= 0);
        target.push(source[takeLeft ? left++ : right++]);
      }
    }
    source = target;
  }
  for (let i = 0; i < source.length; i++) array[i] = source[i];
  return array;
}
function flat(array, depth, runtime, node) {
  const result = [],
    stack = array.map((item) => [item, depth]).reverse();
  while (stack.length) {
    runtime.budget.tick(node);
    const [value, remaining] = stack.pop();
    if (Array.isArray(value) && remaining > 0) {
      runtime.budget.bound('collectionItems', stack.length + value.length, node);
      for (let i = value.length - 1; i >= 0; i--) stack.push([value[i], remaining - 1]);
    } else result.push(value);
    runtime.budget.bound('collectionItems', result.length, node);
  }
  return result;
}
function joinArray(array, args, runtime, node) {
  const separator = args[0] === undefined ? ',' : String(v.primitive(args[0]));
  let bytes = separator.length * Math.max(0, array.length - 1);
  for (const value of array) bytes += value == null ? 0 : String(v.primitive(value)).length;
  runtime.budget.bound('valueBytes', bytes * 2, node);
  return array.join(separator);
}
function concatArray(array, args, runtime, node) {
  const count =
    array.length + args.reduce((total, item) => total + (Array.isArray(item) ? item.length : 1), 0);
  runtime.budget.bound('collectionItems', count, node);
  return array.concat(...args);
}
async function arrayMethod(array, name, args, runtime, node) {
  runtime.budget.tick(node, array.length + 1);
  const copies = [
    'forEach',
    'map',
    'filter',
    'flatMap',
    'slice',
    'flat',
    'concat',
    'entries',
    'keys',
    'values',
    'sort',
  ];
  runtime.budget.allocate((copies.includes(name) ? array.length * 32 : 0) + args.length * 16, node);
  if (CALLBACKS.has(name)) return arrayCallback(array, name, args, runtime, node);
  if (name === 'sort') return sort(array, args[0], runtime, node);
  if (name === 'entries') return v.iterator(array.map((value, index) => [index, value]));
  if (name === 'keys') return v.iterator(array.map((_, index) => index));
  if (name === 'values') return v.iterator(array.slice());
  if (name === 'flat')
    return flat(array, args[0] === undefined ? 1 : Number(v.primitive(args[0])), runtime, node);
  if (name === 'join') return joinArray(array, args, runtime, node);
  if (name === 'concat') return concatArray(array, args, runtime, node);
  if (['push', 'unshift', 'splice'].includes(name))
    runtime.budget.bound('collectionItems', array.length + args.length, node);
  if (['slice', 'splice', 'at', 'fill'].includes(name)) {
    const offset = name === 'fill' ? 1 : 0;
    for (const arg of args.slice(offset, name === 'splice' ? 2 : undefined)) v.primitive(arg, node);
  }
  const result = array[name](...args);
  runtime.budget.bound('collectionItems', array.length, node);
  return result;
}
function stringMethod(value, key, args, runtime, node) {
  args.forEach((arg) => v.primitive(arg, node));
  const limit = runtime.budget.limits.valueBytes / 2;
  let estimate = value.length;
  if (key === 'repeat') estimate *= Math.max(0, Number(args[0]));
  if (key === 'padStart' || key === 'padEnd') estimate = Math.max(estimate, Number(args[0]));
  if (key === 'concat') estimate += args.reduce((sum, arg) => sum + String(arg).length, 0);
  if (key === 'replaceAll' || key === 'replace')
    estimate += (value.length + 1) * String(args[1] ?? '').length;
  if (!Number.isFinite(estimate) || estimate > limit) runtime.budget.exceed('valueBytes', node);
  if (key === 'split') {
    const count =
      args[0] === undefined
        ? 1
        : Math.min(value.length + 1, args[1] === undefined ? Infinity : Number(args[1]) >>> 0);
    runtime.budget.bound('collectionItems', count, node);
    runtime.budget.allocate(count * 32, node);
  }
  runtime.budget.allocate(estimate * 2, node);
  runtime.budget.tick(node, Math.max(1, Math.ceil(estimate / 32)));
  const result = value[key](...args);
  if (Array.isArray(result)) runtime.budget.bound('collectionItems', result.length, node);
  return result;
}
function collectionMember(value, key, runtime, node) {
  const collection = v.collections.get(value);
  if (collection.type === 'Iterator') {
    if (key !== 'next') return undefined;
    return v.capability(() => {
      runtime.budget.tick(node);
      const done = collection.cursor >= collection.data.length;
      return Object.assign(v.record(), {
        value: done ? undefined : collection.data[collection.cursor++],
        done,
      });
    });
  }
  if (key === 'size') return collection.data.size;
  const allowed =
    collection.type === 'Map'
      ? ['get', 'set', 'has', 'delete', 'clear', 'entries', 'keys', 'values']
      : ['add', 'has', 'delete', 'clear', 'entries', 'keys', 'values'];
  if (!allowed.includes(key)) return undefined;
  return v.capability((args) => {
    runtime.budget.tick(node);
    if (key === 'set' || key === 'add') {
      runtime.budget.bound('collectionItems', collection.data.size + 1, node);
      runtime.budget.allocate(64, node);
    }
    const result = collection.data[key](...args);
    if (result === collection.data) return value;
    if (['entries', 'keys', 'values'].includes(key)) return v.iterator([...result]);
    return result;
  });
}
function getMember(value, key, runtime, node) {
  key = v.keyOf(key, node);
  if (value == null) fail('RUNTIME_ERROR', 'Cannot read absent value', node);
  if (typeof value === 'string') {
    if (key === 'length') return value.length;
    if (/^(?:0|[1-9]\d*)$/.test(key)) return value[Number(key)];
    return STRING_METHODS.has(key)
      ? v.capability((args) => stringMethod(value, key, args, runtime, node))
      : undefined;
  }
  if (typeof value === 'number') {
    if (key === 'toFixed')
      return v.capability((args) => value.toFixed(...args.map((arg) => v.primitive(arg, node))));
    return undefined;
  }
  if (v.collections.has(value)) return collectionMember(value, key, runtime, node);
  if (Array.isArray(value)) {
    if (key === 'length' || /^(?:0|[1-9]\d*)$/.test(key)) return value[key];
    if (ARRAY_METHODS.has(key))
      return v.capability((args) => arrayMethod(value, key, args, runtime, node));
    return undefined;
  }
  const property = Object.getOwnPropertyDescriptor(value, key);
  if (property && !Object.hasOwn(property, 'value'))
    fail('CONTAINER_VIOLATION', 'Accessor rejected', node);
  return property?.value;
}
function namespace(entries) {
  return Object.freeze(Object.assign(v.record(), entries));
}
function callable(fn, entries = {}) {
  const value = namespace(entries);
  v.capabilities.set(value, { fn, async: false });
  return value;
}
function builtins(runtime) {
  const simple = (fn) =>
    v.capability((args, node) => fn(...args.map((arg) => v.primitive(arg, node))));
  const objectEntries = (value, node) =>
    Object.keys(Array.isArray(value) ? value : objectOnly(value, node)).map((key) => [
      v.keyOf(key, node),
      getMember(value, key, runtime, node),
    ]);
  const object = namespace({
    keys: v.capability(([value], node) => objectEntries(value, node).map(([key]) => key)),
    values: v.capability(([value], node) => objectEntries(value, node).map(([, item]) => item)),
    entries: v.capability(([value], node) => objectEntries(value, node)),
    fromEntries: v.capability(([entries], node) => {
      const result = v.record();
      for (const entry of v.sequence(entries, node)) {
        if (!entry || typeof entry !== 'object') fail('RUNTIME_ERROR', 'Expected entry pair', node);
        runtime.budget.tick(node);
        result[v.keyOf(entry[0], node)] = entry[1];
      }
      return result;
    }),
    assign: v.capability(([target, ...sources], node) => {
      objectOnly(target, node, true);
      for (const source of sources)
        for (const [key, value] of objectEntries(source, node)) {
          runtime.budget.tick(node);
          setMember(target, key, value, runtime, node);
        }
      return target;
    }),
  });
  const array = namespace({
    isArray: v.capability(([value]) => Array.isArray(value)),
    from: v.capability(async ([value, fn], node) => {
      const result = [];
      for (const entry of v.sequence(value, node)) {
        runtime.budget.tick(node);
        result.push(fn ? await callback(runtime, fn, [entry, result.length], node) : entry);
        runtime.budget.bound('collectionItems', result.length, node);
      }
      return result;
    }),
  });
  const math = v.record();
  for (const key of Object.getOwnPropertyNames(Math)) {
    if (key === 'random') continue;
    math[key] = typeof Math[key] === 'function' ? simple(Math[key]) : Math[key];
  }
  return {
    Math: Object.freeze(math),
    Object: object,
    Array: array,
    Number: callable(([value]) => Number(v.primitive(value)), {
      isFinite: v.capability(([value]) => Number.isFinite(value)),
      isInteger: v.capability(([value]) => Number.isInteger(value)),
      isNaN: v.capability(([value]) => Number.isNaN(value)),
      isSafeInteger: v.capability(([value]) => Number.isSafeInteger(value)),
      parseFloat: simple(Number.parseFloat),
      parseInt: simple(Number.parseInt),
      MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
      EPSILON: Number.EPSILON,
      POSITIVE_INFINITY: Infinity,
      NaN,
    }),
    String: callable(([value]) => String(v.primitive(value))),
    Boolean: callable(([value]) => Boolean(value)),
    Map: namespace({}),
    Set: namespace({}),
    JSON: namespace({
      parse: v.capability((args, node) => {
        if (args.length !== 1 || typeof args[0] !== 'string')
          fail('FORBIDDEN_SYNTAX', 'JSON.parse accepts text only', node);
        runtime.budget.bound('valueBytes', args[0].length * 2, node);
        return parseText(args[0], runtime.budget, node);
      }),
      stringify: v.capability((args, node) => {
        if (args.length !== 1) fail('FORBIDDEN_SYNTAX', 'JSON.stringify accepts one value', node);
        return v.serialized(args[0], runtime.budget, 'valueBytes');
      }),
    }),
    Promise: namespace({
      all: v.capability(([items], node) => {
        if (!Array.isArray(items) || items.some((item) => v.deferred.get(item)?.origin !== 'cet'))
          fail('FORBIDDEN_SYNTAX', 'Promise.all accepts cet calls only', node);
        return runtime.defer(Promise.all(items.map((item) => v.deferred.get(item).promise)), 'cet');
      }),
    }),
    undefined,
    NaN,
    Infinity,
  };
}
module.exports = { builtins, namespace, getMember, setMember };
