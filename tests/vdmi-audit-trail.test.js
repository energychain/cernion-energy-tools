'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find'));
const VDMIAuditTrail = require('../src/vdmi-audit-trail');

describe('VDMI audit trail', () => {
  let directory, db, trail;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rc3-vdmi-audit-'));
    db = new PouchDB(path.join(directory, 'audit'));
    trail = new VDMIAuditTrail(db);
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('excludes other tenants with the same entity, including overlapping tenant prefixes', async () => {
    for (const tenantId of ['tenant-a', 'tenant-b', 'tenant-b:child', 'tenant-c']) {
      await trail.createEntry(tenantId, {
        action: 'MATRIX_OVERRIDE',
        actor: `actor-${tenantId}`,
        timestamp: '2026-10-01T12:00:00.000Z',
        relatedEntities: { type: 'matrix', id: 'shared-entity-id' },
      });
    }
    const earlier = await trail.createEntry('tenant-b', {
      action: 'MATRIX_REVERT',
      actor: 'actor-tenant-b',
      timestamp: '2026-10-01T11:00:00.000Z',
      relatedEntities: { type: 'matrix', id: 'shared-entity-id' },
    });
    await trail.createEntry('tenant-b', {
      action: 'FINDING_CREATED',
      actor: 'actor-tenant-b',
      relatedEntities: { type: 'finding', id: 'shared-entity-id' },
    });
    const result = await trail.getEntityTrail('tenant-b', 'matrix', 'shared-entity-id');
    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.tenantId === 'tenant-b')).toBe(true);
    expect(result[0].id).toBe(earlier.id);
    expect(
      result.every((entry) => !Object.hasOwn(entry, '_rev') && !Object.hasOwn(entry, '_id'))
    ).toBe(true);
    expect(await trail.getEntityTrail('tenant-b', 'matrix', 'missing-entity')).toEqual([]);
    expect(await trail.getEntityTrail('tenant-unknown', 'matrix', 'shared-entity-id')).toEqual([]);
  });

  test('verifies persisted nested data and rejects changes to audit context', async () => {
    const created = await trail.createEntry('tenant-a', {
      action: 'MATRIX_OVERRIDE',
      actor: 'reviewer',
      actorRole: 'hitl-approver',
      rationale: 'Approved correction',
      delta: { before: { value: 1 }, after: { value: 2 }, evidence: ['a', 'b'] },
      relatedEntities: { type: 'matrix', id: 'matrix-one' },
    });
    const persisted = await db.get(created.id);
    expect(persisted.integrityVersion).toBe(2);
    expect(trail.verifyIntegrity(persisted)).toBe(true);
    const projected = (await trail.getEntityTrail('tenant-a', 'matrix', 'matrix-one'))[0];
    expect(trail.verifyIntegrity(projected)).toBe(true);
    for (const mutate of [
      (entry) => {
        entry.delta.after.value = 999;
      },
      (entry) => {
        entry.relatedEntities.id = 'other';
      },
      (entry) => {
        entry.tenantId = 'tenant-b';
      },
      (entry) => {
        entry.rationale = 'Different decision';
      },
      (entry) => {
        entry.actorRole = 'admin';
      },
      (entry) => {
        entry.delta.evidence.reverse();
      },
    ]) {
      const changed = JSON.parse(JSON.stringify(persisted));
      mutate(changed);
      expect(trail.verifyIntegrity(changed)).toBe(false);
    }
    const reordered = {
      ...persisted,
      delta: { evidence: ['a', 'b'], after: { value: 2 }, before: { value: 1 } },
      relatedEntities: { id: 'matrix-one', type: 'matrix' },
    };
    expect(trail.verifyIntegrity(reordered)).toBe(true);
  });

  test('keeps legacy entries readable without claiming complete integrity', async () => {
    const legacy = {
      _id: 'vdmi-audit:tenant-a:legacy',
      tenantId: 'tenant-a',
      action: 'MATRIX_OVERRIDE',
      actor: 'reviewer',
      timestamp: '2026-10-01T12:00:00.000Z',
      delta: { after: { value: 2 } },
      relatedEntities: { type: 'matrix', id: 'matrix-one' },
    };
    legacy.integrityHash = require('crypto')
      .createHash('sha256')
      .update(JSON.stringify(legacy, ['action', 'actor', 'delta', 'relatedEntities', 'timestamp']))
      .digest('hex');
    await db.put(legacy);
    const [entry] = await trail.getEntityTrail('tenant-a', 'matrix', 'matrix-one');
    expect(entry.integrityHash).toBe(legacy.integrityHash);
    expect(trail.verifyIntegrity(entry)).toBe(false);
    expect(trail.verifyIntegrity({ ...entry, integrityVersion: 3 })).toBe(false);
    expect(trail.verifyIntegrity(null)).toBe(false);
  });
});
