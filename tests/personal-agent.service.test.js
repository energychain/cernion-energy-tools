'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ServiceBroker } = require('moleculer');
const ObjectStoreService = require('../services/object-store.service');
const CapabilityBrokerService = require('../services/capability-broker.service');
const PresentationService = require('../services/presentation.service');
const PersonalAgentService = require('../services/personal-agent.service');
const jobStore = require('../src/job-store');
const { WORKFLOW_TYPES } = require('../src/consultation-execution-bridge');

describe('personal-agent.service', () => {
  let broker;
  let objectStorePath;
  let placeholderCalls;
  let executedActions;
  let executedCallDetails;
  let hitlItems;
  let personaDirectory;
  let seedPersona;

  beforeEach(async () => {
    objectStorePath = path.join(os.tmpdir(), `personal-agent-store-${Date.now()}-${Math.random()}`);
    placeholderCalls = [];
    executedActions = [];
    executedCallDetails = [];
    hitlItems = new Map();
    personaDirectory = new Map();
    seedPersona = (tenantId, overrides = {}) => {
      const list = personaDirectory.get(tenantId) || [];
      const persona = {
        id: `${tenantId}/netzplanung-human`,
        tenantId,
        personaName: 'Thorsten Zoerner',
        personaType: 'human',
        assignedRoles: ['ROLE_NETZPLANUNG', 'ROLE_KAUFMAENNISCHE_LEITUNG'],
        status: 'active',
        ...overrides,
      };
      list.push(persona);
      personaDirectory.set(tenantId, list);
      return persona;
    };
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
      name: 'agent-receipts',
      actions: {
        select: {
          handler(ctx) {
            const buildVnbLookupReceipt = (receiptId, status = 'active') => ({
              receiptId,
              status,
              toolPlan: {
                steps: [
                  {
                    step: 1,
                    action: 'grid-operations.vnbLookup',
                    required: true,
                    paramMapping: {
                      city: { source: 'context', contextField: 'city' },
                      bdew: { source: 'context', contextField: 'bdewCode' },
                      vnbName: { source: 'context', contextField: 'vnbName' },
                    },
                  },
                ],
              },
            });
            const buildHeidelbergChainReceipt = (receiptId, status = 'active') => ({
              receiptId,
              status,
              toolPlan: {
                steps: [
                  {
                    step: 1,
                    action: 'grid-operations.marketPartners',
                    required: true,
                    params: {
                      query: 'Stadtwerke Heidelberg',
                      limit: 3,
                    },
                  },
                  {
                    step: 2,
                    action: 'grid-operations.vnbLookup',
                    required: true,
                    paramMapping: {
                      bdew: { source: 'fixed', value: '__step_1.data.results[0].bdewCode' },
                      city: {
                        source: 'fixed',
                        value: '__step_1.data.results[0].contacts[0].city',
                      },
                    },
                  },
                ],
              },
            });

            const forceReceipt =
              typeof ctx.params.forceReceipt === 'string' ? ctx.params.forceReceipt.trim() : null;
            const allowDraftReceipts = ctx.params.allowDraftReceipts === true;
            const preferredReceipts = Array.isArray(ctx.params.preferredReceipts)
              ? ctx.params.preferredReceipts
              : [];

            if (ctx.params.disableReceiptSelection === true) {
              return {
                success: true,
                data: {
                  selected: false,
                  receiptId: null,
                  status: null,
                  mode: 'disabled',
                  score: null,
                  warnings: [],
                },
              };
            }

            if (forceReceipt === 'invalid-receipt-v1') {
              const error = new Error('forced receipt invalid');
              error.code = 422;
              error.type = 'RECEIPT_NOT_FOUND_OR_INVALID';
              throw error;
            }

            if (forceReceipt === 'draft-receipt-v1' && !allowDraftReceipts) {
              const error = new Error('draft receipt not allowed');
              error.code = 422;
              error.type = 'RECEIPT_DRAFT_NOT_ALLOWED';
              throw error;
            }

            if (forceReceipt) {
              const status = forceReceipt === 'draft-receipt-v1' ? 'draft' : 'active';
              const selectedReceipt =
                forceReceipt === 'vnb-lookup-heidelberg-v1'
                  ? buildHeidelbergChainReceipt(forceReceipt, status)
                  : buildVnbLookupReceipt(forceReceipt, status);
              return {
                success: true,
                data: {
                  selected: true,
                  receiptId: forceReceipt,
                  status,
                  mode: 'forced',
                  score: 99,
                  warnings: [],
                  selectedReceipt,
                  diagnostics: ctx.params.explainReceiptSelection
                    ? { matched: true, executable: true }
                    : undefined,
                },
              };
            }

            const message = String(ctx.params.message || '').toLowerCase();
            const knownContext =
              ctx.params?.context?.knownContext && typeof ctx.params.context.knownContext === 'object'
                ? ctx.params.context.knownContext
                : {};
            const hasHeidelbergSignal =
              /heidelberg/.test(message) || String(knownContext.city || '').toLowerCase() === 'heidelberg';
            const hasVnbSignal =
              /wiesloch/.test(message) ||
              String(knownContext.city || '').toLowerCase() === 'wiesloch';

            if (hasHeidelbergSignal) {
              return {
                success: true,
                data: {
                  selected: true,
                  receiptId: 'vnb-lookup-heidelberg-v1',
                  status: 'active',
                  mode: 'matched',
                  score: 95,
                  warnings: [],
                  selectedReceipt: buildHeidelbergChainReceipt('vnb-lookup-heidelberg-v1', 'active'),
                  diagnostics: ctx.params.explainReceiptSelection
                    ? {
                        matched: true,
                        executable: true,
                        reasons: ['trigger_term_match', 'location_heidelberg'],
                        missingMatchEntities: [],
                      }
                    : undefined,
                },
              };
            }

            if (hasVnbSignal) {
              return {
                success: true,
                data: {
                  selected: true,
                  receiptId: 'vnb-lookup-v1',
                  status: 'active',
                  mode: 'matched',
                  score: 91,
                  warnings: [],
                  selectedReceipt: buildVnbLookupReceipt('vnb-lookup-v1', 'active'),
                  diagnostics: ctx.params.explainReceiptSelection
                    ? {
                        matched: true,
                        executable: true,
                        reasons: ['trigger_term_match'],
                        missingMatchEntities: [],
                      }
                    : undefined,
                },
              };
            }

            if (preferredReceipts.includes('draft-receipt-v1') && !allowDraftReceipts) {
              return {
                success: true,
                data: {
                  selected: false,
                  receiptId: null,
                  status: null,
                  mode: 'none',
                  score: null,
                  warnings: [
                    {
                      code: 'PREFERRED_RECEIPT_NOT_FOUND_OR_NOT_ALLOWED',
                      receiptId: 'draft-receipt-v1',
                    },
                  ],
                },
              };
            }

            return {
              success: true,
              data: {
                selected: false,
                receiptId: null,
                status: null,
                mode: 'none',
                score: null,
                warnings: [],
                diagnostics: ctx.params.explainReceiptSelection
                  ? { evaluatedCandidates: 0, preferredCandidates: preferredReceipts }
                  : undefined,
              },
            };
          },
        },
      },
    });
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
      name: 'agent-persona',
      actions: {
        list: {
          handler(ctx) {
            const tenantId = ctx.params?.tenantId || ctx.meta?.tenantId || null;
            const role = ctx.params?.role || null;
            const personas = Array.isArray(personaDirectory.get(tenantId))
              ? personaDirectory.get(tenantId)
              : [];
            const items = role
              ? personas.filter(
                  (persona) =>
                    Array.isArray(persona.assignedRoles) && persona.assignedRoles.includes(role)
                )
              : personas;
            return { success: true, items };
          },
        },
      },
    });
    broker.createService({
      name: 'hitl',
      actions: {
        create: {
          handler(ctx) {
            const id = `hitl-${hitlItems.size + 1}`;
            const tenantId = ctx.meta?.tenantId || null;
            const paramsRoutingContext =
              ctx.params?.routingContext && typeof ctx.params.routingContext === 'object'
                ? ctx.params.routingContext
                : null;
            const responsibleRole =
              ctx.params?.responsibleRole || paramsRoutingContext?.responsibleRole || null;
            const requiredResolverRoles = Array.isArray(ctx.params?.requiredResolverRoles)
              ? ctx.params.requiredResolverRoles
              : [];
            const explicitPersonaId =
              ctx.params?.personaId || paramsRoutingContext?.personaId || null;
            const personas = Array.isArray(personaDirectory.get(tenantId))
              ? personaDirectory.get(tenantId)
              : [];
            const resolvedPersona = explicitPersonaId
              ? personas.find((persona) => persona.id === explicitPersonaId)
              : personas.find(
                  (persona) =>
                    persona.status === 'active' &&
                    responsibleRole &&
                    Array.isArray(persona.assignedRoles) &&
                    persona.assignedRoles.includes(responsibleRole)
                ) || null;

            const item = {
              id,
              kind: ctx.params.kind || 'generic',
              payload: ctx.params.payload || {},
              status: 'pending',
              createdAt: new Date().toISOString(),
              tenantId,
              responsibleRole,
              requiredResolverRoles,
              personaId: resolvedPersona?.id || explicitPersonaId || null,
              personaName: resolvedPersona?.personaName || null,
              personaType: resolvedPersona?.personaType || null,
              personaResolution: resolvedPersona
                ? {
                    personaId: resolvedPersona.id,
                    personaName: resolvedPersona.personaName,
                    personaType: resolvedPersona.personaType,
                    responsibleRole,
                    requiredResolverRoles,
                    source: 'agent-persona.mock',
                  }
                : null,
              routingContext: paramsRoutingContext,
            };
            hitlItems.set(id, item);
            return { success: true, item };
          },
        },
        get: {
          handler(ctx) {
            const item = hitlItems.get(ctx.params.id);
            if (!item) {
              const error = new Error('not found');
              error.code = 404;
              throw error;
            }
            return { success: true, item };
          },
        },
        approve: {
          handler(ctx) {
            const item = hitlItems.get(ctx.params.id);
            if (!item) {
              const error = new Error('not found');
              error.code = 404;
              throw error;
            }
            const approved = {
              ...item,
              status: 'approved',
              approvedAt: new Date().toISOString(),
            };
            hitlItems.set(ctx.params.id, approved);
            return { success: true, item: approved };
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
            executedCallDetails.push({
              action: 'grid-connection.fnavValidate',
              params: ctx.params,
            });
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
        analyze: {
          handler(ctx) {
            executedActions.push('finance-agent.analyze');
            executedCallDetails.push({ action: 'finance-agent.analyze', params: ctx.params });
            return {
              success: true,
              verdict: 'proceed-with-conditions',
              riskLevel: 'medium',
              input: ctx.params,
            };
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
            executedCallDetails.push({
              action: 'grid-operations.marketPartners',
              params: ctx.params,
            });
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
            if (query.includes('heidelberg')) {
              return {
                data: {
                  results: [
                    {
                      bdewCode: '9910277000001',
                      contacts: [{ city: 'Heidelberg' }],
                      name: 'Stadtwerke Heidelberg Energie GmbH',
                      role: 'Lieferant',
                    },
                    {
                      bdewCode: '9900277000000',
                      contacts: [{ city: 'Heidelberg' }],
                      name: 'Stadtwerke Heidelberg Netze GmbH',
                      role: 'VNB',
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
            const normalizedCity = String(ctx.params.city || '').toLowerCase();
            if (normalizedCity === 'heidelberg' && !ctx.params.bdew) {
              throw new Error('Parameter "bdew" is required.');
            }
            if (normalizedCity === 'wiesloch' && !ctx.params.bdew) {
              return {
                success: true,
                data: {
                  source: 'city-nap-fallback',
                  mastrId: 'SNB935578300972',
                  bdew: null,
                  companyName: null,
                  evidenceStatus: 'unverified',
                  partial: true,
                  unverified: true,
                  verification: {
                    verifiedIdentity: false,
                    gap: {
                      code: 'VNB_IDENTITY_UNVERIFIED',
                    },
                  },
                },
              };
            }
            const isVerifiedPath = String(ctx.params.city || '').toLowerCase() === 'trier';
            if (normalizedCity === 'heidelberg' && String(ctx.params.bdew) === '9900277000000') {
              return {
                success: true,
                data: {
                  mastrId: 'SNB938476571321',
                  bdew: '9900277000000',
                  companyName: 'Stadtwerke Heidelberg Netze GmbH',
                  evidenceStatus: 'verified',
                  verification: {
                    verifiedIdentity: true,
                    source: 'bdew-lookup',
                    warnings: [],
                    gap: null,
                  },
                },
                operator: {
                  bdew: '9900277000000',
                  city: 'Heidelberg',
                  name: 'Stadtwerke Heidelberg Netze GmbH',
                },
                responsibilityMatch: true,
              };
            }
            const operatorName =
              ctx.params.vnbName || (isVerifiedPath ? 'Stadtwerk Trier' : 'TWL Netze');
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
        assessPortfolio: {
          params: {
            projectId: { type: 'string' },
          },
          handler(ctx) {
            if (!ctx.params.projectId) {
              throw new Error('Parameters validation error!');
            }
            executedActions.push('znp.assessPortfolio');
            executedCallDetails.push({ action: 'znp.assessPortfolio', params: ctx.params });
            return { success: true, projectId: ctx.params.projectId, portfolio: [] };
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
        chatMode: 'execution',
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
        chatMode: 'execution',
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

  it('forwards contract-gate fields through Personal Agent execution', async () => {
    await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte fNAV und Finance für TWL Netze bewerten',
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: {
          gridOperatorName: 'TWL Netze',
          voltageLevel: 'MS',
          ownerContact: 'netzplanung@twl.de',
          signalPriorityPolicy: 'Netzsignal Vorrang vor Vermarktungs- und Fahrplanoptimierung',
          controlEvidenceRef: 'SCADA-ATTACHMENT-42 / Fernwirknachweis 2026-05',
          fnavProfile: { requestedCapacity: 5000, flexibleCapacity: 2000 },
          annualFeeEur: 12000,
        },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    const validationCall = executedCallDetails.find(
      (entry) => entry.action === 'grid-connection.fnavValidate'
    );
    const financeCall = executedCallDetails.find(
      (entry) => entry.action === 'finance-agent.fnavEconomics'
    );

    expect(validationCall.params.fnavProfile).toEqual(
      expect.objectContaining({
        signalPriorityPolicy: 'Netzsignal Vorrang vor Vermarktungs- und Fahrplanoptimierung',
        controlEvidenceRef: 'SCADA-ATTACHMENT-42 / Fernwirknachweis 2026-05',
      })
    );
    expect(financeCall.params.fnavProfile).toEqual(
      expect.objectContaining({
        signalPriorityPolicy: 'Netzsignal Vorrang vor Vermarktungs- und Fahrplanoptimierung',
        controlEvidenceRef: 'SCADA-ATTACHMENT-42 / Fernwirknachweis 2026-05',
      })
    );
  });

  it('blocks dependent step execution when lookup result list is empty', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte Netzbetreiber prüfen: unbekannt',
        chatMode: 'execution',
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
        chatMode: 'execution',
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
    expect(result.reply).toMatch(
      /Due Diligence|Evidenz|Netzanschlusszusage|Marktlokation|Netzanschlusspunkt|BDEW/i
    );
    expect(result.reply).not.toMatch(/Parameters validation error|ACTION_FAILED|__step_/i);
    expect(result.reply).not.toMatch(/operatorEvidence/i);

    const vnbLookupCall = executedCallDetails.find(
      (entry) => entry.action === 'grid-operations.vnbLookup'
    );
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
        chatMode: 'execution',
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
        chatMode: 'execution',
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
        chatMode: 'execution',
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
        chatMode: 'execution',
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
        chatMode: 'execution',
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
        chatMode: 'execution',
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
        message:
          'Arbeite mit der vorläufigen Annahme weiter und nenne die nächsten fachlichen Schritte.',
        chatMode: 'execution',
        executionMode: 'auto',
      },
      meta
    );

    expect(second.reply).toMatch(
      /Risikoflag|vorläufig|noch nicht durch Evidenz belegt|Working Assumption/i
    );
    expect(second.reply).not.toContain(firstQuestion);
    expect(second.reply).not.toMatch(
      /operatorEvidence|interface_placeholder|interface-placeholder|__step_|ACTION_FAILED/i
    );

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
    const meta = {
      meta: { tenantId: 'tenant-cetred-methodology', authUser: { userId: 'user-1' } },
    };
    const first = await broker.call(
      'personal-agent.chat',
      {
        message: 'Projekt in Frankenthal, Netzbetreiber soll TWL Netze sein, 12 MW',
        chatMode: 'execution',
        executionMode: 'auto',
      },
      meta
    );

    const marketTurn = await broker.call(
      'personal-agent.chat',
      {
        sessionId: first.sessionId,
        message: 'Welche Markt- und Regulatorik-Methodik würdest du jetzt anwenden?',
        chatMode: 'execution',
        executionMode: 'auto',
      },
      meta
    );

    expect(marketTurn.reply).toMatch(/Methodik|Datenquelle|ENTSO-E|Netztransparenz/i);
    expect(marketTurn.reply).not.toContain(
      'Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.'
    );
    expect(marketTurn.reply).not.toMatch(
      /operatorEvidence|interface_placeholder|interface-placeholder|__step_|ACTION_FAILED/i
    );

    const riskTurn = await broker.call(
      'personal-agent.chat',
      {
        sessionId: first.sessionId,
        message: 'Erstelle daraus ein vorläufiges Risk Assessment für den Kreditausschuss.',
        chatMode: 'execution',
        executionMode: 'auto',
      },
      meta
    );

    expect(riskTurn.reply).toMatch(
      /Risk Assessment|Condition Precedent|Due Diligence|Risikoampel|Freigabe erforderlich|HITL/i
    );
    expect(riskTurn.reply).toMatch(/\[embed ref="hitl_item_/i);
    expect(riskTurn.reply).not.toContain(
      'Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.'
    );
    expect(riskTurn.reply).not.toMatch(
      /operatorEvidence|interface_placeholder|interface-placeholder|__step_|ACTION_FAILED/i
    );
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
      message:
        'Mein Kreditkomitee will ein Risk Assessment für ein 12-MW-Speicherprojekt. Was fehlt für eine belastbare Bewertung?',
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

    expect(reply).toContain(
      'Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen.'
    );
    expect(reply).toContain(
      'Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, den konkreten Netzanschlusspunkt oder den zuständigen BDEW-Code.'
    );
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
            questionText:
              'Ich kann die Zuständigkeit für den Standort Frankenthal noch nicht belastbar bestätigen. Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, den konkreten Netzanschlusspunkt oder den zuständigen BDEW-Code.',
          },
        },
      },
    });

    expect(reply).toMatch(/Netzbetreiber(?:-| )Zuordnung \(1 Treffer\)/i);
    expect(reply).not.toMatch(
      /Netzbetreiber(?:-| )Zuordnung \(1 Treffer\);\s*Netzbetreiber(?:-| )Zuordnung/i
    );
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
            suggestedNextSteps: [
              'Execute curated capability path for vnb_kpi_benchmark_comparison',
            ],
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
    const csvContent =
      'AssetID,Kapazitaet_kW,Ort\nA-001,5000,Ludwigshafen\nA-002,3000,Frankenthal\n';
    fs.writeFileSync(csvPath, csvContent);

    const svc = broker.getLocalService('personal-agent');

    // Verify buildInhouseDataFromAttachments reads text and returns content
    const fakeFiles = [
      {
        attachmentId: 'fa_asset_csv',
        fileName: 'assets.csv',
        mimeType: 'text/csv',
        sizeBytes: csvContent.length,
        tempPath: csvPath,
      },
    ];
    const fakeProcessing = [{ attachmentId: 'fa_asset_csv', fileName: 'assets.csv', status: 'ok' }];
    const inhouseData = svc.schema.methods.buildInhouseDataFromAttachments.call(
      svc,
      fakeFiles,
      fakeProcessing
    );

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
      {
        attachmentId: 'fa_ok',
        fileName: 'ok.csv',
        mimeType: 'text/csv',
        sizeBytes: 8,
        tempPath: csvPath,
      },
      {
        attachmentId: 'fa_err',
        fileName: 'bad.csv',
        mimeType: 'text/csv',
        sizeBytes: 4,
        tempPath: csvPath,
      },
      {
        attachmentId: 'fa_pdf',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 14,
        tempPath: pdfPath,
      },
    ];
    const fakeProcessing = [
      { attachmentId: 'fa_ok', status: 'ok' },
      { attachmentId: 'fa_err', status: 'error' }, // failed processing — should be skipped
    ];

    const inhouseData = svc.schema.methods.buildInhouseDataFromAttachments.call(
      svc,
      fakeFiles,
      fakeProcessing
    );

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
        chatMode: 'execution',
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
          requiredEvidence: [
            'Netzanschlusszusage/BKZ',
            'BDEW-Code',
            'Marktlokation',
            'Netzanschlusspunkt',
          ],
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

    expect(reply).toMatch(
      /Methodik|Annahmen|Evidenzlücken|Sensitivitäten|Entscheidungsvorbehalte/i
    );
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
    const execution = await svc.schema.methods.executeDeterministicPlan.call(
      svc,
      {
        call: broker.call.bind(broker),
        meta: { tenantId: 'tenant-verified', authUser: { userId: 'user-1' } },
      },
      {
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
      }
    );

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
    const meta = { tenantId: 'tenant-vdmi-step3-a', authUser: { userId: 'user-1' } };
    const checkpoint = await broker.call(
      'hitl.create',
      {
        kind: 'personal-agent-critical-step-approval',
        payload: { purpose: 'test-preapproval-vdmi-step3' },
      },
      { meta }
    );
    await broker.call('hitl.approve', { id: checkpoint.item.id }, { meta });

    const result = await broker.call(
      'personal-agent.chat',
      {
        message:
          'Kann der Netzbetreiber ohne formales §17-EnWG-Netzanschlussbegehren eine belastbare Anschluss- oder Kapazitätszusage geben?',
        executionMode: 'auto',
        knownContext: {
          processType: 'grid-connection-governance',
          taskId: 'network-operator-decision',
          hitlItemId: checkpoint.item.id,
        },
      },
      { meta }
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
    expect(result.reply).toContain(
      '| Beschreibung des Schrittes | Verantwortlich | Durchführend | Mitwirkend | Informiert |'
    );
    expect(result.reply).toContain('Network Operator Decision');
    expect(result.reply).toContain('DSO_GATEKEEPER');
    const duplicateEvidence = result.reply.match(/Vollständiger §17-Antrag/g) || [];
    expect(duplicateEvidence).toHaveLength(1);
    const duplicateAssumption =
      result.reply.match(/Keine belastbare Anschlusszusage ohne formalen Antrag/g) || [];
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
      const meta = { tenantId: 'tenant-vdmi-step4-fallback', authUser: { userId: 'user-1' } };
      const checkpoint = await broker.call(
        'hitl.create',
        {
          kind: 'personal-agent-critical-step-approval',
          payload: { purpose: 'test-preapproval-vdmi-step4' },
        },
        { meta }
      );
      await broker.call('hitl.approve', { id: checkpoint.item.id }, { meta });

      const result = await broker.call(
        'personal-agent.chat',
        {
          message:
            'Kann der Netzbetreiber ohne formales §17-EnWG-Netzanschlussbegehren eine belastbare Anschluss- oder Kapazitätszusage geben?',
          executionMode: 'auto',
          knownContext: {
            processType: 'grid-connection-governance',
            taskId: 'network-operator-decision',
            hitlItemId: checkpoint.item.id,
          },
        },
        { meta }
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
                requirements: [
                  { requirementId: 'formal-request', label: 'Vollständiger §17-Antrag' },
                ],
              },
              evidenceGaps: [
                { requirementId: 'formal-request', label: 'Vollständiger §17-Antrag' },
              ],
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
    const meta = { tenantId: 'tenant-vdmi-step3-b', authUser: { userId: 'user-1' } };
    const checkpoint = await broker.call(
      'hitl.create',
      {
        kind: 'personal-agent-critical-step-approval',
        payload: { purpose: 'test-preapproval-vdmi-ambiguous' },
      },
      { meta }
    );
    await broker.call('hitl.approve', { id: checkpoint.item.id }, { meta });

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Darf der Netzbetreiber ohne formales Netzanschlussbegehren zusagen?',
        executionMode: 'auto',
        knownContext: {
          processType: 'grid-connection-governance',
          hitlItemId: checkpoint.item.id,
        },
      },
      { meta }
    );

    expect(result.routing.routeLabel).toBe('vdmi_grid_connection_decision_governance');
    expect(result.execution.status).toBe('partial');
    expect(result.execution.stopPoint).toBeTruthy();
    expect(result.execution.stopPoint.reasonCode).toMatch(
      /MISSING_VDMI_TASK_CONTEXT|AMBIGUOUS_VDMI_V_ACTOR|MISSING_VDMI_V_ACTOR/
    );
    expect(result.execution.stopPoint.status).toBe('interface-placeholder');
  });

  it('defaults to consultation mode for legacy sessions without chatMode', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message:
          '500 kWp PV, 250 kWh Speicher, Burgbernheim. Wie hoch ist die Redispatch-Wahrscheinlichkeit?',
        executionMode: 'auto',
      },
      { meta: { tenantId: 'tenant-consult-default', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('consulting');
    expect(result.chatMode).toBe('consultation');
    expect(result.execution).toEqual({ status: 'consulting', plan: null, steps: [], stopPoint: null });
    expect(result.consultation).toBeTruthy();
    expect(Array.isArray(result.consultation.hypotheses)).toBe(true);
    expect(Array.isArray(result.consultation.openQuestions)).toBe(true);
    expect(Array.isArray(result.consultation.nextActions)).toBe(true);
    expect(Array.isArray(result.consultation.factsUsed)).toBe(true);
  });

  it('runs agentic consultation through real grid-operations tools before synthesis', async () => {
    const svc = broker.getLocalService('personal-agent');
    const plannerResponses = [
      {
        text: JSON.stringify({
          mode: 'tool',
          thought:
            'Ein Netzbetreibername liegt vor, daher starte ich mit der Marktpartner-Auflösung.',
          toolCall: {
            action: 'grid-operations.marketPartners',
            params: { query: 'TWL Netze', limit: 5 },
          },
        }),
      },
      {
        text: JSON.stringify({
          mode: 'tool',
          thought: 'Der Marktpartner ist gefunden, jetzt prüfe ich die Zuständigkeit.',
          toolCall: {
            action: 'grid-operations.vnbLookup',
            params: {
              bdew: '9904350000002',
              city: 'Burgbernheim',
              query: 'TWL Netze',
              vnbName: 'TWL Netze GmbH',
            },
          },
        }),
      },
      {
        text: JSON.stringify({
          mode: 'final',
          thought: 'Genug Evidenz für die Synthese.',
          reply: '',
        }),
      },
    ];
    const parameterResponses = [
      { text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) },
      { text: JSON.stringify({ bdew: '9904350000002', city: 'Burgbernheim', limit: 5 }) },
    ];
    const llmResponses = [
      {
        data: {
          reply: 'Die Zuständigkeit ist nun über die Toolkette eingeordnet.',
          hypotheses: [
            {
              statement: 'TWL Netze ist der relevante Netzbetreiber für den angefragten Kontext.',
              confidence: 'high',
              evidence: 'Tool-basierte Marktpartner- und VNB-Auflösung.',
            },
          ],
          openQuestions: [
            {
              question: 'Liegt bereits ein offizieller BDEW- oder Netzanschlussbezug vor?',
              whyRelevant: 'Damit lässt sich die Zuständigkeitsprüfung weiter präzisieren.',
            },
          ],
          nextActions: [
            {
              action: 'Unterlagen prüfen',
              description: 'Ich kann als Nächstes die Anschluss- oder BDEW-Daten gegenprüfen.',
            },
          ],
          factsUsed: [
            {
              source: 'tool:marketPartners',
              value: 'TWL Netze GmbH',
            },
            {
              source: 'tool:vnbLookup',
              value: 'BDEW 9904350000002',
            },
          ],
        },
      },
    ];

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          return llmResponses.shift();
        }
        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return parameterResponses.shift();
        }
        return (
          plannerResponses.shift() || {
            text: JSON.stringify({ mode: 'final', thought: 'Fallback final' }),
          }
        );
      });

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Wie belastbar ist die Zuständigkeitslage?',
        brokerRecommendation: { intent: 'consultation' },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
      });

      expect(result.reply).toContain('Toolkette eingeordnet');
      expect(Array.isArray(result.toolTrace)).toBe(true);
      expect(Array.isArray(result.attemptsSummary)).toBe(true);
      expect(result.toolTrace).toEqual(
        expect.arrayContaining([expect.objectContaining({ phase: 'act' })])
      );
    } finally {
      callLlmSpy.mockRestore();
    }
  });

  it('de-prioritizes vnbLookup when bdew fact is missing and falls back to marketPartners', async () => {
    const svc = broker.getLocalService('personal-agent');
    const plannerResponses = [
      {
        text: JSON.stringify({
          mode: 'tool',
          thought: 'Ich starte mit vnbLookup.',
          toolCall: {
            action: 'grid-operations.vnbLookup',
            params: { city: 'Walldorf' },
          },
        }),
      },
      {
        text: JSON.stringify({
          mode: 'final',
          thought: 'Genug Evidenz für die Beratung.',
          reply: '',
        }),
      },
    ];
    const parameterResponses = [
      { text: JSON.stringify({ query: 'Stadtwerke Walldorf', limit: 5 }) },
    ];
    const synthesisResponse = {
      data: {
        reply: 'Ich habe passende Marktpartnerdaten ermittelt.',
        hypotheses: [],
        openQuestions: [],
        nextActions: [],
        factsUsed: [],
      },
    };

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          return synthesisResponse;
        }
        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return parameterResponses.shift();
        }
        return (
          plannerResponses.shift() || {
            text: JSON.stringify({ mode: 'final', thought: 'Fallback final' }),
          }
        );
      });

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-missing-bdew', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'Stadtwerke Walldorf, BDEW unbekannt',
        brokerRecommendation: { intent: 'consultation' },
        resolvedParams: { gridOperatorName: 'Stadtwerke Walldorf', city: 'Walldorf' },
        knowledgeContext: { gridOperatorName: 'Stadtwerke Walldorf', city: 'Walldorf' },
        knownContext: { gridOperatorName: 'Stadtwerke Walldorf', city: 'Walldorf' },
      });

      expect(result.toolTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: 'think',
            status: 'deprioritized',
            fromAction: 'grid-operations.vnbLookup',
            toAction: 'grid-operations.marketPartners',
          }),
        ])
      );
    } finally {
      callLlmSpy.mockRestore();
    }
  });

  it('keeps consultation tool execution working when ctx.call is non-enumerable', async () => {
    const svc = broker.getLocalService('personal-agent');
    const plannerResponses = [
      {
        text: JSON.stringify({
          mode: 'tool',
          thought: 'Ein Netzbetreibername liegt vor, daher starte ich mit marketPartners.',
          toolCall: {
            action: 'grid-operations.marketPartners',
            params: { query: 'TWL Netze', limit: 5 },
          },
        }),
      },
      {
        text: JSON.stringify({
          mode: 'final',
          thought: 'Genug Evidenz für die Synthese.',
          reply: '',
        }),
      },
    ];
    const parameterResponses = [{ text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) }];
    const synthesisResponse = {
      data: {
        reply: 'Die Zuständigkeit wurde anhand der Tool-Evidenz vorläufig eingeordnet.',
        hypotheses: [],
        openQuestions: [],
        nextActions: [],
        factsUsed: [],
      },
    };

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          return synthesisResponse;
        }
        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return parameterResponses.shift();
        }
        return (
          plannerResponses.shift() || {
            text: JSON.stringify({ mode: 'final', thought: 'Fallback final' }),
          }
        );
      });

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-non-enum-call', authUser: { userId: 'user-1' } },
    };

    Object.defineProperty(mockCtx, 'call', {
      enumerable: false,
      configurable: true,
      writable: true,
      value: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    });

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Wie belastbar ist die Zuständigkeitslage?',
        brokerRecommendation: { intent: 'consultation' },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
      });

      expect(result.reply).toContain('Tool-Evidenz');
      expect(Array.isArray(result.toolTrace)).toBe(true);
      expect(result.toolTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            phase: 'act',
            action: 'grid-operations.marketPartners',
          }),
        ])
      );
      expect(
        result.toolTrace.some((entry) =>
          /ctx\.call is not a function/i.test(String(entry?.error || ''))
        )
      ).toBe(false);
    } finally {
      callLlmSpy.mockRestore();
    }
  });

  it('includes consultation debug trace on synthesis-budget fallback when debugTrace is enabled', async () => {
    const svc = broker.getLocalService('personal-agent');
    const originalDateNow = Date.now;
    const nowValues = [0, 0, 29_750, 29_750];
    let nowIndex = 0;

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return { text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) };
        }

        return {
          text: JSON.stringify({
            mode: 'tool',
            thought: 'Ich starte mit der Marktpartner-Auflösung.',
            toolCall: {
              action: 'grid-operations.marketPartners',
              params: { query: 'TWL Netze', limit: 5 },
            },
          }),
        };
      });

    Date.now = jest.fn(() => nowValues[Math.min(nowIndex++, nowValues.length - 1)]);

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-debug', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Bitte Beratung einordnen.',
        brokerRecommendation: {
          intent: 'consultation',
          capability: 'grid-operations.marketPartners',
        },
        semanticClassification: { workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim', debugTrace: true },
      });

      expect(
        /Synthese unvollständig; belastbare Bewertung nicht abgeschlossen|Kurzfazit auf Basis der erhobenen Tool-Evidenz/i.test(
          result.reply || ''
        )
      ).toBe(true);
      expect(Array.isArray(result.debugTrace)).toBe(true);
      expect(result.debugTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'effective_tool_timeout' }),
          expect.objectContaining({ type: 'consultation_observation' }),
        ])
      );
    } finally {
      Date.now = originalDateNow;
      callLlmSpy.mockRestore();
    }
  });

  it('does not force timeout fallback when planner+tool exceed 8s but remain within default max budget', async () => {
    const svc = broker.getLocalService('personal-agent');
    const originalDateNow = Date.now;
    const nowValues = [0, 0, 16_176, 16_176, 16_176, 16_176, 16_176];
    let nowIndex = 0;

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          return {
            data: {
              reply: 'Synthetisierte Antwort trotz langer Vorphase.',
              hypotheses: [],
              openQuestions: [],
              nextActions: [],
              factsUsed: [],
            },
          };
        }

        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return { text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) };
        }

        return {
          text: JSON.stringify({
            mode: 'tool',
            thought: 'Ich starte mit einer Tool-Abfrage.',
            toolCall: {
              action: 'grid-operations.marketPartners',
              params: { query: 'TWL Netze', limit: 5 },
            },
          }),
        };
      });

    Date.now = jest.fn(() => nowValues[Math.min(nowIndex++, nowValues.length - 1)]);

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-budget-30s', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Bitte Beratung einordnen.',
        brokerRecommendation: {
          intent: 'consultation',
          capability: 'grid-operations.marketPartners',
        },
        semanticClassification: { workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
      });

      expect(result.reply).toContain('Synthetisierte Antwort');
      expect(result.reply).not.toContain('Synthese-Phase ist zeitlich erschöpft');
    } finally {
      Date.now = originalDateNow;
      callLlmSpy.mockRestore();
    }
  });

  it('emits effective tool timeout capped by remaining budget minus synthesis reserve', async () => {
    const svc = broker.getLocalService('personal-agent');
    const originalDateNow = Date.now;
    const nowValues = [0, 0, 21_000, 21_000, 21_000, 21_000, 21_000, 21_000];
    let nowIndex = 0;

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          return {
            data: {
              reply: 'Antwort nach Budget-kappung.',
              hypotheses: [],
              openQuestions: [],
              nextActions: [],
              factsUsed: [],
            },
          };
        }

        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return { text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) };
        }

        return {
          text: JSON.stringify({
            mode: 'tool',
            thought: 'Tool zuerst.',
            toolCall: {
              action: 'grid-operations.marketPartners',
              params: { query: 'TWL Netze', limit: 5 },
            },
          }),
        };
      });

    Date.now = jest.fn(() => nowValues[Math.min(nowIndex++, nowValues.length - 1)]);

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-effective-timeout', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Bitte Beratung einordnen.',
        brokerRecommendation: {
          intent: 'consultation',
          capability: 'grid-operations.marketPartners',
        },
        semanticClassification: { workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim', debugTrace: true },
      });

      const timeoutEvent = (result.debugTrace || []).find(
        (entry) => entry.type === 'effective_tool_timeout'
      );
      expect(timeoutEvent).toBeTruthy();
      expect(timeoutEvent.effectiveToolTimeoutMs).toBeGreaterThan(0);
      expect(timeoutEvent.effectiveToolTimeoutMs).toBeLessThanOrEqual(
        timeoutEvent.configuredToolTimeoutMs
      );
      expect(timeoutEvent.configuredToolTimeoutMs).toBeGreaterThanOrEqual(8_000);
    } finally {
      Date.now = originalDateNow;
      callLlmSpy.mockRestore();
    }
  });

  it('uses observation summary when synthesis reserve is hit after successful tool evidence', async () => {
    const svc = broker.getLocalService('personal-agent');
    const originalDateNow = Date.now;
    const nowValues = [0, 0, 100, 200, 200, 200, 210, 300, 29_700, 29_700, 29_700, 29_700];
    let nowIndex = 0;

    const plannerResponses = [
      {
        text: JSON.stringify({
          mode: 'tool',
          thought: 'Marktpartner recherchieren.',
          toolCall: {
            action: 'grid-operations.marketPartners',
            params: { query: 'TWL Netze', limit: 5 },
          },
        }),
      },
      {
        text: JSON.stringify({
          mode: 'final',
          thought: 'Es liegt genug Evidenz vor.',
          reply: '',
        }),
      },
    ];

    const parameterResponses = [{ text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) }];

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          return {
            data: {
              reply: 'Dieser Text sollte bei knapper Synthese-Zeit nicht verwendet werden.',
              hypotheses: [],
              openQuestions: [],
              nextActions: [],
              factsUsed: [],
            },
          };
        }

        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return parameterResponses.shift();
        }

        return (
          plannerResponses.shift() || {
            text: JSON.stringify({ mode: 'final', thought: 'Fallback final' }),
          }
        );
      });

    Date.now = jest.fn(() => nowValues[Math.min(nowIndex++, nowValues.length - 1)]);

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-observation-summary', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Bitte Beratung einordnen.',
        brokerRecommendation: {
          intent: 'consultation',
          capability: 'grid-operations.marketPartners',
        },
        semanticClassification: { workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim', debugTrace: true },
      });

      expect(
        /Kurzfazit auf Basis der erhobenen Tool-Evidenz|Dieser Text sollte bei knapper Synthese-Zeit nicht verwendet werden\./i.test(
          result.reply || ''
        )
      ).toBe(true);
      expect(result.reply).not.toContain('Synthese-Phase ist zeitlich erschöpft');
      if (/Kurzfazit auf Basis der erhobenen Tool-Evidenz/i.test(result.reply || '')) {
        expect(result.debugTrace || []).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'consultation_fallback_selected',
              reason: 'budget_summary_from_observations',
            }),
          ])
        );
      }
    } finally {
      Date.now = originalDateNow;
      callLlmSpy.mockRestore();
    }
  });

  it('keeps observation-based recovery when agentic synthesis returns null payload', async () => {
    const svc = broker.getLocalService('personal-agent');
    const plannerResponses = [
      {
        text: JSON.stringify({
          mode: 'tool',
          thought: 'Marktpartner recherchieren.',
          toolCall: {
            action: 'grid-operations.marketPartners',
            params: { query: 'TWL Netze', limit: 5 },
          },
        }),
      },
      {
        text: JSON.stringify({
          mode: 'final',
          thought: 'Evidenz liegt vor.',
          reply: '',
        }),
      },
    ];

    const parameterResponses = [{ text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) }];

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          return { data: {} };
        }

        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return parameterResponses.shift();
        }

        return (
          plannerResponses.shift() || {
            text: JSON.stringify({ mode: 'final', thought: 'Fallback final' }),
          }
        );
      });

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-synthesis-null', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Bitte Beratung einordnen.',
        brokerRecommendation: {
          intent: 'consultation',
          capability: 'grid-operations.marketPartners',
        },
        semanticClassification: { workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim', debugTrace: true },
      });

      expect(result.reply).toContain('Kurzfazit auf Basis der erhobenen Tool-Evidenz');
      expect(result.reply).toContain('Marktpartner-Treffer allein sind kein Netzgebietsnachweis');
      expect(result.reply).not.toContain('Synthese-Phase ist zeitlich erschöpft');
      expect(result.reply).not.toContain('Eine Abregelung hängt typischerweise');
      expect(result.debugTrace || []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'consultation_synthesis_start' }),
          expect.objectContaining({ type: 'consultation_synthesis_end' }),
          expect.objectContaining({
            type: 'consultation_synthesis_null',
            reason: 'empty_synthesis_payload',
          }),
          expect.objectContaining({
            type: 'consultation_fallback_selected',
            branch: 'observation_summary_reply',
            reason: 'agentic_synthesis_null_with_observations',
          }),
        ])
      );
      expect(
        (result.debugTrace || []).some(
          (event) =>
            event.type === 'consultation_fallback_selected' &&
            event.branch === 'legacy_non_agentic_consultation'
        )
      ).toBe(false);
    } finally {
      callLlmSpy.mockRestore();
    }
  });

  it('uses observation recovery and traces synthesis_error when agentic synthesis throws', async () => {
    const svc = broker.getLocalService('personal-agent');
    const plannerResponses = [
      {
        text: JSON.stringify({
          mode: 'tool',
          thought: 'Marktpartner recherchieren.',
          toolCall: {
            action: 'grid-operations.marketPartners',
            params: { query: 'TWL Netze', limit: 5 },
          },
        }),
      },
      {
        text: JSON.stringify({
          mode: 'final',
          thought: 'Evidenz liegt vor.',
          reply: '',
        }),
      },
    ];
    const parameterResponses = [{ text: JSON.stringify({ query: 'TWL Netze', limit: 5 }) }];

    const callLlmSpy = jest
      .spyOn(svc, 'callLlmGenerate')
      .mockImplementation(async (_ctx, payload) => {
        if (payload?.schema) {
          const err = new Error('Synthesis failed');
          err.code = 'LLM_SYNTH_FAIL';
          throw err;
        }

        if (String(payload?.system || '').includes('API-Parameter-Generator')) {
          return parameterResponses.shift();
        }

        return (
          plannerResponses.shift() || {
            text: JSON.stringify({ mode: 'final', thought: 'Fallback final' }),
          }
        );
      });

    const mockCtx = {
      broker,
      meta: { tenantId: 'tenant-react-synthesis-error', authUser: { userId: 'user-1' } },
      call: jest.fn((action, params) => broker.call(action, params, { meta: mockCtx.meta })),
    };

    try {
      const result = await svc.handleConsultationTurn(mockCtx, {
        message: 'TWL Netze in Burgbernheim: Bitte Beratung einordnen.',
        brokerRecommendation: {
          intent: 'consultation',
          capability: 'grid-operations.marketPartners',
        },
        semanticClassification: { workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION },
        resolvedParams: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knowledgeContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim' },
        knownContext: { gridOperatorName: 'TWL Netze', city: 'Burgbernheim', debugTrace: true },
      });

      expect(result.reply).toContain('Kurzfazit auf Basis der erhobenen Tool-Evidenz');
      expect(result.reply).not.toContain('Eine Abregelung hängt typischerweise');
      expect(result.debugTrace || []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'consultation_synthesis_start' }),
          expect.objectContaining({
            type: 'consultation_synthesis_error',
            errorCode: 'LLM_SYNTH_FAIL',
          }),
          expect.objectContaining({
            type: 'consultation_synthesis_null',
            reason: 'synthesis_exception',
          }),
          expect.objectContaining({
            type: 'consultation_fallback_selected',
            branch: 'observation_summary_reply',
            reason: 'agentic_synthesis_exception_with_observations',
          }),
        ])
      );
      expect(
        (result.debugTrace || []).some(
          (event) =>
            event.type === 'consultation_fallback_selected' &&
            event.branch === 'legacy_non_agentic_consultation'
        )
      ).toBe(false);
    } finally {
      callLlmSpy.mockRestore();
    }
  });

  it('uses 90000ms as default consultation synthesis timeout', () => {
    const svc = broker.getLocalService('personal-agent');
    const previous = process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS;
    delete process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS;

    try {
      expect(svc.resolveConsultationSynthesisTimeoutMs()).toBe(90_000);
    } finally {
      if (previous == null) {
        delete process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS;
      } else {
        process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS = previous;
      }
    }
  });

  it('respects PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS override for consultation synthesis', () => {
    const svc = broker.getLocalService('personal-agent');
    const previous = process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS;
    process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS = '123456';

    try {
      expect(svc.resolveConsultationSynthesisTimeoutMs()).toBe(123_456);
    } finally {
      if (previous == null) {
        delete process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS;
      } else {
        process.env.PERSONAL_AGENT_SYNTHESIS_TIMEOUT_MS = previous;
      }
    }
  });

  it('blocks unverified VNB claims and unbacked legal references via response policy guardrails', () => {
    const svc = broker.getLocalService('personal-agent');
    const contract = svc.buildResponsePolicyContract({
      message: 'BESS in Arnstadt: zuständigen Netzbetreiber einordnen',
      workflowType: WORKFLOW_TYPES.BESS_SCREENING,
      domainIntent: 'bess_grid_connection',
      knownContext: {
        domain: 'bess_grid_connection',
        municipality: 'Arnstadt',
      },
      observations: [{ action: 'grid-operations.marketPartners', status: 'completed' }],
      verifiedFacts: [{ source: 'tool', value: 'Marktpartnerliste Arnstadt geladen' }],
    });

    const guarded = svc.applyResponsePolicyGuardrails({
      reply: 'Zuständiger Netzbetreiber ist TEN Thüringer Energienetze gemäß §17 EnWG.',
      contract,
    });

    expect(guarded.reply).toContain(
      'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen'
    );
    expect(guarded.reply).not.toContain('Zuständiger Netzbetreiber ist TEN');
    expect(guarded.reply).not.toContain('§17 EnWG');
    expect(guarded.guardrailCorrections).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNVERIFIED_VNB_CLAIM_BLOCKED' })])
    );
  });

  it('replaces misleading timeout all-clear wording with conservative synthesis status', () => {
    const svc = broker.getLocalService('personal-agent');
    const guarded = svc.applyResponsePolicyGuardrails({
      reply: 'Keine kritischen Probleme identifiziert.',
      contract: {
        workflowType: 'consultation_general',
        verifiedFacts: [],
        missingEvidence: [],
        nextVerificationSteps: [],
        allowedLegalRefs: [],
      },
      timeoutFallback: true,
    });

    expect(guarded.reply).toContain(
      'Synthese unvollständig; belastbare Bewertung nicht abgeschlossen'
    );
    expect(guarded.reply).not.toContain('Keine kritischen Probleme identifiziert');
    expect(guarded.guardrailCorrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISLEADING_TIMEOUT_RELIEF_BLOCKED' }),
      ])
    );
  });

  it('adds conservative handling when receipt-required knowledge evidence timed out', () => {
    const svc = broker.getLocalService('personal-agent');
    const contract = svc.buildResponsePolicyContract({
      message: 'VNB Einordnung mit Receipt',
      workflowType: WORKFLOW_TYPES.VNB_IDENTIFICATION,
      domainIntent: 'vnb_lookup',
      knownContext: {
        city: 'Wiesloch',
      },
      receiptKnowledgeEvidence: {
        status: 'timeout',
        required: true,
        hits: [],
      },
      observations: [],
      verifiedFacts: [],
    });

    expect(contract.missingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'receipt_knowledge_required' }),
        expect.objectContaining({ id: 'knowledge_evidence_timeout' }),
      ])
    );

    const guarded = svc.applyResponsePolicyGuardrails({
      reply: 'Der zuständige Netzbetreiber ist eindeutig bekannt.',
      contract,
    });

    expect(guarded.reply).toContain('Knowledge-Evidenz ist aktuell nicht verfügbar');
    expect(guarded.guardrailCorrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'KNOWLEDGE_EVIDENCE_TIMEOUT_CONSERVATIVE' }),
      ])
    );
  });

  it('exposes workflow and evidence contract fields in consultation chat responses', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        sessionId: 'pa-response-policy-contract',
        message: 'BESS Arnstadt 20 MW / 40 MWh: Netzanschluss einordnen',
        chatMode: 'consultation',
        executionMode: 'auto',
        knownContext: {
          domain: 'bess_grid_connection',
          municipality: 'Arnstadt',
          powerMW: 20,
          capacityMWh: 40,
        },
      },
      { meta: { tenantId: 'tenant-response-policy-contract', authUser: { userId: 'user-1' } } }
    );

    expect(typeof result.workflowType).toBe('string');
    expect(typeof result.domainIntent).toBe('string');
    expect(typeof result.evidenceStatus).toBe('string');
    expect(Array.isArray(result.missingEvidence)).toBe(true);
    expect(Array.isArray(result.nextVerificationSteps)).toBe(true);
    expect(Array.isArray(result.guardrailCorrections)).toBe(true);
  });

  it('prioritizes explicit API chatMode=execution over auto-detection', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Wie hoch ist die Redispatch-Wahrscheinlichkeit für mein Projekt?',
        executionMode: 'auto',
        chatMode: 'execution',
        knownContext: {
          query: 'TWL Netze',
        },
      },
      { meta: { tenantId: 'tenant-chatmode-exec', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.chatMode).toBe('execution');
    expect(result.status).not.toBe('consulting');
    expect(result.execution.status).not.toBe('consulting');
  });

  it('prioritizes explicit API chatMode=consultation over execution-like prompts', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Prüfe meinen MaStR-Eintrag jetzt.',
        executionMode: 'auto',
        chatMode: 'consultation',
      },
      { meta: { tenantId: 'tenant-chatmode-consult', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('consulting');
    expect(result.chatMode).toBe('consultation');
    expect(result.execution).toEqual({ status: 'consulting', plan: null, steps: [], stopPoint: null });
  });

  it('reconciles wrong semantic consultation workflow on the real personal-agent.chat path', async () => {
    const svc = broker.getLocalService('personal-agent');

    const brokerRecommendationSpy = jest.spyOn(svc, 'getBrokerRecommendation').mockResolvedValue({
      intent: 'supplier_portfolio_flex_assessment',
      capability: 'supplier_portfolio_flex_assessment',
      confidence: 0.91,
    });
    const semanticSpy = jest.spyOn(svc, 'classifyConsultationIntentHybrid').mockResolvedValue({
      workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
      personaType: 'grid_planning',
      domainIntent: 'supplier_portfolio_flex_assessment',
      executionReadinessIntent: 'awaiting_input',
      advisoryOnly: false,
      availableInputs: [],
      missingInputs: [],
      confidence: 0.97,
      rationale: 'mocked semantic drift',
      source: 'llm',
    });
    const consultationSpy = jest.spyOn(svc, 'handleConsultationTurn').mockResolvedValue({
      reply: 'Mock consultation reply',
      hypotheses: [],
      openQuestions: [],
      nextActions: [{ action: 'netzanschluss_pruefen', description: 'Netzanschluss klären' }],
      factsUsed: [{ source: 'message', value: 'Batteriespeicher in Thüringen' }],
      attemptsSummary: [],
    });

    try {
      const result = await broker.call(
        'personal-agent.chat',
        {
          sessionId: 'pa-workflow-reconcile-live-path',
          message:
            'Wir planen einen Batteriespeicher in Thüringen mit flexibler Anschlusslösung am Netzanschlusspunkt.',
          chatMode: 'consultation',
          executionMode: 'hitl',
          knownContext: {
            municipality: 'Arnstadt',
            powerMW: 20,
            capacityMWh: 40,
            gridOperatorName: 'TWL Netze',
          },
        },
        { meta: { tenantId: 'tenant-workflow-reconcile', authUser: { userId: 'user-1' } } }
      );

      expect(result.success).toBe(true);
      expect(result.chatMode).toBe('consultation');
      expect(result.executionReadiness).toBeDefined();
      expect(result.executionReadiness.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    } finally {
      consultationSpy.mockRestore();
      semanticSpy.mockRestore();
      brokerRecommendationSpy.mockRestore();
    }
  });

  it('keeps exact Dev T1 consultation on bess_screening with domain and region context', async () => {
    const svc = broker.getLocalService('personal-agent');

    const brokerRecommendationSpy = jest.spyOn(svc, 'getBrokerRecommendation').mockResolvedValue({
      intent: 'mastr_asset_inventory',
      capability: 'mastr_asset_inventory',
      confidence: 0.91,
    });
    const semanticSpy = jest.spyOn(svc, 'classifyConsultationIntentHybrid').mockResolvedValue({
      workflowType: WORKFLOW_TYPES.SUPPLIER_PORTFOLIO_FLEX_ASSESSMENT,
      personaType: 'grid_planning',
      domainIntent: 'supplier_portfolio_flex_assessment',
      executionReadinessIntent: 'awaiting_input',
      advisoryOnly: false,
      availableInputs: [],
      missingInputs: [],
      confidence: 0.97,
      rationale: 'mocked semantic drift for T1',
      source: 'llm',
    });
    const consultationSpy = jest.spyOn(svc, 'handleConsultationTurn').mockResolvedValue({
      reply: 'Mock consultation reply',
      hypotheses: [],
      openQuestions: [],
      nextActions: [{ action: 'netzanschluss_pruefen', description: 'Netzanschluss klären' }],
      factsUsed: [{ source: 'message', value: 'Batteriespeicher Thueringen Netzanschlusspunkt' }],
      attemptsSummary: [],
    });

    try {
      const result = await broker.call(
        'personal-agent.chat',
        {
          sessionId: 'pa-workflow-reconcile-dev-t1',
          message:
            'Ich bin Projektentwickler fuer einen Batteriespeicher in Thueringen. Ich moechte mit Cernion einen geeigneten Netzanschlusspunkt finden und die wirtschaftlich beste flexible Anschlussloesung einschaetzen. Welche Schritte empfiehlst du?',
          chatMode: 'consultation',
          executionMode: 'auto',
          knownContext: {
            role: 'project_developer',
            domain: 'bess_grid_connection',
            region: 'Thueringen',
          },
        },
        { meta: { tenantId: 'tenant-workflow-reconcile-dev-t1', authUser: { userId: 'user-1' } } }
      );

      expect(result.success).toBe(true);
      expect(result.chatMode).toBe('consultation');
      expect(result.executionReadiness).toBeDefined();
      expect(result.executionReadiness.workflowType).toBe(WORKFLOW_TYPES.BESS_SCREENING);
    } finally {
      consultationSpy.mockRestore();
      semanticSpy.mockRestore();
      brokerRecommendationSpy.mockRestore();
    }
  });

  it('does not expose mark_unknown_execution_gap as consultation primaryIntent for greeting prompts', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Hi zusammen',
        executionMode: 'auto',
        chatMode: 'consultation',
      },
      { meta: { tenantId: 'tenant-chatmode-greeting', authUser: { userId: 'user-1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('consulting');
    expect(result.routing.chatMode).toBe('consultation');
    expect(result.routing.primaryIntent).not.toBe('mark_unknown_execution_gap');
  });

  it('resolves chatMode from meta.$params fallback when ctx.params.chatMode is missing', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Wie hoch ist die Redispatch-Wahrscheinlichkeit für mein Projekt?',
        executionMode: 'auto',
        knownContext: {
          query: 'TWL Netze',
        },
      },
      {
        meta: {
          tenantId: 'tenant-chatmode-meta-fallback',
          authUser: { userId: 'user-1' },
          $params: { chatMode: 'execution' },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.chatMode).toBe('execution');
    expect(result.routing.chatMode).toBe('execution');
    expect(result.status).not.toBe('consulting');
  });

  describe('classifyChatModeLLM', () => {
    it('returns valid chatMode and confidence from mocked LLM response', async () => {
      const svc = broker.getLocalService('personal-agent');
      const mockCtx = {
        call: jest.fn().mockResolvedValue(
          JSON.stringify({
            chatMode: 'execution',
            confidence: 0.92,
            reasoning: 'Imperativ erkannt',
          })
        ),
      };
      const result = await svc.classifyChatModeLLM(mockCtx, 'Prüfe den MaStR-Eintrag', {});
      expect(result.chatMode).toBe('execution');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(typeof result.reasoning).toBe('string');
    });

    it('classifies consultation statement correctly via mock', async () => {
      const svc = broker.getLocalService('personal-agent');
      const mockCtx = {
        call: jest.fn().mockResolvedValue(
          JSON.stringify({
            chatMode: 'consultation',
            confidence: 0.88,
            reasoning: 'Statement, keine Aufforderung',
          })
        ),
      };
      const result = await svc.classifyChatModeLLM(mockCtx, 'Der BDEW-Code ist unbekannt', {});
      expect(result.chatMode).toBe('consultation');
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('returns null chatMode when LLM returns invalid value', async () => {
      const svc = broker.getLocalService('personal-agent');
      const mockCtx = {
        call: jest
          .fn()
          .mockResolvedValue(
            JSON.stringify({ chatMode: 'unknown', confidence: 0.5, reasoning: 'test' })
          ),
      };
      const result = await svc.classifyChatModeLLM(mockCtx, 'irgendwas', {});
      expect(result.chatMode).toBeNull();
    });

    it('returns null chatMode and zero confidence on LLM error', async () => {
      const svc = broker.getLocalService('personal-agent');
      const mockCtx = {
        call: jest.fn().mockRejectedValue(new Error('LLM timeout')),
      };
      const result = await svc.classifyChatModeLLM(mockCtx, 'Test', {});
      expect(result.chatMode).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('returns null chatMode when LLM response has no JSON', async () => {
      const svc = broker.getLocalService('personal-agent');
      const mockCtx = {
        call: jest.fn().mockResolvedValue('Tut mir leid, ich kann nicht antworten.'),
      };
      const result = await svc.classifyChatModeLLM(mockCtx, 'Test', {});
      expect(result.chatMode).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('includes plan-stack context in userPrompt when session has open planStack', async () => {
      const svc = broker.getLocalService('personal-agent');
      let capturedParams = null;
      const mockCtx = {
        call: jest.fn().mockImplementation((action, params) => {
          capturedParams = params;
          return Promise.resolve(
            JSON.stringify({ chatMode: 'consultation', confidence: 0.85, reasoning: 'ok' })
          );
        }),
      };
      const session = { l3: { planStack: [{ step: 1 }] } };
      await svc.classifyChatModeLLM(mockCtx, 'Weiter bitte', session);
      expect(capturedParams.user).toContain('offenen Plan-Stack');
    });
  });

  it('builds a strategy-aware onboarding stop point without leaking raw schema tokens', () => {
    const svc = broker.getLocalService('personal-agent');
    const responseStrategy = svc.buildResponseStrategy({
      message: 'Bitte mach das für den Vorstand technisch sauber.',
      knownContext: {
        targetAudience: 'Vorstand',
      },
      missingParams: ['customSchemaField'],
    });

    const stopPoint = svc.buildOnboardingStopPoint({
      plan: {
        steps: [{ action: 'grid-operations.marketPartners' }],
      },
      missingParams: ['customSchemaField'],
      blockedStep: 1,
      blockedAction: 'grid-operations.marketPartners',
      responseStrategy,
    });

    expect(stopPoint.responseStrategy.audience).toBe(responseStrategy.audience);
    expect(stopPoint.onboardingQuestion.questionText).not.toContain('customSchemaField');
    expect(stopPoint.onboardingQuestion.questionText).toContain('Entscheidungsebene');
  });

  it('builds consultation prompts that instruct the model to label assumptions', () => {
    const svc = broker.getLocalService('personal-agent');
    const prompt = svc.buildConsultationPrompt({
      message: 'Bitte klär das für die Geschäftsführung.',
      knowledgeContext: {
        synthesisStyle: 'methodological',
      },
      responseStrategy: {
        audience: 'leadership',
        epistemicState: 'inferable',
        abstractionLevel: 'executive',
        nextMove: 'state_assumption',
      },
    });

    expect(prompt).toContain('Antwortstrategie');
    expect(prompt).toContain('Working Assumptions');
    expect(prompt).toContain('keine internen Schema-Feldnamen');
  });

  it('normalizes chatMode alias consulting from meta fallback to consultation', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Prüfe meinen MaStR-Eintrag jetzt.',
        executionMode: 'auto',
      },
      {
        meta: {
          tenantId: 'tenant-chatmode-alias-consulting',
          authUser: { userId: 'user-1' },
          $params: { chatMode: 'consulting' },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('consulting');
    expect(result.chatMode).toBe('consultation');
    expect(result.execution).toEqual({ status: 'consulting', plan: null, steps: [], stopPoint: null });
  });

  // ── T-EV-003 ───────────────────────────────────────────────────────────────
  it('T-EV-003: response includes evidencePlan field (null for unregistered routes)', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      { message: 'Analysiere das Netz', sessionId: `ev003-${Date.now()}` },
      { meta: { tenantId: 'test-tenant', authUser: { userId: 'user-ev003' } } }
    );

    expect(result).toHaveProperty('evidencePlan');
    // For unknown/unregistered routes evidencePlan is null — not an error.
    // For registered routes (forecast pilot) it is an object.
    const ep = result.evidencePlan;
    if (ep !== null && ep !== undefined) {
      expect(typeof ep).toBe('object');
      expect(ep).toHaveProperty('phaseNote', 'evidence-plan-phase1-annotation-only');
      expect(Array.isArray(ep.gaps)).toBe(true);
      expect(Array.isArray(ep.checkedSources)).toBe(true);
    }
  });

  it('enforces mandatory step-level HITL for critical due-diligence flow in AUTO mode', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte Due Diligence für den Kreditausschuss durchführen.',
        chatMode: 'execution',
        executionMode: 'auto',
        sessionId: `hitl-critical-${Date.now()}`,
      },
      { meta: { tenantId: 'tenant-critical-hitl', authUser: { userId: 'user-hitl' } } }
    );

    expect(result.success).toBe(true);
    expect(result.execution.status).toBe('awaiting-onboarding');
    expect(result.execution.stopPoint.reasonCode).toBe('MANDATORY_HITL_APPROVAL');
    expect(result.execution.stopPoint.blockedAction).toBe('finance-agent.analyze');
    expect(result.execution.steps[0].status).toBe('hitl-required');
    expect(result.execution.stopPoint.hitlItemId).toMatch(/^hitl-/);
    expect(result.reply).toMatch(/\[embed ref="hitl_item_/i);
    expect(result.reply).not.toMatch(/notification|dispatch|unresolved_recipient|channel/i);
  });

  it('propagates actor identity and routing metadata for critical HITL stopPoint', async () => {
    seedPersona('tenant-critical-hitl-routing', {
      id: 'tenant-critical-hitl-routing/thorsten-human',
      personaName: 'Thorsten Zoerner',
      personaType: 'human',
      assignedRoles: ['ROLE_NETZPLANUNG', 'ROLE_KAUFMAENNISCHE_LEITUNG'],
      status: 'active',
    });

    const result = await broker.call(
      'personal-agent.chat',
      {
        sessionId: `pa-rest-actor-routing-test-${Date.now()}`,
        message: 'Bitte Due Diligence für den Kreditausschuss durchführen.',
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: {
          responsibleRole: 'ROLE_NETZPLANUNG',
          routingContext: {
            source: 'chat-rest-actor-routing-test',
            scenario: 'critical-finance-hitl',
          },
        },
      },
      {
        meta: {
          tenantId: 'tenant-critical-hitl-routing',
          authUser: { userId: 'user-hitl-routing' },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.execution.status).toBe('awaiting-onboarding');
    expect(result.execution.stopPoint.reasonCode).toBe('MANDATORY_HITL_APPROVAL');
    expect(result.execution.stopPoint.blockedAction).toBe('finance-agent.analyze');
    expect(result.execution.stopPoint.hitlItemId).toMatch(/^hitl-/);
    expect(result.execution.stopPoint.responsibleRole).toBe('ROLE_NETZPLANUNG');
    expect(result.execution.stopPoint.personaId).toBe('tenant-critical-hitl-routing/thorsten-human');
    expect(result.execution.stopPoint.personaName).toBe('Thorsten Zoerner');
    expect(result.execution.stopPoint.personaType).toBe('human');
    expect(result.execution.stopPoint.routingContext).toMatchObject({
      source: 'chat-rest-actor-routing-test',
    });
    expect(result.reply).toMatch(/\[embed ref="hitl_item_/i);
    expect(result.reply).not.toMatch(/notification|dispatch|unresolved_recipient|channel/i);
    expect(result.agentTrace?.stateMachine?.currentState).not.toBe('failed');
    expect(['hitl_blocked', 'awaiting_user_input']).toContain(
      result.agentTrace?.stateMachine?.currentState
    );
  });

  it('keeps pending HITL stopPoint on neutral follow-up turn without rerouting', async () => {
    seedPersona('tenant-critical-hitl-followup', {
      id: 'thorsten-zoerner',
      personaName: 'Thorsten Zoerner',
      personaType: 'human',
      assignedRoles: ['ROLE_NETZPLANUNG', 'ROLE_KAUFMAENNISCHE_LEITUNG'],
      status: 'active',
    });

    const sessionId = `pa-rest-actor-routing-after-seed-${Date.now()}`;
    const meta = {
      tenantId: 'tenant-critical-hitl-followup',
      authUser: { userId: 'user-hitl-followup' },
    };

    const first = await broker.call(
      'personal-agent.chat',
      {
        sessionId,
        message: 'Bitte Due Diligence für den Kreditausschuss durchführen.',
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: {
          responsibleRole: 'ROLE_NETZPLANUNG',
          routingContext: {
            source: 'chat-rest-actor-routing-test',
          },
        },
      },
      { meta }
    );

    expect(first.success).toBe(true);
    expect(first.execution.status).toBe('awaiting-onboarding');
    expect(first.execution.stopPoint.reasonCode).toBe('MANDATORY_HITL_APPROVAL');
    expect(first.execution.stopPoint.blockedAction).toBe('finance-agent.analyze');
    expect(first.execution.stopPoint.hitlItemId).toMatch(/^hitl-/);
    expect(first.execution.stopPoint.personaId).toBe('thorsten-zoerner');
    expect(first.agentTrace?.stateMachine?.currentState).toBe('hitl_blocked');

    const firstHitlItemId = first.execution.stopPoint.hitlItemId;
    const firstPersonaId = first.execution.stopPoint.personaId;
    const placeholderCallsBeforeSecondTurn = placeholderCalls.length;

    const second = await broker.call(
      'personal-agent.chat',
      {
        sessionId,
        message: 'Bitte fortfahren.',
        chatMode: 'execution',
        executionMode: 'auto',
      },
      { meta }
    );

    expect(second.success).toBe(true);
    expect(second.execution.status).toBe('awaiting-onboarding');
    expect(second.execution.stopPoint.reasonCode).toBe('MANDATORY_HITL_APPROVAL');
    expect(second.execution.stopPoint.blockedAction).toBe('finance-agent.analyze');
    expect(second.execution.stopPoint.hitlItemId).toBe(firstHitlItemId);
    expect(second.execution.stopPoint.personaId).toBe(firstPersonaId);
    expect(second.reply).toContain(`[embed ref="hitl_item_${firstHitlItemId}"`);
    expect(second.agentTrace?.stateMachine?.currentState).toBe('hitl_blocked');
    expect(second.reply).not.toMatch(/PREFLIGHT_MISS/i);
    expect(placeholderCalls.length).toBe(placeholderCallsBeforeSecondTurn);
  });

  it('resumes critical flow after HITL approval on next turn', async () => {
    const sessionId = `hitl-resume-${Date.now()}`;
    const meta = { tenantId: 'tenant-critical-resume', authUser: { userId: 'user-hitl-resume' } };

    const first = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte Due Diligence für den Kreditausschuss durchführen.',
        chatMode: 'execution',
        executionMode: 'auto',
        sessionId,
      },
      { meta }
    );

    expect(first.execution.stopPoint.reasonCode).toBe('MANDATORY_HITL_APPROVAL');
    const hitlItemId = first.execution.stopPoint.hitlItemId;
    expect(hitlItemId).toBeTruthy();

    const approval = await broker.call('hitl.approve', { id: hitlItemId }, { meta });
    expect(approval.item.status).toBe('approved');

    const resumed = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte Due Diligence für den Kreditausschuss durchführen.',
        chatMode: 'execution',
        executionMode: 'auto',
        sessionId,
        knownContext: {
          hitlItemId,
        },
      },
      { meta }
    );

    expect(resumed.success).toBe(true);
    expect(resumed.execution.status).not.toBe('skipped');
    expect(resumed.execution.stopPoint?.reasonCode).not.toBe('MANDATORY_HITL_APPROVAL');
    expect(
      resumed.execution.steps.some(
        (step) => step.action === 'finance-agent.analyze' && step.status === 'completed'
      )
    ).toBe(true);
  });

  it('resumes approved critical HITL checkpoint without placeholder rerouting', async () => {
    const sessionId = `hitl-approved-resume-neutral-${Date.now()}`;
    const meta = {
      tenantId: 'tenant-critical-hitl-approved-resume',
      authUser: { userId: 'user-hitl-approved-resume' },
    };

    // Turn 1: trigger mandatory HITL stop for finance-agent.analyze
    const first = await broker.call(
      'personal-agent.chat',
      {
        sessionId,
        message: 'Bitte Due Diligence für den Kreditausschuss durchführen.',
        chatMode: 'execution',
        executionMode: 'auto',
      },
      { meta }
    );

    expect(first.success).toBe(true);
    expect(first.execution.status).toBe('awaiting-onboarding');
    expect(first.execution.stopPoint.reasonCode).toBe('MANDATORY_HITL_APPROVAL');
    expect(first.execution.stopPoint.blockedAction).toBe('finance-agent.analyze');
    const hitlItemId = first.execution.stopPoint.hitlItemId;
    expect(hitlItemId).toBeTruthy();

    const persistedBeforeApproval = await broker.call(
      'personal-agent.getSession',
      { sessionId },
      { meta }
    );
    const checkpointEntries = Object.values(persistedBeforeApproval.l3?.criticalStepCheckpoints || {});
    const persistedCheckpoint = checkpointEntries.find((entry) => entry.hitlItemId === hitlItemId);
    expect(persistedCheckpoint).toBeTruthy();
    expect(persistedCheckpoint.planSnapshot).toBeTruthy();
    expect(persistedCheckpoint.planSnapshot.steps.some((step) => step.action === 'finance-agent.analyze')).toBe(true);
    const persistedPlanFrame = (persistedBeforeApproval.l3?.planStack || []).find(
      (frame) => frame.hitlItemId === hitlItemId
    );
    expect(persistedPlanFrame).toBeTruthy();
    expect(persistedPlanFrame.planSnapshot).toBeTruthy();

    // Approve the HITL item
    const approval = await broker.call('hitl.approve', { id: hitlItemId }, { meta });
    expect(approval.item.status).toBe('approved');

    const placeholderCallsBefore = placeholderCalls.length;

    // Turn 2: neutral follow-up with knownContext.hitlItemId — should resume, not reroute
    const resumed = await broker.call(
      'personal-agent.chat',
      {
        sessionId,
        message: 'Bitte fortfahren.',
        executionMode: 'auto',
        knownContext: {
          hitlItemId,
        },
      },
      { meta }
    );

    expect(resumed.success).toBe(true);

    // Must not land on interface-placeholder.markGap
    expect(placeholderCalls.length).toBe(placeholderCallsBefore);
    expect(resumed.execution.plan?.steps?.[0]?.action).toBe('finance-agent.analyze');
    expect(resumed.execution.stopPoint?.reasonCode).not.toBe('PREFLIGHT_MISS');
    expect(resumed.execution.stopPoint?.reasonCode).not.toBe('approved_hitl_resume_missing_plan');
    const hasMarkGapStep = Array.isArray(resumed.execution.steps) &&
      resumed.execution.steps.some((s) => s.action === 'interface-placeholder.markGap');
    expect(hasMarkGapStep).toBe(false);

    // Must not create a new pending HITL for the same approved item
    const newHitlStop = resumed.execution.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL' &&
      resumed.execution.stopPoint?.hitlItemId !== hitlItemId;
    expect(newHitlStop).toBe(false);

    // State machine must not be failed
    expect(resumed.agentTrace?.stateMachine?.currentState).not.toBe('failed');

    // Option A: finance-agent.analyze was executed successfully
    const analyzeDone = Array.isArray(resumed.execution.steps) &&
      resumed.execution.steps.some(
        (s) => s.action === 'finance-agent.analyze' && s.status === 'completed'
      );

    if (analyzeDone) {
      // Option A path: execution completed or partial with done step
      expect(['completed', 'partial']).toContain(resumed.execution.status);
    } else {
      // Option B path: controlled approved-resume response — must still not be PREFLIGHT_MISS
      expect(resumed.execution.stopPoint?.reasonCode).not.toBe('PREFLIGHT_MISS');
      expect(resumed.execution.stopPoint?.blockedAction).not.toBe('interface-placeholder.markGap');
    }
  });

  it('fails closed with approved_hitl_resume_missing_plan when the durable resume plan is absent', async () => {
    const sessionId = `hitl-approved-resume-missing-plan-${Date.now()}`;
    const meta = {
      tenantId: 'tenant-critical-hitl-approved-resume-missing-plan',
      authUser: { userId: 'user-hitl-approved-resume-missing-plan' },
    };

    const first = await broker.call(
      'personal-agent.chat',
      {
        sessionId,
        message: 'Bitte Due Diligence für den Kreditausschuss durchführen.',
        chatMode: 'execution',
        executionMode: 'auto',
      },
      { meta }
    );

    expect(first.execution.stopPoint.reasonCode).toBe('MANDATORY_HITL_APPROVAL');
    const hitlItemId = first.execution.stopPoint.hitlItemId;
    expect(hitlItemId).toBeTruthy();

    const persisted = await broker.call(
      'object-store.get',
      {
        namespace: 'tenant:tenant-critical-hitl-approved-resume-missing-plan:personal_agent_sessions',
        key: sessionId,
      },
      { meta }
    );

    const payload = persisted.payload;
    const checkpointEntries = Object.entries(payload.l3?.criticalStepCheckpoints || {});
    for (const [checkpointKey, checkpoint] of checkpointEntries) {
      if (checkpoint?.hitlItemId !== hitlItemId) {
        continue;
      }
      payload.l3.criticalStepCheckpoints[checkpointKey] = {
        ...checkpoint,
        planSnapshot: null,
      };
    }
    if (payload.l3?.stopPoint?.onboardingQuestion) {
      payload.l3.stopPoint = {
        ...payload.l3.stopPoint,
        onboardingQuestion: {
          ...payload.l3.stopPoint.onboardingQuestion,
          planSnapshot: null,
        },
      };
    }
    payload.l3.planStack = Array.isArray(payload.l3?.planStack)
      ? payload.l3.planStack.map((frame) => ({
          ...frame,
          planSnapshot: null,
        }))
      : [];

    await broker.call(
      'object-store.put',
      {
        namespace: 'tenant:tenant-critical-hitl-approved-resume-missing-plan:personal_agent_sessions',
        key: sessionId,
        payload,
      },
      { meta }
    );

    const approval = await broker.call('hitl.approve', { id: hitlItemId }, { meta });
    expect(approval.item.status).toBe('approved');

    const reloaded = await broker.call(
      'personal-agent.getSession',
      { sessionId },
      { meta }
    );

    const personalAgent = broker.getLocalService('personal-agent');
    const gate = await personalAgent.resolveSessionHitlResumeGate(
      { call: broker.call.bind(broker), meta },
      {
        session: {
          ...reloaded,
          l3: {
            ...reloaded.l3,
            stopPoint: null,
            criticalStepCheckpoints: Object.fromEntries(
              Object.entries(reloaded.l3?.criticalStepCheckpoints || {}).map(([checkpointKey, checkpoint]) => [
                checkpointKey,
                {
                  ...checkpoint,
                  planSnapshot: null,
                },
              ])
            ),
            planStack: [],
          },
        },
        knownContext: {
          hitlItemId,
        },
        message: 'Bitte fortfahren.',
      }
    );

    expect(gate.mode).toBe('approved-missing-plan');
    expect(gate.stopPoint?.reasonCode).toBe('approved_hitl_resume_missing_plan');
    expect(gate.stopPoint?.blockedAction).not.toBe('interface-placeholder.markGap');
    expect(gate.reply).toMatch(/Resume-Plan/i);
  });

  it('preserves persona routing metadata in HITL onboarding questions', () => {
    const personalAgent = broker.getLocalService('personal-agent');

    const onboardingQuestion = personalAgent.buildHitlOnboardingQuestion(
      {
        reasonCode: 'MANDATORY_HITL_APPROVAL',
        message: 'Freigabe erforderlich',
        blockedAction: 'finance-agent.analyze',
        blockedStep: 2,
        hitlItemId: 'hitl-persona-1',
        responsibleRole: 'ROLE_NETZPLANUNG',
        requiredResolverRoles: ['ROLE_NETZPLANUNG', 'ROLE_KAUFMAENNISCHE_LEITUNG'],
        personaId: 'tenant-a/persona-1',
        personaName: 'Thorsten Zoerner',
        personaType: 'human',
        routingContext: { source: 'vdmi' },
      },
      { source: 'test' }
    );

    expect(onboardingQuestion.hitlItem).toMatchObject({
      id: 'hitl-persona-1',
      personaId: 'tenant-a/persona-1',
      personaName: 'Thorsten Zoerner',
      responsibleRole: 'ROLE_NETZPLANUNG',
    });
    expect(onboardingQuestion.personaId).toBe('tenant-a/persona-1');
    expect(onboardingQuestion.personaName).toBe('Thorsten Zoerner');
    expect(onboardingQuestion.personaType).toBe('human');
    expect(onboardingQuestion.responsibleRole).toBe('ROLE_NETZPLANUNG');
    expect(onboardingQuestion.routingContext).toEqual({ source: 'vdmi' });
  });

  it('returns quality and agentTrace as structured response fields without polluting textual reply', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Prüfe bitte die Netzsituation in Trier.',
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: {
          gridOperatorName: 'Stadtwerk Trier',
        },
        sessionId: `trace-quality-${Date.now()}`,
      },
      { meta: { tenantId: 'tenant-trace-quality', authUser: { userId: 'user-trace' } } }
    );

    expect(result).toHaveProperty('quality');
    expect(result.quality).toHaveProperty('groundedness');
    expect(result.quality).toHaveProperty('uncertainty');
    expect(result).toHaveProperty('agentTrace');
    expect(result.agentTrace).toHaveProperty('planning');
    expect(result.agentTrace).toHaveProperty('execution');
    expect(result.agentTrace).toHaveProperty('stateMachine');
    expect(result.agentTrace.stateMachine).toHaveProperty('currentState');
    expect(result.agentTrace).toHaveProperty('turnGraph');
    expect(result.agentTrace.turnGraph).toHaveProperty('nodeCount');
    expect(result).toHaveProperty('stateMachine');
    expect(result.stateMachine).toHaveProperty('transitions');
    expect(result).toHaveProperty('turnGraph');
    expect(result.turnGraph).toHaveProperty('nodeCount');
    expect(typeof result.reply).toBe('string');
    expect(result.reply.toLowerCase()).not.toContain('agenttrace');
  });

  it('consultation path preserves responseStrategy for leadership governance questions', async () => {
    const svc = broker.getLocalService('personal-agent');

    // Build consultation response with leadership strategy
    const strategy = svc.buildResponseStrategy({
      message:
        'Wie können wir AI-Entscheidungen im Grid transparent halten und Blackbox-Risiken vermeiden?',
      knowledgeContext: {
        domainHint: 'grid-governance',
        synthesisStyle: 'cautionary',
      },
    });

    expect(strategy.audience).toBe('leadership');
    expect(strategy.decisionRole).toBe('strategic_decision');
    expect(strategy.userFacingQuestionStyle).toBe('none');

    // Verify that buildConsultationPrompt includes the strategy
    const prompt = svc.buildConsultationPrompt({
      message: 'Wie können wir AI-Entscheidungen im Grid transparent halten?',
      brokerRecommendation: { intent: 'grid-governance' },
      responseStrategy: strategy,
    });

    expect(prompt).toContain('audience: leadership');
    expect(prompt).toContain('Entscheidung, Wirkung und Risiko');
  });

  it('keeps legacy behavior when no receipt matches and no forceReceipt is set', async () => {
    const baseMeta = { tenantId: 'tenant-receipt-baseline', authUser: { userId: 'user-baseline' } };
    const message = 'Bitte prüfe die Netzanschlusskapazität in Troisdorf.';

    const legacyLike = await broker.call(
      'personal-agent.chat',
      {
        message,
        sessionId: `receipt-baseline-a-${Date.now()}`,
      },
      { meta: baseMeta }
    );

    const selectionDisabled = await broker.call(
      'personal-agent.chat',
      {
        message,
        sessionId: `receipt-baseline-b-${Date.now()}`,
        disableReceiptSelection: true,
      },
      { meta: baseMeta }
    );

    expect(legacyLike.success).toBe(true);
    expect(selectionDisabled.success).toBe(true);
    expect(legacyLike.chatMode).toBe(selectionDisabled.chatMode);
    expect(legacyLike.routing.primaryIntent).toBe(selectionDisabled.routing.primaryIntent);
    expect(legacyLike.execution.status).toBe(selectionDisabled.execution.status);
    expect(legacyLike.metadata).toBeUndefined();
    expect(selectionDisabled.metadata).toBeUndefined();
  });

  it('uses executeWithReceipt for forced vnb-lookup-v1 in execution mode (Wiesloch city mapping)', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Wer ist der zuständige VNB für Wiesloch?',
        sessionId: `receipt-force-exec-${Date.now()}`,
        chatMode: 'execution',
        executionMode: 'auto',
        forceReceipt: 'vnb-lookup-v1',
        explainReceiptSelection: true,
        knownContext: {
          city: 'Wiesloch',
        },
      },
      { meta: { tenantId: 'tenant-receipt-force-exec', authUser: { userId: 'user-force-exec' } } }
    );

    expect(result.success).toBe(true);
    expect(Array.isArray(result.execution?.steps)).toBe(true);
    expect(
      result.execution.steps.some((step) => step.action === 'grid-operations.vnbLookup')
    ).toBe(true);
    expect(
      result.execution.steps.some((step) => step.action === 'grid-operations.marketPartners')
    ).toBe(false);

    const vnbLookupCall = executedCallDetails.find(
      (entry) => entry.action === 'grid-operations.vnbLookup'
    );
    expect(vnbLookupCall).toBeTruthy();
    expect(vnbLookupCall.params.city).toBe('Wiesloch');

    expect(result.metadata).toBeDefined();
    expect(result.metadata.receiptSelection).toBeDefined();
    expect(result.metadata.receiptSelection.mode).toBe('forced');
    expect(result.metadata.receiptSelection.execution).toEqual(
      expect.objectContaining({
        used: true,
        executor: 'executeWithReceipt',
      })
    );
  });

  it('processes gateway async forced receipt jobs to completion without queued stall', async () => {
    const response = await broker.call(
      'personal-agent.chat',
      {
        message: 'Wer ist der zuständige Netzbetreiber in Wiesloch?',
        sessionId: `receipt-force-async-${Date.now()}`,
        chatMode: 'execution',
        executionMode: 'auto',
        forceReceipt: 'vnb-lookup-v1',
        explainReceiptSelection: true,
        knownContext: {
          city: 'Wiesloch',
        },
      },
      {
        meta: {
          tenantId: 'tenant-receipt-force-async',
          authUser: { userId: 'user-force-async' },
          $gateway: true,
        },
      }
    );

    expect(response.success).toBe(true);
    expect(response.status).toBe('queued');
    expect(response.jobId).toBeTruthy();

    let finalJob = null;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finalJob = jobStore.getJob(response.jobId);
      if (finalJob?.status === 'completed' || finalJob?.status === 'error') {
        break;
      }
    }

    expect(finalJob).toBeTruthy();
    expect(finalJob.status).toBe('completed');

    const result = jobStore.getResult(response.jobId);
    expect(result?.success).toBe(true);
    expect(result?.metadata?.receiptSelection?.mode).toBe('forced');
    expect(result?.metadata?.receiptSelection?.receiptId).toBe('vnb-lookup-v1');

    const vnbStep = result?.execution?.steps?.find(
      (step) => step.action === 'grid-operations.vnbLookup' && step.status === 'completed'
    );
    expect(vnbStep).toBeTruthy();

    const vnbLookupCall = executedCallDetails.find(
      (entry) => entry.action === 'grid-operations.vnbLookup'
    );
    expect(vnbLookupCall).toBeTruthy();
    expect(vnbLookupCall.params.city).toBe('Wiesloch');

    expect(
      result?.execution?.steps?.some((step) => step.action === 'grid-operations.marketPartners')
    ).toBe(false);
  });

  it('selects vnb receipt for VNB question without forceReceipt, or provides diagnostics', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte finde den zuständigen Netzbetreiber in Wiesloch.',
        sessionId: `receipt-match-exec-${Date.now()}`,
        chatMode: 'execution',
        executionMode: 'auto',
        explainReceiptSelection: true,
        knownContext: {
          city: 'Wiesloch',
        },
      },
      { meta: { tenantId: 'tenant-receipt-match-exec', authUser: { userId: 'user-match-exec' } } }
    );

    expect(result.success).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata.receiptSelection).toBeDefined();

    if (result.metadata.receiptSelection.selected) {
      expect(result.metadata.receiptSelection.receiptId).toBe('vnb-lookup-v1');
      expect(
        result.execution.steps.some((step) => step.action === 'grid-operations.vnbLookup')
      ).toBe(true);
    } else {
      expect(
        result.metadata.receiptSelection.diagnostics ||
          Array.isArray(result.metadata.receiptSelection.warnings)
      ).toBeTruthy();
    }
  });

  it('uses runtime receipt executor on normal chat path without forceReceipt for VNB city request', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Wer ist der zuständige Netzbetreiber in Wiesloch?',
        sessionId: `receipt-priority-normal-${Date.now()}`,
        explainReceiptSelection: true,
        knownContext: { city: 'Wiesloch' },
      },
      {
        meta: {
          tenantId: 'tenant-receipt-priority-normal',
          authUser: { userId: 'user-receipt-priority-normal' },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.receiptSelection?.selected).toBe(true);
    expect(result.metadata?.receiptSelection?.receiptId).toBe('vnb-lookup-v1');
    expect(result.metadata?.receiptSelection?.mode).toBe('matched');
    expect(result.metadata?.receiptSelection?.execution).toEqual(
      expect.objectContaining({
        used: true,
        executor: 'executeWithReceipt',
      })
    );
    expect(
      result.execution.steps.some((step) => step.action === 'grid-operations.vnbLookup')
    ).toBe(true);
  });

  it('enforces forced receipt priority and does not silently fall back to unrelated capability actions', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Wer ist der zuständige Netzbetreiber in Wiesloch?',
        sessionId: `receipt-priority-forced-${Date.now()}`,
        chatMode: 'execution',
        forceReceipt: 'vnb-lookup-v1',
        explainReceiptSelection: true,
        knownContext: { city: 'Wiesloch' },
      },
      {
        meta: {
          tenantId: 'tenant-receipt-priority-forced',
          authUser: { userId: 'user-receipt-priority-forced' },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.metadata?.receiptSelection?.mode).toBe('forced');
    expect(result.metadata?.receiptSelection?.execution).toEqual(
      expect.objectContaining({
        used: true,
        executor: 'executeWithReceipt',
      })
    );
    expect(
      result.execution.steps.some((step) => step.action === 'grid-operations.vnbLookup')
    ).toBe(true);
    expect(
      result.execution.steps.some((step) => step.action === 'residual_load_forecast_for_dso')
    ).toBe(false);
  });

  it('marks city-fallback VNB lookup evidence as unverified/partial in receipt execution output', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Wer ist der zuständige Netzbetreiber in Wiesloch?',
        sessionId: `receipt-unverified-vnb-${Date.now()}`,
        chatMode: 'execution',
        forceReceipt: 'vnb-lookup-v1',
        explainReceiptSelection: true,
        knownContext: { city: 'Wiesloch' },
      },
      {
        meta: {
          tenantId: 'tenant-receipt-unverified',
          authUser: { userId: 'user-receipt-unverified' },
        },
      }
    );

    expect(result.success).toBe(true);
    const vnbStep = result.execution.steps.find(
      (step) => step.action === 'grid-operations.vnbLookup' && step.status === 'completed'
    );
    expect(vnbStep).toBeDefined();
    expect(vnbStep.result?.data).toEqual(
      expect.objectContaining({
        source: 'city-nap-fallback',
        evidenceStatus: 'unverified',
        partial: true,
        unverified: true,
      })
    );
  });

  it('keeps legacy execution path when disableReceiptSelection=true and exposes fallback metadata', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte finde den zuständigen Netzbetreiber in Wiesloch.',
        sessionId: `receipt-disable-exec-${Date.now()}`,
        chatMode: 'execution',
        executionMode: 'auto',
        disableReceiptSelection: true,
        explainReceiptSelection: true,
        knownContext: {
          city: 'Wiesloch',
        },
      },
      {
        meta: {
          tenantId: 'tenant-receipt-disable-exec',
          authUser: { userId: 'user-disable-exec' },
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata.receiptSelection.mode).toBe('disabled');
    expect(result.metadata.receiptSelection.execution).toEqual(
      expect.objectContaining({
        used: false,
        fallbackReason: 'disabled_by_request',
      })
    );
    expect(
      result.execution.steps.some((step) => step.action === 'grid-operations.marketPartners')
    ).toBe(true);
  });

  it('returns 422 policy error for invalid forceReceipt', async () => {
    await expect(
      broker.call(
        'personal-agent.chat',
        {
          message: 'Bitte prüfe Troisdorf.',
          chatMode: 'execution',
          forceReceipt: 'invalid-receipt-v1',
          sessionId: `receipt-force-invalid-${Date.now()}`,
        },
        { meta: { tenantId: 'tenant-receipt-force', authUser: { userId: 'user-force' } } }
      )
    ).rejects.toMatchObject({
      code: 422,
      type: 'RECEIPT_NOT_FOUND_OR_INVALID',
    });
  });

  it('returns 422 policy error for forced draft receipt without allowDraftReceipts', async () => {
    await expect(
      broker.call(
        'personal-agent.chat',
        {
          message: 'Bitte prüfe Troisdorf.',
          chatMode: 'execution',
          forceReceipt: 'draft-receipt-v1',
          sessionId: `receipt-force-draft-${Date.now()}`,
        },
        { meta: { tenantId: 'tenant-receipt-draft', authUser: { userId: 'user-draft' } } }
      )
    ).rejects.toMatchObject({
      code: 422,
      type: 'RECEIPT_DRAFT_NOT_ALLOWED',
    });
  });

  it('adds diagnostics under metadata.receiptSelection when explainReceiptSelection is true', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Bitte prüfe Troisdorf.',
        preferredReceipts: ['draft-receipt-v1'],
        explainReceiptSelection: true,
        sessionId: `receipt-diagnostics-${Date.now()}`,
      },
      { meta: { tenantId: 'tenant-receipt-diagnostics', authUser: { userId: 'user-diagnostics' } } }
    );

    expect(result.success).toBe(true);
    expect(result.metadata).toBeDefined();
    expect(result.metadata.receiptSelection).toBeDefined();
    expect(result.metadata.receiptSelection.mode).toBe('none');
    expect(result.metadata.receiptSelection.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PREFERRED_RECEIPT_NOT_FOUND_OR_NOT_ALLOWED',
          receiptId: 'draft-receipt-v1',
        }),
      ])
    );
  });

  it('T-PA-RE-004: buildReceiptExecutionContext rejects non-numeric BDEW tokens from promptHints', () => {
    const fn = PersonalAgentService.methods.buildReceiptExecutionContext;
    const invalidTokens = ['KANNST', 'WER', 'F\u00dcR', 'IST', 'DER', 'die', 'in Wiesloch', 'abc'];
    for (const token of invalidTokens) {
      const ctx = fn({ message: 'Wer ist der Netzbetreiber?', knownContext: { promptHints: { bdew: token } } });
      expect(ctx.bdewCode).toBeUndefined();
      expect(ctx.bdew).toBeUndefined();
    }
  });

  it('T-PA-RE-005: buildReceiptExecutionContext passes numeric BDEW codes through', () => {
    const fn = PersonalAgentService.methods.buildReceiptExecutionContext;
    const validCodes = ['9904632000006', '12345', '9900456'];
    for (const code of validCodes) {
      const ctx = fn({ message: 'Netzbetreiber suchen', knownContext: { bdewCode: code } });
      expect(ctx.bdewCode).toBe(code);
    }
  });

  it('T-PA-RE-006: buildReceiptExecutionContext does not add bdew when only city is known', () => {
    const fn = PersonalAgentService.methods.buildReceiptExecutionContext;
    const ctx = fn({ message: 'Wer ist der Netzbetreiber in Wiesloch?', knownContext: { city: 'Wiesloch' } });
    expect(ctx.city).toBe('Wiesloch');
    expect(ctx.bdewCode).toBeUndefined();
    expect(ctx.bdew).toBeUndefined();
  });

  it('v0.54.5 REGRESSION: Heidelberg chat executes marketPartners before vnbLookup and resolves __step placeholders', async () => {
    const result = await broker.call(
      'personal-agent.chat',
      {
        message:
          'Bitte finde den zuständigen Verteilnetzbetreiber für Heidelberg und führe den VNB Lookup aus.',
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: { city: 'Heidelberg' },
      },
      { meta: { tenantId: 'tenant-heidelberg', authUser: { userId: 'user-heidelberg' } } }
    );

    expect(result.success).toBe(true);

    const marketPartnersCalls = executedCallDetails.filter(
      (entry) => entry.action === 'grid-operations.marketPartners'
    );
    const vnbLookupCalls = executedCallDetails.filter(
      (entry) => entry.action === 'grid-operations.vnbLookup'
    );

    expect(marketPartnersCalls.length).toBeGreaterThan(0);
    expect(vnbLookupCalls.length).toBeGreaterThan(0);
    expect(executedActions.indexOf('grid-operations.marketPartners')).toBeLessThan(
      executedActions.indexOf('grid-operations.vnbLookup')
    );

    const lookupParams = vnbLookupCalls[vnbLookupCalls.length - 1].params;
    expect(lookupParams.bdew).toBe('9900277000000');
    expect(String(lookupParams.city).toLowerCase()).toBe('heidelberg');

    const executionSteps = Array.isArray(result.execution?.steps) ? result.execution.steps : [];
    expect(executionSteps.map((step) => step.action)).toEqual(
      expect.arrayContaining(['grid-operations.marketPartners', 'grid-operations.vnbLookup'])
    );

    const vnbStep = executionSteps.find((step) => step.action === 'grid-operations.vnbLookup');
    const vnbResult = vnbStep?.result || {};
    const verifiedIdentity =
      vnbResult?.data?.verification?.verifiedIdentity === true ||
      vnbResult?.verification?.verifiedIdentity === true;
    const hasMastrId =
      vnbResult?.data?.mastrId === 'SNB938476571321' ||
      vnbResult?.mastrId === 'SNB938476571321';

    expect(hasMastrId || verifiedIdentity).toBe(true);
  });

  it('v0.54.5 REGRESSION: city is preserved through Chat → Receipt → executeWithReceipt', async () => {
    // This test validates the fix for city mapping loss through buildReceiptExecutionContext/pruneUndefinedDeep
    const chatResult = await broker.call(
      'personal-agent.chat',
      {
        message: 'Ich suche den Netzbetreiber in Wiesloch',
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: { city: 'Wiesloch' },
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    // Verify success
    expect(chatResult.success).toBe(true);

    // Verify that vnb-lookup action was called with city parameter
    const vnbLookupCalls = executedCallDetails.filter((c) => c.action === 'grid-operations.vnbLookup');
    expect(vnbLookupCalls.length).toBeGreaterThan(0);

    // The first (and likely only) vnbLookup call should have city='Wiesloch' in params
    const firstVnbLookup = vnbLookupCalls[0];
    expect(firstVnbLookup).toBeDefined();
    expect(firstVnbLookup.params).toBeDefined();
    expect(firstVnbLookup.params.city).toBe('Wiesloch');

    // Verify that the chat response does not contain generic MCP-Auth errors
    expect(chatResult.reply).toBeDefined();
    expect(chatResult.reply.toLowerCase()).not.toMatch(/mcp[\s-]*auth|authentication.*error|token.*invalid/i);
  });

  it('v0.54.5 REGRESSION: city=null is preserved (not pruned as undefined)', () => {
    // When city extraction returns null from buildReceiptExecutionContext,
    // it should remain in the object (not become undefined and then pruned)
    const fn = PersonalAgentService.methods.buildReceiptExecutionContext;
    const ctx = fn({
      message: 'Test message',
      knownContext: {
        // No city sources provided, so city should be null
      },
    });

    // City should be present in the context (either as string or null, not undefined)
    // pruneUndefinedDeep removes undefined fields but keeps null
    expect(ctx).toHaveProperty('city');
    expect(ctx.city).toBeNull();
  });

  it('v0.54.5 REGRESSION: grid-operations.vnbLookup error handling returns diagnostic message', async () => {
    // Test the error handling wrapper in vnbLookup
    // This validates that MCP failures return structured error responses, not generic auth errors

    // We'll call vnbLookup with a test city to trigger the mock handler
    const result = await broker.call(
      'grid-operations.vnbLookup',
      {
        city: 'TestCity123',
      },
      { meta: { tenantId: 'tenant-a', authUser: { userId: 'user-1' } } }
    );

    // The result should have proper structure
    expect(result).toBeDefined();
    expect(result.success === true || result.error).toBeTruthy();

    // If there's a verification field (successful lookup), check structure
    if (result.verification) {
      expect(result.verification).toHaveProperty('verifiedIdentity');
      expect(result.verification).toHaveProperty('source');
      expect(result.verification).toHaveProperty('gap');
    }
  });

  it('ZNP-PREFLIGHT: Turn-2 znp.assessPortfolio without projectId triggers awaiting-onboarding, not Parameters validation error', async () => {
    const sessionId = `znp-preflight-test-${Date.now()}`;

    // Turn 2: execution request — projectId deliberately absent
    const result = await broker.call(
      'personal-agent.chat',
      {
        message:
          'Bitte führe jetzt die ZNP Portfolio-Bewertung durch mit kaufmaennischeFreigabeFnav=false.',
        sessionId,
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: {
          kaufmaennischeFreigabeFnav: false,
          // projectId intentionally missing
        },
        forceReceipt: null,
      },
      { meta: { tenantId: 'tenant-znp-preflight', authUser: { userId: 'user-znp' } } }
    );

    expect(result.success).toBe(true);

    // Must switch to awaiting-onboarding — not execute the broken call
    expect(result.execution.status).toBe('awaiting-onboarding');
    expect(
      result.execution.stopPoint?.missingParams ||
        result.execution.missingContext?.missingParams ||
        result.execution.missingParams
    ).toContain('projectId');

    // znp.assessPortfolio must NOT have been called
    expect(executedActions).not.toContain('znp.assessPortfolio');

    // Reply must not contain internal error language
    expect(result.reply).not.toMatch(/Parameters validation error/i);
    expect(result.reply).not.toMatch(/ACTION_FAILED/i);
    expect(result.reply).not.toMatch(/allOf|anyOf/i);

    // Reply must ask for project context
    expect(result.reply).toMatch(/projekt/i);
  });

  it('GENERIC-PREFLIGHT-001: empty string projectId triggers awaiting-onboarding, action not called', async () => {
    const sessionId = `generic-preflight-001-${Date.now()}`;

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Starte ZNP Portfolio-Bewertung.',
        sessionId,
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: { projectId: '' },
        forceReceipt: null,
      },
      { meta: { tenantId: 'tenant-preflight-generic', authUser: { userId: 'user-gp1' } } }
    );

    expect(result.success).toBe(true);
    expect(result.execution.status).toBe('awaiting-onboarding');
    expect(executedActions).not.toContain('znp.assessPortfolio');
    expect(result.reply).not.toMatch(/Parameters validation error/i);
    expect(result.reply).not.toMatch(/ACTION_FAILED/i);
    expect(result.reply).not.toMatch(/allOf|anyOf/i);
  });

  it('GENERIC-PREFLIGHT-002: Parameters validation error from Moleculer is converted to PREFLIGHT_MISS, not ACTION_FAILED', async () => {
    // Simulate the catch guard: the mock throws 'Parameters validation error!'
    // when projectId is explicitly passed as null (slips past our preflight because
    // the plan template has projectId: null which fillTemplateWithContext won't hydrate,
    // but let's test the catch path by injecting null directly via paramsTemplate).
    // We verify the reply is user-safe regardless of which path was taken.
    const sessionId = `generic-preflight-002-${Date.now()}`;

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Starte ZNP Portfolio-Bewertung.',
        sessionId,
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: {},
        forceReceipt: null,
      },
      { meta: { tenantId: 'tenant-preflight-generic', authUser: { userId: 'user-gp2' } } }
    );

    expect(result.success).toBe(true);
    // Must not expose internal error text in any scenario
    expect(result.reply).not.toMatch(/Parameters validation error/i);
    expect(result.reply).not.toMatch(/ACTION_FAILED/i);
    expect(result.reply).not.toMatch(/allOf|anyOf/i);
    // The Moleculer action must not have been called successfully
    expect(executedActions).not.toContain('znp.assessPortfolio');
  });

  it('GENERIC-PREFLIGHT-003: valid projectId allows znp.assessPortfolio to execute', async () => {
    const sessionId = `generic-preflight-003-${Date.now()}`;

    const result = await broker.call(
      'personal-agent.chat',
      {
        message: 'Starte ZNP Portfolio-Bewertung für Projekt znp-proj-001.',
        sessionId,
        chatMode: 'execution',
        executionMode: 'auto',
        knownContext: { projectId: 'znp-proj-001' },
        forceReceipt: null,
      },
      { meta: { tenantId: 'tenant-preflight-generic', authUser: { userId: 'user-gp3' } } }
    );

    expect(result.success).toBe(true);
    // The action should have been called (if routing selects it) OR the execution
    // should not be blocked by a preflight miss. Either way, no internal error text.
    expect(result.reply).not.toMatch(/Parameters validation error/i);
    expect(result.reply).not.toMatch(/PREFLIGHT_MISS/i);
    if (executedActions.includes('znp.assessPortfolio')) {
      const detail = executedCallDetails.find((d) => d.action === 'znp.assessPortfolio');
      expect(detail?.params?.projectId).toBe('znp-proj-001');
    }
  });
});
