'use strict';

const crypto = require('node:crypto');

const ROOM_REF_PATTERN = /^![^\s:]{6,}:[a-z0-9.-]+$/i;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_.:-]{2,127}$/i;
const LOOP_MARKER_PREFIX = 'ASSISTANT_MATRIX_HANDOFF';

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase();
}

function isSensitive(value) {
  const text = normalizedText(value);
  const collapsed = text.replace(/[^a-z0-9äöüß]+/g, '');
  return (
    /(?:^|[^a-z])(?:private|secret|restricted)(?:[^a-z]|$)/u.test(text) ||
    /mixed[\W_]*sensitive|raw[\W_]*bridge|private[\W_]*(?:board|lane|room|quarantine|metadata|id)/u.test(
      text
    ) ||
    collapsed.includes('twlnetze') ||
    collapsed.includes('unclear') ||
    /(?:^|[^a-z])t\W*w\W*l(?:[^a-z]|$)/u.test(text) ||
    /\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|bearer|password|cookie|session[_-]?(?:id|token))\b\s*[:=/]/u.test(
      text
    )
  );
}

function containsSensitiveValue(value, key = '') {
  if (isSensitive(key)) return true;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveValue(item, key));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([childKey, child]) =>
      containsSensitiveValue(child, childKey)
    );
  }
  return typeof value === 'string' && isSensitive(value);
}

function hasMention(value) {
  const text = String(value || '');
  return (
    /(^|\s)@[\p{L}\p{N}._=-]+(?::[a-z0-9.-]+)?\b/iu.test(text) ||
    /https?:\/\/matrix\.to\/#\/@/iu.test(text) ||
    /\b(?:m\.mentions|mentioned_user_ids|room_mention)\b/iu.test(text)
  );
}

function requireIdentifier(name, value) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value) || isSensitive(value)) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

function optionalIdentifier(name, value) {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentifier(name, value);
}

function roomRefFromContext(context) {
  const roomRef = context?.payload?.references?.matrixRoom?.roomRef;
  if (typeof roomRef !== 'string' || !ROOM_REF_PATTERN.test(roomRef) || isSensitive(roomRef)) {
    throw new Error('matrix_room_not_available');
  }
  return roomRef;
}

function handoffBody({ handoffId, topicId, decisionId, sourceId, text }) {
  const loopMarker = `${LOOP_MARKER_PREFIX}:${handoffId}`;
  return {
    body: [
      'Assistant handoff',
      ...(topicId ? [`Topic ID: ${topicId}`] : []),
      ...(decisionId ? [`Decision ID: ${decisionId}`] : []),
      `Source ID: ${sourceId}`,
      `Handoff ID: ${handoffId}`,
      `Loop marker: ${loopMarker}`,
      '',
      text,
    ].join('\n'),
    loopMarker,
  };
}

function eventIdFrom(result) {
  if (typeof result === 'string' && result) return result;
  if (result && typeof result.eventId === 'string' && result.eventId) return result.eventId;
  if (result && typeof result.event_id === 'string' && result.event_id) return result.event_id;
  throw new Error('matrix_send_missing_event_id');
}

function readbackMatches(result, expected) {
  const event = result?.event || result;
  if (!event || typeof event !== 'object') return false;
  const eventId = event.eventId || event.event_id;
  const body = event.body || event.content?.body;
  return (
    eventId === expected.eventId &&
    (!event.room_id || event.room_id === expected.roomRef) &&
    typeof body === 'string' &&
    body
      .split(/\r?\n/)
      .some(
        (line) => line === expected.loopMarker || line === `Loop marker: ${expected.loopMarker}`
      )
  );
}

function createAssistantMatrixHandoffAdapter(options = {}) {
  const sender = options.sender || options.sendMatrix;
  const readback = options.readback || options.readMatrix;
  if (typeof sender !== 'function') throw new Error('matrix_sender_required');
  if (typeof readback !== 'function') throw new Error('matrix_readback_required');

  const handoffs = new Map();
  const reportableErrors = new Set([
    'matrix_room_not_available',
    'matrix_context_not_available',
    'handoff_text_required',
    'sensitive_handoff_forbidden',
    'matrix_mentions_forbidden',
    'matrix_send_missing_event_id',
    'matrix_readback_mismatch',
  ]);

  async function deliver(input = {}) {
    const handoffId = requireIdentifier('handoff_id', input.handoffId);
    if (handoffs.has(handoffId)) return handoffs.get(handoffId);

    const operation = (async () => {
      let roomRef;
      let topicId;
      let decisionId;
      let sourceId;
      let loopMarker;
      try {
        roomRef = roomRefFromContext(input.context);
        topicId = optionalIdentifier('topic_id', input.topicId);
        decisionId = optionalIdentifier('decision_id', input.decisionId);
        if (!topicId && !decisionId) throw new Error('matrix_context_not_available');
        sourceId = requireIdentifier('source_id', input.sourceId);
        const text = String(input.text || '').trim();
        if (!text) throw new Error('handoff_text_required');
        if (
          containsSensitiveValue({ context: input.context, topicId, decisionId, sourceId, text })
        ) {
          throw new Error('sensitive_handoff_forbidden');
        }
        if (hasMention(text)) throw new Error('matrix_mentions_forbidden');

        const content = handoffBody({ handoffId, topicId, decisionId, sourceId, text });
        loopMarker = content.loopMarker;
        const transactionId = crypto
          .createHash('sha256')
          .update(`assistant:${handoffId}`)
          .digest('hex');
        const sent = await sender({
          roomRef,
          content: {
            msgtype: 'm.text',
            body: content.body,
          },
          handoffId,
          loopMarker,
          transactionId,
        });
        const eventId = eventIdFrom(sent);
        const observed = await readback({ roomRef, eventId, handoffId, loopMarker });
        if (!readbackMatches(observed, { eventId, loopMarker, roomRef })) {
          throw new Error('matrix_readback_mismatch');
        }
        return {
          status: 'delivered',
          handoffId,
          topicId,
          decisionId,
          sourceId,
          roomRef,
          eventId,
          loopMarker,
        };
      } catch (error) {
        return {
          status: 'pending',
          handoffId,
          topicId: topicId || null,
          decisionId: decisionId || null,
          sourceId: sourceId || null,
          roomRef: roomRef || null,
          loopMarker: loopMarker || `${LOOP_MARKER_PREFIX}:${handoffId}`,
          error: reportableErrors.has(error?.message) ? error.message : 'matrix_delivery_failed',
        };
      }
    })();

    handoffs.set(handoffId, operation);
    const result = await operation;
    if (result.status === 'delivered') handoffs.set(handoffId, Promise.resolve(result));
    else handoffs.delete(handoffId);
    return result;
  }

  async function reconcile(input = {}) {
    // Lookup must be authoritative and keyed by our deterministic transaction. Never send here.
    if (typeof options.findByTransaction !== 'function')
      return { status: 'pending', error: 'matrix_lookup_unavailable' };
    const handoffId = requireIdentifier('handoff_id', input.handoffId);
    const roomRef = roomRefFromContext(input.context);
    const loopMarker = `${LOOP_MARKER_PREFIX}:${handoffId}`;
    const transactionId = crypto
      .createHash('sha256')
      .update(`assistant:${handoffId}`)
      .digest('hex');
    const located = await options.findByTransaction({
      roomRef,
      transactionId,
      handoffId,
      loopMarker,
    });
    if (!located) return { status: 'pending', error: 'matrix_event_not_found' };
    const eventId = eventIdFrom(located);
    const observed = await readback({ roomRef, eventId, handoffId, loopMarker });
    if (!readbackMatches(observed, { roomRef, eventId, loopMarker }))
      return { status: 'pending', error: 'matrix_readback_mismatch' };
    return {
      status: 'delivered',
      verified: true,
      handoffId,
      roomRef,
      eventId,
      loopMarker,
      transactionId,
    };
  }
  return { deliver, reconcile };
}

module.exports = {
  LOOP_MARKER_PREFIX,
  createAssistantMatrixHandoffAdapter,
  createAssistantMatrixHandoff: createAssistantMatrixHandoffAdapter,
};
