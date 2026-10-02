'use strict';

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

module.exports = {
  getFunctionModel,
  getFunction,
  getNeighbors,
  findFunctionsForCapability,
  findFunctionsForOperation,
};
