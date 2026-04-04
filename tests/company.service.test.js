'use strict';

/**
 * Tests for company.service.js (v0.20.3)
 *
 * Covers:
 * - CRUD lifecycle (create, get, list, update, delete/archive)
 * - autoDiscover draft flow + confirm with override
 * - duplicate BDEW guard
 * - enrichResults match / no-match
 * - prefix-based role auto-assignment
 * - list search and status filtering
 */

const { ServiceBroker } = require('moleculer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CompanyService = require('../services/company.service');

// ─── Mock CernionMCPClient for autoDiscover tests ─────────────────────────────

jest.mock('../src/mcp-client', () => ({
  callWithNewSession: jest.fn(),
}));

const CernionMCPClient = require('../src/mcp-client');

const MOCK_MCP_RESULT = {
  results: [
    {
      bdew: '9900277000000',
      name: 'Stadtwerke Heidelberg Netze GmbH',
      roles: ['VNB'],
      city: 'Heidelberg',
      postalCode: '69115',
      mastrId: 'SNB123456789',
    },
    {
      bdewCode: '9910277000001',
      name: 'Stadtwerke Heidelberg GmbH',
      roles: ['Lieferant'],
      city: 'Heidelberg',
      postalCode: '69115',
    },
    {
      bdew: '9920277000002',
      name: 'Stadtwerke Heidelberg Metering',
      marketRoles: ['MSB'],
      city: 'Heidelberg',
    },
  ],
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('company.service', () => {
  let broker;
  let dbPath;

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `company-test-${Date.now()}`);
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...CompanyService,
      settings: { ...CompanyService.settings, dbPath },
    });
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  beforeEach(() => {
    CernionMCPClient.callWithNewSession.mockReset();
  });

  // ─── Manual create ─────────────────────────────────────────────────────────

  describe('create — manual members', () => {
    it('creates an active company with explicit members', async () => {
      const result = await broker.call('company.create', {
        displayName: 'Stadtwerke Teststadt',
        members: [
          { bdewCode: '9900111000001', role: 'VNB', legalEntity: 'Teststadt Netze GmbH' },
          { bdewCode: '9910111000002', role: 'Lieferant' },
        ],
      });

      expect(result.status).toBe('active');
      expect(result.displayName).toBe('Stadtwerke Teststadt');
      expect(result.members).toHaveLength(2);
      expect(result.members[0].role).toBe('VNB');
      expect(result.companyId).toBeTruthy();
      expect(result.suggestedRoles).toBeUndefined();
    });

    it('auto-assigns role via BDEW prefix when role omitted', async () => {
      const result = await broker.call('company.create', {
        displayName: 'Auto-Role Test',
        members: [
          { bdewCode: '9920999000003' }, // 992x → MSB
        ],
      });

      expect(result.status).toBe('active');
      expect(result.members[0].role).toBe('MSB');
    });

    it('rejects duplicate BDEW code already owned by another company', async () => {
      // The VNB code from the first test is already registered
      await expect(
        broker.call('company.create', {
          displayName: 'Duplicate Test',
          members: [{ bdewCode: '9900111000001' }],
        })
      ).rejects.toMatchObject({ code: 409, type: 'BDEW_ALREADY_ASSIGNED' });
    });
  });

  // ─── autoDiscover draft-confirm flow ───────────────────────────────────────

  describe('create — autoDiscover draft flow', () => {
    let draftId;

    it('creates a draft when autoDiscover=true and autoConfirm=false', async () => {
      CernionMCPClient.callWithNewSession.mockResolvedValueOnce(MOCK_MCP_RESULT);

      const result = await broker.call('company.create', {
        displayName: 'Stadtwerke Heidelberg',
        autoDiscover: true,
        query: 'Heidelberg',
        autoConfirm: false,
      });

      draftId = result.companyId;
      expect(result.status).toBe('draft');
      expect(result.members).toHaveLength(3);
      expect(result.members[0].role).toBe('VNB');
      expect(result.members[1].role).toBe('Lieferant');
      expect(result.members[2].role).toBe('MSB');
      expect(result.suggestedRoles).toBeDefined();
      expect(result.message).toContain('confirm');
    });

    it('confirms draft → active (no override)', async () => {
      const confirmed = await broker.call('company.confirm', { id: draftId });

      expect(confirmed.status).toBe('active');
      expect(confirmed.companyId).toBe(draftId);
      expect(confirmed.members).toHaveLength(3);
    });

    it('rejects confirm on already-active company', async () => {
      await expect(
        broker.call('company.confirm', { id: draftId })
      ).rejects.toMatchObject({ code: 409, type: 'COMPANY_NOT_DRAFT' });
    });
  });

  // ─── autoDiscover with autoConfirm=true ────────────────────────────────────

  describe('create — autoDiscover + autoConfirm', () => {
    it('creates active company directly when autoConfirm=true', async () => {
      CernionMCPClient.callWithNewSession.mockResolvedValueOnce({
        results: [
          { bdew: '9900888000010', name: 'EnBW Regional AG', roles: ['VNB'], city: 'Stuttgart' },
        ],
      });

      const result = await broker.call('company.create', {
        displayName: 'EnBW Regional',
        autoDiscover: true,
        query: 'EnBW',
        autoConfirm: true,
      });

      expect(result.status).toBe('active');
      expect(result.suggestedRoles).toBeUndefined();
    });
  });

  // ─── confirm with member override ──────────────────────────────────────────

  describe('confirm with member override', () => {
    it('replaces members when override provided', async () => {
      CernionMCPClient.callWithNewSession.mockResolvedValueOnce({
        results: [
          { bdew: '9900333000020', name: 'VNB A', roles: ['VNB'] },
          { bdew: '9940333000021', name: 'Unrelated Co', roles: [] }, // 994x → DV
        ],
      });

      const draft = await broker.call('company.create', {
        displayName: 'Partial Confirm Test',
        autoDiscover: true,
        query: 'PartialTest',
        autoConfirm: false,
      });

      // Confirm keeping only the VNB member, discarding the unrelated one
      const confirmed = await broker.call('company.confirm', {
        id: draft.companyId,
        members: [
          { bdewCode: '9900333000020', role: 'VNB', legalEntity: 'VNB A GmbH' },
        ],
      });

      expect(confirmed.members).toHaveLength(1);
      expect(confirmed.members[0].bdewCode).toBe('9900333000020');
    });
  });

  // ─── autoDiscover requires query ───────────────────────────────────────────

  describe('create — autoDiscover validation', () => {
    it('throws 422 when autoDiscover=true but query is missing', async () => {
      await expect(
        broker.call('company.create', {
          displayName: 'Missing Query',
          autoDiscover: true,
        })
      ).rejects.toMatchObject({ code: 422 });
    });
  });

  // ─── get / list ────────────────────────────────────────────────────────────

  describe('get and list', () => {
    it('returns company by id', async () => {
      const created = await broker.call('company.create', {
        displayName: 'Get Test GmbH',
        members: [{ bdewCode: '9900555000030', role: 'VNB' }],
      });

      const fetched = await broker.call('company.get', { id: created.companyId });
      expect(fetched.companyId).toBe(created.companyId);
      expect(fetched.displayName).toBe('Get Test GmbH');
    });

    it('throws 404 for unknown companyId', async () => {
      await expect(
        broker.call('company.get', { id: 'does-not-exist' })
      ).rejects.toMatchObject({ code: 404, type: 'COMPANY_NOT_FOUND' });
    });

    it('lists active companies matching query', async () => {
      await broker.call('company.create', {
        displayName: 'Suchtest Energie GmbH',
        members: [{ bdewCode: '9900666000040', role: 'VNB' }],
      });

      const result = await broker.call('company.list', { query: 'Suchtest' });
      expect(result.count).toBeGreaterThanOrEqual(1);
      expect(result.companies[0].displayName).toContain('Suchtest');
    });

    it('returns all statuses when status=all', async () => {
      const result = await broker.call('company.list', { status: 'all', limit: 50 });
      expect(result.count).toBeGreaterThan(0);
    });
  });

  // ─── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates displayName', async () => {
      const created = await broker.call('company.create', {
        displayName: 'Old Name',
        members: [{ bdewCode: '9900777000050', role: 'VNB' }],
      });

      const updated = await broker.call('company.update', {
        id: created.companyId,
        displayName: 'New Name',
      });

      expect(updated.displayName).toBe('New Name');
      expect(updated.members[0].bdewCode).toBe('9900777000050');
    });

    it('replaces members on update', async () => {
      const created = await broker.call('company.create', {
        displayName: 'Member Replace Test',
        members: [{ bdewCode: '9900777000060', role: 'VNB' }],
      });

      const updated = await broker.call('company.update', {
        id: created.companyId,
        members: [
          { bdewCode: '9900777000060', role: 'VNB', active: true },
          { bdewCode: '9910777000061', role: 'Lieferant', active: true },
        ],
      });

      expect(updated.members).toHaveLength(2);
    });
  });

  // ─── delete (soft) ─────────────────────────────────────────────────────────

  describe('delete', () => {
    it('soft-deletes (archives) a company', async () => {
      const created = await broker.call('company.create', {
        displayName: 'Archive Me',
        members: [{ bdewCode: '9900999000070', role: 'VNB' }],
      });

      const deleted = await broker.call('company.delete', { id: created.companyId });
      expect(deleted.status).toBe('archived');

      const fetched = await broker.call('company.get', { id: created.companyId });
      expect(fetched.status).toBe('archived');
    });

    it('frees BDEW code after archive — same code can be reassigned', async () => {
      const created = await broker.call('company.create', {
        displayName: 'Free BDEW Test',
        members: [{ bdewCode: '9900999000080', role: 'VNB' }],
      });

      await broker.call('company.delete', { id: created.companyId });

      // BDEW should now be free
      const reuse = await broker.call('company.create', {
        displayName: 'Reuse BDEW Test',
        members: [{ bdewCode: '9900999000080', role: 'VNB' }],
      });
      expect(reuse.status).toBe('active');
    });
  });

  // ─── enrichResults ─────────────────────────────────────────────────────────

  describe('enrichResults', () => {
    let knownCompanyId;

    beforeAll(async () => {
      const c = await broker.call('company.create', {
        displayName: 'Enrich Test GmbH',
        members: [{ bdewCode: '9900123456789', role: 'VNB' }],
      });
      knownCompanyId = c.companyId;
    });

    it('injects companyId for known BDEW code', async () => {
      const results = await broker.call('company.enrichResults', {
        results: [
          { bdew: '9900123456789', name: 'Enrich Test GmbH', roles: ['VNB'] },
        ],
      });

      expect(results[0].companyId).toBe(knownCompanyId);
      expect(results[0].marketRole).toBe('VNB');
    });

    it('injects companyId=null for unknown BDEW code', async () => {
      const results = await broker.call('company.enrichResults', {
        results: [
          { bdew: '9900000000000', name: 'Unknown GmbH', roles: [] },
        ],
      });

      expect(results[0].companyId).toBeNull();
    });

    it('classifies marketRole from roles[] array', async () => {
      const results = await broker.call('company.enrichResults', {
        results: [
          { bdew: '9910999000001', name: 'Lieferant GmbH', roles: ['Lieferant'] },
        ],
      });

      expect(results[0].marketRole).toBe('Lieferant');
    });

    it('falls back to BDEW prefix heuristic when roles[] is empty', async () => {
      const results = await broker.call('company.enrichResults', {
        results: [
          { bdew: '9920999000001', name: 'MSB GmbH', roles: [] },
        ],
      });

      expect(results[0].marketRole).toBe('MSB');
    });

    it('normalizes bdewCode field alias', async () => {
      const results = await broker.call('company.enrichResults', {
        results: [
          { bdewCode: '9900123456789', name: 'Enrich via bdewCode alias', roles: ['VNB'] },
        ],
      });

      expect(results[0].companyId).toBe(knownCompanyId);
    });

    it('handles empty results array', async () => {
      const results = await broker.call('company.enrichResults', { results: [] });
      expect(results).toEqual([]);
    });
  });
});
