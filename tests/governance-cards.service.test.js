'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const GovernanceCards = require('../services/governance-cards.service');

const meta = {
  apiToken: {
    tenantId: 'tenant-a',
    id: 'actor-a',
    scope: 'agentos-session',
    roles: ['ROLE_UTILITY_HQ', 'ROLE_TENANT_ADMIN'],
  },
};
const tenantBMeta = {
  apiToken: {
    tenantId: 'tenant-b',
    id: 'actor-b',
    scope: 'agentos-session',
    roles: ['ROLE_UTILITY_HQ'],
  },
};
const clone = (value) => JSON.parse(JSON.stringify(value));

describe('Governance Cards service', () => {
  let broker, dir;
  const call = (action, params = {}, auth = meta) =>
    broker.call(`governance-cards.${action}`, params, { meta: clone(auth) });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-governance-cards-'));
    broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 2000 });
    broker.createService({
      ...GovernanceCards,
      settings: {
        dbPath: path.join(dir, 'cards'),
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function validCard(overrides = {}) {
    return {
      cardType: 'generic_governance_signal',
      title: 'Supplier process signal',
      triggerSummary: 'A bounded governance signal requires relevance review.',
      affectedDomain: 'market_communication',
      affectedProcess: 'MSCONS clarification',
      ownerRole: 'ROLE_MARKET_COMMUNICATION',
      nextGate: 'Review evidence and assign follow-up owner.',
      riskTypes: ['process_risk'],
      managementRelevance: 'line',
      decisionSignal: 'review',
      ...overrides,
    };
  }

  test('lists UI-safe card types with required fields and transitions', async () => {
    const response = await call('listTypes');
    expect(response.schemaVersion).toBe('governance-cards.v1');
    expect(response.items.length).toBeGreaterThanOrEqual(2);
    const generic = response.items.find((item) => item.cardType === 'generic_governance_signal');
    expect(generic.requiredFields).toEqual(expect.arrayContaining(['title', 'triggerSummary']));
    expect(generic.allowedTransitions.draft).toEqual(
      expect.arrayContaining(['review', 'assigned'])
    );
  });

  test('exposes regulatory impulse workflow metadata and creates cards from regulatory fields', async () => {
    const types = await call('listTypes');
    const regulatory = types.items.find((item) => item.cardType === 'regulatory_impulse');
    expect(regulatory).toMatchObject({
      title: 'Regulatory impulse',
      allowedRiskTypes: expect.arrayContaining(['compliance', 'deadline', 'commercial-impact']),
      processFlow: expect.arrayContaining(['relevance screen', 'owner and review task']),
    });
    expect(regulatory.fieldBlocks.map((block) => block.blockId)).toEqual([
      'signal_finding',
      'relevance_risk',
      'feedback_decision_signal',
    ]);

    const created = await call('createCard', {
      cardType: 'regulatory_impulse',
      regulatoryImpulseSummary: 'New regulatory signal may affect MaKo evidence deadlines.',
      sourceDescription: 'authority note / advisory signal',
      affectedDomain: 'market_communication',
      affectedProcess: 'MSCONS clarification and evidence retention',
      possibleEffectiveDate: '2026-10-31',
      initialAssessment: 'Potential evidence-duty and deadline effect needs review.',
      riskTypes: ['evidence-duty', 'deadline', 'commercial-impact'],
      ownerRole: 'ROLE_REGULATORY_AFFAIRS',
      deadline: '2026-10-15',
      workOrder: 'Screen affected process, owner and deadline effect.',
      managementRelevance: 'line-review',
      decisionSignal: 'assign',
    });

    expect(created.card).toMatchObject({
      cardType: 'regulatory_impulse',
      title: 'New regulatory signal may affect MaKo evidence deadlines.',
      triggerSummary: 'New regulatory signal may affect MaKo evidence deadlines.',
      sourceKind: 'authority note / advisory signal',
      affectedProcess: 'MSCONS clarification and evidence retention',
      effectiveDate: '2026-10-31',
      impactSummary: 'Potential evidence-duty and deadline effect needs review.',
      nextGate: 'Screen affected process, owner and deadline effect.',
      followUpRequired: false,
      decisionSignal: 'assign',
    });

    const listed = await call('listCards', {
      cardType: 'regulatory_impulse',
      riskType: 'deadline',
      managementRelevance: 'line-review',
    });
    expect(listed.items.map((card) => card.cardId)).toContain(created.card.cardId);
  });

  test('validates required fields with positive missing-field guidance', async () => {
    await expect(call('createCard', { cardType: 'regulatory_impulse' })).rejects.toMatchObject({
      code: 422,
      type: 'GOVERNANCE_CARD_MISSING_FIELDS',
      data: expect.objectContaining({
        missingFields: expect.arrayContaining(['title', 'deadline']),
      }),
    });
  });

  test('creates, lists, reads and summarizes tenant-scoped cards', async () => {
    const created = await call('createCard', validCard());
    expect(created.card.cardId).toMatch(/^gcard_/);
    expect(created.card.tenantId).toBe('tenant-a');
    expect(created.card.status).toBe('draft');

    const listed = await call('listCards', {
      cardType: 'generic_governance_signal',
      status: 'draft',
      ownerRole: 'ROLE_MARKET_COMMUNICATION',
      riskType: 'process_risk',
      managementRelevance: 'line',
    });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].cardId).toBe(created.card.cardId);

    const fetched = await call('getCard', { cardId: created.card.cardId });
    expect(fetched.card.title).toBe('Supplier process signal');

    const summary = await call('summarizeForDossier', { cardId: created.card.cardId });
    expect(summary.summary).toMatchObject({
      cardId: created.card.cardId,
      status: 'draft',
      nextGate: 'Review evidence and assign follow-up owner.',
    });
    expect(summary.summary.noCallGuards[0]).toMatch(/do not execute external/i);
  });

  test('enforces tenant isolation', async () => {
    const created = await call('createCard', validCard());
    await expect(
      call('getCard', { cardId: created.card.cardId }, tenantBMeta)
    ).rejects.toMatchObject({
      code: 404,
      type: 'GOVERNANCE_CARD_NOT_FOUND',
    });
    const listed = await call('listCards', {}, tenantBMeta);
    expect(listed.items).toHaveLength(0);
  });

  test('projects attention snapshots without mutating card timestamps', async () => {
    const created = await call(
      'createCard',
      validCard({
        deadline: '2020-01-01',
        managementRelevance: 'executive-review',
      })
    );
    const before = await call('getCard', { cardId: created.card.cardId });
    const snapshot = await call('getAttentionSnapshot');
    const after = await call('getCard', { cardId: created.card.cardId });

    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardId: created.card.cardId,
          reasons: expect.arrayContaining(['overdue_deadline', 'executive_visible']),
        }),
      ])
    );
    expect(after.card.updatedAt).toBe(before.card.updatedAt);
  });

  test('supports owner confirmation, blocked state, follow-up date and closure commands', async () => {
    const created = await call('createCard', validCard({ deadline: '2026-12-31' }));
    const confirmed = await call('confirmOwner', { cardId: created.card.cardId });
    expect(confirmed.card.ownerConfirmationStatus).toBe('confirmed');
    expect(confirmed.card.auditTrail.some((entry) => entry.action === 'owner_confirmed')).toBe(
      true
    );

    const blocked = await call('markBlocked', {
      cardId: created.card.cardId,
      blockedReason: 'Missing evidence pointer from the responsible line.',
    });
    expect(blocked.card.blockedReason).toMatch(/Missing evidence/);

    const followUp = await call('setFollowUpDate', {
      cardId: created.card.cardId,
      followUpDate: '2026-11-30',
    });
    expect(followUp.card.followUpDate).toBe('2026-11-30');

    const line = await call('summarizeForLineFeedback', { cardId: created.card.cardId });
    expect(line.summary).toMatchObject({
      cardId: created.card.cardId,
      missingOrBlocked: 'Missing evidence pointer from the responsible line.',
      whatHappensNext: 'Review evidence and assign follow-up owner.',
    });

    const executive = await call('summarizeForExecutiveReview', { cardId: created.card.cardId });
    expect(executive.summary.noCallGuards[0]).toMatch(/do not approve/i);

    const closed = await call('closeWithRationale', {
      cardId: created.card.cardId,
      rationale: 'Reviewed and parked with evidence pointer for next cycle.',
    });
    expect(closed.card.status).toBe('closed');
    expect(closed.card.closureRationale).toMatch(/Reviewed and parked/);
  });

  test('supports allowed transitions and blocks invalid transitions', async () => {
    const created = await call('createCard', validCard());
    const reviewed = await call('transition', { cardId: created.card.cardId, status: 'review' });
    expect(reviewed.card.status).toBe('review');

    await expect(
      call('transition', { cardId: created.card.cardId, status: 'completed' })
    ).rejects.toMatchObject({ type: 'GOVERNANCE_CARD_TRANSITION_BLOCKED' });
  });

  test('adds evidence refs and bounded comments without raw payload expansion', async () => {
    const created = await call('createCard', validCard());
    const withEvidence = await call('addEvidenceRef', {
      cardId: created.card.cardId,
      evidenceRef: {
        evidenceId: 'ev-1',
        label: 'Evidence label',
        sourceType: 'willi_mako_ref',
        rawPayload: '<secret>ignored</secret>',
      },
    });
    expect(withEvidence.card.evidenceRefs).toEqual([
      { evidenceId: 'ev-1', label: 'Evidence label', sourceType: 'willi_mako_ref' },
    ]);

    const commented = await call('addComment', {
      cardId: created.card.cardId,
      comment: 'Review APERAK segment before owner assignment.',
    });
    expect(commented.card.auditTrail.some((entry) => entry.action === 'comment_added')).toBe(true);
  });
});
