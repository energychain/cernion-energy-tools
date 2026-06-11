/**
 * Copilot OpenAPI Subset Tests
 *
 * Verifies that openapi-copilot.json contains exactly the allowlisted
 * operations and that explicitly blocked operations are absent.
 *
 * Run after: npm run export:openapi:copilot
 */

const copilotSpec = require('../openapi-copilot.json');
const copilotPlugin = require('../docs/copilot-plugin.json');
const { allowlist, blocklist } = require('../config/copilot-operations.json');

// ── Build index of operationIds in the Copilot spec ──────────────────────────

function extractSpecOperations(spec) {
  const ops = new Map(); // operationId → { method, path, operation }
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      const oid = operation.operationId;
      if (oid) ops.set(oid, { method, path, operation });
    }
  }
  return ops;
}

const specOps = extractSpecOperations(copilotSpec);
const specIds = new Set(specOps.keys());
const allowedIds = new Set(allowlist.map((e) => e.operationId));
const allowlistMap = new Map(allowlist.map((e) => [e.operationId, e]));
const pluginFunctionNames = new Set(copilotPlugin.functions.map((f) => f.name));
const pluginRunForFunctions = new Set(copilotPlugin.runtimes[0].run_for_functions);

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Copilot OpenAPI subset (openapi-copilot.json)', () => {
  // ── Allowlist integrity ─────────────────────────────────────────────────────
  describe('allowlist integrity', () => {
    it('contains only allowlisted operationIds', () => {
      for (const id of specIds) {
        expect(allowedIds.has(id)).toBe(true);
      }
    });

    it('all allowlisted operationIds are present in spec', () => {
      for (const id of allowedIds) {
        expect(specIds.has(id)).toBe(true);
      }
    });

    it('contains searchCernionData', () => {
      expect(specIds.has('searchCernionData')).toBe(true);
    });

    it('spec path count is less than full export', () => {
      expect(Object.keys(copilotSpec.paths).length).toBeLessThan(200);
    });

    it('has x-copilot-subset marker', () => {
      expect(copilotSpec['x-copilot-subset']).toBe(true);
    });
  });

  // ── Blocklist: explicitly blocked operations must NOT be present ─────────────
  describe('blocklist — blocked operations absent', () => {
    const criticalBlocked = [
      'znp_deleteProject',
      'vdmi-evidence_sign',
      'vdmi-human-override_override',
      'vdmi-human-override_revert',
      'vdmi_confirmNomination',
      'vdmi_nominate',
      'vdmi_revert',
    ];

    for (const id of criticalBlocked) {
      it(`does not contain blocked operation: ${id}`, () => {
        expect(specIds.has(id)).toBe(false);
      });
    }

    it('does not contain any blocklist operation', () => {
      const blockIds = new Set(blocklist.map((e) => e.operationId));
      for (const id of specIds) {
        expect(blockIds.has(id)).toBe(false);
      }
    });
  });

  // ── x-openai-isConsequential correctness ────────────────────────────────────
  describe('x-openai-isConsequential correctness', () => {
    it('read-mode operations have x-openai-isConsequential: false', () => {
      for (const entry of allowlist.filter((e) => e.mode === 'read')) {
        const specOp = specOps.get(entry.operationId);
        if (!specOp) continue;
        expect(specOp.operation['x-openai-isConsequential']).toBe(false);
      }
    });

    it('draft-mode operations have x-openai-isConsequential: false', () => {
      for (const entry of allowlist.filter((e) => e.mode === 'draft')) {
        const specOp = specOps.get(entry.operationId);
        if (!specOp) continue;
        expect(specOp.operation['x-openai-isConsequential']).toBe(false);
      }
    });

    it('prepare-mode operations have x-openai-isConsequential: true', () => {
      for (const entry of allowlist.filter((e) => e.mode === 'prepare')) {
        const specOp = specOps.get(entry.operationId);
        if (!specOp) continue;
        expect(specOp.operation['x-openai-isConsequential']).toBe(true);
      }
    });

    it('all operations have x-openai-isConsequential defined', () => {
      for (const [oid, { operation }] of specOps.entries()) {
        expect(operation).toHaveProperty('x-openai-isConsequential');
        expect(typeof operation['x-openai-isConsequential']).toBe('boolean');
      }
    });
  });

  // ── Plugin manifest consistency ──────────────────────────────────────────────
  describe('plugin manifest consistency', () => {
    it('all functions in copilot-plugin.json run_for_functions exist in spec', () => {
      for (const fnId of pluginRunForFunctions) {
        expect(specIds.has(fnId)).toBe(true);
      }
    });

    it('all functions[] in copilot-plugin.json exist in spec', () => {
      for (const fnName of pluginFunctionNames) {
        expect(specIds.has(fnName)).toBe(true);
      }
    });

    it('run_for_functions covers all spec operations', () => {
      for (const id of specIds) {
        expect(pluginRunForFunctions.has(id)).toBe(true);
      }
    });

    it('plugin spec.url references openapi-copilot.json not openapi.json', () => {
      const specUrl = copilotPlugin.runtimes[0].spec.url;
      expect(specUrl).toContain('openapi-copilot.json');
      expect(specUrl).not.toBe('TODO_REPLACE_WITH_DEPLOYMENT_URL/api/openapi.json');
    });

    it('plugin schema_version is v2.4', () => {
      expect(copilotPlugin.schema_version).toBe('v2.4');
    });

    it('each function in functions[] has a name and description', () => {
      for (const fn of copilotPlugin.functions) {
        expect(typeof fn.name).toBe('string');
        expect(fn.name.length).toBeGreaterThan(0);
        expect(typeof fn.description).toBe('string');
        expect(fn.description.length).toBeGreaterThan(0);
      }
    });
  });

  // ── No broken $refs ──────────────────────────────────────────────────────────
  describe('spec validity', () => {
    it('has no $ref references (inline spec, no external dependencies)', () => {
      const specStr = JSON.stringify(copilotSpec);
      const refCount = (specStr.match(/"\\$ref"/g) || []).length;
      expect(refCount).toBe(0);
    });

    it('spec has openapi version 3.0.0', () => {
      expect(copilotSpec.openapi).toBe('3.0.0');
    });

    it('all operations in spec have a summary', () => {
      for (const [oid, { operation }] of specOps.entries()) {
        expect(operation.summary).toBeTruthy();
      }
    });
  });

  // ── Allowlist metadata completeness ─────────────────────────────────────────
  describe('allowlist metadata', () => {
    it('every allowlist entry has required fields: operationId, mode, requiresConfirmation, summary, risk', () => {
      for (const entry of allowlist) {
        expect(typeof entry.operationId).toBe('string');
        expect(['read', 'draft', 'prepare', 'consequential']).toContain(entry.mode);
        expect(typeof entry.requiresConfirmation).toBe('boolean');
        expect(typeof entry.summary).toBe('string');
        expect(['low', 'medium', 'high']).toContain(entry.risk);
      }
    });

    it('read-mode entries all have requiresConfirmation: false', () => {
      for (const entry of allowlist.filter((e) => e.mode === 'read')) {
        expect(entry.requiresConfirmation).toBe(false);
      }
    });

    it('prepare-mode entries all have requiresConfirmation: true', () => {
      for (const entry of allowlist.filter((e) => e.mode === 'prepare')) {
        expect(entry.requiresConfirmation).toBe(true);
      }
    });

    it('prepare-mode entries have risk medium or high', () => {
      for (const entry of allowlist.filter((e) => e.mode === 'prepare')) {
        expect(['medium', 'high']).toContain(entry.risk);
      }
    });

    it('blocklist entries all have a reason', () => {
      for (const entry of blocklist) {
        expect(typeof entry.reason).toBe('string');
        expect(entry.reason.length).toBeGreaterThan(0);
      }
    });
  });
});
