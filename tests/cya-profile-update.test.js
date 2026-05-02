'use strict';

const path = require('path');
const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const CyaService = require('../services/cya.service');

// ── Broker setup ──────────────────────────────────────────────────────────

let broker;

beforeAll(async () => {
  broker = new ServiceBroker({ logger: false });

  // Minimal stub services needed for cya.service.js to start
  broker.createService({
    name: 'query',
    actions: {
      ask: {
        handler() {
          return { answer: 'ok', sources: [], metadata: {} };
        },
      },
    },
  });
  broker.createService({
    name: 'energy-market',
    actions: {
      installations: {
        handler() {
          return { success: true, data: { installations: [] }, stats: { count: 0 } };
        },
      },
    },
  });
  broker.createService({
    name: 'grid-operations',
    actions: {
      marketPartners: {
        handler() {
          return { results: [], count: 0 };
        },
      },
    },
  });
  broker.createService({
    name: 'osm-geo',
    actions: {
      substationFinder: {
        handler() {
          return { nearestSubstations: [] };
        },
      },
      validate: {
        handler() {
          return { valid: true };
        },
      },
    },
  });
  broker.createService({
    name: 'mcp-cernion',
    actions: {
      callTool: {
        handler() {
          return {};
        },
      },
    },
  });

  broker.createService({
    ...ObjectStoreService,
    settings: {
      ...ObjectStoreService.settings,
      dbPath: path.join(process.cwd(), 'data', `object-store-cya-profile-update-${Date.now()}`),
    },
  });

  broker.createService(CyaService);
  await broker.start();
}, 30000);

afterAll(async () => {
  await broker.stop();
});

// ── Helper ────────────────────────────────────────────────────────────────

async function createTestProfile(id = 'test_profile_update') {
  return broker.call('cya.createProfile', {
    profile_id: id,
    actor: { role: 'grid_operator', organization: 'Stadtwerke Test' },
    strategic_goals: ['Investition optimieren'],
    tone: 'sachlich',
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PATCH /api/cya/profile/:id (cya.profile.update)', () => {
  test('404 wenn Profil nicht existiert', async () => {
    await expect(
      broker.call('cya.profile.update', { id: 'nonexistent_xyz_404' })
    ).rejects.toMatchObject({ code: 404 });
  });

  test('constraints werden gespeichert und zurückgegeben', async () => {
    await createTestProfile('pu_constraints');
    const result = await broker.call('cya.profile.update', {
      id: 'pu_constraints',
      constraints: [{ topic: 'Dunkelflaute', rule: 'Keine Spekulation' }],
    });
    expect(result.updated).toBe(true);
    expect(result.profile.constraints).toHaveLength(1);
    expect(result.profile.constraints[0].topic).toBe('Dunkelflaute');
    expect(result.profile.constraints[0].setAt).toBeDefined();
  });

  test('explicitPreferences werden gespeichert', async () => {
    await createTestProfile('pu_explicit');
    const result = await broker.call('cya.profile.update', {
      id: 'pu_explicit',
      explicitPreferences: { reportFormat: 'pdf', lang: 'de' },
    });
    expect(result.profile.explicitPreferences.reportFormat).toBe('pdf');
    expect(result.profile.explicitPreferences.lang).toBe('de');
  });

  test('tone wird aktualisiert', async () => {
    await createTestProfile('pu_tone');
    const result = await broker.call('cya.profile.update', {
      id: 'pu_tone',
      tone: 'direkt und nüchtern',
    });
    expect(result.profile.tone).toBe('direkt und nüchtern');
  });

  test('strategic_goals wird aktualisiert', async () => {
    await createTestProfile('pu_goals');
    const result = await broker.call('cya.profile.update', {
      id: 'pu_goals',
      strategic_goals: ['Kosten senken', 'Compliance sichern'],
    });
    expect(result.profile.strategic_goals).toEqual(['Kosten senken', 'Compliance sichern']);
  });

  test('profileVersion steigt nach update', async () => {
    await createTestProfile('pu_version');
    const result = await broker.call('cya.profile.update', {
      id: 'pu_version',
      tone: 'neutral',
    });
    expect(typeof result.profile.profileVersion).toBe('number');
    expect(result.profile.profileVersion).toBeGreaterThanOrEqual(2);
  });

  test('updatedAt ist nach update gesetzt', async () => {
    await createTestProfile('pu_updat');
    const result = await broker.call('cya.profile.update', {
      id: 'pu_updat',
      tone: 'test',
    });
    expect(typeof result.profile.updatedAt).toBe('string');
    expect(result.profile.updatedAt.length).toBeGreaterThan(0);
  });

  test('implicitStats bleiben bei explizitem Update unverändert', async () => {
    await createTestProfile('pu_implicit');
    // implicitStats are not on fresh profile — they should not appear
    const result = await broker.call('cya.profile.update', {
      id: 'pu_implicit',
      tone: 'x',
    });
    // implicitStats should be absent or null on a fresh profile with only explicit update
    const sessionCount = result.profile.implicitStats?.sessionCount;
    expect(sessionCount == null || sessionCount === 0).toBe(true);
  });

  test('leerer Body ist valide (no-op Update außer Version + updatedAt)', async () => {
    await createTestProfile('pu_noop');
    const before = await broker.call('cya.getProfile', { profile_id: 'pu_noop' });
    const result = await broker.call('cya.profile.update', { id: 'pu_noop' });
    expect(result.updated).toBe(true);
    expect(result.profile.tone).toBe(before.profile.tone);
  });

  test('id mit Sonderzeichen gibt Fehler', async () => {
    await expect(broker.call('cya.profile.update', { id: 'invalid-id!@#' })).rejects.toBeDefined();
  });

  test('id mit Leerzeichen gibt Fehler', async () => {
    await expect(broker.call('cya.profile.update', { id: 'invalid id' })).rejects.toBeDefined();
  });

  test('priorityFocusAreas wird gespeichert', async () => {
    await createTestProfile('pu_prio');
    const result = await broker.call('cya.profile.update', {
      id: 'pu_prio',
      priorityFocusAreas: ['redispatch', 'capacity'],
    });
    expect(result.profile.priorityFocusAreas).toEqual(['redispatch', 'capacity']);
  });

  test('zweites update mergt explicitPreferences kumulativ', async () => {
    await createTestProfile('pu_merge');
    await broker.call('cya.profile.update', {
      id: 'pu_merge',
      explicitPreferences: { a: 1 },
    });
    const result = await broker.call('cya.profile.update', {
      id: 'pu_merge',
      explicitPreferences: { b: 2 },
    });
    expect(result.profile.explicitPreferences.a).toBe(1);
    expect(result.profile.explicitPreferences.b).toBe(2);
  });
});
