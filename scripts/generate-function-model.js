#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compareCanonicalStrings } = require('../src/canonical-order');
const { projectFunctionModel } = require('./function-model-projection');
const { loadServiceEvents } = require('./function-model-sources');

const ROOT = path.join(__dirname, '..');

function buildFunctionModel() {
  const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
  const { semanticDomains } = require('../src/semantic-domains');
  const { operations } = require('../operation-capability-index.json');
  const parameters = require('../function-model.parameters.json');
  const { events, sources } = loadServiceEvents(ROOT);
  for (const ref of [
    'src/capability-catalog.js',
    'src/semantic-domains.js',
    'src/oeo-mappings.js',
    'src/canonical-order.js',
    'operation-capability-index.json',
    'function-model.parameters.json',
    'scripts/generate-function-model.js',
    'scripts/function-model-projection.js',
    'scripts/function-model-sources.js',
  ]) {
    sources.set(ref, fs.readFileSync(path.join(ROOT, ref), 'utf8'));
  }
  const sourceHash = crypto
    .createHash('sha256')
    .update(JSON.stringify([...sources].sort(([a], [b]) => compareCanonicalStrings(a, b))))
    .digest('hex');
  return projectFunctionModel({
    capabilities: CURATED_CAPABILITIES,
    operations,
    semanticDomains,
    serviceEvents: events,
    parameters,
    sourceHash,
  });
}

function renderReport(model) {
  const { statistics: stats, parameters, gaps } = model;
  const lines = [
    '# Function model — generated report',
    '',
    `Source SHA-256: \`${model.sourceHash}\``,
    '',
    `Capabilities: ${stats.capabilityCount}; functions: ${stats.functionCount}.`,
    `Directed density at minWeight=${parameters.minWeight}: **${stats.density.toFixed(6)}** (${stats.edgeCount}/${stats.possibleEdges}).`,
    `Naive baseline: ${parameters.baselineDensity}; target: ≤ ${parameters.targetDensity}; target met: ${stats.density <= parameters.targetDensity ? 'yes' : 'no'}.`,
    '',
    'All curated capabilities are assigned once, including entries without resolvable operations.',
    'Edges describe catalog evidence only; they grant no authorization.',
    '',
  ];
  for (const [kind, entries] of Object.entries(gaps)) {
    lines.push(`## ${kind} (${entries.length})`, '');
    if (!entries.length) lines.push('None.');
    else
      for (const entry of entries)
        lines.push(`- ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`);
    lines.push('');
  }
  lines.push(
    `## Automatic hubs (${stats.automaticHubs.length})`,
    '',
    ...stats.automaticHubs.map((key) => `- ${key}`),
    '',
    '## Parameters',
    '',
    '```json',
    JSON.stringify(parameters, null, 2),
    '```',
    '',
    'No overrides are applied. Dynamic event names and handler spreads are reported above, not guessed.',
    'Event extraction follows local CommonJS imports, including split service modules, without executing services.',
    'Functions without listeners cannot be woken directly by a known static event. Emission alone is not push capability.',
    ''
  );
  return lines.join('\n');
}

function writeOrCheck(model, { check = false, outputDir = ROOT } = {}) {
  const outputs = {
    'function-model.json': `${JSON.stringify(model, null, 2)}\n`,
    'function-model.report.md': renderReport(model),
  };
  const stale = [];
  for (const [name, text] of Object.entries(outputs)) {
    const file = path.join(outputDir, name);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) stale.push(name);
    } else fs.writeFileSync(file, text, 'utf8');
  }
  return stale;
}

function main() {
  const stale = writeOrCheck(buildFunctionModel(), { check: process.argv.includes('--check') });
  if (stale.length) {
    console.error(
      `[function-model] Stale: ${stale.join(', ')}. Run npm run generate:function-model`
    );
    process.exitCode = 1;
  } else console.log('[function-model] OK');
}

if (require.main === module) main();
module.exports = { buildFunctionModel, renderReport, writeOrCheck };
