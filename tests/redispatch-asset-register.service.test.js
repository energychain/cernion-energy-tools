const path = require('path');
const os = require('os');
const { ServiceBroker } = require('moleculer');
const RedispatchAssetRegisterService = require('../services/redispatch-asset-register.service');

describe('redispatch-asset-register service', () => {
  let broker;

  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...RedispatchAssetRegisterService,
      settings: {
        ...RedispatchAssetRegisterService.settings,
        dbPath: path.join(os.tmpdir(), `rdar-test-db-${Date.now()}`),
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  const defaultMeta = { tenantId: 'test-tenant' };

  // ── createProjection: all fields → RDAR_ASSET_PROJECTION_COMPLETE ─────────

  test('createProjection with all fields → RDAR_ASSET_PROJECTION_COMPLETE', async () => {
    const proj = await broker.call(
      'redispatch-asset-register.createProjection',
      {
        mastrId: 'SEE910001234',
        technicalResourceId: 'BTR-001',
        controllableResourceId: 'CR-001',
        maloId: 'DE0001234567890123456789012345678',
        meloId: 'DE0012345678901234567890123456789',
        operatorEvidenceRef: 'ev-ref-001',
        energyCarrier: 'Sonne',
        capacityKw: 500,
        sourceArtifactRefs: ['artifact-001'],
      },
      { meta: defaultMeta }
    );

    expect(proj._id).toBeTruthy();
    expect(proj.mastrId).toBe('SEE910001234');
    expect(proj.hasConflict).toBe(false);
    expect(proj.findings.some((f) => f.finding === 'RDAR_ASSET_PROJECTION_COMPLETE')).toBe(true);
  });

  // ── createProjection: missing technicalResourceId → RDAR_RESOURCE_MAPPING_MISSING ──

  test('createProjection missing technicalResourceId → RDAR_RESOURCE_MAPPING_MISSING', async () => {
    const proj = await broker.call(
      'redispatch-asset-register.createProjection',
      {
        mastrId: 'SEE910001235',
        maloId: 'DE0001234567890123456789012345678',
        operatorEvidenceRef: 'ev-ref-002',
      },
      { meta: defaultMeta }
    );

    expect(proj.findings.some((f) => f.finding === 'RDAR_RESOURCE_MAPPING_MISSING')).toBe(true);
  });

  // ── createProjection: missing maloId AND meloId → RDAR_MARKET_LOCATION_MISSING ──

  test('createProjection missing maloId AND meloId → RDAR_MARKET_LOCATION_MISSING', async () => {
    const proj = await broker.call(
      'redispatch-asset-register.createProjection',
      {
        mastrId: 'SEE910001236',
        technicalResourceId: 'BTR-002',
        operatorEvidenceRef: 'ev-ref-003',
      },
      { meta: defaultMeta }
    );

    expect(proj.findings.some((f) => f.finding === 'RDAR_MARKET_LOCATION_MISSING')).toBe(true);
    expect(proj.hasConflict).toBe(true);
  });

  // ── listProjections, getProjection ───────────────────────────────────────

  test('listProjections and getProjection', async () => {
    const proj = await broker.call(
      'redispatch-asset-register.createProjection',
      {
        mastrId: 'SEE910001237',
        maloId: 'DE0001234567890123456789012345678',
        technicalResourceId: 'BTR-003',
        operatorEvidenceRef: 'ev-ref-004',
      },
      { meta: defaultMeta }
    );

    const list = await broker.call(
      'redispatch-asset-register.listProjections',
      {},
      { meta: defaultMeta }
    );
    expect(list.projections.some((p) => p._id === proj._id)).toBe(true);

    const fetched = await broker.call(
      'redispatch-asset-register.getProjection',
      { id: proj._id },
      { meta: defaultMeta }
    );
    expect(fetched._id).toBe(proj._id);
    expect(fetched.mastrId).toBe('SEE910001237');
  });

  // ── createRelationship co_location ───────────────────────────────────────

  test('createRelationship (co_location) and listRelationships filtered by assetId', async () => {
    const rel = await broker.call(
      'redispatch-asset-register.createRelationship',
      {
        assetIdA: 'SEE910001234',
        assetIdB: 'SEE910001238',
        relationshipType: 'co_location',
        evidenceRefs: ['ev-co-001'],
        notes: 'Test co-location',
      },
      { meta: defaultMeta }
    );

    expect(rel._id).toBeTruthy();
    expect(rel.relationshipType).toBe('co_location');

    const list = await broker.call(
      'redispatch-asset-register.listRelationships',
      { assetId: 'SEE910001234', relationshipType: 'co_location' },
      { meta: defaultMeta }
    );
    expect(list.relationships.some((r) => r._id === rel._id)).toBe(true);
  });

  // ── deleteRelationship ───────────────────────────────────────────────────

  test('deleteRelationship', async () => {
    const rel = await broker.call(
      'redispatch-asset-register.createRelationship',
      {
        assetIdA: 'SEE910001240',
        assetIdB: 'SEE910001241',
        relationshipType: 'shared_nap',
        evidenceRefs: [],
      },
      { meta: defaultMeta }
    );

    const del = await broker.call(
      'redispatch-asset-register.deleteRelationship',
      { id: rel._id },
      { meta: defaultMeta }
    );
    expect(del.success).toBe(true);

    await expect(
      broker.call(
        'redispatch-asset-register.getRelationship',
        { id: rel._id },
        { meta: defaultMeta }
      )
    ).rejects.toMatchObject({ code: 404 });
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────

  test('tenant isolation: each tenant only sees own projections', async () => {
    const metaA = { tenantId: 'tenant-a' };
    const metaB = { tenantId: 'tenant-b' };

    const projA = await broker.call(
      'redispatch-asset-register.createProjection',
      {
        mastrId: 'SEE910001250',
        maloId: 'DE0001234567890123456789012345678',
        technicalResourceId: 'BTR-A',
        operatorEvidenceRef: 'ev-a',
      },
      { meta: metaA }
    );

    const projB = await broker.call(
      'redispatch-asset-register.createProjection',
      {
        mastrId: 'SEE910001251',
        maloId: 'DE0001234567890123456789012345679',
        technicalResourceId: 'BTR-B',
        operatorEvidenceRef: 'ev-b',
      },
      { meta: metaB }
    );

    const listA = await broker.call(
      'redispatch-asset-register.listProjections',
      {},
      { meta: metaA }
    );
    expect(listA.projections.some((p) => p._id === projA._id)).toBe(true);
    expect(listA.projections.some((p) => p._id === projB._id)).toBe(false);

    const listB = await broker.call(
      'redispatch-asset-register.listProjections',
      {},
      { meta: metaB }
    );
    expect(listB.projections.some((p) => p._id === projB._id)).toBe(true);
    expect(listB.projections.some((p) => p._id === projA._id)).toBe(false);
  });
});
