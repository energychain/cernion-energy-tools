'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const cases = require('./fixtures/classification-cases.json');
const { classifyTask } = require('../lib/classifier');

test('hand-labelled classification fixtures meet the 95 percent quality gate', () => {
  let matches = 0;
  for (const fixture of cases) {
    const actual = classifyTask(fixture.task);
    if (actual.label === fixture.expected && actual.excluded === Boolean(fixture.excluded)) {
      matches += 1;
    }
  }
  const accuracy = matches / cases.length;
  assert.ok(
    accuracy >= 0.95,
    `accuracy ${(accuracy * 100).toFixed(1)}% (${matches}/${cases.length})`
  );
});

test('rule ordering is deterministic and scope/noise precede risk', () => {
  assert.equal(
    classifyTask({
      board: 'devops',
      title: 'Production deployment',
      status: 'blocked',
      scopeCovered: true,
    }).label,
    'SCOPE_COVERED'
  );
  assert.equal(
    classifyTask({
      board: 'inbox',
      title: 'Monitoring deployment alert',
      status: 'blocked',
    }).label,
    'NOISE'
  );
});

test('private and unclear-sensitive cards are excluded without a label', () => {
  for (const fixture of cases.filter((item) => item.excluded)) {
    const actual = classifyTask(fixture.task);
    assert.equal(actual.excluded, true, fixture.name);
    assert.equal(actual.label, null, fixture.name);
  }
});
