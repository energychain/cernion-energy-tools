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
    return value.slice(0, 240);
  }
  return value;
}

class ToolCallTracker {
  constructor({ sessionId = null } = {}) {
    this.sessionId = sessionId;
    this.calls = [];
  }

  record({ phase = 'unknown', tool, params = null, success = null, retries = 0, backoffMs = [], result = null, error = null } = {}) {
    this.calls.push({
      phase,
      tool: tool || 'unknown',
      params: sanitize(params),
      success,
      retries,
      backoffMs: Array.isArray(backoffMs) ? backoffMs.slice(0, 5) : [],
      result: sanitize(result),
      error: error ? String(error).slice(0, 300) : null,
      at: new Date().toISOString(),
    });
  }

  summarize() {
    return {
      sessionId: this.sessionId,
      count: this.calls.length,
      calls: this.calls,
    };
  }
}

function createToolCallTracker(options = {}) {
  return new ToolCallTracker(options);
}

module.exports = {
  ToolCallTracker,
  createToolCallTracker,
};
