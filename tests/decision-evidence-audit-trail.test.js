'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const PouchDB = require('pouchdb');
const { ServiceBroker } = require('moleculer');

const GovernanceService = require('../services/governance.service');
const VDMIAuditTrail = require('../src/vdmi-audit-trail');
const { DecisionEvidenceAuditTrail } = require('../src/decision-evidence-audit-trail');

describe('Decision/Evidence Audit Trail (#294)', () => {
  let dbPath;
  let db;
  let trail;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `cernion-decision-audit-${Date.now()}-${Math.random()}`);
    db = new PouchDB(dbPath, { auto_compaction: true });
    trail = new DecisionEvidenceAuditTrail(db);
  });

  afterEach(async () => {
    await db.close();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('appends hash-linked entries and verifies an untouched chain', async () => {
    const first = await trail.appendEntry({
      tenantId: 'tenant-a',
      entityId: 'matrix-1',
      rowId: 'row-1',
      mandate: 'redispatch-governance',
      controlCase: 'redispatch',
      actor: 'operator@example.test',
      role: 'ROLE_GRID_OPERATOR',
      evidenceState: { remoteControlProof: 'present' },
      decision: 'allowed',
      followUpAction: 'continue-reference-process',
      timestamp: '2026-06-25T18:00:00.000Z',
    });
    const second = await trail.appendEntry({
      tenantId: 'tenant-a',
      entityId: 'matrix-1',
      rowId: 'row-1',
      evidenceState: { remoteControlProof: 'present', policy: 'accepted' },
      decision: 'recorded',
      policyDecision: { allowed: true, reason: 'policy_allowed' },
      timestamp: '2026-06-25T18:01:00.000Z',
    });

    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.entryHash);

    const verification = await trail.verifyTrail({
      tenantId: 'tenant-a',
      entityId: 'matrix-1',
      rowId: 'row-1',
    });
    expect(verification).toMatchObject({
      verified: true,
      entryCount: 2,
      failures: [],
      latestHash: second.entryHash,
    });
  });

  it('keeps tenant, entity, and row trails separated while allowing entity-wide reads', async () => {
    await trail.appendEntry({
      tenantId: 'tenant-a',
      entityId: 'matrix-1',
      rowId: 'row-a',
      decision: 'allowed',
      timestamp: '2026-06-25T18:00:00.000Z',
    });
    await trail.appendEntry({
      tenantId: 'tenant-a',
      entityId: 'matrix-1',
      rowId: 'row-b',
      decision: 'blocked',
      timestamp: '2026-06-25T18:01:00.000Z',
    });
    await trail.appendEntry({
      tenantId: 'tenant-b',
      entityId: 'matrix-1',
      rowId: 'row-a',
      decision: 'other-tenant',
      timestamp: '2026-06-25T18:02:00.000Z',
    });

    await expect(
      trail.getTrail({ tenantId: 'tenant-a', entityId: 'matrix-1', rowId: 'row-a' })
    ).resolves.toHaveLength(1);
    await expect(trail.getTrail({ tenantId: 'tenant-a', entityId: 'matrix-1' })).resolves.toHaveLength(
      2
    );
    await expect(
      trail.getTrail({ tenantId: 'tenant-b', entityId: 'matrix-1', rowId: 'row-a' })
    ).resolves.toHaveLength(1);
  });

  it('detects manipulated persisted content', async () => {
    const entry = await trail.appendEntry({
      tenantId: 'tenant-a',
      entityId: 'matrix-1',
      rowId: 'row-1',
      decision: 'allowed',
      timestamp: '2026-06-25T18:00:00.000Z',
    });
    const doc = await db.get(entry.id);
    doc.decision = 'tampered';
    await db.put(doc);

    const verification = await trail.verifyTrail({
      tenantId: 'tenant-a',
      entityId: 'matrix-1',
      rowId: 'row-1',
    });
    expect(verification.verified).toBe(false);
    expect(verification.failures).toEqual([
      expect.objectContaining({ reason: 'entry_hash_mismatch', id: entry.id }),
    ]);
  });

  it('does not alter the existing VDMI audit hash behavior', async () => {
    const vdmiDbPath = path.join(os.tmpdir(), `cernion-vdmi-audit-${Date.now()}-${Math.random()}`);
    const vdmiDb = new PouchDB(vdmiDbPath, { auto_compaction: true });
    const vdmiTrail = new VDMIAuditTrail(vdmiDb);

    try {
      const entry = await vdmiTrail.createEntry('tenant-a', {
        action: 'MATRIX_OVERRIDE',
        actor: 'operator@example.test',
        actorRole: 'matrix-admin',
        timestamp: '2026-06-25T18:00:00.000Z',
        delta: { changedRows: ['row-1'] },
        relatedEntities: { type: 'matrix', id: 'matrix-1' },
      });

      expect(vdmiTrail.verifyIntegrity(entry)).toBe(true);
    } finally {
      await vdmiDb.close();
      fs.rmSync(vdmiDbPath, { recursive: true, force: true });
    }
  });
});

describe('governance decision audit actions (#294)', () => {
  let broker;
  let dbPath;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `cernion-governance-audit-${Date.now()}-${Math.random()}`);
    broker = new ServiceBroker({ logger: false, transporter: null });
    broker.createService({
      ...GovernanceService,
      settings: {
        ...GovernanceService.settings,
        decisionAuditDbPath: dbPath,
      },
    });
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dbPath, { recursive: true, force: true });
  });

  it('records a #292 policy result only through the explicit record action', async () => {
    const policyDecision = await broker.call('governance.evaluatePolicy', {
      controlCase: {
        controlCase: 'redispatch',
        evidenceRequirements: [],
        decisionPolicy: {},
      },
      context: {},
    });

    expect(policyDecision).toMatchObject({
      allowed: true,
      sideEffects: 'none',
      safety: 'read_only_policy_evaluation',
    });

    const record = await broker.call('governance.recordDecisionAudit', {
      tenantId: 'tenant-a',
      entityId: 'control-case-redispatch',
      rowId: 'row-policy-1',
      mandate: 'steuerbarkeitscheck',
      controlCase: 'redispatch',
      actor: 'governance-runtime',
      role: 'ROLE_POLICY_EVALUATOR',
      evidenceState: { requirementsComplete: true },
      decision: policyDecision.allowed ? 'allowed' : 'blocked',
      followUpAction: 'continue-reference-process',
      policyDecision,
      timestamp: '2026-06-25T18:03:00.000Z',
    });

    expect(record).toMatchObject({
      success: true,
      safety: 'append_only_audit_write',
      sideEffects: 'local_audit_append_only',
      entry: {
        tenantId: 'tenant-a',
        entityId: 'control-case-redispatch',
        rowId: 'row-policy-1',
        decision: 'allowed',
        previousHash: null,
      },
    });

    const readback = await broker.call('governance.getDecisionAuditTrail', {
      tenantId: 'tenant-a',
      entityId: 'control-case-redispatch',
      rowId: 'row-policy-1',
    });
    expect(readback).toMatchObject({
      success: true,
      safety: 'read_only_integrity_check',
      entryCount: 1,
    });
    expect(readback.entries[0].policyDecision.reason).toBe('policy_allowed');

    const verification = await broker.call('governance.verifyDecisionAuditTrail', {
      tenantId: 'tenant-a',
      entityId: 'control-case-redispatch',
      rowId: 'row-policy-1',
    });
    expect(verification).toMatchObject({
      success: true,
      safety: 'read_only_integrity_check',
      verified: true,
      entryCount: 1,
      failures: [],
    });
  });
});
