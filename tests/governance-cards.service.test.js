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
