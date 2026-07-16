'use strict';

const {
  rankOperations,
  selectTopOperation,
  findOperationById,
  listOperationsByCapability,
  listOperationsByDomain,
  findMissingRequiredParameters,
  scoreOperationEntry,
  normalizeText,
  tokenize,
  stem,
  MIN_ROUTABLE_SCORE,
} = require('../src/operation-capability-index');

// Small hand-built index fixture - mirrors the real operation-capability-index.json
// shape without depending on the full generated artifact, so these tests stay
// fast and pinned to a known set of entries.
function makeEntry(overrides) {
  return {
    operationId: 'example_op',
    method: 'GET',
    path: '/api/example',
    service: 'example',
    action: 'example.op',
    summary: 'Example operation',
    operationKind: 'data_read',
    consequenceLevel: 'none',
    recommendedExecutionMode: 'direct',
    agentable: true,
    nonAgentableReason: null,
    capabilityCandidates: [],
    domains: [],
    parameters: { required: [], optional: [] },
    rankingSignals: { positiveKeywords: [], negativeCues: [], synonyms: [], examples: [], curated: false },
    ...overrides,
  };
}

const FIXTURE_INDEX = {
  schemaVersion: 'cernion.operationCapabilityIndex.v1',
  operations: [
    makeEntry({
      operationId: 'gas-storage_countryStorage',
      action: 'gas-storage.countryStorage',
      service: 'gas-storage',
      path: '/api/gas-storage/country-storage',
      summary: 'Current gas storage fill level for a country',
      domains: ['market-data'],
      capabilityCandidates: ['gas_grid_transformation_asset_cockpit'],
      parameters: {
        required: [{ name: 'country', in: 'body', type: 'string', extractionHint: 'country_code' }],
        optional: [],
      },
      rankingSignals: {
        positiveKeywords: ['gas', 'storage', 'country', 'fill', 'level'],
        negativeCues: ['compare countries'],
        synonyms: ['Gasspeicher-Fuellstand'],
        examples: ['What is the current German gas storage fill level?'],
        curated: true,
      },
    }),
    makeEntry({
      operationId: 'gas-storage_compareCountries',
      action: 'gas-storage.compareCountries',
      service: 'gas-storage',
      path: '/api/gas-storage/compare-countries',
      summary: 'Multi-country gas storage comparison',
      domains: ['market-data'],
      parameters: {
        required: [
          { name: 'countries', in: 'body', type: 'array', extractionHint: null },
          { name: 'metric', in: 'body', type: 'string', extractionHint: null },
        ],
        optional: [],
      },
      rankingSignals: {
        positiveKeywords: ['gas', 'storage', 'compare', 'countries', 'multi', 'country'],
        negativeCues: ['single country fill level'],
        synonyms: ['Laendervergleich Gasspeicher'],
        examples: ['Compare gas storage fill levels across France, Italy and Germany'],
        curated: true,
      },
    }),
    makeEntry({
      operationId: 'backup-orchestrator_snapshot',
      action: 'backup-orchestrator.snapshot',
      service: 'backup-orchestrator',
      path: '/api/backup-orchestrator/snapshot',
      method: 'POST',
      summary: 'Create a full backup snapshot',
      operationKind: 'admin',
      consequenceLevel: 'high',
      recommendedExecutionMode: 'confirm',
      domains: ['platform'],
      rankingSignals: {
        positiveKeywords: ['backup', 'orchestrator', 'snapshot', 'create', 'full'],
        negativeCues: [],
        synonyms: [],
        examples: ['Create a full backup snapshot'],
        curated: false,
      },
    }),
    makeEntry({
      operationId: 'meta_openapiSpec',
      method: 'GET',
      path: '/api/openapi.json',
      service: 'meta',
      action: null,
      summary: 'Raw OpenAPI spec document',
      operationKind: 'internal',
      agentable: false,
      nonAgentableReason: 'Returns the raw spec, not a business operation result.',
      recommendedExecutionMode: 'explain_only',
      rankingSignals: {
        positiveKeywords: ['openapi', 'spec', 'document'],
        negativeCues: [],
        synonyms: [],
        examples: ['Show me the raw OpenAPI spec'],
        curated: false,
      },
    }),
  ],
};

describe('operation-capability-index (ranker)', () => {
  // -------------------------------------------------------------------------
  // text utilities
  // -------------------------------------------------------------------------
  describe('text utilities', () => {
    it('normalizeText lowercases, strips punctuation/diacritics, and collapses whitespace', () => {
      expect(normalizeText('Fuellstand - Day-Ahead!')).toBe('fuellstand day ahead');
    });

    it('tokenize splits normalized text into words', () => {
      expect(tokenize('Gas Storage Fill-Level')).toEqual(['gas', 'storage', 'fill', 'level']);
    });

    it('stem strips simple plural suffixes without mangling short words', () => {
      expect(stem('forecasts')).toBe('forecast');
      expect(stem('prices')).toBe('price');
      expect(stem('gas')).toBe('gas');
      expect(stem('co2')).toBe('co2');
    });
  });

  // -------------------------------------------------------------------------
  // rankOperations - representative routing cases
  // -------------------------------------------------------------------------
  describe('rankOperations', () => {
    it('ranks a read-only single-country query above the multi-country comparator', () => {
      const [top] = rankOperations('What is the current German gas storage fill level?', {
        index: FIXTURE_INDEX,
        limit: 1,
      });
      expect(top.operationId).toBe('gas-storage_countryStorage');
    });

    it('ranks the multi-country comparator above the single-country op for a comparison query', () => {
      const [top] = rankOperations('Compare gas storage across countries', {
        index: FIXTURE_INDEX,
        limit: 1,
      });
      expect(top.operationId).toBe('gas-storage_compareCountries');
    });

    it('does not let an unrelated negativeCue phrase veto a match on partial word overlap alone', () => {
      // "fill" and "level" individually overlap with compareCountries'
      // negativeCue phrase "single country fill level", but the phrase
      // itself is absent - this must not be penalized as if it were.
      const results = rankOperations('Compare gas storage fill levels across France and Italy', {
        index: FIXTURE_INDEX,
      });
      const compareEntry = results.find((r) => r.operationId === 'gas-storage_compareCountries');
      expect(compareEntry).toBeDefined();
      expect(compareEntry.score).toBeGreaterThan(0);
    });

    it('surfaces a write/admin operation (never blanket-hidden) for a matching query', () => {
      const [top] = rankOperations('Create a full backup snapshot', { index: FIXTURE_INDEX, limit: 1 });
      expect(top.operationId).toBe('backup-orchestrator_snapshot');
      expect(top.operationKind).toBe('admin');
      expect(top.recommendedExecutionMode).toBe('confirm');
    });

    it('excludes agentable:false entries by default', () => {
      const results = rankOperations('raw openapi spec document', { index: FIXTURE_INDEX });
      expect(results.find((r) => r.operationId === 'meta_openapiSpec')).toBeUndefined();
    });

    it('includes agentable:false entries when includeNonAgentable is set', () => {
      const results = rankOperations('raw openapi spec document', {
        index: FIXTURE_INDEX,
        includeNonAgentable: true,
      });
      expect(results.find((r) => r.operationId === 'meta_openapiSpec')).toBeDefined();
    });

    it('returns nothing below MIN_ROUTABLE_SCORE for an unrelated query', () => {
      const results = rankOperations('completely unrelated query about nothing here', {
        index: FIXTURE_INDEX,
      });
      expect(results).toEqual([]);
    });

    it('boosts score when an explicit capability match is provided', () => {
      const withoutCapability = rankOperations('country gas data', { index: FIXTURE_INDEX, limit: 1 })[0];
      const withCapability = rankOperations('country gas data', {
        index: FIXTURE_INDEX,
        limit: 1,
        capability: 'gas_grid_transformation_asset_cockpit',
      })[0];
      expect(withCapability.score).toBeGreaterThan(withoutCapability.score);
    });

    it('reports missingRequiredParameters based on already-extracted inputs', () => {
      const [top] = rankOperations('current gas storage fill level for a country', {
        index: FIXTURE_INDEX,
        limit: 1,
      });
      expect(top.operationId).toBe('gas-storage_countryStorage');
      expect(top.missingRequiredParameters.map((p) => p.name)).toEqual(['country']);

      const [resolved] = rankOperations('current gas storage fill level for a country', {
        index: FIXTURE_INDEX,
        limit: 1,
        extractedInputs: { country: 'DE' },
      });
      expect(resolved.missingRequiredParameters).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // selectTopOperation
  // -------------------------------------------------------------------------
  describe('selectTopOperation', () => {
    it('returns the best candidate with alternatives attached', () => {
      const selected = selectTopOperation('current gas storage fill level for a country', {
        index: FIXTURE_INDEX,
      });
      expect(selected.operationId).toBe('gas-storage_countryStorage');
      expect(Array.isArray(selected.alternatives)).toBe(true);
    });

    it('returns null when nothing clears the routable threshold', () => {
      expect(selectTopOperation('xyz completely unrelated', { index: FIXTURE_INDEX })).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // lookups
  // -------------------------------------------------------------------------
  describe('lookup helpers', () => {
    it('findOperationById finds an exact operation', () => {
      expect(findOperationById('gas-storage_countryStorage', { index: FIXTURE_INDEX }).service).toBe('gas-storage');
      expect(findOperationById('does-not-exist', { index: FIXTURE_INDEX })).toBeNull();
    });

    it('listOperationsByCapability filters by capabilityCandidates', () => {
      const results = listOperationsByCapability('gas_grid_transformation_asset_cockpit', { index: FIXTURE_INDEX });
      expect(results.map((r) => r.operationId)).toEqual(['gas-storage_countryStorage']);
    });

    it('listOperationsByDomain filters by domains', () => {
      const results = listOperationsByDomain('platform', { index: FIXTURE_INDEX });
      expect(results.map((r) => r.operationId)).toEqual(['backup-orchestrator_snapshot']);
    });
  });

  // -------------------------------------------------------------------------
  // findMissingRequiredParameters
  // -------------------------------------------------------------------------
  describe('findMissingRequiredParameters', () => {
    it('matches provided inputs by parameter name (case-insensitive)', () => {
      const entry = FIXTURE_INDEX.operations[0];
      expect(findMissingRequiredParameters(entry, { COUNTRY: 'DE' })).toEqual([]);
    });

    it('matches provided inputs by extractionHint', () => {
      const entry = FIXTURE_INDEX.operations[0];
      expect(findMissingRequiredParameters(entry, { country_code: 'DE' })).toEqual([]);
    });

    it('reports all required params as missing when nothing is provided', () => {
      const entry = FIXTURE_INDEX.operations[1];
      expect(findMissingRequiredParameters(entry, {}).map((p) => p.name)).toEqual(['countries', 'metric']);
    });
  });

  // -------------------------------------------------------------------------
  // scoreOperationEntry weighting (curated vs. generic signals)
  // -------------------------------------------------------------------------
  describe('scoreOperationEntry', () => {
    it('is deterministic - identical inputs produce identical scores', () => {
      const entry = FIXTURE_INDEX.operations[0];
      const ctx = {
        normalizedQuery: normalizeText('gas storage fill level'),
        queryTokens: tokenize('gas storage fill level'),
        compactQuery: 'gasstoragefilllevel',
        capability: null,
        domain: null,
      };
      const first = scoreOperationEntry(entry, ctx);
      const second = scoreOperationEntry(entry, ctx);
      expect(first).toBe(second);
    });

    it('returns a plain finite number', () => {
      const entry = FIXTURE_INDEX.operations[0];
      const ctx = {
        normalizedQuery: normalizeText('gas storage'),
        queryTokens: tokenize('gas storage'),
        compactQuery: 'gasstorage',
        capability: null,
        domain: null,
      };
      const score = scoreOperationEntry(entry, ctx);
      expect(Number.isFinite(score)).toBe(true);
    });
  });

  describe('MIN_ROUTABLE_SCORE', () => {
    it('is a small positive number so single strong keyword hits still surface at low confidence', () => {
      expect(MIN_ROUTABLE_SCORE).toBeGreaterThan(0);
      expect(MIN_ROUTABLE_SCORE).toBeLessThan(50);
    });
  });
});
