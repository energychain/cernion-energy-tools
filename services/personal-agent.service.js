'use strict';

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { getTenantId, tenantNamespace } = require('../src/tenant-context');
const {
  buildContextStack,
  buildPersistableSessionState,
  synthesizeAndPurgeLayer4,
  assertNoL4RawInPersistedState,
} = require('../src/personal-agent-context');
const {
  EXECUTION_MODES,
  normalizeExecutionMode,
  detectRequestedDomains,
  buildExecutionPlan,
  fillTemplateWithContext,
  pruneUndefinedDeep,
  getMissingInputs,
} = require('../src/personal-agent-routing');
const {
  queryKnowledgeOrientation: queryKnowledgeOrientationAdapter,
} = require('../src/personal-agent-knowledge-rag');
const {
  scheduleDream,
  cancelDream,
  isDreamPending,
  runDreamPipeline,
  DREAM_AUDIT_NAMESPACE,
} = require('../src/personal-agent-dreamer');
const {
  buildOnboardingQuestion,
  captureOnboardingAnswer,
  findPendingOnboardingQuestion,
  listAnsweredOnboardingFacts,
  markStaleQuestions,
  resolveParamKeyFromMissing,
} = require('../src/personal-agent-onboarding');
const {
  recognizeFileType,
  parseCsvExtract,
  parseExcelExtract,
  ocrExtractImage,
  extractDocumentText,
  injectFileIntoL3,
} = require('../src/personal-agent-file-handler');

const OPENAPI_TAG = 'Personal Agent';
const SESSION_NAMESPACE = process.env.PERSONAL_AGENT_SESSION_NAMESPACE || 'personal_agent_sessions';
const PROFILE_NAMESPACE =
  process.env.PERSONAL_AGENT_PROFILE_NAMESPACE || 'personal_agent_user_profiles';
const DEFAULT_SYSTEM_PROMPT =
  process.env.PERSONAL_AGENT_SYSTEM_PROMPT ||
  'Du bist der Cernion Personal Agent. Arbeite deterministisch, knapp und fachlich korrekt.';

function isNotFound(error) {
  return error?.code === 404 || error?.type === 'OBJECT_NOT_FOUND';
}

function isActionUnavailable(error) {
  return (
    error?.code === 404 ||
    error?.type === 'SERVICE_NOT_FOUND' ||
    error?.type === 'SERVICE_NOT_AVAILABLE' ||
    error?.type === 'SERVICE_SCHEMA_ERROR' ||
    error?.name === 'ServiceNotFoundError'
  );
}

module.exports = {
  name: 'personal-agent',

  settings: {
    maxContextTokens: Number(process.env.PERSONAL_AGENT_MAX_CONTEXT_TOKENS || 128_000),
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },

  actions: {
    chat: {
      rest: 'POST /chat',
      params: {
        message: { type: 'string', min: 1, trim: true, max: 8000 },
        sessionId: { type: 'string', optional: true, trim: true, max: 120 },
        toolContext: { type: 'object', optional: true },
        fileAttachments: {
          type: 'array',
          optional: true,
          items: {
            type: 'object',
            props: {
              attachmentId: { type: 'string', optional: true },
              fileName: { type: 'string', optional: true },
              mimeType: { type: 'string', optional: true },
              sizeBytes: { type: 'number', optional: true, convert: true },
              tempPath: { type: 'string', optional: true },
            },
          },
        },
        executionMode: {
          type: 'enum',
          optional: true,
          values: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL],
          default: EXECUTION_MODES.AUTO,
        },
        knownContext: { type: 'object', optional: true, default: {} },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Run one Personal-Agent chat turn with deterministic L0-L4 context stacking',
        description:
          'Builds a deterministic context stack (L0-L4), binds the capability-broker routing layer, supports auto-execution or HITL plan return, and guarantees Layer 4 purge after synthesis. ' +
          'Layer-4 raw tool JSON is never persisted.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', minLength: 1, maxLength: 8000, example: 'Plane eine neue PV-Anlage in Troisdorf.' },
                  sessionId: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
                  executionMode: { type: 'string', enum: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL], default: EXECUTION_MODES.AUTO },
                  toolContext: { type: 'object', additionalProperties: true, default: {} },
                  knownContext: { type: 'object', additionalProperties: true, default: {} },
                  fileAttachments: {
                    type: 'array',
                    example: [
                      {
                        attachmentId: 'att_7f3c2e9b',
                        fileName: 'netzanschluss-anfrage.pdf',
                        mimeType: 'application/pdf',
                        sizeBytes: 248731,
                        tempPath: '/tmp/uploads/tenant-default/session-pa_a1b2c3/att_7f3c2e9b.pdf',
                      },
                    ],
                    items: {
                      type: 'object',
                      properties: {
                        attachmentId: { type: 'string' },
                        fileName: { type: 'string' },
                        mimeType: { type: 'string' },
                        sizeBytes: { type: 'number' },
                        tempPath: { type: 'string' },
                      },
                    },
                  },
                },
              },
              examples: {
                auto: {
                  summary: 'AUTO execution with deterministic plan run',
                  value: {
                    message: 'Prüfe die Netzanschlusskapazität für Troisdorf.',
                    executionMode: EXECUTION_MODES.AUTO,
                    knownContext: { location: 'Troisdorf' },
                  },
                },
              },
            },
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string' },
                  sessionId: { type: 'string' },
                  executionMode: { type: 'string', enum: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL] },
                  knownContext: { type: 'string', description: 'JSON-stringified object' },
                  toolContext: { type: 'string', description: 'JSON-stringified object' },
                  fileAttachments: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Chat turn completed successfully',
            content: {
              'application/json': {
                examples: {
                  // Example 1: HITL Mode - Plan only returned
                  hitlPlanOnly: {
                    summary: 'HITL Mode: Plan returned for manual review',
                    value: {
                      success: true,
                      sessionId: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8',
                      executionMode: 'hitl',
                      reply: 'Ich habe einen 2-stufigen Plan entworfen. Sie können ihn überprüfen und dann manuell ausführen.',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 2850,
                        estimatedPromptTokens: 1200,
                        estimatedCompletionTokens: 1650,
                        maxTokens: 128000,
                        percentUsed: 2.2,
                      },
                      historyCount: 5,
                      routing: {
                        source: 'broker',
                        routeKey: null,
                        routeLabel: null,
                        primaryIntent: 'investment-analysis',
                        secondaryIntents: ['grid-planning', 'financial-modeling'],
                        requestedDomains: [],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'complete',
                        steps: [
                          {
                            stepId: 1,
                            action: 'finance-agent.analyze',
                            label: 'Investitionsanalyse',
                            params: {
                              gridOperator: 'Stadtwerke München',
                              investmentType: 'cable',
                              location: 'Schwabing',
                              plannedCapacityMW: 15,
                            },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'znp.assessPortfolio',
                            label: 'Portfolio-Assessment',
                            params: {
                              projectId: '__step_1.financialProjectId',
                              assumptions: { growthRate: 0.08, discountRate: 0.055 },
                            },
                            dependencies: [1],
                          },
                        ],
                      },
                      execution: {
                        status: 'skipped',
                        steps: [],
                        stopPoint: null,
                      },
                    },
                  },
                  awaitingOnboarding: {
                    summary: 'AUTO Mode: Awaiting onboarding answer',
                    value: {
                      success: true,
                      sessionId: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8',
                      executionMode: 'auto',
                      reply: 'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 2100,
                        estimatedPromptTokens: 1200,
                        estimatedCompletionTokens: 900,
                        maxTokens: 128000,
                        percentUsed: 1.6,
                      },
                      historyCount: 3,
                      routing: {
                        source: 'capability-broker',
                        routeKey: null,
                        routeLabel: 'grid_operator_identity_resolution',
                        primaryIntent: 'grid-connection.validate',
                        secondaryIntents: [],
                        requestedDomains: ['grid-connection'],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'partial',
                        steps: [
                          {
                            stepId: 1,
                            action: 'grid-connection.validate',
                            label: 'Netzanschluss Validierung',
                            params: { gridOperatorName: null },
                            dependencies: [],
                            blocked: true,
                          },
                        ],
                      },
                      execution: {
                        status: 'awaiting-onboarding',
                        completedSteps: 0,
                        steps: [],
                        stopPoint: {
                          reasonCode: 'MISSING_INPUTS',
                          blockedStep: 1,
                          blockedAction: 'grid-connection.validate',
                          missingParams: ['gridOperatorName'],
                          message: 'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
                          status: 'awaiting-onboarding',
                          onboardingQuestion: {
                            questionId: 'oq_abc123',
                            paramKey: 'gridOperatorName',
                            questionText: 'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
                            ts: '2026-05-15T14:20:00Z',
                            answeredAt: null,
                            answer: null,
                            status: 'pending',
                          },
                        },
                      },
                    },
                  },
                  // Example 2: AUTO Mode - Full execution success
                  autoFullSuccess: {
                    summary: 'AUTO Mode: Full execution completed',
                    value: {
                      success: true,
                      sessionId: 'pa_x9y8z7w6-v5u4-t3s2-r1q0-p9o8n7m6l5k4',
                      executionMode: 'auto',
                      reply: 'Die Investitionsanalyse ist abgeschlossen. Die Kosten betragen ca. 45.000 EUR mit einer Amortisationszeit von 8,2 Jahren bei 7% Rendite.',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 5420,
                        estimatedPromptTokens: 2100,
                        estimatedCompletionTokens: 3320,
                        maxTokens: 128000,
                        percentUsed: 4.2,
                      },
                      historyCount: 7,
                      routing: {
                        source: 'matrix',
                        routeKey: 'investment-grid',
                        routeLabel: 'Investment-Grid Integration',
                        primaryIntent: 'investment-grid-check',
                        secondaryIntents: [],
                        requestedDomains: ['investment', 'grid'],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'complete',
                        steps: [
                          {
                            stepId: 1,
                            action: 'finance-agent.analyze',
                            label: 'NPV Analysis',
                            params: { gridOperator: 'TWL Netze', investmentType: 'transformer' },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'znp.assessPortfolio',
                            label: 'Grid Impact Assessment',
                            params: { projectId: '__step_1.projectId' },
                            dependencies: [1],
                          },
                        ],
                      },
                      execution: {
                        status: 'completed',
                        completedSteps: [1, 2],
                        steps: [
                          {
                            stepId: 1,
                            action: 'finance-agent.analyze',
                            result: {
                              npv: 125000,
                              irr: 0.092,
                              paybackYears: 8.2,
                              projectId: 'proj_invest_001',
                            },
                            timestamp: '2026-05-15T14:23:45Z',
                          },
                          {
                            stepId: 2,
                            action: 'znp.assessPortfolio',
                            result: {
                              gridStress: 0.68,
                              requiresExpansion: false,
                              recommendation: 'proceed',
                            },
                            timestamp: '2026-05-15T14:23:52Z',
                          },
                        ],
                        stopPoint: null,
                      },
                    },
                  },
                  // Example 3: AUTO Mode - Partial execution (missing inputs stop)
                  autoPartialMissingInputs: {
                    summary: 'AUTO Mode: Partial execution stopped at missing inputs',
                    value: {
                      success: true,
                      sessionId: 'pa_m5l4k3j2-i1h0-g9f8-e7d6-c5b4a3z2y1x0',
                      executionMode: 'auto',
                      reply: 'Ich habe die Energiefreigabe-Validierung gestartet, benötige aber noch die Projekt-ID. Können Sie bitte angeben, welches Projekt Sie prüfen möchten?',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 3100,
                        estimatedPromptTokens: 1500,
                        estimatedCompletionTokens: 1600,
                        maxTokens: 128000,
                        percentUsed: 2.4,
                      },
                      historyCount: 6,
                      routing: {
                        source: 'matrix',
                        routeKey: 'energy-sharing-znp',
                        routeLabel: 'Energy Sharing Validation + ZNP',
                        primaryIntent: 'energy-sharing-check',
                        secondaryIntents: [],
                        requestedDomains: ['energy-sharing', 'znp'],
                        unsupportedDomains: [],
                        warnings: [],
                      },
                      plan: {
                        status: 'partial',
                        steps: [
                          {
                            stepId: 1,
                            action: 'energy-sharing.validate',
                            label: 'Energiefreigabe Validierung',
                            params: {
                              gridOperatorId: 'GNB0000003456',
                              generators: [{ capacity: 50, location: 'München-Nord' }],
                            },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'znp.getProjectMeta',
                            label: 'ZNP Projekt Details',
                            params: {
                              projectId: '__user_input.projectId',
                            },
                            dependencies: [1],
                            blocked: true,
                          },
                        ],
                      },
                      execution: {
                        status: 'partial',
                        completedSteps: [1],
                        steps: [
                          {
                            stepId: 1,
                            action: 'energy-sharing.validate',
                            result: { status: 'eligible', findings: [] },
                            timestamp: '2026-05-15T14:20:10Z',
                          },
                        ],
                        stopPoint: {
                          reasonCode: 'MISSING_INPUTS',
                          blockedStep: 2,
                          blockedAction: 'znp.getProjectMeta',
                          missingParams: ['projectId'],
                          message: 'Step 2 blocked: requires projectId. Available aliases: project, projectName, projectCode.',
                          status: 'user-input-required',
                          placeholderId: 'placeholder_user_input_v1',
                        },
                      },
                    },
                  },
                  // Example 4: AUTO Mode - Partial execution (unsupported chain degradation)
                  autoPartialUnsupported: {
                    summary: 'AUTO Mode: Partial execution, unsupported chain degraded gracefully',
                    value: {
                      success: true,
                      sessionId: 'pa_n0o1p2q3-r4s5-t6u7-v8w9-x0y1z2a3b4c5',
                      executionMode: 'auto',
                      reply: 'Die Redispatch-Analyse ist abgeschlossen. Die Erweiterung auf die Speicherplanung ist in dieser Version nicht freigeschaltet – ich stelle Ihnen dafür ein Manual-Interface zur Verfügung.',
                      layer4Purged: true,
                      l3Compressed: false,
                      contextUsage: {
                        totalTokens: 3850,
                        estimatedPromptTokens: 1800,
                        estimatedCompletionTokens: 2050,
                        maxTokens: 128000,
                        percentUsed: 3.0,
                      },
                      historyCount: 6,
                      routing: {
                        source: 'broker',
                        routeKey: null,
                        routeLabel: null,
                        primaryIntent: 'redispatch-analysis',
                        secondaryIntents: ['storage-planning'],
                        requestedDomains: ['redispatch', 'storage'],
                        unsupportedDomains: ['storage'],
                        warnings: [
                          'Requested domain "storage" is not in the routing matrix for redispatch. Stopping after redispatch completion.',
                        ],
                      },
                      plan: {
                        status: 'partial',
                        steps: [
                          {
                            stepId: 1,
                            action: 'redispatch-expost.audit',
                            label: 'Redispatch Settlement Audit',
                            params: { gridOperatorId: 'SNB0000001234', minCapacityKW: 100 },
                            dependencies: [],
                          },
                          {
                            stepId: 2,
                            action: 'storage.optimizer',
                            label: 'Storage Optimization (UNSUPPORTED)',
                            params: {},
                            dependencies: [1],
                            blocked: true,
                          },
                        ],
                      },
                      execution: {
                        status: 'partial',
                        completedSteps: [1],
                        steps: [
                          {
                            stepId: 1,
                            action: 'redispatch-expost.audit',
                            result: {
                              status: 'ready',
                              portfolioSize: 247,
                              totalCapacity: 3560,
                              findings: [],
                            },
                            timestamp: '2026-05-15T14:18:30Z',
                          },
                        ],
                        stopPoint: {
                          reasonCode: 'UNSUPPORTED_CHAIN',
                          blockedStep: 2,
                          blockedAction: 'storage.optimizer',
                          message: 'Domain "storage" is not routable in deterministic chains. Interface placeholder activated for manual continuation.',
                          status: 'interface-placeholder',
                          placeholderId: 'placeholder_storage_gap_v1',
                          placeholderMetadata: {
                            title: 'Speicheroptimierung',
                            description: 'Manuelle Speicheroptimierung auf Basis des Redispatch-Audits erforderlich.',
                            suggestedNextSteps: [
                              'Laden Sie die Audit-Ergebnisse herunter',
                              'Nutzen Sie unser Storage-Analyse-Tool',
                              'Kontaktieren Sie unseren Speicher-Spezialisten',
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Bad request - invalid parameters or validation error',
          },
          404: {
            description: 'Service or action not found',
          },
          500: {
            description: 'Internal server error',
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const sessionId = String(ctx.params.sessionId || `pa_${crypto.randomUUID()}`);
        const executionMode = normalizeExecutionMode(ctx.params.executionMode);
        const session = await this.loadSession(ctx, tenantId, sessionId, userId, {
          createIfMissing: true,
        });
        const fileProcessing = this.processFileAttachments(
          session,
          Array.isArray(ctx.params.fileAttachments) ? ctx.params.fileAttachments : []
        );
        const userMessage = {
          role: 'user',
          text: ctx.params.message,
          ts: new Date().toISOString(),
        };
        const knownContext = { ...(ctx.params.knownContext || {}) };
        let knowledgeContext = await this.queryKnowledgeOrientation(ctx, {
          message: ctx.params.message,
          activeDomains: detectRequestedDomains(ctx.params.message),
        });
        const brokerKnownContext = this.attachKnowledgeHintsToKnownContext(
          knownContext,
          knowledgeContext
        );

        const brokerRecommendation = await this.getBrokerRecommendation(
          ctx,
          ctx.params.message,
          brokerKnownContext
        );
        const plan = buildExecutionPlan({
          message: ctx.params.message,
          brokerRecommendation,
          knowledgeContext,
        });
        const execution = await this.handleExecutionWithOnboarding(ctx, {
          message: ctx.params.message,
          plan,
          knownContext,
          session,
          executionMode,
        });
        const responsePlan = execution?.plan || plan;

        const stackResult = buildContextStack({
          systemPrompt: this.settings.systemPrompt,
          tenantFacts: session.l1?.tenantFacts || [],
          userProfile: session.l2?.userProfile || {},
          sessionHistory: [...(session.l3?.history || []), userMessage],
          fileAttachments: session.l3?.fileAttachments || [],
          toolContext: ctx.params.toolContext || null,
          maxContextTokens: this.settings.maxContextTokens,
        });

        const synthesisText = this.synthesizeTurn({
          message: ctx.params.message,
          toolContext: ctx.params.toolContext,
          executionMode,
          plan: responsePlan,
          execution,
          fileProcessing,
          knowledgeContext,
          ctx,
          tenantId,
          sessionId,
        });

        // Try to render presentation for execution result
        let presentationResult = {};
        let presentationApplied = false;
        let presentationType = null;

        if (
          execution?.status === 'completed' &&
          this.hasStructuredExecutionResult(execution)
        ) {
          try {
            const domainResult = this.extractDomainResultFromExecution(execution);
            if (domainResult && Object.keys(domainResult).length > 0) {
              const intent = responsePlan?.primaryIntent || responsePlan?.routeKey || 'execution_result';
              const presentationContext = {
                tenantId,
                sessionId,
                processType: responsePlan?.routeKey || null,
                matrixId: domainResult?.matrix?.id || domainResult?.matrixId || null,
                taskId:
                  domainResult?.taskId
                  || (Array.isArray(domainResult?.matrix?.tasks) && domainResult.matrix.tasks[0]
                    ? domainResult.matrix.tasks[0].taskId || null
                    : null),
                source: 'personal-agent',
              };

              const preferredFormat =
                intent && /vdmi|governance/i.test(String(intent))
                  ? 'vdmi_matrix_table'
                  : 'auto';

              presentationResult = await ctx.call(
                'presentation.render',
                {
                  intent,
                  audience: 'management',
                  preferredFormat,
                  domainResult,
                  context: presentationContext,
                  locale: 'de-DE',
                },
                { meta: ctx.meta }
              );

              if (
                presentationResult &&
                typeof presentationResult === 'object' &&
                presentationResult.markdown
              ) {
                presentationApplied = true;
                presentationType =
                  presentationResult?.presentation?.type
                  || presentationResult?.type
                  || null;
              }
            }
          } catch (error) {
            this.logger?.warn(
              `Presentation render failed (non-blocking): ${error.message}`
            );
            presentationApplied = false;
          }
        }

        const finalized = synthesizeAndPurgeLayer4(
          stackResult.stack,
          presentationApplied ? presentationResult.markdown : synthesisText
        );
        const persisted = buildPersistableSessionState({
          id: sessionId,
          tenantId,
          userId,
          l1: finalized.stack.l1,
          l2: finalized.stack.l2,
          l3: finalized.stack.l3,
          createdAt: session.createdAt,
        });
        persisted.l3.onboardingQuestions = Array.isArray(session.l3?.onboardingQuestions)
          ? session.l3.onboardingQuestions
          : [];
        persisted.l3.assumptions = this.mergeAssumptions(
          session.l3?.assumptions || [],
          execution?.assumptions || []
        );

        assertNoL4RawInPersistedState(persisted);
        await this.persistSession(ctx, tenantId, sessionId, persisted);

        // Schedule (or re-schedule) the post-session Dream pipeline
        await cancelDream(tenantId, sessionId);
        const profileNs = tenantNamespace(PROFILE_NAMESPACE, tenantId);
        await scheduleDream({
          broker: this.broker,
          sessionId,
          tenantId,
          userId,
          profileNamespace: profileNs,
          authMeta: this.buildDreamAuthMeta(ctx.meta, tenantId, userId),
          runFn: async (payload) => {
            await this.runDream(this.broker, payload);
          },
        });

        knowledgeContext = null;

        const responseReply = presentationApplied ? presentationResult.markdown : synthesisText;

        return {
          success: true,
          sessionId,
          executionMode,
          reply: responseReply,
          presentationApplied,
          presentationType: presentationType || null,
          presentation: presentationApplied
            ? {
                ...(presentationResult.presentation || {}),
                type: presentationType || presentationResult?.type || null,
                title: presentationResult?.presentation?.title || null,
                summary: presentationResult?.presentation?.summary || null,
                markdown: presentationResult.markdown,
                warnings:
                  presentationResult?.presentation?.warnings
                  || presentationResult?.warnings
                  || [],
                sections: Array.isArray(presentationResult?.presentation?.sections)
                  ? presentationResult.presentation.sections
                  : [],
                tables: Array.isArray(presentationResult?.presentation?.tables)
                  ? presentationResult.presentation.tables
                  : [],
                kpis: Array.isArray(presentationResult?.presentation?.kpis)
                  ? presentationResult.presentation.kpis
                  : [],
                sources: Array.isArray(presentationResult?.presentation?.sources)
                  ? presentationResult.presentation.sources
                  : [],
                nextActions: Array.isArray(presentationResult?.presentation?.nextActions)
                  ? presentationResult.presentation.nextActions
                  : [],
              }
            : null,
          layer4Purged: finalized.layer4Purged,
          l3Compressed: Boolean(finalized.stack?.l3?.compressed),
          contextUsage: stackResult.usage,
          historyCount: finalized.stack?.l3?.history?.length || 0,
          fileProcessing,
          routing: {
            source: responsePlan.source,
            routeKey: responsePlan.routeKey,
            routeLabel: responsePlan.routeLabel,
            primaryIntent: responsePlan.primaryIntent,
            secondaryIntents: responsePlan.secondaryIntents,
            requestedDomains: responsePlan.requestedDomains,
            unsupportedDomains: responsePlan.unsupportedDomains,
            warnings: responsePlan.warnings,
          },
          plan: {
            status: responsePlan.status,
            steps: responsePlan.steps,
            onboardingHints: responsePlan.onboardingHints,
          },
          execution,
        };
      },
    },

    getSession: {
      rest: 'GET /session/:sessionId',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Load persisted Personal-Agent session (L3 history)',
        description:
          'Returns persisted session state for UI reload. Includes Layer 3 history/summary and profile metadata. ' +
          'Layer 4 is never returned because it is transient.',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
            description: 'Personal-Agent session ID',
          },
        ],
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const session = await this.loadSession(ctx, tenantId, ctx.params.sessionId, userId);

        return {
          success: true,
          sessionId: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          l2: session.l2,
          l3: session.l3,
          layer4: null,
        };
      },
    },

    resetSession: {
      rest: 'POST /session/:sessionId/reset',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Reset chat context stack for a session (keeps hard user profile L2)',
        description:
          'Flushes conversational Layer 3 for the given session while keeping the persisted Layer 2 profile.',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
            description: 'Session ID to reset',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  reason: { type: 'string', default: 'manual-reset', example: 'manual-reset' },
                },
              },
              examples: {
                default: {
                  summary: 'Reset request payload (optional metadata)',
                  value: { reason: 'manual-reset' },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const current = await this.loadSession(ctx, tenantId, ctx.params.sessionId, userId);
        const resetState = buildPersistableSessionState({
          id: current.id,
          tenantId,
          userId,
          l1: { tenantFacts: current.l1?.tenantFacts || [] },
          l2: current.l2,
          l3: { history: [], fileAttachments: [], summary: null, compressed: false },
          createdAt: current.createdAt,
        });
        resetState.l3.onboardingQuestions = [];
        resetState.l3.assumptions = [];

        await this.persistSession(ctx, tenantId, current.id, resetState);

        return {
          success: true,
          sessionId: current.id,
          reset: true,
          keptLayer2: true,
        };
      },
    },

    getDreamStatus: {
      rest: 'GET /session/:sessionId/dream-status',
      params: {
        sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Get Dream-pipeline status for a session',
        description:
          'Returns whether the post-session Dream pipeline is currently pending (timer running) ' +
          'or idle for the given sessionId. The Dream runs after the inactivity timeout configured ' +
          'via DREAM_INACTIVITY_MS (default 5 min) and enriches L2 user profile and L1 tenant memory.',
        parameters: [
          {
            in: 'path',
            name: 'sessionId',
            required: true,
            schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
            description: 'Session ID to inspect dream timer state for',
          },
        ],
        responses: {
          200: {
            description: 'Dream status for the session',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    sessionId: { type: 'string' },
                    dreamPending: { type: 'boolean', description: 'true if inactivity timer is active' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const sessionId = String(ctx.params.sessionId);
        const tenantId = getTenantId(ctx);
        return {
          success: true,
          sessionId,
          dreamPending: isDreamPending(tenantId, sessionId),
        };
      },
    },

    getDreamAudit: {
      rest: 'GET /dream-audit',
      params: {
        limit: { type: 'number', integer: true, min: 1, max: 200, optional: true, default: 50, convert: true },
        offset: { type: 'number', integer: true, min: 0, optional: true, default: 0, convert: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'List Dream-pipeline audit trail entries for the current tenant',
        description:
          'Returns the append-only Dream audit log for the authenticated tenant. ' +
          'Each entry records a Dream pipeline run with fact counts, conflict/retry stats, ' +
          'L1/L2 enrichment results, and a SHA-256 integrity hash. ' +
          'Entries are scoped to the tenant and sorted newest-first.',
        parameters: [
          {
            in: 'query',
            name: 'limit',
            schema: { type: 'integer', default: 50 },
            description: 'Maximum number of audit entries to return (1–200)',
          },
          {
            in: 'query',
            name: 'offset',
            schema: { type: 'integer', default: 0 },
            description: 'Pagination offset',
          },
        ],
        responses: {
          200: {
            description: 'Dream audit trail entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    total: { type: 'integer' },
                    entries: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          key: { type: 'string' },
                          sessionId: { type: 'string' },
                          startedAt: { type: 'string' },
                          finishedAt: { type: 'string' },
                          l1FactsAdded: { type: 'integer' },
                          l2Conflicts: { type: 'integer' },
                          integrityHash: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const namespace = `${DREAM_AUDIT_NAMESPACE}:${tenantId}`;
        const limit = ctx.params.limit || 50;
        const offset = ctx.params.offset || 0;

        let docs = [];
        try {
          const result = await ctx.call(
            'object-store.query',
            { namespace, limit: limit + offset },
            { meta: ctx.meta }
          );
          docs = Array.isArray(result?.docs) ? result.docs : [];
        } catch (err) {
          if (err?.code === 'NOT_FOUND' || err?.type === 'NOT_FOUND' || err?.message?.includes('not found')) {
            docs = [];
          } else {
            throw err;
          }
        }

        // Sort newest-first by key (keys start with 'dream:<ISO timestamp>')
        docs.sort((a, b) => (b.key || '').localeCompare(a.key || ''));
        const page = docs.slice(offset, offset + limit);

        return {
          success: true,
          total: docs.length,
          limit,
          offset,
          entries: page.map((d) => ({ key: d.key, ...(d.payload || {}) })),
        };
      },
    },
  },

  methods: {
    /**
     * Run the Dream pipeline for a session.
     * Called by the inactivity timer; errors are silently swallowed.
     */
    async runDream(broker, payload = {}) {
      const tenantId = String(payload.tenantId || 'default');
      const sessionId = String(payload.sessionId || '');
      const userId = String(payload.userId || payload.authMeta?.authUser?.userId || 'anonymous');
      const profileNamespace =
        payload.profileNamespace || tenantNamespace(PROFILE_NAMESPACE, tenantId);

      if (!sessionId) {
        this.logger?.warn('Dream pipeline skipped: missing sessionId in payload');
        return;
      }

      const dreamMeta = this.deepMergeMeta(
        this.buildDreamAuthMeta(payload.authMeta || {}, tenantId, userId),
        {
          source: 'personal-agent.dream',
          wakeUp: true,
        }
      );

      const dreamCtx = {
        meta: dreamMeta,
        call: (action, params, options = {}) => {
          const mergedMeta = this.deepMergeMeta(options.meta || {}, dreamMeta);
          return broker.call(action, params, { ...options, meta: mergedMeta });
        },
      };

      let session;
      try {
        session = await this.loadSession(dreamCtx, tenantId, sessionId, userId, {
          createIfMissing: false,
        });
      } catch (err) {
        if (isNotFound(err) && payload.session && typeof payload.session === 'object') {
          // v0.52.5 payload compatibility fallback (zero-downtime rollout)
          session = payload.session;
        } else if (isNotFound(err)) {
          this.logger?.info(`Dream pipeline skipped: session ${sessionId} no longer exists.`);
          return;
        } else {
          throw err;
        }
      }

      try {
        await runDreamPipeline(dreamCtx, sessionId, tenantId, userId, profileNamespace, session);
      } catch (err) {
        this.logger?.warn(`Dream pipeline failed for session ${sessionId}: ${err.message}`);
      }
    },

    buildDreamAuthMeta(meta = {}, tenantId, userId) {
      const safeMeta = meta && typeof meta === 'object' ? meta : {};
      const authUser = safeMeta.authUser && typeof safeMeta.authUser === 'object' ? safeMeta.authUser : {};
      const requestHeaders = this.sanitizeDreamRequestHeaders(safeMeta.requestHeaders);

      const nextAuthUser = {
        ...authUser,
        userId,
      };

      return {
        tenantId,
        authUser: nextAuthUser,
        roles: Array.isArray(safeMeta.roles) ? safeMeta.roles : undefined,
        scopes: Array.isArray(safeMeta.scopes) ? safeMeta.scopes : undefined,
        permissions: Array.isArray(safeMeta.permissions) ? safeMeta.permissions : undefined,
        auth: safeMeta.auth && typeof safeMeta.auth === 'object' ? safeMeta.auth : undefined,
        requestHeaders,
      };
    },

    sanitizeDreamRequestHeaders(headers) {
      if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
        return undefined;
      }

      const allowed = ['x-request-id', 'x-correlation-id', 'traceparent', 'tracestate'];
      const sanitized = {};

      for (const [key, value] of Object.entries(headers)) {
        const normalizedKey = String(key || '').trim().toLowerCase();
        if (!allowed.includes(normalizedKey)) {
          continue;
        }
        sanitized[normalizedKey] = value;
      }

      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    },

    deepMergeMeta(base = {}, patch = {}) {
      const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
      if (!isObject(base)) {
        return isObject(patch) ? { ...patch } : patch;
      }
      if (!isObject(patch)) {
        return { ...base };
      }

      const merged = { ...base };
      for (const [key, patchValue] of Object.entries(patch)) {
        const baseValue = merged[key];
        if (isObject(baseValue) && isObject(patchValue)) {
          merged[key] = this.deepMergeMeta(baseValue, patchValue);
          continue;
        }
        merged[key] = patchValue;
      }
      return merged;
    },

    buildFileProcessingIntro(fileProcessing = []) {
      if (!Array.isArray(fileProcessing) || fileProcessing.length === 0) {
        return '';
      }

      const okCount = fileProcessing.filter((item) => item.status === 'ok').length;
      const errorItems = fileProcessing.filter((item) => item.status === 'error');
      const total = fileProcessing.length;

      if (errorItems.length === 0) {
        return `Ich habe ${okCount} Datei(en) verarbeitet. `;
      }

      const names = errorItems.map((item) => item.fileName).filter(Boolean).join(', ');
      return `Ich habe ${okCount} von ${total} Datei(en) verarbeitet. Bei ${names} gab es einen Parse-Fehler. `;
    },

    resolveExtractForAttachment(file, typeInfo) {
      if (!typeInfo) {
        return null;
      }

      if (typeInfo.category === 'tabular' && typeInfo.ext === '.csv') {
        return parseCsvExtract(file.tempPath);
      }

      if (typeInfo.category === 'tabular' && (typeInfo.ext === '.xlsx' || typeInfo.ext === '.xls')) {
        return parseExcelExtract(file.tempPath);
      }

      if (typeInfo.category === 'image') {
        return ocrExtractImage(file.tempPath);
      }

      if (typeInfo.category === 'document') {
        return extractDocumentText(file.tempPath);
      }

      return {
        type: 'unsupported',
        summary: `Dateityp ${typeInfo.mimeType} wird in dieser Version nicht unterstützt.`,
      };
    },

    processFileAttachments(session, files = []) {
      if (!Array.isArray(files) || files.length === 0) {
        return [];
      }

      const results = [];

      for (const file of files) {
        const attachmentId = String(file?.attachmentId || `fa_${crypto.randomUUID().slice(0, 8)}`);
        const fileName = String(file?.fileName || 'attachment');
        const mimeType = String(file?.mimeType || 'application/octet-stream');
        const sizeBytes = Number(file?.sizeBytes || 0);

        try {
          const typeInfo = recognizeFileType(file?.tempPath);
          const extract = this.resolveExtractForAttachment(file, typeInfo);

          injectFileIntoL3(session, {
            attachmentId,
            fileName,
            mimeType,
            category: typeInfo.category,
            sizeBytes,
            extract,
          });

          results.push({
            attachmentId,
            fileName,
            status: 'ok',
          });
        } catch (error) {
          const mappedError = {
            code: error?.code || 'PARSE_ERROR',
            message: error?.message || 'Datei konnte nicht verarbeitet werden.',
          };

          injectFileIntoL3(session, {
            attachmentId,
            fileName,
            mimeType,
            category: 'unknown',
            sizeBytes,
            extract: null,
            error: mappedError,
          });

          results.push({
            attachmentId,
            fileName,
            status: 'error',
            error: mappedError,
          });
        }
      }

      return results;
    },

    synthesizeTurn({
      message,
      toolContext,
      executionMode,
      plan,
      execution,
      fileProcessing = [],
      knowledgeContext = null,
    }) {
      const fileIntro = this.buildFileProcessingIntro(fileProcessing);
      const promptExcerpt = String(message || '').trim().slice(0, 220);
      const synthesisStyle = knowledgeContext?.synthesisStyle || null;
      const styleLead = this.buildSynthesisStyleLead(synthesisStyle);
      const prefixed = (text) => (styleLead ? `${styleLead} ${text}` : text);

      if (toolContext && toolContext.responseRaw) {
        const keyCount = Object.keys(toolContext.responseRaw || {}).length;
        return prefixed(`${fileIntro}Tool-Ergebnis verarbeitet (${keyCount} Felder). Zusammenfassung erstellt und Layer 4 verworfen.`);
      }
      if (executionMode === EXECUTION_MODES.HITL) {
        return prefixed(`${fileIntro}Plan bereit: ${plan.steps.length} deterministische Schritte für „${String(message)
          .trim()
          .slice(0, 160)}“. Ausführung wartet auf Freigabe.`);
      }
      if (execution?.status === 'awaiting-onboarding') {
        return this.buildRecoveryReply({
          message,
          plan,
          execution,
          fileIntro,
          assumptions: execution?.assumptions || [],
          synthesisStyle,
        });
      }
      if (execution?.status === 'completed') {
        return prefixed(`${fileIntro}Plan abgeschlossen: ${execution.steps.length} Schritte deterministisch ausgeführt. Kontext: ${promptExcerpt}`);
      }
      if (execution?.status === 'partial') {
        return this.buildRecoveryReply({
          message,
          plan,
          execution,
          fileIntro,
          assumptions: execution?.assumptions || [],
          synthesisStyle,
        });
      }
      return prefixed(`${fileIntro}Verstanden. Nächster Schritt für: ${String(message).trim().slice(0, 240)}`);
    },

    buildSynthesisStyleLead(synthesisStyle) {
      if (synthesisStyle === 'cautionary') {
        return 'Risikohinweis:';
      }
      if (synthesisStyle === 'methodological') {
        return 'Methodik-Hinweis:';
      }
      return '';
    },

    buildRecoveryReply({
      message,
      plan = {},
      execution = {},
      fileIntro = '',
      assumptions = [],
      synthesisStyle = null,
    }) {
      const taskTone = synthesisStyle === 'cautionary' || this.isFinanceRiskTask(message, plan, execution)
        ? 'finance-risk'
        : 'general';
      const completedStepSummaries = this.summarizeCompletedSteps(plan, execution);
      const stopPoint = execution?.stopPoint || {};
      const progressPrefix = taskTone === 'finance-risk' ? 'Für die Risikoprüfung' : 'Für die fachliche Bewertung';
      const styleLead = this.buildSynthesisStyleLead(synthesisStyle);

      const progressText = completedStepSummaries.length > 0
        ? `${progressPrefix} habe ich bereits ${completedStepSummaries.length === 1 ? 'einen Prüfschritt' : `${completedStepSummaries.length} Prüfschritte`} abgeschlossen: ${completedStepSummaries.join('; ')}.`
        : `${progressPrefix} konnte ich noch keinen Prüfschritt abschließen.`;

      const locationAssumption = assumptions.find(
        (a) => a.type === 'location_operator_unverified'
      );
      const riskWarning = locationAssumption
        ? this.buildLocationAssumptionWarning(locationAssumption)
        : '';

      const stopText = this.buildRecoveryStopText({ plan, execution, stopPoint, taskTone });
      const nextText = this.buildRecoveryNextText({
        message,
        plan,
        execution,
        stopPoint,
        taskTone,
        assumptions,
      });

      return this.normalizeRecoveryText(
        [styleLead, fileIntro, progressText, riskWarning, stopText, nextText]
          .filter(Boolean)
          .join(' ')
      );
    },

    buildLocationAssumptionWarning(assumption = {}) {
      if (!assumption || !assumption.assertedGridOperatorName) {
        return '';
      }
      return `Wichtig: Die Zuständigkeit des Netzbetreibers ${assumption.assertedGridOperatorName} am Standort ${assumption.location} ist noch nicht durch Evidenz belegt (nur Projektannahme mit Risikoflag).`;
    },

    normalizeRecoveryText(text = '') {
      return String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/\.{2,}/g, '.')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,.;:!?]){2,}/g, '$1')
        .trim();
    },

    isCompleteSentence(text = '') {
      return /[.!?]$/.test(String(text || '').trim());
    },

    dedupeCompletedStepSummaries(summaries = []) {
      const seen = new Set();
      const result = [];

      for (const summary of summaries) {
        const value = this.normalizeRecoveryText(summary);
        if (!value) continue;
        const key = value
          .toLowerCase()
          .replace(/\s*\(\s*\d+\s*treffer\s*\)\s*$/i, '')
          .trim();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
      }

      return result;
    },

    humanizeCapabilityLabel(label, fallback = 'fachlicher Prüfschritt') {
      const raw = String(label || '').trim();
      if (!raw) {
        return fallback;
      }

      const normalized = raw.toLowerCase();
      const mappings = [
        ['grid_operator_identity_resolution', 'Netzbetreiber-Zuordnung'],
        ['mastr_asset_inventory', 'Anlagenregister-/MaStR-Prüfung'],
        ['vnb_kpi_benchmark_comparison', 'Netzbetreiber-Benchmark-Prüfung'],
        ['interface_placeholder', 'fehlende Schnittstelle oder Evidenzquelle'],
        ['grid-operator-identity-resolution', 'Netzbetreiber-Zuordnung'],
        ['mastr-asset-inventory', 'Anlagenregister-/MaStR-Prüfung'],
        ['vnb-kpi-benchmark-comparison', 'Netzbetreiber-Benchmark-Prüfung'],
      ];

      for (const [needle, replacement] of mappings) {
        if (normalized.includes(needle)) {
          return replacement;
        }
      }

      if (/execute curated capability path/i.test(raw)) {
        return fallback;
      }

      const isTechnicalToken =
        /execute curated capability path/i.test(raw) ||
        /\binterface_placeholder\b/i.test(raw) ||
        /\b(grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison)\b/i.test(raw) ||
        /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/i.test(raw);

      const stripped = raw
        .replace(/^execute curated capability path for\s+/i, '')
        .replace(/^execute curated capability path:\s*/i, '')
        .replace(/\binterface_placeholder\b/gi, 'fehlende Schnittstelle oder Evidenzquelle')
        .replace(/\b(grid_operator_identity_resolution|mastr_asset_inventory|vnb_kpi_benchmark_comparison)\b/gi, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!stripped) {
        return fallback;
      }

      if (isTechnicalToken) {
        return fallback;
      }

      return stripped;
    },

    buildRecoveryStopText({ plan = {}, execution = {}, stopPoint = {}, taskTone }) {
      const blockedStepLabel = this.describeBlockedStep(plan, stopPoint);

      if (stopPoint.reasonCode === 'MISSING_INPUTS' || execution?.status === 'awaiting-onboarding') {
        const missingText = this.describeMissingRecoveryInputs(stopPoint);
        const hasFullQuestion = this.isCompleteSentence(missingText);
        const missingSummary = hasFullQuestion ? 'die offene Evidenz' : missingText;
        return taskTone === 'finance-risk'
          ? `Es fehlt noch ${missingSummary}.`
          : `Mir fehlt noch ${missingSummary}.`;
      }

      if (stopPoint.status === 'interface-placeholder' || stopPoint.reasonCode === 'UNSUPPORTED_CHAIN') {
        return taskTone === 'finance-risk'
          ? `Der Stopp liegt an einer fehlenden Schnittstelle oder Evidenzquelle beim Prüfpunkt "${blockedStepLabel}".`
          : `Der Stopp liegt an einer fehlenden Schnittstelle oder Evidenzquelle beim Schritt "${blockedStepLabel}".`;
      }

      if (stopPoint.reasonCode === 'ACTION_FAILED') {
        return taskTone === 'finance-risk'
          ? `Der Prüfpunkt "${blockedStepLabel}" konnte fachlich nicht belastbar abgeschlossen werden.`
          : `Der Schritt "${blockedStepLabel}" konnte fachlich nicht belastbar abgeschlossen werden.`;
      }

      if (stopPoint.reasonCode) {
        return taskTone === 'finance-risk'
          ? `Der Prüfpunkt "${blockedStepLabel}" ist an einer offenen fachlichen Bedingung hängengeblieben.`
          : `Der Schritt "${blockedStepLabel}" ist an einer offenen fachlichen Bedingung hängengeblieben.`;
      }

      return taskTone === 'finance-risk'
        ? 'Für die Risikoprüfung fehlt noch ein belastbarer Anschlussprüfpunkt.'
        : 'Für die fachliche Bewertung fehlt noch ein belastbarer Anschlussprüfpunkt.';
    },

    detectAssumptionDrivenFollowUp(message = '') {
      const normalized = String(message || '').toLowerCase();

      if (!normalized) {
        return null;
      }

      if (/(risk assessment|risikoampel|kreditausschuss|condition precedent|due diligence|due-diligence|risikobewertung|risikoanalyse)/i.test(normalized)) {
        return 'risk';
      }

      if (/(markt|regulator|preisdaten|preis|entso-e|netztransparenz|methodik|methodologie|datenquelle|day-ahead|negativpreis|volatilität|volatilitaet)/i.test(normalized)) {
        return 'market';
      }

      if (/(vorläufigen annahme|vorlaeufigen annahme|arbeite .* weiter|weiterarbeiten|nächste fachliche schritte|naechste fachliche schritte|nächste schritte|naechste schritte|wie weiter|fortfahren|weiter vorgehen)/i.test(normalized)) {
        return 'continuation';
      }

      return null;
    },

    buildAssumptionContinuationNextText(taskTone = 'general', assumption = null) {
      const assumptionNote = assumption
        ? ' Die Bewertung bleibt bis zur Evidenzprüfung ausdrücklich vorläufig.'
        : '';

      return taskTone === 'finance-risk'
        ? `Ich kann auf Basis der Working Assumption fachlich weiterarbeiten: zunächst offene Evidenzpunkte priorisieren, dann Markt-/Regulatorik-Annahmen dokumentieren und anschließend die Condition-Precedent-Themen für die Due Diligence strukturieren.${assumptionNote}`
        : `Ich kann auf Basis der Working Assumption fachlich weiterarbeiten: als Nächstes die Methodik, offene Evidenzpunkte und benötigten Anschlussunterlagen strukturiert auflisten.${assumptionNote}`;
    },

    mergeAssumptions(existing = [], incoming = []) {
      const merged = [];
      const seen = new Set();

      for (const item of [...(existing || []), ...(incoming || [])]) {
        if (!item || typeof item !== 'object' || !item.type) {
          continue;
        }

        const key = [
          item.type,
          item.location || '',
          item.assertedGridOperatorName || '',
          item.status || '',
        ].join('::').toLowerCase();

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        merged.push(item);
      }

      return merged;
    },

    resolveMethodologyFallbackType({ message, plan = {}, execution = {} }) {
      const routingSignals = [
        message,
        plan?.primaryIntent,
        plan?.routeKey,
        plan?.routeLabel,
        ...(Array.isArray(plan?.secondaryIntents) ? plan.secondaryIntents : []),
        ...(Array.isArray(plan?.requestedDomains) ? plan.requestedDomains : []),
        ...(Array.isArray(plan?.unsupportedDomains) ? plan.unsupportedDomains : []),
        ...(Array.isArray(plan?.steps)
          ? plan.steps.map((step) => `${step?.purpose || ''} ${step?.label || ''}`)
          : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (/(market|markt|regulator|preis|pricing|preisdaten|entso-e|netztransparenz|day-ahead|negativpreis|volatil)/i.test(routingSignals)) {
        return 'market';
      }

      if (/(risk assessment|risk|risiko|due diligence|due-diligence|kreditausschuss|kredit|loan|lender|investment committee|komitee|condition precedent)/i.test(routingSignals)) {
        return 'risk';
      }

      if (this.isFinanceRiskTask(message, plan, execution)) {
        return 'finance-risk-generic';
      }

      return null;
    },

    buildGenericMethodologicalNextText(taskTone = 'finance-risk', assumption = null) {
      const assumptionNote = assumption
        ? ' Die Einordnung bleibt bis zur Evidenzprüfung ausdrücklich vorläufig.'
        : '';

      return taskTone === 'finance-risk'
        ? `Ohne angebundene Fachschnittstelle liefere ich zunächst eine belastbare Methodik: Annahmen offenlegen, Evidenzlücken priorisieren, Sensitivitäten dokumentieren und Entscheidungsvorbehalte sauber trennen.${assumptionNote}`
        : `Ohne angebundene Fachschnittstelle kann ich zunächst Methodik, Evidenzlücken und nächste Prüfschritte strukturiert benennen.${assumptionNote}`;
    },

    buildRecoveryNextText({ message, plan = {}, execution = {}, stopPoint = {}, taskTone, assumptions = [] }) {
      const locationAssumption = assumptions.find(
        (a) => a.type === 'location_operator_unverified'
      );
      const followUpType = locationAssumption
        ? this.detectAssumptionDrivenFollowUp(message)
        : null;

      if (followUpType === 'market') {
        return this.buildMarketMethodologicalNextText(taskTone, locationAssumption);
      }

      if (followUpType === 'risk') {
        return this.buildRiskAssessmentNextText(taskTone, locationAssumption);
      }

      if (followUpType === 'continuation') {
        return this.buildAssumptionContinuationNextText(taskTone, locationAssumption);
      }

      if (stopPoint.reasonCode === 'MISSING_INPUTS' || execution?.status === 'awaiting-onboarding') {
        const questionText = stopPoint?.onboardingQuestion?.questionText;
        if (questionText) {
          return this.isCompleteSentence(questionText)
            ? questionText
            : `Bitte beantworte konkret: ${this.normalizeRecoveryText(questionText)}`;
        }

        const missingText = this.describeMissingRecoveryInputs(stopPoint);
        return taskTone === 'finance-risk'
          ? `Bitte nenne ${missingText}, damit ich die Due-Diligence-Bedingung prüfen kann.`
          : `Bitte nenne ${missingText}, damit ich fortfahren kann.`;
      }

      if (stopPoint.status === 'interface-placeholder' || stopPoint.reasonCode === 'UNSUPPORTED_CHAIN') {
        const fallbackType = this.resolveMethodologyFallbackType({
          message,
          plan,
          execution,
        });

        if (fallbackType === 'market') {
          return this.buildMarketMethodologicalNextText(taskTone, locationAssumption);
        }

        if (fallbackType === 'risk') {
          return this.buildRiskAssessmentNextText(taskTone, locationAssumption);
        }

        if (fallbackType === 'finance-risk-generic') {
          return this.buildGenericMethodologicalNextText(taskTone, locationAssumption);
        }

        const suggestion = this.getRecoveryNextSuggestion(stopPoint, plan);
        return taskTone === 'finance-risk'
          ? `Nächster Schritt: ${suggestion} oder die fehlende Evidenz nachreichen.`
          : `Nächster Schritt: ${suggestion} oder die fehlende Evidenz nachreichen.`;
      }

      if (stopPoint.reasonCode === 'ACTION_FAILED') {
        return taskTone === 'finance-risk'
          ? 'Nächster Schritt: die offene Evidenz nachreichen oder den Prüfpunkt mit einer verfügbaren Capability neu anstoßen.'
          : 'Nächster Schritt: die offene Evidenz nachreichen oder den Prüfschritt mit einer verfügbaren Capability neu anstoßen.';
      }

      return taskTone === 'finance-risk'
        ? 'Bitte liefere die fehlende Evidenz für die belastbare Risikobewertung.'
        : 'Bitte liefere die fehlenden Angaben für den nächsten Prüfschritt.';
    },

    buildMarketMethodologicalNextText(taskTone = 'general', assumption = null) {
      const assumptionNote = assumption
        ? ` Die Auswertung unter unbestätigter Netzbetreiber-Zuständigkeit bleibt vorläufig.`
        : '';
      return taskTone === 'finance-risk'
        ? `Methodik für Preisdaten: Day-Ahead-Spreads, Negativpreisstunden und Volatilität separat auswerten. Erforderliche Datenquellen: ENTSO-E, Netztransparenz oder Market Snapshot.${assumptionNote}`
        : `Verfügbare Datenquellen: ENTSO-E, Netztransparenz, Market Snapshot. Ohne angebundene Live-Quelle nur Methodologie möglich.${assumptionNote}`;
    },

    buildRiskAssessmentNextText(taskTone = 'finance-risk', assumption = null) {
      const assumptionCondition = assumption
        ? `\n• Condition Precedent: Vor Auszahlung muss Netzbetreiber-/Netzanschlusspunkt-Zuständigkeit durch BKZ, BDEW-Code oder Netzanschlusszusage verifiziert sein.`
        : '';
      return taskTone === 'finance-risk'
        ? `Ich stelle ein vorläufiges Risk Assessment zusammen basierend auf bisheriger Evidenz. Struktur: Projektverständnis, Risikoampel, offene Due-Diligence-Punkte, Kreditausschuss-Empfehlung.${assumptionCondition}`
        : `Risk Assessment mit bisheriger Evidenz (vorläufig).${assumptionCondition}`;
    },

    getRecoveryNextSuggestion(stopPoint = {}, plan = {}) {
      if (stopPoint?.onboardingQuestion?.questionText) {
        return stopPoint.onboardingQuestion.questionText;
      }

      const metadataSuggestions = Array.isArray(stopPoint?.placeholderMetadata?.suggestedNextSteps)
        ? stopPoint.placeholderMetadata.suggestedNextSteps.filter((item) => typeof item === 'string' && item.trim())
        : [];
      if (metadataSuggestions.length > 0) {
        return this.humanizeCapabilityLabel(metadataSuggestions[0], 'die fehlende Evidenz nachreichen');
      }

      const blockedStepLabel = this.describeBlockedStep(plan, stopPoint);
      return `den Prüfpunkt "${blockedStepLabel}" an eine verfügbare Schnittstelle oder Evidenzquelle übergeben`;
    },

    summarizeCompletedSteps(plan = {}, execution = {}) {
      const completedSteps = Array.isArray(execution?.steps)
        ? execution.steps.filter((step) => step && step.status === 'completed')
        : [];

      const summaries = completedSteps.slice(0, 3).map((step) => {
        const plannedStep = Array.isArray(plan?.steps)
          ? plan.steps.find((item) => item.step === step.step || item.action === step.action)
          : null;
        const label = this.humanizeCapabilityLabel(
          plannedStep?.purpose || plannedStep?.label || step.label || step.action,
          this.humanizeActionName(step.action)
        );
        const outcome = this.summarizeStepOutcome(step.result);
        return outcome ? `${label} (${outcome})` : label;
      });

      return this.dedupeCompletedStepSummaries(summaries);
    },

    summarizeStepOutcome(result) {
      if (!result || typeof result !== 'object') {
        return '';
      }

      const hints = [];
      if (typeof result.recommendation === 'string' && result.recommendation.trim()) {
        hints.push(result.recommendation.trim());
      }
      if (typeof result.decision === 'string' && result.decision.trim()) {
        hints.push(result.decision.trim());
      }
      if (typeof result.riskLevel === 'string' && result.riskLevel.trim()) {
        hints.push(`Risiko ${result.riskLevel.trim()}`);
      }
      if (Number.isFinite(result.paybackYears)) {
        hints.push(`Amortisation ${Number(result.paybackYears).toFixed(1)} Jahre`);
      }
      if (Array.isArray(result.findings)) {
        hints.push(`${result.findings.length} Befund${result.findings.length === 1 ? '' : 'e'}`);
      }
      const resultList = Array.isArray(result?.data?.results)
        ? result.data.results
        : (Array.isArray(result?.results) ? result.results : null);
      if (Array.isArray(resultList)) {
        hints.push(resultList.length === 0 ? 'kein Treffer' : `${resultList.length} Treffer`);
      }
      if (typeof result.status === 'string') {
        const status = result.status.trim().toLowerCase();
        if (['eligible', 'ready', 'approved', 'ok', 'warning'].includes(status)) {
          hints.push(`Status ${result.status.trim()}`);
        }
      }

      return hints.slice(0, 2).join(', ');
    },

    describeBlockedStep(plan = {}, stopPoint = {}) {
      const blockedStepNumber = Number(stopPoint?.blockedStep || 0);
      const plannedStep = Array.isArray(plan?.steps)
        ? plan.steps.find((step) => step.step === blockedStepNumber || step.action === stopPoint?.blockedAction)
        : null;

      if (plannedStep) {
        return this.humanizeCapabilityLabel(
          plannedStep.purpose || plannedStep.label || plannedStep.action,
          this.humanizeActionName(plannedStep.action)
        );
      }

      const rawBlocked = stopPoint?.placeholderMetadata?.title || stopPoint?.blockedAction;
      return this.humanizeCapabilityLabel(
        rawBlocked,
        blockedStepNumber > 0 ? `Schritt ${blockedStepNumber}` : 'der nächste fachliche Prüfschritt'
      );
    },

    describeMissingRecoveryInputs(stopPoint = {}) {
      const questionText = stopPoint?.onboardingQuestion?.questionText;
      if (questionText) {
        return questionText;
      }

      const missingParams = Array.isArray(stopPoint?.missingParams) ? stopPoint.missingParams : [];
      if (missingParams.length > 0) {
        const labels = missingParams.map((param) => this.humanizeMissingParam(param));
        if (labels.length === 1) {
          return labels[0];
        }
        return `${labels.slice(0, -1).join(', ')} und ${labels[labels.length - 1]}`;
      }

      return 'die fehlenden Angaben';
    },

    humanizeMissingParam(param) {
      const mapping = {
        taskId: 'die VDMI-Task-ID',
        agentId: 'den verantwortlichen Akteur',
        matrixId: 'die VDMI-Matrix-ID',
        processId: 'die Prozess-ID',
        projectId: 'die Projekt-ID',
        gridOperatorName: 'den Netzbetreiber',
        gridOperatorId: 'die Netzbetreiber-ID',
        gridOperatorBdew: 'den BDEW-Code',
        bdew: 'den BDEW-Code',
        city: 'den Ort',
        vnbName: 'den Netzbetreibernamen',
        query: 'einen belastbaren Suchhinweis (Netzbetreiber, BDEW-Code oder Ort)',
        operatorEvidence: 'den Netzbetreiber oder den BDEW-Code',
        fnavProfile: 'das fNAV-Profil',
        voltageLevel: 'die Spannungsebene',
        ownerContact: 'den Ansprechpartner',
        communityName: 'den Gemeinschaftsnamen',
        communityId: 'die Gemeinschafts-ID',
        generators: 'die Erzeugungsdaten',
        consumers: 'die Verbrauchsdaten',
        dateFrom: 'den Startzeitpunkt',
        dateTo: 'den Endzeitpunkt',
        annualFeeEur: 'den Jahresbetrag',
      };

      if (mapping[param]) {
        return mapping[param];
      }

      const fallback = String(param || 'Angabe')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim();

      return fallback ? `den Wert für ${fallback}` : 'die fehlende Angabe';
    },

    humanizeActionName(action) {
      const text = String(action || 'der nächste Schritt')
        .replace(/\./g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'der nächste Schritt';
    },

    isFinanceRiskTask(message, plan = {}, execution = {}) {
      const haystack = [
        message,
        plan?.primaryIntent,
        plan?.routeLabel,
        plan?.routeKey,
        ...(Array.isArray(plan?.steps) ? plan.steps.map((step) => `${step.action || ''} ${step.purpose || ''}`) : []),
        ...(Array.isArray(execution?.steps) ? execution.steps.map((step) => `${step.action || ''} ${step.purpose || ''}`) : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return /(kredit|credit|loan|bank|finanz|finance|risk|risiko|due diligence|due-diligence|bewertung|invest|investment|lender|komitee)/i.test(haystack);
    },

    async getBrokerRecommendation(ctx, message, knownContext = {}) {
      try {
        return await ctx.call(
          'capability-broker.recommend',
          {
            schemaVersion: 'cernion.capabilityRecommendation.v1',
            task: message,
            mode: 'initial',
            knownContext,
          },
          { meta: ctx.meta }
        );
      } catch (error) {
        if (isActionUnavailable(error)) {
          return null;
        }
        throw error;
      }
    },

    attachKnowledgeHintsToKnownContext(knownContext = {}, knowledgeContext = null) {
      const enriched = { ...(knownContext || {}) };
      if (!knowledgeContext) {
        return enriched;
      }

      enriched._knowledgeHints = {
        domainHint: knowledgeContext.domainHint || null,
        regulatoryFrame: knowledgeContext.regulatoryFrame || null,
        synthesisStyle: knowledgeContext.synthesisStyle || null,
      };
      return enriched;
    },

    async queryKnowledgeOrientation(ctx, { message, activeDomains = [] } = {}) {
      return queryKnowledgeOrientationAdapter(ctx, {
        message,
        activeDomains,
      });
    },

    buildStopPoint({ reasonCode, message, blockedStep, status, placeholder }) {
      return {
        status,
        reasonCode,
        message,
        blockedStep,
        blockedAction: placeholder?.blockedAction || null,
        missingParams: Array.isArray(placeholder?.missingParams)
          ? placeholder.missingParams
          : null,
        onboardingQuestion: placeholder?.onboardingQuestion || null,
        onboardingHints: placeholder?.onboardingHints || null,
        placeholderId: placeholder?.placeholder?.placeholderId || null,
        placeholderMetadata: placeholder?.placeholderMetadata || null,
        hitlItemId: placeholder?.hitlItem?.id || null,
      };
    },

    hydrateKnownContextFromSession(knownContext = {}, session = {}) {
      const target = knownContext;
      const profileFacts = session?.l2?.userProfile?.onboardingFacts || {};

      const parseFnavProfileAnswer = (rawValue) => {
        if (!rawValue) return null;
        if (typeof rawValue === 'object') return rawValue;
        const text = String(rawValue).trim();
        if (!text) return null;

        const mwMatch = text.match(/(\d+(?:[.,]\d+)?)\s*mw\b/i);
        const kwMatch = text.match(/(\d+(?:[.,]\d+)?)\s*kw\b/i);

        let requestedCapacity = null;
        if (mwMatch) {
          requestedCapacity = Number(mwMatch[1].replace(',', '.')) * 1000;
        } else if (kwMatch) {
          requestedCapacity = Number(kwMatch[1].replace(',', '.'));
        }

        if (!Number.isFinite(requestedCapacity) || requestedCapacity <= 0) {
          return null;
        }

        return {
          requestedCapacity,
        };
      };

      for (const [key, value] of Object.entries(profileFacts)) {
        if (Object.prototype.hasOwnProperty.call(target, key)) {
          continue;
        }
        const resolvedValue = value?.value;
        if (resolvedValue !== undefined && resolvedValue !== null) {
          target[key] = resolvedValue;
        }
      }

      const answeredFacts = listAnsweredOnboardingFacts(session?.l3 || {});
      for (const fact of answeredFacts) {
        if (!fact?.paramKey || Object.prototype.hasOwnProperty.call(target, fact.paramKey)) {
          continue;
        }
        if (fact.paramKey === 'fnavProfile') {
          target[fact.paramKey] = parseFnavProfileAnswer(fact.value) || fact.value;
          continue;
        }
        target[fact.paramKey] = fact.value;
      }

      return target;
    },

    findFirstMissingStep(plan = {}, knownContext = {}) {
      const executionState = { stepResults: {} };
      for (const plannedStep of plan.steps || []) {
        const params = pruneUndefinedDeep(
          fillTemplateWithContext(
            plannedStep.paramsTemplate,
            plannedStep.action,
            knownContext,
            plan.promptHints,
            executionState
          )
        );
        const missingParams = getMissingInputs(plannedStep.action, params);
        if (missingParams.length > 0) {
          return {
            step: plannedStep,
            params,
            missingParams,
          };
        }
      }
      return null;
    },

    buildOnboardingStopPoint({
      plan,
      missingParams,
      blockedStep,
      blockedAction,
      questionTextOverride,
      locationOperatorConsistency,
      evidenceHints,
    }) {
      const paramKey = resolveParamKeyFromMissing(missingParams);
      const onboardingQuestion = buildOnboardingQuestion({
        paramKey,
        action: blockedAction || plan?.steps?.[0]?.action,
        fallbackText: questionTextOverride,
      });
      onboardingQuestion.planSnapshot = {
        source: plan?.source || 'onboarding-resume',
        routeKey: plan?.routeKey || null,
        routeLabel: plan?.routeLabel || null,
        primaryIntent: plan?.primaryIntent || blockedAction || null,
        secondaryIntents: plan?.secondaryIntents || [],
        requestedDomains: plan?.requestedDomains || [],
        unsupportedDomains: plan?.unsupportedDomains || [],
        warnings: plan?.warnings || [],
        promptHints: plan?.promptHints || {},
        status: plan?.status || 'ready',
        steps: Array.isArray(plan?.steps) ? plan.steps : [],
      };

      return {
        reasonCode: 'MISSING_INPUTS',
        status: 'awaiting-onboarding',
        blockedStep,
        blockedAction,
        missingParams,
        locationOperatorConsistency: locationOperatorConsistency || null,
        evidenceHints: evidenceHints || null,
        message: onboardingQuestion.questionText,
        onboardingQuestion,
      };
    },

    enrichPlanWithOnboardingHints(plan = {}, knownContext = {}) {
      const firstMissing = this.findFirstMissingStep(plan, knownContext);
      if (!firstMissing) {
        return { ...plan, onboardingHints: [] };
      }

      const paramKey = resolveParamKeyFromMissing(firstMissing.missingParams);
      return {
        ...plan,
        onboardingHints: [
          {
            blockedStep: firstMissing.step.step,
            blockedAction: firstMissing.step.action,
            missingParams: firstMissing.missingParams,
            suggestedParamKey: paramKey,
          },
        ],
      };
    },

    async handleExecutionWithOnboarding(ctx, {
      message,
      plan,
      knownContext,
      session,
      executionMode,
    }) {
      if (executionMode === EXECUTION_MODES.HITL) {
        const hydratedContext = this.hydrateKnownContextFromSession(
          knownContext,
          session
        );
        const enrichedPlan = this.enrichPlanWithOnboardingHints(plan, hydratedContext);
        return {
          status: 'skipped',
          steps: [],
          stopPoint: plan.status === 'partial'
            ? this.buildStopPoint({
                reasonCode: 'UNSUPPORTED_CHAIN',
                message: plan.warnings[0] || 'Chain requires manual continuation.',
                blockedStep: (plan.steps?.length || 0) + 1,
                status: 'plan-only',
              })
            : null,
          plan: enrichedPlan,
        };
      }

      session.l3 = {
        history: [],
        summary: null,
        compressed: false,
        ...(session.l3 || {}),
      };
      session.l3.onboardingQuestions = markStaleQuestions(session.l3, 24);

      const pendingQuestion = findPendingOnboardingQuestion(session.l3);
      const existingAssumptions = Array.isArray(session?.l3?.assumptions)
        ? session.l3.assumptions
        : [];
      let effectivePlan = plan;
      if (pendingQuestion) {
        const answer = captureOnboardingAnswer({ question: pendingQuestion, message });
        if (!answer) {
          const planUsesPendingAction = Array.isArray(plan?.steps)
            ? plan.steps.some((step) => step?.action === pendingQuestion.action)
            : false;

          if (planUsesPendingAction) {
            return {
              status: 'awaiting-onboarding',
              completedSteps: 0,
              steps: [],
              assumptions: existingAssumptions,
              stopPoint: {
                reasonCode: 'MISSING_INPUTS',
                status: 'awaiting-onboarding',
                blockedStep: 1,
                blockedAction: pendingQuestion.action,
                missingParams: [pendingQuestion.paramKey],
                message: pendingQuestion.questionText,
                onboardingQuestion: pendingQuestion,
              },
            };
          }
        }

        if (answer) {
          session.l3.onboardingQuestions = (session.l3.onboardingQuestions || []).map((q) =>
            q.questionId === answer.questionId ? answer : q
          );

          const stepActions = Array.isArray(plan?.steps)
            ? plan.steps.map((step) => step.action)
            : [];
          if (
            !stepActions.includes(pendingQuestion.action) &&
            Array.isArray(pendingQuestion?.planSnapshot?.steps) &&
            pendingQuestion.planSnapshot.steps.length > 0
          ) {
            effectivePlan = pendingQuestion.planSnapshot;
          }
        }
      }

      const hydratedContext = this.hydrateKnownContextFromSession(knownContext, session);
      const firstMissing = this.findFirstMissingStep(effectivePlan, hydratedContext);
      if (firstMissing) {
        const stopPoint = this.buildOnboardingStopPoint({
          plan: effectivePlan,
          missingParams: firstMissing.missingParams,
          blockedStep: firstMissing.step.step,
          blockedAction: firstMissing.step.action,
        });
        session.l3.onboardingQuestions = [
          ...(session.l3.onboardingQuestions || []),
          stopPoint.onboardingQuestion,
        ];
        return {
          status: 'awaiting-onboarding',
          completedSteps: 0,
          steps: [],
          stopPoint,
        };
      }

      const execution = await this.executeDeterministicPlan(ctx, {
        message,
        plan: effectivePlan,
        knownContext: hydratedContext,
        skipGapForMissingInputs: true,
        existingAssumptions,
      });

      if (execution?.stopPoint?.reasonCode === 'MISSING_INPUTS') {
        const stopPoint = this.buildOnboardingStopPoint({
          plan: effectivePlan,
          missingParams: execution.stopPoint?.missingParams || [],
          blockedStep: execution.stopPoint?.blockedStep || 1,
          blockedAction: execution.stopPoint?.blockedAction || effectivePlan?.steps?.[0]?.action,
          questionTextOverride: execution.stopPoint?.questionTextOverride,
          locationOperatorConsistency: execution.stopPoint?.locationOperatorConsistency,
          evidenceHints: execution.stopPoint?.evidenceHints,
        });
        session.l3.onboardingQuestions = [
          ...(session.l3.onboardingQuestions || []),
          stopPoint.onboardingQuestion,
        ];

        return {
          ...execution,
          plan: effectivePlan,
          status: 'awaiting-onboarding',
          completedSteps: execution.completedSteps || 0,
          stopPoint,
        };
      }

      return {
        ...execution,
        plan: effectivePlan,
      };
    },

    async markRoutingGap(ctx, { reasonCode, message, blockedStep }) {
      try {
        const placeholder = await ctx.call(
          'interface-placeholder.markGap',
          {
            role: 'personal_agent_orchestrator',
            reason: reasonCode === 'MISSING_INPUTS' ? 'NEEDS_EVIDENCE' : 'NEEDS_INTERFACE',
            blockingLevel: 'soft',
            replacementCriteria: {
              kind: 'process',
              capabilityHint: 'personal-agent.chat',
              deadline: null,
            },
            signalCodes: [reasonCode],
            placeholderGapKey: `personal-agent-step-${blockedStep}`,
          },
          { meta: ctx.meta }
        );
        return placeholder;
      } catch (error) {
        if (isActionUnavailable(error) || isNotFound(error)) {
          return null;
        }
        this.logger.warn(`personal-agent gap marker unavailable: ${error.message}`);
        return null;
      }
    },

    findBestVdmiDecisionTask(matrix = {}) {
      const tasks = Array.isArray(matrix?.tasks) ? matrix.tasks : [];
      if (tasks.length === 0) {
        return {
          task: null,
          reason: 'no_tasks_available',
        };
      }

      const decisionRegex = /(decision|entscheidung|netzbetreiberentscheidung|anschluss|kapazit[aä]t|uebergabepunkt|übergabepunkt|governance|formal|antrag|gatekeeper)/i;
      const decisionCandidates = tasks.filter((task) =>
        decisionRegex.test(`${task?.taskId || ''} ${task?.taskName || ''} ${task?.phase || ''}`)
      );

      if (decisionCandidates.length === 1) {
        return {
          task: decisionCandidates[0],
          reason: 'decision_task_match',
        };
      }

      if (decisionCandidates.length > 1) {
        return {
          task: null,
          reason: 'ambiguous_decision_tasks',
          candidates: decisionCandidates.map((task) => task?.taskId).filter(Boolean),
        };
      }

      if (tasks.length === 1) {
        return {
          task: tasks[0],
          reason: 'single_task_fallback',
        };
      }

      return {
        task: null,
        reason: 'task_context_required',
        candidates: tasks.map((task) => task?.taskId).filter(Boolean),
      };
    },

    extractVdmiTaskFromExecutionState(executionState = {}) {
      const stepResults = executionState?.stepResults || {};
      const steps = Object.values(stepResults).map((entry) => entry?.raw || entry?.data || entry || {});

      for (const payload of steps.reverse()) {
        const dossierTask = payload?.dossier?.task;
        if (dossierTask && (dossierTask.taskId || dossierTask.taskName)) {
          return dossierTask;
        }
      }

      return null;
    },

    async loadVdmiMatrixForKnownContext(ctx, knownContext = {}) {
      const matrixId = knownContext?.matrixId || null;
      const processId = knownContext?.processId || knownContext?.jobId || null;

      if (matrixId) {
        try {
          const response = await ctx.call('vdmi.get', { id: matrixId }, { meta: ctx.meta });
          return response?.matrix || null;
        } catch (error) {
          if (isActionUnavailable(error) || isNotFound(error)) {
            return null;
          }
          throw error;
        }
      }

      if (processId) {
        try {
          const response = await ctx.call('vdmi.context', { jobId: processId }, { meta: ctx.meta });
          return response?.matrix || null;
        } catch (error) {
          if (isActionUnavailable(error) || isNotFound(error)) {
            return null;
          }
          throw error;
        }
      }

      return null;
    },

    async hydrateVdmiStepParams(ctx, {
      plannedStep,
      params,
      knownContext,
      executionState,
    }) {
      const action = String(plannedStep?.action || '');
      if (!action.startsWith('vdmi.')) {
        return { params, stopPoint: null };
      }

      const hydrated = { ...(params || {}) };

      if (
        (action === 'vdmi.dossier' || action === 'vdmi.negotiationTrace' || action === 'vdmi.agentRole')
        && !hydrated.taskId
      ) {
        if (knownContext?.taskId) {
          hydrated.taskId = knownContext.taskId;
        } else {
          const inferredTask = this.extractVdmiTaskFromExecutionState(executionState);
          if (inferredTask?.taskId) {
            hydrated.taskId = inferredTask.taskId;
            knownContext.taskId = inferredTask.taskId;
          } else {
            const matrix = await this.loadVdmiMatrixForKnownContext(ctx, knownContext);
            if (matrix) {
              const picked = this.findBestVdmiDecisionTask(matrix);
              if (picked?.task?.taskId) {
                hydrated.taskId = picked.task.taskId;
                knownContext.taskId = picked.task.taskId;
              } else {
                const reasonSuffix = picked?.reason ? ` (${picked.reason})` : '';
                return {
                  params: hydrated,
                  stopPoint: {
                    reasonCode: 'MISSING_VDMI_TASK_CONTEXT',
                    message: `VDMI Task-Kontext ist nicht eindeutig auflösbar${reasonSuffix}.`,
                    blockedStep: plannedStep.step,
                    blockedAction: action,
                    missingParams: ['taskId'],
                    status: 'interface-placeholder',
                  },
                };
              }
            } else {
              return {
                params: hydrated,
                stopPoint: {
                  reasonCode: 'MISSING_VDMI_TASK_CONTEXT',
                  message: 'VDMI Task-Kontext fehlt. Bitte taskId, matrixId oder processId angeben.',
                  blockedStep: plannedStep.step,
                  blockedAction: action,
                  missingParams: ['taskId'],
                  status: 'interface-placeholder',
                },
              };
            }
          }
        }
      }

      if (action === 'vdmi.agentRole') {
        if (!hydrated.processType && knownContext?.processType) {
          hydrated.processType = knownContext.processType;
        }

        if (!hydrated.agentId) {
          const taskFromExecution = this.extractVdmiTaskFromExecutionState(executionState);
          const taskActors = Array.isArray(taskFromExecution?.verantwortlich)
            ? taskFromExecution.verantwortlich
            : [];

          let selectedActors = taskActors;

          if (selectedActors.length === 0 && hydrated.taskId) {
            const matrix = await this.loadVdmiMatrixForKnownContext(ctx, knownContext);
            const matchedTask = (matrix?.tasks || []).find((task) => task?.taskId === hydrated.taskId);
            selectedActors = Array.isArray(matchedTask?.verantwortlich) ? matchedTask.verantwortlich : [];
          }

          if (selectedActors.length === 1 && selectedActors[0]?.actorId) {
            hydrated.agentId = selectedActors[0].actorId;
            knownContext.agentId = selectedActors[0].actorId;
          } else if (selectedActors.length > 1) {
            return {
              params: hydrated,
              stopPoint: {
                reasonCode: 'AMBIGUOUS_VDMI_V_ACTOR',
                message: 'Mehrere verantwortliche V-Akteure gefunden. Bitte Agenten-ID eindeutig angeben.',
                blockedStep: plannedStep.step,
                blockedAction: action,
                missingParams: ['agentId'],
                status: 'interface-placeholder',
              },
            };
          } else {
            return {
              params: hydrated,
              stopPoint: {
                reasonCode: 'MISSING_VDMI_V_ACTOR',
                message: 'Kein verantwortlicher V-Akteur für die Entscheidungstask gefunden.',
                blockedStep: plannedStep.step,
                blockedAction: action,
                missingParams: ['agentId'],
                status: 'interface-placeholder',
              },
            };
          }
        }
      }

      return { params: hydrated, stopPoint: null };
    },

    async executeDeterministicPlan(ctx, {
      message,
      plan,
      knownContext,
      skipGapForMissingInputs = false,
      existingAssumptions = [],
    }) {
      const executionState = {
        stepResults: {},
      };
      const steps = [];
      let completedSteps = 0;
      let stopPoint = null;
      let assumptions = [...(existingAssumptions || [])];

      for (const plannedStep of plan.steps) {
        let params = pruneUndefinedDeep(
          fillTemplateWithContext(
            plannedStep.paramsTemplate,
            plannedStep.action,
            knownContext,
            plan.promptHints,
            executionState
          )
        );

        const vdmiHydration = await this.hydrateVdmiStepParams(ctx, {
          plannedStep,
          params,
          knownContext,
          executionState,
        });
        params = pruneUndefinedDeep(vdmiHydration.params || params);

        if (vdmiHydration.stopPoint) {
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: vdmiHydration.stopPoint.reasonCode,
            message: vdmiHydration.stopPoint.message,
            blockedStep: plannedStep.step,
          });
          stopPoint = this.buildStopPoint({
            reasonCode: vdmiHydration.stopPoint.reasonCode,
            message: vdmiHydration.stopPoint.message,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : vdmiHydration.stopPoint.status,
            placeholder: {
              ...placeholder,
              blockedAction: plannedStep.action,
              missingParams: vdmiHydration.stopPoint.missingParams,
            },
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'blocked',
            params,
            missingInputs: vdmiHydration.stopPoint.missingParams || [],
          });
          break;
        }

        const missingInputs = getMissingInputs(plannedStep.action, params);

        if (missingInputs.length > 0) {
          if (skipGapForMissingInputs) {
            stopPoint = {
              reasonCode: 'MISSING_INPUTS',
              message: `Missing inputs for ${plannedStep.action}: ${missingInputs.join(', ')}`,
              blockedStep: plannedStep.step,
              blockedAction: plannedStep.action,
              missingParams: missingInputs,
              status: 'missing-inputs',
            };
          } else {
            const placeholder = await this.markRoutingGap(ctx, {
              reasonCode: 'MISSING_INPUTS',
              message: `Step ${plannedStep.step} cannot run because required inputs are missing: ${missingInputs.join(', ')}`,
              blockedStep: plannedStep.step,
            });
            stopPoint = this.buildStopPoint({
              reasonCode: 'MISSING_INPUTS',
              message: `Missing inputs for ${plannedStep.action}: ${missingInputs.join(', ')}`,
              blockedStep: plannedStep.step,
              status: placeholder ? 'interface-placeholder' : 'missing-inputs',
              placeholder: {
                ...placeholder,
                blockedAction: plannedStep.action,
                missingParams: missingInputs,
              },
            });
          }
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'blocked',
            params,
            missingInputs,
          });
          break;
        }

        try {
          const result = await ctx.call(plannedStep.action, params, { meta: ctx.meta });
          const normalizedData = result && typeof result === 'object' && result.data !== undefined
            ? result.data
            : result;
          executionState.stepResults[plannedStep.step] = {
            data: normalizedData,
            raw: result,
            params,
          };
          completedSteps += 1;
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'completed',
            params,
            result,
          });

          if (plannedStep.action === 'grid-operations.marketPartners') {
            const resolvedList = Array.isArray(result?.data?.results)
              ? result.data.results
              : (Array.isArray(result?.results) ? result.results : []);

            if (resolvedList.length === 0) {
              const nextStep = plan.steps.find((candidate) => candidate.step === plannedStep.step + 1);
              stopPoint = {
                reasonCode: 'MISSING_INPUTS',
                message: 'Kein eindeutiger Netzbetreiber-Treffer aus den vorhandenen Angaben.',
                blockedStep: nextStep?.step || plannedStep.step + 1,
                blockedAction: nextStep?.action || null,
                missingParams: ['operatorEvidence'],
                status: 'evidence-gap',
              };
              break;
            }
          }

          if (plannedStep.action === 'grid-operations.vnbLookup') {
            const consistency = this.classifyLocationOperatorConsistency({
              knownContext,
              promptHints: plan.promptHints,
              steps,
            });
            if (consistency?.status === 'unverified' || consistency?.status === 'mismatch') {
              // Store unverified location/operator assumption for downstream synthesis
              const existingAssumption = assumptions.find(
                (a) => a.type === 'location_operator_unverified'
              );
              if (!existingAssumption) {
                assumptions.push({
                  type: 'location_operator_unverified',
                  location: consistency.hints?.projectLocation || '',
                  assertedGridOperatorName: consistency.hints?.assertedOperator || '',
                  matchedGridOperatorName: consistency.hints?.matchedOperatorName || '',
                  status: consistency.status,
                  requiredEvidence: [
                    'Netzanschlusszusage/BKZ',
                    'BDEW-Code',
                    'Marktlokation',
                    'Netzanschlusspunkt',
                  ],
                  createdAtStep: plannedStep.step,
                  createdAtTurn: new Date().toISOString(),
                });
              }
              stopPoint = {
                reasonCode: 'MISSING_INPUTS',
                message: 'Standort/Netzbetreiber-Zuständigkeit ist noch nicht belastbar verifiziert.',
                blockedStep: plannedStep.step,
                blockedAction: plannedStep.action,
                missingParams: ['operatorEvidence'],
                status: 'evidence-gap',
                locationOperatorConsistency: consistency.status,
                evidenceHints: consistency.hints,
                questionTextOverride: this.buildOperatorEvidenceQuestion(consistency),
              };
              break;
            }
          }
        } catch (error) {
          const placeholder = await this.markRoutingGap(ctx, {
            reasonCode: isActionUnavailable(error) ? 'UNSUPPORTED_CHAIN' : 'ACTION_FAILED',
            message: error.message,
            blockedStep: plannedStep.step,
          });
          stopPoint = this.buildStopPoint({
            reasonCode: isActionUnavailable(error) ? 'UNSUPPORTED_CHAIN' : 'ACTION_FAILED',
            message: error.message,
            blockedStep: plannedStep.step,
            status: placeholder ? 'interface-placeholder' : 'action-error',
            placeholder,
          });
          steps.push({
            step: plannedStep.step,
            action: plannedStep.action,
            status: 'failed',
            params,
            error: error.message,
          });
          break;
        }
      }

      if (!stopPoint && plan.status === 'partial') {
        const placeholder = await this.markRoutingGap(ctx, {
          reasonCode: 'UNSUPPORTED_CHAIN',
          message: plan.warnings[0] || 'Unsupported chained domains require manual continuation.',
          blockedStep: completedSteps + 1,
        });
        stopPoint = this.buildStopPoint({
          reasonCode: 'UNSUPPORTED_CHAIN',
          message: plan.warnings[0] || 'Unsupported chained domains require manual continuation.',
          blockedStep: completedSteps + 1,
          status: placeholder ? 'interface-placeholder' : 'unsupported-chain',
          placeholder,
        });
      }

      return {
        status: stopPoint ? 'partial' : 'completed',
        completedSteps,
        steps,
        stopPoint,
        message,
        assumptions,
      };
    },

    normalizeComparableText(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, ' ')
        .trim();
    },

    extractLookupResults(step = {}) {
      const result = step?.result;
      if (!result || typeof result !== 'object') {
        return [];
      }
      if (Array.isArray(result?.data?.results)) {
        return result.data.results;
      }
      if (Array.isArray(result?.results)) {
        return result.results;
      }
      if (Array.isArray(result?.data?.data?.results)) {
        return result.data.data.results;
      }
      return [];
    },

    classifyLocationOperatorConsistency({ knownContext = {}, promptHints = {}, steps = [] } = {}) {
      const assertedOperator =
        knownContext?.assertedGridOperatorName
        || promptHints?.assertedGridOperatorName
        || promptHints?.gridOperatorName
        || knownContext?.gridOperatorName
        || '';
      const projectLocation =
        knownContext?.location
        || promptHints?.location
        || promptHints?.city
        || '';

      if (!assertedOperator || !projectLocation) {
        return null;
      }

      const marketPartnerStep = steps.find((step) => step?.action === 'grid-operations.marketPartners' && step?.status === 'completed');
      const vnbLookupStep = steps.find((step) => step?.action === 'grid-operations.vnbLookup' && step?.status === 'completed');
      const partnerResults = this.extractLookupResults(marketPartnerStep);
      const topHit = partnerResults[0] || null;

      const matchedOperatorName = String(topHit?.name || vnbLookupStep?.result?.operator?.name || '').trim();
      const lookupCity = String(
        topHit?.contacts?.[0]?.city
        || vnbLookupStep?.result?.operator?.city
        || ''
      ).trim();

      const normalizedAsserted = this.normalizeComparableText(assertedOperator);
      const normalizedMatched = this.normalizeComparableText(matchedOperatorName);
      const operatorMatches =
        !normalizedMatched
        || normalizedMatched.includes(normalizedAsserted)
        || normalizedAsserted.includes(normalizedMatched);

      if (!operatorMatches) {
        return {
          status: 'mismatch',
          hints: {
            assertedOperator,
            matchedOperatorName,
            projectLocation,
            lookupCity,
          },
        };
      }

      const hardMismatch = Boolean(
        vnbLookupStep?.result?.operator?.isResponsible === false
        || vnbLookupStep?.result?.operator?.zustaendig === false
        || vnbLookupStep?.result?.responsibilityMatch === false
      );

      if (hardMismatch) {
        return {
          status: 'mismatch',
          hints: {
            assertedOperator,
            matchedOperatorName,
            projectLocation,
            lookupCity,
          },
        };
      }

      const hardVerified = Boolean(
        vnbLookupStep?.result?.operator?.isResponsible === true
        || vnbLookupStep?.result?.operator?.zustaendig === true
        || vnbLookupStep?.result?.responsibilityMatch === true
        || vnbLookupStep?.result?.operator?.evidenceVerified === true
        || vnbLookupStep?.result?.operator?.verified === true
      );

      const normalizedProjectLocation = this.normalizeComparableText(projectLocation);
      const normalizedLookupCity = this.normalizeComparableText(lookupCity);
      const locationMatches = Boolean(
        normalizedProjectLocation
        && normalizedLookupCity
        && (
          normalizedLookupCity.includes(normalizedProjectLocation)
          || normalizedProjectLocation.includes(normalizedLookupCity)
        )
      );

      if (hardVerified && locationMatches) {
        return {
          status: 'verified',
          hints: {
            assertedOperator,
            matchedOperatorName,
            projectLocation,
            lookupCity,
          },
        };
      }

      return {
        status: 'unverified',
        hints: {
          assertedOperator,
          matchedOperatorName,
          projectLocation,
          lookupCity,
        },
      };
    },

    buildOperatorEvidenceQuestion(consistency = {}) {
      const hint = consistency?.hints || {};
      const locationText = hint.projectLocation ? ` für den Standort ${hint.projectLocation}` : '';
      return `Ich kann die Zuständigkeit${locationText} noch nicht belastbar bestätigen. Für die Due Diligence brauche ich bitte Netzanschlusszusage/BKZ, Marktlokation, Netzanschlusspunkt oder den zuständigen BDEW-Code.`;
    },

    /**
     * Check if execution result contains structured data worth presenting.
     */
    hasStructuredExecutionResult(execution = {}) {
      if (!execution || !Array.isArray(execution.steps)) {
        return false;
      }

      // Check if any step result has structured data
      for (const step of execution.steps) {
        const result = step.result || {};
        if (this.hasStructuredData(result)) {
          return true;
        }

        const dossier = result?.dossier;
        if (
          dossier
          && typeof dossier === 'object'
          && (
            (dossier.task && typeof dossier.task === 'object')
            || Array.isArray(dossier.evidenceGaps)
            || Array.isArray(dossier.forbiddenAssumptions)
            || Array.isArray(dossier.nextActions)
          )
        ) {
          return true;
        }
      }

      return false;
    },

    /**
     * Extract domain result from execution steps (combined result of all steps).
     */
    extractDomainResultFromExecution(execution = {}) {
      if (!Array.isArray(execution.steps) || execution.steps.length === 0) {
        return null;
      }

      const merged = {};
      const vdmiTasksById = new Map();
      const vdmiEvidenceGaps = [];
      const vdmiEvidenceRequirements = [];
      const vdmiForbiddenAssumptions = [];
      const vdmiNextActions = [];
      const vdmiRisks = [];
      let vdmiExpectedStatus;
      let vdmiDecisionStatus;
      let vdmiMatrixId;
      let vdmiMatrixName;
      let vdmiMatrixStatus;

      const allowedScalarKeys = [
        'count',
        'value',
        'metric',
        'unit',
        'answer',
        'source',
        'asOf',
        'expectedStatus',
        'decisionStatus',
        'highestRole',
      ];

      const allowedArrayKeys = [
        'sources',
        'warnings',
        'roles',
        'rolesByTask',
        'evidenceGaps',
        'evidenceRequirements',
        'forbiddenAssumptions',
        'nextActions',
        'assetRisks',
        'risks',
        'tasks',
      ];

      const addUnique = (target, values) => {
        if (!Array.isArray(values)) return;
        for (const value of values) {
          const key = JSON.stringify(value);
          if (!target.some((item) => JSON.stringify(item) === key)) {
            target.push(value);
          }
        }
      };

      const mergeSafeResult = (result = {}) => {
        for (const key of allowedScalarKeys) {
          if (result[key] !== undefined && result[key] !== null && result[key] !== '') {
            merged[key] = result[key];
          }
        }

        for (const key of allowedArrayKeys) {
          if (Array.isArray(result[key])) {
            if (!Array.isArray(merged[key])) {
              merged[key] = [];
            }
            addUnique(merged[key], result[key]);
          }
        }

        if (result.matrix && typeof result.matrix === 'object') {
          if (!merged.matrix || typeof merged.matrix !== 'object') {
            merged.matrix = {};
          }
          if (result.matrix.id && !merged.matrix.id) {
            merged.matrix.id = result.matrix.id;
          }
          if (result.matrix.name && !merged.matrix.name) {
            merged.matrix.name = result.matrix.name;
          }
          if (result.matrix.status && !merged.matrix.status) {
            merged.matrix.status = result.matrix.status;
          }
          if (Array.isArray(result.matrix.tasks)) {
            if (!Array.isArray(merged.matrix.tasks)) {
              merged.matrix.tasks = [];
            }
            addUnique(merged.matrix.tasks, result.matrix.tasks);
          }
        }
      };

      for (const step of execution.steps) {
        const result = step.result || {};
        mergeSafeResult(result);

        const dossier = result?.dossier;
        if (!dossier || typeof dossier !== 'object') {
          continue;
        }

        const task = dossier.task && typeof dossier.task === 'object' ? dossier.task : null;
        if (!task) {
          continue;
        }

        const taskId = task.taskId || result.taskId || `vdmi_task_${vdmiTasksById.size + 1}`;
        const existingTask = vdmiTasksById.get(taskId) || {};

        const mappedTask = {
          ...existingTask,
          taskId,
        };

        const maybeAssign = (key, value) => {
          if (value !== undefined && value !== null && value !== '') {
            mappedTask[key] = value;
          }
        };

        maybeAssign('taskName', task.taskName || task.description);
        maybeAssign('phase', task.phase);
        maybeAssign('verantwortlich', Array.isArray(task.verantwortlich) ? task.verantwortlich : undefined);
        maybeAssign('durchfuehrend', Array.isArray(task.durchfuehrend) ? task.durchfuehrend : undefined);
        maybeAssign('mitwirkend', Array.isArray(task.mitwirkend) ? task.mitwirkend : undefined);
        maybeAssign('information', Array.isArray(task.information) ? task.information : undefined);
        maybeAssign('expectedStatus', dossier.expectedStatus || task.expectedStatus);
        maybeAssign('decisionStatus', dossier.decisionStatus || task.decisionStatus);
        maybeAssign('roles', Array.isArray(task.roles) ? task.roles : undefined);
        maybeAssign('rolesByTask', Array.isArray(task.rolesByTask) ? task.rolesByTask : undefined);
        maybeAssign('highestRole', task.highestRole);

        const evidenceRequirements = Array.isArray(dossier?.evidence?.requirements)
          ? dossier.evidence.requirements
          : (Array.isArray(task.evidenceRequirements) ? task.evidenceRequirements : undefined);
        maybeAssign('evidenceRequirements', evidenceRequirements);

        const evidenceGaps = Array.isArray(dossier.evidenceGaps)
          ? dossier.evidenceGaps
          : (Array.isArray(task.evidenceGaps) ? task.evidenceGaps : undefined);
        maybeAssign('evidenceGaps', evidenceGaps);

        const forbiddenAssumptions = Array.isArray(dossier.forbiddenAssumptions)
          ? dossier.forbiddenAssumptions
          : (Array.isArray(task.forbiddenAssumptions) ? task.forbiddenAssumptions : undefined);
        maybeAssign('forbiddenAssumptions', forbiddenAssumptions);

        const nextActions = Array.isArray(dossier.nextActions)
          ? dossier.nextActions
          : (Array.isArray(task.nextActions) ? task.nextActions : undefined);
        maybeAssign('nextActions', nextActions);

        const taskRisks = Array.isArray(dossier.assetRisks)
          ? dossier.assetRisks
          : (Array.isArray(task.assetRisks) ? task.assetRisks : undefined);
        maybeAssign('assetRisks', taskRisks);
        maybeAssign('risks', Array.isArray(dossier.risks) ? dossier.risks : task.risks);

        vdmiTasksById.set(taskId, mappedTask);

        addUnique(vdmiEvidenceGaps, evidenceGaps);
        addUnique(vdmiEvidenceRequirements, evidenceRequirements);
        addUnique(vdmiForbiddenAssumptions, forbiddenAssumptions);
        addUnique(vdmiNextActions, nextActions);
        addUnique(vdmiRisks, taskRisks || []);
        addUnique(vdmiRisks, Array.isArray(dossier.risks) ? dossier.risks : []);

        if (vdmiExpectedStatus === undefined && mappedTask.expectedStatus !== undefined) {
          vdmiExpectedStatus = mappedTask.expectedStatus;
        }
        if (vdmiDecisionStatus === undefined && mappedTask.decisionStatus !== undefined) {
          vdmiDecisionStatus = mappedTask.decisionStatus;
        }
        if (!vdmiMatrixId) {
          vdmiMatrixId = result.matrixId || task.matrixId;
        }
        if (!vdmiMatrixName) {
          vdmiMatrixName = result.matrixName || dossier.matrixName || task.matrixName;
        }
        if (!vdmiMatrixStatus) {
          vdmiMatrixStatus = result.matrixStatus || dossier.matrixStatus || task.matrixStatus;
        }
      }

      const vdmiTasks = Array.from(vdmiTasksById.values());
      if (vdmiTasks.length > 0) {
        const matrix = {
          tasks: vdmiTasks,
        };

        if (vdmiMatrixId) matrix.id = vdmiMatrixId;
        if (vdmiMatrixName) matrix.name = vdmiMatrixName;
        if (vdmiMatrixStatus) matrix.status = vdmiMatrixStatus;

        const vdmiDomainResult = {
          ...merged,
          matrix,
        };

        if (vdmiEvidenceGaps.length > 0) {
          vdmiDomainResult.evidenceGaps = vdmiEvidenceGaps;
        }
        if (vdmiEvidenceRequirements.length > 0) {
          vdmiDomainResult.evidenceRequirements = vdmiEvidenceRequirements;
        }
        if (vdmiForbiddenAssumptions.length > 0) {
          vdmiDomainResult.forbiddenAssumptions = vdmiForbiddenAssumptions;
        }
        if (vdmiNextActions.length > 0) {
          vdmiDomainResult.nextActions = vdmiNextActions;
        }
        if (vdmiRisks.length > 0) {
          vdmiDomainResult.risks = vdmiRisks;
        }
        if (vdmiExpectedStatus !== undefined) {
          vdmiDomainResult.expectedStatus = vdmiExpectedStatus;
        }
        if (vdmiDecisionStatus !== undefined) {
          vdmiDomainResult.decisionStatus = vdmiDecisionStatus;
        }

        return vdmiDomainResult;
      }

      return Object.keys(merged).length > 0 ? merged : null;
    },

    /**
     * Check if an object contains structured data fields (not just generic strings).
     */
    hasStructuredData(obj = {}) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return false;
      }

      const dossier = obj?.dossier;
      if (
        dossier
        && typeof dossier === 'object'
        && (
          (dossier.task && typeof dossier.task === 'object')
          || Array.isArray(dossier.evidenceGaps)
          || Array.isArray(dossier.forbiddenAssumptions)
          || Array.isArray(dossier.nextActions)
        )
      ) {
        return true;
      }

      const structuredKeys = [
        'matrix', 'tasks', 'roles', 'rolesByTask', 'highestRole',
        'evidenceGaps', 'evidenceRequirements', 'assetRisks', 'risks',
        'items', 'rows', 'peers', 'variants', 'count', 'value', 'metric', 'answer',
        'source', 'sources', 'asOf',
        'forbiddenAssumptions', 'expectedStatus', 'decisionStatus', 'nextActions', 'status',
      ];

      return structuredKeys.some((key) => {
        const val = obj[key];
        return val !== undefined && val !== null && val !== '';
      });
    },

    async loadUserProfile(ctx, tenantId, userId) {
      try {
        const namespace = tenantNamespace(PROFILE_NAMESPACE, tenantId);
        const doc = await ctx.call(
          'object-store.get',
          { namespace, key: userId },
          { meta: ctx.meta }
        );
        return doc?.payload || { userId, preferences: {} };
      } catch (error) {
        if (isNotFound(error)) {
          return { userId, preferences: {} };
        }
        throw error;
      }
    },

    async loadSession(ctx, tenantId, sessionId, userId, options = {}) {
      const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
      const userProfile = await this.loadUserProfile(ctx, tenantId, userId);
      const createIfMissing = Boolean(options.createIfMissing);

      try {
        const doc = await ctx.call(
          'object-store.get',
          { namespace, key: sessionId },
          { meta: ctx.meta }
        );
        const payload = doc?.payload || {};
        assertNoL4RawInPersistedState(payload);
        return {
          id: sessionId,
          tenantId,
          userId,
          l1: payload.l1 || { tenantFacts: [] },
          l2: payload.l2 || { userProfile },
          l3: {
            history: Array.isArray(payload?.l3?.history) ? payload.l3.history : [],
            fileAttachments: Array.isArray(payload?.l3?.fileAttachments)
              ? payload.l3.fileAttachments
              : [],
            summary: payload?.l3?.summary || null,
            compressed: Boolean(payload?.l3?.compressed),
            onboardingQuestions: Array.isArray(payload?.l3?.onboardingQuestions)
              ? payload.l3.onboardingQuestions
              : [],
            assumptions: Array.isArray(payload?.l3?.assumptions)
              ? payload.l3.assumptions
              : [],
          },
          createdAt: payload.createdAt || new Date().toISOString(),
          updatedAt: payload.updatedAt || null,
        };
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }

        if (!createIfMissing) {
          throw new MoleculerClientError(
            `Personal-Agent session not found: ${sessionId}`,
            404,
            'OBJECT_NOT_FOUND',
            { sessionId }
          );
        }

        return {
          id: sessionId,
          tenantId,
          userId,
          l1: { tenantFacts: [] },
          l2: { userProfile },
          l3: {
            history: [],
            fileAttachments: [],
            summary: null,
            compressed: false,
            onboardingQuestions: [],
            assumptions: [],
          },
          createdAt: new Date().toISOString(),
          updatedAt: null,
        };
      }
    },

    async persistSession(ctx, tenantId, sessionId, payload) {
      const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
      try {
        await ctx.call(
          'object-store.put',
          { namespace, key: sessionId, payload },
          { meta: ctx.meta }
        );
      } catch (error) {
        throw new MoleculerClientError(
          `Unable to persist personal-agent session: ${error.message}`,
          500,
          'PERSONAL_AGENT_PERSIST_FAILED'
        );
      }
    },
  },
};
