'use strict';

const { checkExecuteReadPolicy } = require('../src/mcp-execute-read-policy');

describe('mcp-execute-read-policy (operation-capability-index-backed, v0.99.5)', () => {
  // Regression test for the exact real-world bug report: an MCP client
  // asked a CO2-intensity question, cernion_execute_read refused
  // energy-market.co2Intensity because it's POST and wasn't in the old
  // hand-curated allowlist, even though it's a genuine read (a body-based
  // query, not a mutation) already classified as such by
  // operation-capability-index.json.
  test('allows energy-market.co2Intensity (POST, data_read in the index)', () => {
    const result = checkExecuteReadPolicy('POST', '/api/energy-market/co2-intensity');
    expect(result).toEqual({ allowed: true });
  });

  test('allows other read-shaped POST endpoints across the platform, not just one hand-picked service', () => {
    // energy-market.prices — same "POST body, but a pure query" shape as
    // co2Intensity, previously blocked by the same gap.
    expect(checkExecuteReadPolicy('POST', '/api/energy-market/prices')).toEqual({ allowed: true });
  });

  // Regression test for a real bug found while investigating the report
  // above: the denylist targeted the wrong path (/token-manager instead of
  // the actual mounted /tokens), so token metadata was never actually
  // blocked despite that being the intent.
  test('denies GET /api/tokens even though the index classifies it as agentable data_read', () => {
    const result = checkExecuteReadPolicy('GET', '/api/tokens');
    expect(result).toEqual({ allowed: false, reason: 'ADMIN_SURFACE_NOT_EXPOSED' });
  });

  test.each([
    ['/api/auth/verify', 'POST'],
    ['/api/backup/export', 'GET'],
    ['/api/restore/import', 'POST'],
    ['/api/tenant-quotas/tenants/x', 'GET'],
    ['/api/system/admin/reload', 'POST'],
    ['/api/domain-routes/reload', 'POST'],
  ])('denies admin/secret surface %s %s regardless of method or index classification', (p, m) => {
    expect(checkExecuteReadPolicy(m, p)).toEqual({
      allowed: false,
      reason: 'ADMIN_SURFACE_NOT_EXPOSED',
    });
  });

  test('denies a genuine write operation found in the index (object_store_write)', () => {
    const result = checkExecuteReadPolicy('POST', '/api/copilot-process/intents');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/^NOT_READ_ONLY/);
  });

  // Safety-critical edge case: znp_deleteProject (DELETE, permanently
  // deletes a ZNP project) is misclassified as operationKind:advisory_plan
  // in the index — which would be execute_read-eligible under a naive
  // "advisory_plan is always safe" rule. It's correctly excluded here only
  // because recommendedExecutionMode is 'confirm', not 'explain_only' (see
  // isReadSafeIndexEntry's per-kind mode check). This test exists to catch
  // a regression if that per-kind check is ever simplified back to a
  // blanket operationKind allowlist.
  test('still denies znp deleteProject despite its advisory_plan misclassification in the index', () => {
    const result = checkExecuteReadPolicy('DELETE', '/api/znp/projects/p1');
    expect(result).toEqual({ allowed: false, reason: 'NOT_READ_ONLY' });
  });

  test('GET is allowed by convention even for a path not catalogued in the index', () => {
    expect(checkExecuteReadPolicy('GET', '/api/some-not-yet-catalogued-operation')).toEqual({
      allowed: true,
    });
  });

  test('the original small POST allowlist still works as a fallback', () => {
    expect(checkExecuteReadPolicy('POST', '/api/evidence-router/route')).toEqual({
      allowed: true,
    });
  });

  test('an uncatalogued, non-allowlisted POST is refused', () => {
    expect(checkExecuteReadPolicy('POST', '/api/some-not-yet-catalogued-write')).toEqual({
      allowed: false,
      reason: 'NOT_READ_ONLY',
    });
  });

  test('accepts a bare /api-relative path the same as a full path', () => {
    expect(checkExecuteReadPolicy('POST', '/energy-market/co2-intensity')).toEqual({
      allowed: true,
    });
  });

  describe('when the operation index is missing or unreadable', () => {
    test('falls back to the conservative GET/POST-allowlist rules without throwing', () => {
      jest.isolateModules(() => {
        jest.doMock('fs', () => ({
          readFileSync: () => {
            throw new Error('ENOENT: no such file');
          },
        }));

        const {
          checkExecuteReadPolicy: checkWithoutIndex,
        } = require('../src/mcp-execute-read-policy');

        // Still allowed — GET-by-convention, doesn't depend on the index.
        expect(checkWithoutIndex('GET', '/api/energy-market/co2-intensity')).toEqual({
          allowed: true,
        });
        // The exact bug this file fixes: without the index, a read-shaped
        // POST outside the small hand-curated allowlist is refused again —
        // demonstrates why the index matters, not just that the fallback
        // doesn't crash.
        expect(checkWithoutIndex('POST', '/api/energy-market/co2-intensity')).toEqual({
          allowed: false,
          reason: 'NOT_READ_ONLY',
        });
        // The denylist itself doesn't depend on the index at all.
        expect(checkWithoutIndex('GET', '/api/tokens')).toEqual({
          allowed: false,
          reason: 'ADMIN_SURFACE_NOT_EXPOSED',
        });

        jest.dontMock('fs');
      });
    });
  });
});
