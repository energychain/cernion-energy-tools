'use strict';
jest.mock('../src/llm-client', () => require('./helpers/workbench-llm-stub'));
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const Router = require('../services/domain-router.service');
const Workbench = require('../services/workbench.service');
const {
  MAX_INSPECTOR_ROWS,
  presentToolRunInspector,
  presentToolRunInspectorList,
} = require('../src/workbench-toolrun-presenter');
const { MAX_EVIDENCE_ROWS, presentCaseInspector } = require('../src/workbench-case-presenter');
const caseLinking = require('../src/workbench-case-linking');

const SECRET = 'SENTINEL-SECRET-660';
const userMeta = {
  apiToken: {
    tenantId: 'tenant-a',
    id: 'user-a',
    scope: 'agentos-session',
    roles: ['ROLE_PROCESS_OWNER', 'ROLE_GRID_OPERATOR'],
  },
};
const clearedMeta = {
  apiToken: { ...userMeta.apiToken, id: 'user-cleared', sensitivityFlags: ['restricted'] },
};
const otherTenantMeta = {
  apiToken: { ...userMeta.apiToken, tenantId: 'tenant-b', id: 'user-b' },
};

const ROW_KEYS = [
  'toolRunId',
  'caseId',
  'toolId',
  'toolClass',
  'sideEffectClass',
  'status',
  'governanceOutcome',
  'failureLabel',
  'failureSummary',
  'startedAt',
  'finishedAt',
  'evidenceRefIds',
  'evidenceRefCount',
  'restrictedEvidenceRefCount',
  'receiptRefIds',
  'receiptRefCount',
  'auditRef',
  'nextSafeGate',
].sort();

function expectScalarRow(row) {
  expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
  for (const [field, value] of Object.entries(row)) {
    if (field === 'evidenceRefIds' || field === 'receiptRefIds') {
      expect(Array.isArray(value)).toBe(true);
      for (const id of value) expect(typeof id).toBe('string');
    } else {
      expect(value === null || ['string', 'number'].includes(typeof value)).toBe(true);
    }
  }
}

const CASE_TOP_KEYS = [
  'view',
  'schemaVersion',
  'caseId',
  'evidenceLimit',
  'evidenceTotalCount',
  'evidenceReturnedCount',
  'evidenceTruncated',
  'toolRunInspectorPath',
  'case',
  'evidenceItems',
  'missingEvidenceItems',
  'clarificationItems',
  'noCallItems',
].sort();
const CASE_ROW_KEYS = [
  'caseId',
  'title',
  'primaryDomain',
  'readinessState',
  'status',
  'updatedAt',
  'evidenceCount',
  'redactedEvidenceCount',
  'missingEvidenceCount',
  'requiredClarificationCount',
  'noCallGuardCount',
  'pendingEventCount',
  'attentionEventCount',
  'nextSafeGate',
  'nextSafeGateLabel',
  'refreshAllowed',
  'mutationAllowed',
].sort();
const EVIDENCE_ROW_KEYS = [
  'evidenceId',
  'caseId',
  'evidenceType',
  'label',
  'status',
  'sourceType',
  'sensitivityLevel',
  'redacted',
  'sourceFingerprintStatus',
  'fileHashStatus',
  'provenanceLabel',
  'evidenceRole',
  'claimStrength',
  'readinessReviewRequired',
  'createdAt',
].sort();
const GUIDANCE_ROW_KEYS = ['position', 'code', 'label'].sort();
const LIST_KEYS = ['evidenceItems', 'missingEvidenceItems', 'clarificationItems', 'noCallItems'];

function expectScalarCells(row, keys) {
  expect(Object.keys(row).sort()).toEqual(keys);
  for (const value of Object.values(row)) {
    expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
    if (typeof value === 'string') {
      expect(value.length).toBeLessThanOrEqual(200);
      expect(value).not.toContain('[object Object]');
    }
  }
}

function expectClosedCaseInspector(body) {
  expect(Object.keys(body).sort()).toEqual(CASE_TOP_KEYS);
  for (const [key, value] of Object.entries(body)) {
    if (key === 'case' || LIST_KEYS.includes(key)) continue;
    expect(value === null || ['string', 'number', 'boolean'].includes(typeof value)).toBe(true);
  }
  expectScalarCells(body.case, CASE_ROW_KEYS);
  body.evidenceItems.forEach((row) => expectScalarCells(row, EVIDENCE_ROW_KEYS));
  for (const key of LIST_KEYS.slice(1)) {
    expect(body[key].length).toBeLessThanOrEqual(25);
    body[key].forEach((row) => expectScalarCells(row, GUIDANCE_ROW_KEYS));
  }
  expect(body.evidenceItems.length).toBeLessThanOrEqual(MAX_EVIDENCE_ROWS);
}

const iso = (minute) => `2026-10-14T10:${String(minute).padStart(2, '0')}:00.000Z`;

describe('presentToolRunInspector (pure)', () => {
  test('maps completed, failed, blocked and unknown runs to distinct bounded states', () => {
    const base = { toolRunId: 'tr1', caseId: 'c1', toolId: 'api_lookup', tenantId: 't' };
    const rows = ['completed', 'failed', 'blocked', 'weird<script>'].map((status) =>
      presentToolRunInspector({ ...base, status, blockedReason: 'external_effect_blocked' })
    );
    expect(rows.map((r) => r.status)).toEqual(['completed', 'failed', 'blocked', 'unknown']);
    expect(rows.map((r) => r.governanceOutcome)).toEqual([
      'allowed',
      'allowed',
      'policy_blocked',
      'unknown',
    ]);
    expect(rows.map((r) => r.failureLabel)).toEqual([
      null,
      'tool_run_failed',
      'external_effect_blocked',
      'status_unknown',
    ]);
    expect(new Set(rows.map((r) => r.nextSafeGate)).size).toBe(4);
    rows.forEach(expectScalarRow);
  });

  test('drops unsafe identifiers and secret-bearing refs instead of echoing them', () => {
    const row = presentToolRunInspector({
      toolRunId: 'tr1',
      caseId: 'c1',
      toolId: `https://x/?token=${SECRET}`,
      status: 'failed',
      blockedReason: `connect failed for https://u:${SECRET}@host`,
      auditRef: `audit with ${SECRET} spaces`,
      receiptRefs: ['rcpt-1', { receiptId: 'rcpt-2', payload: SECRET }, `https://h/?k=${SECRET}`],
      startedAt: 'not a date',
    });
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(row).toMatchObject({
      toolId: 'unknown',
      failureLabel: 'tool_run_failed',
      auditRef: null,
      receiptRefIds: ['rcpt-1', 'rcpt-2'],
      receiptRefCount: 2,
      startedAt: null,
    });
  });

  test('list clamps to the maximum and orders newest first with a stable tiebreak', () => {
    const runs = Array.from({ length: 40 }, (_, i) => ({
      toolRunId: `tr_${String(i).padStart(2, '0')}`,
      caseId: 'c1',
      status: 'completed',
      startedAt: iso(i % 20),
    }));
    const shuffled = [...runs].reverse();
    const a = presentToolRunInspectorList(runs, { caseId: 'c1', limit: 500 });
    const b = presentToolRunInspectorList(shuffled, { caseId: 'c1' });
    expect(a.limit).toBe(MAX_INSPECTOR_ROWS);
    expect(a.items).toHaveLength(25);
    expect(a).toMatchObject({ totalCount: 40, returnedCount: 25, truncated: true });
    expect(b.items).toEqual(a.items);
    expect(a.items[0].toolRunId).toBe('tr_39');
    expect(a.items[1].toolRunId).toBe('tr_19');
    expect(presentToolRunInspectorList(runs, { caseId: 'c1', limit: 3 }).items).toHaveLength(3);
  });
});

describe('presentCaseInspector (pure)', () => {
  const caseState = (extra = {}) => ({
    cetCaseId: 'c1',
    tenantId: 't',
    updatedAt: iso(0),
    lastClassification: { primaryDomain: 'grid', readinessState: 'ready' },
    ...extra,
  });
  const evidence = Array.from({ length: 70 }, (_, i) => ({
    evidenceId: `ev_${String(i).padStart(2, '0')}`,
    caseId: 'c1',
    tenantId: 't',
    evidenceType: 'generic_document',
    label: `Doc ${i}`,
    status: 'attached',
    sensitivityLevel: 'tenant_internal',
    createdAt: iso(i % 30),
  }));

  test('EvidenceRef rows honour 1/default/max/over-max bounds with deterministic order', () => {
    const opts = (limit) => ({ evidenceRefs: evidence, tenantId: 't', limit });
    const byDefault = presentCaseInspector(caseState(), opts());
    const shuffled = presentCaseInspector(caseState(), {
      ...opts(),
      evidenceRefs: [...evidence].reverse(),
    });
    expect(byDefault).toMatchObject({
      evidenceLimit: 25,
      evidenceTotalCount: 70,
      evidenceReturnedCount: 25,
      evidenceTruncated: true,
    });
    expect(shuffled.evidenceItems).toEqual(byDefault.evidenceItems);
    // Same createdAt (minute 29) for ev_29 and ev_59: ID tie-breaker, newest first.
    expect(byDefault.evidenceItems.slice(0, 3).map((r) => r.evidenceId)).toEqual([
      'ev_59',
      'ev_29',
      'ev_58',
    ]);
    expect(presentCaseInspector(caseState(), opts(1)).evidenceItems).toHaveLength(1);
    expect(presentCaseInspector(caseState(), opts(50)).evidenceItems).toHaveLength(50);
    expect(presentCaseInspector(caseState(), opts(999)).evidenceLimit).toBe(MAX_EVIDENCE_ROWS);
    expect(presentCaseInspector(caseState(), opts(0)).evidenceLimit).toBe(25);
    expectClosedCaseInspector(byDefault);
  });

  test('guidance rows are bounded scalars and next gate is deterministic positive guidance', () => {
    const many = Array.from({ length: 40 }, (_, i) => `guard_${i}`);
    const out = presentCaseInspector(
      caseState({
        lastClassification: {
          missingEvidence: [{ type: 'grid_doc', label: { nested: SECRET } }, 'meter_export'],
          requiredClarifications: [`See https://u:${SECRET}@host/p?token=${SECRET}`],
          noCallGuards: many,
        },
      })
    );
    expectClosedCaseInspector(out);
    expect(out.noCallItems).toHaveLength(25);
    expect(out.case).toMatchObject({
      noCallGuardCount: 40,
      missingEvidenceCount: 2,
      nextSafeGate: 'evidence_required',
      refreshAllowed: true,
      mutationAllowed: false,
    });
    expect(out.clarificationItems[0].label).toBe('See https://host/p');
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(presentCaseInspector(caseState()).case.nextSafeGate).toBe('refresh_case_projection');
    expect(presentCaseInspector(caseState({ disposition: 'discarded' })).case.nextSafeGate).toBe(
      'case_discarded'
    );
  });
});

describe('Workbench inspector views (#660)', () => {
  let broker, dir, workbench, routerService;
  const call = (action, params = {}, auth = userMeta) =>
    broker.call(`workbench.${action}`, params, { meta: JSON.parse(JSON.stringify(auth)) });
  const classify = (userRequest, auth = userMeta) =>
    broker.call(
      'domain-router.classify',
      { userRequest, asyncDelivery: { mode: 'poll', clientId: 'inspector-client' } },
      { meta: JSON.parse(JSON.stringify(auth)) }
    );

  async function dbSnapshot() {
    const dbs = {
      toolRuns: workbench.store.toolRunDb,
      evidence: workbench.store.evidenceDb,
      inbox: workbench.store.inboxDb,
      state: routerService.db,
      events: routerService.eventsDb,
    };
    const out = {};
    for (const [name, db] of Object.entries(dbs)) {
      const rows = await db.allDocs({ include_docs: true });
      out[name] = rows.rows.map((r) => [r.id, r.value.rev, r.doc.updatedAt || null]);
    }
    return out;
  }

  async function seedCase() {
    const c = await classify('Netzanschluss Anschlussleistung für Rechenzentrum prüfen');
    const caseId = c.cetCaseId;
    const store = workbench.store;
    const open = await store.saveEvidence({
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      evidenceId: 'ev_open',
      evidenceType: 'generic_document',
      label: 'Open tool evidence',
      safeSummary: `summary ${SECRET}`,
      sourceType: 'existing_cet_evidence_ref',
      sourceRef: { sourceLabel: SECRET },
      sensitivityLevel: 'tenant_internal',
      provenance: { system: 'test', token: SECRET },
      extracts: { safeSummary: SECRET },
    });
    const restricted = await store.saveEvidence({
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      evidenceId: 'ev_restricted',
      evidenceType: 'generic_document',
      label: `Restricted label ${SECRET}`,
      sourceType: 'existing_cet_evidence_ref',
      sensitivityLevel: 'restricted',
    });
    const nestedRef = (doc) => ({ ...doc, rawPayload: SECRET, headers: { cookie: SECRET } });
    await store.saveToolRun({
      toolRunId: 'tr_completed',
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      toolId: 'api_lookup',
      toolClass: 'api_lookup',
      sideEffectClass: 'read_only',
      status: 'completed',
      inputSummary: JSON.stringify({ authorization: `Bearer ${SECRET}` }),
      outputSummary: `raw connector response ${SECRET}`,
      evidenceRefs: [nestedRef(open), nestedRef(restricted)],
      receiptRefs: [{ receiptId: 'rcpt_1', signature: SECRET }],
      auditRef: `audit:${caseId}:ev_open`,
      startedAt: iso(3),
      finishedAt: iso(4),
    });
    await store.saveToolRun({
      toolRunId: 'tr_failed',
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      toolId: 'web_fetch',
      toolClass: 'web_fetch',
      sideEffectClass: 'read_only',
      status: 'failed',
      inputSummary: `{"url":"https://h/?token=${SECRET}"}`,
      blockedReason: `fetch https://u:${SECRET}@h failed`,
      startedAt: iso(2),
      finishedAt: iso(2),
    });
    await store.saveToolRun({
      toolRunId: 'tr_blocked',
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      toolId: 'mail_send',
      toolClass: 'mail_send',
      sideEffectClass: 'external_business_effect',
      status: 'blocked',
      inputSummary: 'Tool run blocked by CET governance',
      blockedReason: 'external_effect_blocked',
      startedAt: iso(1),
      finishedAt: iso(1),
    });
    return caseId;
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cet-toolrun-inspector-'));
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
    broker.createService({
      name: 'knowledge-rag',
      actions: { query: () => ({ results: [] }) },
    });
    await broker.start();
    workbench = broker.getLocalService('workbench');
    routerService = broker.getLocalService('domain-router');
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('list view returns bounded, scalar, newest-first rows with distinct states', async () => {
    const caseId = await seedCase();
    const list = await call('tool-runs.list', { caseId, view: 'inspector' });
    expect(list).toMatchObject({
      view: 'inspector',
      schemaVersion: 'workbench-toolrun-inspector.v1',
      caseId,
      limit: 25,
      totalCount: 3,
      returnedCount: 3,
      truncated: false,
    });
    expect(list.items.map((r) => r.toolRunId)).toEqual(['tr_completed', 'tr_failed', 'tr_blocked']);
    list.items.forEach(expectScalarRow);
    const [completed, failed, blocked] = list.items;
    expect(completed).toMatchObject({
      status: 'completed',
      governanceOutcome: 'allowed',
      failureLabel: null,
      evidenceRefIds: ['ev_open', 'ev_restricted'],
      evidenceRefCount: 2,
      receiptRefIds: ['rcpt_1'],
      receiptRefCount: 1,
      auditRef: `audit:${caseId}:ev_open`,
      startedAt: iso(3),
      finishedAt: iso(4),
    });
    expect(failed).toMatchObject({ status: 'failed', failureLabel: 'tool_run_failed' });
    expect(blocked).toMatchObject({
      status: 'blocked',
      governanceOutcome: 'policy_blocked',
      failureLabel: 'external_effect_blocked',
      sideEffectClass: 'external_business_effect',
    });
    expect(JSON.stringify(list)).not.toContain(SECRET);
    for (const forbidden of ['inputSummary', 'outputSummary', '_id', '_rev', 'actorId']) {
      expect(JSON.stringify(list)).not.toContain(`"${forbidden}"`);
    }

    const limited = await call('tool-runs.list', { caseId, view: 'inspector', limit: '2' });
    expect(limited).toMatchObject({ limit: 2, returnedCount: 2, truncated: true });
    const clamped = await call('tool-runs.list', { caseId, view: 'inspector', limit: 999 });
    expect(clamped.limit).toBe(25);
    await expect(call('tool-runs.list', { caseId, view: 'raw' })).rejects.toThrow(/validation/iu);
  });

  test('list default bound holds at 25 rows for a large case', async () => {
    const c = await classify('Netzanschluss Anschlussleistung prüfen');
    for (let i = 0; i < 30; i++) {
      await workbench.store.saveToolRun({
        toolRunId: `tr_${String(i).padStart(2, '0')}`,
        tenantId: 'tenant-a',
        actorId: 'user-a',
        caseId: c.cetCaseId,
        toolId: 'api_lookup',
        status: 'completed',
        startedAt: iso(i),
      });
    }
    const list = await call('tool-runs.list', { caseId: c.cetCaseId, view: 'inspector' });
    expect(list).toMatchObject({ totalCount: 30, returnedCount: 25, truncated: true });
    expect(list.items[0].toolRunId).toBe('tr_29');
    expect(list.items[24].toolRunId).toBe('tr_05');
  });

  test('restricted EvidenceRefs are reduced per authenticated clearance', async () => {
    const caseId = await seedCase();
    const plain = await call('tool-runs.get', {
      caseId,
      toolRunId: 'tr_completed',
      view: 'inspector',
    });
    expect(plain.toolRun).toMatchObject({ evidenceRefCount: 2, restrictedEvidenceRefCount: 1 });
    const cleared = await call(
      'tool-runs.get',
      { caseId, toolRunId: 'tr_completed', view: 'inspector' },
      clearedMeta
    );
    expect(cleared.toolRun).toMatchObject({ evidenceRefCount: 2, restrictedEvidenceRefCount: 0 });
    expectScalarRow(plain.toolRun);
    expect(JSON.stringify([plain, cleared])).not.toContain(SECRET);
  });

  test('detail uses the same presenter and keeps tenant and case-mismatch guards', async () => {
    const caseId = await seedCase();
    const detail = await call('tool-runs.get', {
      caseId,
      toolRunId: 'tr_blocked',
      view: 'inspector',
    });
    expect(detail).toMatchObject({ view: 'inspector', schemaVersion: expect.any(String) });
    const list = await call('tool-runs.list', { caseId, view: 'inspector' });
    expect(detail.toolRun).toEqual(list.items.find((r) => r.toolRunId === 'tr_blocked'));

    const other = await classify('Netzanschluss zweiter Fall prüfen');
    await expect(
      call('tool-runs.get', { caseId: other.cetCaseId, toolRunId: 'tr_blocked', view: 'inspector' })
    ).rejects.toMatchObject({ type: 'WORKBENCH_TOOL_RUN_CASE_MISMATCH' });
    await expect(
      call('tool-runs.list', { caseId, view: 'inspector' }, otherTenantMeta)
    ).rejects.toThrow();
    await expect(
      call('tool-runs.get', { caseId, toolRunId: 'tr_blocked', view: 'inspector' }, otherTenantMeta)
    ).rejects.toThrow();
  });

  test('repeated inspector and case GETs are read-only and trigger no execution', async () => {
    const caseId = await seedCase();
    const callSpy = jest.spyOn(broker, 'call');
    const before = await dbSnapshot();
    expect(before.toolRuns).toHaveLength(3);
    expect(before.evidence).toHaveLength(2);
    expect(before.state.length).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      await call('tool-runs.list', { caseId, view: 'inspector' });
      await call('tool-runs.get', { caseId, toolRunId: 'tr_completed', view: 'inspector' });
      await call('cases.get', { caseId, includeEvidence: true });
    }
    expect(await dbSnapshot()).toEqual(before);
    const called = callSpy.mock.calls.map(([name]) => name);
    for (const name of called) {
      expect(name).not.toMatch(/tools\.run|evidence\.attach|continue|acknowledge|ingestUpdate/u);
    }
    callSpy.mockRestore();
  });

  test('legacy mode without view keeps the raw ToolRun contract', async () => {
    const caseId = await seedCase();
    const list = await call('tool-runs.list', { caseId });
    expect(Object.keys(list)).toEqual(['items']);
    expect(list.items[0]).toHaveProperty('inputSummary');
    const detail = await call('tool-runs.get', { caseId, toolRunId: 'tr_failed' });
    expect(detail.toolRun).toMatchObject({ toolRunId: 'tr_failed', status: 'failed' });
    expect(detail.toolRun).toHaveProperty('_rev');
  });

  async function plantCaseSecrets(caseId) {
    const { rows } = await routerService.db.allDocs({ include_docs: true });
    const doc = rows.map((r) => r.doc).find((d) => d.cetCaseId === caseId);
    await routerService.db.put({
      ...doc,
      initialRequest: `initial ${SECRET}`,
      lastClassification: {
        ...doc.lastClassification,
        missingEvidence: [{ type: 'grid_connection_document', label: 'Netzanschlussvertrag' }],
        requiredClarifications: [`Welche Leistung? https://u:${SECRET}@h/x?token=${SECRET}`],
        noCallGuards: ['no_external_effect'],
      },
    });
    await workbench.store.saveTurnMemory({
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      caseStateVersion: doc.caseStateVersion,
      memory: { workingAssumptions: [SECRET], openQuestions: [SECRET] },
    });
    await workbench.conversationsDb.put({
      _id: `workbench-draft:tenant-a:${encodeURIComponent(caseId)}:d1`,
      draftId: 'd1',
      content: `draft ${SECRET}`,
      createdAt: iso(9),
    });
    await workbench.store.saveEvidence({
      tenantId: 'tenant-a',
      actorId: 'user-a',
      caseId,
      evidenceId: 'ev_url',
      evidenceType: 'public_web_page',
      label: `Seite https://user:${SECRET}@example.org/a?key=${SECRET}`,
      sourceType: 'web_url',
      sourceRef: { url: `https://example.org/?token=${SECRET}` },
      sensitivityLevel: 'public',
      fileHash: 'sha256-abc',
      sourceFingerprint: 'fp-1',
      provenance: { system: 'workbench', retrievalMode: 'web_url', cookie: SECRET },
    });
  }

  test('case inspector view returns a closed scalar contract without secrets', async () => {
    const caseId = await seedCase();
    await plantCaseSecrets(caseId);
    const legacy = await call('cases.get', { caseId, includeEvidence: true });
    // Sentinels really are reachable through the rich legacy projection...
    expect(JSON.stringify(legacy)).toContain(SECRET);
    const body = await call('cases.get', {
      caseId,
      includeEvidence: 'true',
      view: 'inspector',
      evidenceLimit: '25',
    });
    // ...but never through the inspector.
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expectClosedCaseInspector(body);
    expect(body).toMatchObject({
      view: 'inspector',
      schemaVersion: 'workbench-case-inspector.v1',
      caseId,
      evidenceTotalCount: 3,
      toolRunInspectorPath: `/api/workbench/cases/${encodeURIComponent(caseId)}/tool-runs?view=inspector`,
    });
    expect(body.case).toMatchObject({
      caseId,
      evidenceCount: 3,
      redactedEvidenceCount: 1,
      missingEvidenceCount: 1,
      requiredClarificationCount: 1,
      noCallGuardCount: 1,
      nextSafeGate: 'evidence_required',
      refreshAllowed: true,
      mutationAllowed: false,
    });
    const url = body.evidenceItems.find((r) => r.evidenceId === 'ev_url');
    expect(url).toMatchObject({
      label: 'Seite https://example.org/a',
      sourceType: 'web_url',
      fileHashStatus: 'provided',
      sourceFingerprintStatus: 'present',
      provenanceLabel: 'workbench/web_url',
      redacted: false,
    });
    expect(body.clarificationItems[0].label).toBe('Welche Leistung? https://h/x');
    for (const forbidden of [
      'sourceRef',
      'extracts',
      'provenance',
      'safeSummary',
      'initialRequest',
      'internalDrafts',
      'turnMemory',
      '_id',
      '_rev',
    ]) {
      expect(JSON.stringify(body)).not.toContain(`"${forbidden}"`);
    }
    const one = await call('cases.get', { caseId, view: 'inspector', evidenceLimit: 1 });
    expect(one).toMatchObject({
      evidenceLimit: 1,
      evidenceReturnedCount: 1,
      evidenceTruncated: true,
    });
    const over = await call('cases.get', { caseId, view: 'inspector', evidenceLimit: 500 });
    expect(over.evidenceLimit).toBe(MAX_EVIDENCE_ROWS);
    await expect(
      call('cases.get', { caseId, view: 'inspector', evidenceLimit: 0 })
    ).rejects.toThrow(/validation/iu);
    await expect(call('cases.get', { caseId, view: 'raw' })).rejects.toThrow(/validation/iu);
  });

  test('case inspector reduces restricted EvidenceRefs per authenticated clearance', async () => {
    const caseId = await seedCase();
    const plain = await call('cases.get', { caseId, view: 'inspector' });
    const restricted = plain.evidenceItems.find((r) => r.evidenceId === 'ev_restricted');
    expect(restricted).toEqual({
      evidenceId: 'ev_restricted',
      caseId,
      evidenceType: 'generic_document',
      label: 'Restricted evidence',
      status: 'restricted',
      sourceType: null,
      sensitivityLevel: 'restricted',
      redacted: true,
      sourceFingerprintStatus: 'restricted',
      fileHashStatus: 'restricted',
      provenanceLabel: null,
      evidenceRole: null,
      claimStrength: null,
      readinessReviewRequired: false,
      createdAt: expect.any(String),
    });
    const cleared = await call('cases.get', { caseId, view: 'inspector' }, clearedMeta);
    const visible = cleared.evidenceItems.find((r) => r.evidenceId === 'ev_restricted');
    expect(visible).toMatchObject({ redacted: false, status: 'attached' });
    expect(cleared.case.redactedEvidenceCount).toBe(0);
    expectClosedCaseInspector(cleared);
    // The restricted label carries a sentinel; only the cleared principal may read it.
    expect(JSON.stringify(plain)).not.toContain(SECRET);
  });

  test('case inspector fails closed for foreign tenants, hidden and shared cases', async () => {
    const caseId = await seedCase();
    await expect(
      call('cases.get', { caseId, view: 'inspector' }, otherTenantMeta)
    ).rejects.toThrow();
    const hidden = await classify('Netzanschluss vertraulicher Fall prüfen', clearedMeta);
    const { rows } = await routerService.db.allDocs({ include_docs: true });
    const doc = rows.map((r) => r.doc).find((d) => d.cetCaseId === hidden.cetCaseId);
    await routerService.db.put({ ...doc, sensitivityFlags: ['restricted'] });
    await expect(
      call('cases.get', { caseId: hidden.cetCaseId, view: 'inspector' })
    ).rejects.toThrow();
    await expect(
      call('cases.get', { caseId: 'cet_case_missing', view: 'inspector' })
    ).rejects.toThrow();

    const spy = jest
      .spyOn(caseLinking, 'sharedCaseSummary')
      .mockResolvedValue({ summary: `shared ${SECRET}` });
    try {
      await expect(call('cases.get', { caseId, view: 'inspector' })).rejects.toMatchObject({
        type: 'WORKBENCH_CASE_INSPECTOR_UNAVAILABLE',
        code: 403,
      });
      // Legacy behaviour for shared summaries is unchanged.
      expect(await call('cases.get', { caseId })).toEqual({ summary: `shared ${SECRET}` });
    } finally {
      spy.mockRestore();
    }
  });

  test('repeated case inspector GETs are read-only and trigger no commands', async () => {
    const caseId = await seedCase();
    await plantCaseSecrets(caseId);
    const callSpy = jest.spyOn(broker, 'call');
    const before = await dbSnapshot();
    const first = await call('cases.get', { caseId, view: 'inspector' });
    for (let i = 0; i < 3; i++) {
      expect(await call('cases.get', { caseId, view: 'inspector' })).toEqual(first);
      await call('tool-runs.list', { caseId, view: 'inspector' });
    }
    expect(await dbSnapshot()).toEqual(before);
    for (const [name] of callSpy.mock.calls) {
      expect(name).not.toMatch(
        /tools\.run|evidence\.attach|continue|acknowledge|ingestUpdate|inbox|classify/u
      );
    }
    callSpy.mockRestore();
  });

  test('case GET with includeEvidence keeps its presentCase redaction', async () => {
    const caseId = await seedCase();
    const summary = await call('cases.get', { caseId, includeEvidence: true });
    const restricted = summary.evidenceRefs.find((r) => r.evidenceId === 'ev_restricted');
    expect(restricted).toMatchObject({ redacted: true, label: 'Restricted evidence' });
    expect(summary).not.toHaveProperty('view');
    expect(summary).toHaveProperty('evidenceRefs');
    expect(summary).toHaveProperty('initialRequest');
    expect(summary).toHaveProperty('internalDrafts');
  });
});
