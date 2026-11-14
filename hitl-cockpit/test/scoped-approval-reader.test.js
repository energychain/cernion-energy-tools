'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { afterEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyTask } = require('../lib/classifier');
const { buildProjection } = require('../lib/projector');
const { ScopedApprovalReader } = require('../lib/scoped-approval-reader');

const directories = [];
const NOW = 2_000_000_000;

afterEach(() => {
  while (directories.length) fs.rmSync(directories.pop(), { recursive: true, force: true });
});

function scope(overrides = {}) {
  return {
    id: 'scp_fixture01',
    type: 'DEPLOYMENT_SCOPE',
    status: 'active',
    source_board: 'devops',
    source_task_id: 't_parent01',
    source_title: 'Deploy example.com /release/v1',
    created_at: NOW - 100,
    expires_at: NOW + 1000,
    terms: {
      domains: ['example.com'],
      paths: ['/release/v1'],
      tags: ['#release-v1'],
      words: ['example', 'release', 'deployment'],
    },
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 't_child01',
    board: 'devops',
    title: 'Production deployment for example.com',
    body: 'Build and deploy release deployment package',
    comments: [],
    ...overrides,
  };
}

function ledgerFile(scopes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-reader-'));
  directories.push(directory);
  const ledgerPath = path.join(directory, 'ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify({ version: 1, scopes }), { mode: 0o400 });
  return ledgerPath;
}

function reader(scopes) {
  return new ScopedApprovalReader({ ledgerPath: ledgerFile(scopes), now: NOW }).load();
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('reads the ledger without changing bytes, mode or timestamps', () => {
  const ledgerPath = ledgerFile([scope()]);
  const before = fs.statSync(ledgerPath);
  const beforeDigest = digest(ledgerPath);
  const instance = new ScopedApprovalReader({ ledgerPath, now: NOW }).load();
  instance.evaluate(task({ body: 'Continue t_parent01 deployment' }));
  const after = fs.statSync(ledgerPath);

  assert.equal(digest(ledgerPath), beforeDigest);
  assert.equal(after.mode, before.mode);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(instance.diagnostics.available, true);
});

test('exact parent and scope references cover active child work', () => {
  const instance = reader([scope()]);
  assert.equal(
    instance.evaluate(task({ body: 'Continue t_parent01 deployment' })).state,
    'covered'
  );
  assert.equal(
    instance.evaluate(task({ body: 'Continue scp_fixture01 deployment' })).state,
    'covered'
  );
});

test('expired, revoked and consumed scopes never cover work', () => {
  for (const fixture of [
    scope({ expires_at: NOW - 1 }),
    scope({ id: 'scp_revoked1', status: 'revoked' }),
    scope({ id: 'scp_consumed', status: 'consumed' }),
  ]) {
    const decision = reader([fixture]).evaluate(
      task({ body: `Continue ${fixture.id} deployment` })
    );
    assert.equal(decision.state, 'not_covered', fixture.status);
  }
});

test('active scopes do not retroactively classify terminal tasks as covered', () => {
  for (const status of ['done', 'completed', 'archived', 'rejected', 'cancelled']) {
    const decision = reader([scope()]).evaluate(
      task({ status, body: 'Continue t_parent01 deployment' })
    );
    assert.equal(decision.state, 'not_covered', status);
  }
});

test('domain-only matches do not authorize cross-board work', () => {
  const decision = reader([scope()]).evaluate(
    task({ board: 'infrastructure', body: 'Deploy example.com production release' })
  );
  assert.equal(decision.state, 'not_covered');
});

test('a parent reference without a matching action type does not authorize work', () => {
  const decision = reader([scope()]).evaluate(
    task({ title: 'Prepare an article', body: 'Continue t_parent01 by drafting content' })
  );
  assert.equal(decision.state, 'not_covered');
  assert.equal(decision.reason, 'no_active_scope_matches');
});

test('exact paths or tags can cover matching action across boards', () => {
  const instance = reader([scope()]);
  assert.equal(
    instance.evaluate(
      task({ board: 'infrastructure', body: 'Deploy exact path /release/v1 in production' })
    ).state,
    'covered'
  );
  assert.equal(
    instance.evaluate(
      task({ board: 'infrastructure', body: 'Deploy approved artifact #release-v1' })
    ).state,
    'covered'
  );
});

test('short generic path terms cannot cover cross-board work', () => {
  const decision = reader([
    scope({ terms: { domains: [], paths: ['/calls'], tags: [], words: [] } }),
  ]).evaluate(task({ board: 'infrastructure', body: 'Deploy /calls route' }));
  assert.equal(decision.state, 'not_covered');
});

test('possible scope escape is unclear and never classified as covered', () => {
  const instance = reader([scope()]);
  const enriched = instance.enrichSource({
    boards: [
      {
        board: 'devops',
        items: [task({ body: 'Continue t_parent01 deployment with new price and contract' })],
      },
    ],
    errors: [],
    count: 1,
  });
  const enrichedTask = enriched.boards[0].items[0];
  assert.equal(enrichedTask.scopeDecision.state, 'unclear');
  assert.equal(enrichedTask.scopeCovered, false);
  assert.notEqual(classifyTask(enrichedTask).label, 'SCOPE_COVERED');
});

test('smoke scopes cannot authorize real work', () => {
  const decision = reader([scope({ source_title: '[smoke] Deployment fixture' })]).evaluate(
    task({ body: 'Continue scp_fixture01 deployment' })
  );
  assert.equal(decision.state, 'not_covered');
});

test('missing and invalid ledgers fail closed as unclear', () => {
  const missing = new ScopedApprovalReader({
    ledgerPath: '/definitely/missing/scope-ledger.json',
  }).load();
  assert.equal(missing.evaluate(task()).state, 'unclear');

  const invalid = reader([scope({ type: 'UNKNOWN_SCOPE' })]);
  assert.equal(invalid.diagnostics.invalidScopes, 1);
  assert.equal(invalid.evaluate(task()).state, 'not_covered');
});

test('covered scopes feed the existing shadow classifier with an explanation', () => {
  const instance = reader([scope()]);
  const enriched = instance.enrichSource({
    boards: [
      {
        board: 'devops',
        items: [task({ body: 'Continue t_parent01 deployment', status: 'blocked' })],
      },
    ],
    errors: [],
    count: 1,
  });
  const result = classifyTask(enriched.boards[0].items[0]);
  assert.equal(result.label, 'SCOPE_COVERED');
  assert.ok(result.reasons.includes('source_task_reference'));
});

test('covered blocked work creates no decision while a possible escape creates a scope violation', () => {
  const instance = reader([scope()]);
  const covered = instance.enrichSource({
    boards: [
      {
        board: 'devops',
        items: [task({ status: 'blocked', body: 'Continue t_parent01 deployment' })],
      },
    ],
    errors: [],
    count: 1,
  });
  assert.equal(buildProjection(covered).decisions.length, 0);

  const escaped = instance.enrichSource({
    boards: [
      {
        board: 'devops',
        items: [
          task({
            status: 'blocked',
            body: 'Continue t_parent01 deployment with a new price and contract',
          }),
        ],
      },
    ],
    errors: [],
    count: 1,
  });
  const [decision] = buildProjection(escaped).decisions;
  assert.equal(decision.decision_class, 'scope_violation');
  assert.equal(decision.classifier_label, 'RISK_ESCALATION');
  assert.match(decision.execution_scope_json, /scp_fixture01/);
  assert.doesNotMatch(decision.execution_scope_json, /allowedSummary|forbiddenSummary/);
});

test('scope violation projection omits free-text scope summaries from public decisions', () => {
  const projected = buildProjection({
    boards: [
      {
        board: 'devops',
        items: [
          task({
            status: 'blocked',
            scopeDecision: {
              state: 'unclear',
              matches: [
                {
                  scopeId: 'scp_fixture02',
                  scopeType: 'DEPLOY_SCOPE',
                  sourceBoard: 'devops',
                  sourceTaskId: 't_parent01',
                  expiresAt: 1999999999,
                  state: 'unclear',
                  reason: 'explicit_reference_with_possible_scope_escape',
                  allowedSummary: 'bounded deployment',
                  forbiddenSummary: 'mixed-sensitive source material',
                },
              ],
            },
          }),
        ],
      },
    ],
    errors: [],
    count: 1,
  });

  const [decision] = projected.decisions;
  assert.equal(decision.decision_class, 'scope_violation');
  assert.match(decision.execution_scope_json, /scp_fixture02/);
  assert.doesNotMatch(decision.execution_scope_json, /mixed-sensitive|Summary/);
});
