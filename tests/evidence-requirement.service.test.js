'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');

const EvidenceRequirementService = require('../services/evidence-requirement.service');
const NotificationService = require('../services/notification.service');
const dispatchTypeDefinitions = require('../src/notification-dispatch-types.json');

describe('evidence-requirement.service', () => {
  let broker;
  let requirementDbPath;
  let notificationDbPath;
  const dispatchedNotifications = [];

  function meta(tenantId = 'tenant-a') {
    return { meta: { tenantId } };
  }

  beforeAll(async () => {
    requirementDbPath = path.join(os.tmpdir(), `evreq-test-${Date.now()}`);
    notificationDbPath = path.join(os.tmpdir(), `evreq-notif-test-${Date.now()}`);
    dispatchedNotifications.length = 0;

    broker = new ServiceBroker({ logger: false });

    broker.createService({
      ...EvidenceRequirementService,
      settings: { dbPath: requirementDbPath },
    });

    broker.createService({
      name: 'notification',
      actions: {
        dispatch: {
          handler(ctx) {
            dispatchedNotifications.push({ ...ctx.params, _meta: ctx.meta });
            return { success: true, dispatch: { id: `disp-${Date.now()}`, status: 'sent' }, deduplicated: false };
          },
        },
      },
    });

    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
    for (const dir of [requirementDbPath, notificationDbPath]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  beforeEach(() => {
    dispatchedNotifications.length = 0;
  });

  // ── upsert ──────────────────────────────────────────────────────────────

  test('upsert creates a new requirement with status=open', async () => {
    const result = await broker.call(
      'evidence-requirement.upsert',
      {
        requirementId: 'evreq:session-1:netzbetreiber',
        label: 'zuständiger Netzbetreiber',
        requestedFact: 'gridOperatorBdew',
        originSessionId: 'session-1',
      },
      meta('tenant-upsert-1')
    );

    expect(result.success).toBe(true);
    expect(result.deduplicated).toBe(false);
    expect(result.requirement.status).toBe('open');
    expect(result.requirement.label).toBe('zuständiger Netzbetreiber');
    expect(result.requirement.responsibleRole).toBe('netzplanung'); // inferred from label
    expect(result.requirement.tenantId).toBe('tenant-upsert-1');
  });

  test('upsert is idempotent — second call deduplicates', async () => {
    const params = {
      requirementId: 'evreq:session-2:idem',
      label: 'Spannungsebene',
      requestedFact: 'voltageLevel',
      originSessionId: 'session-2',
    };

    await broker.call('evidence-requirement.upsert', params, meta('tenant-idem'));
    const second = await broker.call('evidence-requirement.upsert', params, meta('tenant-idem'));

    expect(second.deduplicated).toBe(true);
    expect(second.requirement.status).toBe('open');
  });

  test('upsert merges new waitingSessions into existing doc', async () => {
    const p = {
      requirementId: 'evreq:session-3:wait',
      label: 'Umspannwerk Reserven',
      requestedFact: 'transformerCapacity',
      originSessionId: 'session-3',
    };
    await broker.call('evidence-requirement.upsert', p, meta('tenant-wait'));
    const second = await broker.call(
      'evidence-requirement.upsert',
      { ...p, waitingSessions: ['session-4', 'session-5'] },
      meta('tenant-wait')
    );
    expect(second.requirement.waitingSessions).toEqual(expect.arrayContaining(['session-4', 'session-5']));
  });

  // ── role inference ───────────────────────────────────────────────────────

  test('inferRole: Netzbetreiber label → netzplanung', async () => {
    const result = await broker.call('evidence-requirement.inferRole', { label: 'zuständiger Netzbetreiber' });
    expect(result.responsibleRole).toBe('netzplanung');
  });

  test('inferRole: Lastprofil label → messwesen', async () => {
    const result = await broker.call('evidence-requirement.inferRole', { label: 'Lastprofil als Viertelstundenzeitreihe' });
    expect(result.responsibleRole).toBe('messwesen');
  });

  test('inferRole: Genehmigung label → regulatory', async () => {
    const result = await broker.call('evidence-requirement.inferRole', { label: 'Baugenehmigung vom Amt' });
    expect(result.responsibleRole).toBe('regulatory');
  });

  test('inferRole: unmatched label → null', async () => {
    const result = await broker.call('evidence-requirement.inferRole', { label: 'Sonstiges' });
    expect(result.responsibleRole).toBeNull();
  });

  // ── listOpenForRole ──────────────────────────────────────────────────────

  test('listOpenForRole returns open requirements for tenant and role', async () => {
    const tenantId = 'tenant-list-1';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s1:vnb', label: 'Netzbetreiber', requestedFact: 'vnb', originSessionId: 's1', responsibleRole: 'netzplanung' },
      meta(tenantId)
    );
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s1:lp', label: 'Lastprofil', requestedFact: 'lp', originSessionId: 's1', responsibleRole: 'messwesen' },
      meta(tenantId)
    );

    const result = await broker.call('evidence-requirement.listOpenForRole', { role: 'netzplanung' }, meta(tenantId));

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items[0].requestedFact).toBe('vnb');
  });

  test('listOpenForRole filters by projectScopeKey', async () => {
    const tenantId = 'tenant-scope-1';
    await broker.call(
      'evidence-requirement.upsert',
      {
        requirementId: 'evreq:s1:scope-a',
        label: 'Netzverknüpfungspunkt',
        requestedFact: 'connectionPoint',
        originSessionId: 's1',
        responsibleRole: 'netzplanung',
        projectScope: { scopeKey: '69115 heidelberg|5mw' },
      },
      meta(tenantId)
    );
    await broker.call(
      'evidence-requirement.upsert',
      {
        requirementId: 'evreq:s1:scope-b',
        label: 'Netzbetreiber',
        requestedFact: 'vnb',
        originSessionId: 's1',
        responsibleRole: 'netzplanung',
        projectScope: { scopeKey: '74889 sinsheim|2mw' },
      },
      meta(tenantId)
    );

    const result = await broker.call(
      'evidence-requirement.listOpenForRole',
      { role: 'netzplanung', projectScopeKey: '69115 heidelberg|5mw' },
      meta(tenantId)
    );

    expect(result.count).toBe(1);
    expect(result.items[0].requirementId).toBe('evreq:s1:scope-a');
  });

  test('listOpenForRole returns 0 for unknown role', async () => {
    const result = await broker.call(
      'evidence-requirement.listOpenForRole',
      { role: 'unknown-role' },
      meta('tenant-no-role')
    );
    expect(result.count).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  // ── answerRequirement ────────────────────────────────────────────────────

  test('answerRequirement transitions open → answered', async () => {
    const tenantId = 'tenant-answer-1';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-ans:vnb', label: 'Netzbetreiber', requestedFact: 'vnb', originSessionId: 's-ans' },
      meta(tenantId)
    );

    const result = await broker.call(
      'evidence-requirement.answerRequirement',
      { requirementId: 'evreq:s-ans:vnb', answer: 'Stadtwerke Heidelberg', sourceSessionId: 's-ans-2' },
      meta(tenantId)
    );

    expect(result.success).toBe(true);
    expect(result.requirement.status).toBe('answered');
    expect(result.requirement.answer.value).toBe('Stadtwerke Heidelberg');
    expect(result.requirement.answer.sourceSessionId).toBe('s-ans-2');
    expect(result.requirement.validatedAt).toBeNull();
  });

  test('answerRequirement dispatches evidence_revalidated notification', async () => {
    const tenantId = 'tenant-answer-notif';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-notif:vnb', label: 'Netzbetreiber', requestedFact: 'vnb', originSessionId: 's-notif' },
      meta(tenantId)
    );

    await broker.call(
      'evidence-requirement.answerRequirement',
      { requirementId: 'evreq:s-notif:vnb', answer: 'Netzbetreiber XY' },
      meta(tenantId)
    );

    const notifications = dispatchedNotifications.filter((n) => n.dispatchType === 'evidence_revalidated');
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    const notif = notifications[0];
    expect(notif.evidenceRequirementId).toBe('evreq:s-notif:vnb');
    expect(notif.originSessionId).toBe('s-notif');
    expect(notif.revalidationStatus).toBe('answered');
  });

  test('answerRequirement also notifies waitingSessions', async () => {
    const tenantId = 'tenant-waiting-notif';
    await broker.call(
      'evidence-requirement.upsert',
      {
        requirementId: 'evreq:s-wait:vnb',
        label: 'Umspannwerk',
        requestedFact: 'transformer',
        originSessionId: 's-wait',
        waitingSessions: ['s-wait-2', 's-wait-3'],
      },
      meta(tenantId)
    );

    await broker.call(
      'evidence-requirement.answerRequirement',
      { requirementId: 'evreq:s-wait:vnb', answer: 'UW Neckarau' },
      meta(tenantId)
    );

    const notifications = dispatchedNotifications.filter(
      (n) => n.dispatchType === 'evidence_revalidated' && n.evidenceRequirementId === 'evreq:s-wait:vnb'
    );
    const sessionIds = notifications.map((n) => n.originSessionId);
    expect(sessionIds).toContain('s-wait');
    expect(sessionIds).toContain('s-wait-2');
    expect(sessionIds).toContain('s-wait-3');
  });

  test('answerRequirement does NOT auto-promote to validated', async () => {
    const tenantId = 'tenant-no-auto';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-noauto:lp', label: 'Lastprofil', requestedFact: 'lp', originSessionId: 's-noauto' },
      meta(tenantId)
    );
    const result = await broker.call(
      'evidence-requirement.answerRequirement',
      { requirementId: 'evreq:s-noauto:lp', answer: 'H0' },
      meta(tenantId)
    );

    expect(result.requirement.status).toBe('answered');
    expect(result.requirement.validatedAt).toBeNull();
  });

  test('answerRequirement on already-validated requirement returns alreadyValidated=true', async () => {
    const tenantId = 'tenant-already-val';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-val:vnb', label: 'Netzbetreiber', requestedFact: 'vnb', originSessionId: 's-val' },
      meta(tenantId)
    );
    await broker.call('evidence-requirement.answerRequirement', { requirementId: 'evreq:s-val:vnb', answer: 'X' }, meta(tenantId));
    await broker.call('evidence-requirement.markValidated', { requirementId: 'evreq:s-val:vnb' }, meta(tenantId));

    const result = await broker.call(
      'evidence-requirement.answerRequirement',
      { requirementId: 'evreq:s-val:vnb', answer: 'Y' },
      meta(tenantId)
    );
    expect(result.alreadyValidated).toBe(true);
    expect(result.requirement.status).toBe('validated');
  });

  test('answerRequirement throws 404 for unknown requirementId', async () => {
    await expect(
      broker.call(
        'evidence-requirement.answerRequirement',
        { requirementId: 'evreq:nonexistent:req', answer: 'test' },
        meta('tenant-404')
      )
    ).rejects.toMatchObject({ code: 404, type: 'REQUIREMENT_NOT_FOUND' });
  });

  // ── markValidated ────────────────────────────────────────────────────────

  test('markValidated transitions answered → validated', async () => {
    const tenantId = 'tenant-mark-val';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-mv:tab', label: 'verbindliche TAB', requestedFact: 'tab', originSessionId: 's-mv' },
      meta(tenantId)
    );
    await broker.call(
      'evidence-requirement.answerRequirement',
      { requirementId: 'evreq:s-mv:tab', answer: 'TAB 2007 gilt' },
      meta(tenantId)
    );

    const result = await broker.call(
      'evidence-requirement.markValidated',
      { requirementId: 'evreq:s-mv:tab', validatedBy: 'engineer-1' },
      meta(tenantId)
    );

    expect(result.success).toBe(true);
    expect(result.requirement.status).toBe('validated');
    expect(result.requirement.validatedAt).not.toBeNull();
    expect(result.requirement.validatedBy).toBe('engineer-1');
  });

  test('markValidated dispatches evidence_revalidated with revalidationStatus=validated', async () => {
    const tenantId = 'tenant-val-notif';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-vn:req', label: 'Netzbetreiber', requestedFact: 'vnb', originSessionId: 's-vn' },
      meta(tenantId)
    );
    await broker.call('evidence-requirement.answerRequirement', { requirementId: 'evreq:s-vn:req', answer: 'X' }, meta(tenantId));
    dispatchedNotifications.length = 0;

    await broker.call('evidence-requirement.markValidated', { requirementId: 'evreq:s-vn:req' }, meta(tenantId));

    const notif = dispatchedNotifications.find((n) => n.revalidationStatus === 'validated');
    expect(notif).toBeDefined();
    expect(notif.evidenceRequirementId).toBe('evreq:s-vn:req');
  });

  test('markValidated is idempotent — already validated returns alreadyValidated=true', async () => {
    const tenantId = 'tenant-val-idem';
    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-vi:req', label: 'Netzbetreiber', requestedFact: 'vnb', originSessionId: 's-vi' },
      meta(tenantId)
    );
    await broker.call('evidence-requirement.answerRequirement', { requirementId: 'evreq:s-vi:req', answer: 'X' }, meta(tenantId));
    await broker.call('evidence-requirement.markValidated', { requirementId: 'evreq:s-vi:req' }, meta(tenantId));

    const result = await broker.call('evidence-requirement.markValidated', { requirementId: 'evreq:s-vi:req' }, meta(tenantId));
    expect(result.alreadyValidated).toBe(true);
  });

  // ── listWaitingSessions ──────────────────────────────────────────────────

  test('listWaitingSessions returns originSessionId + waitingSessions', async () => {
    const tenantId = 'tenant-lws';
    await broker.call(
      'evidence-requirement.upsert',
      {
        requirementId: 'evreq:s-lws:req',
        label: 'Umspannwerk',
        requestedFact: 'transformer',
        originSessionId: 'origin-session',
        waitingSessions: ['waiting-a', 'waiting-b'],
      },
      meta(tenantId)
    );

    const result = await broker.call(
      'evidence-requirement.listWaitingSessions',
      { requirementId: 'evreq:s-lws:req' },
      meta(tenantId)
    );

    expect(result.success).toBe(true);
    expect(result.sessions).toContain('origin-session');
    expect(result.sessions).toContain('waiting-a');
    expect(result.sessions).toContain('waiting-b');
    expect(result.count).toBe(3);
  });

  test('listWaitingSessions throws 404 for unknown requirement', async () => {
    await expect(
      broker.call('evidence-requirement.listWaitingSessions', { requirementId: 'evreq:ghost:req' }, meta('tenant-ghost'))
    ).rejects.toMatchObject({ code: 404, type: 'REQUIREMENT_NOT_FOUND' });
  });

  // ── fromVdmiEvidenceGaps ─────────────────────────────────────────────────

  test('fromVdmiEvidenceGaps creates requirements from VDMI gaps', async () => {
    const tenantId = 'tenant-vdmi-1';
    const evidenceGaps = [
      { requirementId: 'grid-connection-check', label: 'Netzanschlussprüfung', reason: 'required_evidence_missing' },
      { requirementId: 'tab-document', label: 'verbindliche TAB', reason: 'required_evidence_missing' },
    ];

    const result = await broker.call(
      'evidence-requirement.fromVdmiEvidenceGaps',
      { evidenceGaps, originSessionId: 'vdmi-session-1', projectScope: { scopeKey: '74889 sinsheim|2mw' } },
      meta(tenantId)
    );

    expect(result.success).toBe(true);
    expect(result.created).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  test('fromVdmiEvidenceGaps uses responsibleRole heuristic from label', async () => {
    const tenantId = 'tenant-vdmi-role';
    const evidenceGaps = [
      { requirementId: 'lp-req', label: 'Lastprofil Viertelstunde', reason: 'required_evidence_missing' },
    ];

    const result = await broker.call(
      'evidence-requirement.fromVdmiEvidenceGaps',
      { evidenceGaps, originSessionId: 'vdmi-session-2' },
      meta(tenantId)
    );

    // Verify via listOpenForRole
    const listed = await broker.call('evidence-requirement.listOpenForRole', { role: 'messwesen' }, meta(tenantId));
    expect(listed.count).toBeGreaterThanOrEqual(1);
  });

  test('fromVdmiEvidenceGaps is idempotent on same gaps', async () => {
    const tenantId = 'tenant-vdmi-idem';
    const evidenceGaps = [
      { requirementId: 'gap-x', label: 'Netzbetreiber', reason: 'required_evidence_missing' },
    ];
    const params = { evidenceGaps, originSessionId: 'vdmi-idem-1' };

    await broker.call('evidence-requirement.fromVdmiEvidenceGaps', params, meta(tenantId));
    const second = await broker.call('evidence-requirement.fromVdmiEvidenceGaps', params, meta(tenantId));

    expect(second.created).toBe(0);
    expect(second.results[0].deduplicated).toBe(true);
  });

  // ── cross-tenant isolation ───────────────────────────────────────────────

  test('cross-tenant access is blocked with 403', async () => {
    await expect(
      broker.call(
        'evidence-requirement.upsert',
        {
          requirementId: 'evreq:x:req',
          tenantId: 'other-tenant',
          label: 'Test',
          requestedFact: 'test',
          originSessionId: 'x',
        },
        meta('my-tenant')
      )
    ).rejects.toMatchObject({ code: 403, type: 'EVIDENCE_REQUIREMENT_TENANT_FORBIDDEN' });
  });

  test('listOpenForRole does not leak requirements from other tenants', async () => {
    const tenantA = 'tenant-iso-a';
    const tenantB = 'tenant-iso-b';

    await broker.call(
      'evidence-requirement.upsert',
      { requirementId: 'evreq:s-iso:req', label: 'Netzbetreiber', requestedFact: 'vnb', originSessionId: 's-iso', responsibleRole: 'netzplanung' },
      meta(tenantA)
    );

    const result = await broker.call('evidence-requirement.listOpenForRole', { role: 'netzplanung' }, meta(tenantB));
    const ids = result.items.map((i) => i.requirementId);
    expect(ids).not.toContain('evreq:s-iso:req');
  });

  // ── Relay-gap regression tests (v0.63.2 fix) ────────────────────────────

  describe('Role inference from requestedFact (relay-gap 1)', () => {
    test('generic label + concrete requestedFact infers netzplanung', async () => {
      const tenantId = 'tenant-relay-infer-1';
      const result = await broker.call(
        'evidence-requirement.upsert',
        {
          requirementId: 'evreq:dossier-s:netzbetreiber',
          label: 'Fehlende Evidence-Anforderung',
          requestedFact: 'zustaendiger netzbetreiber',
          originSessionId: 'dossier-session-1',
        },
        meta(tenantId)
      );
      expect(result.requirement.responsibleRole).toBe('netzplanung');
    });

    test('generic label + netzverknuepfungspunkt requestedFact infers netzplanung', async () => {
      const tenantId = 'tenant-relay-infer-2';
      const result = await broker.call(
        'evidence-requirement.upsert',
        {
          requirementId: 'evreq:dossier-s:nvkp',
          label: 'Fehlende Evidence-Anforderung',
          requestedFact: 'verfuegbarer netzverknüpfungspunkt',
          originSessionId: 'dossier-session-2',
        },
        meta(tenantId)
      );
      expect(result.requirement.responsibleRole).toBe('netzplanung');
    });

    test('generic label + umspannwerk requestedFact infers netzplanung', async () => {
      const tenantId = 'tenant-relay-infer-3';
      const result = await broker.call(
        'evidence-requirement.upsert',
        {
          requirementId: 'evreq:dossier-s:umspann',
          label: 'Fehlende Evidence-Anforderung',
          requestedFact: 'reserven im umspannwerk',
          originSessionId: 'dossier-session-3',
        },
        meta(tenantId)
      );
      expect(result.requirement.responsibleRole).toBe('netzplanung');
    });

    test('generic label + verbindliche TAB requestedFact infers netzplanung', async () => {
      const tenantId = 'tenant-relay-infer-4';
      const result = await broker.call(
        'evidence-requirement.upsert',
        {
          requirementId: 'evreq:dossier-s:tab',
          label: 'Fehlende Evidence-Anforderung',
          requestedFact: 'verbindliche tab',
          originSessionId: 'dossier-session-4',
        },
        meta(tenantId)
      );
      expect(result.requirement.responsibleRole).toBe('netzplanung');
    });

    test('dossier auto-synced requirements are visible via listOpenForRole netzplanung with projectScopeKey', async () => {
      const tenantId = 'tenant-relay-scope-1';
      // Simulate what answerDossier now writes (label = fact.value)
      await broker.call(
        'evidence-requirement.upsert',
        {
          requirementId: 'evreq:sinsheim-session:netzbetreiber',
          label: 'zuständiger Netzbetreiber',
          requestedFact: 'zustaendiger netzbetreiber',
          originSessionId: 'sinsheim-session',
          projectScope: { scopeKey: '74889 sinsheim|12 mw' },
        },
        meta(tenantId)
      );
      await broker.call(
        'evidence-requirement.upsert',
        {
          requirementId: 'evreq:mauer-session:netzbetreiber',
          label: 'zuständiger Netzbetreiber',
          requestedFact: 'zustaendiger netzbetreiber',
          originSessionId: 'mauer-session',
          projectScope: { scopeKey: '69256 mauer|10 mw' },
        },
        meta(tenantId)
      );

      const sinsheimResult = await broker.call(
        'evidence-requirement.listOpenForRole',
        { role: 'netzplanung', projectScopeKey: '74889 sinsheim|12 mw' },
        meta(tenantId)
      );
      expect(sinsheimResult.count).toBe(1);
      expect(sinsheimResult.items[0].requirementId).toBe('evreq:sinsheim-session:netzbetreiber');

      const mauerResult = await broker.call(
        'evidence-requirement.listOpenForRole',
        { role: 'netzplanung', projectScopeKey: '69256 mauer|10 mw' },
        meta(tenantId)
      );
      expect(mauerResult.count).toBe(1);
      expect(mauerResult.items[0].requirementId).toBe('evreq:mauer-session:netzbetreiber');
    });
  });

  describe('netzanschluss heuristic (relay-gap 2)', () => {
    test('Formale Netzanschlusszusage fehlt → netzplanung', async () => {
      const result = await broker.call(
        'evidence-requirement.inferRole',
        { label: 'Formale Netzanschlusszusage fehlt' }
      );
      expect(result.responsibleRole).toBe('netzplanung');
    });

    test('fromVdmiEvidenceGaps: Netzanschlusszusage gap → netzplanung', async () => {
      const tenantId = 'tenant-vdmi-netzanschluss';
      const evidenceGaps = [
        { requirementId: 'formal-netzanschlusszusage', label: 'Formale Netzanschlusszusage fehlt', reason: 'required_evidence_missing' },
      ];
      const result = await broker.call(
        'evidence-requirement.fromVdmiEvidenceGaps',
        { evidenceGaps, originSessionId: 'vdmi-uat-session' },
        meta(tenantId)
      );
      expect(result.success).toBe(true);
      expect(result.created).toBe(1);

      const listed = await broker.call('evidence-requirement.listOpenForRole', { role: 'netzplanung' }, meta(tenantId));
      expect(listed.count).toBeGreaterThanOrEqual(1);
    });

    test('netzanschlusspruefung label → netzplanung', async () => {
      const result = await broker.call(
        'evidence-requirement.inferRole',
        { label: 'Netzanschlussprüfung ausstehend' }
      );
      expect(result.responsibleRole).toBe('netzplanung');
    });

    test('anschlusszusage label → netzplanung', async () => {
      const result = await broker.call(
        'evidence-requirement.inferRole',
        { label: 'Anschlusszusage liegt nicht vor' }
      );
      expect(result.responsibleRole).toBe('netzplanung');
    });
  });
});
