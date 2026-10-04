#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { compareCanonicalStrings } = require('../src/canonical-order');
const { normalize, buildVocabulary, loadCatalogs, scanText } = require('./check-domain-free-core');
const ROOT = path.resolve(__dirname, '..');

function listPackages(directory) {
  const packages = [];
  for (const name of fs.readdirSync(directory).sort(compareCanonicalStrings)) {
    if (name.startsWith('.')) continue;
    const location = path.join(directory, name);
    if (!fs.statSync(location).isDirectory()) continue;
    if (name.startsWith('@')) {
      for (const child of listPackages(location)) packages.push(child);
    } else if (fs.existsSync(path.join(location, 'package.json'))) packages.push(location);
  }
  return packages.sort(compareCanonicalStrings);
}

function sampleFiles(directory, { maxFilesPerPackage, extensions }) {
  const files = [];
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const location = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(location);
      else if (
        entry.isFile() &&
        !entry.name.includes('.min.') &&
        extensions.includes(path.extname(entry.name))
      )
        files.push(location);
    }
  };
  visit(directory);
  return files.sort(compareCanonicalStrings).slice(0, maxFilesPerPackage);
}

function generateVocabulary({ root = ROOT, config, catalogs = loadCatalogs(root) } = {}) {
  config ||= JSON.parse(fs.readFileSync(path.join(root, 'scripts/domain-free-core.config.json')));
  const parameters = config.referenceCorpus;
  const threshold = config.genericPackageShare ?? 0.05;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)
    throw new Error('genericPackageShare must be > 0 and <= 1');
  if (!Number.isInteger(parameters?.maxFilesPerPackage) || parameters.maxFilesPerPackage < 1)
    throw new Error('maxFilesPerPackage must be a positive integer');
  if (!Array.isArray(parameters.extensions) || !parameters.extensions.length)
    throw new Error('extensions must not be empty');
  if (!parameters.generatedAt || !Number.isFinite(Date.parse(parameters.generatedAt)))
    throw new Error('generatedAt must be a fixed ISO timestamp');
  const vocabulary = buildVocabulary(catalogs, config.minimumLength);
  if (!vocabulary.length) throw new Error('Catalog vocabulary must not be empty');
  const packages = listPackages(path.join(root, 'node_modules'));
  if (!packages.length) throw new Error('Reference corpus must contain packages');
  const counts = new Map(vocabulary.map((term) => [term, 0]));
  const firstTokens = new Map(vocabulary.map((term) => [term, term.match(/[\p{L}\p{N}]+/u)?.[0]]));
  let fileCount = 0;
  for (const location of packages) {
    const files = sampleFiles(location, parameters);
    fileCount += files.length;
    const found = new Set();
    for (const file of files) {
      // NUL preserves line boundaries without checking every term on every line.
      const source = fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\0');
      const tokens = new Set(normalize(source).match(/[\p{L}\p{N}]+/gu));
      const candidates = vocabulary.filter(
        (term) => !found.has(term) && (!firstTokens.get(term) || tokens.has(firstTokens.get(term)))
      );
      for (const { term } of scanText(source, candidates)) found.add(term);
    }
    for (const term of found) counts.set(term, counts.get(term) + 1);
  }
  const measurements = vocabulary.map((term) => ({
    term,
    packageCount: counts.get(term),
    packageShare: counts.get(term) / packages.length,
  }));
  const artifact = {
    generatedAt: parameters.generatedAt,
    parameters: {
      minimumLength: config.minimumLength ?? 5,
      genericPackageShare: threshold,
      maxFilesPerPackage: parameters.maxFilesPerPackage,
      extensions: parameters.extensions,
      excludeMinified: true,
      excludeNestedNodeModules: true,
    },
    packageCount: packages.length,
    fileCount,
    terms: measurements.filter(({ packageShare }) => packageShare >= threshold),
  };
  fs.writeFileSync(
    path.resolve(
      root,
      config.genericVocabulary || 'scripts/domain-free-core.generic-vocabulary.json'
    ),
    `${JSON.stringify(artifact, null, 2)}\n`
  );
  return { artifact, measurements };
}

if (require.main === module) {
  try {
    const { artifact } = generateVocabulary();
    console.log(
      `${artifact.terms.length} generic terms from ${artifact.packageCount} packages / ${artifact.fileCount} files`
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { generateVocabulary };
