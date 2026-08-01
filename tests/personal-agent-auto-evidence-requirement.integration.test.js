'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const ObjectStoreService = require('../services/object-store.service');
const NotificationService = require('../services/notification.service');
const EvidenceRevalidationService = require('../services/evidence-revalidation.service');
const ListenerService = require('../services/personal-agent-work-out-loud-listener.service');
const PersonalAgentService = require('../services/personal-agent.service');
const dispatchTypeDefinitions = require('../src/notification-dispatch-types.json');

// End-to-end integration proof for "Auto Evidence Requirement + Root KnownContext" (Task 2):
//
// Part A: root knownContext.gridOperatorBdew → scoped datapoint → WoL scoped_fact_learned
// Part B: consultation missingEvidence with vnb_lookup_required → auto-records requirement
// Part C chain: chat (Turn 1) auto-registers requirement  →  chat (Turn 2) supplies
//               gridOperatorBdew via root knownContext  →  resolveScopedKnowledgeState
//               derives scoped datapoint  →  WoL emits scoped_fact_learned  →  listener
//               calls correlateFact  →  origin session receives evidence_revalidated proactive.

describe('personal-agent auto-evidence-requirement end-to-end (Part C)', () => {
  let broker;
  let objectStorePath;
  let notificationDbPath;
  let requirementDbPath;
  let inboxEntries;
  let svc;
  let originalHandleConsultationTurn;

  const TENANT = 'tenant-part-c';
  const META = { meta: { tenantId: TENANT, authUser: { userId: 'user-part-c' } } };

  beforeAll(async () => {
    objectStorePath = path.join(os.tmpdir(), `pa-e2e-store-${Date.now()}`);
    notificationDbPath = path.join(os.tmpdir(), `pa-e2e-notification-${Date.now()}`);
    requirementDbPath = path.join(os.tmpdir(), `pa-e2e-requirements-${Date.now()}`);
    inboxEntries = [];

    broker = new ServiceBroker({ logger: false });

    // ─── Session storage ──────────────────────────────────────────────────────
    broker.createService({
      ...ObjectStoreService,
      settings: { ...ObjectStoreService.settings, dbPath: objectStorePath },
    });

    // ─── Capability broker (minimal stub) ────────────────────────────────────
    broker.createService({
      name: 'capability-broker',
      actions: {
        recommend: {
          handler() {
            return {
              recommendation: 'consultation_general',
              capabilities: [],
              intent: 'grid_operator_evidence_check',
              capability: 'vnb_lookup',
              confidence: 0.85,
            };
          },
        },
      },
    });

    // ─── Receipt selection (disabled) ────────────────────────────────────────
    broker.createService({
      name: 'agent-receipts',
      actions: {
        select: {
          handler() {
            return {
              success: true,
              data: {
                selected: false,
                receiptId: null,
                status: null,
                mode: 'disabled',
                disableReceiptSelection: true,
                receipt: null,
                execution: null,
              },
            };
          },
        },
      },
    });

    // ─── Agent persona (required by notification dispatch) ───────────────────
    broker.createService({
      name: 'agent-persona',
      actions: {
        get: {
          handler(_ctx) {
            const err = new Error('persona not found');
            err.code = 404;
            err.type = 'PERSONA_NOT_FOUND';
            throw err;
          },
        },
        resolveByRole: {
          handler(ctx) {
            if (ctx.params.tenantId === TENANT && ctx.params.role === 'Netzplaner') {
              return {
                success: true,
                items: [
                  {
                    id: `${TENANT}/netzplaner`,
                    tenantId: TENANT,
                    personaName: 'Netzplanung',
                    personaType: 'human',
                    assignedRoles: ['Netzplaner'],
                    communicationChannels: [{ type: 'openclaw-chat', address: 'room-netzplanung' }],
                    defaultPersonalAgentSessionId: 'pa-netzplaner-default',
                    status: 'active',
                  },
                ],
                count: 1,
              };
            }
            return { success: true, items: [], count: 0 };
          },
        },
        resolvePersona: {
          handler() {
            return { success: false, resolvedPersona: null };
          },
        },
      },
    });

    // ─── Persona inbox (captures messages) ───────────────────────────────────
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

    // ─── Core services ────────────────────────────────────────────────────────
    broker.createService({
      ...NotificationService,
      settings: { ...NotificationService.settings, dbPath: notificationDbPath },
    });
    broker.createService({
      ...EvidenceRevalidationService,
      settings: { ...EvidenceRevalidationService.settings, dbPath: requirementDbPath },
    });
    broker.createService(ListenerService);
    broker.createService(PersonalAgentService);

    await broker.start();

    svc = broker.getLocalService('personal-agent');
    originalHandleConsultationTurn = svc.handleConsultationTurn.bind(svc);

    // Stub handleConsultationTurn to return controlled results.
    // Turn 1 returns a result with vnb_lookup_required missing evidence.
    // Turn 2 returns a clean result (no missing evidence) after gridOperatorBdew is supplied.
    let callCount = 0;
    svc.handleConsultationTurn = async function stubHandleConsultationTurn(_ctx, _input) {
      callCount += 1;
      if (callCount === 1) {
        // Turn 1: missing grid-operator evidence
        return {
          _isFallback: false,
          reply: 'Ich benötige noch Informationen zum Netzbetreiber.',
          hypotheses: [],
          openQuestions: ['Welcher Netzbetreiber ist zuständig?'],
          nextActions: [],
          factsUsed: [],
          attemptsSummary: [],
          toolTrace: [],
          workflowType: 'grid_operator_precheck',
          domainIntent: 'grid_operator_evidence_check',
          evidenceStatus: 'unverified',
          missingEvidence: [
            {
              id: 'vnb_lookup_required',
              label: 'Dedizierter VNB-/Netzgebietslookup fehlt.',
              severity: 'high',
            },
          ],
          nextVerificationSteps: [
            { action: 'grid-operations.vnbLookup', description: 'VNB verifizieren.' },
          ],
          guardrailCorrections: [],
        };
      }
      // Turn 2: gridOperatorBdew supplied — clean result
      return {
        _isFallback: false,
        reply: 'Der Netzbetreiber wurde erfasst.',
        hypotheses: [],
        openQuestions: [],
        nextActions: [],
        factsUsed: [],
        attemptsSummary: [],
        toolTrace: [],
        workflowType: 'grid_operator_precheck',
        domainIntent: 'grid_operator_evidence_check',
        evidenceStatus: 'verified',
        missingEvidence: [],
        nextVerificationSteps: [],
        guardrailCorrections: [],
      };
    };
  });

  afterAll(async () => {
    svc.handleConsultationTurn = originalHandleConsultationTurn;
    await broker.stop();
    fs.rmSync(objectStorePath, { recursive: true, force: true });
    fs.rmSync(notificationDbPath, { recursive: true, force: true });
    fs.rmSync(requirementDbPath, { recursive: true, force: true });
  });

  test('full chain: chat auto-registers requirement → later knownContext.gridOperatorBdew → WoL → correlateFact → evidence_revalidated inbox', async () => {
    inboxEntries.length = 0;

    const originSessionId = `pa-part-c-origin-${Date.now()}`;

    // ─── Step 1 (Part B): Turn 1 — chat with responsibleRole and VNB signal ───
    // Personal-agent should auto-register an evidence requirement because
    // consultationPayload.missingEvidence contains vnb_lookup_required AND
    // knownContext.responsibleRole is 'Netzplaner'.
    const turn1 = await broker.call(
      'personal-agent.chat',
      {
        message: 'Welcher VNB ist für unseren Standort zuständig?',
        chatMode: 'consultation',
        executionMode: 'auto',
        sessionId: originSessionId,
        knownContext: {
          responsibleRole: 'Netzplaner',
        },
      },
      META
    );

    expect(turn1.success).toBe(true);
    expect(turn1.missingEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'vnb_lookup_required' })])
    );

    // Allow the fire-and-forget recordRequirement call to complete.
    await new Promise((r) => setTimeout(r, 200));

    // ─── Verify Step 1: requirement is persisted ─────────────────────────────
    const expectedRequirementId = `evreq:${originSessionId}:gridOperatorBdew`;
    const recordedRequirement = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: expectedRequirementId,
        originSessionId,
        responsibleRole: 'Netzplaner',
        requestedFact: 'gridOperatorBdew',
        scope: 'tenant_candidate',
      },
      META
    );

    expect(recordedRequirement.deduplicated).toBe(true);
    expect(recordedRequirement.requirement.originSessionId).toBe(originSessionId);
    expect(recordedRequirement.requirement.requestedFact).toBe('gridOperatorBdew');
    expect(recordedRequirement.requirement.status).toBe('missing');

    // ─── Step 2 (Parts A + Part C): Turn 2 — supply gridOperatorBdew ─────────
    // resolveScopedKnowledgeState derives a new tenant_candidate datapoint,
    // emitScopedKnowledgeWorkOutLoud emits scoped_fact_learned,
    // listener auto-calls correlateFact,
    // correlateFact dispatches evidence_revalidated to the origin session.
    const laterSessionId = `pa-part-c-later-${Date.now()}`;
    const turn2 = await broker.call(
      'personal-agent.chat',
      {
        message: 'Ich habe die BDEW-Codenummer vom Netzbetreiber erhalten.',
        chatMode: 'consultation',
        executionMode: 'auto',
        sessionId: laterSessionId,
        knownContext: {
          gridOperatorBdew: '9907473000008',
        },
      },
      META
    );

    expect(turn2.success).toBe(true);

    // Part A assertion: gridOperatorBdew produced a tenant_candidate scoped datapoint
    expect(turn2.agentTrace?.knowledgeScope?.byScope?.tenant_candidate).toBeGreaterThanOrEqual(1);

    // Allow the async WoL → listener → correlateFact → notification → inbox chain to complete.
    await new Promise((r) => setTimeout(r, 400));

    // ─── Step 3 (Part C): origin session inbox receives evidence_revalidated ───
    const inboxEntry = inboxEntries.find((entry) => entry.sessionId === originSessionId);
    expect(inboxEntry).toMatchObject({
      tenantId: TENANT,
      sessionId: originSessionId,
      type: dispatchTypeDefinitions.evidence_revalidated.inbox.type,
      title: dispatchTypeDefinitions.evidence_revalidated.inbox.title,
    });
    expect(inboxEntry.summary).toContain(expectedRequirementId);

    // ─── Privacy guard: no raw values or prompt text in the inbox chain ───────
    const serialized = JSON.stringify(inboxEntry);
    expect(serialized).not.toContain('9907473000008');
    expect(serialized).not.toContain('Welcher VNB');
    expect(serialized).not.toContain('BDEW-Codenummer');

    // ─── Verify requirement flipped to 'updated' after correlation ────────────
    const refetched = await broker.call(
      'evidence-revalidation.recordRequirement',
      {
        evidenceRequirementId: expectedRequirementId,
        originSessionId,
        responsibleRole: 'Netzplaner',
        requestedFact: 'gridOperatorBdew',
        scope: 'tenant_candidate',
      },
      META
    );
    expect(refetched.deduplicated).toBe(true);
    expect(refetched.requirement.status).toBe('updated');
    expect(refetched.requirement.revalidatedAt).toEqual(expect.any(String));
  }, 15000);

  test('no evidence_revalidated inbox when no responsibleRole or personaId in knownContext (no recipient → auto-registration skipped)', async () => {
    inboxEntries.length = 0;

    const sessionId = `pa-part-c-no-recipient-${Date.now()}`;
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Welcher VNB ist für unseren Standort zuständig?',
        chatMode: 'consultation',
        executionMode: 'auto',
        sessionId,
        knownContext: {},
      },
      META
    );

    expect(result.success).toBe(true);

    await new Promise((r) => setTimeout(r, 300));

    // No requirement should have been recorded (since no personaId or responsibleRole)
    // so no correlation or inbox message can follow.
    const inboxForSession = inboxEntries.filter((e) => e.sessionId === sessionId);
    expect(inboxForSession).toHaveLength(0);
  });
});
