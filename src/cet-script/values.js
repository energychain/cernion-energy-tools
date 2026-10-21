'use strict';
const { fail } = require('./errors');
const BLOCKED = new Set([
  '__proto__',
  'prototype',
  'constructor',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'caller',
  'callee',
  'arguments',
  'toString',
  'valueOf',
  'toLocaleString',
  'then',
]);
const capabilities = new WeakMap();
const functions = new WeakMap();
const deferred = new WeakMap();
const collections = new WeakMap();
const handles = new WeakMap();
function keyOf(value, node) {
  if (typeof value !== 'string' && typeof value !== 'number')
    fail('CONTAINER_VIOLATION', 'Property key must be a string or number', node);
  const key = String(value);
  if (BLOCKED.has(key)) fail('CONTAINER_VIOLATION', 'Blocked property key', node);
  return key;
}
function record() {
  return Object.create(null);
}
function capability(fn, name = '', async = false) {
  const value = Object.freeze(record());
  capabilities.set(value, { fn, name, async });
  return value;
}
function pending(promise, origin) {
  const value = Object.freeze(record());
  // Rejections are observed even if a script discards the returned value.
  promise.catch(() => {});
  deferred.set(value, { promise, origin });
  return value;
}
function primitive(value, node) {
  if (value !== null && ['object', 'function', 'symbol', 'bigint'].includes(typeof value))
    fail('RUNTIME_ERROR', 'Implicit object conversion is unavailable', node);
  return value;
}
function copy(value, budget, depth = 0, seen = new Set(), size = { bytes: 0 }) {
  budget?.tick();
  budget?.allocate(typeof value === 'string' ? value.length * 2 + 16 : 64);
  size.bytes += typeof value === 'string' ? value.length * 2 : 16;
  budget?.bound('valueBytes', size.bytes);
  if (depth > 100) fail('CONTAINER_VIOLATION', 'Value nesting limit');
  if (value === null || ['undefined', 'string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string') budget?.bound('valueBytes', value.length * 2);
    return value;
  }
  if (typeof value !== 'object' || seen.has(value))
    fail('CONTAINER_VIOLATION', 'Unsupported external value');
  if (![null, Object.prototype, Array.prototype].includes(Object.getPrototypeOf(value)))
    fail('CONTAINER_VIOLATION', 'Unsupported external object');
  if (Object.getOwnPropertySymbols(value).length)
    fail('CONTAINER_VIOLATION', 'Symbol properties are unavailable');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result = Array.isArray(value) ? [] : record();
  seen.add(value);
  budget?.bound('collectionItems', Object.keys(descriptors).length);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === 'length' && Array.isArray(value)) continue;
    keyOf(key);
    if (!Object.hasOwn(descriptor, 'value'))
      fail('CONTAINER_VIOLATION', 'Accessors are unavailable');
    result[key] = copy(descriptor.value, budget, depth + 1, seen, size);
  }
  seen.delete(value);
  return result;
}
function plain(value, budget, seen = new Set(), depth = 0, size = { bytes: 0 }) {
  budget?.tick();
  budget?.allocate(typeof value === 'string' ? value.length * 2 + 16 : 64);
  size.bytes += typeof value === 'string' ? value.length * 2 : 16;
  budget?.bound('valueBytes', size.bytes);
  if (depth > 100) fail('CONTAINER_VIOLATION', 'Value nesting limit');
  if (value === null || typeof value !== 'object') return primitive(value);
  if (capabilities.has(value) || functions.has(value) || deferred.has(value) || handles.has(value))
    fail('CONTAINER_VIOLATION', 'Capability cannot cross the data boundary');
  if (seen.has(value)) fail('RUNTIME_ERROR', 'Cyclic data');
  seen.add(value);
  const result = Array.isArray(value) ? [] : record();
  const collection = collections.get(value);
  if (collection) {
    if (collection.type === 'Iterator')
      fail('RUNTIME_ERROR', 'Consume iterators before returning data');
    const entries =
      collection.type === 'Map' ? [...collection.data] : [...collection.data.values()];
    seen.delete(value);
    return plain(entries, budget, seen, depth + 1, size);
  }
  for (const key of Object.keys(value))
    result[keyOf(key)] = plain(value[key], budget, seen, depth + 1, size);
  seen.delete(value);
  return result;
}
function serialized(value, budget, name = 'resultBytes') {
  const text = JSON.stringify(plain(value, budget));
  budget.bound(name, Buffer.byteLength(text || ''));
  return text;
}
function iterator(items) {
  const value = Object.freeze(record());
  collections.set(value, { type: 'Iterator', data: items, cursor: 0 });
  return value;
}
function sequence(value, node) {
  if (Array.isArray(value) || typeof value === 'string') return value;
  const collection = collections.get(value);
  if (collection?.type === 'Iterator') {
    const result = collection.data.slice(collection.cursor);
    collection.cursor = collection.data.length;
    return result;
  }
  if (collection) return [...collection.data];
  fail('RUNTIME_ERROR', 'Expected a script sequence', node);
}
module.exports = {
  BLOCKED,
  capabilities,
  functions,
  deferred,
  collections,
  handles,
  keyOf,
  record,
  capability,
  pending,
  primitive,
  copy,
  plain,
  serialized,
  sequence,
  iterator,
};
