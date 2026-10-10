'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { projectFunctionModel } = require('../scripts/function-model-projection');
const { readCommittedFunctionModel, renderReport } = require('../scripts/generate-function-model');
const { resolveFunctionId } = require('../src/function-model');

// Tokens are neutral; group keys only choose shared fixture structure.
function project(groups, previousModel = null) {
  const capabilities = groups.flatMap((ids) =>
    ids.map((id) => ({
      capability: id,
      domain: `domain-${id}`,
      preferredActions: [`svc-${id}.read`],
      label: id,
    }))
  );
  const operations = groups.flatMap((ids) => {
    const key = [...ids].sort().join('-');
    return ids.map((id) => ({
      action: `svc-${id}.read`,
      service: `svc-${id}`,
      dataSources: [`ref-${key}-a`, `ref-${key}-b`],
      entityTypes: [`type-${key}`],
    }));
  });
  return projectFunctionModel({ capabilities, operations, previousModel });
}
const ids = (model) => model.functions.map((fn) => fn.functionId);
const find = (model, capability) =>
  model.functions.find((fn) => fn.capabilities.includes(capability));

test('unchanged generation retains IDs and reaches a byte-identical fixed point', () => {
  const first = project([['a', 'b'], ['c']]);
  const next = project([['a', 'b'], ['c']], first);
  expect(ids(next)).toEqual(ids(first));
  expect(JSON.stringify(project([['a', 'b'], ['c']], next))).toBe(JSON.stringify(next));
});

test('adding an earlier-sorting capability to a group retains its existing ID', () => {
  const previous = project([['b']]);
  const model = project([['a', 'b']], previous);
  expect(ids(model)).toEqual(['fn-b']);
  expect(model.functions[0].derivation.lineage).toEqual([
    { previousId: 'fn-b', relation: 'same', overlap: 1 },
  ]);
  expect(ids(project([['a', 'b', 'c']], model))).toEqual(['fn-b']);
});

test('merge produces one target ID with lineage and resolution for both predecessors', () => {
  const previous = project([['a'], ['b', 'c']]);
  const model = project([['a', 'b', 'c']], previous);
  expect(ids(model)).toEqual(['fn-b']);
  expect(model.functions[0].derivation.lineage).toEqual([
    { previousId: 'fn-a', relation: 'merged', overlap: 1 },
    { previousId: 'fn-b', relation: 'merged', overlap: 1 },
  ]);
  for (const id of ids(previous))
    expect(resolveFunctionId(id, { model })).toEqual([
      { functionId: 'fn-b', relation: 'merged', overlap: 1 },
    ]);
  expect(model.gaps.retiredFunctionIds).toEqual(['fn-a']);
  expect(model.statistics.idChanges).toMatchObject({
    same: 0,
    merged: 2,
    split: 0,
    retired: 1,
    new: 0,
  });
});

test('split retains the old ID for the larger part, reserves a new ID for the rest', () => {
  const previous = project([['a', 'b', 'c']]);
  const model = project([['a'], ['b', 'c']], previous);
  expect(find(model, 'b').functionId).toBe('fn-a');
  expect(find(model, 'a').functionId).toBe('fn-a-2');
  expect(find(model, 'b').derivation.lineage).toEqual([
    { previousId: 'fn-a', relation: 'split', overlap: 2 / 3 },
  ]);
  expect(find(model, 'a').derivation.lineage).toEqual([
    { previousId: 'fn-a', relation: 'split', overlap: 1 / 3 },
  ]);
  expect(resolveFunctionId('fn-a', { model })).toEqual([
    { functionId: 'fn-a', relation: 'split', overlap: 2 / 3 },
    { functionId: 'fn-a-2', relation: 'split', overlap: 1 / 3 },
  ]);
  expect(model.statistics.idChanges).toMatchObject({
    same: 0,
    merged: 0,
    split: 1,
    retired: 0,
    new: 1,
  });
  expect(JSON.stringify(project([['a'], ['b', 'c']], model))).toBe(JSON.stringify(model));
});

test('retired and historic IDs are never reused for unrelated normalized names', () => {
  const previous = project([['a_b']]);
  const removed = project([['c']], previous);
  expect(removed.gaps.retiredFunctionIds).toEqual(['fn-a-b']);
  const model = project([['a-b'], ['c']], removed);
  expect(find(model, 'a-b').functionId).toBe('fn-a-b-2');
  expect(model.gaps.retiredFunctionIds).toContain('fn-a-b');
  expect(resolveFunctionId('fn-a-b', { model })).toEqual([]);
  expect(resolveFunctionId('unknown', { model })).toEqual([]);
});

test('a small fragment without a split does not inherit the old identity', () => {
  const previous = project([['a', 'b', 'c', 'd']]);
  const model = project([['a', 'x', 'y', 'z']], previous);
  expect(ids(model)).toEqual(['fn-a-2']);
  expect(model.gaps.retiredFunctionIds).toContain('fn-a');
});

test('aliases survive merge, split and no-op commits without leaking to unrelated pieces', () => {
  const first = project([['a'], ['b', 'c']]);
  const merged = project([['a', 'b', 'c']], first);
  const split = project([['a'], ['b', 'c']], merged);
  const model = project([['a'], ['b', 'c']], split);
  expect(resolveFunctionId('fn-a', { model })).toEqual([
    { functionId: find(model, 'a').functionId, relation: 'merged', overlap: 1 },
  ]);
  expect(resolveFunctionId('fn-b', { model })).toHaveLength(2);
  expect(model.gaps.retiredFunctionIds).toContain('fn-a');
  expect(find(model, 'a').functionId).not.toBe('fn-a');
});

test('historical membership also covers capabilities added after initial ID assignment', () => {
  const first = project([['a']]);
  const expanded = project([['a', 'b', 'c']], first);
  const model = project([['a'], ['b', 'c']], expanded);
  expect(resolveFunctionId('fn-a', { model })).toHaveLength(2);
});

test('lineage, tie breaking, neighbors and report are deterministic under input reordering', () => {
  const previous = project([['a', 'b', 'c', 'd'], ['e']]);
  const first = project([['a', 'b'], ['c', 'd'], ['e']], previous);
  const reordered = {
    ...previous,
    functions: [...previous.functions].reverse(),
    lineageHistory: [...previous.lineageHistory].reverse(),
  };
  const second = project([['e'], ['d', 'c'], ['b', 'a']], reordered);
  expect(find(first, 'a').functionId).toBe('fn-a');
  expect(second).toEqual(first);
  expect(renderReport(second)).toBe(renderReport(first));
  const noOp = project([['e'], ['d', 'c'], ['b', 'a']], {
    ...first,
    functions: [...first.functions].reverse(),
    lineageHistory: [...first.lineageHistory].reverse(),
  });
  expect(noOp).toEqual(first);
  expect(renderReport(first)).toContain('## ID-Änderungen gegenüber Vorversion');
  expect(renderReport(first)).toContain('same: 1; merged: 0; split: 1; retired: 0; new: 1.');
});

test('resolver with an injected model performs no filesystem reads', () => {
  const model = project([['a']]);
  const read = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('Unexpected I/O');
  });
  try {
    expect(resolveFunctionId('fn-a', { model })).toEqual([
      { functionId: 'fn-a', relation: 'same', overlap: 1 },
    ]);
    expect(read).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
  }
});

test('generator baseline comes from the Git commit, ignoring edited working artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'function-lineage-git-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const model = project([['a']]);
    const file = path.join(root, 'function-model.json');
    fs.writeFileSync(file, JSON.stringify(model));
    execFileSync('git', ['add', 'function-model.json'], { cwd: root });
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'],
      { cwd: root }
    );
    fs.writeFileSync(file, '{}');
    expect(readCommittedFunctionModel(root)).toEqual(model);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
