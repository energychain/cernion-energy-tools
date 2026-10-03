#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { compareCanonicalStrings } = require('../src/canonical-order');
const { projectFunctionModel } = require('./function-model-projection');
const { loadServiceEvents } = require('./function-model-sources');

const ROOT = path.join(__dirname, '..');

function readCommittedFunctionModel(root = ROOT) {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-tree', 'HEAD', '--', 'function-model.json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (/not a git repository|Not a valid object name HEAD/.test(String(error.stderr))) return null;
    throw error;
  }
  if (!tracked.trim()) return null;
  return JSON.parse(
    execFileSync('git', ['show', 'HEAD:function-model.json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  );
}

function buildFunctionModel({ previousModel = readCommittedFunctionModel() } = {}) {
  const { CURATED_CAPABILITIES } = require('../src/capability-catalog');
  const { semanticDomains } = require('../src/semantic-domains');
  const { operations } = require('../operation-capability-index.json');
  const parameters = require('../function-model.parameters.json');
  const { events, sources, actions } = loadServiceEvents(ROOT);
  for (const ref of [
    'src/capability-catalog.js',
    'src/semantic-domains.js',
    'src/oeo-mappings.js',
    'src/canonical-order.js',
    'operation-capability-index.json',
    'function-model.parameters.json',
    'scripts/generate-function-model.js',
    'scripts/function-model-projection.js',
    'scripts/function-model-lineage.js',
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
    sourceActions: actions,
    parameters,
    sourceHash,
    previousModel,
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
    `Capabilities per function: ${JSON.stringify(stats.capabilitiesPerFunction)}.`,
    `Single-capability fraction: ${stats.singleCapabilityFraction.toFixed(6)}; cross-domain functions: ${stats.crossDomainFunctionCount}.`,
    `Outgoing degree: min=${stats.degree.minimum}; median=${stats.degree.median}; max=${stats.degree.maximum}; isolated fraction=${stats.degree.isolatedFraction.toFixed(6)}.`,
    `Maximum degree target: ≤ ${parameters.maxDegreeFraction} × ${stats.functionCount} = ${parameters.maxDegreeFraction * stats.functionCount}; met: ${stats.degree.maximum <= parameters.maxDegreeFraction * stats.functionCount ? 'yes' : 'no'}.`,
    '',
    `Candidate degree before mutual selection: ${JSON.stringify(stats.candidateDegree)}; pruned directed edges: ${stats.prunedEdgeCount}; peer limit: ${stats.degreeLimit}.`,
    '',
    `Operation index entries without action: ${stats.indexOperationsWithoutAction}/${stats.indexOperationCount}.`,
    '',
    'All curated capabilities are assigned once, including entries without resolvable operations.',
    'Edges describe catalog evidence only; they grant no authorization.',
    '',
  ];
  const changes = stats.idChanges;
  lines.push(
    '## ID-Änderungen gegenüber Vorversion',
    '',
    `same: ${changes.same}; merged: ${changes.merged}; split: ${changes.split}; retired: ${changes.retired}; new: ${changes.new}.`,
    `Previous source SHA-256: ${changes.previousSourceHash || 'None (initial generation)'}.`,
    'Counts describe prior IDs in the last membership transition; retired counts IDs that lost their active identity, including merges. No-op generation preserves this provenance.',
    `Permanently reserved retired IDs: ${gaps.retiredFunctionIds.length}.`,
    ''
  );
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
module.exports = { buildFunctionModel, renderReport, writeOrCheck, readCommittedFunctionModel };
