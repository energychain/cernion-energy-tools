'use strict';

const { compareCanonicalStrings: compare } = require('../src/canonical-order');
const sorted = (values) => [...new Set(values)].sort(compare);
const members = (fn) => JSON.stringify(sorted(fn.capabilities));
const intersection = (left, right) => left.filter((id) => right.has(id)).length;

/** Match identities after grouping; catalog structure and edge scoring stay untouched. */
function assignFunctionLineage(functions, previousModel = null) {
  const previous = [...(previousModel?.functions || [])].sort((a, b) =>
    compare(a.functionId, b.functionId)
  );
  if (new Set(previous.map((fn) => fn.functionId)).size !== previous.length)
    throw new Error('Previous function IDs must be unique');
  const retired = new Set(previousModel?.gaps?.retiredFunctionIds || []);
  if (previous.some((fn) => retired.has(fn.functionId)))
    throw new Error('An active function ID cannot already be retired');
  const history = new Map();
  for (const fn of [...(previousModel?.lineageHistory || []), ...previous]) {
    history.set(fn.functionId, sorted([...(history.get(fn.functionId) || []), ...fn.capabilities]));
  }
  const unchanged =
    previousModel?.lineageHistory &&
    previous.length === functions.length &&
    functions.every((fn) =>
      previous.some((old) => members(old) === members(fn) && Array.isArray(old.derivation?.lineage))
    );
  if (unchanged) {
    for (const fn of functions) {
      const old = previous.find((entry) => members(entry) === members(fn));
      fn.functionId = old.functionId;
      fn.derivation.lineage = old.derivation.lineage.map((entry) => ({ ...entry }));
    }
    return {
      lineageHistory: [...history]
        .sort(([a], [b]) => compare(a, b))
        .map(([functionId, capabilities]) => ({ functionId, capabilities })),
      retiredFunctionIds: sorted(retired),
      idChanges: { ...previousModel.statistics.idChanges },
    };
  }

  const current = functions.map((fn) => new Set(fn.capabilities));
  const overlaps = previous.map((old) => current.map((set) => intersection(old.capabilities, set)));
  const children = overlaps.map((counts) => counts.filter((count) => count > 0).length);
  const parents = functions.map(
    (_, index) => overlaps.filter((counts) => counts[index] > 0).length
  );
  // Each old ID has exactly one primary descendant: largest intersection, then canonical membership.
  const primary = overlaps.map(
    (counts) =>
      counts
        .map((count, index) => ({ count, index }))
        .filter((item) => item.count > 0)
        .sort(
          (a, b) =>
            b.count - a.count || compare(members(functions[a.index]), members(functions[b.index]))
        )[0]?.index
  );
  const reserved = new Set([...history.keys(), ...retired, ...previous.map((fn) => fn.functionId)]);
  const used = new Set();
  for (let index = 0; index < functions.length; index++) {
    const candidates = previous
      .map((old, parent) => ({ old, parent, count: overlaps[parent][index] }))
      .filter(
        ({ old, parent, count }) =>
          primary[parent] === index &&
          (count / old.capabilities.length > 0.5 || children[parent] > 1)
      )
      .sort((a, b) => b.count - a.count || compare(a.old.functionId, b.old.functionId));
    let id = candidates[0]?.old.functionId;
    if (!id) {
      const base = functions[index].functionId;
      id = base;
      for (let suffix = 2; reserved.has(id) || used.has(id); suffix++) id = `${base}-${suffix}`;
    }
    functions[index].functionId = id;
    used.add(id);
  }
  for (const old of previous) if (!used.has(old.functionId)) retired.add(old.functionId);

  // Historical capability membership preserves aliases across multiple generations.
  const historical = [...history].sort(([a], [b]) => compare(a, b));
  const historicalOverlaps = historical.map(([, ids]) =>
    current.map((set) => intersection(ids, set))
  );
  const historicalChildren = historicalOverlaps.map(
    (counts) => counts.filter((count) => count > 0).length
  );
  const historicalParents = functions.map(
    (_, index) => historicalOverlaps.filter((counts) => counts[index] > 0).length
  );
  for (let index = 0; index < functions.length; index++) {
    functions[index].derivation.lineage = historical.flatMap(([previousId, ids], parent) => {
      const count = historicalOverlaps[parent][index];
      return count
        ? [
            {
              previousId,
              relation:
                historicalChildren[parent] > 1
                  ? 'split'
                  : historicalParents[index] > 1
                    ? 'merged'
                    : 'same',
              overlap: count / ids.length,
            },
          ]
        : [];
    });
    const fn = functions[index];
    history.set(fn.functionId, sorted([...(history.get(fn.functionId) || []), ...fn.capabilities]));
  }
  const idChanges = {
    same: 0,
    merged: 0,
    split: 0,
    retired: previous.filter((fn) => !used.has(fn.functionId)).length,
    new: functions.filter((fn) => !previous.some((old) => old.functionId === fn.functionId)).length,
    previousSourceHash: previousModel?.sourceHash || null,
  };
  for (let parent = 0; parent < previous.length; parent++) {
    if (!children[parent]) continue;
    const relation =
      children[parent] > 1 ? 'split' : parents[primary[parent]] > 1 ? 'merged' : 'same';
    idChanges[relation]++;
  }
  return {
    lineageHistory: [...history]
      .sort(([a], [b]) => compare(a, b))
      .map(([functionId, capabilities]) => ({ functionId, capabilities })),
    retiredFunctionIds: sorted(retired),
    idChanges,
  };
}

module.exports = { assignFunctionLineage };
