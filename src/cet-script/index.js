'use strict';
const { createHash } = require('node:crypto');
const { safeEvidenceRef } = require('../workbench-evidence');
const { Budgets } = require('./budgets');
const { parse } = require('./parse');
const { Interpreter } = require('./interpreter');
const { createApi } = require('./cet-api');
const { operationIndex, selectOperation } = require('./operations');
const { ScriptError, fail } = require('./errors');
const v = require('./values');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const output = v.record();
  for (const key of Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
    output[key] = canonical(value[key]);
  return output;
}
function contentHash(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function numericOrigins(value, origin, budget, path = '', result = v.record()) {
  budget.tick();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('RUNTIME_ERROR', 'Nonfinite output value');
    result[path || '/'] = origin;
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value))
      numericOrigins(
        item,
        origin,
        budget,
        `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        result
      );
  }
  return result;
}
async function runSkill(source, input, options) {
  const budget = options.budget instanceof Budgets ? options.budget : new Budgets(options.budgets);
  let api;
  try {
    const binding = options.binding;
    if (
      !binding?.tenantId ||
      !binding.projectId ||
      binding.dataVersion == null ||
      typeof options.asOf !== 'string' ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(options.asOf) ||
      Number.isNaN(Date.parse(options.asOf))
    )
      fail('CONTAINER_VIOLATION', 'A complete execution binding and asOf are required');
    const safeInput = v.copy(input, budget);
    v.serialized(safeInput, budget, 'valueBytes');
    const hashInput = v.copy(safeInput, budget);
    const index = operationIndex(options.index);
    const module = parse(source, budget, {
      checkOperation: (id, node) => selectOperation(index, id, node),
    });
    if (!module.validateInput(safeInput)) fail('RUNTIME_ERROR', 'Input does not match schema');
    api = createApi({ ...options, index }, module, budget);
    // Resolve static table references before any script evaluation.
    parse(source, budget, {
      checkTable: (alias, node) => {
        if (!api.tables.has(alias)) fail('UNKNOWN_TABLE', 'Unknown project table', node);
      },
      checkOperation: (id, node) => selectOperation(index, id, node),
    });
    const runtime = new Interpreter(budget, api.api, api.sql);
    const value = v.copy(v.plain(await runtime.run(module, safeInput), budget), budget);
    const operations = [...api.versions].sort(([a], [b]) => a.localeCompare(b));
    const replayHash = contentHash([
      source,
      { input: hashInput, asOf: options.asOf },
      binding.dataVersion,
      operations,
    ]);
    const sources = [
      ...(options.datasets || []).map((item) => ({
        objectId: item.provenance?.objectId,
        hash: item.hash,
      })),
      ...(options.passages || []).map((item) => ({
        objectId: item.objectId,
        hash: item.hash,
        passageId: item.passageId,
      })),
      ...(options.graph || []).flatMap((item) =>
        item.provenance?.hash
          ? [
              {
                nodeId: item.nodeId,
                objectId: item.provenance.objectId,
                hash: item.provenance.hash,
              },
            ]
          : []
      ),
    ];
    const origin = {
      skillId: module.meta.id,
      skillVersion: module.meta.version,
      dataVersion: binding.dataVersion,
      trace: api.trace,
      sources,
      citations: api.citations,
      sourceNodes: (options.graph || [])
        .filter((node) => node.recordType === 'node')
        .map(({ nodeId, ref }) => ({ nodeId, ref })),
    };
    const evidence = safeEvidenceRef(
      {
        evidenceId: `script-${replayHash}`,
        sourceFingerprint: replayHash,
        createdAt: options.asOf,
        tenantId: binding.tenantId,
        evidenceType: 'generic_document',
        sourceType: 'manual_metadata',
        label: module.meta.id,
        status: 'attached',
        sensitivityLevel: 'tenant_internal',
        sourceRef: { reference: replayHash, fileHash: replayHash },
        fileHash: replayHash,
        hashStatus: 'provided',
        provenance: {
          system: 'cet-script',
          retrievalMode: 'script',
          retrievedAt: options.asOf,
          retrievedBy: 'cet-script',
        },
        extracts: { skillId: module.meta.id, skillVersion: module.meta.version, sources },
        evidenceRole: 'supporting_evidence',
        claimStrength: 'reference',
      },
      { tenantId: binding.tenantId }
    );
    const { trace: _trace, ...numberOrigin } = origin;
    numberOrigin.traceRef = '/log';
    const output = {
      result: value,
      replayHash,
      provenance: numericOrigins(value, numberOrigin, budget),
      evidence,
      log: api.trace,
    };
    v.serialized(output, budget);
    budget.check();
    if (api.staged.length) {
      if (!options.commitDerived) fail('CONTAINER_VIOLATION', 'Atomic derived storage unavailable');
      // The trusted adapter must perform one synchronous transaction and check before commit.
      options.commitDerived(api.staged, { ...origin, replayHash }, budget);
    }
    return output;
  } catch (error) {
    if (error instanceof ScriptError) throw error;
    fail('RUNTIME_ERROR', 'Script execution failed');
  } finally {
    budget.stopped = true;
  }
}
module.exports = { runSkill, parse, Budgets, contentHash };
