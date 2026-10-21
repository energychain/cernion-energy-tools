'use strict';

class ScriptError extends Error {
  constructor(code, message, node, details = {}) {
    super(message);
    this.name = 'ScriptError';
    this.code = `CET_SCRIPT_${code}`;
    this.type = this.code;
    this.line = node?.loc?.start.line || 1;
    this.column = node?.loc?.start.column || 0;
    this.details = details;
    this.hasLocation = Boolean(node?.loc);
    this.fatal = code !== 'RUNTIME_ERROR';
  }
}
function fail(code, message, node, details) {
  throw new ScriptError(code, message, node, details);
}
module.exports = { ScriptError, fail };
