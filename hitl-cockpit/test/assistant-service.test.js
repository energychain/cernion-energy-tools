'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { AssistantStore } = require('../lib/assistant-store');
const { createAssistantService, snapshotMatrixRoom } = require('../lib/assistant-service');

function fixture(t, client = null, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AssistantStore({ database: path.join(root, 'assistant.db') });
  store.initialize();
  const calls = [];
  const rhajaina = client || {
    async send(input) {
      calls.push(input);
      return {
        text: `Antwort ${input.prompt}`,
        sessionName: input.sessionName,
        hermesSessionId: '20261109_182510_c5a695',
        runId: input.runId,
      };
    },
  };
  const service = createAssistantService({
    store,
    contextResolver: {
      resolve: ({ objectType, objectId }) => ({
        objectType: objectType || 'global',
        objectId: objectId || null,
        payload: { safe: true },
        fingerprint: 'f'.repeat(64),
      }),
    },
    client: rhajaina,
    config: {
      enabled: true,
      transport: { timeoutMs: 5000, runBudgetSeconds: 5 },
      limits: {
        maxMessageChars: 4000,
        recentMessageCount: 4,
        maxContextChars: 12000,
        sessionRotateMessages: options.sessionRotateMessages || 20,
      },
    },
    summary: { triggerMessages: 4, retainMessages: 2, maxChars: 500 },
    workerId: options.workerId,
    leaseSeconds: options.leaseSeconds,
    nowMs: options.nowMs,
    setTimer: options.setTimer,
    sleep: options.sleep,
    claimPollMs: options.claimPollMs,
  });
  return { service, store, calls };
}

test('snapshots context Matrix room over trusted agent fallback', () => {
  const context = {
    payload: { references: { matrixRoom: { roomRef: '!context1:matrix.example.org' } } },
  };
  const selected = snapshotMatrixRoom(context, 'Anja', {
    anja: '!fallback1:matrix.example.org',
  });
  context.payload.references.matrixRoom.roomRef = '!mutated1:matrix.example.org';
  assert.deepEqual(selected, { roomRef: '!context1:matrix.example.org' });
  assert.deepEqual(
    snapshotMatrixRoom({ payload: {} }, 'Anja', { anja: '!fallback1:matrix.example.org' }),
    {
      roomRef: '!fallback1:matrix.example.org',
    }
  );
});

test('runs accepted -> running -> completed, persists stable transport identities and context', async (t) => {
  const { service, store, calls } = fixture(t);
  const conversation = service.createConversation({ objectType: 'topic', objectId: 'topic_1' });
  const accepted = service.submitMessage({
    conversationId: conversation.id,
    text: 'Hallo',
    clientMessageId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(accepted.status, 'accepted');
  await service.drain(conversation.id);
  const run = service.getRun(accepted.id);
  assert.equal(run.status, 'completed');
  assert.equal(run.runId, accepted.id);
  assert.equal(run.hermesSessionId, '20261109_182510_c5a695');
  assert.notEqual(run.hermesSessionId, conversation.sessionName);
  assert.equal(calls[0].runId, accepted.id);
  assert.equal(
    store
      .listMessages(conversation.id)
      .map((m) => m.role)
      .join(','),
    'user,assistant'
  );
  assert.ok(run.contextEnvelopeId);
});

test('follow-up fails closed when Hermes transport identity changes', async (t) => {
  let responseNumber = 0;
  const { service, store } = fixture(t, {
    async send(input) {
      responseNumber += 1;
      return {
        text: `Antwort ${responseNumber}`,
        sessionName: input.sessionName,
        hermesSessionId: responseNumber === 1 ? 'session-stable' : 'session-changed',
        runId: input.runId,
      };
    },
  });
  const conversation = service.createConversation({});
  const first = service.submitMessage({
    conversationId: conversation.id,
    text: 'eins',
    clientMessageId: '11111111-1111-4111-8111-111111111112',
  });
  await service.drain(conversation.id);
  assert.equal(service.getRun(first.id).status, 'completed');

  const second = service.submitMessage({
    conversationId: conversation.id,
    text: 'zwei',
    clientMessageId: '11111111-1111-4111-8111-111111111113',
  });
  await service.drain(conversation.id);
  const failed = service.getRun(second.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'transport_identity_changed');
  assert.equal(store.getConversation(conversation.id).sessionId, 'session-stable');
  const roles = store.listMessages(conversation.id).map((item) => item.role);
  assert.equal(roles.length, 3);
  assert.equal(roles.filter((role) => role === 'assistant').length, 1);
});

test('global clientMessageId dedupe returns identical message/run across retries and conflicts across conversations', async (t) => {
  const { service, calls } = fixture(t);
  const one = service.createConversation({});
  const two = service.createConversation({});
  const input = {
    conversationId: one.id,
    text: 'Einmal',
    clientMessageId: '22222222-2222-4222-8222-222222222222',
  };
  const first = service.submitMessage(input);
  const retry = service.submitMessage(input);
  assert.equal(retry.id, first.id);
  assert.equal(retry.userMessageId, first.userMessageId);
  assert.throws(
    () => service.submitMessage({ ...input, conversationId: two.id }),
    /client_message_id_conflict/
  );
  await service.drain(one.id);
  assert.equal(calls.length, 1);
});

test('resumePendingRuns completes an accepted run left behind at startup', async (t) => {
  const { service, store, calls } = fixture(t);
  const conversation = service.createConversation({});
  const accepted = store.createRun({
    conversationId: conversation.id,
    text: 'resume me',
    clientMessageId: '23232323-2323-4232-8232-232323232323',
  }).run;

  service.resumePendingRuns();
  await service.drain(conversation.id);

  assert.equal(service.getRun(accepted.id).status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'resume me');
});

test('resumePendingRuns schedules a fresh foreign lease then takes it over after expiry', async (t) => {
  let now = 100_000;
  let scheduled;
  const { service, store, calls } = fixture(t, null, {
    workerId: 'recovery-worker',
    leaseSeconds: 10,
    nowMs: () => now,
    setTimer(callback, milliseconds) {
      scheduled = {
        callback,
        milliseconds,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
      return scheduled;
    },
  });
  const conversation = service.createConversation({});
  const running = store.createRun({
    conversationId: conversation.id,
    text: 'take over later',
    clientMessageId: '24242424-2424-4242-8242-242424242424',
    createdAt: 100,
  }).run;
  store.claimRun(running.id, null, { owner: 'foreign-worker', now: 100, leaseSeconds: 10 });

  service.resumePendingRuns();
  assert.equal(calls.length, 0);
  assert.equal(scheduled.milliseconds, 10_000);
  assert.equal(scheduled.unrefCalled, true);

  now = 110_000;
  scheduled.callback();
  await service.drain(conversation.id);
  assert.equal(service.getRun(running.id).status, 'completed');
  assert.equal(calls.length, 1);
});

test('deduplicating an accepted run requeues it through the normal claim path', async (t) => {
  const { service, store, calls } = fixture(t);
  const conversation = service.createConversation({});
  const input = {
    conversationId: conversation.id,
    text: 'requeue accepted',
    clientMessageId: '25252525-2525-4252-8252-252525252525',
  };
  const accepted = store.createRun(input).run;

  const deduplicated = service.submitMessage(input);
  assert.equal(deduplicated.id, accepted.id);
  await service.drain(conversation.id);
  assert.equal(service.getRun(accepted.id).status, 'completed');
  assert.equal(calls.length, 1);
});

test('rejects noncanonical, trailing-junk, wrong-alphabet, and oversized cursors', (t) => {
  const { service } = fixture(t);
  const conversation = service.createConversation({});
  const canonical = Buffer.from(JSON.stringify({ createdAt: 1, id: 'message_1' })).toString(
    'base64url'
  );
  for (const cursor of [
    `${canonical}=`,
    `${canonical}.junk`,
    `${canonical}+`,
    'e31',
    'A'.repeat(513),
  ]) {
    assert.throws(
      () => service.listMessages(conversation.id, { cursor }),
      (error) => error.code === 'invalid_cursor'
    );
  }
});

test('privacy-rejected successful output is never persisted', async (t) => {
  const { service, store } = fixture(t, {
    async send() {
      throw Object.assign(new Error('private output rejected'), {
        code: 'transport_output_invalid',
      });
    },
  });
  const conversation = service.createConversation({});
  const accepted = service.submitMessage({
    conversationId: conversation.id,
    text: 'question',
    clientMessageId: '31313131-3131-4131-8131-313131313131',
  });
  await service.drain(conversation.id);
  assert.equal(service.getRun(accepted.id).status, 'failed');
  assert.equal(service.getRun(accepted.id).errorCode, 'transport_output_invalid');
  assert.deepEqual(
    store.listMessages(conversation.id).map((item) => item.role),
    ['user']
  );
});

test('context rejection never calls client and records failed run without leaking details', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-reject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AssistantStore({ database: path.join(root, 'assistant.db') });
  store.initialize();
  let calls = 0;
  const service = createAssistantService({
    store,
    contextResolver: {
      resolve() {
        const error = new Error('private details');
        error.code = 'assistant_context_not_available';
        throw error;
      },
    },
    client: {
      async send() {
        calls += 1;
      },
    },
    config: {
      enabled: true,
      limits: {
        maxMessageChars: 4000,
        recentMessageCount: 4,
        maxContextChars: 12000,
        sessionRotateMessages: 20,
      },
    },
  });
  const conversation = service.createConversation({});
  const run = service.submitMessage({
    conversationId: conversation.id,
    text: 'x',
    clientMessageId: '33333333-3333-4333-8333-333333333333',
  });
  await service.drain(conversation.id);
  assert.equal(calls, 0);
  assert.equal(service.getRun(run.id).status, 'failed');
  assert.equal(service.getRun(run.id).errorCode, 'assistant_context_not_available');
});

test('per-conversation execution is ordered and summary is updated only after successful answers', async (t) => {
  const order = [];
  let rejectSecond = false;
  const { service, store } = fixture(t, {
    async send(input) {
      order.push(`start:${input.prompt}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (rejectSecond && input.prompt === 'zwei')
        throw Object.assign(new Error('no'), { code: 'transport_failed' });
      order.push(`end:${input.prompt}`);
      return {
        text: `ok ${input.prompt}`,
        sessionName: input.sessionName,
        hermesSessionId: '20261109_182510_c5a695',
        runId: input.runId,
      };
    },
  });
  const conversation = service.createConversation({});
  service.submitMessage({
    conversationId: conversation.id,
    text: 'eins',
    clientMessageId: '44444444-4444-4444-8444-444444444441',
  });
  service.submitMessage({
    conversationId: conversation.id,
    text: 'zwei',
    clientMessageId: '44444444-4444-4444-8444-444444444442',
  });
  await service.drain(conversation.id);
  assert.deepEqual(order, ['start:eins', 'end:eins', 'start:zwei', 'end:zwei']);
  assert.ok(store.getSummary(conversation.id));

  rejectSecond = true;
  const before = store.getSummary(conversation.id);
  service.submitMessage({
    conversationId: conversation.id,
    text: 'zwei',
    clientMessageId: '44444444-4444-4444-8444-444444444443',
  });
  await service.drain(conversation.id);
  assert.deepEqual(store.getSummary(conversation.id), before);
});

test('continues normally and rotates to a fresh session only after the success threshold', async (t) => {
  const calls = [];
  const { service, store } = fixture(
    t,
    {
      async send(input) {
        calls.push(input);
        return {
          text: `ok ${input.prompt}`,
          sessionName: input.sessionName,
          hermesSessionId: calls.length < 3 ? 'session-1' : 'session-2',
          runId: input.runId,
        };
      },
    },
    { sessionRotateMessages: 2 }
  );
  const conversation = service.createConversation({});
  for (const [index, text] of ['eins', 'zwei', 'drei'].entries()) {
    service.submitMessage({
      conversationId: conversation.id,
      text,
      clientMessageId: `55555555-5555-4555-8555-55555555555${index}`,
    });
    await service.drain(conversation.id);
  }

  assert.equal(calls[0].createIfMissing, true);
  assert.equal(calls[1].createIfMissing, false);
  assert.equal(calls[1].sessionName, calls[0].sessionName);
  assert.equal(calls[2].createIfMissing, true);
  assert.notEqual(calls[2].sessionName, calls[1].sessionName);
  assert.match(calls[2].sessionName, /-r2-/);
  assert.ok(calls[2].summary.includes('Ziele:'));
  assert.ok(calls[2].recentMessages.length <= 2);
  const rotated = store.getConversation(conversation.id);
  assert.equal(rotated.sessionName, calls[2].sessionName);
  assert.equal(rotated.sessionId, 'session-2');
  assert.equal(rotated.sessionMessageCount, 1);
});

test('failed rotation leaves the prior session identity untouched', async (t) => {
  let calls = 0;
  const { service, store } = fixture(
    t,
    {
      async send(input) {
        calls += 1;
        if (calls === 3)
          throw Object.assign(new Error('rotation failed'), { code: 'transport_failed' });
        return {
          text: `ok ${input.prompt}`,
          sessionName: input.sessionName,
          hermesSessionId: 'session-1',
          runId: input.runId,
        };
      },
    },
    { sessionRotateMessages: 2 }
  );
  const conversation = service.createConversation({});
  let lastRun;
  for (const [index, text] of ['eins', 'zwei', 'drei'].entries()) {
    lastRun = service.submitMessage({
      conversationId: conversation.id,
      text,
      clientMessageId: `66666666-6666-4666-8666-66666666666${index}`,
    });
    await service.drain(conversation.id);
  }
  assert.equal(service.getRun(lastRun.id).status, 'failed');
  const unchanged = store.getConversation(conversation.id);
  assert.equal(unchanged.sessionName, conversation.sessionName);
  assert.equal(unchanged.sessionId, 'session-1');
  assert.equal(unchanged.sessionMessageCount, 2);
});

test('processes a new turn after more than 205 stored messages and uses the latest user message', async (t) => {
  const { service, store, calls } = fixture(t);
  const conversation = service.createConversation({});
  for (let index = 0; index < 206; index += 1) {
    store.appendMessage({
      conversationId: conversation.id,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `stored-${index}`,
      createdAt: 1000 + index,
    });
  }
  const accepted = service.submitMessage({
    conversationId: conversation.id,
    text: 'latest-user-message',
    clientMessageId: '77777777-7777-4777-8777-777777777777',
  });
  await service.drain(conversation.id);

  const completed = service.getRun(accepted.id);
  assert.equal(completed.status, 'completed');
  assert.equal(calls.at(-1).prompt, 'latest-user-message');
  assert.equal(store.getMessageById(completed.userMessageId).content, 'latest-user-message');
  assert.equal(
    store.getMessageById(completed.assistantMessageId).content,
    'Antwort latest-user-message'
  );
});

test('two service instances serialize transports through the shared database claim', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-shared-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'assistant.db');
  const storeA = new AssistantStore({ database });
  const storeB = new AssistantStore({ database });
  storeA.initialize();
  storeB.initialize();
  const contextResolver = {
    resolve: () => ({
      objectType: 'global',
      objectId: null,
      payload: { safe: true },
      fingerprint: 'f'.repeat(64),
    }),
  };
  const config = {
    enabled: true,
    transport: { timeoutMs: 5000, runBudgetSeconds: 5 },
    limits: {
      maxMessageChars: 4000,
      recentMessageCount: 4,
      maxContextChars: 12000,
      sessionRotateMessages: 20,
    },
  };
  let active = 0;
  let maxActive = 0;
  const order = [];
  let releaseFirst;
  const firstReleased = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstStarted;
  const firstRunning = new Promise((resolve) => {
    firstStarted = resolve;
  });
  let releaseClaimWait;
  const claimWaitReleased = new Promise((resolve) => {
    releaseClaimWait = resolve;
  });
  let claimWaitStarted;
  const waitingForClaim = new Promise((resolve) => {
    claimWaitStarted = resolve;
  });
  const transport = async (input) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`start:${input.prompt}`);
    if (input.prompt === 'first') {
      firstStarted();
      await firstReleased;
    }
    order.push(`end:${input.prompt}`);
    active -= 1;
    return {
      text: `answer:${input.prompt}`,
      sessionName: input.sessionName,
      hermesSessionId: 'shared-session',
      runId: input.runId,
    };
  };
  const serviceA = createAssistantService({
    store: storeA,
    contextResolver,
    client: { send: transport },
    config,
    workerId: 'worker-a',
  });
  const serviceB = createAssistantService({
    store: storeB,
    contextResolver,
    client: { send: transport },
    config,
    workerId: 'worker-b',
    sleep: () => {
      claimWaitStarted();
      return claimWaitReleased;
    },
  });
  const conversation = serviceA.createConversation({});
  const first = serviceA.submitMessage({
    conversationId: conversation.id,
    text: 'first',
    clientMessageId: '88888888-8888-4888-8888-888888888881',
  });
  await firstRunning;
  const second = serviceB.submitMessage({
    conversationId: conversation.id,
    text: 'second',
    clientMessageId: '88888888-8888-4888-8888-888888888882',
  });
  await waitingForClaim;
  assert.deepEqual(order, ['start:first']);

  releaseFirst();
  await serviceA.drain(conversation.id);
  releaseClaimWait();
  await serviceB.drain(conversation.id);

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
  assert.equal(serviceA.getRun(first.id).status, 'completed');
  assert.equal(serviceB.getRun(second.id).status, 'completed');
});

test('claim wait is bounded and fails busy without invoking transport', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-busy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new AssistantStore({ database: path.join(root, 'assistant.db') });
  store.initialize();
  const conversation = store.createConversation({});
  const occupied = store.createRun({
    conversationId: conversation.id,
    text: 'occupied',
    clientMessageId: '99999999-9999-4999-8999-999999999991',
  }).run;
  store.claimRun(occupied.id, null, { owner: 'occupying-worker', leaseSeconds: 60 });
  let now = 0;
  let transportCalls = 0;
  const service = createAssistantService({
    store,
    contextResolver: {
      resolve: () => ({
        objectType: 'global',
        objectId: null,
        payload: { safe: true },
        fingerprint: 'f'.repeat(64),
      }),
    },
    client: {
      async send() {
        transportCalls += 1;
      },
    },
    config: {
      enabled: true,
      transport: { timeoutMs: 25, runBudgetSeconds: 10 },
      limits: {
        maxMessageChars: 4000,
        recentMessageCount: 4,
        maxContextChars: 12000,
        sessionRotateMessages: 20,
      },
    },
    nowMs: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    claimPollMs: 10,
  });
  const waiting = service.submitMessage({
    conversationId: conversation.id,
    text: 'waiting',
    clientMessageId: '99999999-9999-4999-8999-999999999992',
  });
  await service.drain(conversation.id);

  const failed = service.getRun(waiting.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'assistant_conversation_busy');
  assert.equal(transportCalls, 0);
  assert.ok(now <= 25);
});

test('atomic completion persists no assistant message when session CAS fails', async (t) => {
  let store;
  const { service, store: fixtureStore } = fixture(t, {
    async send(input) {
      store.advanceConversationSession({
        conversationId: store.getRun(input.runId).conversationId,
        expectedSessionName: input.sessionName,
        expectedSessionId: null,
        sessionName: input.sessionName,
        sessionId: 'intruding-session',
      });
      return {
        text: 'must-roll-back',
        sessionName: input.sessionName,
        hermesSessionId: 'transport-session',
        runId: input.runId,
      };
    },
  });
  store = fixtureStore;
  const conversation = service.createConversation({});
  const accepted = service.submitMessage({
    conversationId: conversation.id,
    text: 'trigger-cas',
    clientMessageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  await service.drain(conversation.id);

  assert.equal(service.getRun(accepted.id).status, 'failed');
  assert.deepEqual(
    store.listMessages(conversation.id).map((item) => item.role),
    ['user']
  );
});
