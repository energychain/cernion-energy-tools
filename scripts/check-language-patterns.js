#!/usr/bin/env node
'use strict';

// Language patterns in the conversation path: regular expressions over message text that contain
// words or phrases (signal words, sentence patterns). Meaning belongs to the understanding and its
// tools, not to fixed wording in code; deterministic checks stay for safety and formats. This check
// keeps the count per file at or below the committed baseline, so the number can only shrink.
//
// Usage: node scripts/check-language-patterns.js [--update]

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'language-patterns.baseline.json');
const SCOPE = [
  /^src\/workbench-[^/]+\.js$/u,
  /^src\/tenant-memory[^/]*\.js$/u,
  /^src\/tenant-evidence-[^/]+\.js$/u,
  /^src\/project-manifest-[^/]+\.js$/u,
  /^src\/case-[^/]+\.js$/u,
  /^src\/(?:requested-effect|foreign-context-gate|conversation-context)\.js$/u,
  /^services\/(?:workbench|openai-compatible)\.service\.js$/u,
];
// A pattern counts as language when it holds a word of four or more letters next to an
// alternation, a word boundary or a space.
function isLanguagePattern(source) {
  const lower = String(source).toLowerCase();
  let run = 0;
  let word = false;
  for (const character of lower) {
    run = /\p{L}/u.test(character) ? run + 1 : 0;
    if (run >= 4) word = true;
  }
  return word && (lower.includes('|') || lower.includes('\\b') || /\s/u.test(lower));
}

// Regular expression literals of a file, found by the JavaScript parser (no pattern matching).
function regexLiterals(text) {
  const { tokenize } = require('espree');
  try {
    return tokenize(text, { ecmaVersion: 'latest', sourceType: 'script' })
      .filter((token) => token.type === 'RegularExpression')
      .map((token) => token.regex.pattern);
  } catch (_error) {
    return [];
  }
}

function countFile(text) {
  return regexLiterals(text).filter(isLanguagePattern).length;
}

function scopeFiles() {
  const files = [];
  for (const dir of ['src', 'services'])
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const relative = `${dir}/${name}`;
      if (SCOPE.some((pattern) => pattern.test(relative))) files.push(relative);
    }
  return files.sort((left, right) => left.localeCompare(right));
}

function inventory() {
  return Object.fromEntries(
    scopeFiles()
      .map((file) => [file, countFile(fs.readFileSync(path.join(ROOT, file), 'utf8'))])
      .filter(([, count]) => count > 0)
  );
}

function compare(current, baseline) {
  const grown = Object.entries(current)
    .filter(([file, count]) => count > (baseline[file] || 0))
    .map(([file, count]) => ({ file, baseline: baseline[file] || 0, current: count }));
  const total = Object.values(current).reduce((sum, count) => sum + count, 0);
  const before = Object.values(baseline).reduce((sum, count) => sum + count, 0);
  return { grown, total, before };
}

if (require.main === module) {
  const current = inventory();
  if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`language patterns baseline: ${Object.values(current).reduce((a, b) => a + b, 0)}`);
  } else {
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const result = compare(current, baseline);
    console.log(JSON.stringify(result, null, 2));
    if (result.grown.length) {
      console.error(
        'New language patterns in the conversation path. Let the understanding or a tool decide; keep deterministic checks for safety and formats.'
      );
      process.exitCode = 1;
    }
  }
}

module.exports = { compare, countFile, inventory, isLanguagePattern };
