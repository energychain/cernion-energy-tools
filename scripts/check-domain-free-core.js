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

function indexVocabulary(vocabulary, allowed) {
  const terms = new Set();
  const decorated = new Map();
  const symbols = new Set();
  const firstWords = new Set();
  let maxWords = 0;
  for (const term of vocabulary) {
    if (allowed.has(term)) continue;
    const words = [...term.matchAll(/[\p{L}\p{N}]+/gu)];
    if (!words.length) {
      symbols.add(term);
      continue;
    }
    firstWords.add(words[0][0]);
    maxWords = Math.max(maxWords, words.length);
    const start = words[0].index;
    const last = words.at(-1);
    const end = last.index + last[0].length;
    if (start === 0 && end === term.length) terms.add(term);
    else {
      const core = term.slice(start, end);
      if (!decorated.has(core)) decorated.set(core, []);
      decorated.get(core).push({ term, prefixLength: start });
    }
  }
  return { terms, decorated, symbols, firstWords, maxWords };
}

function matchesBoundaries(line, term, start) {
  return (
    start >= 0 &&
    line.startsWith(term, start) &&
    !/[\p{L}\p{N}]$/u.test(line.slice(0, start)) &&
    !/^[\p{L}\p{N}]/u.test(line.slice(start + term.length))
  );
}

function scanSymbols(line, symbols, found) {
  if (!symbols.size) return;
  const lengths = new Set([...symbols].map((term) => term.length));
  for (const gap of line.matchAll(/[^\p{L}\p{N}]+/gu)) {
    for (let offset = 0; offset < gap[0].length; offset++) {
      for (const length of lengths) {
        const candidate = gap[0].slice(offset, offset + length);
        if (symbols.has(candidate) && matchesBoundaries(line, candidate, gap.index + offset))
          found.add(candidate);
      }
    }
  }
}

function scanLine(line, index) {
  const words = [...line.matchAll(/[\p{L}\p{N}]+/gu)];
  const found = new Set();
  for (let start = 0; start < words.length; start++) {
    if (!index.firstWords.has(words[start][0])) continue;
    const limit = Math.min(words.length, start + index.maxWords);
    for (let end = start; end < limit; end++) {
      // Preserve separators exactly: a space, a tab and a hyphen are different terms.
      const candidate = line.slice(words[start].index, words[end].index + words[end][0].length);
      if (index.terms.has(candidate)) found.add(candidate);
      for (const { term, prefixLength } of index.decorated.get(candidate) || []) {
        if (matchesBoundaries(line, term, words[start].index - prefixLength)) found.add(term);
      }
    }
  }
  // buildVocabulary also accepts catalog values consisting entirely of punctuation.
  scanSymbols(line, index.symbols, found);
  return found;
}

function scanText(text, vocabulary, allowlist = []) {
  const allowed = new Set(
    allowlist.map((entry) => {
      if (!entry.term || !entry.reason?.trim())
        throw new Error('Allowlist entries require term and reason');
      return normalize(entry.term);
    })
  );
  const vocabularyIndex = indexVocabulary(vocabulary, allowed);
  const positions = new Map();
  vocabulary.forEach((term, position) => {
    if (!positions.has(term)) positions.set(term, []);
    positions.get(term).push(position);
  });
  return text.split(/\r?\n/).flatMap((line, index) => {
    const found = scanLine(normalize(line), vocabularyIndex);
    return [...found]
      .flatMap((term) => positions.get(term))
      .sort((left, right) => left - right)
      .map((position) => ({ line: index + 1, term: vocabulary[position] }));
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
  const generic = JSON.parse(
    fs.readFileSync(
      path.resolve(
        root,
        config.genericVocabulary || 'scripts/domain-free-core.generic-vocabulary.json'
      ),
      'utf8'
    )
  );
  const threshold = config.genericPackageShare ?? 0.05;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
    throw new Error('genericPackageShare must be > 0 and <= 1');
  const genericTerms = new Set(
    generic.terms
      .filter(({ packageShare }) => packageShare >= threshold)
      .map(({ term }) => normalize(term))
  );
  const checkedVocabulary = vocabulary.filter((term) => !genericTerms.has(term));
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
      scanText(fs.readFileSync(path.resolve(root, file), 'utf8'), checkedVocabulary, allowlist).map(
        (finding) => ({ file, ...finding })
      )
    );
  return {
    files: [...files].sort(compareCanonicalStrings),
    vocabularySize: vocabulary.length,
    automaticallyExemptedTerms: vocabulary.filter((term) => genericTerms.has(term)),
    automaticallyExemptedCount: vocabulary.length - checkedVocabulary.length,
    redundantAllowlistEntries: allowlist.filter((entry) => genericTerms.has(normalize(entry.term))),
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

module.exports = { normalize, buildVocabulary, loadCatalogs, scanText, checkCore };
