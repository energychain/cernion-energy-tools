'use strict';

const {
  CAPABILITY_FAMILIES,
  DEFAULT_CAPABILITY_PROFILE,
  normalizeCapabilityProfile,
  resolveWriteScope,
  evaluateWriteRequest,
  redactSessionForClient,
  resolveOntologyContext,
} = require('../src/chatgpt-sidecar-session-policy');

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
});
