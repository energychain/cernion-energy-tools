'use strict';

const { compareCanonicalStrings } = require('./canonical-order');

let cachedModel;

function getFunctionModel(options = {}) {
  if (options.model) return options.model;
  if (!cachedModel) cachedModel = require('../function-model.json');
  return cachedModel;
}

function getFunction(functionId, options = {}) {
  return getFunctionModel(options).functions.find((fn) => fn.functionId === functionId) || null;
}

function getNeighbors(functionId, options = {}) {
  const model = getFunctionModel(options);
  const minWeight = options.minWeight ?? model.parameters.minWeight;
  return (getFunction(functionId, { model })?.neighbors || []).filter(
    (edge) => edge.weight >= minWeight
  );
}

function findFunctionsForCapability(capability, options = {}) {
  return getFunctionModel(options).functions.filter((fn) => fn.capabilities.includes(capability));
}

function findFunctionsForOperation(action, options = {}) {
  return getFunctionModel(options).functions.filter((fn) => fn.operations.includes(action));
}

/** Resolve stored identities before reading current state; lineage grants no authorization. */
function resolveFunctionId(id, options = {}) {
  return getFunctionModel(options)
    .functions.flatMap((fn) => {
      const entry = fn.derivation?.lineage?.find((item) => item.previousId === id);
      if (entry)
        return [{ functionId: fn.functionId, relation: entry.relation, overlap: entry.overlap }];
      return fn.functionId === id ? [{ functionId: id, relation: 'same', overlap: 1 }] : [];
    })
    .sort((a, b) => compareCanonicalStrings(a.functionId, b.functionId));
}

module.exports = {
  resolveFunctionId,
  getFunctionModel,
  getFunction,
  getNeighbors,
  findFunctionsForCapability,
  findFunctionsForOperation,
};
