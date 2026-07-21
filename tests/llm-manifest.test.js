/**
 * llm.txt Cluster Manifest — Build Guard
 *
 * Verifies the generator (scripts/generate-llm-txt.js) stays deterministic,
 * loses no capability/recipe/operation to an unmapped taxonomy bucket, and
 * keeps the agent-relevant section under the agreed token budget.
 *
 * Run after: npm run generate:llm (or implicitly via buildLlmTxt() below).
 */

const {
  CURATED_CAPABILITIES,
  INTERFACE_PLACEHOLDER_CAPABILITY,
} = require('../src/capability-catalog');
const { COOKBOOK_RECIPES } = require('../src/cookbook-recipes');
const { CANONICAL_DOMAINS, classifyAll } = require('../src/llm-manifest-taxonomy');
const { buildLlmTxt, END_OF_AGENT_RELEVANT_MARKER } = require('../scripts/generate-llm-txt');

// Token budget is approximated as chars/4 — there is no tokenizer dependency
// in this project. Raised from 3,500 to 4,000 tokens (issue #467): organic
// domain/capability growth pushed the manifest to 14,552 chars, past the
// original 14,000-char limit, with no single redundant block to cut. See
// #467 for the open question on a longer-term strategy (further budget
// bumps vs. restructuring cluster content to resolve on demand).
const TOKEN_BUDGET = 4000;
const CHAR_BUDGET = TOKEN_BUDGET * 4;

describe('llm.txt cluster manifest', () => {
  let built;

  beforeAll(() => {
    built = buildLlmTxt();
  }, 30000);

  describe('taxonomy completeness (no silent loss)', () => {
    it('maps every capability, recipe, and OpenAPI operation to a canonical domain', () => {
      const fs = require('fs');
      const path = require('path');
      const spec = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'openapi-export.json'), 'utf8')
      );
      const operations = [];
      for (const p of Object.keys(spec.paths || {})) {
        for (const m of Object.keys(spec.paths[p])) {
          operations.push({ path: p, method: m.toUpperCase(), tags: spec.paths[p][m].tags || [] });
        }
      }

      const { unmapped } = classifyAll({
        capabilities: [...CURATED_CAPABILITIES, INTERFACE_PLACEHOLDER_CAPABILITY],
        recipes: COOKBOOK_RECIPES,
        operations,
      });

      expect(unmapped.capabilities).toEqual([]);
      expect(unmapped.recipes).toEqual([]);
      expect(unmapped.operations).toEqual([]);
    });
  });

  describe('determinism', () => {
    it('produces byte-identical output across repeated builds', () => {
      const second = buildLlmTxt();
      expect(second.content).toBe(built.content);
    });
  });

  describe('structure', () => {
    it('contains the END-OF-AGENT-RELEVANT marker exactly once', () => {
      const occurrences = built.content.split(END_OF_AGENT_RELEVANT_MARKER).length - 1;
      expect(occurrences).toBe(1);
    });

    it('renders a cluster head (capabilities/recipes/resolve) for every canonical domain', () => {
      for (const domain of CANONICAL_DOMAINS) {
        expect(built.agentRelevantBody).toContain(`### ${domain} (`);
        expect(built.agentRelevantBody).toContain(
          `resolve: GET /api/_agent/operations?domain=${domain}`
        );
      }
    });

    it('does not embed the full OpenAPI contract (no canonical JSON dump)', () => {
      expect(built.content).not.toContain('"paths"');
      expect(built.content).not.toContain('"operationId"');
    });

    it('does not leak secrets or bearer tokens', () => {
      expect(built.content.toLowerCase()).not.toMatch(/bearer [a-z0-9._-]{10,}/);
      expect(built.content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    });
  });

  describe('token budget', () => {
    it(`keeps the agent-relevant section under ${TOKEN_BUDGET} tokens (~${CHAR_BUDGET} chars, chars/4 heuristic)`, () => {
      expect(built.agentRelevantBody.length).toBeLessThanOrEqual(CHAR_BUDGET);
    });
  });
});
