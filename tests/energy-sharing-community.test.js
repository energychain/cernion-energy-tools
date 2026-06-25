'use strict';

/**
 * Tests for Energy Sharing Community Master Data (issue #285, sub-issue of #280).
 */

const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');

const TEST_DB_PATH = path.join(os.tmpdir(), `cernion-community-test-${Date.now()}`);
process.env.ENERGY_SHARING_COMMUNITY_DB_PATH = TEST_DB_PATH;

const Service = require('../services/energy-sharing-community.service');

describe('energy-sharing-community service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(Service);
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    const PouchDB = require('pouchdb');
    PouchDB.plugin(require('pouchdb-find'));
    await new PouchDB(TEST_DB_PATH).destroy().catch(() => {});
  });

  test('service is named energy-sharing-community', () => {
    expect(Service.name).toBe('energy-sharing-community');
  });

  // ── createCommunity / getCommunity / listCommunities ─────────────────────────

  test('createCommunity persists and getCommunity retrieves it', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'PV-Gemeinschaft Musterstraße',
      communityId: 'ES-2026-TEST',
    });
    expect(created.success).toBe(true);
    expect(created.id).toBeTruthy();
    expect(created.members).toEqual([]);

    const fetched = await broker.call('energy-sharing-community.getCommunity', {
      id: created.id,
    });
    expect(fetched.success).toBe(true);
    expect(fetched.name).toBe('PV-Gemeinschaft Musterstraße');
  });

  test('getCommunity also resolves by the external communityId field', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Externe Referenz Test',
      communityId: 'ES-EXTERNAL-001',
    });

    const fetched = await broker.call('energy-sharing-community.getCommunity', {
      id: 'ES-EXTERNAL-001',
    });
    expect(fetched.success).toBe(true);
    expect(fetched.id).toBe(created.id);
  });

  test('getCommunity returns 404 for an unknown id', async () => {
    const result = await broker.call('energy-sharing-community.getCommunity', {
      id: 'does-not-exist',
    });
    expect(result.success).toBe(false);
  });

  test('listCommunities excludes soft-deleted communities by default', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Wird gelöscht',
    });
    await broker.call('energy-sharing-community.removeCommunity', { id: created.id });

    const list = await broker.call('energy-sharing-community.listCommunities', {});
    expect(list.communities.find((c) => c.id === created.id)).toBeUndefined();
  });

  // ── addMember / roles / Teilnahmezeitraum ──────────────────────────────────────

  test('addMember requires at least one role (rejected at the schema level)', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Rollen-Test',
    });
    await expect(
      broker.call('energy-sharing-community.addMember', {
        id: created.id,
        maloId: 'DE0001234567890123456789012345678',
        roles: [],
        validFrom: '2026-01-01',
      })
    ).rejects.toMatchObject({ code: 422, type: 'VALIDATION_ERROR' });
  });

  test('addMember rejects an unrecognized role value', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Ungueltige-Rolle-Test',
    });
    await expect(
      broker.call('energy-sharing-community.addMember', {
        id: created.id,
        maloId: 'DE0001234567890123456789012345678',
        roles: ['landlord'],
        validFrom: '2026-01-01',
      })
    ).rejects.toMatchObject({ code: 400, type: 'INVALID_ROLE' });
  });

  test('adds a pure consumer member', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Verbraucher-Test',
    });
    const result = await broker.call('energy-sharing-community.addMember', {
      id: created.id,
      maloId: 'DE0001234567890123456789012345678',
      name: 'Müller',
      roles: ['consumer'],
      consumerSharePercent: 30,
      validFrom: '2026-01-01',
    });
    expect(result.success).toBe(true);
    expect(result.member.roles).toEqual(['consumer']);
    expect(result.member.consumerSharePercent).toBe(30);
  });

  test('adds a Prosumer member with combined generator + consumer roles', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Prosumer-Test',
    });
    const result = await broker.call('energy-sharing-community.addMember', {
      id: created.id,
      maloId: 'DE0001234567890123456789012345678',
      mastrNummer: 'SEE904837264953',
      name: 'Schmidt',
      roles: ['generator', 'consumer'],
      generatorSharePercent: 50,
      consumerSharePercent: 20,
      validFrom: '2026-01-01',
    });
    expect(result.success).toBe(true);
    expect(result.member.roles).toEqual(['generator', 'consumer']);
    expect(result.member.generatorSharePercent).toBe(50);
    expect(result.member.consumerSharePercent).toBe(20);
  });

  test('adds a pure storage member (modelable, no share required)', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Speicher-Test',
    });
    const result = await broker.call('energy-sharing-community.addMember', {
      id: created.id,
      maloId: 'DE0009999999999999999999999999999',
      name: 'Batteriespeicher Haus C',
      roles: ['storage'],
      validFrom: '2026-01-01',
    });
    expect(result.success).toBe(true);
    expect(result.member.roles).toEqual(['storage']);
  });

  test('addMember requires mastrNummer for the generator role', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Fehlende MaStR-Nr',
    });
    await expect(
      broker.call('energy-sharing-community.addMember', {
        id: created.id,
        roles: ['generator'],
        generatorSharePercent: 100,
        validFrom: '2026-01-01',
      })
    ).rejects.toMatchObject({ code: 400, type: 'MASTR_NUMMER_REQUIRED' });
  });

  test('updateMember can end a membership via validTo without deleting the record', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Austritt-Test',
    });
    const added = await broker.call('energy-sharing-community.addMember', {
      id: created.id,
      maloId: 'DE0001234567890123456789012345678',
      roles: ['consumer'],
      consumerSharePercent: 30,
      validFrom: '2026-01-01',
    });

    const updated = await broker.call('energy-sharing-community.updateMember', {
      id: created.id,
      memberId: added.member.memberId,
      validTo: '2026-06-30',
    });
    expect(updated.success).toBe(true);
    expect(updated.member.validTo).toBe('2026-06-30');
    expect(updated.member.maloId).toBe('DE0001234567890123456789012345678'); // preserved
  });

  test('removeMember hard-deletes the member record', async () => {
    const created = await broker.call('energy-sharing-community.createCommunity', {
      name: 'Hart-Loeschen-Test',
    });
    const added = await broker.call('energy-sharing-community.addMember', {
      id: created.id,
      maloId: 'DE0001234567890123456789012345678',
      roles: ['consumer'],
      consumerSharePercent: 30,
      validFrom: '2026-01-01',
    });

    await broker.call('energy-sharing-community.removeMember', {
      id: created.id,
      memberId: added.member.memberId,
    });
    const fetched = await broker.call('energy-sharing-community.getCommunity', {
      id: created.id,
    });
    expect(fetched.members).toHaveLength(0);
  });

  // ── resolveActiveMembers — Teilnahmezeitraum overlap (#285 acceptance criteria) ─

  describe('resolveActiveMembers', () => {
    async function buildCommunityWithMidPeriodChanges() {
      const created = await broker.call('energy-sharing-community.createCommunity', {
        name: 'Zeitraum-Test',
      });
      // Generator, active the whole year.
      await broker.call('energy-sharing-community.addMember', {
        id: created.id,
        mastrNummer: 'SEE904837264953',
        roles: ['generator'],
        generatorSharePercent: 100,
        validFrom: '2026-01-01',
      });
      // Consumer A: joins mid-period (June 15), still active.
      await broker.call('energy-sharing-community.addMember', {
        id: created.id,
        maloId: 'DE0001111111111111111111111111111',
        name: 'Joins mid-June',
        roles: ['consumer'],
        consumerSharePercent: 50,
        validFrom: '2026-06-15',
      });
      // Consumer B: left before the period started (validTo before dateFrom).
      await broker.call('energy-sharing-community.addMember', {
        id: created.id,
        maloId: 'DE0002222222222222222222222222222',
        name: 'Left before period',
        roles: ['consumer'],
        consumerSharePercent: 50,
        validFrom: '2026-01-01',
        validTo: '2026-05-01',
      });
      // Consumer C: joins after the period ends.
      await broker.call('energy-sharing-community.addMember', {
        id: created.id,
        maloId: 'DE0003333333333333333333333333333',
        name: 'Joins after period',
        roles: ['consumer'],
        consumerSharePercent: 50,
        validFrom: '2026-07-15',
      });
      return created;
    }

    test('excludes a member whose validTo is before the requested dateFrom', async () => {
      const created = await buildCommunityWithMidPeriodChanges();
      const resolved = await broker.call('energy-sharing-community.resolveActiveMembers', {
        id: created.id,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
      });

      expect(resolved.success).toBe(true);
      const maloIds = resolved.consumers.map((c) => c.maloId);
      expect(maloIds).not.toContain('DE0002222222222222222222222222222'); // left before period
      expect(maloIds).not.toContain('DE0003333333333333333333333333333'); // joins after period
      expect(maloIds).toContain('DE0001111111111111111111111111111'); // joined mid-period, still included
    });

    test('a member who joins mid-period is included with their full configured share (no prorating)', async () => {
      const created = await buildCommunityWithMidPeriodChanges();
      const resolved = await broker.call('energy-sharing-community.resolveActiveMembers', {
        id: created.id,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
      });
      const midJoiner = resolved.consumers.find(
        (c) => c.maloId === 'DE0001111111111111111111111111111'
      );
      expect(midJoiner.sharePercent).toBe(50);
    });

    test('generators are resolved separately from consumers', async () => {
      const created = await buildCommunityWithMidPeriodChanges();
      const resolved = await broker.call('energy-sharing-community.resolveActiveMembers', {
        id: created.id,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
      });
      expect(resolved.generators).toHaveLength(1);
      expect(resolved.generators[0].mastrNummer).toBe('SEE904837264953');
    });

    test('storage members are reported separately and not mixed into consumers/generators', async () => {
      const created = await broker.call('energy-sharing-community.createCommunity', {
        name: 'Speicher-Resolve-Test',
      });
      await broker.call('energy-sharing-community.addMember', {
        id: created.id,
        maloId: 'DE0009999999999999999999999999999',
        roles: ['storage'],
        validFrom: '2026-01-01',
      });

      const resolved = await broker.call('energy-sharing-community.resolveActiveMembers', {
        id: created.id,
        dateFrom: '2026-06-01',
        dateTo: '2026-06-30',
      });
      expect(resolved.consumers).toHaveLength(0);
      expect(resolved.generators).toHaveLength(0);
      expect(resolved.storageMembers).toHaveLength(1);
    });
  });
});
