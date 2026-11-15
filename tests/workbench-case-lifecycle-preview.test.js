'use strict';
jest.mock('../src/llm-client', () => require('./helpers/workbench-llm-stub'));
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const Workbench = require('../services/workbench.service');
const caseLinking = require('../src/workbench-case-linking');
const conversationAssistance = require('../src/workbench-conversation');
const {
  AVAILABILITY,
  CASE_STATES,
  CHILD_CLASSES,
  DISPOSITIONS,
  MAX_CHILD_COUNT,
  NEXT_SAFE_GATES,
  PARENT_BINDINGS,
  planCaseLifecyclePreview,
} = require('../src/workbench-case-lifecycle-preview');

// Synthetic test-only tenant/case data (#1148).
const SECRET = 'SENTINEL-LIFECYCLE-1148';
const userMeta = {
  apiToken: {
    tenantId: 'tenant-a',
    id: 'user-a',
    scope: 'agentos-session',
    roles: ['ROLE_DATA_GOVERNANCE', 'ROLE_PROCESS_OWNER'],
  },
};
const clearedMeta = {
  apiToken: { ...userMeta.apiToken, id: 'user-cleared', sensitivityFlags: ['restricted'] },
};
const otherTenantMeta = { apiToken: { ...userMeta.apiToken, tenantId: 'tenant-b', id: 'user-b' } };
const unmappedMeta = {
  apiToken: { ...userMeta.apiToken, tenantId: 'tenant-unmapped', id: 'user-stale' },
};

const TOP_KEYS = [
  'view',
  'schemaVersion',
  'safetyClass',
  'processFamily',
  'controlCase',
  'executionSupported',
  'maxChildCount',
  'caseState',
  'parentBinding',
  'children',
  'summary',
].sort();
const ROW_KEYS = [
  'childClass',
  'count',
  'countCapped',
  'retentionClass',
  'currentAvailability',
  'plannedDisposition',
  'executionSupported',
  'blockerCode',
  'nextSafeGate',
  'accountableRole',
].sort();
const ORDER = CHILD_CLASSES.map((entry) => entry.childClass);

function expectClosed(preview) {
  expect(Object.keys(preview).sort()).toEqual(TOP_KEYS);
  expect(preview).toMatchObject({
    view: 'lifecycle_preview',
    schemaVersion: 'workbench-case-lifecycle-preview.v1',
    safetyClass: 'protected_read_only_case_lifecycle_preview',
    processFamily: 'workbench_case_lifecycle_governance',
    controlCase: 'selected_case_child_lifecycle_review',
    executionSupported: false,
  });
  expect(CASE_STATES).toContain(preview.caseState);
  expect(PARENT_BINDINGS).toContain(preview.parentBinding);
  for (const row of preview.children) {
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(row.executionSupported).toBe(false);
    expect(DISPOSITIONS).toContain(row.plannedDisposition);
    expect(AVAILABILITY).toContain(row.currentAvailability);
    expect(NEXT_SAFE_GATES).toContain(row.nextSafeGate);
    expect(
      row.count === null || (Number.isInteger(row.count) && row.count <= MAX_CHILD_COUNT)
    ).toBe(true);
    for (const value of Object.values(row)) {
      expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
    }
  }
  expect(preview.children.slice(0, ORDER.length).map((r) => r.childClass)).toEqual(ORDER);
  expect(preview.summary.childClassCount).toBe(preview.children.length);
}
const rowOf = (preview, childClass) => preview.children.find((r) => r.childClass === childClass);

describe('planCaseLifecyclePreview (pure)', () => {
  const counts = {
    conversation_assistance: 2,
    case_display_reference: 1,
    case_drafts: 0,
    document_reviews: 0,
    evidence_refs: 3,
    tool_runs: 1,
    turn_memory: 1,
    inbox_tasks: 0,
    case_events: 2,
    audit_records: 1,
  };

  test('active linked case classifies every child class with a closed disposition', () => {
    const preview = planCaseLifecyclePreview(
      { available: true, discarded: false, conversationLinked: true },
      counts
    );
    expectClosed(preview);
    expect(preview).toMatchObject({ caseState: 'active', parentBinding: 'conversation_linked' });
    expect(rowOf(preview, 'domain_case_state')).toMatchObject({
      count: 1,
      plannedDisposition: 'retain_parent_record',
      nextSafeGate: 'process_owner_hold_review',
    });
    expect(rowOf(preview, 'conversation_mapping')).toMatchObject({
      count: 1,
      plannedDisposition: 'remove_link_only',
    });
    expect(rowOf(preview, 'evidence_refs')).toMatchObject({
      count: 3,
      plannedDisposition: 'erase_with_parent_not_implemented',
      blockerCode: 'erasure_not_implemented',
    });
    expect(rowOf(preview, 'inbox_tasks')).toMatchObject({
      count: 0,
      plannedDisposition: 'not_present',
      currentAvailability: 'absent',
    });
    expect(rowOf(preview, 'case_events').plannedDisposition).toBe(
      'independent_retention_policy_required'
    );
    expect(rowOf(preview, 'audit_records').plannedDisposition).toBe(
      'pseudonymize_only_policy_required'
    );
    expect(preview.summary).toEqual({
      childClassCount: ORDER.length,
      retainedCount: 1,
      linkOnlyCount: 1,
      eraseEligibleCount: 5,
      pseudonymizationRequiredCount: 1,
      unresolvedPolicyCount: 1,
      notPresentCount: 3,
    });
    expect(Object.isFrozen(preview) && Object.isFrozen(preview.children[0])).toBe(true);
  });

  test('discarded does not imply deletion; unlinked assistance is unresolved, not absent', () => {
    const preview = planCaseLifecyclePreview(
      { available: true, discarded: true, conversationLinked: false },
      { ...counts, conversation_assistance: 0 }
    );
    expectClosed(preview);
    expect(preview).toMatchObject({
      caseState: 'discarded',
      parentBinding: 'conversation_unlinked',
    });
    expect(rowOf(preview, 'domain_case_state').plannedDisposition).toBe('retain_parent_record');
    expect(rowOf(preview, 'evidence_refs').plannedDisposition).toBe(
      'erase_with_parent_not_implemented'
    );
    expect(rowOf(preview, 'conversation_mapping').plannedDisposition).toBe('not_present');
    expect(rowOf(preview, 'conversation_assistance')).toMatchObject({
      count: null,
      currentAvailability: 'unprovable',
      plannedDisposition: 'independent_retention_policy_required',
      blockerCode: 'conversation_association_unprovable_after_unlink',
    });
  });

  test('parent-unavailable reports nothing as present, absent or deleted', () => {
    for (const parent of [null, undefined, { available: false }, {}]) {
      const preview = planCaseLifecyclePreview(parent, counts);
      expectClosed(preview);
      expect(preview).toMatchObject({
        caseState: 'unavailable',
        parentBinding: 'parent_unavailable',
      });
      for (const row of preview.children) {
        expect(row).toMatchObject({
          count: null,
          currentAvailability: 'unprovable',
          plannedDisposition: 'independent_retention_policy_required',
          blockerCode: 'parent_unavailable',
        });
      }
    }
  });

  test('counts are capped and invalid or missing counts fail closed', () => {
    const preview = planCaseLifecyclePreview(
      { available: true, conversationLinked: true },
      { ...counts, evidence_refs: 5000, tool_runs: -1, turn_memory: 'x', inbox_tasks: undefined }
    );
    expectClosed(preview);
    expect(rowOf(preview, 'evidence_refs')).toMatchObject({
      count: MAX_CHILD_COUNT,
      countCapped: true,
    });
    for (const name of ['tool_runs', 'turn_memory', 'inbox_tasks']) {
      expect(rowOf(preview, name)).toMatchObject({
        count: null,
        plannedDisposition: 'independent_retention_policy_required',
        blockerCode: 'child_count_unavailable',
      });
    }
    const missing = planCaseLifecyclePreview({ available: true }, {});
    expect(rowOf(missing, 'evidence_refs').blockerCode).toBe('child_count_unavailable');
  });

  test('unknown child classes fail closed without echoing their names', () => {
    const preview = planCaseLifecyclePreview(
      { available: true, conversationLinked: true },
      { ...counts, [`${SECRET}_class`]: 4, unclassified_children: 1 }
    );
    expectClosed(preview);
    expect(rowOf(preview, 'unclassified_children')).toMatchObject({
      count: 5,
      retentionClass: 'unclassified',
      plannedDisposition: 'independent_retention_policy_required',
      blockerCode: 'unclassified_child_class',
    });
    const invalid = planCaseLifecyclePreview({ available: true }, { ...counts, foo: 'bar' });
    expect(rowOf(invalid, 'unclassified_children')).toMatchObject({
      count: null,
      plannedDisposition: 'independent_retention_policy_required',
    });
    expect(JSON.stringify(preview)).not.toContain(SECRET);
    const none = planCaseLifecyclePreview({ available: true }, counts);
    expect(rowOf(none, 'unclassified_children')).toBeUndefined();
  });
});

describe('workbench.cases.get view=lifecycle_preview (#1148)', () => {
  let broker, dir, workbench, routerService;
  const call = (params, auth = userMeta) =>
    broker.call('workbench.cases.get', params, { meta: JSON.parse(JSON.stringify(auth)) });
  const classify = (userRequest, auth = userMeta) =>
    broker.call(
      'domain-router.classify',
      { userRequest, asyncDelivery: { mode: 'poll', clientId: 'lifecycle-client' } },
      { meta: JSON.parse(JSON.stringify(auth)) }
    );
  const allDbs = () => ({
    state: routerService.db,
    events: routerService.eventsDb,
    conversations: workbench.conversationsDb,
    evidence: workbench.store.evidenceDb,
    turnMemory: workbench.store.turnMemoryDb,
    inbox: workbench.store.inboxDb,
    toolRuns: workbench.store.toolRunDb,
    context: workbench.store.contextDb,
  });

  async function snapshot() {
    const out = {};
    for (const [name, db] of Object.entries(allDbs())) {
      const rows = await db.allDocs({ include_docs: true });
      out[name] = rows.rows.map((r) => [r.id, r.value.rev]);
    }
    return out;
  }

  async function seedCase() {
    const { cetCaseId: caseId } = await classify(
      'Netzanschluss Anschlussleistung für Rechenzentrum prüfen'
    );
    const store = workbench.store;
    const p = { tenantId: 'tenant-a', actorId: 'user-a' };
    await store.linkConversation({
      tenantId: 'tenant-a',
      client: 'open-webui',
      conversationId: 'conv-1148',
      cetCaseId: caseId,
    });
    await conversationAssistance.saveTurn(
      workbench.conversationsDb,
      p,
      { channel: 'open-webui', conversationId: 'conv-1148', userRequest: `turn ${SECRET}` },
      { lastAnswer: SECRET }
    );
    await conversationAssistance.saveDraft(workbench.conversationsDb, p, caseId, SECRET);
    await store.saveEvidence({
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      evidenceId: 'ev_1148',
      evidenceType: 'generic_document',
      label: `label ${SECRET}`,
      safeSummary: SECRET,
      sourceType: 'existing_cet_evidence_ref',
      sensitivityLevel: 'tenant_internal',
    });
    await store.saveToolRun({
      toolRunId: 'tr_1148',
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      toolId: 'api_lookup',
      toolClass: 'api_lookup',
      sideEffectClass: 'read_only',
      status: 'failed',
      inputSummary: SECRET,
      outputSummary: SECRET,
      blockedReason: `error ${SECRET}`,
      receiptRefs: [{ receiptId: `rcpt_${SECRET}` }],
      startedAt: new Date().toISOString(),
    });
    await routerService.eventsDb.put({
      _id: `case-audit:${SECRET}`,
      tenantId: 'tenant-a',
      actorId: 'user-x',
      cetCaseId: caseId,
      kind: 'observed',
      summary: SECRET,
    });
    await routerService.eventsDb.put({
      _id: `odd-${SECRET}`,
      tenantId: 'tenant-a',
      cetCaseId: caseId,
      payload: SECRET,
    });
    return caseId;
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-lifecycle-preview-'));
    broker = new ServiceBroker({ logger: false, transporter: null, requestTimeout: 10000 });
    broker.createService({
      ...Router,
      settings: {
        ...Router.settings,
        dbPath: path.join(dir, 'state'),
        eventsDbPath: path.join(dir, 'events'),
        knowledgeTimeoutMs: 10,
      },
    });
    broker.createService({
      ...Workbench,
      settings: {
        dbPath: path.join(dir, 'conversations'),
        identityDbPath: path.join(dir, 'identity'),
        deliveryDbPath: path.join(dir, 'delivery'),
        evidenceDbPath: path.join(dir, 'evidence'),
        turnMemoryDbPath: path.join(dir, 'turn-memory'),
        contextDbPath: path.join(dir, 'context'),
        playbookDbPath: path.join(dir, 'playbooks'),
        inboxDbPath: path.join(dir, 'inbox'),
        toolRunDbPath: path.join(dir, 'tool-runs'),
        mailAccountDbPath: path.join(dir, 'mail-accounts'),
      },
    });
    broker.createService({
      name: 'capability-broker',
      actions: { recommend: () => ({ recommendedCapabilities: [] }) },
    });
    broker.createService({ name: 'knowledge-rag', actions: { query: () => ({ results: [] }) } });
    await broker.start();
    workbench = broker.getLocalService('workbench');
    routerService = broker.getLocalService('domain-router');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('active linked case: closed bounded preview with counts only, no sentinels', async () => {
    const caseId = await seedCase();
    const preview = await call({ caseId, view: 'lifecycle_preview' });
    expectClosed(preview);
    expect(preview).toMatchObject({ caseState: 'active', parentBinding: 'conversation_linked' });
    expect(rowOf(preview, 'conversation_mapping').count).toBe(1);
    expect(rowOf(preview, 'conversation_assistance')).toMatchObject({
      count: 1,
      plannedDisposition: 'erase_with_parent_not_implemented',
    });
    expect(rowOf(preview, 'case_drafts').count).toBe(1);
    expect(rowOf(preview, 'evidence_refs').count).toBe(1);
    expect(rowOf(preview, 'tool_runs').count).toBe(1);
    expect(rowOf(preview, 'audit_records')).toMatchObject({
      count: 1,
      plannedDisposition: 'pseudonymize_only_policy_required',
    });
    expect(rowOf(preview, 'unclassified_children')).toMatchObject({
      count: 1,
      plannedDisposition: 'independent_retention_policy_required',
    });
    const body = JSON.stringify(preview);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain(caseId);
    expect(body).not.toContain('conv-1148');
    expect(body).not.toContain('user-a');
  });

  test('repeated reads are byte-stable, write nothing and call no lifecycle command', async () => {
    const caseId = await seedCase();
    const before = await snapshot();
    const writes = [];
    for (const [name, db] of Object.entries(allDbs())) {
      for (const method of ['put', 'remove', 'bulkDocs', 'destroy']) {
        jest.spyOn(db, method).mockImplementation(() => {
          writes.push(`${name}.${method}`);
          throw new Error('write forbidden in lifecycle preview');
        });
      }
    }
    const unlink = jest.spyOn(workbench.store, 'unlinkConversation');
    const saveTurn = jest.spyOn(conversationAssistance, 'saveTurn');
    const readTurn = jest.spyOn(conversationAssistance, 'readTurn');
    const displayRef = jest.spyOn(workbench.store, 'caseDisplayRef');
    const callSpy = jest.spyOn(broker, 'call');
    const first = JSON.stringify(await call({ caseId, view: 'lifecycle_preview' }));
    for (let i = 0; i < 3; i++) {
      expect(JSON.stringify(await call({ caseId, view: 'lifecycle_preview' }))).toBe(first);
    }
    expect(writes).toEqual([]);
    expect(unlink).not.toHaveBeenCalled();
    expect(saveTurn).not.toHaveBeenCalled();
    expect(readTurn).not.toHaveBeenCalled();
    expect(displayRef).not.toHaveBeenCalled();
    for (const [name] of callSpy.mock.calls) {
      expect(name).toBe('workbench.cases.get');
    }
    jest.restoreAllMocks();
    expect(await snapshot()).toEqual(before);
  });

  test('discarded and conversation-unlinked case: parent retained, assistance unresolved', async () => {
    const caseId = await seedCase();
    await broker.call('domain-router.discard', { cetCaseId: caseId }, { meta: userMeta });
    await workbench.store.unlinkConversation({
      tenantId: 'tenant-a',
      client: 'open-webui',
      conversationId: 'conv-1148',
    });
    const preview = await call({ caseId, view: 'lifecycle_preview' });
    expectClosed(preview);
    expect(preview).toMatchObject({
      caseState: 'discarded',
      parentBinding: 'conversation_unlinked',
    });
    expect(rowOf(preview, 'domain_case_state').plannedDisposition).toBe('retain_parent_record');
    expect(rowOf(preview, 'conversation_mapping').plannedDisposition).toBe('not_present');
    expect(rowOf(preview, 'conversation_assistance')).toMatchObject({
      count: null,
      currentAvailability: 'unprovable',
      plannedDisposition: 'independent_retention_policy_required',
      blockerCode: 'conversation_association_unprovable_after_unlink',
    });
    // Discard does not delete operational children; they remain visible as not-yet-erasable.
    expect(rowOf(preview, 'evidence_refs')).toMatchObject({
      count: 1,
      plannedDisposition: 'erase_with_parent_not_implemented',
    });
    expect(JSON.stringify(preview)).not.toContain(SECRET);
  });

  test('empty stores on a fresh unlinked case report absence explicitly', async () => {
    const { cetCaseId: caseId } = await classify('Netzanschluss Leistung prüfen');
    const preview = await call({ caseId, view: 'lifecycle_preview' });
    expectClosed(preview);
    expect(preview.parentBinding).toBe('conversation_unlinked');
    expect(rowOf(preview, 'evidence_refs')).toMatchObject({
      count: 0,
      plannedDisposition: 'not_present',
    });
    expect(rowOf(preview, 'unclassified_children')).toBeUndefined();
  });

  test('inaccessible cases fail indistinguishably before any child read', async () => {
    const caseId = await seedCase();
    const hidden = await classify('Netzanschluss vertraulicher Fall prüfen', clearedMeta);
    const { rows } = await routerService.db.allDocs({ include_docs: true });
    const doc = rows.map((r) => r.doc).find((d) => d.cetCaseId === hidden.cetCaseId);
    await routerService.db.put({ ...doc, sensitivityFlags: ['restricted'] });

    const reads = [
      'listEvidence',
      'listToolRuns',
      'listInboxTasks',
      'getTurnMemory',
      'hasCaseDisplayRef',
    ].map((method) => jest.spyOn(workbench.store, method));
    const drafts = jest.spyOn(conversationAssistance, 'listDrafts');
    const preview = jest.spyOn(workbench, 'caseLifecyclePreview');
    const failures = [];
    for (const [params, auth] of [
      [{ caseId, view: 'lifecycle_preview' }, otherTenantMeta],
      [{ caseId, view: 'lifecycle_preview' }, unmappedMeta],
      [{ caseId: hidden.cetCaseId, view: 'lifecycle_preview' }, userMeta],
      [{ caseId: 'cet_case_missing', view: 'lifecycle_preview' }, userMeta],
    ]) {
      const error = await call(params, auth).then(
        () => null,
        (e) => e
      );
      expect(error).not.toBeNull();
      expect(String(error.message)).not.toContain(SECRET);
      failures.push([error.code, error.type]);
    }
    expect(failures).toEqual(Array(4).fill([404, 'WORKBENCH_NOT_FOUND']));
    for (const spy of [...reads, drafts, preview]) expect(spy).not.toHaveBeenCalled();
  });

  test('shared case summaries fail closed for the lifecycle view', async () => {
    const caseId = await seedCase();
    jest.spyOn(caseLinking, 'sharedCaseSummary').mockResolvedValue({ summary: SECRET });
    const preview = jest.spyOn(workbench, 'caseLifecyclePreview');
    await expect(call({ caseId, view: 'lifecycle_preview' })).rejects.toMatchObject({
      type: 'WORKBENCH_CASE_INSPECTOR_UNAVAILABLE',
    });
    expect(preview).not.toHaveBeenCalled();
  });

  test('unknown view values are still rejected by validation', async () => {
    const caseId = await seedCase();
    await expect(call({ caseId, view: 'lifecycle_execute' })).rejects.toThrow(/validation/iu);
  });
});
