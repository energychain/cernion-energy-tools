'use strict';

const {
  CAPABILITY_FAMILIES,
  DEFAULT_CAPABILITY_PROFILE,
  FULL_CAPABILITY_CATALOG,
  normalizeCapabilityProfile,
  groupCapabilitiesByDomain,
  resolveWriteScope,
  evaluateWriteRequest,
  redactSessionForClient,
  resolveOntologyContext,
} = require('../src/chatgpt-sidecar-session-policy');
const { CANONICAL_DOMAINS } = require('../src/llm-manifest-taxonomy');

describe('chatgpt-sidecar session policy', () => {
  it('filters capabilityProfile to the fixed allowlist and drops unknown values', () => {
    const result = normalizeCapabilityProfile([
      'knowledge-rag',
      'made-up-capability',
      'datasource-mastr',
    ]);
    expect(result).toEqual(['knowledge-rag', 'datasource-mastr']);
  });

  it('falls back to the default profile when nothing valid was requested', () => {
    expect(normalizeCapabilityProfile(['nonsense'])).toEqual([...DEFAULT_CAPABILITY_PROFILE]);
    expect(normalizeCapabilityProfile(undefined)).toEqual([...DEFAULT_CAPABILITY_PROFILE]);
  });

  it('resolves an unknown writeScope to the draft_write default', () => {
    expect(resolveWriteScope('controlled_write')).toBe('controlled_write');
    expect(resolveWriteScope('not-a-real-scope')).toBe('draft_write');
    expect(resolveWriteScope(undefined)).toBe('draft_write');
  });

  describe('evaluateWriteRequest', () => {
    const session = { capabilityProfile: ['draft-datapoints'], writeScope: 'draft_write' };

    it('allows draft_write on a draft_write-provisioned session with the capability granted', () => {
      const decision = evaluateWriteRequest({
        requestedWriteClass: 'draft_write',
        session,
        capability: 'draft-datapoints',
      });
      expect(decision).toEqual({
        decision: 'allowed',
        mutate: true,
        writeClass: 'draft_write',
        reason: null,
      });
    });

    it('blocks when the capability was not granted to the session', () => {
      const decision = evaluateWriteRequest({
        requestedWriteClass: 'draft_write',
        session,
        capability: 'datasource-mastr',
      });
      expect(decision.decision).toBe('blocked');
      expect(decision.mutate).toBe(false);
      expect(decision.reason).toBe('capability_not_granted');
    });

    it('never mutates for controlled_write/process_execute/requires_confirmation', () => {
      for (const writeClass of ['controlled_write', 'process_execute', 'requires_confirmation']) {
        const decision = evaluateWriteRequest({
          requestedWriteClass: writeClass,
          session,
          capability: 'draft-datapoints',
        });
        expect(decision.mutate).toBe(false);
        expect(decision.decision).toBe('requires_confirmation');
      }
    });

    it('blocks draft_write when the session itself was not provisioned for it', () => {
      const controlledSession = {
        capabilityProfile: ['draft-datapoints'],
        writeScope: 'controlled_write',
      };
      const decision = evaluateWriteRequest({
        requestedWriteClass: 'draft_write',
        session: controlledSession,
        capability: 'draft-datapoints',
      });
      expect(decision.decision).toBe('blocked');
      expect(decision.mutate).toBe(false);
      expect(decision.reason).toBe('write_scope_not_provisioned');
    });
  });

  it('redacts tenant/user/session identity from the client-facing session view', () => {
    const session = {
      sessionId: 'cgs_secret',
      tenantId: 'tenant-a',
      userId: 'user-a',
      ticket: 'opaque-ticket',
      capabilityProfile: ['knowledge-rag', 'ontology-guardrail'],
      writeScope: 'draft_write',
      expiresAt: '2026-01-01T00:00:00.000Z',
    };

    const redacted = redactSessionForClient(session);
    expect(redacted).toEqual({
      capabilityProfile: ['knowledge-rag', 'ontology-guardrail'],
      capabilityDomains: { platform: ['knowledge-rag', 'ontology-guardrail'] },
      writeScope: 'draft_write',
      expiresAt: '2026-01-01T00:00:00.000Z',
      ontologyEnabled: true,
    });
    expect(JSON.stringify(redacted)).not.toMatch(/tenant-a|user-a|cgs_secret|opaque-ticket/);
  });

  describe('resolveOntologyContext', () => {
    it('returns null when ontology guardrail is not enabled', () => {
      expect(
        resolveOntologyContext({ ontologyEnabled: false, capability: 'datasource-mastr' })
      ).toBeNull();
    });

    it('resolves concepts for a mapped capability family', () => {
      const context = resolveOntologyContext({
        ontologyEnabled: true,
        capability: 'datasource-mastr',
      });
      expect(context.supported).toBe(true);
      expect(context.classification).toBe('ontology_aligned');
      expect(context.concepts.length).toBeGreaterThan(0);
    });

    it('marks an unsupported claim for a capability with no ontology domain mapping', () => {
      const context = resolveOntologyContext({
        ontologyEnabled: true,
        capability: 'datasource-entsoe',
      });
      expect(context.supported).toBe(false);
      expect(context.classification).toBe('unsupported_ontology_claim');
      expect(context.concepts).toEqual([]);
    });
  });

  it('keeps the fixed capability-family enum stable', () => {
    expect(CAPABILITY_FAMILIES).toEqual([
      'knowledge-rag',
      'blueprint-plan',
      'datasource-mastr',
      'datasource-vnb-digital',
      'datasource-entsoe',
      'datasource-gas-storage',
      'datasource-grid-osm',
      'redispatch-evidence',
      'edm-mako-evidence',
      'ontology-guardrail',
      'draft-datapoints',
    ]);
  });

  // -------------------------------------------------------------------
  // #390: full-scope catalog expansion
  // -------------------------------------------------------------------
  describe('full-scope catalog expansion (#390)', () => {
    it('builds a full capability catalog fully covered by canonical domains, never "unmapped"', () => {
      expect(FULL_CAPABILITY_CATALOG.length).toBeGreaterThan(100);
      for (const entry of FULL_CAPABILITY_CATALOG) {
        expect(CANONICAL_DOMAINS).toContain(entry.canonicalDomain);
      }
    });

    it('excludes a catalog capability whose domain has no canonical mapping (fail closed)', () => {
      jest.resetModules();
      jest.doMock('../src/capability-catalog', () => ({
        CURATED_CAPABILITIES: [
          { capability: 'known_good_capability', domain: 'redispatch', intent: 'x' },
          { capability: 'orphaned_capability', domain: 'totally-unmapped-domain', intent: 'y' },
        ],
      }));

      const {
        FULL_CAPABILITY_CATALOG: rebuiltCatalog,
      } = require('../src/chatgpt-sidecar-session-policy');
      const ids = rebuiltCatalog.map((entry) => entry.id);
      expect(ids).toContain('known_good_capability');
      expect(ids).not.toContain('orphaned_capability');

      jest.dontMock('../src/capability-catalog');
      jest.resetModules();
    });

    it('accepts a real catalog capability id directly', () => {
      const sampleId = FULL_CAPABILITY_CATALOG[0].id;
      expect(normalizeCapabilityProfile([sampleId, 'not-a-real-id'])).toEqual([sampleId]);
    });

    it('resolves the "*" wildcard to the fixed core handles plus the full catalog, nothing more', () => {
      const result = normalizeCapabilityProfile(['*']);
      expect(result).toHaveLength(CAPABILITY_FAMILIES.length + FULL_CAPABILITY_CATALOG.length);
      for (const core of CAPABILITY_FAMILIES) expect(result).toContain(core);
      for (const entry of FULL_CAPABILITY_CATALOG) expect(result).toContain(entry.id);
    });

    it('does not treat "*" as a wildcard when mixed with other ids', () => {
      const result = normalizeCapabilityProfile(['*', 'knowledge-rag']);
      expect(result).toEqual(['knowledge-rag']);
    });

    it('groups granted capabilities by canonical domain for the manifest', () => {
      const sample = FULL_CAPABILITY_CATALOG.find(
        (entry) => entry.canonicalDomain === 'redispatch'
      );
      const grouped = groupCapabilitiesByDomain(['knowledge-rag', sample.id]);
      expect(grouped.platform).toEqual(['knowledge-rag']);
      expect(grouped.redispatch).toEqual([sample.id]);
    });

    it('marks an unsupported ontology claim for a granted catalog capability with no OEO mapping', () => {
      const sampleId = FULL_CAPABILITY_CATALOG[0].id;
      const context = resolveOntologyContext({ ontologyEnabled: true, capability: sampleId });
      expect(context.supported).toBe(false);
      expect(context.classification).toBe('unsupported_ontology_claim');
    });
  });
});
