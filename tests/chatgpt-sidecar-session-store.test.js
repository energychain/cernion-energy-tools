'use strict';

const { createInMemorySessionStore, TTL_OPTIONS } = require('../src/chatgpt-sidecar-session-store');

describe('chatgpt-sidecar session store', () => {
  let store;

  beforeEach(() => {
    store = createInMemorySessionStore();
  });

  it('creates a session with an opaque high-entropy ticket and resolved expiresAt', () => {
    const created = store.createSession({
      tenantId: 'tenant-a',
      userId: 'user-a',
      ttl: '1h',
      capabilityProfile: ['knowledge-rag'],
      writeScope: 'draft_write',
      origin: 'chatgpt_prompt_generator',
      metadata: {},
    });

    expect(created.ok).toBe(true);
    expect(created.session.ticket).toMatch(/^[A-Za-z0-9_-]{30,}$/);
    expect(created.session.sessionId).toMatch(/^cgs_/);
    expect(Date.parse(created.session.expiresAt) - Date.parse(created.session.createdAt)).toBe(
      TTL_OPTIONS['1h']
    );
  });

  it('rejects an invalid ttl', () => {
    const created = store.createSession({ tenantId: 't', ttl: '30d', capabilityProfile: [] });
    expect(created.ok).toBe(false);
    expect(created.reason).toBe('invalid_ttl');
    expect(created.allowedTtl).toEqual(['1h', '4h', '1d']);
  });

  it('resolves unknown and revoked tickets identically as not_found', () => {
    expect(store.resolveByTicket('does-not-exist').status).toBe('not_found');

    const { session } = store.createSession({ tenantId: 't', ttl: '1h', capabilityProfile: [] });
    store.revoke(session.sessionId);
    expect(store.resolveByTicket(session.ticket).status).toBe('not_found');
  });

  it('resolves an expired ticket distinctly from unknown/revoked', () => {
    const { session } = store.createSession({ tenantId: 't', ttl: '1h', capabilityProfile: [] });
    session.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(store.resolveByTicket(session.ticket).status).toBe('expired');
  });

  it('does not revoke a session belonging to a different tenant', () => {
    const { session } = store.createSession({
      tenantId: 'tenant-a',
      ttl: '1h',
      capabilityProfile: [],
    });
    const result = store.revoke(session.sessionId, { tenantId: 'tenant-b' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_found');
    expect(store.resolveByTicket(session.ticket).status).toBe('active');
  });

  it('records metering events and exposes only a redacted summary', () => {
    const { session } = store.createSession({ tenantId: 't', ttl: '1h', capabilityProfile: [] });
    store.recordMeteringEvent(session.sessionId, 'session_created', {});
    store.recordMeteringEvent(session.sessionId, 'manifest_read', {});
    store.recordMeteringEvent(session.sessionId, 'manifest_read', {});

    const summary = store.getMeteringSummary(session.sessionId);
    expect(summary.counts).toEqual({ session_created: 1, manifest_read: 2 });
    expect(summary.eventCount).toBe(3);
    expect(summary).not.toHaveProperty('tenantId');
    expect(summary).not.toHaveProperty('userId');
  });
});
