'use strict';

const { CHAT_MODES } = require('./personal-agent-routing');

const DEFAULT_EXECUTION_CONFIDENCE_THRESHOLD = Number(
  process.env.PERSONAL_AGENT_EXECUTION_CONFIDENCE_THRESHOLD || 0.6
);

function isGreetingLike(message = '') {
  const haystack = String(message || '').trim().toLowerCase();
  if (!haystack) return false;
  return /^(hallo|hi|hey|guten\s+(tag|morgen|abend)|moin)\b/.test(haystack);
}

function buildExecutionGap({ message, brokerRecommendation = {}, confidenceThreshold } = {}) {
  const brokerConfidence = Number(brokerRecommendation?.confidence || 0);
  if (!brokerRecommendation?.intent) {
    return {
      reason: 'no_broker_intent',
      confidence: brokerConfidence,
      threshold: confidenceThreshold,
      message: String(message || '').slice(0, 240),
    };
  }
  if (brokerConfidence < confidenceThreshold) {
    return {
      reason: 'low_confidence_broker',
      confidence: brokerConfidence,
      threshold: confidenceThreshold,
      intent: brokerRecommendation.intent,
      capability: brokerRecommendation.capability || null,
      message: String(message || '').slice(0, 240),
    };
  }
  return {
    reason: 'unsupported_execution_route',
    confidence: brokerConfidence,
    threshold: confidenceThreshold,
    intent: brokerRecommendation.intent,
    capability: brokerRecommendation.capability || null,
    message: String(message || '').slice(0, 240),
  };
}

function decideRoutingTarget({
  effectiveChatMode,
  brokerRecommendation = {},
  message = '',
  chatModeSource = null,
  confidenceThreshold = DEFAULT_EXECUTION_CONFIDENCE_THRESHOLD,
} = {}) {
  const brokerConfidence = Number(brokerRecommendation?.confidence || 0);
  const greetingLike = isGreetingLike(message);

  if (greetingLike && effectiveChatMode !== CHAT_MODES.EXECUTION) {
    return {
      source: 'classify_intent',
      target: 'consultation_intro',
      label: 'Greeting/intro routed to consultation',
      confidence: 1,
      determinism: 'deterministic',
      chatMode: CHAT_MODES.CONSULTATION,
      chatModeSource,
      gap: null,
    };
  }

  if (effectiveChatMode === CHAT_MODES.CONSULTATION) {
    return {
      source: 'classify_intent',
      target: 'consultation_node',
      label: 'Consultation path',
      confidence: chatModeSource === 'api' ? 1 : Math.max(0.6, brokerConfidence || 0.6),
      determinism: chatModeSource === 'api' ? 'deterministic' : 'heuristic',
      chatMode: CHAT_MODES.CONSULTATION,
      chatModeSource,
      gap: null,
    };
  }

  if (effectiveChatMode === CHAT_MODES.EXECUTION && brokerConfidence >= confidenceThreshold) {
    return {
      source: 'classify_intent',
      target: 'execution_node',
      label: 'Execution path',
      confidence: brokerConfidence,
      determinism: chatModeSource === 'api' ? 'deterministic' : 'heuristic',
      chatMode: CHAT_MODES.EXECUTION,
      chatModeSource,
      gap: null,
    };
  }

  return {
    source: 'classify_intent',
    target: 'mark_unknown_execution_gap',
    label: 'Execution blocked by routing gap',
    confidence: brokerConfidence,
    determinism: 'heuristic',
    chatMode: effectiveChatMode || CHAT_MODES.CONSULTATION,
    chatModeSource,
    gap: buildExecutionGap({
      message,
      brokerRecommendation,
      confidenceThreshold,
    }),
  };
}

module.exports = {
  DEFAULT_EXECUTION_CONFIDENCE_THRESHOLD,
  isGreetingLike,
  buildExecutionGap,
  decideRoutingTarget,
};
