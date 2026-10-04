#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServiceBroker } = require('moleculer');
const { canonical, signalKey, projectSignals, isFinding } = require('../src/signal-projection');
const { compareCanonicalStrings } = require('../src/canonical-order');
const rules = require('../signal-projection.rules.json');
const config = require('../signal-catalog.parameters.json');
const root = path.resolve(__dirname, '..');

async function buildCatalog() {
  const schema = require(path.join(root, config.dashboard));
  const model = require('../function-model.json');
  const index = require('../operation-capability-index.json');
  const seed = require(path.join(root, config.seedModule))[config.seedExport];
  const tenantId = seed.demoTenant.tenantId;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-catalog-'));
  const broker = new ServiceBroker({
    logger: false,
    transporter: null,
    requestTimeout: 2000,
    retryPolicy: { enabled: false },
  });
  broker.createService(schema);
  const store = require(path.join(root, config.store));
  broker.createService({
    ...store,
    settings: { ...store.settings, dbPath: path.join(dir, 'objects') },
  });
  broker.createService(require(path.join(root, config.runtime)));
  const NativeDate = Date;
  // Only this isolated generator process freezes the clock. Timers remain real.
  global.Date = class extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [rules.asOf]));
    }
    static now() {
      return NativeDate.parse(rules.asOf);
    }
  };
  try {
    await broker.start();
    const operations = [];
    for (const [name, definition] of Object.entries(schema.actions).sort(([a], [b]) =>
      compareCanonicalStrings(a, b)
    )) {
      const action = `${schema.name}.${name}`;
      const indexed = index.operations.find((op) => op.action === action);
      const params = canonical(definition.params || {});
      const parameterNames = Object.keys(params)
        .filter((p) => !rules.controlParameters.includes(p))
        .sort(compareCanonicalStrings);
      const row = {
        operationId: indexed?.operationId || `${schema.name}_${name}`,
        action,
        functionIds: model.functions
          .filter((fn) => fn.operations.includes(action))
          .map((fn) => fn.functionId)
          .sort(compareCanonicalStrings),
        classification: 'contextual',
        contextKinds: parameterNames.filter((p) => new RegExp(rules.roles.context, 'i').test(p)),
        parameterNames,
        requiredParameters: Object.entries(params)
          .filter(([, p]) => p.optional !== true && p.default === undefined)
          .map(([p]) => p),
        responseSchema: canonical(
          definition.openapi?.responses?.[200]?.content?.['application/json']?.schema || null
        ),
        probe: null,
        signals: [],
        uncoveredReason: null,
      };
      try {
        const response = await broker.call(
          action,
          {},
          {
            meta: {
              tenantId,
              authUser: { tenantId, id: 'catalog-probe', roles: ['ROLE_USER'], scope: 'read-only' },
            },
          }
        );
        row.probe = { responded: true, response: canonical(response) };
        const candidate = projectSignals(response, { ...row, classification: 'standing' });
        const needs = candidate.some((s) => s.state === 'needs_context');
        // Missing inputs, findings or incomplete scores with optional inputs are
        // assessments, even when the response uses an optimistic status token.
        row.classification = needs || candidate.some(isFinding) ? 'contextual' : 'standing';
        row.signals = projectSignals(response, row);
        if (!row.signals.length) row.uncoveredReason = 'no_matching_field_role';
      } catch (error) {
        row.probe = { responded: false, error: error.type || error.name };
        row.uncoveredReason = row.requiredParameters.length
          ? 'required_context_parameters'
          : 'probe_failed';
      }
      operations.push(row);
    }
    const responding = operations.filter((o) => o.probe.responded);
    const covered = responding.filter((o) => o.signals.length);
    const kinds = {};
    for (const op of operations)
      for (const s of op.signals) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    const sources = [
      'function-model.json',
      'operation-capability-index.json',
      'signal-projection.rules.json',
      'src/signal-projection.js',
      'scripts/generate-signal-catalog.js',
      'signal-catalog.parameters.json',
      config.dashboard,
      ...fs
        .readdirSync(
          path.join(
            root,
            path.dirname(config.dashboard),
            path.basename(config.dashboard, '.service.js')
          )
        )
        .sort(compareCanonicalStrings)
        .map(
          (f) =>
            `${path.dirname(config.dashboard)}/${path.basename(config.dashboard, '.service.js')}/${f}`
        ),
      config.runtime,
      config.store,
      config.seedFile,
    ];
    return {
      version: 1,
      generatedAt: rules.asOf,
      modelSourceHash: model.sourceHash,
      sourceHash: signalKey(
        sources.map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')])
      ),
      probeEnvironment: {
        tenantId,
        services: [schema.name, store.name, path.basename(config.runtime, '.service.js')],
        upstream: 'absent services use existing dashboard fallbacks; external calls disabled',
      },
      statistics: {
        operations: operations.length,
        responding: responding.length,
        covered: covered.length,
        coverage: responding.length ? covered.length / responding.length : 0,
        standing: operations.filter((o) => o.classification === 'standing').length,
        contextual: operations.filter((o) => o.classification === 'contextual').length,
        kinds,
        findingsWithoutContext: operations.flatMap((o) => o.signals).filter(isFinding).length,
      },
      operations,
    };
  } finally {
    global.Date = NativeDate;
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function renderReport(catalog) {
  const s = catalog.statistics;
  return `# Signal catalog (#722)\n\nGenerated deterministically at ${catalog.generatedAt}.\n\n${s.covered}/${s.responding} responding operations covered (${(s.coverage * 100).toFixed(2)}%); ${s.operations} total.\nStanding: ${s.standing}; contextual: ${s.contextual}.\nSignals by kind: ${JSON.stringify(s.kinds)}. Findings without context: ${s.findingsWithoutContext}.\n\nProbe environment: ${JSON.stringify(catalog.probeEnvironment)}. Context parameters and response schemas are recorded per operation. Native signals take precedence. Function associations use the generated model; empty associations are retained, never invented.\n\n| Operation | Classification | Signals | Functions | Uncovered reason |\n| --- | --- | ---: | ---: | --- |\n${catalog.operations.map((o) => `| ${o.operationId} | ${o.classification} | ${o.signals.length} | ${o.functionIds.length} | ${o.uncoveredReason || '—'} |`).join('\n')}\n`;
}
async function main() {
  const catalog = await buildCatalog();
  for (const [file, text] of [
    ['signal-catalog.json', `${JSON.stringify(catalog, null, 2)}\n`],
    ['signal-catalog.report.md', renderReport(catalog)],
  ]) {
    const target = path.join(root, file);
    if (process.argv.includes('--check')) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text)
        throw new Error(`Signal catalog drift: ${file}`);
    } else fs.writeFileSync(target, text);
  }
  console.log(JSON.stringify(catalog.statistics));
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { buildCatalog, renderReport };
