'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const NotificationService = require('../services/notification.service');
const EvidenceRevalidationService = require('../services/evidence-revalidation.service');
const ListenerService = require('../services/personal-agent-work-out-loud-listener.service');
const dispatchTypeDefinitions = require('../src/notification-dispatch-types.json');
const {
  PERSONAL_AGENT_WORK_OUT_LOUD_EVENT,
  WORK_OUT_LOUD_SIGNAL_TYPES,
  buildContextFieldWorkOutLoudPayload,
} = require('../src/personal-agent-work-out-loud');

// End-to-end proof that a later Work-Out-Loud fact-learning event — without
// any manual call to evidence-revalidation.correlateFact — auto-resolves an
// open evidence requirement and signals the *origin* session via the existing
// notification / persona-inbox path. See
// docs/v0.58-architecture/EVIDENCE_CARRY_FORWARD_ORIGIN_SIGNAL_SCENARIO.md
describe('personal-agent work-out-loud → evidence revalidation (integration)', () => {
  let broker;
  let notificationDbPath;
  let requirementDbPath;
  let inboxEntries;
  const personasByTenant = new Map();

  function tenantMeta(tenantId) {
    return { meta: { tenantId } };
  }

  beforeAll(async () => {
    notificationDbPath = path.join(os.tmpdir(), `wol-evr-notification-${Date.now()}`);
    requirementDbPath = path.join(os.tmpdir(), `wol-evr-requirements-${Date.now()}`);
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

    broker.createService(ListenerService);

    await broker.start();

    personasByTenant.set(
      'tenant-a',
      new Map([
        [
          'tenant-a/grid-planning',
          {
            id: 'tenant-a/grid-planning',
            tenantId: 'tenant-a',
            personaName: 'Netzplanung Sinsheim',
            personaType: 'human',
            assignedRoles: ['ROLE_GRID_PLANNER'],
            communicationChannels: [{ type: 'openclaw-chat', address: 'room-grid-planning' }],
            defaultPersonalAgentSessionId: 'pa-grid-planning-default',
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

  test('a later scoped_fact_learned Work-Out-Loud event auto-correlates and signals the origin session — no manual correlateFact call needed', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-wol-grid-operator',
        originSessionId: 'pa-origin-mayor-wol',
        originPersonaId: 'tenant-a/grid-planning',
        requestedFact: 'gridOperatorBdew',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );

    const payload = buildContextFieldWorkOutLoudPayload({
      tenantId: 'tenant-a',
      userId: 'user-grid-planner',
      signalType: WORK_OUT_LOUD_SIGNAL_TYPES.SCOPED_FACT_LEARNED,
      contextField: 'gridOperatorBdew',
      rawValue: '9907473000008',
      sourceKind: 'known_context',
      scope: 'tenant_operational',
      updateReason: 'known_context_merge',
    });

    const emitted = await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);
    expect(emitted).toBe(true);

    const inboxEntry = inboxEntries.find((entry) => entry.sessionId === 'pa-origin-mayor-wol');
    expect(inboxEntry).toMatchObject({
      tenantId: 'tenant-a',
      personaId: 'tenant-a/grid-planning',
      sessionId: 'pa-origin-mayor-wol',
      type: dispatchTypeDefinitions.evidence_revalidated.inbox.type,
      hitlItemId: null,
      title: dispatchTypeDefinitions.evidence_revalidated.inbox.title,
    });
    expect(inboxEntry.summary).toContain('evreq-wol-grid-operator');

    // No raw learned-fact value or session/prompt text leaks through the
    // Work-Out-Loud → correlation → notification → inbox chain.
    const serializedInbox = JSON.stringify(inboxEntry);
    expect(serializedInbox).not.toContain('9907473000008');
    expect(serializedInbox).not.toContain('gridOperatorBdew=');

    // Re-recording reflects the now-revalidated, persisted state — proving the
    // requirement actually flipped from 'missing' to 'updated' end-to-end.
    const refetched = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-wol-grid-operator',
        originSessionId: 'pa-origin-mayor-wol',
        originPersonaId: 'tenant-a/grid-planning',
        requestedFact: 'gridOperatorBdew',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );
    expect(refetched.deduplicated).toBe(true);
    expect(refetched.requirement.status).toBe('updated');
    expect(refetched.requirement.revalidatedAt).toEqual(expect.any(String));
  });

  test('bootstrap_context_updated events do not trigger correlation or origin-session signals', async () => {
    inboxEntries.length = 0;

    await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-wol-no-correlation',
        originSessionId: 'pa-origin-mayor-no-correlation',
        originPersonaId: 'tenant-a/grid-planning',
        requestedFact: 'organizationType',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );

    const payload = buildContextFieldWorkOutLoudPayload({
      tenantId: 'tenant-a',
      userId: 'user-grid-planner',
      signalType: WORK_OUT_LOUD_SIGNAL_TYPES.BOOTSTRAP_CONTEXT_UPDATED,
      contextField: 'organizationType',
      rawValue: 'utility',
      sourceKind: 'bootstrap_context',
      scope: 'user',
      updateReason: 'context_append',
    });

    await broker.emit(PERSONAL_AGENT_WORK_OUT_LOUD_EVENT, payload);

    const inboxEntry = inboxEntries.find(
      (entry) => entry.sessionId === 'pa-origin-mayor-no-correlation'
    );
    expect(inboxEntry).toBeUndefined();

    const stillOpen = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: 'evreq-wol-no-correlation',
        originSessionId: 'pa-origin-mayor-no-correlation',
        originPersonaId: 'tenant-a/grid-planning',
        requestedFact: 'organizationType',
        scope: 'tenant_candidate',
      },
      tenantMeta('tenant-a')
    );
    expect(stillOpen.requirement.status).toBe('missing');
  });
});
