#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalize,
  buildVocabulary,
  loadCatalogs,
  scanText,
  checkCore,
} = require('./check-domain-free-core');
const ROOT = path.resolve(__dirname, '..');

// Frozen pre-optimization oracle: deliberately retain the independent RegExp search.
function legacyScanText(text, vocabulary, allowlist = []) {
  const allowed = new Set(allowlist.map((entry) => normalize(entry.term)));
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

function checkEquivalence(files = checkCore().files) {
  const catalogs = loadCatalogs();
  const vocabulary = buildVocabulary(catalogs);
  const keyword = catalogs.capabilities
    .flatMap((item) => item.keywords)
    .find((term) => term.length > 15 && !term.includes('\n'));
  assert.ok(keyword, 'Contamination fixture requires a real catalog keyword');
  const sources = files.map((file) => ({
    file,
    text: fs.readFileSync(path.resolve(ROOT, file), 'utf8'),
  }));
  sources.push({ file: 'contamination-fixture.js', text: `// ${keyword}\n` });
  let hits = 0;
  for (const { file, text } of sources) {
    // No exceptions: compare positive hits, not two clean allowlisted reports.
    const legacy = legacyScanText(text, vocabulary).map((hit) => ({ file, ...hit }));
    const token = scanText(text, vocabulary).map((hit) => ({ file, ...hit }));
    assert.deepEqual(token, legacy, `Scanner equivalence failed: ${file}`);
    if (file === 'contamination-fixture.js')
      assert.ok(legacy.some((hit) => hit.line === 1 && hit.term === normalize(keyword)));
    hits += legacy.length;
  }
  return { files: sources.length, hits };
}

if (require.main === module) {
  const started = process.hrtime.bigint();
  const report = checkEquivalence();
  console.log(
    `Domain-free scan equivalence: ${report.files} files (including contamination fixture), ${report.hits} hits, ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(2)} s.`
  );
}

module.exports = { legacyScanText, checkEquivalence };
