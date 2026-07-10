'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildIndex,
  dedupeOperations,
  loadRawOperations,
  checkCoverage,
} = require('../scripts/generate-operation-capability-index');
const { OPERATION_KINDS } = require('../src/operation-capability-classifier');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, 'operation-capability-index.json');

describe('generate-operation-capability-index', () => {
  // -------------------------------------------------------------------------
  // loadRawOperations / dedupeOperations
  // -------------------------------------------------------------------------
  describe('loadRawOperations', () => {
    it('extracts one raw operation per (path, method) pair, dropping nothing', () => {
      const spec = {
        paths: {
          '/api/a': { get: { operationId: 'a_get' }, post: { operationId: 'a_post' } },
          '/api/b': { get: { operationId: 'b_get' } },
        },
      };
      const ops = loadRawOperations(spec);
      expect(ops).toHaveLength(3);
      expect(ops.map((o) => `${o.method} ${o.path}`).sort()).toEqual([
        'GET /api/a',
        'GET /api/b',
        'POST /api/a',
      ]);
    });

    it('synthesizes an operationId when the spec omits one', () => {
      const spec = { paths: { '/api/c': { get: {} } } };
      const ops = loadRawOperations(spec);
      expect(ops[0].operationId).toBe('GET_/api/c');
    });
  });

  describe('dedupeOperations', () => {
    it('keeps every operationId exactly once, carrying duplicates as aliases', () => {
      const ops = [
        { path: '/api/gas-storage/country-storage', method: 'POST', operationId: 'gas-storage_countryStorage' },
        { path: '/api/gas-storage-alt/country-storage', method: 'POST', operationId: 'gas-storage_countryStorage' },
        { path: '/api/other', method: 'GET', operationId: 'other_get' },
      ];
      const deduped = dedupeOperations(ops);
      expect(deduped).toHaveLength(2);
      const canonical = deduped.find((o) => o.operationId === 'gas-storage_countryStorage');
      expect(canonical.path).toBe('/api/gas-storage/country-storage');
      expect(canonical.aliases).toEqual(['POST /api/gas-storage-alt/country-storage']);
    });

    it('picks the shortest, alphabetically-first path as canonical', () => {
      const ops = [
        { path: '/api/zzz/thing', method: 'GET', operationId: 'thing_get' },
        { path: '/api/aaa/thing', method: 'GET', operationId: 'thing_get' },
      ];
      const [canonical] = dedupeOperations(ops);
      expect(canonical.path).toBe('/api/aaa/thing');
    });
  });

  // -------------------------------------------------------------------------
  // checkCoverage
  // -------------------------------------------------------------------------
  describe('checkCoverage', () => {
    it('passes for a fully agentable set with valid kinds', () => {
      const entries = [{ operationKind: 'data_read', agentable: true, nonAgentableReason: null }];
      expect(checkCoverage(entries, 1)).toEqual([]);
    });

    it('flags an entry count mismatch', () => {
      const entries = [{ operationKind: 'data_read', agentable: true, nonAgentableReason: null }];
      const problems = checkCoverage(entries, 2);
      expect(problems.some((p) => p.includes('Expected 2'))).toBe(true);
    });

    it('flags an invalid operationKind', () => {
      const entries = [{ method: 'GET', path: '/x', operationKind: 'bogus', agentable: true, nonAgentableReason: null }];
      const problems = checkCoverage(entries, 1);
      expect(problems.some((p) => p.includes('invalid operationKind'))).toBe(true);
    });

    it('requires a nonAgentableReason whenever agentable is false', () => {
      const entries = [{ method: 'GET', path: '/x', operationKind: 'internal', agentable: false, nonAgentableReason: null }];
      const problems = checkCoverage(entries, 1);
      expect(problems.some((p) => p.includes('nonAgentableReason'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // buildIndex against the real committed openapi-export.json - this is the
  // acceptance-criteria check from issue #416: 100% of OpenAPI operations
  // must be represented, and every non-agentable entry must carry a reason.
  // -------------------------------------------------------------------------
  describe('buildIndex (full repo spec)', () => {
    let result;
    beforeAll(() => {
      result = buildIndex();
    });

    it('produces at least one entry per deduplicated operation, none dropped', () => {
      expect(result.entries.length).toBeGreaterThan(0);
      expect(result.rawOperationCount).toBeGreaterThanOrEqual(result.entries.length);
      expect(result.deduplicatedOperationCount).toBe(result.entries.length);
    });

    it('passes its own coverage check with zero problems', () => {
      const problems = checkCoverage(result.entries, result.deduplicatedOperationCount);
      expect(problems).toEqual([]);
    });

    it('gives every entry a valid operationKind from the documented enum', () => {
      for (const entry of result.entries) {
        expect(OPERATION_KINDS).toContain(entry.operationKind);
      }
    });

    it('never blanket-hides write/process-capable operations: every write/process kind stays agentable', () => {
      const consequentialKinds = ['draft_write', 'object_store_write', 'process_start', 'process_step', 'admin', 'external_effect'];
      const consequentialEntries = result.entries.filter((e) => consequentialKinds.includes(e.operationKind));
      expect(consequentialEntries.length).toBeGreaterThan(0);
      expect(consequentialEntries.every((e) => e.agentable === true)).toBe(true);
    });

    it('gives every non-agentable entry a concrete, non-empty reason', () => {
      const nonAgentable = result.entries.filter((e) => e.agentable === false);
      for (const entry of nonAgentable) {
        expect(typeof entry.nonAgentableReason).toBe('string');
        expect(entry.nonAgentableReason.length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // committed artifact freshness - guards against drift between
  // openapi-export.json / the classifier and the committed JSON artifact.
  // -------------------------------------------------------------------------
  describe('committed operation-capability-index.json', () => {
    it('is up to date with the current openapi-export.json + classifier (run `npm run generate:operation-capability-index` if this fails)', () => {
      const { entries } = buildIndex();
      const packageVersion = require(path.join(ROOT, 'package.json')).version;
      const crypto = require('crypto');
      const sourceOpenApiHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(ROOT, 'openapi-export.json'), 'utf8'), 'utf8')
        .digest('hex');

      const agentableCount = entries.filter((e) => e.agentable).length;
      const kindCounts = {};
      for (const entry of entries) kindCounts[entry.operationKind] = (kindCounts[entry.operationKind] || 0) + 1;

      const expected = {
        schemaVersion: 'cernion.operationCapabilityIndex.v1',
        generator: 'scripts/generate-operation-capability-index.js',
        packageVersion,
        sourceOpenApiHash,
        coverage: {
          rawOperationCount: loadRawOperations(JSON.parse(fs.readFileSync(path.join(ROOT, 'openapi-export.json'), 'utf8'))).length,
          operationCount: entries.length,
          agentableCount,
          nonAgentableCount: entries.length - agentableCount,
          byOperationKind: kindCounts,
        },
        operations: entries,
      };

      const onDisk = JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
      expect(onDisk).toEqual(expected);
    });
  });
});
