'use strict';

const { MoleculerClientError } = require('moleculer').Errors;

/**
 * Centralized RCS error taxonomy (v0.60.7 WP8).
 * All UI-visible and API-client-visible RCS error codes are defined here.
 * Error shapes always carry: type (errorCode), message, data (details).
 */

const RCS_ERROR_CODES = {
  // Rule catalog
  RCS_RULE_SET_NOT_FOUND: {
    httpStatus: 404,
    description: 'Referenced rule set does not exist in the registry.',
  },
  // Portfolio limits
  RCS_MAX_ASSETS_EXCEEDED: {
    httpStatus: 400,
    description: 'Portfolio exceeds the configured asset limit.',
  },
  // Trace governance
  RCS_TRACE_PAYLOAD_TOO_LARGE: {
    httpStatus: 400,
    description: 'traceMode full rejected: payload would be too large.',
  },
  // Run / asset persistence
  RCS_RUN_NOT_FOUND: { httpStatus: 404, description: 'Referenced simulation run does not exist.' },
  RCS_ASSET_RESULT_NOT_FOUND: {
    httpStatus: 404,
    description: 'Per-asset result not found for the given run.',
  },
  RCS_ASSET_NOT_IN_RUN: {
    httpStatus: 404,
    description: 'The requested asset was not part of the original run.',
  },
  // Drilldown
  RCS_TRACE_NOT_FOUND: {
    httpStatus: 404,
    description:
      'No persisted trace exists for this asset + run combination. Use POST .../drilldown to compute one.',
  },
  RCS_DRILLDOWN_FAILED: { httpStatus: 422, description: 'Drilldown computation failed.' },
  // Input validation
  RCS_TIMEFRAME_INVALID: {
    httpStatus: 400,
    description: 'Timeframe start/end is invalid or start >= end.',
  },
  // Readiness
  RCS_READINESS_FAILED: {
    httpStatus: 500,
    description: 'Readiness aggregation failed unexpectedly.',
  },
};

/**
 * Create a structured MoleculerClientError with a stable RCS error code.
 * @param {string} code  — one of RCS_ERROR_CODES keys
 * @param {string} message — human-readable message
 * @param {object} [details] — additional context (included in error.data)
 */
function rcsError(code, message, details = {}) {
  const meta = RCS_ERROR_CODES[code] ?? { httpStatus: 500 };
  return new MoleculerClientError(message, meta.httpStatus, code, details);
}

module.exports = { RCS_ERROR_CODES, rcsError };
