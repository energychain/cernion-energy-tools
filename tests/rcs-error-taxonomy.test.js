'use strict';

const { RCS_ERROR_CODES, rcsError } = require('../src/rcs-errors');

// ── RCS_ERROR_CODES catalogue ─────────────────────────────────────────────────

describe('RCS_ERROR_CODES catalogue', () => {
  const expectedCodes = [
    'RCS_RULE_SET_NOT_FOUND',
    'RCS_MAX_ASSETS_EXCEEDED',
    'RCS_TRACE_PAYLOAD_TOO_LARGE',
    'RCS_ASSET_RESULT_NOT_FOUND',
    'RCS_RUN_NOT_FOUND',
    'RCS_TRACE_NOT_FOUND',
    'RCS_DRILLDOWN_FAILED',
    'RCS_TIMEFRAME_INVALID',
    'RCS_ASSET_NOT_IN_RUN',
    'RCS_READINESS_FAILED',
  ];

  test.each(expectedCodes)('%s is defined in RCS_ERROR_CODES', (code) => {
    expect(RCS_ERROR_CODES[code]).toBeDefined();
    expect(typeof RCS_ERROR_CODES[code].httpStatus).toBe('number');
    expect(typeof RCS_ERROR_CODES[code].description).toBe('string');
  });

  test('all entries have httpStatus within valid range', () => {
    for (const [, meta] of Object.entries(RCS_ERROR_CODES)) {
      expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
      expect(meta.httpStatus).toBeLessThan(600);
    }
  });
});

// ── rcsError factory ──────────────────────────────────────────────────────────

describe('rcsError factory', () => {
  test('creates a MoleculerClientError with correct type', () => {
    const err = rcsError('RCS_RUN_NOT_FOUND', 'Run not found.', { runId: 'run-abc' });
    expect(err.type).toBe('RCS_RUN_NOT_FOUND');
    expect(err.message).toBe('Run not found.');
    expect(err.code).toBe(404);
  });

  test('error.data contains the provided details', () => {
    const err = rcsError('RCS_MAX_ASSETS_EXCEEDED', 'Too many assets.', {
      assetCount: 600,
      maxAssets: 500,
    });
    expect(err.data).toMatchObject({ assetCount: 600, maxAssets: 500 });
  });

  test('404 error codes: correct HTTP status', () => {
    const notFoundCodes = [
      'RCS_RULE_SET_NOT_FOUND',
      'RCS_RUN_NOT_FOUND',
      'RCS_ASSET_RESULT_NOT_FOUND',
      'RCS_TRACE_NOT_FOUND',
      'RCS_ASSET_NOT_IN_RUN',
    ];
    for (const code of notFoundCodes) {
      const err = rcsError(code, 'not found');
      expect(err.code).toBe(404);
    }
  });

  test('400 error codes: correct HTTP status', () => {
    const badRequestCodes = [
      'RCS_MAX_ASSETS_EXCEEDED',
      'RCS_TRACE_PAYLOAD_TOO_LARGE',
      'RCS_TIMEFRAME_INVALID',
    ];
    for (const code of badRequestCodes) {
      const err = rcsError(code, 'bad request');
      expect(err.code).toBe(400);
    }
  });

  test('422 error code: RCS_DRILLDOWN_FAILED', () => {
    const err = rcsError('RCS_DRILLDOWN_FAILED', 'Drilldown failed.');
    expect(err.code).toBe(422);
  });

  test('500 error code: RCS_READINESS_FAILED', () => {
    const err = rcsError('RCS_READINESS_FAILED', 'Internal error.');
    expect(err.code).toBe(500);
  });

  test('unknown code falls back to HTTP 500', () => {
    const err = rcsError('UNKNOWN_CODE', 'Something broke.');
    expect(err.code).toBe(500);
    expect(err.type).toBe('UNKNOWN_CODE');
  });

  test('details default to empty object when omitted', () => {
    const err = rcsError('RCS_RUN_NOT_FOUND', 'msg');
    expect(err.data).toEqual({});
  });
});
