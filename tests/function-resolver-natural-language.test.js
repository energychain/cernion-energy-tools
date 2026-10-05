'use strict';

const { resolveFunctions } = require('../src/function-resolver');
const { classifyWorkbenchIntent } = require('../src/workbench-intent-router');

const { corpus, regressions } = require('./helpers/system-activity-corpus');
test.each(regressions)('natural regression: %s', (question, functionId) => {
  expect(classifyWorkbenchIntent(question)).toBe('system_activity_query');
  if (!functionId) return;
  const result = resolveFunctions(question);
  expect(result.status).not.toBe('none');
  expect(result.matches.map((item) => item.functionId)).toContain(functionId);
  if (result.status === 'resolved') expect(result.matches[0].functionId).toBe(functionId);
});

function evaluateCorpus() {
  const counts = { total: 0, modeHits: 0, resolved: 0, ambiguous: 0, wrong: 0, missing: 0 };
  for (const [question, functionId] of corpus()) {
    counts.total++;
    counts.modeHits += classifyWorkbenchIntent(question) === 'system_activity_query' ? 1 : 0;
    const result = resolveFunctions(question);
    const correct = result.matches.some((item) => item.functionId === functionId);
    if (result.status === 'resolved') counts[correct ? 'resolved' : 'wrong']++;
    else if (result.status === 'ambiguous' && correct) counts.ambiguous++;
    else counts.missing++;
  }
  return counts;
}

test('seeded real-model corpus: ten natural patterns, labels/domains/departments, false resolutions <= 5%', () => {
  const metrics = evaluateCorpus();
  process.stdout.write(`Natural language corpus: ${JSON.stringify(metrics)}\n`);
  expect(metrics.modeHits).toBe(metrics.total);
  expect(metrics.wrong / metrics.total).toBeLessThanOrEqual(0.05);
  expect(metrics.resolved + metrics.ambiguous).toBeGreaterThanOrEqual(metrics.total * 0.95);
});

test.each([
  'Bewerte die aktuelle Lage.',
  'Was soll ich als Nächstes tun?',
  'Empfiehl mir eine Option.',
  'Vergleiche die Optionen.',
])('explicit evaluation remains decision support: %s', (question) => {
  expect(classifyWorkbenchIntent(question)).toBe('decision_support');
});
