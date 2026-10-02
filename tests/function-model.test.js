'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  projectFunctionModel,
  normalizeDomain,
  DEFAULT_PARAMETERS,
} = require('../scripts/function-model-projection');
const { extractStaticEvents, loadServiceEvents } = require('../scripts/function-model-sources');
const {
  buildFunctionModel,
  writeOrCheck,
  renderReport,
} = require('../scripts/generate-function-model');
const api = require('../src/function-model');

const cap = (id, domain, actions = [`svc-${id}.read`]) => ({
  capability: id,
  domain,
  preferredActions: actions,
});
const op = (id, fields = {}) => ({
  action: `svc-${id}.read`,
  service: `svc-${id}`,
  consequenceLevel: 'none',
  ...fields,
});
function fixture(extra = {}) {
  return projectFunctionModel({
    capabilities: [cap('a', 'a'), cap('b', 'b'), cap('c', 'c')],
    operations: [
      op('a', { dataSources: ['ref-shared'], writesTo: ['ref-output'], entityTypes: ['type-a'] }),
      op('b', { dataSources: ['ref-shared', 'ref-output'], entityTypes: ['type-b'] }),
      op('c', { dataSources: ['ref-c'] }),
    ],
    serviceEvents: {
      'svc-a': { emits: ['event-a.v1'], listens: [] },
      'svc-b': { emits: [], listens: ['event-a.v1'] },
    },
    ...extra,
  });
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'function-model-test-'));
}

describe('function model projection (#694)', () => {
  test('AC-01/AC-03: normalizes catalog data without a domain-specific mapping', () => {
    expect(normalizeDomain('Fn_A')).toBe('fn-a');
    expect(normalizeDomain('FN--A')).toBe('fn-a');
    const model = fixture({ capabilities: [cap('a', 'Fn_A'), cap('b', 'fn-a')] });
    expect(model.functions).toHaveLength(1);
    expect(model.functions[0].capabilities).toEqual(['a', 'b']);
  });

  test('AC-01: derives department and all function metadata from supplied catalogs', () => {
    const model = fixture({ semanticDomains: [{ id: 'a', department: 'dep-a' }] });
    const fn = api.getFunction('fn-a', { model });
    expect(fn).toMatchObject({
      functionId: 'fn-a',
      capabilities: ['a'],
      operations: ['svc-a.read'],
      dataSources: ['ref-shared'],
      entityTypes: ['type-a'],
      writesTo: ['ref-output'],
      departments: ['dep-a'],
      consequenceLevels: { none: 1 },
      derivation: { version: '1', generatedAt: DEFAULT_PARAMETERS.generatedAt },
    });
    expect(fn.sources).toContainEqual({ kind: 'semantic-domain', ref: 'a' });
  });

  test('AC-02: assigns missing-operation capabilities once and reports their gaps', () => {
    const model = fixture({
      capabilities: [cap('a', 'a'), cap('b', 'b', ['svc-missing.read']), cap('c', 'c', [])],
    });
    expect(model.functions.flatMap((fn) => fn.capabilities).sort()).toEqual(['a', 'b', 'c']);
    expect(model.gaps.capabilitiesWithoutOperations).toEqual([
      { capability: 'b', reason: 'No resolvable preferred action' },
      { capability: 'c', reason: 'No resolvable preferred action' },
    ]);
    expect(model.gaps.unresolvedPreferredActions).toEqual([
      { capability: 'b', action: 'svc-missing.read' },
    ]);
    expect(model.gaps.isolatedFunctions).toContain('fn-c');
    expect(model.gaps.functionsWithoutEvents).toContain('fn-c');
    expect(model.gaps.functionsWithoutListeners).toContain('fn-a');
  });

  test('rejects duplicate capability IDs instead of silently duplicating assignments', () => {
    expect(() => fixture({ capabilities: [cap('a', 'a'), cap('a', 'b')] })).toThrow('unique');
  });

  test('groups strongly overlapping domains without hand-maintained group names', () => {
    const operations = Array.from({ length: 15 }, (_, i) => op(`x${i}`));
    const actions = operations.map((entry) => entry.action);
    const model = fixture({
      capabilities: [cap('a', 'a', actions), cap('b', 'b', actions)],
      operations,
    });
    expect(model.functions).toHaveLength(1);
    expect(model.functions[0].capabilities).toEqual(['a', 'b']);
  });

  test('AC-04: explicit hub features alone cannot form an edge', () => {
    const parameters = {
      ...DEFAULT_PARAMETERS,
      hubFeatures: { services: ['svc-hub'], dataSources: ['ref-hub'], domains: ['hub'] },
    };
    const model = fixture({
      parameters,
      operations: [
        op('a', { service: 'svc-hub', dataSources: ['ref-hub'] }),
        op('b', { service: 'svc-hub', dataSources: ['ref-hub'] }),
      ],
      serviceEvents: {},
    });
    expect(model.functions.every((fn) => !fn.neighbors.length)).toBe(true);
  });

  test('AC-04: automatically suppresses high-frequency features and hub write/read edges', () => {
    const capabilities = Array.from({ length: 12 }, (_, i) => cap(`x${i}`, `x${i}`));
    const operations = capabilities.map((_, i) =>
      op(`x${i}`, { dataSources: ['ref-hub'], writesTo: ['ref-hub'] })
    );
    const model = fixture({ capabilities, operations, serviceEvents: {} });
    expect(model.statistics.automaticHubs).toContain('dataSources:ref-hub');
    expect(model.statistics.density).toBe(0);
    expect(model.functions.every((fn) => fn.neighbors.length === 0)).toBe(true);
  });

  test('AC-05: event and write/read evidence is directed and stronger than shared evidence', () => {
    const model = fixture();
    const forward = api
      .getNeighbors('fn-a', { model, minWeight: 0 })
      .find((edge) => edge.functionId === 'fn-b');
    const reverse = api
      .getNeighbors('fn-b', { model, minWeight: 0 })
      .find((edge) => edge.functionId === 'fn-a');
    expect(forward.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'event', ref: 'event-a.v1', weight: 0.8 }),
        expect.objectContaining({ kind: 'write-read', ref: 'ref-output', weight: 0.7 }),
      ])
    );
    expect(reverse.evidence.every((item) => item.kind === 'shared')).toBe(true);
    expect(forward.weight).toBeGreaterThan(reverse.weight);
    for (const fn of model.functions)
      for (const edge of fn.neighbors) {
        expect(edge.evidence.length).toBeGreaterThan(0);
        expect(edge.weight).toBeGreaterThan(0);
        expect(edge.weight).toBeLessThanOrEqual(1);
        expect(edge.weight).toBe(
          Math.min(
            1,
            edge.evidence.reduce((sum, item) => sum + item.weight, 0)
          )
        );
      }
  });

  test('rarer shared features contribute more than frequent ones', () => {
    const model = fixture({
      capabilities: ['a', 'b', 'c', 'd'].map((id) => cap(id, id)),
      operations: [
        op('a', { dataSources: ['ref-rare', 'ref-common'] }),
        op('b', { dataSources: ['ref-rare', 'ref-common'] }),
        op('c', { dataSources: ['ref-common'] }),
        op('d'),
      ],
      serviceEvents: {},
    });
    const edge = api
      .getNeighbors('fn-a', { model, minWeight: 0 })
      .find((item) => item.functionId === 'fn-b');
    const weight = (ref) => edge.evidence.find((item) => item.ref === ref).weight;
    expect(weight('ref-rare')).toBeGreaterThan(weight('ref-common'));
  });

  test('AC-06: a newly inserted capability/operation acquires neighbors without code changes', () => {
    const before = fixture();
    const model = fixture({
      capabilities: [...['a', 'b', 'c'].map((id) => cap(id, id)), cap('d', 'd')],
      operations: [
        op('a', { dataSources: ['ref-shared'] }),
        op('b'),
        op('c'),
        op('d', { dataSources: ['ref-shared'] }),
      ],
    });
    expect(api.findFunctionsForCapability('d', { model })).toHaveLength(1);
    expect(api.getNeighbors('fn-d', { model }).map((edge) => edge.functionId)).toContain('fn-a');
    expect(api.getFunction('fn-d', { model: before })).toBeNull();
  });

  test('reports placeholder-only functions through configured data', () => {
    const model = fixture({
      parameters: { ...DEFAULT_PARAMETERS, placeholderServices: ['svc-a'] },
    });
    expect(model.gaps.placeholderOnlyFunctions).toEqual(['fn-a']);
    expect(renderReport(model)).toContain('## overrides (0)');
  });

  test('AC-07: fixture projection is deterministic', () => {
    expect(JSON.stringify(fixture())).toBe(JSON.stringify(fixture()));
  });

  test('AC-07: check mode detects stale, missing and edited outputs without overwriting', () => {
    const outputDir = temporaryDirectory();
    try {
      const model = fixture();
      expect(writeOrCheck(model, { check: true, outputDir })).toHaveLength(2);
      writeOrCheck(model, { outputDir });
      expect(writeOrCheck(model, { check: true, outputDir })).toEqual([]);
      const changed = fixture({ capabilities: [cap('d', 'd')] });
      expect(writeOrCheck(changed, { check: true, outputDir })).toHaveLength(2);
      const file = path.join(outputDir, 'function-model.json');
      fs.writeFileSync(file, '{}\n');
      expect(writeOrCheck(model, { check: true, outputDir })).toEqual(['function-model.json']);
      expect(fs.readFileSync(file, 'utf8')).toBe('{}\n');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test('AC-08: injected loader queries require no filesystem reads', () => {
    const model = fixture();
    const read = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('Unexpected I/O');
    });
    try {
      expect(api.getFunctionModel({ model })).toBe(model);
      expect(api.getFunction('fn-a', { model }).functionId).toBe('fn-a');
      expect(api.getFunction('missing', { model })).toBeNull();
      expect(api.getNeighbors('missing', { model })).toEqual([]);
      expect(api.getNeighbors('fn-a', { model, minWeight: 1.1 })).toEqual([]);
      expect(api.findFunctionsForCapability('a', { model }).map((fn) => fn.functionId)).toEqual([
        'fn-a',
      ]);
      expect(
        api.findFunctionsForOperation('svc-a.read', { model }).map((fn) => fn.functionId)
      ).toEqual(['fn-a']);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  test('AC-08: default model is loaded once and subsequent queries reuse it', () => {
    expect(api.getFunctionModel()).toBe(api.getFunctionModel());
    expect(api.getFunctionModel().functions.length).toBeGreaterThan(0);
  });
});

describe('static event analysis', () => {
  test('extracts literal/constant events and direct handlers, ignoring comments and unrelated emitters', () => {
    const source = `
      const EVENT = 'event-a.v1';
      // broker.emit('comment.v1');
      broker.emit(EVENT, {});
      ctx.broker.broadcast('event-b.v1', {});
      other.emit('irrelevant.v1', {});
      module.exports = { events: {
        'event-a.v1': { handler() { const nested = { 'fake.v1': true }; } },
        [EVENT]: () => {},
        'event-*.v1': () => {},
      }};
      broker.emit(eventName, {});
    `;
    const result = extractStaticEvents(source);
    expect(result.emits).toEqual(['event-a.v1', 'event-b.v1']);
    expect(result.listens).toEqual(['event-*.v1', 'event-a.v1']);
    expect(result.unresolved).toHaveLength(1);
  });

  test('follows split service modules and local imports without executing them', () => {
    const root = temporaryDirectory();
    try {
      fs.mkdirSync(path.join(root, 'services'));
      fs.writeFileSync(
        path.join(root, 'services', 'a.service.js'),
        `throw new Error('Must not execute'); module.exports = { name: 'svc-a', methods: require('./part') };`
      );
      fs.writeFileSync(
        path.join(root, 'services', 'part.js'),
        `require('./a.service'); module.exports = { run() { this.broker.emit('event-a.v1', {}); } };`
      );
      const { events, sources } = loadServiceEvents(root);
      expect(events['svc-a'].emits).toEqual(['event-a.v1']);
      expect(sources.size).toBe(2);
      expect(events['svc-a'].sources).toContain('services/part.js');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('committed catalog statistics', () => {
  let model;
  beforeAll(() => {
    model = buildFunctionModel();
  });

  test('AC-02: covers every real curated capability exactly once', () => {
    const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
    const assigned = model.functions.flatMap((fn) => fn.capabilities);
    expect(assigned.length).toBe(new Set(assigned).size);
    expect(assigned.sort()).toEqual(CURATED_CAPABILITIES.map((entry) => entry.capability).sort());
  });

  test('AC-04/AC-05: real density meets the target and every edge carries evidence', () => {
    expect(model.statistics.density).toBeLessThanOrEqual(0.15);
    expect(model.statistics.density).toBeLessThan(0.49);
    for (const fn of model.functions)
      for (const edge of fn.neighbors) {
        expect(edge.evidence.length).toBeGreaterThan(0);
        expect(edge.evidence.every((item) => item.weight > 0)).toBe(true);
      }
    expect(renderReport(model)).toContain(model.statistics.density.toFixed(6));
  });

  test('AC-07: independent generator processes produce byte-identical artifacts', () => {
    const root = path.join(__dirname, '..');
    const script = `const g = require('./scripts/generate-function-model'); process.stdout.write(JSON.stringify(g.buildFunctionModel()));`;
    const first = execFileSync(process.execPath, ['-e', script], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    const second = execFileSync(process.execPath, ['-e', script], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(first.equals(second)).toBe(true);
    expect(JSON.parse(first)).toEqual(model);
    expect(writeOrCheck(model, { check: true })).toEqual([]);
  });

  test('AC-07: CLI exits successfully for the current committed artifact', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-function-model.js', '--check'], {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK');
  });
});

describe('event and drift regressions', () => {
  test('event edges honor Moleculer listener wildcards with explicit evidence', () => {
    const model = fixture({
      serviceEvents: { 'svc-a': { emits: ['event.a.v1'] }, 'svc-b': { listens: ['event.*.v1'] } },
    });
    const edge = api.getNeighbors('fn-a', { model }).find((item) => item.functionId === 'fn-b');
    expect(edge.evidence).toContainEqual({
      kind: 'event',
      feature: 'emits-listens',
      ref: 'event.a.v1',
      listener: 'event.*.v1',
      weight: 0.8,
    });
  });

  test('event constants respect lexical scope and mutable values remain unresolved', () => {
    const result = extractStaticEvents(`
      const EVENT = 'event-a.v1';
      function first() { const EVENT = 'event-b.v1'; broker.emit(EVENT, {}); }
      function second(EVENT) { broker.emit(EVENT, {}); }
      let dynamic = 'event-c.v1'; dynamic = getEvent(); broker.emit(dynamic, {});
      broker.emit(EVENT, {});
    `);
    expect(result.emits).toEqual(['event-a.v1', 'event-b.v1']);
    expect(result.unresolved).toHaveLength(2);
  });

  test('AC-07: the CLI rejects edited artifacts with nonzero status', () => {
    const root = path.join(__dirname, '..');
    const outputDir = temporaryDirectory();
    try {
      fs.mkdirSync(path.join(outputDir, 'scripts'));
      for (const name of [
        'generate-function-model.js',
        'function-model-projection.js',
        'function-model-sources.js',
      ]) {
        fs.copyFileSync(path.join(root, 'scripts', name), path.join(outputDir, 'scripts', name));
      }
      for (const name of [
        'src',
        'services',
        'node_modules',
        'operation-capability-index.json',
        'function-model.parameters.json',
      ]) {
        fs.symlinkSync(path.join(root, name), path.join(outputDir, name));
      }
      fs.writeFileSync(path.join(outputDir, 'function-model.json'), '{}\n');
      fs.copyFileSync(
        path.join(root, 'function-model.report.md'),
        path.join(outputDir, 'function-model.report.md')
      );
      const result = spawnSync(
        process.execPath,
        ['scripts/generate-function-model.js', '--check'],
        { cwd: outputDir, encoding: 'utf8' }
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('function-model.json');
      expect(result.stderr).toContain('npm run generate:function-model');
      expect(fs.readFileSync(path.join(outputDir, 'function-model.json'), 'utf8')).toBe('{}\n');
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  });
});

test('missing domains have distinct fallback IDs and readable labels', () => {
  const model = fixture({ capabilities: [cap('a', null), cap('b', 'a')] });
  expect(api.findFunctionsForCapability('a', { model })[0]).toMatchObject({
    functionId: 'fn-cap-a',
    label: 'a',
  });
  expect(model.functions).toHaveLength(2);
});
