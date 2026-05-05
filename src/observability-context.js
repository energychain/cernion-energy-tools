'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function runWithObservabilityContext(context, fn) {
  return storage.run({ ...(context || {}) }, fn);
}

function getObservabilityContext() {
  return storage.getStore() || {};
}

function mergeObservabilityContext(partial = {}) {
  const current = getObservabilityContext();
  const next = { ...current, ...partial };
  storage.enterWith(next);
  return next;
}

module.exports = {
  runWithObservabilityContext,
  getObservabilityContext,
  mergeObservabilityContext,
};
