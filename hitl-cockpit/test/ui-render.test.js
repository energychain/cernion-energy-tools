'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const managementHtml = fs.readFileSync(path.join(root, 'public', 'management.html'), 'utf8');
const managementJs = fs.readFileSync(path.join(root, 'public', 'management.js'), 'utf8');
const legacyHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const legacyJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

function occurrence(source, expression) {
  return [...source.matchAll(expression)].length;
}

test('management cockpit exposes all five target views and explicit legacy fallback', () => {
  for (const view of ['overview', 'decisions', 'departments', 'topics', 'history']) {
    assert.match(managementHtml, new RegExp(`data-view="${view}"`));
    assert.match(managementHtml, new RegExp(`id="view-${view}"`));
  }
  assert.ok(occurrence(managementHtml, /href="\/"/g) >= 3);
  assert.match(managementHtml, /Zur alten HITL-Liste/);
  assert.match(managementHtml, /Rückfallansicht öffnen/);
});

test('management cockpit exposes only fail-closed shadow actions and required semantics', () => {
  assert.match(managementJs, /method:\s*'POST'/);
  assert.doesNotMatch(managementJs, /method\s*:\s*['"](?:PUT|PATCH|DELETE)/i);
  assert.match(managementJs, /writePerformed/);
  assert.match(managementJs, /persisted/);
  assert.match(managementJs, /mode !== 'shadow'/);
  assert.match(managementJs, /keine Speicherung oder Ausführung/);
  for (const action of [
    'choose',
    'delegate',
    'question',
    'schedule',
    'reject',
    'return-to-rhajaina',
  ]) {
    assert.match(managementJs, new RegExp(`data-shadow-action="${action}"`));
  }
  assert.match(managementJs, /Keine Entscheidung erforderlich/);
  assert.match(managementJs, /Technischer Enabler · nicht als Fortschritt gewertet/);
  assert.match(managementJs, /Operatives Ergebnis · nicht als fachlicher Fortschritt gewertet/);
  assert.match(managementJs, /last_substantive_progress_at/);
  assert.match(managementJs, /empty_state_reason/);
  assert.match(managementJs, /isMatureDecision/);
  assert.match(managementJs, /source_task_id/);
  assert.match(managementJs, /data-copy/);
  assert.match(managementJs, /Im Fachraum öffnen/);
  assert.match(managementJs, /https:\/\/matrix\.to\/\#\//);
  assert.match(managementJs, /source_refs/);
  assert.match(managementJs, /topic_artifact_refs/);
  assert.match(managementJs, /api\/management\/outcomes/);
  assert.match(managementJs, /api\/management\/wakeups/);
  assert.match(managementJs, /api\/management\/risks/);
  for (const agent of ['Rhajaina', 'Felix', 'Anja', 'Viki', 'Cori', 'DevOps', 'Infrastructure']) {
    assert.match(managementJs, new RegExp(agent));
  }
});

test('legacy HITL interface and actions remain present as fallback', () => {
  assert.match(legacyHtml, /id="cards"/);
  assert.match(legacyJs, /\/api\/tasks/);
  for (const action of ['approve', 'reject', 'question', 'close']) {
    assert.match(legacyJs, new RegExp(`['"]${action}['"]`));
  }
  assert.match(legacyHtml, /id="management-link"/);
  assert.match(legacyJs, /api\/management\/config/);
});

test('browser clients remove bootstrap tokens and use only same-origin session cookies', () => {
  for (const source of [legacyJs, managementJs]) {
    assert.match(source, /searchParams\.delete\('token'\)/);
    assert.match(source, /history\.replaceState/);
    assert.match(source, /credentials:\s*'same-origin'/);
    assert.doesNotMatch(source, /fetch\([^\n]*token=/);
    assert.doesNotMatch(source, /encodeURIComponent\(token\)/);
  }
  assert.match(legacyHtml, /name="referrer" content="no-referrer"/);
  assert.match(managementHtml, /name="referrer" content="no-referrer"/);
});

test('stylesheet contains mobile, accessibility and document-layout guards', () => {
  assert.match(styles, /@media \(max-width: 650px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /\.timeline/);
  assert.match(styles, /\.department-grid/);
});
