'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const CapabilityBrokerService = require('../services/capability-broker.service');
const PersonalAgentService = require('../services/personal-agent.service');

describe('personal-agent.service', () => {
  let broker;
  let objectStorePath;
  let placeholderCalls;
  let executedActions;

  beforeEach(async () => {
    objectStorePath = path.join(os.tmpdir(), `personal-agent-store-${Date.now()}-${Math.random()}`);
    placeholderCalls = [];
    executedActions = [];
    broker = new ServiceBroker({ logger: false });
    broker.createService({
      ...ObjectStoreService,
      settings: {
        ...ObjectStoreService.settings,
        dbPath: objectStorePath,
      },
    });
    broker.createService(CapabilityBrokerService);
    broker.createService({
      name: 'interface-placeholder',
      actions: {
        markGap: {
          handler(ctx) {
            const item = {
              success: true,
              placeholder: {
                placeholderId: `ph-${placeholderCalls.length + 1}`,
                status: 'placeholder_gap',
              },
            };
            placeholderCalls.push({ ...ctx.params, ...item });
            return item;
          },
        },
      },
    });
    broker.createService({
      name: 'grid-connection',
      actions: {
        validate: {
          handler(ctx) {
            executedActions.push('grid-connection.validate');
            return { success: true, validatedBy: 'grid-connection', input: ctx.params };
          },
        },
        fnavValidate: {
          handler(ctx) {
            executedActions.push('grid-connection.fnavValidate');
            return {
              success: true,
              gridOperatorName: ctx.params.gridOperatorName || 'TWL Netze',
              voltageLevel: ctx.params.voltageLevel || 'MS',
              ownerContact: ctx.params.ownerContact || 'netzplanung@twl.de',
              fnavProfile: ctx.params.fnavProfile,
            };
          },
        },
      },
    });
    broker.createService({
      name: 'finance-agent',
      actions: {
        fnavEconomics: {
          handler(ctx) {
            executedActions.push('finance-agent.fnavEconomics');
            return { success: true, paybackYears: 4.2, input: ctx.params };
          },
        },
      },
    });
    broker.createService({
      name: 'investment-planning',
      actions: {
        createPlan: {
          handler(ctx) {
            executedActions.push('investment-planning.createPlan');
            return { success: true, planId: 'ip-1', input: ctx.params };
          },
        },
      },
    });
    broker.createService({
      name: 'energy-sharing',
      actions: {
        validate: {
          handler(ctx) {
            executedActions.push('energy-sharing.validate');
            return { success: true, validationId: 'es-1', input: ctx.params };
          },
        },
      },
    });
    broker.createService({
      name: 'znp',
      actions: {
        getProjectMeta: {
          handler(ctx) {
            executedActions.push('znp.getProjectMeta');
            return { success: true, projectId: ctx.params.projectId };
          },
        },
      },
    });
    broker.createService(PersonalAgentService);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(objectStorePath, { recursive: true, force: true });
  });

  it('creates a session turn and persists only L0-L3', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte prüfe Troisdorf.',
        toolContext: {
          tool: 'grid-connection.validate',
          input: { location: 'Troisdorf' },
          responseRaw: { decision: 'GO_DIRECT', capacityRemainingPct: 26 },
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.layer4Purged).toBe(true);

    const stored = await broker.call('object-store.get', {
      namespace: 'tenant:tenant-a:personal_agent_sessions',
      key: result.sessionId,
    });

    expect(stored.payload.l4).toBeUndefined();
    expect(JSON.stringify(stored.payload)).not.toContain('responseRaw');
    expect(stored.payload.l3.history.length).toBeGreaterThanOrEqual(2);
  });

  it('returns persisted L3 history via getSession', async () => {
    const first = await broker.call(
      'personal-agent.chat',
      { message: 'Hallo Babel-Fisch' },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: first.sessionId },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(session.success).toBe(true);
    expect(session.layer4).toBeNull();
    expect(Array.isArray(session.l3.history)).toBe(true);
    expect(session.l3.history.some((entry) => entry.role === 'assistant')).toBe(true);
  });

  it('getSession returns OBJECT_NOT_FOUND for unknown sessionId', async () => {
    await expect(
      broker.call(
        'personal-agent.getSession',
        { sessionId: 'missing-session-id' },
        { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
      )
    ).rejects.toMatchObject({
      code: 404,
      type: 'OBJECT_NOT_FOUND',
    });
  });

  it('returns a stable deterministic plan in HITL mode without executing tools', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte fNAV und Finance für TWL Netze bewerten',
        executionMode: 'hitl',
        knownContext: {
          gridOperatorName: 'TWL Netze',
          fnavProfile: { requestedCapacity: 5000, flexibleCapacity: 2000 },
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.executionMode).toBe('hitl');
    expect(result.execution.status).toBe('skipped');
    expect(result.plan.steps.map((step) => step.action)).toEqual([
      'grid-connection.fnavValidate',
      'finance-agent.fnavEconomics',
    ]);
    expect(executedActions).toEqual([]);
  });

  it('auto-executes deterministic matrix chains in fixed order', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte fNAV und Finance für TWL Netze bewerten',
        executionMode: 'auto',
        knownContext: {
          gridOperatorName: 'TWL Netze',
          voltageLevel: 'MS',
          ownerContact: 'netzplanung@twl.de',
          fnavProfile: { requestedCapacity: 5000, flexibleCapacity: 2000 },
          annualFeeEur: 12000,
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.execution.status).toBe('completed');
    expect(result.execution.steps.map((step) => step.action)).toEqual([
      'grid-connection.fnavValidate',
      'finance-agent.fnavEconomics',
    ]);
    expect(executedActions).toEqual([
      'grid-connection.fnavValidate',
      'finance-agent.fnavEconomics',
    ]);
  });

  it('gracefully degrades unsupported extra domains after the last valid step', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte fNAV, Finance und Redispatch für TWL Netze bewerten',
        executionMode: 'auto',
        knownContext: {
          gridOperatorName: 'TWL Netze',
          voltageLevel: 'MS',
          ownerContact: 'netzplanung@twl.de',
          fnavProfile: { requestedCapacity: 5000, flexibleCapacity: 2000 },
          annualFeeEur: 12000,
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.execution.status).toBe('partial');
    expect(result.execution.completedSteps).toBe(2);
    expect(result.execution.stopPoint).toMatchObject({
      reasonCode: 'UNSUPPORTED_CHAIN',
      status: 'interface-placeholder',
      blockedStep: 3,
    });
    expect(result.reply).not.toMatch(/ACTION_FAILED|UNSUPPORTED_CHAIN|VALIDATION_ERROR|__step_/i);
    expect(placeholderCalls).toHaveLength(1);
  });

  it('switches to awaiting-onboarding when required inputs are missing', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte Mieterstrom mit ZNP für Rheinallee prüfen',
        executionMode: 'auto',
        knownContext: {
          communityName: 'Solargemeinschaft Rheinallee',
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.execution.status).toBe('awaiting-onboarding');
    expect(result.execution.steps).toEqual([]);
    expect(result.execution.stopPoint).toMatchObject({
      reasonCode: 'MISSING_INPUTS',
      blockedStep: 2,
      blockedAction: 'znp.getProjectMeta',
      status: 'awaiting-onboarding',
    });
    expect(result.reply).toContain('Projekt-ID');
    expect(result.reply).not.toMatch(/ACTION_FAILED|MISSING_INPUTS|VALIDATION_ERROR|__step_/i);
    expect(result.reply).not.toMatch(/sicher angehalten/i);
    expect(placeholderCalls).toHaveLength(0);

    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: result.sessionId },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );
    expect(session.l3.onboardingQuestions).toHaveLength(1);
    expect(session.l3.onboardingQuestions[0].answeredAt).toBeNull();
  });

  it('captures onboarding answer and resumes deterministic execution', async () => {
    const first = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte fNAV und Finance für TWL Netze bewerten',
        executionMode: 'auto',
        knownContext: {
          gridOperatorName: 'TWL Netze',
          voltageLevel: 'MS',
          ownerContact: 'netzplanung@twl.de',
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(first.execution.status).toBe('awaiting-onboarding');
    expect(first.execution.stopPoint.onboardingQuestion.paramKey).toBe('fnavProfile');

    const second = await broker.call(
      'personal-agent.chat',
      {
        sessionId: first.sessionId,
        message: 'Hybridprofil 5 MW, flexibel 2 MW',
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(second.execution.status).toBe('completed');
    expect(second.execution.steps.map((step) => step.action)).toEqual([
      'grid-connection.fnavValidate',
      'finance-agent.fnavEconomics',
    ]);

    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: first.sessionId },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );
    expect(session.l3.onboardingQuestions[0].answeredAt).toBeTruthy();
    expect(session.l3.onboardingQuestions[0].answer).toBe('Hybridprofil 5 MW, flexibel 2 MW');
  });

  it('synthesizes a concrete recovery reply for partial execution with zero completed steps', () => {
    const svc = broker.getLocalService('personal-agent');
    const reply = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte prüfe Mieterstrom mit ZNP für Rheinallee',
      plan: {
        status: 'partial',
        steps: [
          {
            step: 1,
            action: 'znp.getProjectMeta',
            purpose: 'ZNP-Projektmetadaten prüfen',
          },
        ],
      },
      execution: {
        status: 'partial',
        completedSteps: 0,
        steps: [],
        stopPoint: {
          reasonCode: 'MISSING_INPUTS',
          status: 'awaiting-onboarding',
          blockedStep: 1,
          blockedAction: 'znp.getProjectMeta',
          missingParams: ['projectId'],
        },
      },
    });

    expect(reply).toContain('die Projekt-ID');
    expect(reply).toContain('fortfahren');
    expect(reply).not.toMatch(/ACTION_FAILED|VALIDATION_ERROR|__step_|sicher angehalten/i);
  });

  it('synthesizes a concrete recovery reply after one completed step', () => {
    const svc = broker.getLocalService('personal-agent');
    const reply = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte Mieterstrom mit ZNP für Rheinallee prüfen',
      plan: {
        status: 'partial',
        steps: [
          {
            step: 1,
            action: 'energy-sharing.validate',
            purpose: 'Energy-Sharing-Validierung prüfen',
          },
          {
            step: 2,
            action: 'znp.getProjectMeta',
            purpose: 'ZNP-Projektmetadaten laden',
          },
        ],
      },
      execution: {
        status: 'partial',
        completedSteps: 1,
        steps: [
          {
            step: 1,
            action: 'energy-sharing.validate',
            status: 'completed',
            result: { status: 'eligible', findings: [] },
          },
        ],
        stopPoint: {
          reasonCode: 'MISSING_INPUTS',
          status: 'awaiting-onboarding',
          blockedStep: 2,
          blockedAction: 'znp.getProjectMeta',
          missingParams: ['projectId'],
        },
      },
    });

    expect(reply).toMatch(/Energy Sharing|Validierung prüfen/i);
    expect(reply).toContain('die Projekt-ID');
    expect(reply).not.toMatch(/ACTION_FAILED|VALIDATION_ERROR|__step_|sicher angehalten/i);
  });

  it('frames finance-risk recovery with missing-evidence language', () => {
    const svc = broker.getLocalService('personal-agent');
    const reply = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Mein Kreditkomitee will ein Risk Assessment für ein 12-MW-Speicherprojekt. Was fehlt für eine belastbare Bewertung?',
      plan: {
        status: 'partial',
        primaryIntent: 'finance-agent.analyze',
        routeLabel: 'Finanzierung + Risiko',
        steps: [
          {
            step: 1,
            action: 'finance-agent.fnavEconomics',
            purpose: 'Wirtschaftliche Einordnung prüfen',
          },
        ],
      },
      execution: {
        status: 'partial',
        completedSteps: 0,
        steps: [],
        stopPoint: {
          reasonCode: 'MISSING_INPUTS',
          status: 'awaiting-onboarding',
          blockedStep: 1,
          blockedAction: 'finance-agent.fnavEconomics',
          missingParams: ['annualFeeEur'],
        },
      },
    });

    expect(reply).toMatch(/Risiko|Prüfpunkt|fehlende Evidenz|Due-Diligence-Bedingung/i);
    expect(reply).not.toMatch(/ACTION_FAILED|VALIDATION_ERROR|__step_|sicher angehalten/i);
  });

  it('humanizes internal capability labels in partial recovery replies', () => {
    const svc = broker.getLocalService('personal-agent');
    const reply = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte den Status prüfen',
      plan: {
        status: 'partial',
        steps: [
          {
            step: 1,
            action: 'mastr.audit',
            purpose: 'Execute curated capability path for mastr_asset_inventory',
          },
        ],
      },
      execution: {
        status: 'partial',
        completedSteps: 1,
        steps: [
          {
            step: 1,
            action: 'mastr.audit',
            status: 'completed',
            result: { status: 'ok' },
          },
        ],
        stopPoint: {
          reasonCode: 'UNSUPPORTED_CHAIN',
          status: 'interface-placeholder',
          blockedStep: 2,
          blockedAction: 'interface_placeholder',
          placeholderMetadata: {
            title: 'Execute curated capability path for interface_placeholder',
            suggestedNextSteps: ['Execute curated capability path for vnb_kpi_benchmark_comparison'],
          },
        },
      },
    });

    expect(reply).toMatch(/MaStR|Anlagenregister|Schnittstelle|Evidenzquelle/i);
    expect(reply).not.toMatch(
      /Execute curated capability path|grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison|interface_placeholder/i
    );
  });

  it('humanizes interface-placeholder gaps in recovery replies', () => {
    const svc = broker.getLocalService('personal-agent');
    const reply = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte weiter prüfen',
      plan: {
        status: 'partial',
        steps: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            purpose: 'Execute curated capability path for grid_operator_identity_resolution',
          },
        ],
      },
      execution: {
        status: 'partial',
        completedSteps: 0,
        steps: [],
        stopPoint: {
          reasonCode: 'UNSUPPORTED_CHAIN',
          status: 'interface-placeholder',
          blockedStep: 1,
          blockedAction: 'interface_placeholder',
          placeholderMetadata: {
            title: 'Execute curated capability path for interface_placeholder',
          },
        },
      },
    });

    expect(reply).toMatch(/fehlende Schnittstelle|Evidenzquelle/i);
    expect(reply).not.toMatch(
      /Execute curated capability path|grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison|interface_placeholder/i
    );
  });

  it('stores CSV attachment extract in L3 and reports fileProcessing ok', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-upload-csv-'));
    const csvPath = path.join(uploadDir, 'zaehler.csv');
    fs.writeFileSync(csvPath, 'ZaehlerID,Zaehlerstand\nM-001,12456\n');

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Analysiere diese CSV',
        fileAttachments: [
          {
            attachmentId: 'fa_csv_1',
            fileName: 'zaehler.csv',
            mimeType: 'text/csv',
            sizeBytes: 32,
            tempPath: csvPath,
          },
        ],
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.fileProcessing).toEqual([
      {
        attachmentId: 'fa_csv_1',
        fileName: 'zaehler.csv',
        status: 'ok',
      },
    ]);

    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: result.sessionId },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(session.l3.fileAttachments).toHaveLength(1);
    expect(session.l3.fileAttachments[0].extract.type).toBe('csv');
    expect(session.l3.fileAttachments[0].extract.rowCount).toBe(1);

    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  it('treats parser failures as partial success via fileProcessing error entries', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-upload-xlsx-'));
    const xlsxPath = path.join(uploadDir, 'kaputt.xlsx');
    fs.writeFileSync(xlsxPath, 'definitely-not-a-real-xlsx');

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Prüfe diese Datei',
        fileAttachments: [
          {
            attachmentId: 'fa_xlsx_1',
            fileName: 'kaputt.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sizeBytes: 64,
            tempPath: xlsxPath,
          },
        ],
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.fileProcessing).toHaveLength(1);
    expect(result.fileProcessing[0].status).toBe('error');
    expect(result.fileProcessing[0].error.code).toBe('PARSE_ERROR');

    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: result.sessionId },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );
    expect(session.l3.fileAttachments[0].error.code).toBe('PARSE_ERROR');
    expect(session.l3.fileAttachments[0].extract).toBeNull();

    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  it('HITL mode returns onboarding hints but no awaiting status', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte fNAV und Finance für TWL Netze bewerten',
        executionMode: 'hitl',
        knownContext: {
          gridOperatorName: 'TWL Netze',
          voltageLevel: 'MS',
          ownerContact: 'netzplanung@twl.de',
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.execution.status).toBe('skipped');
    expect(result.execution.stopPoint).toBeNull();
    expect(Array.isArray(result.plan.onboardingHints)).toBe(true);
    expect(result.plan.onboardingHints[0].suggestedParamKey).toBe('fnavProfile');
    expect(result.execution.status).not.toBe('awaiting-onboarding');
  });

  it('resets only L3 and keeps L2 profile', async () => {
    const ns = 'tenant:tenant-a:personal_agent_user_profiles';
    await broker.call('object-store.put', {
      namespace: ns,
      key: 'user-1',
      payload: {
        userId: 'user-1',
        preferences: { renderMode: 'table' },
      },
    });

    const first = await broker.call(
      'personal-agent.chat',
      { message: 'Kontext aufbauen' },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    const reset = await broker.call(
      'personal-agent.resetSession',
      { sessionId: first.sessionId },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(reset.success).toBe(true);
    expect(reset.keptLayer2).toBe(true);

    const reloaded = await broker.call(
      'personal-agent.getSession',
      { sessionId: first.sessionId },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(reloaded.l3.history).toEqual([]);
    expect(reloaded.l2.userProfile.preferences.renderMode).toBe('table');
  });

  it('resetSession returns OBJECT_NOT_FOUND for unknown sessionId', async () => {
    await expect(
      broker.call(
        'personal-agent.resetSession',
        { sessionId: 'missing-session-id' },
        { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
      )
    ).rejects.toMatchObject({
      code: 404,
      type: 'OBJECT_NOT_FOUND',
    });
  });

  it('getDreamStatus returns dreamPending: false before any chat', async () => {
    const result = await broker.call(
      'personal-agent.getDreamStatus',
      { sessionId: 'nonexistent-session' },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );
    expect(result.success).toBe(true);
    expect(result.dreamPending).toBe(false);
  });

  it('getDreamAudit returns empty list for tenant with no dream runs', async () => {
    const result = await broker.call(
      'personal-agent.getDreamAudit',
      {},
      { meta: { tenantId: 'tenant-new', authUser: { userId: 'user-1' } } }
    );
    expect(result.success).toBe(true);
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.total).toBe(0);
  });

  it('getDreamAudit respects limit and offset params', async () => {
    const result = await broker.call(
      'personal-agent.getDreamAudit',
      { limit: 10, offset: 0 },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );
    expect(result.success).toBe(true);
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(0);
  });

  it('runDream reloads latest session from object-store instead of stale payload snapshot', async () => {
    const first = await broker.call(
      'personal-agent.chat',
      { message: 'Initial message' },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    await broker.call('object-store.put', {
      namespace: 'tenant:tenant-a:personal_agent_sessions',
      key: first.sessionId,
      payload: {
        id: first.sessionId,
        tenantId: 'tenant-a',
        userId: 'user-1',
        l1: { tenantFacts: [] },
        l2: { userProfile: { userId: 'user-1', preferences: {} } },
        l3: {
          history: [
            { role: 'user', text: 'Netzbetreiber: TWL Netze', ts: new Date().toISOString() },
          ],
          summary: null,
          compressed: false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const svc = broker.getLocalService('personal-agent');
    await svc.schema.methods.runDream.call(svc, broker, {
      sessionId: first.sessionId,
      tenantId: 'tenant-a',
      userId: 'user-1',
      profileNamespace: 'tenant:tenant-a:personal_agent_user_profiles',
      authMeta: {
        authUser: { userId: 'user-1' },
        roles: ['operator'],
        scopes: ['dream:run'],
      },
      session: {
        l3: {
          history: [{ role: 'user', text: 'STALE SESSION SNAPSHOT' }],
        },
      },
    });

    const audit = await broker.call('object-store.query', {
      namespace: 'personal_agent_dream_audit:tenant-a',
      selector: {},
      limit: 50,
    });
    const entry = (audit.docs || []).find((d) => d.payload?.sessionId === first.sessionId);
    expect(entry).toBeDefined();
    expect(entry.payload.extractedFacts).toBeGreaterThanOrEqual(1);
  });

  it('runDream supports legacy payload schema when session was embedded', async () => {
    const svc = broker.getLocalService('personal-agent');
    const legacySessionId = 'legacy-session-v525';

    await svc.schema.methods.runDream.call(svc, broker, {
      sessionId: legacySessionId,
      tenantId: 'tenant-a',
      userId: 'user-1',
      profileNamespace: 'tenant:tenant-a:personal_agent_user_profiles',
      authMeta: { authUser: { userId: 'user-1' } },
      session: {
        l3: {
          history: [{ role: 'user', text: 'Netzbetreiber: LegacyNetz' }],
        },
      },
    });

    const audit = await broker.call('object-store.query', {
      namespace: 'personal_agent_dream_audit:tenant-a',
      selector: {},
      limit: 100,
    });
    const entry = (audit.docs || []).find((d) => d.payload?.sessionId === legacySessionId);
    expect(entry).toBeDefined();
  });

  it('deepMergeMeta preserves nested tracing data while applying dream overrides', () => {
    const svc = broker.getLocalService('personal-agent');
    const merged = svc.schema.methods.deepMergeMeta.call(
      svc,
      {
        trace: { id: 'trace-1', spanId: 'span-1' },
        authUser: { tenantRole: 'viewer' },
      },
      {
        trace: { spanId: 'span-2' },
        authUser: { userId: 'user-1' },
      }
    );

    expect(merged.trace.id).toBe('trace-1');
    expect(merged.trace.spanId).toBe('span-2');
    expect(merged.authUser.tenantRole).toBe('viewer');
    expect(merged.authUser.userId).toBe('user-1');
  });

  it('buildDreamAuthMeta strips sensitive request headers before durable scheduling', () => {
    const svc = broker.getLocalService('personal-agent');
    const authMeta = svc.schema.methods.buildDreamAuthMeta.call(
      svc,
      {
        authUser: { sub: 'user-1' },
        roles: ['operator'],
        requestHeaders: {
          authorization: 'Bearer SECRET',
          cookie: 'session=secret',
          'x-request-id': 'req-123',
          'X-Correlation-ID': 'corr-456',
        },
      },
      'tenant-a',
      'user-1'
    );

    expect(authMeta.requestHeaders).toEqual({
      'x-request-id': 'req-123',
      'x-correlation-id': 'corr-456',
    });
    expect(authMeta.requestHeaders.authorization).toBeUndefined();
    expect(authMeta.requestHeaders.cookie).toBeUndefined();
  });

});
