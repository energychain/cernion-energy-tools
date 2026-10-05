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
  const edges = new Map(
    (getFunction(functionId, { model })?.neighbors || []).map((edge) => [edge.functionId, edge])
  );
  for (const row of options.overlay || []) {
    const currentId = (id) => {
      const resolved = resolveFunctionId(id, { model });
      const current = getFunction(id, { model })
        ? resolved.filter((item) => item.functionId === id)
        : resolved;
      return current.length === 1 ? current[0].functionId : null;
    };
    const sourceId = currentId(row.functionId);
    const targetId = currentId(row.neighborId);
    const neighborId =
      sourceId === functionId ? targetId : targetId === functionId ? sourceId : null;
    if (neighborId)
      edges.set(neighborId, {
        functionId: neighborId,
        weight: row.weight,
        evidence: [{ kind: 'corrected' }],
      });
  }
  return [...edges.values()].filter((edge) => edge.weight >= minWeight);
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
