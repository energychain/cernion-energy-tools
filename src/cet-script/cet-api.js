'use strict';
const { fail } = require('./errors');
const v = require('./values');
const { namespace } = require('./builtins');
const { helpers } = require('./helpers');
const { tableSet, bindSql, query, filenameFor } = require('./sql');
const { selectOperation } = require('./operations');
const { graphApi } = require('./graph');
const { relations } = require('../project-graph-policy');
function createApi(options, module, budget) {
  const trace = [],
    staged = [],
    versions = new Map(),
    citations = [];
  const binding = Object.freeze({
    ...options.binding,
    skillId: module.meta.id,
    skillVersion: module.meta.version,
  });
  const datasets = v.copy(options.datasets || [], budget);
  const graph = v.copy(options.graph || [], budget);
  const passages = v.copy(options.passages || [], budget);
  const scope = (record) => {
    if (
      record.tenantId !== binding.tenantId ||
      (record.projectId || record.provenance?.projectId) !== binding.projectId
    )
      fail('CONTAINER_VIOLATION', 'Foreign source record');
  };
  datasets.forEach(scope);
  graph.forEach(scope);
  passages.forEach(scope);
  const tables = tableSet(datasets, options.aliases, budget);
  const datasetIds = new Set(datasets.map((item) => item.id));
  const nodeIds = new Set(graph.map((item) => item.nodeId).filter(Boolean));
  const checkScope = (data) => {
    if (!data || typeof data !== 'object') return;
    for (const [key, value] of Object.entries(data)) {
      budget.tick();
      if (
        (key === 'tenantId' && value !== binding.tenantId) ||
        (key === 'projectId' && value !== binding.projectId) ||
        (key === 'datasetId' && !datasetIds.has(value)) ||
        (key === 'nodeId' && !nodeIds.has(value))
      )
        fail('CONTAINER_VIOLATION', 'Foreign operation reference');
      if (typeof value === 'string' && /^ds_[a-f0-9]{32}$/.test(value) && !datasetIds.has(value))
        fail('CONTAINER_VIOLATION', 'Foreign dataset reference');
      checkScope(value);
    }
  };

  const record = (kind, params, result, index = trace.length) => {
    budget.check();
    const entry = v.copy(
      { kind, params: v.plain(params, budget), result: v.plain(result, budget) },
      budget
    );
    trace[index] = entry;
    budget.bound('collectionItems', trace.length);
    v.serialized(trace, budget, 'valueBytes');
    return result;
  };
  const read = (name, work, counter) =>
    v.capability(
      async (args, node) => {
        budget.check(node);
        if (counter) budget.charge(counter, 1, node);
        const position = trace.length;
        trace.push(null);
        const params = v.copy(v.plain(args, budget), budget);
        const result = v.copy(await work(params, node), budget);
        return record(name, params, result, position);
      },
      name,
      true
    );
  let sqlQueue = Promise.resolve();
  const sql = async (strings, values, node) => {
    const position = trace.length;
    trace.push(null);
    const bound = bindSql(strings, values, node);
    for (const parameter of bound.params)
      budget.allocate(typeof parameter === 'string' ? parameter.length * 2 + 16 : 16, node);
    const filename = await filenameFor(options.basePath, binding);
    const task = sqlQueue.then(() => query({ filename, ...bound, datasets, budget, node }));
    sqlQueue = task;
    const result = await task;
    record(
      'sql',
      {
        sql: bound.sql,
        params: bound.params,
        sources: datasets.map((item) => ({
          datasetId: item.id,
          objectId: item.provenance?.objectId,
          hash: item.hash,
        })),
      },
      { rows: result.length },
      position
    );
    return result;
  };
  const state = { graph, datasets, budget, relations, tables, sql };
  const { api: graphMethods, nodeFor } = graphApi(state, read);
  const result = (kind, value, settings) => {
    const data = v.copy(v.plain(value, budget), budget);
    const output = Object.assign(v.record(), {
      kind,
      ...(kind === 'table' ? { rows: data } : kind === 'mixed' ? { items: data } : { value: data }),
      options: v.copy(v.plain(settings || v.record(), budget), budget),
    });
    v.serialized(output, budget);
    return output;
  };
  const api = traceApi(
    namespace({
      ...helpers(budget, options.asOf),
      table: v.capability(([alias], node) => {
        if (typeof alias !== 'string' || !tables.has(alias))
          fail('UNKNOWN_TABLE', 'Unknown project table', node);
        record('table', [alias], { datasetId: v.handles.get(tables.get(alias)).datasetId });
        return tables.get(alias);
      }),
      datasets: v.capability(() =>
        record(
          'datasets',
          [],
          v.copy(
            datasets.map((item) => ({
              datasetId: item.id,
              title: item.title,
              period: item.period,
              columns: item.columns.filter((col) => !col.sensitive),
            })),
            budget
          )
        )
      ),
      graph: graphMethods,
      passages: namespace({
        search: read('passages.search', ([query, options = {}]) => {
          if (typeof query !== 'string') fail('RUNTIME_ERROR', 'Expected search text');
          const limit = options.limit ?? 5;
          if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            fail('RUNTIME_ERROR', 'Invalid passage limit');
          return passages
            .filter((passage) => passage.text.toLowerCase().includes(query.toLowerCase()))
            .slice(0, limit);
        }),
        get: read('passages.get', ([id]) => {
          const passage = passages.find((item) => item.passageId === id);
          if (!passage) fail('CONTAINER_VIOLATION', 'Passage outside project');
          return passage;
        }),
      }),
      op: read(
        'op',
        async ([id, params = v.record()], node) => {
          const operation = selectOperation(options.index, id, node);
          if (!options.callOperation)
            fail('OPERATION_REJECTED', 'Operation adapter unavailable', node);
          if (!params || typeof params !== 'object' || Array.isArray(params))
            fail('OPERATION_REJECTED', 'Expected operation parameters', node);
          const safe = { ...params, tenantId: binding.tenantId, projectId: binding.projectId };
          checkScope(safe);
          const output = await budget.wait(options.callOperation(operation, safe), node);
          versions.set(
            operation.operationId,
            operation.version || options.index.packageVersion || options.index.schemaVersion || '1'
          );
          const checked = v.copy(output, budget);
          checkScope(checked);
          return checked;
        },
        'opCalls'
      ),
      result: namespace({
        table: v.capability(([rows, settings]) => {
          if (!Array.isArray(rows)) fail('RUNTIME_ERROR', 'Expected result rows');
          return result('table', rows, settings);
        }),
        value: v.capability(([value, settings]) => {
          if (typeof value !== 'number' || !Number.isFinite(value))
            fail('RUNTIME_ERROR', 'Expected finite result');
          return result('value', value, settings);
        }),
        text: v.capability(([template, values = v.record()]) => {
          if (typeof template !== 'string') fail('RUNTIME_ERROR', 'Expected text template');
          let text = template;
          for (const [key, value] of Object.entries(values)) {
            v.keyOf(key);
            v.primitive(value);
            const replacement = String(value),
              marker = '${' + key + '}';
            budget.bound('valueBytes', (text.length + 1) * (replacement.length + 1) * 2);
            text = text.replaceAll(marker, replacement);
          }
          const output = result('text', text);
          output.values = v.copy(values, budget);
          return output;
        }),
        mixed: v.capability(([items]) => {
          if (!Array.isArray(items)) fail('RUNTIME_ERROR', 'Expected result items');
          return result('mixed', items);
        }),
      }),
      cite: v.capability(([value, refs]) => {
        if (!Array.isArray(refs)) fail('RUNTIME_ERROR', 'Expected citation references');
        const known = new Set(
          [
            ...graph.map((item) => item.nodeId),
            ...passages.map((item) => item.passageId),
            ...datasets.flatMap((item) => [item.id, item.provenance?.objectId]),
          ].filter(Boolean)
        );
        if (refs.some((ref) => typeof ref !== 'string' || !known.has(ref)))
          fail('CONTAINER_VIOLATION', 'Unknown citation source');
        citations.push({ value: v.copy(v.plain(value, budget), budget), refs: refs.slice() });
        return value;
      }),
      gap: v.capability(([description, settings = v.record()]) => {
        if (
          typeof description !== 'string' ||
          !description.trim() ||
          !Array.isArray(settings.needs) ||
          !settings.needs.length
        )
          fail('RUNTIME_ERROR', 'A gap requires a description and needs');
        return v.copy({ kind: 'gap', description, needs: settings.needs }, budget);
      }),
      derived: namespace({
        put: read('derived.put', ([key, value, settings = {}]) => {
          if (
            typeof key !== 'string' ||
            !key ||
            key.length > 200 ||
            !Array.isArray(settings.describes || [])
          )
            fail('RUNTIME_ERROR', 'Invalid derived entry');
          for (const id of settings.describes || []) nodeFor(id);
          budget.charge('derivedEntries');
          v.serialized(value, budget, 'derivedEntryBytes');
          staged.push(v.copy({ key, value, describes: settings.describes || [] }, budget));
          return { key, staged: true };
        }),
      }),
      log: v.capability(([message, data = null]) => {
        if (typeof message !== 'string') fail('RUNTIME_ERROR', 'Expected log text');
        v.serialized({ message, data }, budget, 'derivedEntryBytes');
        record('log', [message], data);
        return undefined;
      }),
    })
  );
  function traceApi(value, path = '') {
    const cap = v.capabilities.get(value);
    if (cap) {
      if (cap.async || ['table', 'datasets', 'log'].includes(path)) return value;
      return v.capability((args, node) => {
        const result = cap.fn(args, node);
        record(path, args.map(summary), summary(result));
        return result;
      }, path);
    }
    if (!value || typeof value !== 'object') return value;
    const entries = v.record();
    for (const [key, item] of Object.entries(value))
      entries[key] = traceApi(item, path ? `${path}.${key}` : key);
    return namespace(entries);
  }
  function summary(value) {
    if (Array.isArray(value)) return { length: value.length };
    if (value && typeof value === 'object') return { keys: Object.keys(value).slice(0, 32) };
    return typeof value === 'string' ? value.slice(0, 1000) : value;
  }
  return { api, sql, trace, staged, versions, citations, tables };
}
module.exports = { createApi };
