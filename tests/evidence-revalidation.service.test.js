'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const NotificationService = require('../services/notification.service');
const EvidenceRevalidationService = require('../services/evidence-revalidation.service');
const dispatchTypeDefinitions = require('../src/notification-dispatch-types.json');

describe('evidence revalidation service', () => {
  let broker;
  let notificationDbPath;
  let requirementDbPath;
  let inboxEntries;
  const personasByTenant = new Map();

  function tenantMeta(tenantId) {
    return { meta: { tenantId } };
  }

  beforeAll(async () => {
    notificationDbPath = path.join(os.tmpdir(), `evidence-reval-notification-${Date.now()}`);
    requirementDbPath = path.join(os.tmpdir(), `evidence-reval-requirements-${Date.now()}`);
    inboxEntries = [];

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      name: 'agent-persona',
      actions: {
        get: {
          handler(ctx) {
            const tenantPersonas = personasByTenant.get(ctx.params.tenantId) || new Map();
            const persona = tenantPersonas.get(ctx.params.id);
            if (!persona) {
              const error = new Error('persona not found');
              error.code = 404;
              error.type = 'PERSONA_NOT_FOUND';
              throw error;
            }
            return { success: true, item: persona };
          },
        },
        resolveByRole: {
          handler(ctx) {
            const tenantPersonas = personasByTenant.get(ctx.params.tenantId) || new Map();
            const items = [...tenantPersonas.values()].filter(
              (persona) =>
                Array.isArray(persona.assignedRoles) &&
                persona.assignedRoles.includes(ctx.params.role)
            );
            return { success: true, items, count: items.length };
          },
        },
      },
    });

    broker.createService({
      name: 'persona-inbox',
      actions: {
        enqueue: {
          handler(ctx) {
            const item = {
              id: `inbox-${inboxEntries.length + 1}`,
              tenantId: ctx.params.tenantId,
              personaId: ctx.params.personaId,
              sessionId: ctx.params.sessionId || null,
              type: ctx.params.type,
              hitlItemId: ctx.params.hitlItemId,
              embedRef: ctx.params.embedRef,
              title: ctx.params.title,
              summary: ctx.params.summary,
              status: 'queued',
              createdAt: new Date().toISOString(),
            };
            inboxEntries.push(item);
            return { success: true, item };
          },
        },
      },
    });

    broker.createService({
      ...NotificationService,
      settings: { ...NotificationService.settings, dbPath: notificationDbPath },
    });

    broker.createService({
      ...EvidenceRevalidationService,
      settings: { ...EvidenceRevalidationService.settings, dbPath: requirementDbPath },
    });

    await broker.start();

    personasByTenant.set(
      'tenant-a',
      new Map([
        [
          'tenant-a/mayor',
          {
            id: 'tenant-a/mayor',
            tenantId: 'tenant-a',
            personaName: 'Buergermeister Sinsheim',
            personaType: 'human',
            assignedRoles: ['ROLE_MAYOR'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'room-mayor-sinsheim' }],
            defaultPersonalAgentSessionId: 'pa-mayor-default',
            status: 'active',
          },
        ],
      ])
    );

    personasByTenant.set(
      'tenant-b',
      new Map([
        [
          'tenant-b/mayor',
          {
            id: 'tenant-b/mayor',
            tenantId: 'tenant-b',
            personaName: 'Tenant B Mayor',
            personaType: 'human',
            assignedRoles: ['ROLE_MAYOR'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'room-mayor-tenant-b' }],
            defaultPersonalAgentSessionId: 'pa-mayor-tenant-b-default',
            status: 'active',
          },
        ],
      ])
    );

    // Heidelberg — operative EVU-Personas (simulates seedOperationalDefaults result)
    personasByTenant.set(
      'heidelberg',
      new Map([
        [
          'evu-customer-service',
          {
            id: 'evu-customer-service',
            tenantId: 'heidelberg',
            personaName: 'Kundendienst',
            personaType: 'specialized-agent',
            assignedRoles: ['customer-service'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'ops-customer-service' }],
            defaultPersonalAgentSessionId: 'pa-default-customer-service',
            status: 'active',
          },
        ],
        [
          'evu-edm',
          {
            id: 'evu-edm',
            tenantId: 'heidelberg',
            personaName: 'Energiedatenmanagement (EDM)',
            personaType: 'specialized-agent',
            assignedRoles: ['edm'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'ops-edm' }],
            defaultPersonalAgentSessionId: 'pa-default-edm',
            status: 'active',
          },
        ],
        [
          'evu-billing',
          {
            id: 'evu-billing',
            tenantId: 'heidelberg',
            personaName: 'Abrechnung',
            personaType: 'specialized-agent',
            assignedRoles: ['billing'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'ops-billing' }],
            defaultPersonalAgentSessionId: 'pa-default-billing',
            status: 'active',
          },
        ],
      ])
    );
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(notificationDbPath, { recursive: true, force: true });
    fs.rmSync(requirementDbPath, { recursive: true, force: true });
  });

  test('persists only structured fields — no raw prompt or chat text leakage', async () => {
    const rawPrompt =
      'Sehr geehrter Herr Buergermeister, anbei der vollstaendige Chatverlauf mit vertraulichen Interna ueber das Netzgebiet Sinsheim...';

    const result = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-sinsheim-grid-operator',
        originSessionId: 'pa-origin-mayor-sinsheim',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'gridOperatorBdew',
        scope: 'tenant_candidate',
        // a careless caller might try to attach raw context — it must be dropped
        rawPrompt,
        promptExcerpt: rawPrompt.slice(0, 40),
        answerText: 'Die Antwort ist vorlaeufig, da der Netzbetreiber unbekannt ist.',
      },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    expect(result.requirement).toEqual({
      type: 'evidence-requirement',
      tenantId: 'tenant-a',
      evidenceRequirementId: 'evreq-sinsheim-grid-operator',
      originSessionId: 'pa-origin-mayor-sinsheim',
      originPersonaId: 'tenant-a/mayor',
      responsibleRole: null,
      requestedFact: 'gridOperatorBdew',
      scope: 'tenant_candidate',
      status: 'missing',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      revalidatedAt: null,
      lastDispatchId: null,
    });

    const serialized = JSON.stringify(result.requirement);
    expect(serialized).not.toContain('Chatverlauf');
    expect(serialized).not.toContain('vertraulichen');
    expect(serialized).not.toContain('vorlaeufig');
    expect(result.requirement).not.toHaveProperty('rawPrompt');
    expect(result.requirement).not.toHaveProperty('promptExcerpt');
    expect(result.requirement).not.toHaveProperty('answerText');
  });

  test('recording a requirement without a recipient is rejected', async () => {
    await expect(
      broker.call(
        'evidence-revalidation.recordRequirement',
        {
          evidenceRequirementId: 'evreq-missing-recipient',
          originSessionId: 'pa-origin-missing-recipient',
          requestedFact: 'gridOperatorBdew',
          scope: 'tenant_candidate',
        },
        tenantMeta('tenant-a')
      )
    ).rejects.toMatchObject({ type: 'VALIDATION_ERROR' });
  });

  test('same-tenant fact correlation revalidates the requirement and signals the origin session', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-sinsheim-grid-operator-2',
        originSessionId: 'pa-origin-mayor-sinsheim-2',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'gridOperatorBdew',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );

    const result = await broker.call(
      'evidence-revalidation.correlateFact',
      { requestedFact: 'gridOperatorBdew' },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    const match = result.correlated.find(
      (entry) => entry.evidenceRequirementId === 'evreq-sinsheim-grid-operator-2'
    );
    expect(match).toMatchObject({
      evidenceRequirementId: 'evreq-sinsheim-grid-operator-2',
      originSessionId: 'pa-origin-mayor-sinsheim-2',
      status: 'updated',
    });
    expect(match.dispatch).toMatchObject({ status: 'queued', deduplicated: false });
    expect(match.dispatch.dispatchId).toEqual(expect.any(String));

    const inboxEntry = inboxEntries.find(
      (entry) => entry.sessionId === 'pa-origin-mayor-sinsheim-2'
    );
    expect(inboxEntry).toMatchObject({
      tenantId: 'tenant-a',
      personaId: 'tenant-a/mayor',
      sessionId: 'pa-origin-mayor-sinsheim-2',
      type: dispatchTypeDefinitions.evidence_revalidated.inbox.type,
      hitlItemId: null,
      title: dispatchTypeDefinitions.evidence_revalidated.inbox.title,
    });
    expect(inboxEntry.summary).toContain('evreq-sinsheim-grid-operator-2');
    expect(JSON.stringify(inboxEntry)).not.toContain('gridOperatorBdew=');

    // re-recording is idempotent and now reflects the revalidated, persisted state
    const refetched = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-sinsheim-grid-operator-2',
        originSessionId: 'pa-origin-mayor-sinsheim-2',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'gridOperatorBdew',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );
    expect(refetched.deduplicated).toBe(true);
    expect(refetched.requirement.status).toBe('updated');
    expect(refetched.requirement.revalidatedAt).toEqual(expect.any(String));
    expect(refetched.requirement.lastDispatchId).toBe(match.dispatch.dispatchId);
  });

  test('cross-tenant fact does not correlate to another tenant’s requirement', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-cross-tenant-grid-operator',
        originSessionId: 'pa-origin-tenant-a-cross',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'gridOperatorBdewCrossTenant',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );

    const crossTenantResult = await broker.call(
      'evidence-revalidation.correlateFact',
      { requestedFact: 'gridOperatorBdewCrossTenant' },
      tenantMeta('tenant-b')
    );

    expect(crossTenantResult.success).toBe(true);
    expect(crossTenantResult.matchedCount).toBe(0);
    expect(crossTenantResult.correlated).toHaveLength(0);
    expect(inboxEntries).toHaveLength(0);

    // the requirement remains open ('missing') — untouched by the other tenant
    const stillOpen = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-cross-tenant-grid-operator',
        originSessionId: 'pa-origin-tenant-a-cross',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'gridOperatorBdewCrossTenant',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );
    expect(stillOpen.deduplicated).toBe(true);
    expect(stillOpen.requirement.status).toBe('missing');

    // the same fact, correlated within its own tenant, resolves it
    const sameTenantResult = await broker.call(
      'evidence-revalidation.correlateFact',
      { requestedFact: 'gridOperatorBdewCrossTenant' },
      tenantMeta('tenant-a')
    );
    expect(sameTenantResult.matchedCount).toBe(1);
    expect(sameTenantResult.correlated[0].status).toBe('updated');
  });

  test('responsibleRole-based requirements correlate via role resolution', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-role-based',
        originSessionId: 'pa-origin-role-based',
        responsibleRole: 'ROLE_MAYOR',
        requestedFact: 'gridOperatorBdewRoleBased',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );

    const result = await broker.call(
      'evidence-revalidation.correlateFact',
      { requestedFact: 'gridOperatorBdewRoleBased' },
      tenantMeta('tenant-a')
    );

    expect(result.matchedCount).toBe(1);
    expect(result.correlated[0]).toMatchObject({ status: 'updated' });
    expect(result.correlated[0].dispatch.status).toBe('queued');

    const inboxEntry = inboxEntries.find((entry) => entry.sessionId === 'pa-origin-role-based');
    expect(inboxEntry).toBeDefined();
    expect(inboxEntry.personaId).toBe('tenant-a/mayor');
  });

  test('object scope is accepted, normalized, and scopeHash is not exposed in public output', async () => {
    const result = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-scope-obj-norm',
        originSessionId: 'pa-session-scope-obj-norm',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'scopeNormalizationTestFact',
        scope: {
          contractAccount: '  CA456  ',
          meterNumber: 'M123',
          nullField: null,
          emptyField: '',
          meteringPointId: 'MP99',
        },
      },
      tenantMeta('tenant-a')
    );

    expect(result.success).toBe(true);
    // Keys are sorted, values trimmed, null/empty entries removed
    expect(result.requirement.scope).toEqual({
      contractAccount: 'CA456',
      meteringPointId: 'MP99',
      meterNumber: 'M123',
    });
    // scopeHash is an internal implementation detail — must not leak
    expect(result.requirement).not.toHaveProperty('scopeHash');
    expect(result.requirement.status).toBe('missing');
  });

  test('scoped correlateFact for moveOut matches only the correct meter/contract — same identifiers matched 1, different matched 0', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-moveout-M123',
        originSessionId: 'pa-session-moveout-M123',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'M123', contractAccount: 'CA456' },
      },
      tenantMeta('tenant-a')
    );

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-moveout-M789',
        originSessionId: 'pa-session-moveout-M789',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'M789', contractAccount: 'CA999' },
      },
      tenantMeta('tenant-a')
    );

    // Correlate with M123's identifiers — must match exactly 1
    const result = await broker.call(
      'evidence-revalidation.correlateFact',
      {
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'M123', contractAccount: 'CA456' },
      },
      tenantMeta('tenant-a')
    );

    expect(result.matchedCount).toBe(1);
    expect(result.correlated[0].evidenceRequirementId).toBe('evreq-moveout-M123');

    // M789 requirement must still be 'missing' — not touched by M123's correlation
    const refetchM789 = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-moveout-M789',
        originSessionId: 'pa-session-moveout-M789',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'M789', contractAccount: 'CA999' },
      },
      tenantMeta('tenant-a')
    );
    expect(refetchM789.requirement.status).toBe('missing');
    expect(inboxEntries.filter((e) => e.sessionId === 'pa-session-moveout-M789')).toHaveLength(0);
  });

  test('correlateFact without scope uses legacy behaviour — matches regardless of stored object scope', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-legacy-unscoped',
        originSessionId: 'pa-session-legacy-unscoped',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'unscoped-compat-fact',
        scope: { meterNumber: 'X999' },
      },
      tenantMeta('tenant-a')
    );

    // No scope in correlateFact → old path, should match on requestedFact alone
    const result = await broker.call(
      'evidence-revalidation.correlateFact',
      { requestedFact: 'unscoped-compat-fact' },
      tenantMeta('tenant-a')
    );

    expect(result.matchedCount).toBe(1);
    expect(result.correlated[0].evidenceRequirementId).toBe('evreq-legacy-unscoped');
  });

  test('cross-tenant scoped correlateFact does not match — even with identical scope identifiers', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-xtenant-scoped',
        originSessionId: 'pa-session-xtenant-scoped',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'XMATCH', contractAccount: 'CA_SHARED' },
      },
      tenantMeta('tenant-a')
    );

    const result = await broker.call(
      'evidence-revalidation.correlateFact',
      {
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'XMATCH', contractAccount: 'CA_SHARED' },
      },
      tenantMeta('tenant-b')
    );

    expect(result.matchedCount).toBe(0);
    expect(inboxEntries).toHaveLength(0);
  });

  test('repeated scoped correlation is idempotent — updated requirement is not re-matched', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-scoped-idempotent',
        originSessionId: 'pa-session-scoped-idempotent',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'MIDEM', contractAccount: 'CAIDEM' },
      },
      tenantMeta('tenant-a')
    );

    const first = await broker.call(
      'evidence-revalidation.correlateFact',
      {
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'MIDEM', contractAccount: 'CAIDEM' },
      },
      tenantMeta('tenant-a')
    );
    const second = await broker.call(
      'evidence-revalidation.correlateFact',
      {
        requestedFact: 'moveOutFinalReadingStatus',
        scope: { meterNumber: 'MIDEM', contractAccount: 'CAIDEM' },
      },
      tenantMeta('tenant-a')
    );

    expect(first.matchedCount).toBe(1);
    expect(second.matchedCount).toBe(0);
    expect(second.correlated).toHaveLength(0);
  });

  test('repeated fact correlation is idempotent — single dispatch and origin-session signal', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-idempotency-check',
        originSessionId: 'pa-origin-idempotency-check',
        originPersonaId: 'tenant-a/mayor',
        requestedFact: 'gridOperatorBdewIdempotency',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );

    const first = await broker.call(
      'evidence-revalidation.correlateFact',
      { requestedFact: 'gridOperatorBdewIdempotency' },
      tenantMeta('tenant-a')
    );
    const second = await broker.call(
      'evidence-revalidation.correlateFact',
      { requestedFact: 'gridOperatorBdewIdempotency' },
      tenantMeta('tenant-a')
    );

    expect(first.matchedCount).toBe(1);
    expect(first.correlated[0].dispatch.deduplicated).toBe(false);
    expect(second.matchedCount).toBe(0);
    expect(second.correlated).toHaveLength(0);

    const signalEntries = inboxEntries.filter(
      (entry) => entry.sessionId === 'pa-origin-idempotency-check'
    );
    expect(signalEntries).toHaveLength(1);

    const dispatches = await broker.call('notification.listDispatches', {}, tenantMeta('tenant-a'));
    const matchingDispatches = dispatches.items.filter(
      (item) => item.payload?.evidenceRequirementId === 'evreq-idempotency-check'
    );
    expect(matchingDispatches).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Heidelberg Move-Out integration — EVU customer-service seed → evidence_revalidated
  // ---------------------------------------------------------------------------

  test('Heidelberg: seeded customer-service → scoped moveOut requirement → correlateFact → evidence_revalidated inbox (no unresolved_recipient)', async () => {
    inboxEntries.length = 0;

    // Record a moveOut evidence requirement with responsibleRole (no originPersonaId).
    // The heidelberg tenant has evu-customer-service seeded in the mock persona registry.
    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-hd-moveout-cs-001',
        originSessionId: 'pa-origin-hd-customer-service-test',
        responsibleRole: 'customer-service',
        requestedFact: 'moveOutFinalReadingStatus',
        scope: {
          meterNumber: 'HD-M-001',
          meteringPointId: 'DE001HD0001',
          contractAccount: 'HD-CA-001',
        },
      },
      { meta: { tenantId: 'heidelberg' } }
    );

    // Scoped correlateFact — must resolve exactly this requirement
    const result = await broker.call(
      'evidence-revalidation.correlateFact',
      {
        requestedFact: 'moveOutFinalReadingStatus',
        scope: {
          meterNumber: 'HD-M-001',
          meteringPointId: 'DE001HD0001',
          contractAccount: 'HD-CA-001',
        },
      },
      { meta: { tenantId: 'heidelberg' } }
    );

    expect(result.matchedCount).toBe(1);
    expect(result.correlated[0].evidenceRequirementId).toBe('evreq-hd-moveout-cs-001');
    expect(result.correlated[0].status).toBe('updated');

    // Dispatch must not be unresolved_recipient — customer-service is resolvable
    expect(result.correlated[0].dispatch.status).not.toBe('unresolved_recipient');
    expect(result.correlated[0].dispatch.status).toBe('queued');

    // Persona-inbox entry must exist for the origin session
    const inboxEntry = inboxEntries.find(
      (entry) => entry.sessionId === 'pa-origin-hd-customer-service-test'
    );
    expect(inboxEntry).toBeDefined();
    expect(inboxEntry.personaId).toBe('evu-customer-service');
    expect(inboxEntry.tenantId).toBe('heidelberg');
    expect(inboxEntry.type).toBe('evidence-revalidated');
  });
});
