'use strict';
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const disk = require('../project-file-disk');
const { quoteDatasetField } = require('../dataset-query');
const { fail, ScriptError } = require('./errors');
const v = require('./values');
const { namespace } = require('./builtins');
const WORKER_EXIT_GRACE_MS = 2000;
function tableSet(datasets, aliases, budget) {
  const references = new Map();
  for (const dataset of datasets) {
    if (!/^ds_[a-f0-9]{32}$/.test(dataset.id))
      fail('CONTAINER_VIOLATION', 'Invalid dataset identity');
    const table = quoteDatasetField(dataset.id);
    const handle = v.record();
    handle.col = v.capability(([name], node) => {
      const index = dataset.columns.findIndex(
        (column) => column.name === name && !column.sensitive
      );
      if (index < 0) fail('SQL_REJECTED', 'Unknown or restricted column', node);
      const column = Object.freeze(v.record());
      v.handles.set(column, {
        sql: `${table}.${quoteDatasetField(`c${index}`)}`,
        datasetId: dataset.id,
      });
      return column;
    });
    handle.columns = v.capability(() =>
      v.copy(
        dataset.columns
          .filter((column) => !column.sensitive)
          .map(({ name, type, unit }) => ({
            name,
            type,
            unit: unit || dataset.semantic?.units?.[name] || null,
          })),
        budget
      )
    );
    handle.unit = v.capability(([name]) => {
      if (!dataset.columns.some((column) => column.name === name && !column.sensitive))
        fail('SQL_REJECTED', 'Unknown column');
      return dataset.semantic?.units?.[name] || null;
    });
    handle.timeField = v.capability(() => dataset.semantic?.timeField || null);
    Object.freeze(handle);
    v.handles.set(handle, { sql: table, datasetId: dataset.id });
    references.set(dataset.id, handle);
  }
  for (const [alias, id] of Object.entries(aliases || {})) {
    if (references.has(id) && !references.has(alias)) references.set(alias, references.get(id));
  }
  return references;
}
async function filenameFor(basePath, binding) {
  const directory = await disk.projectDirectory(basePath, binding.tenantId, binding.projectId);
  const filename = path.join(directory, 'project.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      await disk.regularFile(filename + suffix);
    } catch (error) {
      if (!suffix || error.code !== 'ENOENT') throw error;
    }
  }
  return filename;
}
function bindSql(strings, values, node) {
  let sql = strings[0];
  const params = [],
    ids = new Set();
  for (let index = 0; index < values.length; index++) {
    const value = values[index],
      handle = v.handles.get(value);
    if (handle) {
      sql += handle.sql;
      ids.add(handle.datasetId);
    } else {
      v.primitive(value, node);
      if (value === undefined || (typeof value === 'number' && !Number.isFinite(value)))
        fail('SQL_REJECTED', 'Unsupported SQL parameter', node);
      sql += '?';
      params.push(typeof value === 'boolean' ? Number(value) : value);
    }
    sql += strings[index + 1];
  }
  return { sql, params, ids: [...ids] };
}
async function query({ filename, sql, params, datasets, budget, node }) {
  budget.check(node);
  budget.charge('sqlQueries', 1, node);
  const remaining = budget.limits.sqlRowsTotal - (budget.used.sqlRowsTotal || 0);
  const rowLimit = Math.min(remaining, budget.limits.sqlRowsPerQuery);
  const worker = new Worker(path.join(__dirname, 'sql-worker.js'), {
    workerData: {
      filename,
      sql,
      params,
      datasets,
      rowLimit,
      rowBudget: remaining < budget.limits.sqlRowsPerQuery ? 'sqlRowsTotal' : 'sqlRowsPerQuery',
      valueLimit: budget.limits.valueBytes,
      memoryLimit: budget.limits.memoryBytes - (budget.used.memoryBytes || 0),
      deadline: performance.now() + budget.remaining(),
      stepLimit: budget.limits.steps - (budget.used.steps || 0),
    },
    resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 },
  });
  const exited = new Promise((resolve) => worker.once('exit', resolve));
  try {
    const result = await budget.wait(
      new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', () =>
          reject(new ScriptError('SQL_REJECTED', 'SQL worker failed', node))
        );
        worker.once('exit', (code) => {
          if (code !== 0) reject(new ScriptError('SQL_REJECTED', 'SQL worker stopped', node));
        });
      }),
      node
    );
    if (result.error) {
      if (result.error.code === 'CET_SCRIPT_BUDGET_EXCEEDED')
        budget.exceed(result.error.details.budget, node);
      fail('SQL_REJECTED', result.error.message, node);
    }
    budget.charge('steps', result.workSteps || 0, node);
    const rows = JSON.parse(result.rowsJson);
    budget.charge('sqlRowsTotal', rows.length, node);
    return v.copy(rows, budget);
  } finally {
    // Let the guarded statement unwind before destroying its isolate.
    // Forced isolate termination can suppress native callback exceptions, so it is only the
    // last resort when a statement does not reach a checkpoint within the grace period.
    let timer;
    const grace = new Promise((resolve) => {
      timer = setTimeout(resolve, WORKER_EXIT_GRACE_MS, 'timeout');
    });
    if ((await Promise.race([exited, grace])) === 'timeout') {
      await worker.terminate();
      await exited;
    }
    clearTimeout(timer);
  }
}
module.exports = { tableSet, filenameFor, bindSql, query, namespace };
