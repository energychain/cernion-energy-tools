'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const disk = require('../project-file-disk');
const { principal } = require('../domain-router-policy');
const projectPolicy = require('../project-file-policy');
const graphPolicy = require('../project-graph-policy');
const { ingestCapability } = require('../project-file-ingest-policy');
const { sections } = require('../tenant-document-knowledge');
const { projectRoutingSources } = require('../project-manifest-metadata');
const { runSkill, contentHash, Budgets } = require('./index');
const { fail } = require('./errors');
const { parseText } = require('./json');
const v = require('./values');
function authMeta(meta, tenantId) {
  return {
    ...Object.fromEntries(
      ['authUser', 'apiToken', 'roles', 'scopes', 'domainsAllowed']
        .filter((key) => meta[key] !== undefined)
        .map((key) => [key, meta[key]])
    ),
    tenantId,
  };
}
function operationCaller(ctx, p) {
  return async (operation, params) => {
    const meta = authMeta(ctx.meta, p.tenantId);
    const allowed =
      meta.domainsAllowed || meta.authUser?.domainsAllowed || meta.apiToken?.domainsAllowed || [];
    if (
      allowed.length &&
      !(operation.domains || []).some((domain) =>
        allowed.some(
          (name) => name.normalize('NFKC').toLowerCase() === domain.normalize('NFKC').toLowerCase()
        )
      )
    )
      fail('OPERATION_REJECTED', 'Domain is unavailable');
    const auth = meta.authUser || meta.apiToken;
    const scopes = new Set([auth.scope, ...(auth.scopes || []), ...(meta.scopes || [])]);
    if (
      !scopes.has('full-access') &&
      !scopes.has('read-only') &&
      !(
        operation.requiredScopes?.length &&
        operation.requiredScopes.every((scope) => scopes.has(scope))
      )
    )
      fail('OPERATION_REJECTED', 'Operation scope required');
    const split = operation.action.lastIndexOf('.');
    const definition = ctx.broker.getLocalService(operation.action.slice(0, split))?.schema
      .actions?.[operation.action.slice(split + 1)];
    if (!definition || definition.visibility === 'private')
      fail('OPERATION_REJECTED', 'Operation backend unavailable');
    if (
      definition.requiredRoles?.length &&
      !definition.requiredRoles.some((role) => p.roles.includes(role))
    )
      fail('OPERATION_REJECTED', 'Operation role required');
    const safe = { ...params, tenantId: p.tenantId };
    principal({ meta }, safe);
    return ctx.call(operation.action, safe, { meta, parentCtx: null, retries: 0, timeout: 30000 });
  };
}
function readDerived(filename, binding, budget = new Budgets()) {
  if (!fs.existsSync(filename)) return [];
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (
      !db
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='cet_script_derived' AND type='table'")
        .get()
    )
      return [];
    const records = new Map();
    for (const { document } of db
      .prepare('SELECT document FROM cet_script_derived ORDER BY key')
      .iterate()) {
      budget.tick();
      budget.bound('derivedEntryBytes', Buffer.byteLength(document));
      for (const row of parseText(document, budget)) {
        if (row.tenantId !== binding.tenantId || row.projectId !== binding.projectId)
          fail('CONTAINER_VIOLATION', 'Foreign derived record');
        records.set(row.nodeId || row.edgeId, row);
        budget.bound('collectionItems', records.size);
      }
    }
    return [...records.values()];
  } finally {
    db.close();
  }
}
function commitDerived(filename, binding) {
  return (entries, origin, budget) => {
    budget.check();
    try {
      fs.closeSync(fs.openSync(filename, 'ax', 0o600));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const db = new Database(filename, { fileMustExist: true });
    try {
      db.transaction(() => {
        db.exec(
          'CREATE TABLE IF NOT EXISTS cet_script_derived (key TEXT PRIMARY KEY, document TEXT NOT NULL)'
        );
        const put = db.prepare(
          'INSERT INTO cet_script_derived VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET document=excluded.document'
        );
        for (const entry of entries) {
          const key = `${origin.skillId}:${entry.key}`,
            nodeId = `s_${contentHash(key)}`;
          const scope = { tenantId: binding.tenantId, projectId: binding.projectId };
          const sources = [
            ...new Set(
              origin.trace.flatMap((item) =>
                item.kind === 'sql'
                  ? item.params.sources.flatMap(
                      (source) =>
                        origin.sourceNodes
                          ?.filter((node) => node.ref === source.datasetId)
                          .map((node) => node.nodeId) || []
                    )
                  : item.kind.startsWith('graph.')
                    ? (item.result.nodes || (Array.isArray(item.result) ? item.result : [])).map(
                        (node) => node.nodeId
                      )
                    : []
              )
            ),
          ];
          const skillNodeId = `s_${contentHash(['skill', origin.skillId])}`;
          sources.push(skillNodeId);
          const records = [
            {
              ...scope,
              recordType: 'node',
              nodeId: skillNodeId,
              kind: 'skill',
              ref: origin.skillId,
              labels: [origin.skillId],
              attributes: { version: origin.skillVersion },
            },
            {
              ...scope,
              recordType: 'node',
              nodeId,
              kind: 'entity',
              ref: key,
              labels: [entry.key],
              attributes: { derived: true, value: entry.value },
              provenance: {
                skillId: origin.skillId,
                skillVersion: origin.skillVersion,
                replayHash: origin.replayHash,
                sources: origin.sources,
              },
            },
          ];
          for (const [relation, ids] of [
            ['describes', entry.describes],
            ['derivedFrom', sources],
          ])
            for (const to of ids)
              records.push({
                ...scope,
                recordType: 'edge',
                edgeId: `s_${contentHash([nodeId, to, relation])}`,
                from: nodeId,
                to,
                relation,
                weight: 1,
              });
          const document = v.serialized(records, budget, 'derivedEntryBytes');
          put.run(key, document);
        }
        budget.check();
      })();
    } finally {
      db.close();
    }
  };
}
function projectAliases(graph, datasets, projectId) {
  const aliases = v.record();
  const routing = projectRoutingSources(graph, datasets, projectId);
  for (const dataset of datasets) {
    const names = routing
      .filter((source) =>
        graph.some((node) => node.nodeId === source.nodeId && node.ref === dataset.id)
      )
      .flatMap((source) => source.names);
    for (const name of new Set(
      [dataset.title, ...(dataset.aliases || []), ...names].filter(Boolean)
    )) {
      if (Object.hasOwn(aliases, name) && aliases[name] !== dataset.id) aliases[name] = null;
      else if (!Object.hasOwn(aliases, name)) aliases[name] = dataset.id;
    }
  }
  return aliases;
}
async function projectPassages(ctx, binding, p, budget) {
  const documents = v.copy(await ctx.call('knowledge-rag.documentList', {}));
  const passages = [];
  for (const document of documents.filter(
    (record) =>
      record.tenantId === p.tenantId &&
      record.provenance?.projectId === binding.projectId &&
      record.status === 'active'
  )) {
    const source = v.copy(await ctx.call('knowledge-rag.documentGet', { id: document.id }));
    if (source.tenantId !== p.tenantId || source.provenance?.projectId !== binding.projectId)
      fail('CONTAINER_VIOLATION', 'Foreign document');
    for (const section of sections(source)) {
      budget.tick();
      budget.allocate(section.text.length * 2 + 256);
      passages.push({
        ...binding,
        passageId: contentHash([source.id, source.hash, section.location]),
        objectId: source.provenance.objectId,
        hash: source.hash,
        location: section.location,
        text: section.text,
      });
    }
  }
  return passages;
}
async function snapshot(ctx, request, basePath, p, budget = new Budgets(request.budgets)) {
  const original = ctx;
  ctx = Object.assign(Object.create(ctx), {
    call: async (...args) => v.copy(await budget.wait(original.call(...args)), budget),
  });
  const projectId = request.projectId;
  const project = await ctx.call('project-file.get', { projectId });
  if (
    project.tenantId !== p.tenantId ||
    !projectPolicy.visibleProject(project, p) ||
    project.lifecycle === 'archived' ||
    project.deletion
  )
    fail('CONTAINER_VIOLATION', 'Project unavailable');
  const catalog = v.copy(await ctx.call('datapoint.datasetCatalog', { operation: 'list' }));
  const datasets = catalog.filter(
    (record) =>
      record.tenantId === p.tenantId &&
      record.provenance?.projectId === projectId &&
      record.current !== false
  );
  const records = v.copy(
    await ctx.call(
      'object-store.projectGraphRecord',
      { operation: 'list', projectId },
      { meta: { ...ctx.meta, projectGraph: graphPolicy.capability } }
    )
  );
  if (records.some((record) => record.recordType === 'state' && record.pending))
    fail('CONTAINER_VIOLATION', 'Graph update pending');
  if (records.some((record) => record.tenantId !== p.tenantId || record.projectId !== projectId))
    fail('CONTAINER_VIOLATION', 'Foreign graph record');
  const graph = records.filter((record) => record.recordType !== 'state');
  const aliases = projectAliases(graph, datasets, projectId);
  const directory = await disk.projectDirectory(basePath, p.tenantId, projectId);
  const filename = path.join(directory, 'project.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      await disk.regularFile(filename + suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const binding = { tenantId: p.tenantId, projectId };
  graph.push(...readDerived(filename, binding, budget));
  const passages = await projectPassages(ctx, binding, p, budget);
  const versionData = {
    datasets: datasets.map((record) => [record.id, record.version, record.hash]),
    graph: graph.map(({ tenantId: _tenantId, projectId: _projectId, ...record }) => record),
    passages: passages.map((record) => [record.passageId, record.hash]),
  };
  v.serialized(versionData, budget, 'valueBytes');
  binding.dataVersion = contentHash(versionData);
  return {
    basePath,
    binding,
    datasets,
    graph,
    passages,
    aliases,
    callOperation: operationCaller(ctx, p),
    commitDerived: commitDerived(filename, binding),
  };
}
async function runProjectSkill(ctx, request) {
  const p = principal(ctx);
  const basePath =
    ctx.broker.getLocalService('project-upload')?.basePath() ||
    process.env.CET_PROJECT_DATA_PATH ||
    './data/project-objects';
  const safe = Object.assign(Object.create(ctx), { meta: authMeta(ctx.meta, p.tenantId) });
  try {
    return await safe.call(
      'project-file.ingestMutation',
      {
        projectId: request.projectId,
        work: async () => {
          const budget = new Budgets(request.budgets);
          try {
            const options = await snapshot(safe, request, basePath, p, budget);
            return await runSkill(request.source, request.input, {
              ...options,
              asOf: request.asOf,
              budget,
            });
          } finally {
            budget.stopped = true;
          }
        },
      },
      { meta: { ...safe.meta, projectIngest: ingestCapability }, timeout: 0 }
    );
  } catch (error) {
    // Callers can persist this bounded diagnostic in their lifecycle journal.
    error.scriptDiagnostic = {
      code: error.type || error.code || 'CET_SCRIPT_RUNTIME_ERROR',
      line: error.line || 1,
      column: error.column || 0,
    };
    throw error;
  }
}
module.exports = { runProjectSkill, snapshot, operationCaller, readDerived, commitDerived };
