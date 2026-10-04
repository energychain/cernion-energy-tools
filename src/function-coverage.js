'use strict';

const { createHash } = require('crypto');
const modelApi = require('./function-model');
const defaults = require('./function-coverage-config.json');
const { compareCanonicalStrings } = require('./canonical-order');

function reference(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function configuration(overrides = {}) {
  const config = {
    ...defaults,
    ...overrides,
    weights: { ...defaults.weights, ...overrides.weights },
  };
  for (const field of ['halfLifeMs', 'retentionMs', 'crossConversationMultiplier']) {
    if (!Number.isFinite(config[field]) || config[field] <= 0)
      throw new Error('Invalid configuration');
  }
  for (const field of [
    'recentReferenceLimit',
    'maxSignalsPerTurn',
    'maxPendingTurns',
    'maxInputSignalsPerTurn',
  ]) {
    if (!Number.isInteger(config[field]) || config[field] < 1 || config[field] > 1024)
      throw new Error('Invalid configuration');
  }
  if (!Number.isFinite(config.hysteresis) || config.hysteresis <= 0 || config.hysteresis > 1)
    throw new Error('Invalid hysteresis');
  if (
    Object.values(config.weights).some(
      (value) => !Number.isFinite(value) || value <= 0 || value > 1
    )
  )
    throw new Error('Invalid weights');
  if (
    !Number.isFinite(config.maxOperationFunctionShare) ||
    config.maxOperationFunctionShare <= 0 ||
    config.maxOperationFunctionShare > 1
  )
    throw new Error('Invalid operation share');
  if (
    !config.hubFeatures ||
    Object.values(config.hubFeatures).some(
      (ids) => !Array.isArray(ids) || ids.some((id) => typeof id !== 'string')
    )
  )
    throw new Error('Invalid hub features');
  return config;
}

function isHubOperation(id, functions, model, config) {
  if (functions.length / model.functions.length > config.maxOperationFunctionShare) return true;
  const features = [`operations:${id}`, `declaredActions:${id}`, `services:${id.split('.')[0]}`];
  const automatic = new Set(model.statistics?.automaticHubs || []);
  const configured = { ...model.parameters?.hubFeatures };
  for (const [kind, values] of Object.entries(config.hubFeatures))
    configured[kind] = [...(configured[kind] || []), ...values];
  return features.some((feature) => {
    const separator = feature.indexOf(':');
    return (
      automatic.has(feature) ||
      configured[feature.slice(0, separator)]?.includes(feature.slice(separator + 1))
    );
  });
}

function mapSignals(input, model, config) {
  const ids = new Set();
  let unresolved = 0;
  let suppressedOperations = 0;
  let overflow = input.observationOverflow || 0;
  // Explicit selections take priority over broader operation mappings.
  for (const [kind, lookup] of [
    ['capabilities', modelApi.findFunctionsForCapability],
    ['operations', modelApi.findFunctionsForOperation],
  ]) {
    const values = [...new Set(input[kind] || [])];
    overflow += Math.max(0, values.length - config.maxInputSignalsPerTurn);
    for (const id of values.slice(0, config.maxInputSignalsPerTurn)) {
      const functions = lookup(id, { model });
      if (!functions.length) unresolved++;
      if (kind === 'operations' && isHubOperation(id, functions, model, config)) {
        suppressedOperations++;
        continue;
      }
      for (const fn of functions) ids.add(fn.functionId);
    }
  }
  overflow += Math.max(0, ids.size - config.maxSignalsPerTurn);
  return {
    functionIds: [...ids].slice(0, config.maxSignalsPerTurn),
    unresolved,
    suppressedOperations,
    overflow,
  };
}

function resolvedTouches(documents, model) {
  return documents.flatMap((doc) => {
    const resolved =
      doc.modelSourceHash &&
      doc.modelSourceHash === model.sourceHash &&
      modelApi.getFunction(doc.functionId, { model })
        ? [{ functionId: doc.functionId }]
        : modelApi.resolveFunctionId(doc.functionId, { model });
    return resolved.length === 1 ? [{ ...doc, functionId: resolved[0].functionId }] : [];
  });
}

function project(documents, asOf, config) {
  if (!documents.length) return null;
  const ordered = [...documents].sort(
    (a, b) => a.at - b.at || compareCanonicalStrings(a._id, b._id)
  );
  const first = ordered[0];
  let mass = 0;
  const counts = {};
  for (const doc of ordered) {
    mass += doc.weight * Math.pow(0.5, Math.max(0, asOf - doc.at) / config.halfLifeMs);
    counts[doc.signalClass] = (counts[doc.signalClass] || 0) + 1;
  }
  const last = ordered.at(-1);
  const score = Math.min(1, Math.max(0, 1 - Math.exp(-mass)));
  return {
    tenantId: first.tenantId,
    actorId: first.actorId,
    functionId: first.functionId,
    score,
    signalCount: ordered.length,
    lastSignalAt: new Date(last.at).toISOString(),
    origin: 'observed',
    coverageScore: score,
    observedActivity: true,
    scoreVersion: config.scoreVersion,
    asOf: new Date(asOf).toISOString(),
    lastTouchedAt: new Date(last.at).toISOString(),
    nextDecayAt: new Date(last.at + config.halfLifeMs).toISOString(),
    counts,
    recentSourceReferences: ordered.slice(-config.recentReferenceLimit).map((doc) => doc.sourceRef),
  };
}

module.exports = { reference, configuration, mapSignals, resolvedTouches, project };
