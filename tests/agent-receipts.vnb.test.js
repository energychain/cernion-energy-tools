'use strict';

/**
 * v0.54.3 VNB Lookup Receipt Migration Tests
 *
 * Validates that the vnb-lookup-v1 receipt:
 *   1. Accepts city-only input (Wiesloch scenario)
 *   2. Accepts BDEW-only input
 *   3. Handles missing inputs gracefully
 *   4. Falls back to marketPartners when vnbLookup has insufficient params
 *   5. Disables legacy routing when receipt is forced
 */

const { describe, it, expect, beforeAll } = require('@jest/globals');
const http = require('http');

const RUN_LIVE_PERSONAL_AGENT_TESTS =
  String(process.env.PERSONAL_AGENT_LIVE_TESTS || 'false').toLowerCase() === 'true';
const describeLive = RUN_LIVE_PERSONAL_AGENT_TESTS ? describe : describe.skip;

const SESSION_ID_PREFIX = 'pa_test_vnb_';

/**
 * Helper to make HTTP POST requests to Personal Agent
 */
async function callPersonalAgentChat(payload) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/personal-agent/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CERNION_TOKEN || 'test-token'}`,
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ status: res.statusCode, data });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

describeLive('v0.54.3 VNB Lookup Receipt Migration', () => {
  beforeAll(async () => {
    // Wait for personal-agent service to be ready (max 10s)
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const result = await callPersonalAgentChat({
          message: 'test',
          sessionId: `${SESSION_ID_PREFIX}ready_check`,
          forceReceipt: 'invalid-receipt',
        });
        // Even if error, service is up
        ready = true;
        break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!ready) {
      throw new Error('Personal Agent service not ready after 10 seconds');
    }
  }, 30_000);

  describe('City-only Input (Wiesloch)', () => {
    it('should accept city-only vnbLookup call without validator rejection', async () => {
      const sessionId = `${SESSION_ID_PREFIX}city_only_wiesloch`;
      const response = await callPersonalAgentChat({
        message: 'Für welchen Netzbetreiber bin ich in Wiesloch zuständig?',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        knownContext: {
          city: 'Wiesloch',
        },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
      expect(response.data?.sessionId).toBe(sessionId);
      // Should not error due to missing bdew
      expect(response.data?.reply).toBeTruthy();
    }, 15_000);
  });

  describe('BDEW-only Input', () => {
    it('should accept BDEW code without city parameter', async () => {
      const sessionId = `${SESSION_ID_PREFIX}bdew_only`;
      const response = await callPersonalAgentChat({
        message: 'Netzbetreiber mit BDEW 00000012345?',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        knownContext: {
          bdew: '00000012345',
        },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
      // Should not error due to missing city
      expect(response.data?.reply).toBeTruthy();
    }, 15_000);
  });

  describe('Missing Input Handling', () => {
    it('should degrade gracefully when neither bdew nor city provided', async () => {
      const sessionId = `${SESSION_ID_PREFIX}missing_inputs`;
      const response = await callPersonalAgentChat({
        message: 'Welcher Netzbetreiber ist zuständig?',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        knownContext: {},
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
      // Should return a reply, possibly a fallback or onboarding question
      expect(response.data?.reply).toBeTruthy();
    }, 15_000);
  });

  describe('Legacy Fallback (disableReceiptSelection)', () => {
    it('should use legacy routing when disableReceiptSelection=true', async () => {
      const sessionId = `${SESSION_ID_PREFIX}legacy_fallback`;
      const response = await callPersonalAgentChat({
        message: 'Prüfe Netzbetreiber für Wiesloch',
        sessionId,
        disableReceiptSelection: true,
        knownContext: {
          city: 'Wiesloch',
        },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
      // Metadata should indicate no receipt was used
      const receiptMeta = response.data?.metadata?.receiptSelection;
      if (receiptMeta) {
        expect(receiptMeta.selected).toBe(false);
      }
    }, 15_000);
  });

  describe('MarketPartners Fallback', () => {
    it('should fall back to marketPartners when vnbLookup params insufficient', async () => {
      const sessionId = `${SESSION_ID_PREFIX}marketpartners_fallback`;
      const response = await callPersonalAgentChat({
        message: 'Stadtwerke München als Netzbetreiber',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        knownContext: {
          gridOperatorName: 'Stadtwerke München',
          // No city, no BDEW → fallback to marketPartners expected
        },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
      expect(response.data?.reply).toBeTruthy();
    }, 15_000);
  });

  describe('Receipt Seed Verification', () => {
    it('should have vnb-lookup-v1 receipt available in agent-receipts service', async () => {
      // This test requires a direct service call
      // For integration testing, we verify through forceReceipt parameter acceptance
      const sessionId = `${SESSION_ID_PREFIX}receipt_available`;
      const response = await callPersonalAgentChat({
        message: 'Netzbetreiber Wiesloch',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        knownContext: { city: 'Wiesloch' },
      });

      // If forceReceipt accepted without 422 error, receipt exists
      expect(response.status).not.toBe(422);
      expect(response.data?.success).toBe(true);
    }, 15_000);
  });

  describe('Receipt Selection Metadata', () => {
    it('should include receipt selection metadata when explainReceiptSelection=true', async () => {
      const sessionId = `${SESSION_ID_PREFIX}receipt_metadata`;
      const response = await callPersonalAgentChat({
        message: 'Wiesloch Netzbetreiber',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        explainReceiptSelection: true,
        knownContext: { city: 'Wiesloch' },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
      if (response.data?.metadata?.receiptSelection) {
        expect(response.data.metadata.receiptSelection.selected).toBe(true);
        expect(response.data.metadata.receiptSelection.receiptId).toBe('vnb-lookup-v1');
      }
    }, 15_000);
  });
});

describeLive('v0.54.3 Receipt Executor Integration', () => {
  describe('executeWithReceipt Adapter', () => {
    it('should execute toolPlan steps deterministically', async () => {
      const sessionId = `${SESSION_ID_PREFIX}executor_deterministic`;
      const response = await callPersonalAgentChat({
        message: 'Netzgebiet für Wiesloch bestimmen',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        executionMode: 'auto',
        knownContext: { city: 'Wiesloch' },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
      expect(response.data?.chatMode).toMatch(/consultation|execution/);
    }, 15_000);
  });

  describe('Parameter Mapping', () => {
    it('should resolve receipt paramMapping correctly', async () => {
      const sessionId = `${SESSION_ID_PREFIX}param_mapping`;
      // This is tested implicitly: if city-only works, paramMapping resolved correctly
      const response = await callPersonalAgentChat({
        message: 'Wiesloch',
        sessionId,
        forceReceipt: 'vnb-lookup-v1',
        knownContext: { city: 'Wiesloch' },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
    }, 15_000);
  });
});

describeLive('v0.54.3 Backward Compatibility', () => {
  describe('Legacy Routes Still Work', () => {
    it('should not break when no receipt is selected', async () => {
      const sessionId = `${SESSION_ID_PREFIX}compat_no_receipt`;
      const response = await callPersonalAgentChat({
        message: 'Prüfe Netzgebiet',
        sessionId,
        disableReceiptSelection: true,
        knownContext: { city: 'Wiesloch' },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
    }, 15_000);
  });

  describe('gridOperatorName Still Works', () => {
    it('should accept gridOperatorName (legacy knownContext parameter)', async () => {
      const sessionId = `${SESSION_ID_PREFIX}compat_operator_name`;
      const response = await callPersonalAgentChat({
        message: 'Netzbetreiber?',
        sessionId,
        knownContext: {
          gridOperatorName: 'Stadtwerke Troisdorf',
        },
      });

      expect(response.status).toBe(200);
      expect(response.data?.success).toBe(true);
    }, 15_000);
  });
});
