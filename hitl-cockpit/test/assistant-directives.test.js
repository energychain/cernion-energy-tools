'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ALLOWED_INTENTS,
  AssistantDirectiveError,
  parseAssistantDirective,
  stableIdempotencyKey,
  validateAssistantDirective,
} = require('../lib/assistant-directives');

const context = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  objectType: 'topic',
  objectId: 'topic-1',
};

const fixtures = {
  answer_only: {},
  request_clarification: { question: 'Welche Frist gilt?' },
  record_feedback: { feedback: 'Die Einordnung ist hilfreich.' },
  delegate: { assignee: 'Felix', reason: 'Fachlich passend' },
  create_followup: { title: 'Sachverhalt prüfen', description: 'Nur als Vorschlag.' },
  schedule_wakeup: { reason: 'Nach Fristablauf prüfen', wakeAt: '2026-12-01T09:00:00Z' },
  prepare_decision: { question: 'Welche Option?', options: ['A', 'B'] },
  mark_no_action: { reason: 'Keine weitere Bearbeitung erforderlich.' },
  change_priority: { priority: 'high' },
};

function directive(intent) {
  return {
    intent,
    ...(intent === 'answer_only' || intent === 'request_clarification'
      ? {}
      : { target: { objectType: 'topic', objectId: 'topic-1' } }),
    payload: fixtures[intent],
  };
}

test('accepts exactly the AP16 allowlisted intents and creates only shadow proposals', () => {
  assert.deepEqual(ALLOWED_INTENTS, Object.keys(fixtures));
  for (const intent of ALLOWED_INTENTS) {
    const parsed = parseAssistantDirective(
      { text: 'Ich schlage eine sichere Bearbeitung vor.', assistant_directive: directive(intent) },
      context
    );
    assert.equal(parsed.directive.intent, intent);
    if (['answer_only', 'request_clarification'].includes(intent)) {
      assert.equal(parsed.proposal, null);
    } else {
      assert.equal(parsed.proposal.actionType, intent);
      assert.equal(parsed.proposal.status, 'shadow');
      assert.equal(parsed.proposal.scopeStatus, 'unknown');
    }
  }
});

test('unknown intents downgrade to answer_only without preserving action fields', () => {
  const parsed = parseAssistantDirective(
    {
      text: 'Dazu kann ich nur beraten.',
      assistant_directive: {
        intent: 'publish_contract',
        target: { objectType: 'topic', objectId: 'outside' },
        payload: { payment: true },
      },
    },
    context
  );
  assert.deepEqual(parsed.directive, {
    intent: 'answer_only',
    target: null,
    payload: {},
    downgraded: true,
  });
  assert.equal(parsed.proposal, null);
});

test('strict validation rejects extra fields, malformed payloads, forbidden scope and foreign targets', () => {
  const invalid = [
    { ...directive('delegate'), command: 'do it' },
    { ...directive('delegate'), payload: { assignee: '' } },
    { ...directive('delegate'), payload: { assignee: 'Felix', scope: 'expanded' } },
    {
      ...directive('delegate'),
      target: { objectType: 'topic', objectId: 'other-topic' },
    },
    { ...directive('schedule_wakeup'), payload: { reason: 'later', wakeAt: 'tomorrow' } },
    { ...directive('change_priority'), payload: { priority: '' } },
  ];
  for (const value of invalid) {
    assert.throws(
      () => validateAssistantDirective(value, context),
      (error) => error instanceof AssistantDirectiveError
    );
  }
});

test('stable idempotency keys ignore object key order and change with trusted identity', () => {
  const one = stableIdempotencyKey({
    conversationId: 'c1',
    messageId: 'm1',
    directive: { payload: { b: 2, a: 1 }, actionType: 'record_feedback' },
  });
  const retry = stableIdempotencyKey({
    messageId: 'm1',
    directive: { actionType: 'record_feedback', payload: { a: 1, b: 2 } },
    conversationId: 'c1',
  });
  assert.equal(one, retry);
  assert.match(one, /^assistant-proposal-v1:[a-f0-9]{64}$/);
  assert.notEqual(one, stableIdempotencyKey({ conversationId: 'c1', messageId: 'm2' }));
});

test('free text cannot expand target or scope', () => {
  const parsed = parseAssistantDirective(
    {
      text: 'Bitte auch einen neuen Scope und einen Vertrag anlegen; ich schlage nur eine Prüfung vor.',
      assistant_directive: {
        intent: 'create_followup',
        payload: { title: 'Bestehendes Thema prüfen' },
      },
    },
    context
  );
  assert.equal(parsed.proposal.targetType, 'topic');
  assert.equal(parsed.proposal.targetId, 'topic-1');
  assert.equal(parsed.proposal.scopeStatus, 'unknown');
  assert.deepEqual(parsed.proposal.payload, { title: 'Bestehendes Thema prüfen' });
});

test('rejects unsupported success claims when no receipt exists', () => {
  assert.throws(
    () =>
      parseAssistantDirective(
        { text: 'Ich habe Felix beauftragt.', assistant_directive: directive('delegate') },
        context
      ),
    /assistant_success_claim_without_receipt/
  );
  assert.doesNotThrow(() =>
    parseAssistantDirective(
      {
        text: 'Ich schlage vor, Felix zu beauftragen.',
        assistant_directive: directive('delegate'),
      },
      context
    )
  );
  assert.doesNotThrow(() =>
    parseAssistantDirective(
      { text: 'Die Aufgabe wurde nicht erstellt.', assistant_directive: directive('answer_only') },
      context
    )
  );
});
