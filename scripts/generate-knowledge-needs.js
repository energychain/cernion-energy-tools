'use strict';

// Knowledge-need register (#997): a deterministic projection of what CET should know about a
// tenant, derived only from catalog data. Which catalog inputs are stable facts about the tenant
// is decided by the reviewed data list `knowledge-needs.parameters.json`, never by code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const VERSION = 1;
const SOURCES = [
  'knowledge-needs.parameters.json',
  'function-model.json',
  'src/capability-catalog.js',
  'src/evidence-endpoint-catalog.js',
  'src/semantic-domains.js',
];

const byText = (a, b) => String(a).localeCompare(String(b));
const unique = (values) => [...new Set(values)].sort(byText);

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || byText(a[0], b[0]))[0]?.[0] || '';
}

function loadInputs(root = ROOT) {
  const load = (file) => require(path.join(root, file));
  return {
    parameters: JSON.parse(fs.readFileSync(path.join(root, SOURCES[0]), 'utf8')),
    functions: load('function-model.json').functions,
    capabilities: load('src/capability-catalog.js').CURATED_CAPABILITIES,
    endpoints: Object.values(load('src/evidence-endpoint-catalog.js').EVIDENCE_ENDPOINT_CATALOG),
    graphEndpoints: load('src/evidence-endpoint-catalog.js').PROJECT_GRAPH_ENDPOINTS || [],
    domains: load('src/semantic-domains.js').listSemanticDomains(),
  };
}

// Hash only what the derivation reads, so unrelated catalog changes do not churn the register.
function sourceHash(inputs) {
  const relevant = {
    parameters: inputs.parameters,
    functions: inputs.functions.map(({ functionId, label, displayLabel, capabilities }) => ({
      functionId,
      label,
      displayLabel,
      capabilities,
    })),
    capabilities: inputs.capabilities.map(({ capability, requiredInputs, preferredActions }) => ({
      capability,
      requiredInputs,
      preferredActions,
    })),
    endpoints: inputs.endpoints.map(({ id, requiredInputs, optionalInputs }) => ({
      id,
      requiredInputs,
      optionalInputs,
    })),
    graphEndpoints: inputs.graphEndpoints.map(({ id, graphLink }) => ({ id, graphLink })),
    domains: inputs.domains.map(({ id, label }) => ({ id, label })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

// Merge every occurrence of a tenant-level input across catalogs into one need.
function tenantNeeds({ parameters, functions, capabilities, endpoints }) {
  const functionsOf = (capability) =>
    functions.filter((fn) => fn.capabilities.includes(capability)).map((fn) => fn.functionId);
  const needs = new Map();
  const need = (name) => {
    if (!needs.has(name))
      needs.set(name, { name, labels: [], derivedFrom: [], functionIds: [], unlocks: [] });
    return needs.get(name);
  };
  for (const capability of capabilities)
    for (const input of capability.requiredInputs || []) {
      if (parameters.parameters[input.name]?.scope !== 'tenant') continue;
      const entry = need(input.name);
      entry.labels.push(input.label);
      entry.derivedFrom.push({ source: 'capability', ref: capability.capability });
      entry.functionIds.push(...functionsOf(capability.capability));
      entry.unlocks.push(
        { capabilityId: capability.capability },
        ...(capability.preferredActions || []).map((operation) => ({ operation }))
      );
    }
  for (const endpoint of endpoints)
    for (const name of [...(endpoint.requiredInputs || []), ...(endpoint.optionalInputs || [])]) {
      if (parameters.parameters[name]?.scope !== 'tenant') continue;
      const entry = need(name);
      entry.derivedFrom.push({ source: 'endpoint', ref: endpoint.id });
      entry.unlocks.push({ endpointId: endpoint.id });
    }
  return [...needs.values()].map((entry) => ({
    key: entry.name,
    label: mostFrequent(entry.labels) || entry.name,
    kind: parameters.parameters[entry.name].kind,
    derivedFrom: dedupe(entry.derivedFrom),
    functionIds: unique(entry.functionIds),
    unlocks: dedupe(entry.unlocks),
  }));
}

// One responsibility need per function whose capabilities ask for an owner or contact.
function responsibilityNeeds({ parameters, functions, capabilities }) {
  const contactInputs = (capability) =>
    (capability.requiredInputs || [])
      .filter((input) => parameters.parameters[input.name]?.scope === 'perFunction')
      .map((input) => input.name);
  return functions
    .map((fn) => {
      const owned = capabilities.filter(
        (capability) =>
          fn.capabilities.includes(capability.capability) && contactInputs(capability).length
      );
      if (!owned.length) return null;
      return {
        key: `contact:${fn.functionId}`,
        label: fn.displayLabel || fn.label || fn.functionId,
        kind: 'contact',
        derivedFrom: dedupe([
          { source: 'function', ref: fn.functionId },
          ...owned.map((capability) => ({ source: 'capability', ref: capability.capability })),
        ]),
        functionIds: [fn.functionId],
        unlocks: dedupe(owned.map((capability) => ({ capabilityId: capability.capability }))),
        inputs: unique(owned.flatMap(contactInputs)),
      };
    })
    .filter(Boolean);
}

// One dataset need per semantic domain: does the tenant hold data of this kind?
function datasetNeeds({ domains, graphEndpoints }) {
  return domains.map((domain) => ({
    key: `dataset:${domain.id}`,
    label: domain.label,
    kind: 'dataset',
    derivedFrom: [{ source: 'semanticDomain', ref: domain.id }],
    functionIds: [],
    unlocks: dedupe(
      graphEndpoints
        .filter((endpoint) =>
          String(endpoint.graphLink?.catalogField || '').startsWith(`${domain.id}.`)
        )
        .map((endpoint) => ({ endpointId: endpoint.id }))
    ),
  }));
}

function dedupe(entries) {
  const seen = new Map();
  for (const entry of entries) seen.set(JSON.stringify(entry), entry);
  return [...seen.entries()].sort((a, b) => byText(a[0], b[0])).map(([, entry]) => entry);
}

// Reach of an answer: opened capabilities, operations and endpoints, plus touched functions.
function withPriority(needs) {
  const reach = (need) => need.unlocks.length + 2 * need.functionIds.length;
  const max = Math.max(1, ...needs.map(reach));
  return needs.map((need) => ({
    needId: `need:${need.key}`,
    ...need,
    basePriority: Math.round((Math.log1p(reach(need)) / Math.log1p(max)) * 1e4) / 1e4,
  }));
}

function buildKnowledgeNeeds(root = ROOT) {
  const inputs = loadInputs(root);
  const needs = withPriority([
    ...tenantNeeds(inputs),
    ...responsibilityNeeds(inputs),
    ...datasetNeeds(inputs),
  ]).sort((a, b) => b.basePriority - a.basePriority || byText(a.key, b.key));
  return {
    schemaVersion: '1.0',
    generator: 'scripts/generate-knowledge-needs.js',
    derivation: { version: VERSION, parameters: inputs.parameters.version },
    sourceHash: sourceHash(inputs),
    statistics: statistics(needs),
    needs,
  };
}

function statistics(needs) {
  const count = (pick) =>
    Object.fromEntries(
      [...new Set(needs.flatMap(pick))]
        .sort(byText)
        .map((value) => [value, needs.filter((need) => pick(need).includes(value)).length])
    );
  return {
    needs: needs.length,
    byKind: count((need) => [need.kind]),
    bySource: count((need) => unique(need.derivedFrom.map((entry) => entry.source))),
  };
}

function report(model, inputs) {
  const lines = [
    '# Wissensbedarfe – Lückenbericht',
    '',
    `Generator: \`${model.generator}\` (Ableitung v${model.derivation.version}, Parameterliste v${model.derivation.parameters}).`,
    '',
    '## Umfang',
    '',
    `- Bedarfe: ${model.statistics.needs}`,
    ...Object.entries(model.statistics.byKind).map(([kind, n]) => `- Art ${kind}: ${n}`),
    ...Object.entries(model.statistics.bySource).map(([source, n]) => `- Quelle ${source}: ${n}`),
    '',
    '## Höchste Priorität',
    '',
    '| Bedarf | Art | Priorität | Funktionen | Erschließt |',
    '|---|---|---|---|---|',
    ...model.needs
      .slice(0, 20)
      .map(
        (need) =>
          `| ${need.label} (\`${need.key}\`) | ${need.kind} | ${need.basePriority} | ${need.functionIds.length} | ${need.unlocks.length} |`
      ),
    '',
    '## Lücken',
    '',
  ];
  const technical = model.needs.filter((need) => need.label === need.key);
  const undescribed = inputs.capabilities.flatMap((capability) =>
    (capability.requiredInputs || [])
      .filter((input) => input.required && (!input.label || !input.type))
      .map((input) => `${capability.capability}.${input.name}`)
  );
  const keyFields = unique(
    inputs.graphEndpoints.flatMap((endpoint) => endpoint.graphLink?.keyFields || [])
  ).filter(
    (field) =>
      !model.needs.some((need) => need.key === field) && !inputs.parameters.parameters[field]
  );
  const unlinkedDatasets = model.needs.filter(
    (need) => need.kind === 'dataset' && !need.unlocks.length
  );
  const unclassified = unique(
    inputs.capabilities.flatMap((capability) =>
      (capability.requiredInputs || []).map((input) => input.name)
    )
  ).filter((name) => !inputs.parameters.parameters[name]);
  lines.push(
    `- Bedarfe ohne fachliche Bezeichnung: ${technical.map((need) => `\`${need.key}\``).join(', ') || 'keine'}`,
    `- Pflichteingaben ohne Bezeichnung oder Typ: ${undescribed.join(', ') || 'keine'}`,
    `- Verknüpfungsschlüssel ohne Wissensbedarf: ${keyFields.map((field) => `\`${field}\``).join(', ') || 'keine'}`,
    `- Datenarten ohne erschlossene Quelle: ${unlinkedDatasets.map((need) => `\`${need.key}\``).join(', ') || 'keine'}`,
    `- Eingaben als vorgangsbezogen eingeordnet (kein Bedarf): ${unclassified.length}`,
    ''
  );
  return lines.join('\n');
}

function writeOrCheck({ check = false, root = ROOT } = {}) {
  const model = buildKnowledgeNeeds(root);
  const files = {
    'knowledge-needs.json': JSON.stringify(model, null, 2) + '\n',
    'knowledge-needs.report.md': report(model, loadInputs(root)),
  };
  const stale = [];
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) stale.push(name);
    } else fs.writeFileSync(target, content);
  }
  return stale;
}

if (require.main === module) {
  const stale = writeOrCheck({ check: process.argv.includes('--check') });
  if (stale.length) {
    console.error(`Knowledge needs stale: ${stale.join(', ')}`);
    process.exitCode = 1;
  } else console.log('[knowledge-needs] OK');
}

module.exports = { buildKnowledgeNeeds, writeOrCheck, VERSION };
