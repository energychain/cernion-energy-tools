'use strict';
const { resolveFunctionId } = require('./function-model');

function resolveRecords(records, model) {
  return records.flatMap((record) => {
    // Hash-only regeneration preserves current scope; historical wider scope follows splits.
    const current = model.functions.find((fn) => fn.functionId === record.functionId);
    const scopeRetained =
      !record.capabilities?.length ||
      !current?.capabilities ||
      record.capabilities.every((id) => current.capabilities.includes(id));
    if (current && scopeRetained) return [{ ...record, modelSourceHash: model.sourceHash }];
    const successors = resolveFunctionId(record.functionId, { model });
    const resolved = successors.filter(({ functionId }) => {
      if (record.modelSourceHash && record.modelSourceHash === model.sourceHash)
        return functionId === record.functionId;
      if (!record.capabilities?.length) return true;
      return model.functions
        .find((fn) => fn.functionId === functionId)
        ?.capabilities?.some((id) => record.capabilities.includes(id));
    });
    return resolved.map(({ functionId }) => ({
      ...record,
      functionId,
      modelSourceHash: model.sourceHash,
      ...(record.attention && resolved.length > 1
        ? {
            attention: {
              ...record.attention,
              allowance: record.attention.allowance / resolved.length,
              consumedUnits: record.attention.consumedUnits / resolved.length,
              replenishedUnits: record.attention.replenishedUnits / resolved.length,
            },
          }
        : {}),
    }));
  });
}

function coverageRecords(document, model) {
  const byActor = new Map();
  for (const record of [...document.coverage].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0)
  )) {
    const resolved = resolveRecords([record], model);
    if (resolved.length !== 1) continue;
    const [entry] = resolved;
    byActor.set(JSON.stringify([entry.functionId, entry.actorId]), entry);
  }
  return [...byActor.values()];
}

module.exports = { resolveRecords, coverageRecords };
