#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { runHarness } = require('../tools/agentic-qa-harness/smoke');

test('agentic QA harness synthetic smoke suite passes', () => {
  const report = runHarness({ writeReports: false });

  assert.equal(report.verdict, 'PASS');
  assert.equal(report.total, 8);
  assert.equal(report.failed, 0);
  assert.deepEqual(
    report.results.map((result) => result.id),
    [
      'routing.solarLocation',
      'validation.missingLocation',
      'context.followupUsesLocation',
      'context.purgeOnTopicChange',
      'governance.unknownToolBlocked',
      'governance.forbiddenWriteBlocked',
      'response.noInternalMarkers',
      'receipt.schema',
    ]
  );
});
