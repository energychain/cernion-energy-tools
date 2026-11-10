'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  LOOP_MARKER_PREFIX,
  createAssistantMatrixHandoffAdapter,
} = require('../lib/assistant-matrix-handoff');

function safeContext(roomRef = '!publicroom:matrix.example.org', overrides = {}) {
  return {
    objectType: 'topic',
    objectId: 'topic_2026_001',
    payload: {
      topicId: 'topic_2026_001',
      title: 'Safe operating topic',
      references: { matrixRoom: { roomRef } },
      ...overrides,
    },
    fingerprint: 'safe-server-fingerprint',
  };
}

function handoff(overrides = {}) {
  return {
    handoffId: 'handoff_2026_001',
    topicId: 'topic_2026_001',
    decisionId: 'decision_2026_001',
    sourceId: 'assistant_conversation_001',
    text: 'Please review the documented decision.',
    context: safeContext(),
    ...overrides,
  };
}

function successfulAdapter(calls) {
  return createAssistantMatrixHandoffAdapter({
    async sender(request) {
      calls.push({ type: 'send', request });
      return { eventId: '$event-001' };
    },
    async readback(request) {
      calls.push({ type: 'read', request });
      return {
        eventId: request.eventId,
        content: { body: `Stored\n${request.loopMarker}` },
      };
    },
  });
}

test('delivers to the safe server context room and writes trace and loop identifiers', async () => {
  const calls = [];
  const result = await successfulAdapter(calls).deliver(
    handoff({ roomRef: '!forged-browser-room:evil.example' })
  );

  assert.equal(result.status, 'delivered');
  assert.equal(result.roomRef, '!publicroom:matrix.example.org');
  assert.equal(result.eventId, '$event-001');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].request.roomRef, '!publicroom:matrix.example.org');
  const body = calls[0].request.content.body;
  assert.match(body, /Topic ID: topic_2026_001/);
  assert.match(body, /Decision ID: decision_2026_001/);
  assert.match(body, /Source ID: assistant_conversation_001/);
  assert.match(body, /Handoff ID: handoff_2026_001/);
  assert.match(body, new RegExp(`Loop marker: ${LOOP_MARKER_PREFIX}:handoff_2026_001`));
  assert.equal(calls[0].request.content['m.mentions'], undefined);
});

test('delivers a topic-only handoff and requires at least one context identifier', async () => {
  const calls = [];
  const delivered = await successfulAdapter(calls).deliver(
    handoff({ handoffId: 'handoff_topic_only', decisionId: null })
  );
  assert.equal(delivered.status, 'delivered');
  assert.match(calls[0].request.content.body, /Topic ID: topic_2026_001/);
  assert.doesNotMatch(calls[0].request.content.body, /Decision ID:/);

  const denied = await successfulAdapter([]).deliver(
    handoff({ handoffId: 'handoff_without_context', topicId: null, decisionId: null })
  );
  assert.equal(denied.status, 'pending');
  assert.equal(denied.error, 'matrix_context_not_available');
});

test('requires the nested server-provided room reference and never accepts a free room id', async () => {
  let sends = 0;
  const adapter = createAssistantMatrixHandoffAdapter({
    sender: async () => {
      sends += 1;
      return '$event';
    },
    readback: async () => ({}),
  });
  for (const [index, input] of [
    handoff({ context: { payload: {} }, roomRef: '!browserroom:matrix.example.org' }),
    handoff({
      context: safeContext('not-a-room'),
      matrixRoomId: '!browserroom:matrix.example.org',
    }),
  ].entries()) {
    const result = await adapter.deliver({ ...input, handoffId: `${input.handoffId}_${index}` });
    assert.equal(result.status, 'pending');
    assert.equal(result.error, 'matrix_room_not_available');
  }
  assert.equal(sends, 0);
});

test('fails closed for TWL, private, unclear and mixed-sensitive context', async () => {
  let sends = 0;
  const adapter = createAssistantMatrixHandoffAdapter({
    sender: async () => {
      sends += 1;
      return '$event';
    },
    readback: async () => ({}),
  });
  const markers = ['T W L Netze', 'private lane', 'unclear', 'mixed_sensitive'];
  for (const [index, marker] of markers.entries()) {
    const result = await adapter.deliver(
      handoff({
        handoffId: `handoff_blocked_${index}`,
        context: safeContext(undefined, { title: marker }),
      })
    );
    assert.equal(result.status, 'pending');
    assert.equal(result.error, 'sensitive_handoff_forbidden');
  }
  assert.equal(sends, 0);
});

test('forbids user and room mentions instead of emitting Matrix mention metadata', async () => {
  let sends = 0;
  const adapter = createAssistantMatrixHandoffAdapter({
    sender: async () => {
      sends += 1;
      return '$event';
    },
    readback: async () => ({}),
  });
  for (const [index, text] of [
    '@alice:matrix.example.org please review',
    'Ping @room now',
    'See https://matrix.to/#/@alice:matrix.example.org',
  ].entries()) {
    const result = await adapter.deliver(handoff({ handoffId: `handoff_mention_${index}`, text }));
    assert.equal(result.status, 'pending');
    assert.equal(result.error, 'matrix_mentions_forbidden');
  }
  assert.equal(sends, 0);
});

test('deduplicates concurrent and later delivery by handoff id', async () => {
  let sends = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const adapter = createAssistantMatrixHandoffAdapter({
    sender: async () => {
      sends += 1;
      await gate;
      return { event_id: '$event-deduped' };
    },
    readback: async ({ eventId, loopMarker }) => ({
      event_id: eventId,
      content: { body: loopMarker },
    }),
  });
  const first = adapter.deliver(handoff());
  const duplicate = adapter.deliver(handoff({ text: 'A different duplicate body.' }));
  release();
  const [left, right] = await Promise.all([first, duplicate]);
  const later = await adapter.deliver(handoff());
  assert.equal(sends, 1);
  assert.deepEqual(left, right);
  assert.deepEqual(left, later);
});

test('returns pending delivery status when sending fails and deduplicates the failure', async () => {
  let sends = 0;
  const adapter = createAssistantMatrixHandoffAdapter({
    sender: async () => {
      sends += 1;
      throw new Error('matrix_unavailable');
    },
    readback: async () => {
      throw new Error('must_not_read');
    },
  });
  const result = await adapter.deliver(handoff());
  const duplicate = await adapter.deliver(handoff());
  assert.equal(result.status, 'pending');
  assert.equal(result.error, 'matrix_delivery_failed');
  assert.equal(result.handoffId, 'handoff_2026_001');
  assert.equal(result.loopMarker, `${LOOP_MARKER_PREFIX}:handoff_2026_001`);
  assert.deepEqual(duplicate, result);
  assert.equal(sends, 1);
});

test('requires successful readback before marking a handoff delivered', async () => {
  const adapter = createAssistantMatrixHandoffAdapter({
    sender: async () => ({ eventId: '$event-not-observed' }),
    readback: async () => ({
      eventId: '$different-event',
      content: { body: 'No matching loop marker' },
    }),
  });
  const result = await adapter.deliver(handoff());
  assert.equal(result.status, 'pending');
  assert.equal(result.error, 'matrix_readback_mismatch');
});

test('requires injected Matrix sender and readback dependencies', () => {
  assert.throws(() => createAssistantMatrixHandoffAdapter(), /matrix_sender_required/);
  assert.throws(
    () => createAssistantMatrixHandoffAdapter({ sender: async () => ({}) }),
    /matrix_readback_required/
  );
});
