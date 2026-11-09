'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ManagementReader } = require('../lib/management-reader');
const { ManagementStore } = require('../lib/management-store');

const cockpitRoot = path.resolve(__dirname, '..');
const token = 'ap4-read-token';
let tempRoot;
let database;
let scopeLedger;
let baseUrl;
let child;
let beforeRead;

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function checksum(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshot(file) {
  const stat = fs.statSync(file);
  return { checksum: checksum(file), size: stat.size, mtimeMs: stat.mtimeMs };
}

function topic(id, owner, state, sensitivity = 'internal') {
  return {
    topic_id: id,
    title: `${owner} topic`,
    business_goal: 'Business outcome',
    owner_agent: owner,
    participating_agents_json: JSON.stringify([owner]),
    current_state: state,
    next_step: 'Continue',
    expected_progress_at: null,
    impact_statement: 'Expected impact',
    last_substantive_progress_at: 1700000200,
    matrix_room_ref: null,
    artifact_refs_json: '[]',
    source_task_refs_json: JSON.stringify([{ board: 'fixture', taskId: `t_${id}` }]),
    sensitivity,
    updated_at: 1700000200,
  };
}

function digest(id, signal, overrides = {}) {
  return {
    digest_id: id,
    day_bucket: '2023-11-14',
    source_board: 'fixture',
    source_task_id: `t_${id}`,
    topic_id: 'topic_public',
    category: 'digest',
    disposition: 'digest',
    signal,
    material: 0,
    recommendation: null,
    reasons_json: JSON.stringify(['category:digest']),
    provenance_json: JSON.stringify({ board: 'fixture', taskId: `t_${id}` }),
    observed_at: 1700000300,
    ...overrides,
  };
}

async function request(pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await request('/api/health')).status === 200) return;
    } catch (_) {
      // Process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('AP4 test server did not become healthy');
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-cockpit-ap4-'));
  database = path.join(tempRoot, 'management.db');
  scopeLedger = path.join(tempRoot, 'scopes.json');
  fs.writeFileSync(
    scopeLedger,
    JSON.stringify({
      version: 1,
      scopes: [
        {
          id: 'scope_public',
          type: 'DEPLOYMENT_SCOPE',
          status: 'active',
          source_board: 'fixture',
          source_task_id: 't_public01',
          expires_at: 4102444800,
          terms: { domains: [], paths: ['/fixture/release'], tags: [], words: [] },
        },
      ],
    })
  );
  const store = new ManagementStore({ database });
  store.initialize();
  store.applyProjection({
    replaceBoards: [],
    topics: [
      topic('topic_public', 'Felix', 'running'),
      topic('topic_private', 'TWL', 'blocked', 'twl-private'),
      topic('topic_twl_netze_private', 'TWL', 'blocked', 'twl-netze-private'),
      topic('topic_private_quarantine', 'TWL', 'blocked', 'private-quarantine'),
      topic('topic_private_plain', 'TWL', 'blocked', 'private'),
      topic('topic_unclear', 'TWL', 'blocked', 'unclear'),
      topic('topic_mixed_sensitive', 'TWL', 'blocked', 'mixed-sensitive'),
      {
        ...topic('topic_private_ref', 'TWL', 'blocked'),
        source_task_refs_json: JSON.stringify([
          { board: 'twl-netze-private', taskId: 't_private_ref' },
        ]),
      },
    ],
    decisions: [
      {
        decision_id: 'decision_public',
        topic_id: 'topic_public',
        source_board: 'fixture',
        source_task_id: 't_public01',
        decision_class: 'governance',
        question: 'Pilotpreis festlegen?',
        reason_human_required: 'financial commitment',
        recommendation: 'Option B',
        options_json: JSON.stringify(['A', 'B']),
        consequences_json: JSON.stringify(['signal', 'revenue']),
        deadline: null,
        non_decision_effect: 'Pilot waits',
        execution_scope_json: '[]',
        excluded_scope_json: '[]',
        status: 'blocked',
        classifier_label: 'DECISION_REQUIRED',
        classifier_reasons_json: JSON.stringify(['financial_commitment']),
        confidence: 1,
        first_projected_at: 1700000200,
        updated_at: 1700000200,
      },
      {
        decision_id: 'decision_private',
        topic_id: 'topic_private',
        source_board: 'twl-netze-private',
        source_task_id: 't_private1',
        decision_class: 'governance',
        question: 'Private raw question',
        reason_human_required: 'private',
        recommendation: null,
        options_json: '[]',
        consequences_json: '[]',
        deadline: null,
        non_decision_effect: null,
        execution_scope_json: '[]',
        excluded_scope_json: '[]',
        status: 'blocked',
        classifier_label: 'DECISION_REQUIRED',
        classifier_reasons_json: '[]',
        confidence: 1,
        first_projected_at: 1700000200,
        updated_at: 1700000200,
      },
      {
        decision_id: 'decision_risk',
        topic_id: 'topic_public',
        source_board: 'fixture',
        source_task_id: 't_risk001',
        decision_class: 'scope_violation',
        question: 'Scope überschritten?',
        reason_human_required: 'scope boundary',
        recommendation: 'Stoppen',
        options_json: '[]',
        consequences_json: '[]',
        deadline: null,
        non_decision_effect: null,
        execution_scope_json: '[]',
        excluded_scope_json: '[]',
        status: 'blocked',
        classifier_label: 'RISK_ESCALATION',
        classifier_reasons_json: '[]',
        confidence: 1,
        first_projected_at: 1700000200,
        updated_at: 1700000200,
      },
      {
        decision_id: 'decision_resolved',
        topic_id: 'topic_public',
        source_board: 'fixture',
        source_task_id: 't_resolved1',
        decision_class: 'governance',
        question: 'Bereits beantwortete Matrix-Frage',
        reason_human_required: 'historical decision',
        recommendation: 'Umgesetzt',
        options_json: JSON.stringify(['A', 'B']),
        consequences_json: JSON.stringify(['closed']),
        deadline: null,
        non_decision_effect: 'none',
        execution_scope_json: '[]',
        excluded_scope_json: '[]',
        status: 'resolved',
        classifier_label: 'DECISION_REQUIRED',
        classifier_reasons_json: '[]',
        confidence: 1,
        first_projected_at: 1700000100,
        updated_at: 1700000400,
        source_refs_json: JSON.stringify([
          { board: 'fixture', taskId: 't_resolved1', channel: 'matrix' },
        ]),
      },
    ],
    outcomes: [
      {
        outcome_id: 'outcome_public',
        topic_id: 'topic_public',
        source_board: 'fixture',
        source_task_id: 't_public01',
        outcome_type: 'customer_dialogue',
        statement: 'Kundendialog begonnen',
        evidence_refs_json: JSON.stringify(['kanban:fixture/t_public01']),
        occurred_at: 1700000300,
        counterparty: 'Kunde',
        economic_relevance: 'pipeline',
        confidence: 1,
      },
    ],
    wakeups: [
      {
        wakeup_id: 'wakeup_public',
        source_board: 'fixture',
        source_task_id: 't_wakeup1',
        wake_at: 1800000000,
        why_scheduled: 'Review date',
        next_action_on_wake: 'Review',
        signal_required: null,
        auto_close_after: null,
        owner_agent: 'Felix',
        status: 'scheduled',
        last_signal_at: null,
      },
    ],
    digestItems: [
      digest('digest_public_new', 'Routine digest newest', { observed_at: 1700000500 }),
      digest('digest_public_literal', 'Literal 100%_ready signal', {
        observed_at: 1700000400,
      }),
      digest('digest_private_board', 'Private board digest', {
        source_board: 'twl-netze-private',
        topic_id: null,
        observed_at: 1700000600,
      }),
      digest('digest_private_topic', 'Public row linked to private-ref topic', {
        topic_id: 'topic_private_ref',
        observed_at: 1700000550,
      }),
      digest('digest_private_plain', 'Plain private sensitivity digest', {
        topic_id: 'topic_private_plain',
        observed_at: 1700000540,
      }),
      digest('digest_twl_netze_private', 'TWL-Netze private sensitivity digest', {
        topic_id: 'topic_twl_netze_private',
        observed_at: 1700000538,
      }),
      digest('digest_private_quarantine', 'Private quarantine sensitivity digest', {
        topic_id: 'topic_private_quarantine',
        observed_at: 1700000535,
      }),
      digest('digest_unclear', 'Unclear sensitivity digest', {
        topic_id: 'topic_unclear',
        observed_at: 1700000530,
      }),
      digest('digest_mixed_sensitive', 'Mixed-sensitive digest', {
        topic_id: 'topic_mixed_sensitive',
        observed_at: 1700000520,
      }),
    ],
    agentBriefs: [
      {
        agent_id: 'Felix',
        reporting_period_start: 1699395400,
        reporting_period_end: 1700000200,
        current_goal: 'Pilot in belastbaren Kundendialog überführen',
        active_topic_refs_json: JSON.stringify([
          {
            topicId: 'topic_public',
            title: 'Felix topic',
            state: 'running',
            progressClassification: 'evidence_backed_progress',
          },
        ]),
        outcomes_json: JSON.stringify([
          {
            outcomeId: 'outcome_public',
            type: 'customer_dialogue_started',
            statement: 'Kundendialog begonnen',
            progressQualified: true,
          },
        ]),
        next_actions_json: JSON.stringify(['Pilotgespräch fortsetzen']),
        dependencies_json: '[]',
        risks_json: JSON.stringify([{ statement: 'Preisrahmen offen' }]),
        needs_management_json: JSON.stringify([{ decisionId: 'decision_public' }]),
        last_substantive_progress_at: 1700000300,
        evidence_refs_json: JSON.stringify(['message-id:fixture-public']),
        brief_status: 'current',
        empty_state_reason: null,
        updated_at: 1700000300,
      },
    ],
    objects: [],
    boards: [
      {
        board: 'fixture',
        projected_at: 1700000300,
        source_count: 4,
        source_fingerprint: 'fixture',
      },
    ],
  });
  store.writeClassificationAudit([
    {
      source_board: 'fixture',
      source_task_id: 't_public01',
      projected_at: 1700000200,
      label: 'DECISION_REQUIRED',
      reasons_json: '[]',
      confidence: 1,
      classifier_version: 'fixture',
      overridden_by: null,
      override_reason: null,
    },
  ]);
  assert.equal(new ManagementReader({ database }).read('departments').items.length, 1);
  beforeRead = snapshot(database);

  const port = await allocatePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: cockpitRoot,
    env: {
      ...process.env,
      HITL_COCKPIT_HOST: '127.0.0.1',
      HITL_COCKPIT_PORT: String(port),
      HITL_COCKPIT_TOKEN: token,
      HITL_COCKPIT_ALLOW_LEGACY_BEARER: 'true',
      HERMES_HOME: path.join(tempRoot, 'hermes'),
      MANAGEMENT_COCKPIT_ENABLED: 'true',
      MANAGEMENT_COCKPIT_WRITE_ENABLED: 'false',
      MANAGEMENT_COCKPIT_SHADOW_ONLY: 'true',
      MANAGEMENT_COCKPIT_DEFAULT_VIEW: 'legacy',
      MANAGEMENT_COCKPIT_DATABASE: database,
      AGENTOS_SCOPE_LEDGER: scopeLedger,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('management feature configuration is parallel and read-only', async () => {
  const { status, body } = await request('/api/management/config');
  assert.equal(status, 200);
  assert.equal(body.enabled, true);
  assert.equal(body.writeEnabled, false);
  assert.equal(body.shadowOnly, true);
  assert.equal(body.defaultView, 'legacy');
  assert.equal((await request('/management')).status, 200);
  assert.equal((await request('/')).status, 200);
});

test('management read APIs expose overview, decisions, departments and topics', async () => {
  const metadata = await request('/api/management/metadata');
  assert.equal(metadata.status, 200);
  assert.equal(metadata.body.sourceCount, 4);

  const overview = await request('/api/management/overview');
  assert.equal(overview.status, 200);
  assert.deepEqual(overview.body.counts, {
    topics: 1,
    decisions: 2,
    outcomes: 1,
    departments: 1,
  });
  assert.equal(overview.body.decisions[0].question, 'Pilotpreis festlegen?');
  assert.deepEqual(overview.body.decisions[0].options, ['A', 'B']);

  const decisions = await request('/api/management/decisions?q=pilot');
  assert.equal(decisions.body.count, 1);
  assert.equal(decisions.body.items.length, 1, JSON.stringify(decisions.body));
  assert.equal(decisions.body.items[0].source_board, 'fixture');
  assert.equal((await request('/api/management/decisions?q=%25_')).body.count, 0);
  assert.equal(JSON.stringify(overview.body).includes('Bereits beantwortete Matrix-Frage'), false);
  const resolved = await request('/api/management/decisions?status=resolved');
  assert.equal(resolved.body.count, 1);
  assert.equal(resolved.body.items[0].decision_id, 'decision_resolved');
  assert.equal(resolved.body.items[0].source_refs[0].channel, 'matrix');
  const decision = await request('/api/management/decisions/decision_public');
  assert.equal(decision.status, 200);
  assert.equal(decision.body.item.question, 'Pilotpreis festlegen?');

  const departments = await request('/api/management/departments');
  assert.equal(departments.status, 200, JSON.stringify(departments.body));
  assert.deepEqual(
    departments.body.items.map((item) => item.agent_id),
    ['Felix']
  );
  assert.equal(departments.body.items[0].outcome_count, 1);
  assert.equal(departments.body.items[0].brief_status, 'current');
  assert.equal(departments.body.items[0].active_topic_refs[0].topicId, 'topic_public');
  assert.equal(departments.body.items[0].last_substantive_progress_at, 1700000300);
  const department = await request('/api/management/departments/Felix');
  assert.equal(department.body.item.agent_id, 'Felix');
  assert.deepEqual(department.body.item.next_actions, ['Pilotgespräch fortsetzen']);

  const topics = await request('/api/management/topics?owner=Felix');
  assert.equal(topics.body.count, 1);
  assert.equal(topics.body.items[0].title, 'Felix topic');
  assert.equal((await request('/api/management/topics?q=%25_')).body.count, 0);
  assert.equal(
    (await request('/api/management/topics/topic_public')).body.item.owner_agent,
    'Felix'
  );

  for (const endpoint of ['summary', 'outcomes', 'risks', 'wakeups', 'scopes', 'telemetry']) {
    const result = await request(`/api/management/${endpoint}`);
    assert.equal(result.status, 200, `${endpoint}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.ok, true);
  }
  assert.equal((await request('/api/management/risks')).body.count, 1);
  assert.equal((await request('/api/management/wakeups')).body.count, 1);
  assert.equal((await request('/api/management/scopes')).body.items[0].id, 'scope_public');
});

test('digest API enforces privacy, pagination and literal wildcard search', async () => {
  const firstPage = await request('/api/management/digest?limit=1&offset=0');
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.body.count, 2);
  assert.equal(firstPage.body.items.length, 1);
  assert.equal(firstPage.body.items[0].digest_id, 'digest_public_new');

  const secondPage = await request('/api/management/digest?limit=1&offset=1');
  assert.equal(secondPage.body.count, 2);
  assert.equal(secondPage.body.items[0].digest_id, 'digest_public_literal');

  const literal = await request('/api/management/digest?q=%25_');
  assert.equal(literal.body.count, 1);
  assert.equal(literal.body.items[0].digest_id, 'digest_public_literal');
  assert.equal(JSON.stringify(firstPage.body).includes('Private board digest'), false);
  assert.equal(JSON.stringify(firstPage.body).includes('private-ref topic'), false);
});

test('management API excludes every projection-sensitive topic value', async () => {
  const topics = await request('/api/management/topics?limit=100');
  assert.deepEqual(
    topics.body.items.map((item) => item.topic_id),
    ['topic_public']
  );

  for (const topicId of [
    'topic_private',
    'topic_twl_netze_private',
    'topic_private_quarantine',
    'topic_private_plain',
    'topic_unclear',
    'topic_mixed_sensitive',
  ]) {
    const detail = await request(`/api/management/topics/${topicId}`);
    assert.equal(detail.status, 404, topicId);
  }

  const digest = await request('/api/management/digest?limit=100');
  assert.equal(digest.body.count, 2);
  for (const signal of [
    'TWL-Netze private sensitivity digest',
    'Private quarantine sensitivity digest',
    'Plain private sensitivity digest',
    'Unclear sensitivity digest',
    'Mixed-sensitive digest',
  ]) {
    assert.equal(JSON.stringify(digest.body).includes(signal), false, signal);
  }
});

test('management API rejects writes and never exposes TWL-private projection rows', async () => {
  const write = await request('/api/management/topics', { method: 'POST' });
  assert.equal(write.status, 405);
  assert.equal(write.body.error, 'read_only_api');

  for (const endpoint of [
    'summary',
    'overview',
    'decisions',
    'departments',
    'topics',
    'outcomes',
    'risks',
    'wakeups',
    'digest',
    'scopes',
    'telemetry',
  ]) {
    const { body } = await request(`/api/management/${endpoint}?limit=100`);
    assert.equal(JSON.stringify(body).includes('twl-netze-private'), false);
    assert.equal(JSON.stringify(body).includes('Private raw question'), false);
  }
  assert.deepEqual(snapshot(database), beforeRead);
});

test('governance actions return non-persistent shadow plans only', async () => {
  const beforeAction = snapshot(database);
  const result = await request('/api/management/decisions/decision_public/choose', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ option: 'B', note: 'Pilot begrenzen' }),
  });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.equal(result.body.mode, 'shadow');
  assert.equal(result.body.writePerformed, false);
  assert.equal(result.body.persisted, false);
  assert.equal(result.body.normalizedPayload.option, 'B');
  assert.deepEqual(result.body.source, { board: 'fixture', taskId: 't_public01' });
  assert.deepEqual(snapshot(database), beforeAction);

  const invalid = await request('/api/management/decisions/decision_public/schedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wakeAt: 'invalid', reason: 'Später' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'wakeAt_invalid');
  assert.deepEqual(snapshot(database), beforeAction);
});
