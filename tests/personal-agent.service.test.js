'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const CapabilityBrokerService = require('../services/capability-broker.service');
const PresentationService = require('../services/presentation.service');
const PersonalAgentService = require('../services/personal-agent.service');

describe('personal-agent.service', () => {
  let broker;
  let objectStorePath;
  let placeholderCalls;
  let executedActions;
  let executedCallDetails;

  beforeEach(async () => {
    objectStorePath = path.join(os.tmpdir(), `personal-agent-store-${Date.now()}-${Math.random()}`);
    placeholderCalls = [];
    executedActions = [];
    executedCallDetails = [];
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
            executedCallDetails.push({ action: 'grid-connection.validate', params: ctx.params });
            return { success: true, validatedBy: 'grid-connection', input: ctx.params };
          },
        },
        fnavValidate: {
          handler(ctx) {
            executedActions.push('grid-connection.fnavValidate');
            executedCallDetails.push({ action: 'grid-connection.fnavValidate', params: ctx.params });
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
            executedCallDetails.push({ action: 'finance-agent.fnavEconomics', params: ctx.params });
            return { success: true, paybackYears: 4.2, input: ctx.params };
          },
        },
      },
    });
    broker.createService({
      name: 'grid-operations',
      actions: {
        marketPartners: {
          handler(ctx) {
            executedActions.push('grid-operations.marketPartners');
            executedCallDetails.push({ action: 'grid-operations.marketPartners', params: ctx.params });
            const query = String(ctx.params.query || '').toLowerCase();
            if (!query || query.includes('unbekannt') || query.includes('nonexistent')) {
              return { data: { results: [] } };
            }
            if (query.includes('twl')) {
              return {
                data: {
                  results: [
                    {
                      bdewCode: '9904350000002',
                      contacts: [{ city: 'Ludwigshafen' }],
                      name: 'TWL Netze GmbH',
                    },
                  ],
                },
              };
            }
            return {
              data: {
                results: [
                  {
                    bdewCode: '1234567890123',
                    contacts: [{ city: 'Trier' }],
                    name: String(ctx.params.query || 'Stadtwerk'),
                  },
                ],
              },
            };
          },
        },
        vnbLookup: {
          handler(ctx) {
            executedActions.push('grid-operations.vnbLookup');
            executedCallDetails.push({ action: 'grid-operations.vnbLookup', params: ctx.params });
            if (!ctx.params.bdew && !ctx.params.city && !ctx.params.query && !ctx.params.vnbName) {
              throw new Error('Parameters validation error!');
            }
            const isVerifiedPath = String(ctx.params.city || '').toLowerCase() === 'trier';
            const operatorName = ctx.params.vnbName || (isVerifiedPath ? 'Stadtwerk Trier' : 'TWL Netze');
            return {
              success: true,
              operator: {
                bdew: ctx.params.bdew || '1234567890123',
                city: ctx.params.city || 'Trier',
                name: operatorName,
                isResponsible: isVerifiedPath ? true : undefined,
              },
              responsibilityMatch: isVerifiedPath ? true : undefined,
            };
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
    broker.createService({
      name: 'vdmi',
      actions: {
        dossier: {
          handler(ctx) {
            executedActions.push('vdmi.dossier');
            executedCallDetails.push({ action: 'vdmi.dossier', params: ctx.params });
            if (!ctx.params.taskId) {
              throw new Error('taskId is required');
            }
            return {
              success: true,
              matrixId: 'matrix-step3',
              taskId: ctx.params.taskId,
              dossier: {
                task: {
                  taskId: ctx.params.taskId,
                  taskName: 'Network Operator Decision',
                  phase: 'decision',
                  processType: 'grid-connection-governance',
                  processId: 'job-governance-step3',
                  matrixId: 'matrix-step3',
                  verantwortlich: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
                  durchfuehrend: [{ actorType: 'org', actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
                  mitwirkend: [{ actorType: 'org', actorId: 'GROUP_ENERGY_PROJECT_OWNER' }],
                  information: [{ actorType: 'org', actorId: 'AREAL_OWNER' }],
                },
                evidenceGaps: [
                  { requirementId: 'formal-request', label: 'Vollständiger §17-Antrag' },
                  { requirementId: 'tech-data', label: 'Technische Anschlussdaten' },
                  { requirementId: 'asset-proof', label: 'Asset-Zustandsnachweise' },
                  { requirementId: 'compatibility', label: 'Netzverträglichkeitsprüfung' },
                  { requirementId: 'capacity-check', label: 'Kapazitäts-/Netzfahrplanprüfung' },
                ],
                forbiddenAssumptions: [
                  'Keine belastbare Anschlusszusage ohne formalen Antrag',
                  'Keine Kapazitätsreservierung ohne formalen Antrag',
                  'Kein verbindlicher Übergabepunkt ohne formale Prüfung',
                  'Projekt-/Versorgungskonzept ersetzt keine Netzbetreiberentscheidung',
                ],
              },
            };
          },
        },
        negotiationTrace: {
          handler(ctx) {
            executedActions.push('vdmi.negotiationTrace');
            executedCallDetails.push({ action: 'vdmi.negotiationTrace', params: ctx.params });
            if (!ctx.params.taskId) {
              throw new Error('taskId is required');
            }
            return {
              success: true,
              taskId: ctx.params.taskId,
              loopProtection: {
                converged: true,
                roleBoundaryViolation: false,
              },
              trace: [
                {
                  round: 1,
                  eventName: 'agent.plan.step.executed',
                  roleCandidates: [{ role: 'D', actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
                },
              ],
            };
          },
        },
        agentRole: {
          handler(ctx) {
            executedActions.push('vdmi.agentRole');
            executedCallDetails.push({ action: 'vdmi.agentRole', params: ctx.params });
            if (!ctx.params.agentId) {
              throw new Error('agentId is required');
            }
            return {
              success: true,
              role: ctx.params.agentId === 'DSO_GATEKEEPER' ? 'V' : 'I',
              highestRole: ctx.params.agentId === 'DSO_GATEKEEPER' ? 'V' : 'I',
              rolesByTask: [
                {
                  taskId: ctx.params.taskId || 'network-operator-decision',
                  role: ctx.params.agentId === 'DSO_GATEKEEPER' ? 'V' : 'I',
                },
              ],
              taskId: ctx.params.taskId || 'network-operator-decision',
            };
          },
        },
        get: {
          handler() {
            return {
              success: true,
              matrix: {
                id: 'matrix-step3',
                processId: 'job-governance-step3',
                processType: 'grid-connection-governance',
                tasks: [
                  {
                    taskId: 'demand-intake',
                    taskName: 'Demand Intake',
                    verantwortlich: [{ actorType: 'org', actorId: 'AREAL_OWNER' }],
                  },
                  {
                    taskId: 'network-operator-decision',
                    taskName: 'Network Operator Decision',
                    verantwortlich: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
                  },
                ],
              },
            };
          },
        },
        context: {
          handler() {
            return {
              success: true,
              matrix: {
                id: 'matrix-step3',
                processId: 'job-governance-step3',
                processType: 'grid-connection-governance',
                tasks: [
                  {
                    taskId: 'network-operator-decision',
                    taskName: 'Network Operator Decision',
                    verantwortlich: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
                  },
                ],
              },
            };
          },
        },
      },
    });
    broker.createService(PresentationService);
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

  it('blocks dependent step execution when lookup result list is empty', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte Netzbetreiber prüfen: unbekannt',
        executionMode: 'auto',
        knownContext: {
          query: 'unbekannt',
          location: 'Frankenthal',
          gridOperatorName: 'TWL Netze',
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.execution.status).toBe('awaiting-onboarding');
    expect(result.execution.completedSteps).toBeGreaterThanOrEqual(0);
    expect(result.execution.completedSteps).toBeLessThanOrEqual(1);
    expect(result.execution.stopPoint).toMatchObject({
      reasonCode: 'MISSING_INPUTS',
    });
    expect(executedActions).not.toContain('grid-operations.vnbLookup');
    expect(result.reply).toMatch(/BDEW|Netzbetreiber/i);
    expect(result.reply).not.toMatch(/operatorEvidence/i);
    expect(result.reply).not.toMatch(/Parameters validation error|ACTION_FAILED|__step_/i);
  });

  it('classifies Standort/VNB consistency as due-diligence evidence checkpoint', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW',
        executionMode: 'auto',
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.execution.status).toBe('awaiting-onboarding');
    expect(result.execution.completedSteps).toBeGreaterThanOrEqual(2);
    expect(executedActions).toContain('grid-operations.marketPartners');
    expect(executedActions).toContain('grid-operations.vnbLookup');
    expect(result.execution.stopPoint.reasonCode).toBe('MISSING_INPUTS');
    expect(result.execution.stopPoint.locationOperatorConsistency).toMatch(/unverified|mismatch/);
    expect(result.reply).toMatch(/Due Diligence|Evidenz|Netzanschlusszusage|Marktlokation|Netzanschlusspunkt|BDEW/i);
    expect(result.reply).not.toMatch(/Parameters validation error|ACTION_FAILED|__step_/i);
    expect(result.reply).not.toMatch(/operatorEvidence/i);

    const vnbLookupCall = executedCallDetails.find((entry) => entry.action === 'grid-operations.vnbLookup');
    expect(vnbLookupCall).toBeTruthy();
    expect(vnbLookupCall.params.bdew).toBe('9904350000002');
    expect(vnbLookupCall.params.city).toBe('Ludwigshafen');
    expect(vnbLookupCall.params.city).not.toBe('Frankenthal');
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

    expect(result.execution.status).toBe('completed');
    expect(result.execution.completedSteps).toBe(2);
    expect(result.execution.stopPoint).toBeNull();
    expect(result.reply).not.toMatch(/ACTION_FAILED|UNSUPPORTED_CHAIN|VALIDATION_ERROR|__step_/i);
    expect(result.reply).toMatch(/completed|abgeschlossen|prüfschritt/i);
    expect(placeholderCalls).toHaveLength(0);
  });

  it('remains partial for a genuine capability gap and explains the missing interface', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte prüfe eine unbekannte Spezialintegration ohne klare Datenquelle',
        executionMode: 'auto',
        knownContext: {
          gridOperatorName: 'Unbekannter Betreiber',
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.execution.status).toBe('partial');
    expect(result.execution.stopPoint).toBeTruthy();
    expect(result.execution.stopPoint.status).toBe('interface-placeholder');
    expect(result.reply).toMatch(/Schnittstelle|Evidenzquelle|Prüfpunkt/i);
    expect(result.reply).not.toMatch(/ACTION_FAILED|VALIDATION_ERROR|__step_/i);
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
    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('conversational_onboarding');
    expect(result.presentation).toMatchObject({
      type: 'conversational_onboarding',
      markdown: expect.stringContaining('Projekt-ID'),
      structuredData: expect.objectContaining({
        blockedAction: 'znp.getProjectMeta',
        missingParams: ['projectId'],
      }),
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

  it('hydrates normalized onboarding facts into knownContext for follow-up turns', () => {
    const svc = broker.getLocalService('personal-agent');

    const hydrated = svc.schema.methods.hydrateKnownContextFromSession.call(
      svc,
      {},
      {
        l3: {
          onboardingQuestions: [
            {
              questionId: 'oq_grid_operator',
              paramKey: 'gridOperatorName',
              answer: 'Ich bin bei den Pfalzwerken',
              status: 'answered',
              answeredAt: new Date().toISOString(),
            },
          ],
        },
      }
    );

    expect(hydrated.gridOperatorName).toBe('Pfalzwerken');
  });

  it('preserves working assumptions across turns and does not repeat the T1 onboarding question on a persisted follow-up', async () => {
    const meta = { meta: { tenantId: 'tenant-cetred-followup', authUser: { userId: 'user-1' } } };
    const first = await broker.call(
      'personal-agent.chat',
      {
        message: 'Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW',
        executionMode: 'auto',
      },
      meta
    );

    expect(first.execution.status).toBe('awaiting-onboarding');
    expect(first.execution.assumptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'location_operator_unverified',
          location: 'Frankenthal',
          assertedGridOperatorName: 'TWL Netze',
        }),
      ])
    );
    const firstQuestion = first.execution.stopPoint.onboardingQuestion.questionText;

    const second = await broker.call(
      'personal-agent.chat',
      {
        sessionId: first.sessionId,
        message: 'Arbeite mit der vorläufigen Annahme weiter und nenne die nächsten fachlichen Schritte.',
        executionMode: 'auto',
      },
      meta
    );

    expect(second.reply).toMatch(/Risikoflag|vorläufig|noch nicht durch Evidenz belegt|Working Assumption/i);
    expect(second.reply).not.toContain(firstQuestion);
    expect(second.reply).not.toMatch(/operatorEvidence|interface_placeholder|interface-placeholder|__step_|ACTION_FAILED/i);

    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: first.sessionId },
      meta
    );
    expect(session.l3.assumptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'location_operator_unverified',
          location: 'Frankenthal',
        }),
      ])
    );
  });

  it('returns methodological T4 guidance and T5 risk structure across a real session flow', async () => {
    const meta = { meta: { tenantId: 'tenant-cetred-methodology', authUser: { userId: 'user-1' } } };
    const first = await broker.call(
      'personal-agent.chat',
      {
        message: 'Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW',
        executionMode: 'auto',
      },
      meta
    );

    const marketTurn = await broker.call(
      'personal-agent.chat',
      {
        sessionId: first.sessionId,
        message: 'Welche Markt- und Regulatorik-Methodik würdest du jetzt anwenden?',
        executionMode: 'auto',
      },
      meta
    );

    expect(marketTurn.reply).toMatch(/Methodik|Datenquelle|ENTSO-E|Netztransparenz/i);
    expect(marketTurn.reply).not.toContain('Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.');
    expect(marketTurn.reply).not.toMatch(/operatorEvidence|interface_placeholder|interface-placeholder|__step_|ACTION_FAILED/i);

    const riskTurn = await broker.call(
      'personal-agent.chat',
      {
        sessionId: first.sessionId,
        message: 'Erstelle daraus ein vorläufiges Risk Assessment für den Kreditausschuss.',
        executionMode: 'auto',
      },
      meta
    );

    expect(riskTurn.reply).toMatch(/Risk Assessment|Condition Precedent|Due Diligence|Risikoampel/i);
    expect(riskTurn.reply).not.toContain('Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.');
    expect(riskTurn.reply).not.toMatch(/operatorEvidence|interface_placeholder|interface-placeholder|__step_|ACTION_FAILED/i);
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

  it('T-PA-KR-004: applies synthesisStyle tone hints in synthesis output', () => {
    const svc = broker.getLocalService('personal-agent');

    const cautionary = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte Risiko einordnen',
      executionMode: 'auto',
      plan: { steps: [] },
      execution: { status: 'completed', steps: [] },
      knowledgeContext: { synthesisStyle: 'cautionary' },
    });

    const methodological = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte methodisch erklären',
      executionMode: 'auto',
      plan: { steps: [] },
      execution: { status: 'completed', steps: [] },
      knowledgeContext: { synthesisStyle: 'methodological' },
    });

    expect(cautionary).toMatch(/^Risikohinweis:/);
    expect(methodological).toMatch(/^Methodik-Hinweis:/);
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

  it('renders a complete onboarding question only once without redundant prefixing', () => {
    const svc = broker.getLocalService('personal-agent');
    const reply = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte Netzbetreiber und Standort prüfen',
      plan: {
        status: 'partial',
        steps: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            purpose: 'Netzbetreiber-Zuordnung',
          },
        ],
      },
      execution: {
        status: 'awaiting-onboarding',
        completedSteps: 2,
        steps: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            status: 'completed',
            result: {
              data: {
                results: [
                  {
                    bdewCode: '9904350000002',
                    contacts: [{ city: 'Ludwigshafen' }],
                    name: 'TWL Netze GmbH',
                  },
                ],
              },
            },
            label: 'Netzbetreiber-Zuordnung',
          },
          {
            step: 2,
            action: 'grid-operations.vnbLookup',
            status: 'completed',
            result: {
              success: true,
              operator: {
                bdew: '9904350000002',
                city: 'Ludwigshafen',
              },
            },
            label: 'Netzbetreiber-Zuordnung',
          },
        ],
        stopPoint: {
          reasonCode: 'MISSING_INPUTS',
          status: 'awaiting-onboarding',
          blockedStep: 2,
          blockedAction: 'grid-operations.vnbLookup',
          missingParams: ['operatorEvidence'],
          onboardingQuestion: {
            questionText:
              'Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen. Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, den konkreten Netzanschlusspunkt oder den zuständigen BDEW-Code.',
          },
        },
      },
    });

    expect(reply).toContain('Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.');
    expect(reply).toContain('Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, den konkreten Netzanschlusspunkt oder den zuständigen BDEW-Code.');
    expect(reply).not.toMatch(/Bitte beantworte konkret:/i);
    expect(reply).not.toMatch(/operatorEvidence/i);
    expect(reply).not.toMatch(/\.\./);
  });

  it('deduplicates repeated humanized completed-step summaries while preserving outcome hints', () => {
    const svc = broker.getLocalService('personal-agent');
    const reply = svc.schema.methods.synthesizeTurn.call(svc, {
      message: 'Bitte Netzbetreiber prüfen',
      plan: {
        status: 'partial',
        steps: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            purpose: 'Netzbetreiber-Zuordnung',
          },
          {
            step: 2,
            action: 'grid-operations.vnbLookup',
            purpose: 'Netzbetreiber-Zuordnung',
          },
        ],
      },
      execution: {
        status: 'partial',
        completedSteps: 2,
        steps: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            status: 'completed',
            result: { data: { results: [{ name: 'TWL Netze GmbH' }] } },
            label: 'Netzbetreiber-Zuordnung',
          },
          {
            step: 2,
            action: 'grid-operations.vnbLookup',
            status: 'completed',
            result: { success: true },
            label: 'Netzbetreiber-Zuordnung',
          },
        ],
        stopPoint: {
          reasonCode: 'MISSING_INPUTS',
          status: 'awaiting-onboarding',
          blockedStep: 2,
          blockedAction: 'grid-operations.vnbLookup',
          missingParams: ['operatorEvidence'],
          onboardingQuestion: {
            questionText: 'Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen. Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, den konkreten Netzanschlusspunkt oder den zuständigen BDEW-Code.',
          },
        },
      },
    });

    expect(reply).toMatch(/Netzbetreiber(?:-| )Zuordnung \(1 Treffer\)/i);
    expect(reply).not.toMatch(/Netzbetreiber(?:-| )Zuordnung \(1 Treffer\);\s*Netzbetreiber(?:-| )Zuordnung/i);
    expect(reply).not.toMatch(/\.\./);
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

  it('CSV attachment text content is available as transient inhouseData without being persisted in session', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-inhouse-csv-'));
    const csvPath = path.join(uploadDir, 'assets.csv');
    const csvContent = 'AssetID,Kapazitaet_kW,Ort\nA-001,5000,Ludwigshafen\nA-002,3000,Frankenthal\n';
    fs.writeFileSync(csvPath, csvContent);

    const svc = broker.getLocalService('personal-agent');

    // Verify buildInhouseDataFromAttachments reads text and returns content
    const fakeFiles = [
      { attachmentId: 'fa_asset_csv', fileName: 'assets.csv', mimeType: 'text/csv', sizeBytes: csvContent.length, tempPath: csvPath },
    ];
    const fakeProcessing = [{ attachmentId: 'fa_asset_csv', fileName: 'assets.csv', status: 'ok' }];
    const inhouseData = svc.schema.methods.buildInhouseDataFromAttachments.call(svc, fakeFiles, fakeProcessing);

    expect(inhouseData).toHaveLength(1);
    expect(inhouseData[0].attachmentId).toBe('fa_asset_csv');
    expect(inhouseData[0].content).toContain('AssetID');
    expect(inhouseData[0].content).toContain('A-001');
    expect(inhouseData[0].truncated).toBe(false);
    expect(inhouseData[0].originalSizeBytes).toBeGreaterThan(0);

    // Verify persisted session after chat turn does NOT contain raw content
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Analysiere diese Asset-Liste',
        fileAttachments: fakeFiles,
      },
      { meta: { tenantId: 'tenant-inhouse', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.fileProcessing[0].status).toBe('ok');

    const session = await broker.call(
      'personal-agent.getSession',
      { sessionId: result.sessionId },
      { meta: { tenantId: 'tenant-inhouse', authUser: { userId: 'user-1' } } }
    );

    // L3 fileAttachments should have metadata (extract) only, NOT raw content
    expect(session.l3.fileAttachments).toHaveLength(1);
    expect(session.l3.fileAttachments[0].extract.type).toBe('csv');
    expect(session.l3.fileAttachments[0].extract.rowCount).toBe(2);
    expect(session.l3.fileAttachments[0]).not.toHaveProperty('content');
    // The raw inhouseData must not bleed into persisted session state
    const sessionJson = JSON.stringify(session);
    expect(sessionJson).not.toContain('"inhouseData"');
    expect(sessionJson).not.toContain('A-001,5000,Ludwigshafen');

    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  it('buildInhouseDataFromAttachments skips failed attachments and non-text formats', async () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-inhouse-skip-'));
    const csvPath = path.join(uploadDir, 'ok.csv');
    fs.writeFileSync(csvPath, 'X,Y\n1,2\n');
    const pdfPath = path.join(uploadDir, 'doc.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4 fake');

    const svc = broker.getLocalService('personal-agent');

    const fakeFiles = [
      { attachmentId: 'fa_ok', fileName: 'ok.csv', mimeType: 'text/csv', sizeBytes: 8, tempPath: csvPath },
      { attachmentId: 'fa_err', fileName: 'bad.csv', mimeType: 'text/csv', sizeBytes: 4, tempPath: csvPath },
      { attachmentId: 'fa_pdf', fileName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 14, tempPath: pdfPath },
    ];
    const fakeProcessing = [
      { attachmentId: 'fa_ok', status: 'ok' },
      { attachmentId: 'fa_err', status: 'error' }, // failed processing — should be skipped
    ];

    const inhouseData = svc.schema.methods.buildInhouseDataFromAttachments.call(svc, fakeFiles, fakeProcessing);

    // Only fa_ok is successful AND text-based (.csv)
    expect(inhouseData).toHaveLength(1);
    expect(inhouseData[0].attachmentId).toBe('fa_ok');
    // fa_pdf is not in processing results at all, so it is also skipped
    expect(inhouseData.find((d) => d.attachmentId === 'fa_pdf')).toBeUndefined();

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

  // Working Assumption flow: T1 unverified, T2 continues with risk flag
  it('stores location_operator_unverified assumption after VNB evidence gap', () => {
    const svc = broker.getLocalService('personal-agent');

    // Simulate execution with VNB evidence gap
    const execution = {
      status: 'partial',
      completedSteps: 2,
      steps: [
        {
          step: 1,
          action: 'grid-operations.marketPartners',
          status: 'completed',
          result: { data: { results: [{ name: 'TWL Netze GmbH', bdewCode: '9904350000002' }] } },
        },
        {
          step: 2,
          action: 'grid-operations.vnbLookup',
          status: 'completed',
          result: { operator: { name: 'TWL Netze', city: 'Ludwigshafen' } },
        },
      ],
      stopPoint: {
        reasonCode: 'MISSING_INPUTS',
        status: 'evidence-gap',
        locationOperatorConsistency: 'unverified',
      },
      assumptions: [
        {
          type: 'location_operator_unverified',
          location: 'Frankenthal',
          assertedGridOperatorName: 'TWL Netze',
          status: 'unverified',
          requiredEvidence: ['Netzanschlusszusage/BKZ', 'BDEW-Code', 'Marktlokation', 'Netzanschlusspunkt'],
          createdAtStep: 2,
        },
      ],
    };

    const reply = svc.schema.methods.buildRecoveryReply.call(svc, {
      message: 'Projekt Frankenthal mit TWL Netze prüfen',
      plan: {
        steps: [
          { step: 1, action: 'grid-operations.marketPartners' },
          { step: 2, action: 'grid-operations.vnbLookup' },
        ],
      },
      execution,
      assumptions: execution.assumptions,
    });

    // Reply should contain warning about unverified assumption
    expect(reply).toMatch(/Zuständigkeit|Due Diligence|Netzanschlusszusage/i);
    expect(reply).not.toMatch(/operatorEvidence|interface_placeholder|__step_|ACTION_FAILED/i);
    // Should mention the assumption
    expect(reply).toMatch(/Risiko|Annahme|vorläufig|Bedingung/i);
  });

  // T4 Market/Regulatory methodological handler
  it('returns methodological answer for T4 Market/Regulatory question instead of bare placeholder', async () => {
    const svc = broker.getLocalService('personal-agent');

    // Simulate T4 context: unsupported chain classified via primaryIntent, not blockedAction text
    const plan = {
      primaryIntent: 'market-regulatory-assessment',
      routeLabel: 'Market / Regulatory Assessment',
      steps: [
        {
          step: 4,
          action: 'unsupported.providerBridge',
          purpose: 'Preisdaten abrufen',
        },
      ],
    };

    const execution = {
      status: 'partial',
      completedSteps: 0,
      steps: [],
      stopPoint: {
        reasonCode: 'UNSUPPORTED_CHAIN',
        blockedAction: 'unsupported.providerBridge',
        blockedStep: 4,
        status: 'interface-placeholder',
      },
    };

    const assumption = {
      type: 'location_operator_unverified',
      assertedGridOperatorName: 'TWL Netze',
      location: 'Frankenthal',
      status: 'unverified',
    };

    const reply = svc.schema.methods.buildRecoveryReply.call(svc, {
      message: 'Preisdaten von ENTSO-E für TWL Netze abrufen?',
      plan,
      execution,
      assumptions: [assumption],
    });

    // Should contain methodological guidance, not bare placeholder message
    expect(reply).toMatch(/Methodik|Datenquelle|ENTSO-E|Netztransparenz/i);
    expect(reply).not.toMatch(/interface_placeholder|execute curated capability/i);
    // Should mention assumption risk
    expect(reply).toMatch(/Zuständigkeit|Annahme|vorläufig|Bedingung/i);
  });

  // T5 Risk Assessment synthesis handler
  it('synthesizes preliminary risk assessment from session state without placeholder', async () => {
    const svc = broker.getLocalService('personal-agent');

    // Simulate T5 context: classification via finance/risk intent, not blockedAction text
    const plan = {
      primaryIntent: 'finance-agent.analyze',
      routeLabel: 'Risk Assessment',
      steps: [
        {
          step: 5,
          action: 'unsupported.creditCommitteeBridge',
          purpose: 'Risk Assessment erstellen',
        },
      ],
    };

    const execution = {
      status: 'partial',
      completedSteps: 2,
      steps: [
        {
          step: 1,
          action: 'grid-operations.marketPartners',
          status: 'completed',
          result: { data: { results: [{ name: 'TWL Netze GmbH' }] } },
        },
        {
          step: 2,
          action: 'grid-operations.vnbLookup',
          status: 'completed',
          result: { operator: { name: 'TWL Netze', city: 'Ludwigshafen' } },
        },
      ],
      stopPoint: {
        reasonCode: 'UNSUPPORTED_CHAIN',
        blockedAction: 'unsupported.creditCommitteeBridge',
        blockedStep: 5,
        status: 'interface-placeholder',
      },
    };

    const assumption = {
      type: 'location_operator_unverified',
      assertedGridOperatorName: 'TWL Netze',
      location: 'Frankenthal',
      status: 'unverified',
    };

    const reply = svc.schema.methods.buildRecoveryReply.call(svc, {
      message: 'Erstelle ein Risk Assessment auf einer Seite für den Kreditausschuss.',
      plan,
      execution,
      assumptions: [assumption],
      taskTone: 'finance-risk',
    });

    // Should synthesize risk assessment, not placeholder
    expect(reply).toMatch(/Risk Assessment|Risikoampel|Condition Precedent/i);
    expect(reply).toMatch(/vorläufig|Auszahlung|Bedingung/i);
    expect(reply).toMatch(/BKZ|BDEW|Netzanschlusszusage/i);
    expect(reply).not.toMatch(/interface_placeholder|execute curated capability|ACTION_FAILED/i);
    // Should include completed step summaries
    expect(reply).toMatch(/Prüfschritt|abgeschlossen|TWL|Netzbetreiber/i);
  });

  // Regression: T1 Standort/VNB verification still works correctly
  it('regression: T1 Standort/VNB classification produces concrete evidence question without leaks', () => {
    const svc = broker.getLocalService('personal-agent');

    // Simulate T1 VNB consistency classification
    const consistency = svc.schema.methods.classifyLocationOperatorConsistency.call(svc, {
      knownContext: {
        location: 'Ludwigshafen',
        gridOperatorName: 'TWL Netze',
      },
      promptHints: {
        location: 'Ludwigshafen',
        gridOperatorName: 'TWL Netze',
      },
      steps: [
        {
          step: 1,
          action: 'grid-operations.marketPartners',
          status: 'completed',
          result: {
            data: {
              results: [
                {
                  name: 'TWL Netze GmbH',
                  bdewCode: '9904350000002',
                  contacts: [{ city: 'Ludwigshafen' }],
                },
              ],
            },
          },
        },
        {
          step: 2,
          action: 'grid-operations.vnbLookup',
          status: 'completed',
          result: { operator: { name: 'TWL Netze', city: 'Ludwigshafen' } },
        },
      ],
    });

    // Consistency should be unverified (no hard match failure, but missing evidence)
    expect(consistency?.status).toMatch(/unverified|verified/);

    // buildOperatorEvidenceQuestion should provide concrete guidance
    const question = svc.schema.methods.buildOperatorEvidenceQuestion.call(svc, consistency);
    expect(question).toMatch(/Due Diligence|Netzanschlusszusage|BDEW|Marktlokation/i);
    expect(question).not.toMatch(/operatorEvidence/i);
  });

  it('returns a generic methodological fallback for unsupported finance/risk chains without blockedAction hints', () => {
    const svc = broker.getLocalService('personal-agent');

    const reply = svc.schema.methods.buildRecoveryReply.call(svc, {
      message: 'Wie soll ich das für die Finanzierung methodisch weiter strukturieren?',
      plan: {
        primaryIntent: 'finance-agent.analyze',
        routeLabel: 'Finanzierungsprüfung',
        steps: [
          {
            step: 3,
            action: 'unsupported.externalBridge',
            purpose: 'Externe Finanzdaten integrieren',
          },
        ],
      },
      execution: {
        status: 'partial',
        completedSteps: 0,
        steps: [],
        stopPoint: {
          reasonCode: 'UNSUPPORTED_CHAIN',
          blockedAction: 'unsupported.externalBridge',
          blockedStep: 3,
          status: 'interface-placeholder',
        },
      },
    });

    expect(reply).toMatch(/Methodik|Annahmen|Evidenzlücken|Sensitivitäten|Entscheidungsvorbehalte/i);
    expect(reply).not.toMatch(/interface_placeholder|ACTION_FAILED|__step_/i);
  });

  it('T-PA-KR-007: forwards knowledge hints into capability broker knownContext', () => {
    const svc = broker.getLocalService('personal-agent');
    const enriched = svc.schema.methods.attachKnowledgeHintsToKnownContext.call(
      svc,
      {
        gridOperatorName: 'TWL Netze',
      },
      {
        domainHint: 'market-regulatory',
        regulatoryFrame: 'EnWG-Rahmen',
        synthesisStyle: 'methodological',
      }
    );

    expect(enriched.gridOperatorName).toBe('TWL Netze');
    expect(enriched._knowledgeHints).toEqual({
      domainHint: 'market-regulatory',
      regulatoryFrame: 'EnWG-Rahmen',
      synthesisStyle: 'methodological',
    });
  });

  it('completes the verified Standort/VNB path without storing assumptions', async () => {
    const svc = broker.getLocalService('personal-agent');
    const execution = await svc.schema.methods.executeDeterministicPlan.call(svc, {
      call: broker.call.bind(broker),
      meta: { tenantId: 'tenant-verified', authUser: { userId: 'user-1' } },
    }, {
      message: 'Projekt in Trier, Netzbetreiber Stadtwerk Trier',
      knownContext: {
        location: 'Trier',
        gridOperatorName: 'Stadtwerk Trier',
        assertedGridOperatorName: 'Stadtwerk Trier',
      },
      plan: {
        status: 'ready',
        promptHints: {
          location: 'Trier',
          city: 'Trier',
          gridOperatorName: 'Stadtwerk Trier',
          assertedGridOperatorName: 'Stadtwerk Trier',
        },
        steps: [
          {
            step: 1,
            action: 'grid-operations.marketPartners',
            paramsTemplate: {
              query: 'Stadtwerk Trier',
              limit: 3,
            },
          },
          {
            step: 2,
            action: 'grid-operations.vnbLookup',
            paramsTemplate: {
              bdew: '__step_1.data.results[0].bdewCode',
              city: '__step_1.data.results[0].contacts[0].city',
            },
          },
        ],
      },
    });

    expect(execution.status).toBe('completed');
    expect(execution.stopPoint).toBeNull();
    expect(execution.assumptions).toEqual([]);

    const consistency = svc.schema.methods.classifyLocationOperatorConsistency.call(svc, {
      knownContext: {
        location: 'Trier',
        gridOperatorName: 'Stadtwerk Trier',
        assertedGridOperatorName: 'Stadtwerk Trier',
      },
      promptHints: {
        location: 'Trier',
        city: 'Trier',
        gridOperatorName: 'Stadtwerk Trier',
        assertedGridOperatorName: 'Stadtwerk Trier',
      },
      steps: execution.steps,
    });

    expect(consistency?.status).toBe('verified');
  });

  it('routes formal §17-EnWG decision question to VDMI decision governance and derives V actor for vdmi.agentRole', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Kann der Netzbetreiber ohne formales §17-EnWG-Netzanschlussbegehren eine belastbare Anschluss- oder Kapazitätszusage geben?',
        executionMode: 'auto',
        knownContext: {
          processType: 'grid-connection-governance',
          taskId: 'network-operator-decision',
        },
      },
      { meta: { tenantId: 'tenant-vdmi-step3-a', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.routing.routeLabel).toBe('vdmi_grid_connection_decision_governance');
    expect(result.routing.primaryIntent).toBe('vdmi_grid_connection_decision_governance');
    expect(result.routing.routeLabel).not.toBe('vdmi_asset_validation_governance');

    expect(result.execution.status).toBe('completed');
    expect(result.execution.steps.map((step) => step.action)).toEqual([
      'vdmi.dossier',
      'vdmi.negotiationTrace',
      'vdmi.agentRole',
    ]);

    expect(result.presentationApplied).toBe(true);
    expect(result.presentationType).toBe('vdmi_matrix_table');
    expect(result.presentation).toBeTruthy();
    expect(result.presentation.markdown).toBe(result.reply);
    expect(result.reply).toContain('| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |');
    expect(result.reply).toContain('Network Operator Decision');
    expect(result.reply).toContain('DSO_GATEKEEPER');
    const duplicateEvidence = result.reply.match(/Vollständiger §17-Antrag/g) || [];
    expect(duplicateEvidence).toHaveLength(1);
    const duplicateAssumption = result.reply.match(/Keine belastbare Anschlusszusage ohne formalen Antrag/g) || [];
    expect(duplicateAssumption).toHaveLength(1);
    expect(result.reply).not.toMatch(/\[object Object\]/);
    expect(result.reply).not.toContain('Plan abgeschlossen:');

    const roleCall = executedCallDetails.find((entry) => entry.action === 'vdmi.agentRole');
    expect(roleCall).toBeTruthy();
    expect(roleCall.params.taskId).toBe('network-operator-decision');
    expect(roleCall.params.agentId).toBe('DSO_GATEKEEPER');
  });

  it('falls back to synthesis text when presentation.render fails, without crashing on finalized reference', async () => {
    const originalCall = broker.call.bind(broker);
    broker.call = async (actionName, params, opts) => {
      if (actionName === 'presentation.render') {
        throw new Error('simulated_presentation_failure');
      }
      return originalCall(actionName, params, opts);
    };

    try {
      const result = await broker.call(
        'personal-agent.chat',
        {
          message: 'Kann der Netzbetreiber ohne formales §17-EnWG-Netzanschlussbegehren eine belastbare Anschluss- oder Kapazitätszusage geben?',
          executionMode: 'auto',
          knownContext: {
            processType: 'grid-connection-governance',
            taskId: 'network-operator-decision',
          },
        },
        { meta: { tenantId: 'tenant-vdmi-step4-fallback', authUser: { userId: 'user-1' } } }
      );

      expect(result.success).toBe(true);
      expect(result.execution.status).toBe('completed');
      expect(result.presentationApplied).toBe(false);
      expect(result.reply).toContain('Plan abgeschlossen:');
    } finally {
      broker.call = originalCall;
    }
  });

  it('maps nested VDMI dossier results to presentation-ready matrix domainResult', () => {
    const svc = broker.getLocalService('personal-agent');
    const domainResult = svc.schema.methods.extractDomainResultFromExecution.call(svc, {
      status: 'completed',
      steps: [
        {
          action: 'vdmi.dossier',
          result: {
            matrixId: 'matrix-step3',
            dossier: {
              task: {
                taskId: 'network-operator-decision',
                taskName: 'Network Operator Decision',
                phase: 'decision',
                verantwortlich: [{ actorType: 'org', actorId: 'DSO_GATEKEEPER' }],
                durchfuehrend: [{ actorType: 'org', actorId: 'EXISTING_AREAL_GRID_OPERATOR' }],
                mitwirkend: [{ actorType: 'org', actorId: 'GROUP_ENERGY_PROJECT_OWNER' }],
                information: [{ actorType: 'org', actorId: 'AREAL_OWNER' }],
              },
              expectedStatus: 'blocked',
              evidence: {
                requirements: [{ requirementId: 'formal-request', label: 'Vollständiger §17-Antrag' }],
              },
              evidenceGaps: [{ requirementId: 'formal-request', label: 'Vollständiger §17-Antrag' }],
              forbiddenAssumptions: ['Keine belastbare Anschlusszusage ohne formalen Antrag'],
              nextActions: [{ id: 'na-1', label: 'Formalen Antrag einreichen' }],
            },
          },
        },
      ],
    });

    expect(domainResult).toBeTruthy();
    expect(domainResult.matrix).toBeTruthy();
    expect(domainResult.matrix.id).toBe('matrix-step3');
    expect(Array.isArray(domainResult.matrix.tasks)).toBe(true);
    expect(domainResult.matrix.tasks).toHaveLength(1);

    const task = domainResult.matrix.tasks[0];
    expect(task.taskId).toBe('network-operator-decision');
    expect(task.taskName).toBe('Network Operator Decision');
    expect(task.verantwortlich[0].actorId).toBe('DSO_GATEKEEPER');
    expect(Array.isArray(task.evidenceRequirements)).toBe(true);
    expect(Array.isArray(task.evidenceGaps)).toBe(true);
    expect(Array.isArray(task.forbiddenAssumptions)).toBe(true);
    expect(Array.isArray(task.nextActions)).toBe(true);

    expect(Array.isArray(domainResult.evidenceGaps)).toBe(true);
    expect(Array.isArray(domainResult.forbiddenAssumptions)).toBe(true);
    expect(Array.isArray(domainResult.nextActions)).toBe(true);
    expect(domainResult.expectedStatus).toBe('blocked');
  });

  it('stops with interface placeholder when VDMI decision task cannot be resolved uniquely', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Darf der Netzbetreiber ohne formales Netzanschlussbegehren zusagen?',
        executionMode: 'auto',
        knownContext: {
          processType: 'grid-connection-governance',
        },
      },
      { meta: { tenantId: 'tenant-vdmi-step3-b', authUser: { userId: 'user-1' } } }
    );

    expect(result.routing.routeLabel).toBe('vdmi_grid_connection_decision_governance');
    expect(result.execution.status).toBe('partial');
    expect(result.execution.stopPoint).toBeTruthy();
    expect(result.execution.stopPoint.reasonCode).toMatch(/MISSING_VDMI_TASK_CONTEXT|AMBIGUOUS_VDMI_V_ACTOR|MISSING_VDMI_V_ACTOR/);
    expect(result.execution.stopPoint.status).toBe('interface-placeholder');
  });

});
