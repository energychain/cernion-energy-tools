'use strict';

function sanitize(value) {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitize(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, child]) => [key, sanitize(child)])
    );
  }
  if (typeof value === 'string') {
    return value.slice(0, 300);
  }
  return value;
}

class ExecutionTrace {
  constructor({ sessionId = null } = {}) {
    this.sessionId = sessionId;
    this.startedAt = Date.now();
    this.llmCalls = [];
    this.toolCalls = [];
    this.brokerDecisions = [];
    this.stateTransitions = [];
  }

  recordLLMCall({
    phase,
    latencyMs = null,
    model = null,
    provider = null,
    promptTokens = null,
    completionTokens = null,
    metadata = null,
  } = {}) {
    this.llmCalls.push({
      phase: phase || 'unknown',
      latencyMs,
      model,
      provider,
      promptTokens,
      completionTokens,
      metadata: sanitize(metadata),
    });
  }

  recordToolInvocation({
    phase = 'unknown',
    tool,
    params = null,
    success = null,
    latencyMs = null,
    retries = 0,
    result = null,
    error = null,
  } = {}) {
    this.toolCalls.push({
      phase,
      tool: tool || 'unknown',
      params: sanitize(params),
      success,
      latencyMs,
      retries,
      result: sanitize(result),
      error: error ? String(error).slice(0, 300) : null,
    });
  }

  recordBrokerDecision({
    intent = null,
    capability = null,
    confidence = null,
    scoringBreakdown = null,
    source = null,
  } = {}) {
    this.brokerDecisions.push({
      intent,
      capability,
      confidence,
      source,
      scoringBreakdown: sanitize(scoringBreakdown),
    });
  }

  recordStateTransition({
    family = 'execution',
    from = null,
    to = null,
    reason = null,
    metadata = null,
  } = {}) {
    this.stateTransitions.push({
      family,
      from,
      to,
      reason,
      metadata: sanitize(metadata),
    });
  }

  summarize(extra = {}) {
    return {
      sessionId: this.sessionId,
      totalMs: Date.now() - this.startedAt,
      llmCallCount: this.llmCalls.length,
      toolCallCount: this.toolCalls.length,
      llmCalls: this.llmCalls,
      toolCalls: this.toolCalls,
      brokerDecisions: this.brokerDecisions,
      stateTransitions: this.stateTransitions,
      ...sanitize(extra),
    };
  }
}

function createExecutionTrace(options = {}) {
  return new ExecutionTrace(options);
}

module.exports = {
  ExecutionTrace,
  createExecutionTrace,
};
