'use strict';

const { ServiceBroker } = require('moleculer');
const ChatgptSidecarService = require('../services/chatgpt-sidecar.service');
const { defaultStore } = require('../src/chatgpt-sidecar-session-store');

describe('chatgpt-sidecar service', () => {
  let broker;
  let calls;

  beforeEach(async () => {
    calls = [];
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService(ChatgptSidecarService);
    broker.createService({
      name: 'personal-agent',
      actions: {
        askCernionAgent: {
          handler(ctx) {
            calls.push({ action: 'personal-agent.askCernionAgent', params: ctx.params });
            return {
              success: true,
              shortAnswer: 'Cernion evidence answer',
              evidence: [],
              forbiddenActions: ['execute', 'approve', 'delete'],
            };
          },
        },
      },
    });
    broker.createService({
      name: 'capability-broker',
      actions: {
        recommend: {
          handler(ctx) {
            calls.push({ action: 'capability-broker.recommend', params: ctx.params });
            return {
              capability: 'redispatch_readiness_gate',
              recommendedPlan: [{ action: 'redispatch-readiness-gate.getStatus' }],
            };
          },
        },
      },
    });
    broker.createService({
      name: 'datapoint',
      actions: {
        create: {
          handler(ctx) {
            calls.push({ action: 'datapoint.create', params: ctx.params });
            return { success: true, name: ctx.params.name, _rev: '1-abc' };
          },
        },
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
  });

  const CREATOR_META = {
    meta: {
      authUser: {
        authType: 'session',
        tenantId: 'tenant-a',
        userId: 'user-a',
        roles: ['full-access', 'chatgpt-sidecar-creator'],
      },
    },
  };

  async function createSession(overrides = {}) {
    return broker.call(
      'chatgpt-sidecar.createSession',
      {
        capabilityProfile: ['knowledge-rag', 'draft-datapoints', 'datasource-mastr'],
        ...overrides,
      },
      CREATOR_META
    );
  }

  function ticketFrom(created) {
    return created.ticketUrl.split('/s/')[1].split('/')[0];
  }

  // ---------------------------------------------------------------------
  // Creation auth gate
  // ---------------------------------------------------------------------

  it('rejects session creation with no authenticated tenant', async () => {
    await expect(broker.call('chatgpt-sidecar.createSession', {})).rejects.toMatchObject({
      code: 401,
      type: 'AUTH_REQUIRED',
    });
  });

  it('rejects a read-only token from creating a session', async () => {
    await expect(
      broker.call(
        'chatgpt-sidecar.createSession',
        {},
        {
          meta: {
            apiToken: { scope: 'read-only', tenantId: 'tenant-a' },
            authUser: { roles: ['read-only'] },
          },
        }
      )
    ).rejects.toMatchObject({ code: 403, type: 'CHATGPT_SIDECAR_CREATE_FORBIDDEN' });
  });

  it('rejects a full-access caller without the chatgpt-sidecar-creator role', async () => {
    await expect(
      broker.call(
        'chatgpt-sidecar.createSession',
        {},
        { meta: { authUser: { tenantId: 'tenant-a', roles: ['full-access'] } } }
      )
    ).rejects.toMatchObject({ code: 403, type: 'CHATGPT_SIDECAR_CREATE_FORBIDDEN' });
  });

  it('rejects an invalid ttl', async () => {
    await expect(createSession({ ttl: '30d' })).rejects.toMatchObject({
      code: 400,
      type: 'CHATGPT_SIDECAR_INVALID_TTL',
    });
  });

  // ---------------------------------------------------------------------
  // No identity/credential leakage
  // ---------------------------------------------------------------------

  it('never leaks tenantId, userId, sessionId or provider credentials in the response payload', async () => {
    const created = await createSession();
    const serialized = JSON.stringify(created);
    expect(serialized).not.toMatch(/tenant-a|user-a/);
    expect(serialized).not.toMatch(/\bck_/);

    const ticket = ticketFrom(created);
    const manifest = await broker.call('chatgpt-sidecar.manifest', { ticket });
    const manifestSerialized = JSON.stringify(manifest);
    expect(manifestSerialized).not.toMatch(/tenant-a|user-a|ck_/);
    expect(manifest).not.toHaveProperty('sessionId');
    expect(manifest).not.toHaveProperty('tenantId');
  });

  // ---------------------------------------------------------------------
  // Manifest allowlist
  // ---------------------------------------------------------------------

  it('manifest returns only the session capability allowlist', async () => {
    const created = await createSession({ capabilityProfile: ['knowledge-rag', 'made-up'] });
    const ticket = ticketFrom(created);
    const manifest = await broker.call('chatgpt-sidecar.manifest', { ticket });
    expect(manifest.capabilityProfile).toEqual(['knowledge-rag']);
  });

  // ---------------------------------------------------------------------
  // TTL expiry -> 410
  // ---------------------------------------------------------------------

  it('returns 410 Gone with a regenerate instruction once the session has expired', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const session = defaultStore.getById(created.sessionId);
    session.expiresAt = new Date(Date.now() - 1000).toISOString();

    await expect(broker.call('chatgpt-sidecar.manifest', { ticket })).rejects.toMatchObject({
      code: 410,
      type: 'CHATGPT_SIDECAR_SESSION_EXPIRED',
    });
  });

  // ---------------------------------------------------------------------
  // Unknown / revoked ticket -> identical hard failure
  // ---------------------------------------------------------------------

  it('fails hard and identically for unknown and revoked tickets', async () => {
    await expect(
      broker.call('chatgpt-sidecar.manifest', { ticket: 'never-issued' })
    ).rejects.toMatchObject({ code: 404, type: 'CHATGPT_SIDECAR_TICKET_NOT_FOUND' });

    const created = await createSession();
    const ticket = ticketFrom(created);
    await broker.call(
      'chatgpt-sidecar.revokeSession',
      { sessionId: created.sessionId },
      CREATOR_META
    );

    await expect(broker.call('chatgpt-sidecar.manifest', { ticket })).rejects.toMatchObject({
      code: 404,
      type: 'CHATGPT_SIDECAR_TICKET_NOT_FOUND',
    });
  });

  // ---------------------------------------------------------------------
  // ask / plan
  // ---------------------------------------------------------------------

  it('ask forwards to the evidence flow and meters the call', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Welche Prozessschritte fehlen fuer die Gremienfreigabe?',
    });

    expect(result.success).toBe(true);
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeTruthy();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.ask_call).toBe(1);
  });

  it('ask blocks a capability that was not granted to the session, without calling downstream', async () => {
    const created = await createSession({ capabilityProfile: ['knowledge-rag'] });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie ist der MaStR-Status?',
      capability: 'datasource-mastr',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('capability_not_granted');
    expect(calls).toHaveLength(0);

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.blocked_policy_attempt).toBe(1);
  });

  it('plan resolves via the capability broker without executing anything', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.plan', {
      ticket,
      task: 'Redispatch Produktivreife pruefen',
    });

    expect(result.success).toBe(true);
    expect(calls.find((c) => c.action === 'capability-broker.recommend')).toBeTruthy();
  });

  it('ask attaches ontology guardrail context and marks unsupported claims', async () => {
    const created = await createSession({
      capabilityProfile: [
        'knowledge-rag',
        'datasource-mastr',
        'datasource-entsoe',
        'ontology-guardrail',
      ],
    });
    const ticket = ticketFrom(created);

    const mastrResult = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Status der MaStR Meldung?',
      capability: 'datasource-mastr',
    });
    expect(mastrResult.ontology.supported).toBe(true);
    expect(mastrResult.ontology.classification).toBe('ontology_aligned');

    const entsoeResult = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie hoch ist der Day-Ahead Preis?',
      capability: 'datasource-entsoe',
    });
    expect(entsoeResult.ontology.supported).toBe(false);
    expect(entsoeResult.ontology.classification).toBe('unsupported_ontology_claim');
  });

  // ---------------------------------------------------------------------
  // Draft datapoints: allowed write + provenance
  // ---------------------------------------------------------------------

  it('creates a draft datapoint with server-side tenant/user/session provenance', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      value: { status: 'draft', summary: 'ZNP Kandidatenliste' },
      message: 'Bitte als Entwurf speichern',
    });

    expect(result.success).toBe(true);
    expect(result.writeScope).toBe('draft_write');

    const dpCall = calls.find((c) => c.action === 'datapoint.create');
    expect(dpCall).toBeTruthy();
    expect(dpCall.params.metadata).toMatchObject({
      origin: 'chatgpt_sidecar',
      sessionId: created.sessionId,
      tenantId: 'tenant-a',
      userId: 'user-a',
      capability: 'draft-datapoints',
      policyResult: 'allowed',
    });
    expect(dpCall.params.metadata.promptHash).toMatch(/^[a-f0-9]{16}$/);

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.draft_datapoint_created).toBe(1);
  });

  // ---------------------------------------------------------------------
  // Blocked write attempts increment blocked-policy metering
  // ---------------------------------------------------------------------

  it('blocks a non-draft write class without mutating and increments blocked metering', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      writeClass: 'controlled_write',
      value: { status: 'draft' },
    });

    expect(result.success).toBe(false);
    expect(result.decision).toBe('requires_confirmation');
    expect(calls.find((c) => c.action === 'datapoint.create')).toBeUndefined();

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts.blocked_policy_attempt).toBe(1);
    expect(metering.counts.draft_datapoint_created).toBeUndefined();
  });

  it('blocks a draft datapoint write when the session lacks the draft-datapoints capability', async () => {
    const created = await createSession({ capabilityProfile: ['knowledge-rag'] });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      value: { status: 'draft' },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('capability_not_granted');
    expect(calls.find((c) => c.action === 'datapoint.create')).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // Metering increments
  // ---------------------------------------------------------------------

  it('meters session creation, manifest reads, ask, plan and draft datapoint creation', async () => {
    const created = await createSession();
    const ticket = ticketFrom(created);

    await broker.call('chatgpt-sidecar.manifest', { ticket });
    await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie lautet der aktuelle Prozessstatus?',
    });
    await broker.call('chatgpt-sidecar.plan', { ticket, task: 'Evidenz fuer Redispatch pruefen' });
    await broker.call('chatgpt-sidecar.datapoints', { ticket, value: { status: 'draft' } });

    const metering = await broker.call('chatgpt-sidecar.metering', { ticket });
    expect(metering.counts).toMatchObject({
      session_created: 1,
      manifest_read: 1,
      ask_call: 1,
      plan_call: 1,
      draft_datapoint_created: 1,
    });
  });

  // ---------------------------------------------------------------------
  // Revocation is tenant-scoped
  // ---------------------------------------------------------------------

  it('does not allow a different tenant to revoke a session', async () => {
    const created = await createSession();
    await expect(
      broker.call(
        'chatgpt-sidecar.revokeSession',
        { sessionId: created.sessionId },
        {
          meta: {
            authUser: {
              tenantId: 'tenant-b',
              userId: 'user-b',
              roles: ['full-access', 'chatgpt-sidecar-creator'],
            },
          },
        }
      )
    ).rejects.toMatchObject({ code: 404, type: 'CHATGPT_SIDECAR_SESSION_NOT_FOUND' });
  });

  // ---------------------------------------------------------------------
  // #390: full-scope catalog expansion
  // ---------------------------------------------------------------------

  it('grants the full catalog via the "*" wildcard and groups it by domain in the manifest', async () => {
    const created = await createSession({ capabilityProfile: ['*'] });
    const ticket = ticketFrom(created);

    expect(created.capabilities.length).toBeGreaterThan(100);

    const manifest = await broker.call('chatgpt-sidecar.manifest', { ticket });
    expect(Object.keys(manifest.capabilityDomains).length).toBeGreaterThan(1);
    expect(manifest.capabilityDomains.platform).toEqual(
      expect.arrayContaining(['knowledge-rag', 'draft-datapoints'])
    );

    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/tenant-a|user-a/);
  });

  it('allows ask for a granted full-scope catalog capability id and blocks an ungranted one', async () => {
    const { FULL_CAPABILITY_CATALOG } = require('../src/chatgpt-sidecar-session-policy');
    const grantedId = FULL_CAPABILITY_CATALOG[0].id;
    const ungrantedId = FULL_CAPABILITY_CATALOG[1].id;

    const created = await createSession({ capabilityProfile: [grantedId] });
    const ticket = ticketFrom(created);

    const allowed = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie ist der aktuelle Evidenzstatus?',
      capability: grantedId,
    });
    expect(allowed.success).not.toBe(false);
    expect(calls.find((c) => c.action === 'personal-agent.askCernionAgent')).toBeTruthy();

    const blocked = await broker.call('chatgpt-sidecar.ask', {
      ticket,
      question: 'Wie ist der aktuelle Evidenzstatus?',
      capability: ungrantedId,
    });
    expect(blocked.success).toBe(false);
    expect(blocked.reason).toBe('capability_not_granted');
  });

  it('never mutates beyond draft_write even when the granted capability set is the full catalog', async () => {
    const created = await createSession({ capabilityProfile: ['*'] });
    const ticket = ticketFrom(created);

    const result = await broker.call('chatgpt-sidecar.datapoints', {
      ticket,
      writeClass: 'process_execute',
      value: { status: 'draft' },
    });

    expect(result.success).toBe(false);
    expect(result.decision).toBe('requires_confirmation');
    expect(calls.find((c) => c.action === 'datapoint.create')).toBeUndefined();
  });
});
