'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const PouchDB = require('pouchdb');

const { createUiStateStore, defaultSession, defaultCaseId } = require('../src/cet-rc2-ui-state');

describe('CET RC2 UI state store', () => {
  let dir;
  let db;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-rc2-ui-state-'));
    db = new PouchDB(path.join(dir, 'state'));
    store = createUiStateStore({ db });
  });

  afterEach(async () => {
    await db.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns a tenant-scoped default session with held role only', async () => {
    const session = await store.getSession({ tenantId: defaultSession.tenantId });

    expect(session.tenantId).toBe(defaultSession.tenantId);
    expect(session.activeRoleId).toBe('ROLE_MARKET_OPERATIONS');
    expect(session.heldRoles.map((role) => role.roleId)).toContain('ROLE_MARKET_OPERATIONS');
    expect(session.heldRoles.map((role) => role.roleId)).not.toContain('ROLE_MANAGING_DIRECTOR');
  });

  it('builds a daily surface with one fixed reference Vorgang', async () => {
    const daily = await store.getDailySurface({ tenantId: defaultSession.tenantId });

    expect(daily.route).toBe('/api/ui/v0/daily');
    expect(daily.vorgaenge).toHaveLength(1);
    expect(daily.vorgaenge[0].vorgangId).toBe(defaultCaseId);
    expect(daily.vorgaenge[0].label).toMatch(/Artikel-ID/);
    expect(daily.vorgaenge[0].primaryRoleId).toBe('ROLE_MARKET_OPERATIONS');
  });

  it('persists takeover as a CET-internal write', async () => {
    const before = await store.getCase({
      tenantId: defaultSession.tenantId,
      caseId: defaultCaseId,
    });
    expect(before.takeover.status).toBe('offen');

    const result = await store.takeOver({
      tenantId: defaultSession.tenantId,
      caseId: defaultCaseId,
      actor: { id: 'u-thorsten', displayName: 'Thorsten' },
      now: '2026-09-21T12:00:00Z',
    });

    expect(result.takeover.status).toBe('mir_zugewiesen');
    expect(result.takeover.actor.displayName).toBe('Thorsten');

    const after = await store.getCase({ tenantId: defaultSession.tenantId, caseId: defaultCaseId });
    expect(after.takeover.status).toBe('mir_zugewiesen');
  });

  it('persists freeze and approval request without Fachsystem execute', async () => {
    await store.freezeCase({
      tenantId: defaultSession.tenantId,
      caseId: defaultCaseId,
      actor: { id: 'u-thorsten', displayName: 'Thorsten' },
      now: '2026-09-21T12:05:00Z',
    });

    const approval = await store.requestApproval({
      tenantId: defaultSession.tenantId,
      caseId: defaultCaseId,
      roleId: 'ROLE_DEPARTMENT_HEAD',
      actor: { id: 'u-thorsten', displayName: 'Thorsten' },
      now: '2026-09-21T12:06:00Z',
    });

    expect(approval.status).toBe('angefordert');
    expect(approval.externalExecute).toBe(false);

    const evidence = await store.getEvidence({
      tenantId: defaultSession.tenantId,
      caseId: defaultCaseId,
    });
    expect(evidence.freeze.status).toBe('eingefroren');
    expect(evidence.approvalRequests).toHaveLength(1);
  });

  it('lists Operationskonsole capabilities and marks not-projected prepare output', async () => {
    const operations = await store.listOperations({ tenantId: defaultSession.tenantId });
    expect(
      operations.operations.some((operation) => operation.id === 'capability.openapi.lookup')
    ).toBe(true);

    const prepared = await store.prepareOperation({
      tenantId: defaultSession.tenantId,
      operationId: 'capability.openapi.lookup',
      actor: { id: 'u-thorsten', displayName: 'Thorsten' },
      now: '2026-09-21T12:07:00Z',
    });

    expect(prepared.projectionStatus).toBe('not_projected');
    expect(prepared.rawPayload.operationId).toBe('capability.openapi.lookup');
    expect(prepared.usageLogRef).toMatch(/^cet-ui-operation-usage:/);
  });
});
