'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  formatMarkdownReport,
  runAgentOpsReceiptSmoke,
} = require('../tools/agentops-receipt/smoke');

test('runAgentOpsReceiptSmoke returns a judge-readable PASS/FAIL summary', () => {
  const report = runAgentOpsReceiptSmoke();

  assert.equal(report.project, 'AgentOps Receipt QA Smoke');
  assert.equal(report.verdict, 'pass');
  assert.equal(report.summary.failed, 0);
  assert.ok(report.summary.passed >= 6);

  const byId = new Map(report.checks.map((check) => [check.id, check]));
  assert.equal(byId.get('manifest.readOnlyTools').status, 'pass');
  assert.equal(byId.get('sidecar.unknownToolBlocked').details.reason, 'unknown_tool');
  assert.equal(byId.get('sidecar.forbiddenTargetBlocked').details.reason, 'forbidden_target_action');
  assert.equal(byId.get('receipt.schemaRegistryCheck').details.selectedAction, 'grid-operations.marketPartners');
  assert.equal(byId.get('receipt.evidenceRequirements').details.requiredOutputFields[0], 'data.items');
  assert.equal(byId.get('receipt.safeMissingInput').details.status, 'scope-blocked');
  assert.equal(byId.get('receipt.missingActionBlocked').details.status, 'missing-action');
});

test('formatMarkdownReport renders the checks and Build Week positioning', () => {
  const report = runAgentOpsReceiptSmoke();
  const markdown = formatMarkdownReport(report);

  assert.match(markdown, /^# AgentOps Receipt QA Smoke/m);
  assert.match(markdown, /OpenAI Build Week Developer Tools/);
  assert.match(markdown, /manifest\.readOnlyTools/);
  assert.match(markdown, /receipt\.safeMissingInput/);
  assert.match(markdown, /Verdict: PASS/);
});
