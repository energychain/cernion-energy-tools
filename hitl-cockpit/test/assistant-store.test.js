'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { afterEach, test } = require('node:test');
const { AssistantStore } = require('../lib/assistant-store');

const roots = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-store-'));
  roots.push(root);
  const database = path.join(root, 'assistant', 'assistant.db');
  const store = new AssistantStore({ database });
  store.initialize();
  return { store, database };
}

test('initializes a separate mode-0600 database with required tables', () => {
  const { store, database } = createStore();
  assert.equal(fs.statSync(database).mode & 0o777, 0o600);
  const tables = store.getSchemaMetadata().tables;
  for (const table of [
    'assistant_action_proposals',
    'assistant_action_receipts',
    'assistant_context_envelopes',
    'assistant_conversations',
    'assistant_events',
    'assistant_messages',
  ]) {
    assert.ok(tables.includes(table), table);
  }
});

test('ignores caller-controlled schema options and loads only the fixed schema', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-store-failure-'));
  roots.push(root);
  const database = path.join(root, 'assistant', 'assistant.db');
  const store = new AssistantStore({
    database,
    schema: 'CREATE TABLE caller_controlled_leak(value TEXT);',
  });
  store.initialize();
  assert.equal(fs.statSync(database).mode & 0o777, 0o600);
  const tables = store.getSchemaMetadata().tables;
  assert.ok(tables.includes('assistant_conversations'));
  assert.ok(!tables.includes('caller_controlled_leak'));
});

test('schema initialization is atomic when the fixed schema fails part-way through', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-store-atomic-'));
  roots.push(root);
  const moduleRoot = path.join(root, 'isolated-lib');
  fs.mkdirSync(moduleRoot, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '..', 'lib', 'assistant-store.js'),
    path.join(moduleRoot, 'assistant-store.js')
  );
  fs.writeFileSync(
    path.join(moduleRoot, 'assistant-schema.sql'),
    'CREATE TABLE leak_table(value TEXT);\nTHIS IS NOT VALID SQL;\n',
    'utf8'
  );
  const database = path.join(root, 'assistant', 'assistant.db');
  const script = [
    `const { AssistantStore } = require(${JSON.stringify(path.join(moduleRoot, 'assistant-store.js'))});`,
    `const store = new AssistantStore({ database: ${JSON.stringify(database)} });`,
    'try { store.initialize(); process.exitCode = 2; } catch { process.exitCode = 0; }',
  ].join('\n');
  assert.equal(spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).status, 0);
  assert.equal(fs.statSync(database).mode & 0o777, 0o600);

  const inspected = spawnSync(
    'python3',
    [
      '-c',
      [
        'import json, sqlite3, sys',
        'con=sqlite3.connect(sys.argv[1])',
        'tables=[row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type=\\\'table\\\' ORDER BY name")]',
        'print(json.dumps({"tables":tables,"version":con.execute("PRAGMA user_version").fetchone()[0]}))',
      ].join(';'),
      database,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.deepEqual(JSON.parse(inspected.stdout), { tables: [], version: 0 });
});

test('upgrades every prior assistant schema version to v10 without duplicate columns', () => {
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `assistant-store-v${version}-`));
    roots.push(root);
    const database = path.join(root, 'assistant.db');
    const sessionColumn =
      version === 3 || version === 5
        ? ', hermes_session_messages INTEGER NOT NULL DEFAULT 0 CHECK (hermes_session_messages >= 0)'
        : '';
    const seeded = spawnSync(
      'python3',
      [
        '-c',
        [
          'import sqlite3, sys',
          'db, version, session_column = sys.argv[1], int(sys.argv[2]), sys.argv[3]',
          'con=sqlite3.connect(db)',
          "con.execute('CREATE TABLE assistant_conversations (conversation_id TEXT PRIMARY KEY, object_type TEXT, object_id TEXT, hermes_session_name TEXT NOT NULL, hermes_session_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL' + session_column + ')')",
          'con.execute("CREATE TABLE assistant_runs (run_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(conversation_id), client_message_id TEXT NOT NULL UNIQUE, user_message_id TEXT NOT NULL, assistant_message_id TEXT, context_envelope_id TEXT, hermes_session_id TEXT, status TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL" + (", lease_owner TEXT, lease_expires_at INTEGER" if version == 5 else "") + ")") if version >= 4 else None',
          "con.execute(f'PRAGMA user_version = {version}')",
          'con.commit()',
        ].join(';'),
        database,
        String(version),
        sessionColumn,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(seeded.status, 0, seeded.stderr);

    const store = new AssistantStore({ database });
    assert.deepEqual(store.initialize(), { schemaVersion: 10 });
    const columns = store.getSchemaMetadata().conversationColumns;
    assert.equal(columns.filter((column) => column === 'hermes_session_messages').length, 1);
    assert.deepEqual(
      store
        .getSchemaMetadata()
        .runColumns.filter((column) => ['lease_owner', 'lease_expires_at'].includes(column))
        .sort(),
      ['lease_expires_at', 'lease_owner']
    );
    assert.ok(store.getSchemaMetadata().indexes.includes('assistant_one_running_per_conversation'));
  }
});

test('v6 migration fails legacy running rows without a complete lease and audits recovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-store-v4-running-'));
  roots.push(root);
  const database = path.join(root, 'assistant.db');
  const seeded = spawnSync(
    'python3',
    [
      '-c',
      [
        'import sqlite3, sys',
        'con=sqlite3.connect(sys.argv[1])',
        'con.execute("CREATE TABLE assistant_conversations (conversation_id TEXT PRIMARY KEY, object_type TEXT, object_id TEXT, hermes_session_name TEXT NOT NULL, hermes_session_id TEXT, hermes_session_messages INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")',
        'con.execute("CREATE TABLE assistant_runs (run_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, client_message_id TEXT NOT NULL UNIQUE, user_message_id TEXT NOT NULL, assistant_message_id TEXT, context_envelope_id TEXT, hermes_session_id TEXT, status TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")',
        "con.execute(\"INSERT INTO assistant_conversations VALUES ('c1',NULL,NULL,'assistant-c1',NULL,0,'active',10,10)\")",
        "con.execute(\"INSERT INTO assistant_runs VALUES ('legacy-running','c1','legacy-client','legacy-message',NULL,NULL,NULL,'running',NULL,10,11)\")",
        'con.execute("PRAGMA user_version = 4")',
        'con.commit()',
      ].join(';'),
      database,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(seeded.status, 0, seeded.stderr);

  const store = new AssistantStore({ database });
  store.initialize();
  const migrated = store.getRun('legacy-running');
  assert.equal(migrated.status, 'failed');
  assert.equal(migrated.errorCode, 'assistant_server_restarted');
  assert.equal(migrated.leaseOwner, null);
  assert.equal(migrated.leaseExpiresAt, null);
  assert.ok(
    store
      .listEvents('c1')
      .some(
        (item) =>
          item.event_type === 'run_failed' &&
          JSON.parse(item.payload_json).code === 'assistant_server_restarted'
      )
  );
});

test('enforces one active conversation per management object', () => {
  const { store } = createStore();
  store.createConversation({ id: 'c1', objectType: 'topic', objectId: 'topic_1' });
  assert.throws(
    () => store.createConversation({ id: 'c2', objectType: 'topic', objectId: 'topic_1' }),
    /active_object_conversation_exists/
  );
  store.closeConversation('c1');
  assert.equal(
    store.createConversation({ id: 'c2', objectType: 'topic', objectId: 'topic_1' }).id,
    'c2'
  );
});

test('advances a Hermes session pair with compare-and-set and safe message counting', () => {
  const { store } = createStore();
  const conversation = store.createConversation({ id: 'c1', sessionName: 'assistant-c1' });
  const first = store.advanceConversationSession({
    conversationId: conversation.id,
    expectedSessionName: 'assistant-c1',
    expectedSessionId: null,
    sessionName: 'assistant-c1',
    sessionId: 'session-1',
  });
  assert.equal(first.sessionId, 'session-1');
  assert.equal(first.sessionMessageCount, 1);

  const continued = store.advanceConversationSession({
    conversationId: conversation.id,
    expectedSessionName: 'assistant-c1',
    expectedSessionId: 'session-1',
    sessionName: 'assistant-c1',
    sessionId: 'session-1',
  });
  assert.equal(continued.sessionMessageCount, 2);

  const rotated = store.advanceConversationSession({
    conversationId: conversation.id,
    expectedSessionName: 'assistant-c1',
    expectedSessionId: 'session-1',
    sessionName: 'assistant-c1-r2-unique',
    sessionId: 'session-2',
    rotate: true,
  });
  assert.equal(rotated.sessionName, 'assistant-c1-r2-unique');
  assert.equal(rotated.sessionId, 'session-2');
  assert.equal(rotated.sessionMessageCount, 1);

  assert.throws(
    () =>
      store.advanceConversationSession({
        conversationId: conversation.id,
        expectedSessionName: 'assistant-c1',
        expectedSessionId: 'session-1',
        sessionName: 'stale-write',
        sessionId: 'session-3',
      }),
    /conversation_session_changed/
  );
  assert.equal(store.getConversation('c1').sessionId, 'session-2');
});

test('client_message_id is idempotent and conflicting reuse fails closed', () => {
  const { store } = createStore();
  store.createConversation({ id: 'c1' });
  store.createConversation({ id: 'c2' });
  const first = store.appendMessage({
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    content: 'hello',
    clientMessageId: 'client-1',
  });
  const second = store.appendMessage({
    id: 'different-id',
    conversationId: 'c1',
    role: 'user',
    content: 'hello',
    clientMessageId: 'client-1',
  });
  assert.equal(second.id, first.id);
  assert.equal(store.listMessages('c1').length, 1);
  assert.throws(
    () =>
      store.appendMessage({
        id: 'm3',
        conversationId: 'c1',
        role: 'user',
        content: 'changed',
        clientMessageId: 'client-1',
      }),
    /client_message_id_conflict/
  );
  assert.throws(
    () =>
      store.appendMessage({
        id: 'm4',
        conversationId: 'c2',
        role: 'user',
        content: 'hello',
        clientMessageId: 'client-1',
      }),
    /client_message_id_conflict/
  );
});

test('events are append-only', () => {
  const { store } = createStore();
  store.appendEvent({ id: 'e1', eventType: 'conversation_created', payload: { safe: true } });
  assert.equal(store.query, undefined);
  assert.equal(store.execute, undefined);
  assert.equal(store.listEvents()[0].event_type, 'conversation_created');
  assert.ok(store.getSchemaMetadata().eventTriggers.includes('assistant_events_no_update'));
});

test('message and event batch rolls back atomically', () => {
  const { store } = createStore();
  store.createConversation({ id: 'c1' });
  assert.throws(
    () =>
      store.appendTransaction({
        messages: [
          { id: 'm1', conversationId: 'c1', role: 'user', content: 'will rollback' },
          { id: 'm2', conversationId: 'missing', role: 'assistant', content: 'invalid' },
        ],
        events: [{ id: 'e1', eventType: 'turn_appended', payload: {} }],
      }),
    /FOREIGN KEY|constraint/i
  );
  assert.equal(store.listMessages('c1').length, 0);
  assert.equal(store.listEvents().length, 0);
});

test('stores immutable context envelopes without task status truth', () => {
  const { store } = createStore();
  store.createConversation({ id: 'c1', objectType: 'decision', objectId: 'd1' });
  store.saveContextEnvelope({
    id: 'ctx1',
    conversationId: 'c1',
    objectType: 'decision',
    objectId: 'd1',
    fingerprint: 'abc123',
    payload: { question: 'Choose' },
  });
  const row = store.getContextEnvelope('ctx1');
  assert.equal(row.fingerprint, 'abc123');
  assert.equal(JSON.parse(row.payload_json).question, 'Choose');
  const columns = store.getSchemaMetadata().conversationColumns;
  assert.ok(!columns.includes('task_status'));
});

test('startup recovery fails only stale accepted work and expired leases', () => {
  const { store } = createStore();
  const staleConversation = store.createConversation({ id: 'c1' });
  const freshConversation = store.createConversation({ id: 'c2' });
  const staleAccepted = store.createRun({
    id: 'run_accepted',
    conversationId: staleConversation.id,
    text: 'accepted',
    clientMessageId: 'client-accepted',
    createdAt: 100,
  }).run;
  const expired = store.createRun({
    id: 'run_running',
    conversationId: staleConversation.id,
    text: 'running',
    clientMessageId: 'client-running',
    createdAt: 100,
  }).run;
  store.claimRun(expired.id, null, {
    owner: 'old-worker',
    now: 100,
    leaseSeconds: 10,
  });
  const fresh = store.createRun({
    id: 'run_fresh',
    conversationId: freshConversation.id,
    text: 'fresh',
    clientMessageId: 'client-fresh',
    createdAt: 190,
  }).run;
  store.claimRun(fresh.id, null, {
    owner: 'live-worker',
    now: 190,
    leaseSeconds: 60,
  });

  assert.deepEqual(store.recoverInterruptedRuns({ now: 200, staleAfterSeconds: 50 }), {
    recovered: 2,
  });
  for (const runId of [staleAccepted.id, expired.id]) {
    const recovered = store.getRun(runId);
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.errorCode, 'assistant_server_restarted');
  }
  assert.equal(store.getRun(fresh.id).status, 'running');
  assert.equal(store.getRun(fresh.id).leaseOwner, 'live-worker');
  assert.deepEqual(store.recoverInterruptedRuns({ now: 200, staleAfterSeconds: 50 }), {
    recovered: 0,
  });
});

test('an unowned accepted run can still fail before it is claimed', () => {
  const { store } = createStore();
  const conversation = store.createConversation({ id: 'c1' });
  const pending = store.createRun({
    id: 'run_rejected_context',
    conversationId: conversation.id,
    text: 'rejected before claim',
    clientMessageId: 'client-rejected-context',
  }).run;

  store.updateRun(pending.id, 'failed', {
    conversationId: conversation.id,
    errorCode: 'assistant_context_not_available',
    expectedStatus: 'accepted',
  });
  const failed = store.getRun(pending.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'assistant_context_not_available');
});

test('leases prevent duplicate claims and stale owners from completing after takeover', () => {
  const { store } = createStore();
  const conversation = store.createConversation({ id: 'c1', sessionName: 'assistant-c1' });
  const claimed = store.createRun({
    id: 'run_owned',
    conversationId: conversation.id,
    text: 'owned',
    clientMessageId: 'client-owned',
    createdAt: 100,
  }).run;
  assert.equal(
    store.claimRun(claimed.id, null, { owner: 'worker-a', now: 100, leaseSeconds: 10 }).claimed,
    true
  );
  assert.equal(
    store.claimRun(claimed.id, null, { owner: 'worker-b', now: 105, leaseSeconds: 10 }).claimed,
    false
  );
  assert.equal(
    store.claimRun(claimed.id, null, { owner: 'worker-b', now: 111, leaseSeconds: 10 }).claimed,
    true
  );
  const completion = {
    runId: claimed.id,
    conversationId: conversation.id,
    content: 'safe answer',
    createdAt: 112,
    now: 112,
    expectedSessionName: conversation.sessionName,
    expectedSessionId: null,
    sessionName: conversation.sessionName,
    sessionId: 'session-new',
  };
  assert.throws(() => store.completeRun({ ...completion, owner: 'worker-a' }), /run_not_owned/);
  assert.equal(store.listMessages(conversation.id).length, 1);
  store.completeRun({ ...completion, owner: 'worker-b' });
  const completed = store.getRun(claimed.id);
  assert.equal(completed.status, 'completed');
  assert.equal(store.listMessages(conversation.id).length, 2);

  store.updateRun(claimed.id, 'failed', {
    conversationId: conversation.id,
    errorCode: 'late_duplicate_failure',
    expectedStatus: 'running',
    expectedOwner: 'worker-a',
  });
  assert.equal(store.getRun(claimed.id).status, 'completed');
  assert.equal(store.getRun(claimed.id).errorCode, null);
});

test('an owner cannot complete after its lease expires and completion rolls back atomically', () => {
  const { store } = createStore();
  const conversation = store.createConversation({ id: 'c1', sessionName: 'assistant-c1' });
  const claimed = store.createRun({
    id: 'run_expired',
    conversationId: conversation.id,
    text: 'owned until expiry',
    clientMessageId: 'client-expired',
    createdAt: 100,
  }).run;
  assert.equal(
    store.claimRun(claimed.id, null, { owner: 'worker-a', now: 100, leaseSeconds: 10 }).claimed,
    true
  );

  assert.throws(
    () =>
      store.completeRun({
        runId: claimed.id,
        owner: 'worker-a',
        conversationId: conversation.id,
        content: 'must not persist',
        createdAt: 111,
        now: 111,
        expectedSessionName: conversation.sessionName,
        expectedSessionId: null,
        sessionName: conversation.sessionName,
        sessionId: 'session-after-expiry',
      }),
    /run_lease_expired/
  );
  assert.deepEqual(
    store.listMessages(conversation.id).map((item) => item.role),
    ['user']
  );
  assert.deepEqual(store.getConversation(conversation.id), conversation);
  const unchanged = store.getRun(claimed.id);
  assert.equal(unchanged.status, 'running');
  assert.equal(unchanged.leaseOwner, 'worker-a');
  assert.equal(unchanged.leaseExpiresAt, 110);
});

test('an expired owner cannot fail a run but its takeover owner can terminalize it', () => {
  const { store } = createStore();
  const conversation = store.createConversation({ id: 'c1' });
  const pending = store.createRun({
    id: 'run_expired_failure',
    conversationId: conversation.id,
    text: 'must remain owned until takeover',
    clientMessageId: 'client-expired-failure',
    createdAt: 100,
  }).run;
  store.claimRun(pending.id, null, { owner: 'worker-a', now: 100, leaseSeconds: 10 });

  store.updateRun(pending.id, 'failed', {
    conversationId: conversation.id,
    errorCode: 'late_worker_failure',
    expectedStatus: 'running',
    expectedOwner: 'worker-a',
  });
  const unchanged = store.getRun(pending.id);
  assert.equal(unchanged.status, 'running');
  assert.equal(unchanged.errorCode, null);
  assert.equal(unchanged.leaseOwner, 'worker-a');

  const now = Math.floor(Date.now() / 1000);
  assert.equal(
    store.claimRun(pending.id, null, { owner: 'worker-b', now, leaseSeconds: 60 }).claimed,
    true
  );
  store.updateRun(pending.id, 'failed', {
    conversationId: conversation.id,
    errorCode: 'current_worker_failure',
    expectedStatus: 'running',
    expectedOwner: 'worker-b',
  });
  const failed = store.getRun(pending.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'current_worker_failure');
  assert.equal(failed.leaseOwner, null);
  assert.equal(failed.leaseExpiresAt, null);
});

test('proposal creation is idempotent, conflict-safe and emits one append-only audit event', () => {
  const { store } = createStore();
  store.createConversation({ id: 'c-proposal' });
  store.appendMessage({
    id: 'm-proposal',
    conversationId: 'c-proposal',
    role: 'assistant',
    content: 'Ich schlage einen Follow-up vor.',
  });
  const input = {
    id: 'p1',
    conversationId: 'c-proposal',
    messageId: 'm-proposal',
    actionType: 'create_followup',
    targetType: 'topic',
    targetId: 'topic-1',
    payload: { title: 'Prüfen', description: 'Shadow only' },
    riskClass: 'low',
    scopeStatus: 'unknown',
    idempotencyKey: 'assistant-proposal-v1:stable',
    createdAt: 100,
  };
  const created = store.createProposal(input);
  assert.equal(created.deduplicated, false);
  assert.equal(created.proposal.status, 'shadow');
  assert.deepEqual(created.proposal.payload, input.payload);

  const retry = store.createProposal({ ...input, id: 'p2', createdAt: 101 });
  assert.equal(retry.deduplicated, true);
  assert.equal(retry.proposal.id, 'p1');
  assert.equal(store.listProposals({ conversationId: 'c-proposal' }).length, 1);
  assert.equal(
    store.listEvents('c-proposal').filter((item) => item.event_type === 'proposal.created').length,
    1
  );
  assert.throws(
    () => store.createProposal({ ...input, payload: { title: 'Changed' } }),
    /proposal_idempotency_conflict/
  );
});

test('proposal status transitions fail closed and receipt atomically proves execution', () => {
  const { store } = createStore();
  store.createConversation({ id: 'c-execution' });
  store.appendMessage({
    id: 'm-execution',
    conversationId: 'c-execution',
    role: 'assistant',
    content: 'Shadow proposal',
  });
  store.createProposal({
    id: 'p-execution',
    conversationId: 'c-execution',
    messageId: 'm-execution',
    actionType: 'delegate',
    targetType: 'topic',
    targetId: 'topic-1',
    payload: { assignee: 'Felix' },
    idempotencyKey: 'assistant-proposal-v1:execution',
    createdAt: 100,
  });
  assert.throws(
    () =>
      store.updateProposalStatus('p-execution', 'executed', {
        conversationId: 'c-execution',
      }),
    /invalid_proposal_status_transition/
  );
  store.updateProposalStatus('p-execution', 'confirmed', {
    conversationId: 'c-execution',
    expectedStatus: 'shadow',
    updatedAt: 101,
  });
  store.updateProposalStatus('p-execution', 'executing', {
    conversationId: 'c-execution',
    expectedStatus: 'confirmed',
    updatedAt: 102,
  });
  const saved = store.saveReceipt({
    id: 'receipt-1',
    proposalId: 'p-execution',
    conversationId: 'c-execution',
    sourceBoard: 'management',
    sourceTaskId: 'task-1',
    beforeFingerprint: 'before',
    afterFingerprint: 'after',
    readback: { status: 'verified' },
    executedAt: 103,
  });
  assert.equal(saved.deduplicated, false);
  assert.equal(saved.proposal.status, 'executed');
  assert.deepEqual(store.getReceiptByProposalId('p-execution').readback, {
    status: 'verified',
  });

  const retry = store.saveReceipt({
    id: 'different-receipt-id',
    proposalId: 'p-execution',
    conversationId: 'c-execution',
    sourceBoard: 'management',
    sourceTaskId: 'task-1',
    beforeFingerprint: 'before',
    afterFingerprint: 'after',
    readback: { status: 'verified' },
    executedAt: 103,
  });
  assert.equal(retry.deduplicated, true);
  assert.equal(retry.receipt.id, 'receipt-1');
  assert.equal(
    store.listEvents('c-execution').filter((item) => item.event_type === 'action.executed').length,
    1
  );
  assert.ok(store.getSchemaMetadata().receiptTriggers.includes('assistant_receipts_no_update'));
  assert.throws(
    () =>
      store.saveReceipt({
        proposalId: 'p-execution',
        sourceBoard: 'management',
        sourceTaskId: 'task-1',
        readback: { status: 'changed' },
        executedAt: 103,
      }),
    /proposal_receipt_conflict/
  );
});
