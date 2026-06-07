'use strict';

const { ServiceBroker } = require('moleculer');
const { _resetCache } = require('../src/rcs-rule-registry');

let broker;

beforeAll(async () => {
  _resetCache();
  broker = new ServiceBroker({ logger: false, transporter: null });
  broker.loadService('./services/rcs-rule-catalog.service.js');
  await broker.start();
});

afterAll(async () => {
  await broker.stop();
  _resetCache();
});

// ── listRuleSets ──────────────────────────────────────────────────────────────

describe('rcs-rule-catalog.listRuleSets', () => {
  test('returns success, latestRuleSetId, total, and items array', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', {});
    expect(r.success).toBe(true);
    expect(typeof r.latestRuleSetId).toBe('string');
    expect(typeof r.total).toBe('number');
    expect(Array.isArray(r.items)).toBe(true);
  });

  test('latestRuleSetId matches the active rule with isLatest: true', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', {});
    const latest = r.items.find((i) => i.isLatest);
    expect(latest).toBeDefined();
    expect(latest.id).toBe(r.latestRuleSetId);
    expect(latest.status).toMatch(/^(active|in_kraft)$/);
  });

  test('default: superseded rules are excluded', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', {});
    const superseded = r.items.filter((i) => i.status === 'superseded');
    expect(superseded).toHaveLength(0);
  });

  test('includeSuperseded: true returns superseded rules', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', { includeSuperseded: true });
    const superseded = r.items.filter((i) => i.status === 'superseded');
    expect(superseded.length).toBeGreaterThan(0);
  });

  test('filter by status: active returns only active rules', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', { status: 'active' });
    expect(r.items.every((i) => i.status === 'active')).toBe(true);
  });

  test('filter by legalStatus: referentenentwurf returns only those rules', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', {
      legalStatus: 'referentenentwurf',
    });
    expect(r.items.every((i) => i.legalStatus === 'referentenentwurf')).toBe(true);
  });

  test('filter by calculationMode: eeg2027_clawback', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', {
      calculationMode: 'eeg2027_clawback',
    });
    expect(r.items.every((i) => i.calculationMode === 'eeg2027_clawback')).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });

  test('items are sorted newest-first by effectiveFrom', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', { includeSuperseded: true });
    const dates = r.items.map((i) => i.effectiveFrom);
    const sorted = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(sorted);
  });

  test('each item contains expected fields', async () => {
    const r = await broker.call('rcs-rule-catalog.listRuleSets', { includeSuperseded: true });
    expect(r.items.length).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.version).toBe('string');
      expect(typeof item.status).toBe('string');
      expect(typeof item.effectiveFrom).toBe('string');
      expect(typeof item.calculationMode).toBe('string');
      expect(typeof item.isLatest).toBe('boolean');
    }
  });
});

// ── getRuleSet ────────────────────────────────────────────────────────────────

describe('rcs-rule-catalog.getRuleSet', () => {
  test('returns full rule object including parameters for known ID', async () => {
    const r = await broker.call('rcs-rule-catalog.getRuleSet', {
      ruleSetId: 'eeg2027-draft-2026-06',
    });
    expect(r.id).toBe('eeg2027-draft-2026-06');
    expect(r.parameters).toBeDefined();
    expect(typeof r.parameters.s51ConsecutiveNegHours).toBe('number');
    expect(typeof r.parameters.technologyFloors).toBe('object');
    expect(typeof r.isLatest).toBe('boolean');
  });

  test('isLatest is true for the latest active rule', async () => {
    // eeg2027-draft-2026-06 is active and has later effectiveFrom
    const r = await broker.call('rcs-rule-catalog.getRuleSet', {
      ruleSetId: 'eeg2027-draft-2026-06',
    });
    expect(r.isLatest).toBe(true);
  });

  test('isLatest is false for a superseded rule', async () => {
    const r = await broker.call('rcs-rule-catalog.getRuleSet', {
      ruleSetId: 'eeg2027-draft-2026-04',
    });
    expect(r.isLatest).toBe(false);
  });

  test('returns RCS_RULE_SET_NOT_FOUND (404) for unknown ID', async () => {
    await expect(
      broker.call('rcs-rule-catalog.getRuleSet', { ruleSetId: 'nonexistent-rule-id' })
    ).rejects.toMatchObject({ type: 'RCS_RULE_SET_NOT_FOUND' });
  });

  test('error details include the requested ruleSetId', async () => {
    try {
      await broker.call('rcs-rule-catalog.getRuleSet', { ruleSetId: 'bad-id-xyz' });
      throw new Error('Expected rejection');
    } catch (err) {
      expect(err.data?.ruleSetId ?? err.data?.data?.ruleSetId).toBe('bad-id-xyz');
    }
  });
});
