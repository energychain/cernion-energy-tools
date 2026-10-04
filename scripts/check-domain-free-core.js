#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { compareCanonicalStrings } = require('../src/canonical-order');
const ROOT = path.resolve(__dirname, '..');

function normalize(value) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function buildVocabulary(
  { capabilities = [], operations = [], domains = [], functions = [] },
  minimumLength = 5
) {
  if (!Number.isInteger(minimumLength) || minimumLength < 3)
    throw new Error('minimumLength must be >= 3');
  const terms = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    const full = normalize(value).trim();
    for (const term of [full, ...full.split(/[^\p{L}\p{N}]+/u)]) {
      if (term.length >= minimumLength) terms.add(term);
    }
  };
  for (const item of capabilities) {
    add(item.capability);
    add(item.domain);
    (item.keywords || []).forEach(add);
  }
  for (const item of operations) (item.domains || []).forEach(add);
  for (const item of domains) {
    [item.id, item.label, item.department].forEach(add);
    for (const key of ['columnKeywords', 'filenameTokens'])
      (item.indicators?.[key] || []).forEach(add);
  }
  for (const item of functions) {
    add(item.label);
    (item.keywords || []).forEach(add);
  }
  return [...terms].sort(compareCanonicalStrings);
}

function loadCatalogs(root = ROOT) {
  const modelPath = path.join(root, 'function-model.json');
  const model = fs.existsSync(modelPath) ? JSON.parse(fs.readFileSync(modelPath, 'utf8')) : [];
  return {
    capabilities: require(path.join(root, 'src/capability-catalog.js')).CURATED_CAPABILITIES,
    operations: JSON.parse(
      fs.readFileSync(path.join(root, 'operation-capability-index.json'), 'utf8')
    ).operations,
    domains: require(path.join(root, 'src/semantic-domains.js')).semanticDomains,
    functions: Array.isArray(model) ? model : model.functions,
  };
}

function scanText(text, vocabulary, allowlist = []) {
  const allowed = new Set(
    allowlist.map((entry) => {
      if (!entry.term || !entry.reason?.trim())
        throw new Error('Allowlist entries require term and reason');
      return normalize(entry.term);
    })
  );
  const terms = vocabulary
    .filter((term) => !allowed.has(term))
    .map((term) => ({
      term,
      pattern: new RegExp(
        `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
        'u'
      ),
    }));
  return text.split(/\r?\n/).flatMap((line, index) => {
    const normalized = normalize(line);
    return terms
      .filter(({ pattern }) => pattern.test(normalized))
      .map(({ term }) => ({ line: index + 1, term }));
  });
}

function checkCore({ root = ROOT, config, catalogs = loadCatalogs(root) } = {}) {
  config ||= JSON.parse(
    fs.readFileSync(path.join(root, 'scripts/domain-free-core.config.json'), 'utf8')
  );
  if (!Array.isArray(config.corePaths) || !config.corePaths.length)
    throw new Error('corePaths must not be empty');
  const vocabulary = buildVocabulary(catalogs, config.minimumLength);
  if (!vocabulary.length) throw new Error('Catalog vocabulary must not be empty');
  const allowlist = JSON.parse(
    fs.readFileSync(path.resolve(root, config.allowlist), 'utf8')
  ).entries;
  const files = new Set();
  const missing = [];
  for (const pattern of config.corePaths) {
    const matches = [...fs.globSync(pattern, { cwd: root })];
    if (!matches.length && !(config.optionalPaths || []).includes(pattern)) missing.push(pattern);
    matches.forEach((file) => files.add(file));
  }
  if (missing.length) throw new Error(`Required core paths missing: ${missing.join(', ')}`);
  if (!files.size) throw new Error('No core files checked');
  const findings = [...files]
    .sort(compareCanonicalStrings)
    .flatMap((file) =>
      scanText(fs.readFileSync(path.resolve(root, file), 'utf8'), vocabulary, allowlist).map(
        (finding) => ({ file, ...finding })
      )
    );
  return {
    files: [...files].sort(compareCanonicalStrings),
    vocabularySize: vocabulary.length,
    findings,
  };
}

if (require.main === module) {
  try {
    const configIndex = process.argv.indexOf('--config');
    const config =
      configIndex < 0
        ? undefined
        : JSON.parse(fs.readFileSync(process.argv[configIndex + 1], 'utf8'));
    const report = checkCore({ config });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.findings.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildVocabulary, loadCatalogs, scanText, checkCore };
