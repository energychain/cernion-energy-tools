'use strict';

// personal-agent actions chunk 1/1 — extracted verbatim from
// services/personal-agent.service.js as part of the v0.99 file-size modularization.
// Contains: askCernionAgent, answerDossier, chat, getSession, pullProactiveMessages, acknowledgeProactiveMessage, resetSession, dream-pipeline, getDreamStatus, getDreamAudit

const {
  crypto,
  MoleculerClientError,
  jobStore,
  getTenantId,
  tenantNamespace,
  buildContextStack,
  buildPersistableSessionState,
  synthesizeAndPurgeLayer4,
  assertNoL4RawInPersistedState,
  resolveContextMutation,
  buildDecisionFrameDirectives,
  sanitizeBootstrapContext,
  sanitizeScopedDatapoints,
  PERSONAL_AGENT_STATES,
  createStateMachine,
  transitionStateMachine,
  deriveTerminalState,
  summarizeStateMachine,
  createExecutionStateGraph,
  advanceExecutionStateGraph,
  summarizeExecutionStateGraph,
  createMessageFingerprint,
  createTurnGraph,
  addNode,
  addEdge,
  finalizeTurnGraph,
  summarizeTurnGraph,
  addWorkflowPlanNode,
  buildConsultationExecutionPlan,
  executeWithReceipt,
  decideRoutingTarget,
  buildExecutionGapResponse,
  createExecutionTrace,
  createToolCallTracker,
  EXECUTION_MODES,
  CHAT_MODES,
  normalizeExecutionMode,
  normalizeChatMode,
  detectChatMode,
  detectRequestedDomains,
  buildExecutionPlan,
  applyMissingContextFallback,
  extractPromptHints,
  shouldBlockSynthesisOnGaps,
  buildEvidenceGapPresentation,
  extractSourceActions,
  evaluatePresentationGrounding,
  scheduleDream,
  cancelDream,
  isDreamPending,
  DREAM_AUDIT_NAMESPACE,
  extractBlueprintPolicy,
  checkStickinessRetain,
  detectBlueprintIntent,
  findBlueprintByPrimaryIntent,
  loadBlueprint,
  compileReadOnlyExecutionPlan,
  describeNoPlanReason,
  buildAskBlueprintAnswer,
  findClarificationPolicyMatch,
  resolveLocationFromText,
  buildLocationContextPatch,
  buildLocationResolutionTrace,
  pushPlanFrame,
  markTopFrameCompleted,
  findResumableParentFrame,
  resumeParentPlanFrame,
  mergeResolvedParamsIntoPlan,
  hasRecentIntentLoop,
  assertNoRecentIntentLoop,
  buildZnpContextSnapshot,
  WORK_LOG_ACTIONS,
  createTurnWorkLog,
  getSafePersonaLabel,
  REFLECTION_OUTPUT_SCHEMA,
  buildReflectionPrompt,
  validateReflectionPatch,
  hasScopeBlockedOrMissingSteps,
  DOSSIER_USER_CONTEXT,
  DOSSIER_ANSWER_MODE,
  DOSSIER_COMPLETION_STATE,
  computeTimeBudget,
  classifyDossierContext,
  buildDossierMarkdown,
  buildRendererSystemHint,
  normalizeKnowledgeSpaceContext,
  buildReasoningSummary,
  buildFollowUpMetadata,
  generateDossierId,
  resolveDossierSubstantiveAnswer,
  resolveDossierContract,
  describeDossierContract,
  buildSlimDossierMarkdown,
  getDossierHydrationRule,
  isDossierRuleSafetyRejected,
  OPENAPI_TAG,
  SESSION_NAMESPACE,
  DOSSIER_LOW_EVIDENCE_NAMESPACE,
  PROFILE_NAMESPACE,
  buildDossierSafePlanningView,
  DOSSIER_TIMEOUT_WARNING_THRESHOLD_MS,
  DOSSIER_SESSION_NAMESPACE,
  isNotFound,
  isActionUnavailable,
  sanitizeKnownContextForReflectionPrompt,
  flattenScopeViolations,
  buildReceiptReflectionSummary,
  buildReceiptReflectionAuditSeed,
  isConsultationDebugEnabled,
  compactString,
  extractCopilotAnalysisSignals,
  deriveCopilotSearchTerm,
  mapCopilotDomainToSearchDomain,
  buildCopilotContextQueries,
  copilotDossierEvidenceHasStrictQueryRelevance,
  buildDossierLowEvidenceKey,
  detectDossierPreliminaryAnswerRequest,
  detectDossierFinalAnswerRequest,
  buildDossierTurnSummary,
  buildDossierPriorConversationContext,
  detectDossierEvCo2ChargingRequest,
  buildDossierCo2ChargingWindowEvidence,
  detectOpenEvidenceRequirementsQuery,
  buildDossierProjectFactEntries,
  mapDossierLowEvidenceToEntry,
  dedupeDossierEvidence,
} = require('./shared');

module.exports = {
  askCernionAgent: {
    params: {
      question: { type: 'string', min: 1, trim: true, max: 8000 },
      sessionId: { type: 'string', optional: true, trim: true, max: 120 },
      context: { type: 'object', optional: true, default: {} },
      // Canonical structured input values for Blueprint REST-plan compilation
      // (e.g. assetType, location, minCapacity). Kept separate from `context`
      // (tenant/session metadata) — see energychain/cernion-energy-tools#271.
      inputs: { type: 'object', optional: true, default: {} },
      domain: {
        type: 'enum',
        optional: true,
        values: ['auto', 'vnb', 'vdmi', 'znp', 'grid-connection', 'edm', 'finance', 'process'],
        default: 'auto',
      },
      mode: {
        type: 'enum',
        optional: true,
        values: ['answer', 'evidence', 'process_check', 'prepare_intent'],
        default: 'answer',
      },
      maxEvidence: {
        type: 'number',
        optional: true,
        integer: true,
        min: 1,
        max: 12,
        default: 5,
        convert: true,
      },
    },
    openapi: {
      operationId: 'askCernionAgent',
      tags: [OPENAPI_TAG],
      summary: 'Ask Cernion for compact evidence, guardrails and process context',
      description:
        'Read-only Copilot action. Returns compact structured evidence and guardrails from Cernion entity search, Knowledge RAG, datapoints and object-store context. It does not run the heavy Personal Agent chat path and does not execute, confirm, sign, delete or modify process data.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['question'],
              properties: {
                question: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 8000,
                  description: 'User question to answer with Cernion evidence and process context.',
                  example: 'Welcher VNB ist in Wiesloch zuständig?',
                },
                sessionId: {
                  type: 'string',
                  description: 'Optional stable Copilot conversation/session identifier.',
                },
                context: {
                  type: 'object',
                  additionalProperties: true,
                  description: 'Optional tenant, user, object, process or document context.',
                },
                inputs: {
                  type: 'object',
                  additionalProperties: true,
                  description:
                    'Optional canonical structured input values (e.g. assetType, location, minCapacity, maxCapacity, commissioningYear, limit) for Blueprint read-only REST-plan compilation. Separate from `context`.',
                  example: {
                    assetType: 'solar',
                    location: '69168',
                    minCapacity: 10,
                    maxCapacity: 13,
                    commissioningYear: 2025,
                    limit: 100,
                  },
                },
                domain: {
                  type: 'string',
                  enum: [
                    'auto',
                    'vnb',
                    'vdmi',
                    'znp',
                    'grid-connection',
                    'edm',
                    'finance',
                    'process',
                  ],
                  default: 'auto',
                  description: 'Optional domain hint for routing.',
                },
                mode: {
                  type: 'string',
                  enum: ['answer', 'evidence', 'process_check', 'prepare_intent'],
                  default: 'answer',
                  description:
                    'Controls whether the answer should focus on evidence or process checks.',
                },
                maxEvidence: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 12,
                  default: 5,
                  description: 'Maximum number of evidence items returned.',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Compact Cernion answer for Copilot composition',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'success',
                  'shortAnswer',
                  'groundingAnswer',
                  'evidence',
                  'processContext',
                  'openQuestions',
                  'recommendedNextSteps',
                  'allowedActions',
                  'forbiddenActions',
                ],
                properties: {
                  success: { type: 'boolean' },
                  sessionId: { type: 'string' },
                  question: { type: 'string' },
                  shortAnswer: { type: 'string' },
                  groundingAnswer: {
                    type: 'string',
                    description:
                      'Prompt-ready Cernion grounding package for Copilot composition. Contains user question, answer, evidence, guardrails, risks, open questions and answer rules in one text field.',
                  },
                  consultingBrief: {
                    type: 'string',
                    description:
                      'Optional backend-generated consulting brief for Copilot. It structures the evidence but is not a standalone source of facts.',
                  },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  evidence: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        source: { type: 'string' },
                        value: { type: 'string' },
                        retrievalHint: {
                          type: 'string',
                          description:
                            'Optional vector/retrieval text for topic orientation; not standalone answer evidence.',
                        },
                      },
                    },
                  },
                  processContext: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  evidenceBySource: {
                    type: 'object',
                    additionalProperties: true,
                    description:
                      'Evidence grouped by source: entities, knowledge, datapoints, and object-store objects.',
                  },
                  guardrails: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      'Instructions Copilot must apply before composing the final answer.',
                  },
                  entities: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  risks: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  openQuestions: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  recommendedNextSteps: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  allowedActions: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  forbiddenActions: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  routing: {
                    type: 'object',
                    additionalProperties: true,
                  },
                  resolved: {
                    type: 'object',
                    description:
                      'Blueprint/Capability resolution outcome (energychain/cernion-energy-tools#271). kind is "blueprint" when a read-only execution plan was compiled, "none" otherwise.',
                    properties: {
                      kind: { type: 'string', enum: ['blueprint', 'none'] },
                      id: { type: 'string' },
                      version: { type: 'string' },
                      source: { type: 'string' },
                    },
                  },
                  canonicalInputs: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'Normalized inputs used to compile the execution plan, if any.',
                  },
                  recommendedEndpoints: {
                    type: 'array',
                    description:
                      'Read-only endpoint recommendations (energychain/cernion-energy-tools#271 architecture follow-up). Cernion recommends which approved read-only endpoint(s) are the evidence surface for this request and what each result set means fachlich — it does not execute them or synthesize a final answer; that is the responsibility of the consuming agent/orchestrator. May contain more than one complementary endpoint.',
                    items: {
                      type: 'object',
                      properties: {
                        method: { type: 'string', example: 'GET' },
                        path: { type: 'string', example: '/api/assets/solar' },
                        query: { type: 'object', additionalProperties: true },
                        resultSemantics: {
                          type: 'object',
                          description: 'Fachliche Bedeutung des Result-Sets dieses Endpoints.',
                          properties: {
                            kind: { type: 'string', example: 'asset_list' },
                            description: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                  execution: {
                    type: 'object',
                    nullable: true,
                    description:
                      'Alias of recommendedEndpoints[0] for backward compatibility with #271 consumers that only read a single plan, or null when none is available.',
                    properties: {
                      mode: { type: 'string', example: 'read_only_rest_plan' },
                      method: { type: 'string', example: 'GET' },
                      path: { type: 'string', example: '/api/assets/solar' },
                      query: { type: 'object', additionalProperties: true },
                    },
                  },
                  policy: {
                    type: 'object',
                    properties: {
                      readOnly: { type: 'boolean' },
                      sideEffects: { type: 'string' },
                      tenantScoped: { type: 'boolean' },
                      externalSideEffects: { type: 'boolean' },
                    },
                  },
                  noPlanReason: {
                    type: 'string',
                    description:
                      'Present when resolved.kind is "none" — explains why no executable read-only plan was available.',
                  },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const domain = ctx.params.domain || 'auto';
      const mode = ctx.params.mode || 'answer';
      const context = ctx.params.context || {};
      const inputs = ctx.params.inputs || {};
      const maxEvidence = ctx.params.maxEvidence || 5;

      // Blueprint-aware read-only REST plan (energychain/cernion-energy-tools#271):
      // if an active read-only Blueprint can compile this question into a single
      // GET service call, return that plan directly so the Sidecar can execute it
      // via its own generic REST proxy, without Cernion executing anything itself
      // and without the Sidecar needing any domain-specific endpoint knowledge.
      // `inputs` (canonical structured values) and `context` (tenant/session
      // metadata) are merged only for plan compilation — `context` alone is
      // still used unchanged below for the evidence-planner fallback path.
      const restPlan = compileReadOnlyExecutionPlan({
        question: ctx.params.question,
        context: { ...context, ...inputs },
        broker: ctx.broker,
      });

      if (restPlan.ok) {
        return buildAskBlueprintAnswer(restPlan, {
          question: ctx.params.question,
          sessionId: ctx.params.sessionId,
        });
      }

      const searchTerm = deriveCopilotSearchTerm(ctx.params.question);
      const analysisSignals = extractCopilotAnalysisSignals(ctx.params.question);
      const searchDomain = mapCopilotDomainToSearchDomain(domain);
      const queryTerms = buildCopilotContextQueries({
        question: ctx.params.question,
        searchTerm,
        context,
        maxItems: maxEvidence,
      });

      const [
        searchResult,
        knowledgeEvidence,
        datapointEvidence,
        objectEvidence,
        planningEvidence,
        makoKnowledgeEvidence,
      ] = await Promise.all([
        this.searchCopilotEntities(ctx, { searchTerm, searchDomain, maxEvidence }),
        this.collectCopilotKnowledgeEvidence(ctx, {
          question: ctx.params.question,
          searchTerm,
          maxEvidence,
        }),
        this.collectCopilotDatapointEvidence(ctx, { queryTerms, maxEvidence }),
        this.collectCopilotObjectEvidence(ctx, { context, queryTerms, maxEvidence }),
        this.collectCopilotPlanningEvidence(ctx, { analysisSignals, maxEvidence }),
        this.collectCopilotMakoKnowledgeEvidence(ctx, {
          question: ctx.params.question,
          maxEvidence,
        }),
      ]);

      const baseAnswer = this.buildCopilotSearchAnswer({
        question: ctx.params.question,
        sessionId: ctx.params.sessionId || null,
        domain,
        mode,
        context,
        searchTerm,
        searchResult,
        knowledgeEvidence,
        datapointEvidence,
        objectEvidence,
        planningEvidence,
        makoKnowledgeEvidence,
        maxEvidence,
      });
      const enhancedAnswer = await this.enhanceCopilotAnswerWithConsultingBrief(ctx, baseAnswer, {
        context,
      });

      return {
        ...enhancedAnswer,
        resolved: { kind: 'none' },
        canonicalInputs: {},
        execution: null,
        policy: {
          readOnly: true,
          sideEffects: 'none',
          tenantScoped: true,
          externalSideEffects: false,
        },
        noPlanReason: describeNoPlanReason(restPlan),
      };
    },
  },

  answerDossier: {
    params: {
      question: { type: 'string', min: 1, trim: true, max: 8000 },
      sessionId: { type: 'string', optional: true, trim: true, max: 120 },
      domain: {
        type: 'enum',
        optional: true,
        values: [
          'auto',
          'vnb',
          'vdmi',
          'znp',
          'grid-connection',
          'edm',
          'finance',
          'process',
          'redispatch',
        ],
        default: 'auto',
      },
      mode: {
        type: 'enum',
        optional: true,
        values: ['answer_dossier', 'answer_dossier_followup'],
        default: 'answer_dossier',
      },
      maxEvidence: {
        type: 'number',
        optional: true,
        integer: true,
        min: 1,
        max: 12,
        default: 5,
        convert: true,
      },
      timeBudgetMs: {
        type: 'number',
        optional: true,
        integer: true,
        min: 5000,
        max: 60000,
        default: 30000,
        convert: true,
      },
      parentDossierId: { type: 'string', optional: true, trim: true, max: 120 },
      context: { type: 'object', optional: true, default: {} },
      dossierContract: {
        type: 'enum',
        optional: true,
        values: ['rich', 'slim'],
        default: 'rich',
      },
    },
    openapi: {
      operationId: 'answerDossier',
      tags: ['Personal Agent'],
      summary: 'Generate a Cernion Answer Dossier for external renderer consumption',
      description:
        'Produces a structured Markdown dossier containing domain reasoning, evidence, guardrails, and a final renderer instruction. External renderers (n8n, AnythingLLM) use only the dossierMarkdown to formulate prose answers — no domain knowledge required from the renderer. Maintains session state for multi-turn continuity.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['question'],
              properties: {
                question: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 8000,
                  description: 'User question or prompt.',
                },
                sessionId: {
                  type: 'string',
                  description:
                    'Stable session identifier for multi-turn continuity. Generated and returned if omitted.',
                },
                domain: {
                  type: 'string',
                  enum: [
                    'auto',
                    'vnb',
                    'vdmi',
                    'znp',
                    'grid-connection',
                    'edm',
                    'finance',
                    'process',
                    'redispatch',
                  ],
                  default: 'auto',
                },
                mode: {
                  type: 'string',
                  enum: ['answer_dossier', 'answer_dossier_followup'],
                  default: 'answer_dossier',
                  description:
                    'answer_dossier_followup continues an existing session; include parentDossierId.',
                },
                maxEvidence: { type: 'integer', minimum: 1, maximum: 12, default: 5 },
                timeBudgetMs: {
                  type: 'integer',
                  minimum: 5000,
                  maximum: 60000,
                  default: 30000,
                  description: 'Total time budget in milliseconds for dossier generation.',
                },
                parentDossierId: {
                  type: 'string',
                  description:
                    'For follow-up mode: dossierId of the previous dossier in this session.',
                },
                context: {
                  type: 'object',
                  additionalProperties: true,
                  description: 'Optional channel, surface, tenant, or user context.',
                },
                dossierContract: {
                  type: 'string',
                  enum: ['rich', 'slim'],
                  default: 'rich',
                  description:
                    "Default 'rich' preserves the existing full governance/policy dossier — no caller needs to change anything. 'slim' (#242) opts into a compact answer-payload contract (Question/Consulting Interpretation/Reasoning/Evidence/Answer Constraints/Possible Follow-Up/Renderer Instruction) for evidence-backed, non-process-risk dossiers; process-action or incomplete-evidence dossiers are always served as 'rich' regardless of this value. This is a backend contract only — existing callers (e.g. n8n flows) keep seeing 'rich' output until they explicitly set dossierContract: \"slim\".",
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Cernion Answer Dossier with structured metadata and Markdown content',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: [
                  'success',
                  'sessionId',
                  'dossierId',
                  'mode',
                  'answerMode',
                  'userContext',
                  'processStage',
                  'confidence',
                  'completionState',
                  'dossierMarkdown',
                  'rendererSystemHint',
                  'clarificationQuestions',
                  'finalDossierRequested',
                  'answerQuality',
                ],
                properties: {
                  success: { type: 'boolean' },
                  sessionId: { type: 'string' },
                  dossierId: { type: 'string' },
                  mode: { type: 'string', enum: ['answer_dossier', 'answer_dossier_followup'] },
                  answerMode: {
                    type: 'string',
                    enum: [
                      'clarification_needed',
                      'management_brief',
                      'evidence_collection',
                      'process_check',
                      'prepare_intent',
                      'partial_async',
                      'final_answer',
                    ],
                  },
                  userContext: {
                    type: 'string',
                    enum: [
                      'unknown',
                      'mayor',
                      'management',
                      'target_grid_planning',
                      'regulatory',
                      'technical_operator',
                      'process_action',
                    ],
                  },
                  processStage: {
                    type: 'string',
                    enum: [
                      'initial',
                      'context_clarification',
                      'evidence_collection',
                      'synthesis',
                      'async_pending',
                      'intent_prepared',
                      'action_requested',
                      'completed',
                    ],
                  },
                  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                  completionState: {
                    type: 'string',
                    enum: ['completed', 'partial', 'async_pending'],
                  },
                  dossierVersion: {
                    type: 'integer',
                    description: 'Turn index within this session, starting at 1.',
                  },
                  parentDossierId: { type: 'string', nullable: true },
                  latestDossierId: { type: 'string' },
                  followUp: {
                    type: 'object',
                    nullable: true,
                    description: 'Follow-up instructions for partial/async dossiers.',
                  },
                  priorConversationContext: {
                    type: 'object',
                    description:
                      'Compact carry-forward context from previous Answer Dossier turns in the same session.',
                  },
                  knowledgeSpace: {
                    type: 'object',
                    description:
                      'Authenticated tenant/session/conversation scope used to build the dossier. context.tenantId is audit context only and cannot override the authenticated tenant.',
                  },
                  timeBudget: { type: 'object' },
                  timeoutWarning: { type: 'string', nullable: true },
                  dossierMarkdown: { type: 'string' },
                  clarificationQuestions: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                      "Focused clarification questions derived from the same evidence-gap signals as dossierMarkdown's Missing Evidence section. Empty when no clarification is needed or when finalDossierRequested is true.",
                  },
                  finalDossierRequested: {
                    type: 'boolean',
                    description:
                      'Deterministic detection of whether the user asked for a final answer instead of another clarification turn.',
                  },
                  finalDossierMarkdown: {
                    type: 'string',
                    nullable: true,
                    description:
                      'Renderer package variant that suppresses clarification-question instructions while still surfacing evidence gaps as caveats. Null unless finalDossierRequested is true.',
                  },
                  answerQuality: {
                    type: 'object',
                    description:
                      'Evidence-first policy signals (#238) describing what the dossier instructions require, not a verified property of any rendered prose answer.',
                    properties: {
                      usedRetrievedEvidence: {
                        type: 'boolean',
                        description:
                          'Whether relevant tool/MCP evidence was retrieved for this turn.',
                      },
                      substantiveAnswerInstructed: {
                        type: 'boolean',
                        description:
                          'Whether the dossier instructs an answer-first response (evidence-derived, final-mode, or flagged preliminary) rather than a defensive non-answer.',
                      },
                      defensiveNonAnswer: {
                        type: 'boolean',
                        description:
                          'Complement of substantiveAnswerInstructed — true when the dossier falls back to asking for more before answering.',
                      },
                    },
                  },
                  dossierPlanning: {
                    type: 'object',
                    description:
                      'Dossier-safe planning view of the Capability Broker recommendation. Planning only: no consequential actions are executed from this field.',
                  },
                  rendererSystemHint: { type: 'string' },
                  auditTrail: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      // Auth guard — must have at least one auth signal from the request
      const hasAuth = !!(ctx.meta.authUser || ctx.meta.apiToken || ctx.meta.cernionToken);
      if (!hasAuth) {
        throw new MoleculerClientError(
          'Authentication required. Provide a valid API token or session token.',
          401,
          'AUTH_REQUIRED'
        );
      }

      const {
        question,
        domain = 'auto',
        mode = 'answer_dossier',
        maxEvidence = 5,
        timeBudgetMs = 30000,
        parentDossierId = null,
        context = {},
        dossierContract: requestedDossierContract = 'rich',
      } = ctx.params;

      // context.tenantId must never override the authenticated tenantId
      const tenantId = getTenantId(ctx);
      const requestedTenantId =
        typeof context?.tenantId === 'string' && context.tenantId.trim()
          ? context.tenantId.trim()
          : null;
      const tenantScopeStatus =
        requestedTenantId && requestedTenantId !== tenantId
          ? 'context_tenant_ignored_auth_tenant_used'
          : requestedTenantId
            ? 'context_tenant_matches_auth_tenant'
            : 'auth_tenant_used';
      if (requestedTenantId && requestedTenantId !== tenantId) {
        this.logger?.warn?.(
          `answerDossier: context.tenantId (${requestedTenantId}) differs from authenticated tenantId (${tenantId}) — ignoring context.tenantId`
        );
      }
      const userId = ctx.meta?.authUser?.userId || ctx.meta?.userId || null;

      // generate or preserve sessionId
      const sessionId = ctx.params.sessionId || `dossier-${generateDossierId()}`;
      const knowledgeSpace = normalizeKnowledgeSpaceContext({
        tenantId,
        requestedTenantId,
        tenantScopeStatus,
        sessionId,
        conversationId: context?.conversationId || sessionId,
        channel: context?.channel || null,
        surface: context?.surface || null,
      });
      const dossierId = generateDossierId();
      const startTime = Date.now();

      // timeout warning
      const timeoutWarning =
        timeBudgetMs >= DOSSIER_TIMEOUT_WARNING_THRESHOLD_MS
          ? `HTTP timeout risk: timeBudgetMs (${timeBudgetMs}) may exceed client timeout. Set HTTP client timeout to at least ${timeBudgetMs + 15000}ms.`
          : null;

      const timeBudget = computeTimeBudget(timeBudgetMs);

      // load or create session (for auth/profile side-effects; dossier state read from raw payload below)
      try {
        await this.loadSession(ctx, tenantId, sessionId, userId, { createIfMissing: true });
      } catch (_err) {
        // non-fatal — dossier does not require a well-formed PA session
      }

      // Read raw session payload to extract prior dossier namespace (loadSession strips unknown keys)
      let rawSessionPayload = {};
      try {
        const rawDoc = await ctx.call(
          'object-store.get',
          { namespace: tenantNamespace(SESSION_NAMESPACE, tenantId), key: sessionId },
          { meta: ctx.meta }
        );
        rawSessionPayload = rawDoc?.payload || {};
      } catch (_e) {
        // no prior session — start fresh
      }

      const priorDossierState = rawSessionPayload[DOSSIER_SESSION_NAMESPACE]?.state || {};
      const priorDossierTurns = Array.isArray(rawSessionPayload[DOSSIER_SESSION_NAMESPACE]?.turns)
        ? rawSessionPayload[DOSSIER_SESSION_NAMESPACE].turns
        : [];
      const priorTurnsCount = priorDossierTurns.length;
      const priorConversationContext = buildDossierPriorConversationContext(
        priorDossierTurns,
        priorDossierState
      );
      const priorQuestionContext = priorDossierTurns
        .slice(-2)
        .map((turn) => turn?.question)
        .filter(Boolean)
        .join(' ');
      const evidenceQuestion = compactString(
        [priorQuestionContext, question].filter(Boolean).join(' '),
        1200
      );
      const dossierTask = evidenceQuestion || question;
      const evidenceSearchTerm = deriveCopilotSearchTerm(evidenceQuestion || question);
      const lowEvidenceNamespace = tenantNamespace(DOSSIER_LOW_EVIDENCE_NAMESPACE, tenantId);
      const maxTenantLowEvidence = Math.max(maxEvidence * 4, 20);
      const maxDossierEvidence = Math.max(maxEvidence * 4, 20);
      const preliminaryAnswerRequested = detectDossierPreliminaryAnswerRequest(question);
      const finalDossierRequested = detectDossierFinalAnswerRequest(question);
      const userProvidedFacts = buildDossierProjectFactEntries(question, { sessionId });
      const userProvidedEvidence = userProvidedFacts
        .map(mapDossierLowEvidenceToEntry)
        .filter(Boolean);
      if (userProvidedFacts.length > 0) {
        await Promise.all(
          userProvidedFacts.map(async (fact) => {
            const payload = {
              ...fact,
              tenantId,
              updatedAt: new Date().toISOString(),
            };
            try {
              await ctx.call(
                'object-store.put',
                {
                  namespace: lowEvidenceNamespace,
                  key: buildDossierLowEvidenceKey(fact),
                  payload,
                },
                { meta: ctx.meta }
              );
            } catch (_err) {
              // Learning is best-effort; dossier generation must still succeed.
            }
          })
        );
      }

      // Sync missing_evidence_requirement facts to evidence-requirement.service (best-effort, v0.63.2 #220)
      const missingRequirementFacts = userProvidedFacts.filter(
        (fact) => fact.factType === 'missing_evidence_requirement' && fact.value
      );
      if (missingRequirementFacts.length > 0) {
        Promise.all(
          missingRequirementFacts.map(async (fact) => {
            const requirementId = `evreq:${sessionId}:${fact.normalizedValue || fact.value}`;
            try {
              await ctx.call(
                'evidence-requirement.upsert',
                {
                  tenantId,
                  requirementId,
                  label: fact.value || fact.label,
                  requestedFact: fact.normalizedValue || fact.value,
                  originSessionId: sessionId,
                  projectScope: fact.projectScope || null,
                },
                { meta: { ...ctx.meta, tenantId, $gateway: false } }
              );
            } catch (_err) {
              // best-effort
            }
          })
        ).catch(() => {});
      }

      // Advisory Capability Broker — time-budgeted, fail-open, runs in parallel with evidence collection
      const _brokerBudgetMs = Math.min(2500, Math.max(1500, Math.floor(timeBudgetMs * 0.08)));
      const _brokerStartMs = Date.now();
      const _brokerResultPromise = (async () => {
        try {
          const _brokerRaw = await Promise.race([
            ctx.call(
              'capability-broker.recommend',
              {
                schemaVersion: 'cernion.capabilityRecommendation.v1',
                task: dossierTask,
                mode: 'initial',
                knownContext: { domain, sessionId },
                resolvedParams: {},
                resolvedCapabilities: [],
              },
              { meta: { ...ctx.meta, $gateway: false } }
            ),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('broker_timeout')), _brokerBudgetMs)
            ),
          ]);
          return {
            status: 'success',
            result: _brokerRaw,
            elapsedMs: Date.now() - _brokerStartMs,
            timedOut: false,
            source: 'capability-broker',
          };
        } catch (_brokerErr) {
          const elapsedMs = Date.now() - _brokerStartMs;
          if (_brokerErr.message === 'broker_timeout') {
            return {
              status: 'timeout',
              result: null,
              elapsedMs,
              timedOut: true,
              source: 'capability-broker',
            };
          }
          return {
            status: isActionUnavailable(_brokerErr) ? 'unavailable' : 'failed',
            result: null,
            elapsedMs,
            timedOut: false,
            source: 'capability-broker',
          };
        }
      })();

      let tenantLowEvidence = [];
      try {
        const lowEvidenceResult = await ctx.call(
          'object-store.query',
          { namespace: lowEvidenceNamespace, limit: 50 },
          { meta: ctx.meta }
        );
        tenantLowEvidence = (Array.isArray(lowEvidenceResult?.docs) ? lowEvidenceResult.docs : [])
          .map((doc) => mapDossierLowEvidenceToEntry(doc?.payload || {}))
          .filter(Boolean)
          .filter((entry) => copilotDossierEvidenceHasStrictQueryRelevance(entry, evidenceQuestion))
          .slice(0, maxTenantLowEvidence);
      } catch (_err) {
        this.logger?.warn(
          `[actions-part-01-of-1] silent-catch-fallback (line 1009): ${_err && _err.message}`
        );
        tenantLowEvidence = [];
      }

      // Resolve broker before fact collection so entity search can be scoped correctly.
      // The broker promise starts concurrently with this handler; in practice it resolves
      // in < 5 ms (synchronous capability matching) and is already settled by the time
      // the tenantLowEvidence fetch above completes.
      const capabilityRouting = await _brokerResultPromise;
      const dossierPlanning = buildDossierSafePlanningView({
        capabilityRouting,
        userProvidedFacts,
        dossierTask,
      });

      // Advisory-only capabilities (interface-placeholder.* plan) explicitly mark evidence
      // gaps rather than hydrating from live sources.  For these:
      //   • entity search is suppressed — prevents vdmi/znp/grid-connection query fanout
      //   • tenant session history is cleared — prevents unrelated project fact pollution
      const _isAdvisoryPlaceholderCapability =
        capabilityRouting.status === 'success' &&
        Array.isArray(capabilityRouting.result?.recommendedPlan) &&
        capabilityRouting.result.recommendedPlan.length > 0 &&
        capabilityRouting.result.recommendedPlan.every(
          (step) =>
            typeof step?.action === 'string' && step.action.startsWith('interface-placeholder.')
        );

      if (_isAdvisoryPlaceholderCapability) {
        tenantLowEvidence = [];
      }

      // Entity search is also suppressed for capabilities whose service domains are outside
      // query.search's valid domain set (companies, vnb, edm, vdmi, grid_connection, znp, all).
      // residual_load_forecast_for_dso uses grid-operations which is not a valid query.search
      // domain — suppressing prevents VDMI/ZNP/Grid-Connection fanout for DSO scenarios.
      const _ENTITY_SEARCH_SUPPRESSED_CAPABILITIES = new Set(['residual_load_forecast_for_dso']);
      const _isEntitySearchSuppressed =
        _isAdvisoryPlaceholderCapability ||
        (capabilityRouting.status === 'success' &&
          !capabilityRouting.result?.scoringBreakdown?.usedFallback &&
          typeof capabilityRouting.result?.capability === 'string' &&
          _ENTITY_SEARCH_SUPPRESSED_CAPABILITIES.has(capabilityRouting.result.capability));

      // Fact Collection phase (with soft timeout)
      let evidence = [];
      let completionState = DOSSIER_COMPLETION_STATE.COMPLETED;

      if (timeBudget.factCollectionMs > 0) {
        try {
          const searchDomain = domain !== 'auto' ? domain : undefined;

          const [knowledgeResult, searchResult] = await Promise.allSettled([
            (async () => {
              try {
                return await this.collectCopilotKnowledgeEvidence(ctx, {
                  question: evidenceQuestion,
                  searchTerm: evidenceSearchTerm,
                  maxEvidence,
                });
              } catch (_e) {
                this.logger?.warn(
                  `[actions-part-01-of-1] silent-catch-fallback (line 1069): ${_e && _e.message}`
                );
                return { status: 'unavailable', hits: [] };
              }
            })(),
            (async () => {
              if (_isEntitySearchSuppressed) return { results: [] };
              try {
                return await this.searchCopilotEntities(ctx, {
                  searchTerm: evidenceSearchTerm,
                  searchDomain,
                  maxEvidence,
                });
              } catch (_e) {
                this.logger?.warn(
                  `[actions-part-01-of-1] silent-catch-fallback (line 1081): ${_e && _e.message}`
                );
                return { results: [] };
              }
            })(),
          ]);

          const knowledgeEvidence =
            knowledgeResult.status === 'fulfilled'
              ? knowledgeResult.value
              : { status: 'unavailable', hits: [] };
          const searchEvidence =
            searchResult.status === 'fulfilled' ? searchResult.value : { results: [] };

          const knowledgeHits = Array.isArray(knowledgeEvidence?.hits)
            ? knowledgeEvidence.hits
            : [];
          const searchResults = Array.isArray(searchEvidence?.results)
            ? searchEvidence.results
            : [];

          const searchMapped = searchResults.slice(0, maxEvidence).map((r) => ({
            source: r.domain || r.type || 'cernion',
            value: compactString([r.title, r.excerpt].filter(Boolean).join(' · '), 400),
          }));

          evidence = dedupeDossierEvidence([
            ...userProvidedEvidence,
            ...tenantLowEvidence,
            ...knowledgeHits,
            ...searchMapped,
          ])
            .filter((entry) =>
              copilotDossierEvidenceHasStrictQueryRelevance(entry, evidenceQuestion)
            )
            .slice(0, maxDossierEvidence);

          if (knowledgeEvidence?.status === 'timeout') {
            completionState = DOSSIER_COMPLETION_STATE.PARTIAL;
          }
        } catch (_err) {
          this.logger?.warn(
            `[actions-part-01-of-1] silent-catch-fallback (line 1120): ${_err && _err.message}`
          );
          completionState = DOSSIER_COMPLETION_STATE.PARTIAL;
        }
      } else {
        // no budget for collection — use prior evidence from session
        evidence = dedupeDossierEvidence([
          ...userProvidedEvidence,
          ...tenantLowEvidence,
          ...(Array.isArray(priorDossierState?.knownEvidence)
            ? priorDossierState.knownEvidence
            : []),
        ]);
      }
      // Read-only capability evidence hydration — fail-open, allowlist-gated, time-budgeted.
      // Multi-source MCP hydration is concurrency-limited to avoid upstream session spikes.
      const hydrationBudgetMs =
        timeBudget.thinkingMs > 3000 ? Math.min(20000, Math.floor(timeBudget.thinkingMs * 0.8)) : 0;
      const _hydrationResult = {
        attempted: [],
        succeeded: [],
        failed: [],
        failedDetails: [],
        timedOut: [],
        nullFormatted: [],
        evidenceAdded: 0,
        skippedNoRule: [],
        skippedMissingParams: [],
        skippedUnsafe: [],
      };

      if (
        hydrationBudgetMs > 0 &&
        capabilityRouting.status === 'success' &&
        capabilityRouting.result
      ) {
        const brokerPlanActions = Array.isArray(capabilityRouting.result.recommendedPlan)
          ? capabilityRouting.result.recommendedPlan.map((step) => step?.action).filter(Boolean)
          : [];
        const brokerCapabilityActions = Array.isArray(
          capabilityRouting.result.recommendedCapabilities
        )
          ? capabilityRouting.result.recommendedCapabilities.flatMap((capability) =>
              Array.isArray(capability?.actions) ? capability.actions : []
            )
          : [];
        const brokerCandidateActions = [
          ...(Array.isArray(capabilityRouting.result.preferredActions)
            ? capabilityRouting.result.preferredActions
            : []),
          ...(Array.isArray(capabilityRouting.result.fallbackActions)
            ? capabilityRouting.result.fallbackActions
            : []),
          ...brokerPlanActions,
          ...brokerCapabilityActions,
        ].filter((a, i, arr) => arr.indexOf(a) === i);
        if (
          detectDossierEvCo2ChargingRequest(dossierTask) &&
          !brokerCandidateActions.includes('energy-market.co2Intensity')
        ) {
          brokerCandidateActions.unshift('energy-market.co2Intensity');
        }

        if (brokerCandidateActions.length > 0) {
          const hydrationStartMs = Date.now();
          let hydrationCursor = 0;
          const hydrationConcurrency = Math.min(2, brokerCandidateActions.length);
          const hydrateOne = async (actionName) => {
            const elapsed = Date.now() - hydrationStartMs;
            const remainingMs = hydrationBudgetMs - elapsed;
            if (remainingMs <= 500) {
              _hydrationResult.timedOut.push(actionName);
              return null;
            }
            const actionDef = getDossierHydrationRule(actionName);
            if (!actionDef) {
              if (isDossierRuleSafetyRejected(actionName)) {
                _hydrationResult.skippedUnsafe.push(actionName);
              } else {
                _hydrationResult.skippedNoRule.push(actionName);
              }
              return null;
            }
            const params = actionDef.extractParams(userProvidedFacts, dossierTask);
            if (!params) {
              _hydrationResult.skippedMissingParams.push(actionName);
              return null;
            }
            _hydrationResult.attempted.push(actionName);
            const _hydrationCallStart = Date.now();
            try {
              const perActionMs = Math.min(actionDef.timeoutMs || 7000, remainingMs);
              const rawResult = await Promise.race([
                ctx.call(actionName, params, { meta: { ...ctx.meta, $gateway: false } }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('hydration_timeout')), perActionMs)
                ),
              ]);
              if (rawResult?.success === false) {
                const _err = new Error(rawResult.error?.message || 'hydration_action_failed');
                _err.code = rawResult.error?.code || rawResult.code || null;
                throw _err;
              }
              const windowEvidence =
                actionName === 'energy-market.co2Intensity'
                  ? buildDossierCo2ChargingWindowEvidence(rawResult, dossierTask)
                  : null;
              const formattedValue = [actionDef.formatEvidence(rawResult), windowEvidence]
                .filter(Boolean)
                .join(' · ');
              if (!formattedValue) {
                _hydrationResult.nullFormatted.push(actionName);
                return null;
              }
              _hydrationResult.succeeded.push(actionName);
              return {
                source: actionName,
                value: `${actionDef.label}: ${formattedValue}`,
                metadata: {
                  evidenceQuality: actionDef.evidenceQuality,
                  hydratedBy: actionName,
                  hydratedElapsedMs: Date.now() - _hydrationCallStart,
                  ruleId: actionDef.id,
                  ruleVersion: actionDef.version || null,
                },
              };
            } catch (_hydrationErr) {
              if (_hydrationErr.message === 'hydration_timeout') {
                _hydrationResult.timedOut.push(actionName);
              } else {
                _hydrationResult.failed.push(actionName);
                _hydrationResult.failedDetails.push({
                  action: actionName,
                  message: _hydrationErr.message || 'unknown',
                  code: _hydrationErr.code || null,
                });
              }
              return null;
            }
          };

          const hydrationSettled = await Promise.allSettled(
            Array.from({ length: hydrationConcurrency }, async () => {
              const entries = [];
              while (
                hydrationCursor < brokerCandidateActions.length &&
                Date.now() - hydrationStartMs < hydrationBudgetMs
              ) {
                const actionName = brokerCandidateActions[hydrationCursor++];
                const entry = await hydrateOne(actionName);
                if (entry) entries.push(entry);
              }
              return entries;
            })
          );
          const hydratedEntries = hydrationSettled
            .filter((r) => r.status === 'fulfilled' && Array.isArray(r.value))
            .flatMap((r) => r.value);
          if (hydratedEntries.length > 0) {
            evidence = dedupeDossierEvidence([...evidence, ...hydratedEntries]);
            _hydrationResult.evidenceAdded = hydratedEntries.length;
          }
        }
      }

      const confidenceEvidenceCount = evidence.filter(
        (entry) => entry?.metadata?.evidenceQuality !== 'low'
      ).length;
      const classificationQuestion = compactString(
        [priorQuestionContext, question].filter(Boolean).join(' '),
        1200
      );

      // Thinking phase — deterministic classification
      const dossierContext = classifyDossierContext({
        question: classificationQuestion || question,
        priorUserContext: priorDossierState?.userContext || null,
        priorProcessStage: priorDossierState?.processStage || null,
        domain,
        evidenceCount: confidenceEvidenceCount,
      });

      // Build missing evidence list. Each gap carries both a Markdown statement (unchanged
      // wording, persisted in missingEvidence) and a renderer-safe question derived from the
      // same structured condition — clarificationQuestions never parses dossierMarkdown.
      const evidenceGaps = [];
      if (confidenceEvidenceCount === 0) {
        evidenceGaps.push({
          statement:
            'Validierte Cernion-Evidence: Keine belastbaren Treffer gefunden — Suchbegriff präzisieren, Domäne angeben oder Evidence nachreichen.',
          question:
            'Welche zusätzliche Evidence oder Quellenangabe können Sie zu dieser Frage liefern?',
          enablesDossierAddition:
            'Mit zusätzlicher Evidence oder einer präziseren Quellenangabe kann das Dossier eine belastbare statt vorläufige Antwort liefern.',
        });
      }
      if (dossierContext.userContext === DOSSIER_USER_CONTEXT.UNKNOWN) {
        evidenceGaps.push({
          statement:
            'Nutzerkontext: Unklar wer fragt und mit welchem Ziel (Planung, Management, Prozessaktion).',
          question:
            'Für wen erstellen wir dieses Dossier und mit welchem Ziel (z. B. Planung, Management, Prozessaktion)?',
          enablesDossierAddition:
            'Mit Angabe des Nutzerkontexts kann das Dossier eine zielgruppengerechtere Antwort liefern.',
        });
      }
      const evCo2ForecastEvidenceSufficient =
        detectDossierEvCo2ChargingRequest(dossierTask) &&
        evidence.some((entry) => entry?.metadata?.hydratedBy === 'energy-market.co2Intensity');
      if (
        dossierContext.answerMode === DOSSIER_ANSWER_MODE.EVIDENCE_COLLECTION &&
        confidenceEvidenceCount < 3 &&
        !evCo2ForecastEvidenceSufficient
      ) {
        evidenceGaps.push({
          statement:
            'Evidence-Basis: Für eine belastbare Planungsaussage sind weitere Datenpunkte erforderlich.',
          question:
            'Welche weiteren Datenpunkte oder Belege liegen vor, um die Planungsaussage zu stützen?',
          enablesDossierAddition:
            'Mit weiteren Datenpunkten kann das Dossier die Planungsaussage breiter absichern.',
        });
      }
      if (preliminaryAnswerRequested && confidenceEvidenceCount === 0 && evidence.length > 0) {
        // Disclosure, not a gap to ask the user about — no corresponding clarification question.
        evidenceGaps.push({
          statement:
            'Vorläufige Aussage: Vom Nutzer ausdrücklich gewünscht, aber nur als nicht belastbare Arbeitshypothese auf Basis der Low-Evidence zulässig.',
          question: null,
        });
      }
      const missingEvidence = evidenceGaps.map((gap) => gap.statement);
      const clarificationQuestions = finalDossierRequested
        ? []
        : evidenceGaps.map((gap) => gap.question).filter(Boolean);
      // Positive framing for the slim contract's Possible Follow-Up section (#242): each gap
      // becomes "missing data point -> what it would enable", not just a blocker/question.
      const possibleFollowUp = finalDossierRequested
        ? []
        : [
            ...evidenceGaps
              .filter((gap) => gap.question && gap.enablesDossierAddition)
              .map((gap) => ({
                question: gap.question,
                enablesDossierAddition: gap.enablesDossierAddition,
              })),
            ...dossierPlanning.followUps.map((followUp) => ({
              question: followUp.question,
              enablesDossierAddition: followUp.enablesDossierAddition,
            })),
          ];

      // Evidence-first answer-quality signals (#238). usedRetrievedEvidence reflects whether
      // relevant tool/MCP evidence was actually retrieved; substantiveAnswerInstructed mirrors
      // the exact conditions buildDossierMarkdown uses to pick an answer-first vs. defensive
      // Recommended Answer Structure, so this can't drift from the generated dossier text.
      const usedRetrievedEvidence = confidenceEvidenceCount > 0;
      const substantiveAnswerInstructed = resolveDossierSubstantiveAnswer({
        hasValidatedEvidence: usedRetrievedEvidence,
        finalMode: finalDossierRequested,
        preliminaryAnswerRequested,
        evidenceCount: evidence.length,
      });
      const answerQuality = {
        usedRetrievedEvidence,
        substantiveAnswerInstructed,
        defensiveNonAnswer: !substantiveAnswerInstructed,
      };

      const reasoningSummary = buildReasoningSummary({
        userContext: dossierContext.userContext,
        answerMode: dossierContext.answerMode,
        evidenceCount: confidenceEvidenceCount,
        domain,
        question,
        evidenceFirst: usedRetrievedEvidence,
      });

      const dossierVersion = priorTurnsCount + 1;

      // Dossier contract decision (#242) — default 'rich' is byte-for-byte today's behavior;
      // 'slim' is opt-in only and is itself routed back to 'rich' for process-risk or
      // not-yet-complete dossiers regardless of what the caller requested.
      const resolvedDossierContract = resolveDossierContract({
        requestedContract: requestedDossierContract,
        answerMode: dossierContext.answerMode,
        completionState,
      });

      // Compilation phase — always runs
      const dossierMarkdownArgs = {
        dossierId,
        dossierVersion,
        sessionId,
        question,
        dossierState: dossierContext,
        evidence,
        missingEvidence,
        timeBudget,
        completionState,
        domain,
        priorTurnsCount,
        knowledgeSpace,
        preliminaryAnswerRequested,
        capabilityRouting,
        priorConversationContext,
      };
      const dossierMarkdown =
        resolvedDossierContract.contract === 'slim'
          ? buildSlimDossierMarkdown({
              question,
              dossierState: dossierContext,
              evidence,
              reasoningSummary,
              domain,
              possibleFollowUp,
            })
          : buildDossierMarkdown({ ...dossierMarkdownArgs, reasoningSummary });

      const finalDossierMarkdown = finalDossierRequested
        ? buildDossierMarkdown({
            ...dossierMarkdownArgs,
            reasoningSummary: buildReasoningSummary({
              userContext: dossierContext.userContext,
              answerMode: dossierContext.answerMode,
              evidenceCount: confidenceEvidenceCount,
              domain,
              question,
              finalMode: true,
              evidenceFirst: usedRetrievedEvidence,
            }),
            finalMode: true,
          })
        : null;

      const elapsedMs = Date.now() - startTime;
      const rendererSystemHint = buildRendererSystemHint();
      const followUp = buildFollowUpMetadata({ completionState, sessionId, dossierId });
      const dossierSummary = buildDossierTurnSummary({
        question,
        dossierContext,
        evidence,
        missingEvidence,
        reasoningSummary,
        capabilityRouting,
      });

      // Persist dossier state to session
      const updatedDossierState = {
        processStage: dossierContext.processStage,
        userContext: dossierContext.userContext,
        answerMode: dossierContext.answerMode,
        confidence: dossierContext.confidence,
        knownEvidence: evidence.slice(0, 10),
        missingEvidence: missingEvidence.slice(0, 5),
        knowledgeSpace,
        preliminaryAnswerRequested,
        lastDossierId: dossierId,
        lastUpdatedAt: new Date().toISOString(),
      };

      const newTurn = {
        dossierId,
        parentDossierId: parentDossierId || null,
        dossierVersion,
        question: compactString(question, 500),
        processStage: dossierContext.processStage,
        userContext: dossierContext.userContext,
        answerMode: dossierContext.answerMode,
        confidence: dossierContext.confidence,
        completionState,
        dossierSummary,
        missingEvidence: missingEvidence.slice(0, 5),
        knownEvidence: evidence.slice(0, 5).map((entry) => ({
          source: entry?.source || null,
          value: compactString(entry?.value || '', 300),
          evidenceQuality: entry?.metadata?.evidenceQuality || null,
        })),
        knowledgeSpace,
        preliminaryAnswerRequested,
        createdAt: new Date().toISOString(),
      };

      const updatedDossierTurns = [...priorDossierTurns, newTurn].slice(-20);

      try {
        await this.persistSession(ctx, tenantId, sessionId, {
          ...rawSessionPayload,
          [DOSSIER_SESSION_NAMESPACE]: {
            state: updatedDossierState,
            turns: updatedDossierTurns,
          },
        });
      } catch (_err) {
        // non-fatal — dossier still returned
      }

      return {
        success: true,
        sessionId,
        dossierId,
        dossierVersion,
        parentDossierId: parentDossierId || null,
        latestDossierId: dossierId,
        mode,
        answerMode: dossierContext.answerMode,
        userContext: dossierContext.userContext,
        processStage: dossierContext.processStage,
        confidence: dossierContext.confidence,
        completionState,
        followUp,
        knowledgeSpace,
        priorConversationContext,
        preliminaryAnswerRequested,
        finalDossierRequested,
        clarificationQuestions,
        answerQuality,
        timeBudget: { ...timeBudget, elapsedMs },
        timeoutWarning,
        dossierMarkdown,
        finalDossierMarkdown,
        rendererSystemHint,
        capabilityRouting,
        dossierPlanning,
        hydration: _hydrationResult,
        auditTrail: {
          correlationId: dossierId,
          dossierId,
          dossierVersion,
          parentDossierId: parentDossierId || null,
          version: dossierVersion,
          tenantId: knowledgeSpace.tenantId,
          tenantScopeStatus: knowledgeSpace.tenantScopeStatus,
          conversationId: knowledgeSpace.conversationId,
          finalDossierRequested,
          answerQuality,
          dossierContract: describeDossierContract(resolvedDossierContract),
          createdAt: new Date().toISOString(),
          broker: {
            status: capabilityRouting.status,
            elapsedMs: capabilityRouting.elapsedMs,
            timedOut: capabilityRouting.timedOut,
            intent: capabilityRouting.result?.intent || null,
            capability: capabilityRouting.result?.capability || null,
          },
          dossierPlanning: {
            status: dossierPlanning.status,
            actionCount: dossierPlanning.actions.length,
            hydrationCandidateCount: dossierPlanning.hydrationCandidates.length,
            missingInputs: dossierPlanning.missingInputs,
            executionMode: dossierPlanning.executionPolicy.mode,
          },
          hydration: {
            attempted: _hydrationResult.attempted,
            succeeded: _hydrationResult.succeeded,
            failed: _hydrationResult.failed,
            failedDetails: _hydrationResult.failedDetails,
            timedOut: _hydrationResult.timedOut,
            nullFormatted: _hydrationResult.nullFormatted,
            evidenceAdded: _hydrationResult.evidenceAdded,
            skippedNoRule: _hydrationResult.skippedNoRule,
            skippedMissingParams: _hydrationResult.skippedMissingParams,
            skippedUnsafe: _hydrationResult.skippedUnsafe,
          },
        },
      };
    },
  },

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
      chatMode: {
        type: 'enum',
        optional: true,
        values: [CHAT_MODES.EXECUTION, CHAT_MODES.CONSULTATION],
      },
      forceReceipt: { type: 'string', optional: true, trim: true, max: 120 },
      preferredReceipts: {
        type: 'array',
        optional: true,
        items: 'string',
        default: [],
      },
      allowDraftReceipts: { type: 'boolean', optional: true, default: false, convert: true },
      explainReceiptSelection: { type: 'boolean', optional: true, default: false, convert: true },
      disableReceiptSelection: { type: 'boolean', optional: true, default: false, convert: true },
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
                message: {
                  type: 'string',
                  minLength: 1,
                  maxLength: 8000,
                  example: 'Plane eine neue PV-Anlage in Troisdorf.',
                },
                sessionId: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
                executionMode: {
                  type: 'string',
                  enum: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL],
                  default: EXECUTION_MODES.AUTO,
                },
                chatMode: {
                  type: 'string',
                  enum: [CHAT_MODES.EXECUTION, CHAT_MODES.CONSULTATION],
                  default: CHAT_MODES.CONSULTATION,
                  example: CHAT_MODES.CONSULTATION,
                  description:
                    'Optional explicit chat mode. If set, it overrides auto detection for this turn.',
                },
                forceReceipt: {
                  type: 'string',
                  example: 'vnb-lookup-v1',
                  description:
                    'Optional receipt id to force. Invalid or policy-forbidden ids fail with 422.',
                },
                preferredReceipts: {
                  type: 'array',
                  items: { type: 'string' },
                  default: [],
                  example: ['vnb-lookup-v1', 'grid-ops-fallback-v1'],
                  description: 'Optional ordered list of preferred runtime receipt ids.',
                },
                allowDraftReceipts: {
                  type: 'boolean',
                  default: false,
                  description: 'When true, draft receipts can be selected in controlled testing.',
                },
                explainReceiptSelection: {
                  type: 'boolean',
                  default: false,
                  description:
                    'When true, includes receipt-selection diagnostics in metadata.receiptSelection.',
                },
                disableReceiptSelection: {
                  type: 'boolean',
                  default: false,
                  description:
                    'When true, bypasses runtime receipt selection and enforces legacy routing behavior.',
                },
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
                executionMode: {
                  type: 'string',
                  enum: [EXECUTION_MODES.AUTO, EXECUTION_MODES.HITL],
                },
                chatMode: {
                  type: 'string',
                  enum: [CHAT_MODES.EXECUTION, CHAT_MODES.CONSULTATION],
                  default: CHAT_MODES.CONSULTATION,
                  example: CHAT_MODES.CONSULTATION,
                },
                knownContext: { type: 'string', description: 'JSON-stringified object' },
                toolContext: { type: 'string', description: 'JSON-stringified object' },
                forceReceipt: { type: 'string' },
                preferredReceipts: {
                  type: 'string',
                  description: 'JSON array string, e.g. ["receipt-a","receipt-b"]',
                },
                allowDraftReceipts: { type: 'string', description: 'true/false' },
                explainReceiptSelection: { type: 'string', description: 'true/false' },
                disableReceiptSelection: { type: 'string', description: 'true/false' },
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
          description:
            'Chat turn completed (internal Moleculer calls only; REST gateway calls receive 202 Accepted)',
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
                    reply:
                      'Ich habe einen 2-stufigen Plan entworfen. Sie können ihn überprüfen und dann manuell ausführen.',
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
                    reply:
                      'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
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
                        message:
                          'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
                        status: 'awaiting-onboarding',
                        onboardingQuestion: {
                          questionId: 'oq_abc123',
                          paramKey: 'gridOperatorName',
                          questionText:
                            'Für welchen Netzbetreiber (z.B. Stadtwerke Troisdorf) soll ich die Prüfung durchführen?',
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
                    reply:
                      'Die Investitionsanalyse ist abgeschlossen. Die Kosten betragen ca. 45.000 EUR mit einer Amortisationszeit von 8,2 Jahren bei 7% Rendite.',
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
                          params: {
                            gridOperator: 'STROMDAO Netze',
                            investmentType: 'transformer',
                          },
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
                    reply:
                      'Ich habe die Energiefreigabe-Validierung gestartet, benötige aber noch die Projekt-ID. Können Sie bitte angeben, welches Projekt Sie prüfen möchten?',
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
                        message:
                          'Step 2 blocked: requires projectId. Available aliases: project, projectName, projectCode.',
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
                    reply:
                      'Die Redispatch-Analyse ist abgeschlossen. Die Erweiterung auf die Speicherplanung ist in dieser Version nicht freigeschaltet – ich stelle Ihnen dafür ein Manual-Interface zur Verfügung.',
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
                        message:
                          'Domain "storage" is not routable in deterministic chains. Interface placeholder activated for manual continuation.',
                        status: 'interface-placeholder',
                        placeholderId: 'placeholder_storage_gap_v1',
                        placeholderMetadata: {
                          title: 'Speicheroptimierung',
                          description:
                            'Manuelle Speicheroptimierung auf Basis des Redispatch-Audits erforderlich.',
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
        202: {
          description:
            'Accepted - Chat turn submitted as async job. Poll /api/jobs/:jobId/status for progress. (REST gateway only; internal Moleculer calls receive 200.)',
          headers: {
            Location: { description: 'URL to poll job status', schema: { type: 'string' } },
            'Retry-After': {
              description: 'Recommended polling interval in seconds',
              schema: { type: 'string' },
            },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  jobId: { type: 'string' },
                  status: { type: 'string', enum: ['queued'] },
                  message: { type: 'string' },
                  statusUrl: { type: 'string' },
                  resultUrl: { type: 'string' },
                  progressUrl: { type: 'string' },
                  reused: { type: 'boolean' },
                },
                required: ['success', 'jobId', 'status', 'statusUrl', 'resultUrl', 'progressUrl'],
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
      const sessionKey = String(ctx.params.sessionId || '').trim();
      const messageKey = String(ctx.params.message || '').trim();
      const receiptKey = String(ctx.params.forceReceipt || '').trim();
      const idempotencyKey =
        sessionKey && messageKey
          ? `${sessionKey}:${crypto
              .createHash('sha256')
              .update(`${messageKey}|${receiptKey}`)
              .digest('hex')
              .slice(0, 16)}`
          : sessionKey || undefined;

      // Gateway-aware async job routing wrapper
      return await jobStore.startJob(
        ctx,
        { service: 'personal-agent', action: 'chat' },
        (jobId) => this._executeChatCoreLogic(ctx, jobId),
        {
          idempotencyKey,
          wakeContext: {
            params: {
              sessionId: sessionKey || undefined,
              message: messageKey,
              forceReceipt: receiptKey || undefined,
            },
            meta: {
              tenantId: ctx.meta?.tenantId,
              userId: ctx.meta?.authUser?.userId,
            },
          },
        }
      );
    },

    // Core chat logic extracted as a method callable from async job wrapper
    async _executeChatCoreLogic(ctx, jobId = null) {
      const tenantId = getTenantId(ctx);
      const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
      const sessionId = String(ctx.params.sessionId || `pa_${crypto.randomUUID()}`);
      const executionMode = normalizeExecutionMode(ctx.params.executionMode);
      const executionTrace = createExecutionTrace({ sessionId });
      const toolCallTracker = createToolCallTracker({ sessionId });
      let stateMachine = createStateMachine({
        sessionId,
        chatMode: normalizeChatMode(ctx.params.chatMode || ctx.meta?.chatMode || null),
        executionMode,
        message: ctx.params.message,
      });
      let executionStateGraph = createExecutionStateGraph({
        sessionId,
        chatMode: normalizeChatMode(ctx.params.chatMode || ctx.meta?.chatMode || null),
        executionMode,
        message: ctx.params.message,
      });
      let turnGraph = createTurnGraph({
        sessionId,
        chatMode: normalizeChatMode(ctx.params.chatMode || ctx.meta?.chatMode || null),
        executionMode,
        message: ctx.params.message,
      });

      // v0.57.3 — per-turn work log accumulator (local closure, never stored on this)
      const turnWorkLog = createTurnWorkLog();

      // jobId parameter passed from startJob wrapper
      const jobStore = jobId ? require('../../src/job-store') : null;

      // Log chat mode classification start
      if (jobStore) {
        jobStore.appendLog(jobId, 'chat_init', 5, 'Personal Agent initialized', {
          tenantId,
          userId,
          sessionId,
          executionMode,
        });
      }

      const session = await this.loadSession(ctx, tenantId, sessionId, userId, {
        createIfMissing: true,
      });
      turnGraph = addNode(turnGraph, {
        id: 'ctx:session',
        type: 'context',
        label: 'Session context',
        data: {
          hasPersistedSession: Boolean(session.updatedAt),
          historyCount: Array.isArray(session?.l3?.history) ? session.l3.history.length : 0,
        },
      });
      turnGraph = addEdge(turnGraph, {
        from: 'msg:user',
        to: 'ctx:session',
        type: 'contextualized_by',
      });
      stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.SESSION_LOADED, {
        hasPersistedSession: Boolean(session.updatedAt),
        previousStateMachine: session?.l3?.stateMachine?.currentState || null,
      });
      executionStateGraph = advanceExecutionStateGraph(
        executionStateGraph,
        'execution_mode_resolved',
        {
          executionMode,
          previousChatMode: session?.l3?.chatMode || null,
        }
      );
      session.planStack = Array.isArray(session?.l3?.planStack) ? session.l3.planStack : [];
      session.resolvedParams =
        session?.l3?.resolvedParams && typeof session.l3.resolvedParams === 'object'
          ? session.l3.resolvedParams
          : {};
      session.resolvedCapabilities = Array.isArray(session?.l3?.resolvedCapabilities)
        ? session.l3.resolvedCapabilities
        : [];
      if (!session.planStack) session.planStack = [];
      if (!session.resolvedParams) session.resolvedParams = {};
      if (!session.resolvedCapabilities) session.resolvedCapabilities = [];
      if (!session.chatMode) session.chatMode = CHAT_MODES.CONSULTATION;
      if (!session.l3.chatMode) session.l3.chatMode = session.chatMode;
      if (!session.l3.chatModeSource) session.l3.chatModeSource = null;
      if (!session.l3.lastClassification) session.l3.lastClassification = null;

      // A) Strategic milestone: session loaded
      if (jobStore) {
        jobStore.appendLog(jobId, 'session_loaded', 10, 'Session loaded successfully', {
          isNewSession: !session.createdAt || session.createdAt === session.updatedAt,
          historyLength: Array.isArray(session.l3?.history) ? session.l3.history.length : 0,
        });
      }

      const fileProcessing = this.processFileAttachments(
        session,
        Array.isArray(ctx.params.fileAttachments) ? ctx.params.fileAttachments : []
      );
      const inhouseData = this.buildInhouseDataFromAttachments(
        Array.isArray(ctx.params.fileAttachments) ? ctx.params.fileAttachments : [],
        fileProcessing
      );
      const userMessage = {
        role: 'user',
        text: ctx.params.message,
        ts: new Date().toISOString(),
      };

      // ── Context mutation: append vs. replace ──────────────────────────
      // If incoming knownContext changes a decisive parameter (location,
      // operator, project), replace the stored resolvedParams to prevent
      // old-scenario context bleeding into the new turn.
      const previousBootstrapContext = sanitizeBootstrapContext(
        session?.l3?.bootstrapContext || null
      );
      const previousSessionKnowledgeScopeDataPoints = sanitizeScopedDatapoints(
        session?.l3?.knowledgeScopeDataPoints || []
      );
      const previousUserKnowledgeScopeDataPoints = sanitizeScopedDatapoints(
        session?.l2?.userProfile?.knowledgeScopeDataPoints || []
      );
      const rawKnownContext =
        ctx.params.knownContext && typeof ctx.params.knownContext === 'object'
          ? ctx.params.knownContext
          : {};
      const contextMutation = resolveContextMutation(session.resolvedParams, rawKnownContext);
      if (contextMutation.mode === 'replace') {
        session.resolvedParams = contextMutation.mergedParams;
        if (jobStore) {
          jobStore.appendLog(jobId, 'context_mutation', 12, 'Context replaced', {
            replacedKeys: contextMutation.replacedKeys,
          });
        }
      } else if (Object.keys(rawKnownContext).length > 0) {
        session.resolvedParams = contextMutation.mergedParams;
      }
      const knownContext = { ...rawKnownContext };
      const scqaFacts = buildDecisionFrameDirectives(
        knownContext.decisionFrame && typeof knownContext.decisionFrame === 'object'
          ? knownContext.decisionFrame
          : null
      );
      const bootstrapContext = this.resolveBootstrapContext({
        session,
        knownContext: rawKnownContext,
      });
      session.l3.bootstrapContext = bootstrapContext;

      // v0.57.3 — workLog callsite 2: onboarding gap detected
      if (bootstrapContext?.status === 'unknown' || bootstrapContext?.status === 'partial') {
        const _wlMissingField =
          bootstrapContext.organizationType === 'unknown' ? 'organizationType' : 'knowledgeScope';
        turnWorkLog.addEntry({
          action: WORK_LOG_ACTIONS.ONBOARDING_GAP_DETECTED,
          label: `Missing: ${_wlMissingField}`,
          metadata: {
            missingField: _wlMissingField,
            source: bootstrapContext.source || 'knownContext',
            status: bootstrapContext.status,
            severity: 'warning',
          },
        });
      }

      const scopedKnowledgeState = this.resolveScopedKnowledgeState({
        session,
        knownContext: rawKnownContext,
      });
      session.l3.knowledgeScopeDataPoints = scopedKnowledgeState.sessionDataPoints;
      session.l2.userProfile = {
        ...(session.l2?.userProfile || {}),
        knowledgeScopeDataPoints: scopedKnowledgeState.userDataPoints,
      };
      this.emitBootstrapWorkOutLoudIfChanged(ctx, {
        previousBootstrapContext,
        nextBootstrapContext: bootstrapContext,
        contextMutationMode: contextMutation.mode,
      });
      this.emitScopedKnowledgeWorkOutLoud(ctx, {
        previousSessionDataPoints: previousSessionKnowledgeScopeDataPoints,
        previousUserDataPoints: previousUserKnowledgeScopeDataPoints,
        nextSessionDataPoints: scopedKnowledgeState.sessionDataPoints,
        nextUserDataPoints: scopedKnowledgeState.userDataPoints,
        knownContext: rawKnownContext,
      });
      // ─────────────────────────────────────────────────────────────────

      const sessionHitlGate = await this.resolveSessionHitlResumeGate(ctx, {
        session,
        knownContext: rawKnownContext,
        message: ctx.params.message,
      });

      if (
        sessionHitlGate?.mode === 'blocked' ||
        sessionHitlGate?.mode === 'terminal' ||
        sessionHitlGate?.mode === 'approved-missing-plan'
      ) {
        const isDiagnosticMissingPlan = sessionHitlGate?.mode === 'approved-missing-plan';
        const isBlockedHitl = sessionHitlGate?.mode === 'blocked';
        const forcedChatMode =
          normalizeChatMode(
            ctx.params.chatMode || ctx.meta?.chatMode || ctx.meta?.$params?.chatMode
          ) || CHAT_MODES.EXECUTION;

        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED,
          {
            activeDomains: detectRequestedDomains(ctx.params.message),
            knowledgeDomain: null,
          }
        );
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.BROKER_RECOMMENDED,
          {
            intent: 'hitl_resume_gate',
            capability: 'personal-agent.hitl_resume_gate',
          }
        );
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED,
          {
            chatMode: forcedChatMode,
            source: 'session_hitl_gate',
            executionMode,
          }
        );
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.EXECUTION_PLANNED,
          {
            primaryIntent: 'critical_step_hitl_resume_gate',
            stepCount: 0,
          }
        );
        stateMachine = transitionStateMachine(
          stateMachine,
          isDiagnosticMissingPlan
            ? PERSONAL_AGENT_STATES.FAILED
            : isBlockedHitl
              ? PERSONAL_AGENT_STATES.HITL_BLOCKED
              : PERSONAL_AGENT_STATES.COMPLETED,
          {
            reasonCode: isDiagnosticMissingPlan
              ? 'approved_hitl_resume_missing_plan'
              : isBlockedHitl
                ? 'MANDATORY_HITL_APPROVAL'
                : 'HITL_TERMINAL_DECISION',
            blockedAction: sessionHitlGate?.stopPoint?.blockedAction || null,
            hitlItemId: sessionHitlGate?.stopPoint?.hitlItemId || null,
            hitlStatus: sessionHitlGate?.status || null,
          }
        );

        const stackResult = buildContextStack({
          systemPrompt: this.settings.systemPrompt,
          tenantFacts: [...(session.l1?.tenantFacts || []), ...scqaFacts],
          userProfile: session.l2?.userProfile || {},
          sessionHistory: [...(session.l3?.history || []), userMessage],
          fileAttachments: session.l3?.fileAttachments || [],
          bootstrapContext,
          knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
          toolContext: ctx.params.toolContext || null,
          maxContextTokens: this.settings.maxContextTokens,
        });
        const finalized = synthesizeAndPurgeLayer4(stackResult.stack, sessionHitlGate.reply || '');

        const execution = {
          status: isDiagnosticMissingPlan
            ? 'failed'
            : isBlockedHitl
              ? 'awaiting-onboarding'
              : 'partial',
          plan: null,
          steps: [],
          stopPoint: sessionHitlGate.stopPoint || null,
          meta: executionTrace.summarize({
            toolCalls: toolCallTracker.summarize().calls,
            chatModeSource: 'session_hitl_gate',
          }),
        };

        const responseStrategy = this.buildResponseStrategy({
          message: ctx.params.message,
          execution,
          knownContext,
          missingParams: [],
          existingAssumptions: Array.isArray(session.l3?.assumptions) ? session.l3.assumptions : [],
        });

        turnGraph = addNode(turnGraph, {
          id: 'knowledge:orientation',
          type: 'knowledge',
          label: 'Knowledge orientation',
          data: {
            domainHint: null,
            styleHint: null,
            activeDomains: detectRequestedDomains(ctx.params.message),
            contextMutationMode: contextMutation.mode,
            contextReplacedKeys:
              contextMutation.replacedKeys.length > 0 ? contextMutation.replacedKeys : null,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'msg:user',
          to: 'knowledge:orientation',
          type: 'oriented_by',
        });

        turnGraph = addNode(turnGraph, {
          id: 'broker:recommendation',
          type: 'broker',
          label: 'Capability recommendation',
          data: {
            intent: 'hitl_resume_gate',
            capability: 'personal-agent.hitl_resume_gate',
            semanticWorkflowType: null,
            semanticConfidence: null,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'knowledge:orientation',
          to: 'broker:recommendation',
          type: 'routes_to',
        });
        turnGraph = addNode(turnGraph, {
          id: 'chat:mode',
          type: 'decision',
          label: 'Chat mode resolved',
          data: {
            mode: forcedChatMode,
            source: 'session_hitl_gate',
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'broker:recommendation',
          to: 'chat:mode',
          type: 'decides',
        });
        turnGraph = finalizeTurnGraph(turnGraph, {
          status: sessionHitlGate.mode === 'blocked' ? 'hitl_blocked' : 'hitl_terminal',
        });

        const persisted = buildPersistableSessionState({
          id: sessionId,
          tenantId,
          userId,
          l1: finalized.stack.l1,
          l2: finalized.stack.l2,
          l3: {
            ...finalized.stack.l3,
            chatMode: forcedChatMode,
            chatModeSource: 'session_hitl_gate',
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            stateMachine: summarizeStateMachine(stateMachine),
            turnGraph: summarizeTurnGraph(turnGraph),
            responseStrategy,
            planStack: Array.isArray(session.planStack) ? session.planStack : [],
            resolvedParams:
              session.resolvedParams && typeof session.resolvedParams === 'object'
                ? session.resolvedParams
                : {},
            resolvedCapabilities: Array.isArray(session.resolvedCapabilities)
              ? session.resolvedCapabilities
              : [],
            lastCompletedPlan:
              session.l3?.lastCompletedPlan && typeof session.l3.lastCompletedPlan === 'object'
                ? session.l3.lastCompletedPlan
                : null,
            stopPoint:
              sessionHitlGate.stopPoint && typeof sessionHitlGate.stopPoint === 'object'
                ? sessionHitlGate.stopPoint
                : null,
            criticalStepCheckpoints:
              session.l3?.criticalStepCheckpoints &&
              typeof session.l3.criticalStepCheckpoints === 'object'
                ? session.l3.criticalStepCheckpoints
                : {},
          },
          createdAt: session.createdAt,
        });

        assertNoL4RawInPersistedState(persisted);
        await this.persistSession(ctx, tenantId, sessionId, persisted);

        const quality = this.buildQualitySummary({
          evidencePlan: null,
          execution,
          consultation: null,
        });
        // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
        // v0.56.3 — ZNP context signals
        const _hitlItemId1 =
          session?.l3?.stopPoint?.hitlItemId ?? ctx.params?.knownContext?.hitlItemId ?? null;
        const _handoffCtx1 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId1);
        const _znpCtx1 = buildZnpContextSnapshot(ctx, session, null);
        const personaResolution = await this.resolvePersonaForTrace(ctx, {
          tenantId,
          sessionId,
          sourceService: 'personal-agent',
          sourceAction: 'chat',
          workflowType: null,
          domainIntent: null,
          ..._znpCtx1,
          handoffPersonaId: _handoffCtx1.handoffPersonaId,
          hitlItemId: _hitlItemId1,
          workflowCompletionState: _handoffCtx1.workflowCompletionState,
        });

        // v0.57.3 — workLog callsite 3: persona resolved
        if (personaResolution?.roleLabel) {
          turnWorkLog.addEntry({
            action: WORK_LOG_ACTIONS.PERSONA_RESOLVED,
            label: getSafePersonaLabel(personaResolution.roleLabel),
            metadata: {
              roleLabel: personaResolution.roleLabel,
              source: personaResolution.source || 'session',
              updateReason: 'role_consistency_check',
            },
          });
        }

        const agentTrace = this.buildAgentTrace({
          routing: {
            source: 'session-hitl-gate',
            routeKey: null,
            routeLabel: 'hitl_resume_gate',
            primaryIntent: 'critical_step_hitl_resume_gate',
            secondaryIntents: [],
            requestedDomains: detectRequestedDomains(ctx.params.message),
            unsupportedDomains: [],
            warnings: [],
            chatMode: forcedChatMode,
          },
          plan: null,
          execution,
          evidencePlan: null,
          consultation: null,
          responseStrategy,
          stateMachine,
          executionStateGraph,
          turnGraph,
          routingDecision: {
            target: 'execution_node',
            label: 'session-hitl-gate',
            confidence: 1,
            determinism: 'high',
          },
          personaResolution,
          bootstrapContext,
          knowledgeScope: [
            ...(session.l3?.knowledgeScopeDataPoints || []),
            ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
          ],
          workLog: turnWorkLog.toArray(),
        });

        return {
          success: true,
          status: execution.status,
          sessionId,
          executionMode,
          chatMode: forcedChatMode,
          reply: sessionHitlGate.reply,
          execution,
          plan: {
            steps: [],
            onboardingHints: [],
          },
          quality,
          agentTrace,
          stateMachine: summarizeStateMachine(stateMachine),
          executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
          turnGraph: summarizeTurnGraph(turnGraph),
          layer4Purged: finalized.layer4Purged,
          l3Compressed: finalized.stack.l3?.compressed || false,
          historyCount: Array.isArray(finalized.stack.l3?.history)
            ? finalized.stack.l3.history.length
            : 0,
          contextUsage: stackResult.usage,
          fileProcessing,
        };
      }

      // ── Approved HITL Resume: inject stored plan and enrich knownContext ──
      const approvedHitlResumePlan =
        sessionHitlGate?.mode === 'approved' ? sessionHitlGate.planSnapshot || null : null;
      const hasApprovedHitlResumePlan = Boolean(
        approvedHitlResumePlan?.steps && approvedHitlResumePlan.steps.length > 0
      );
      if (hasApprovedHitlResumePlan) {
        if (!session.l3 || typeof session.l3 !== 'object') {
          session.l3 = {};
        }
        session.l3._approvedHitlResume = approvedHitlResumePlan;
        if (!knownContext.hitlItemId && sessionHitlGate.hitlItemId) {
          knownContext.hitlItemId = sessionHitlGate.hitlItemId;
        }
      }
      // ───────────────────────────────────────────────────────────────────────

      // v0.63.2 — Evidence Requirement query routing (fail-open) #220
      // Detect role-based open-requirements queries before the LLM routing path.
      // If the service is unavailable, fall through silently to the normal path.
      if (!hasApprovedHitlResumePlan) {
        const _evReqDetection = detectOpenEvidenceRequirementsQuery(ctx.params.message);
        if (_evReqDetection.isQuery) {
          const _evReqRole = _evReqDetection.role || 'netzplanung';
          const _evReqReply = await this.queryOpenEvidenceRequirements(ctx, {
            role: _evReqRole,
            tenantId,
            projectScopeKey: rawKnownContext?.projectScopeKey || null,
          });
          if (_evReqReply) {
            return {
              success: true,
              status: 'completed',
              sessionId,
              executionMode,
              chatMode: 'consultation',
              reply: _evReqReply,
              execution: {
                status: 'completed',
                completedSteps: 0,
                steps: [],
                stopPoint: null,
                meta: null,
              },
              plan: { steps: [], onboardingHints: [] },
              routing: {
                source: 'evidence-requirement',
                routeKey: 'open_requirements_query',
                routeLabel: `listOpenForRole:${_evReqRole}`,
                primaryIntent: 'open_evidence_requirements',
                requestedDomains: [],
                warnings: [],
              },
              layer4Purged: true,
              l3Compressed: false,
              historyCount: Array.isArray(session.l3?.history) ? session.l3.history.length : 0,
              contextUsage: {
                totalTokens: 0,
                estimatedPromptTokens: 0,
                estimatedCompletionTokens: 0,
              },
              fileProcessing,
            };
          }
          // _evReqReply === null means service unavailable — fall through to normal path
        }
      }

      let knowledgeContext = hasApprovedHitlResumePlan
        ? { domainHint: null, styleHint: null }
        : await this.queryKnowledgeOrientation(ctx, {
            message: ctx.params.message,
            activeDomains: detectRequestedDomains(ctx.params.message),
          });
      turnGraph = addNode(turnGraph, {
        id: 'knowledge:orientation',
        type: 'knowledge',
        label: 'Knowledge orientation',
        data: {
          domainHint: knowledgeContext?.domainHint || null,
          styleHint: knowledgeContext?.styleHint || null,
          activeDomains: detectRequestedDomains(ctx.params.message),
          contextMutationMode: contextMutation.mode,
          contextReplacedKeys:
            contextMutation.replacedKeys.length > 0 ? contextMutation.replacedKeys : null,
        },
      });
      turnGraph = addEdge(turnGraph, {
        from: 'msg:user',
        to: 'knowledge:orientation',
        type: 'oriented_by',
      });
      stateMachine = transitionStateMachine(
        stateMachine,
        PERSONAL_AGENT_STATES.KNOWLEDGE_ORIENTED,
        {
          activeDomains: detectRequestedDomains(ctx.params.message),
          knowledgeDomain: knowledgeContext?.domainHint || null,
        }
      );
      const brokerKnownContext = this.attachKnowledgeHintsToKnownContext(
        knownContext,
        knowledgeContext
      );

      let routing = null;
      let plan = null;
      let status = null;
      let brokerRecommendationRaw = null;
      let semanticClassification = null;
      let brokerRecommendation = null;

      if (!hasApprovedHitlResumePlan) {
        brokerRecommendationRaw = await this.getBrokerRecommendation(
          ctx,
          ctx.params.message,
          brokerKnownContext,
          session.resolvedParams,
          session.resolvedCapabilities
        );

        semanticClassification = await this.classifyConsultationIntentHybrid(
          ctx,
          ctx.params.message,
          brokerKnownContext,
          { executionTrace }
        );

        brokerRecommendation = this.applyConsultationGuardrailsToBroker(
          brokerRecommendationRaw,
          semanticClassification
        );
        turnGraph = addNode(turnGraph, {
          id: 'broker:recommendation',
          type: 'broker',
          label: 'Capability recommendation',
          data: {
            intent: brokerRecommendation?.intent || null,
            capability: brokerRecommendation?.capability || null,
            semanticWorkflowType: semanticClassification?.workflowType || null,
            semanticConfidence:
              typeof semanticClassification?.confidence === 'number'
                ? semanticClassification.confidence
                : null,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'knowledge:orientation',
          to: 'broker:recommendation',
          type: 'routes_to',
        });
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.BROKER_RECOMMENDED,
          {
            intent: brokerRecommendation?.intent || null,
            capability: brokerRecommendation?.capability || null,
          }
        );
        executionTrace.recordBrokerDecision({
          intent: brokerRecommendation?.intent || null,
          capability: brokerRecommendation?.capability || null,
          confidence:
            typeof brokerRecommendation?.confidence === 'number'
              ? brokerRecommendation.confidence
              : null,
          scoringBreakdown: brokerRecommendation?.scoringBreakdown || null,
          source: brokerRecommendation?.summary || 'capability-broker',
        });

        // A) Strategic milestone: broker ready
        if (jobStore) {
          jobStore.appendLog(jobId, 'broker_ready', 30, 'Broker recommendation ready', {
            intent: brokerRecommendation?.intent || null,
            capability: brokerRecommendation?.capability || null,
          });
        }
      } else {
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.BROKER_RECOMMENDED,
          {
            intent: 'approved_hitl_resume',
            capability: 'personal-agent.hitl_resume',
          }
        );
        routing = {
          primaryIntent: hasApprovedHitlResumePlan
            ? approvedHitlResumePlan?.primaryIntent || 'approved_hitl_resume'
            : null,
          requestedDomains: Array.isArray(approvedHitlResumePlan?.requestedDomains)
            ? approvedHitlResumePlan.requestedDomains
            : [],
        };
      }

      // ═══ ChatMode-Auflösung (4-Ebenen-Fallback) ═══

      // Ebene 1: Expliziter API-Parameter
      const rawRequestedChatMode =
        ctx.params.chatMode || ctx.meta?.chatMode || ctx.meta?.$params?.chatMode;
      let effectiveChatMode = normalizeChatMode(rawRequestedChatMode);
      let chatModeSource = 'api';
      let chatModeConfidence = rawRequestedChatMode ? 1 : null;

      if (hasApprovedHitlResumePlan) {
        effectiveChatMode = CHAT_MODES.EXECUTION;
        chatModeSource = 'approved_hitl_resume';
        chatModeConfidence = 1;
      }

      // Cache-Prüfung: identische Nachricht bereits klassifiziert?
      const msgHash = createMessageFingerprint(ctx.params.message || '');
      if (
        !effectiveChatMode &&
        session.l3?.lastClassification?.fingerprint === msgHash &&
        normalizeChatMode(session.l3?.lastClassification?.chatMode)
      ) {
        effectiveChatMode = session.l3.lastClassification.chatMode;
        chatModeSource = 'cached';
        chatModeConfidence =
          typeof session.l3?.lastClassification?.confidence === 'number'
            ? session.l3.lastClassification.confidence
            : 0.95;
        executionStateGraph = advanceExecutionStateGraph(executionStateGraph, 'chat_mode_cached', {
          chatMode: effectiveChatMode,
          source: chatModeSource,
          confidence: chatModeConfidence,
        });
        this.logger?.info(`[chatMode] Cache-Hit: ${effectiveChatMode}`);
      }

      if (effectiveChatMode && rawRequestedChatMode && !hasApprovedHitlResumePlan) {
        executionStateGraph = advanceExecutionStateGraph(
          executionStateGraph,
          'api_params_validated',
          {
            chatMode: effectiveChatMode,
            source: chatModeSource,
            confidence: 1,
          }
        );
      }

      // Ebene 2: LLM-Klassifikator
      if (!effectiveChatMode) {
        const llmClassification = await this.classifyChatModeLLM(ctx, ctx.params.message, session, {
          executionTrace,
        });
        if (llmClassification.chatMode && llmClassification.confidence >= 0.7) {
          effectiveChatMode = llmClassification.chatMode;
          chatModeSource = 'llm';
          chatModeConfidence = llmClassification.confidence;
          executionStateGraph = advanceExecutionStateGraph(
            executionStateGraph,
            'chat_mode_classified',
            {
              chatMode: effectiveChatMode,
              source: chatModeSource,
              confidence: llmClassification.confidence,
              reasoning: llmClassification.reasoning,
            }
          );
          this.logger?.info(
            `[chatMode] LLM-Klassifikation: ${effectiveChatMode} (conf=${llmClassification.confidence.toFixed(2)}): ${llmClassification.reasoning}`
          );
        }
      }

      // Ebene 3: Heuristik-Fallback
      if (!effectiveChatMode) {
        effectiveChatMode = detectChatMode(ctx.params.message, brokerRecommendation, session);
        chatModeSource = 'heuristic';
        chatModeConfidence = Number(brokerRecommendation?.confidence || 0.55);
        executionStateGraph = advanceExecutionStateGraph(
          executionStateGraph,
          'chat_mode_fallback',
          {
            chatMode: effectiveChatMode,
            source: chatModeSource,
            confidence: chatModeConfidence,
          }
        );
        this.logger?.info(`[chatMode] Heuristik-Fallback: ${effectiveChatMode}`);
      }

      // Ebene 4: Hard-Default
      if (!effectiveChatMode) {
        effectiveChatMode = CHAT_MODES.CONSULTATION;
        chatModeSource = 'default';
        chatModeConfidence = 0.5;
        executionStateGraph = advanceExecutionStateGraph(
          executionStateGraph,
          'chat_mode_fallback',
          {
            chatMode: effectiveChatMode,
            source: chatModeSource,
            confidence: chatModeConfidence,
          }
        );
      }

      executionStateGraph = advanceExecutionStateGraph(executionStateGraph, 'ready_for_routing', {
        chatMode: effectiveChatMode,
        source: chatModeSource,
        executionMode,
      });
      executionTrace.recordStateTransition({
        family: 'chat_mode',
        from: session?.l3?.chatMode || null,
        to: effectiveChatMode,
        reason: chatModeSource,
        metadata: {
          confidence: chatModeConfidence,
        },
      });

      this.logger?.info(
        `[chatMode] Request: ${rawRequestedChatMode || 'null'}, Effective: ${effectiveChatMode}, Source: ${chatModeSource}`
      );

      // Log chat mode classification result
      if (jobStore) {
        jobStore.appendLog(
          jobId,
          'chat_mode_classified',
          15,
          `chatMode=${effectiveChatMode}, source=${chatModeSource}`,
          {
            chatMode: effectiveChatMode,
            chatModeSource,
            confidence: null,
          }
        );
      }

      session.chatMode = effectiveChatMode;
      session.l3.chatMode = effectiveChatMode;
      session.l3.chatModeSource = chatModeSource;
      session.l3.lastClassification = {
        messageHash: msgHash,
        fingerprint: msgHash,
        chatMode: effectiveChatMode,
        source: chatModeSource,
        confidence: chatModeConfidence,
        timestamp: new Date().toISOString(),
      };
      session.l3.executionStateGraph = summarizeExecutionStateGraph(executionStateGraph);
      turnGraph = addNode(turnGraph, {
        id: 'chat:mode',
        type: 'decision',
        label: 'Chat mode resolved',
        data: {
          mode: effectiveChatMode,
          source: chatModeSource,
        },
      });
      turnGraph = addEdge(turnGraph, {
        from: 'broker:recommendation',
        to: 'chat:mode',
        type: 'decides',
      });
      stateMachine = transitionStateMachine(
        stateMachine,
        PERSONAL_AGENT_STATES.CHAT_MODE_RESOLVED,
        {
          chatMode: effectiveChatMode,
          source: chatModeSource,
          executionMode,
        }
      );

      const forceReceiptRequested =
        typeof ctx.params.forceReceipt === 'string' && ctx.params.forceReceipt.trim().length > 0;
      const receiptSelectionDiagnosticsRequested =
        ctx.params.explainReceiptSelection === true ||
        forceReceiptRequested ||
        isConsultationDebugEnabled(rawKnownContext);

      if (forceReceiptRequested && ctx.params.disableReceiptSelection === true) {
        throw new MoleculerClientError(
          'forceReceipt cannot be combined with disableReceiptSelection=true.',
          422,
          'RECEIPT_FORCE_CONFLICTS_WITH_DISABLE'
        );
      }

      // ── Location Resolution: hydrate brokerKnownContext from current message + history ──
      // This ensures that "74889 Sinsheim" mentioned inline in the user message reaches
      // the consultation bridge as structured postalCode/municipality fields, even when the
      // client does not send a pre-populated knownContext object.

      // 1. Extract location from the current turn message
      const currentMsgLocation = resolveLocationFromText(ctx.params.message, brokerKnownContext);
      const currentMsgLocationPatch = buildLocationContextPatch(currentMsgLocation);
      for (const [key, value] of Object.entries(currentMsgLocationPatch)) {
        if (brokerKnownContext[key] == null && value != null) {
          brokerKnownContext[key] = value;
        }
      }

      // 2. Hydrate from session history (multi-turn: postalCode from a prior turn)
      const multiTurnHints = this.extractMultiTurnContextHints(session);
      for (const [key, value] of Object.entries(multiTurnHints)) {
        if (brokerKnownContext[key] == null && value != null) {
          brokerKnownContext[key] = value;
        }
      }

      // 3. Store resolution trace for agentTrace / dataLineage (best-effort, non-blocking)
      if (currentMsgLocation.evidence.length > 0 || currentMsgLocation.municipalityResolved) {
        brokerKnownContext._locationResolutionTrace =
          buildLocationResolutionTrace(currentMsgLocation);
      }

      const clarificationMatch = forceReceiptRequested
        ? null
        : findClarificationPolicyMatch({
            message: ctx.params.message,
            knownContext: brokerKnownContext,
            chatMode: effectiveChatMode,
          });

      if (clarificationMatch?.policy) {
        const clarificationPolicy = clarificationMatch.policy;
        const clarification = clarificationPolicy.clarification || {};
        const clarificationReply = this.buildClarificationPolicyReply(clarificationPolicy);
        const assistantMessage = {
          role: 'assistant',
          text: clarificationReply,
          ts: new Date().toISOString(),
        };
        const clarificationHistory = [
          ...(Array.isArray(session.l3?.history) ? session.l3.history : []),
          userMessage,
          assistantMessage,
        ];
        const stackResult = buildContextStack({
          systemPrompt: this.settings.systemPrompt,
          tenantFacts: [...(session.l1?.tenantFacts || []), ...scqaFacts],
          userProfile: session.l2?.userProfile || {},
          sessionHistory: clarificationHistory,
          fileAttachments: session.l3?.fileAttachments || [],
          bootstrapContext,
          knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
          toolContext: ctx.params.toolContext || null,
          maxContextTokens: this.settings.maxContextTokens,
        });
        const finalized = synthesizeAndPurgeLayer4(stackResult.stack, clarificationReply);
        const clarificationExecution = {
          status: 'awaiting_input',
          plan: null,
          steps: [],
          stopPoint: {
            reasonCode: 'CLARIFICATION_REQUIRED',
            policyId: clarificationPolicy.id,
            question: clarification.question || clarificationReply,
            options: Array.isArray(clarification.options) ? clarification.options : [],
            requiredContext: Array.isArray(clarification.requiredContext)
              ? clarification.requiredContext
              : [],
          },
          meta: executionTrace.summarize({
            toolCalls: toolCallTracker.summarize().calls,
            chatModeSource,
          }),
        };
        const clarificationRouting = {
          source: 'clarification-policy',
          routeKey: clarificationPolicy.id,
          routeLabel: clarificationPolicy.title || clarificationPolicy.id,
          primaryIntent: clarificationPolicy.id,
          secondaryIntents: [],
          requestedDomains: detectRequestedDomains(ctx.params.message),
          unsupportedDomains: [],
          warnings: [],
          chatMode: effectiveChatMode,
        };
        const clarificationConsultation = {
          workflowType: semanticClassification?.workflowType || null,
          domainIntent:
            semanticClassification?.domainIntent || brokerRecommendation?.intent || null,
          evidenceStatus: 'unverified',
          hypotheses: [],
          openQuestions: [
            {
              question: clarification.question || clarificationReply,
              whyRelevant:
                'Das Optimierungsziel ist erforderlich, bevor Cernion einen passenden Ausführungspfad wählt.',
            },
          ],
          nextActions: Array.isArray(clarification.options)
            ? clarification.options.map((option) => ({
                action: option.label || option.id,
                description: option.intent || 'Optimierungsziel auswählen',
              }))
            : [],
          factsUsed: [],
          missingEvidence: [],
          nextVerificationSteps: [],
          guardrailCorrections: [],
        };
        const responseStrategy = this.buildResponseStrategy({
          message: ctx.params.message,
          execution: clarificationExecution,
          knownContext: brokerKnownContext,
          missingParams: [],
          existingAssumptions: Array.isArray(session.l3?.assumptions) ? session.l3.assumptions : [],
        });
        turnGraph = finalizeTurnGraph(turnGraph, { status: 'awaiting_clarification' });
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.CONSULTATION_ACTIVE,
          {
            policyId: clarificationPolicy.id,
          }
        );
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
          {
            reasonCode: 'CLARIFICATION_REQUIRED',
            policyId: clarificationPolicy.id,
          }
        );
        const persisted = buildPersistableSessionState({
          id: sessionId,
          tenantId,
          userId,
          l1: finalized.stack.l1,
          l2: finalized.stack.l2,
          l3: {
            ...finalized.stack.l3,
            chatMode: effectiveChatMode,
            chatModeSource,
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            stateMachine: summarizeStateMachine(stateMachine),
            turnGraph: summarizeTurnGraph(turnGraph),
            responseStrategy,
            planStack: Array.isArray(session.planStack) ? session.planStack : [],
            resolvedParams:
              session.resolvedParams && typeof session.resolvedParams === 'object'
                ? session.resolvedParams
                : {},
            resolvedCapabilities: Array.isArray(session.resolvedCapabilities)
              ? session.resolvedCapabilities
              : [],
            consultationContext: clarificationConsultation,
            stopPoint: clarificationExecution.stopPoint,
          },
          createdAt: session.createdAt,
        });
        assertNoL4RawInPersistedState(persisted);
        await this.persistSession(ctx, tenantId, sessionId, persisted);

        const agentTrace = this.buildAgentTrace({
          routing: clarificationRouting,
          plan: null,
          execution: clarificationExecution,
          evidencePlan: null,
          consultation: clarificationConsultation,
          responseStrategy,
          stateMachine,
          executionStateGraph,
          turnGraph,
          routingDecision: {
            target: 'clarification_node',
            label: 'clarification-policy',
            confidence: Math.min(1, Number(clarificationMatch.score || 0) / 3),
            determinism: 'high',
          },
          personaResolution: null,
          bootstrapContext,
          knowledgeScope: session.l3?.knowledgeScopeDataPoints || [],
          workLog: turnWorkLog.toArray(),
        });

        return {
          success: true,
          sessionId,
          chatMode: effectiveChatMode,
          executionMode,
          status: 'awaiting_input',
          reply: clarificationReply,
          workflowType: clarificationConsultation.workflowType,
          domainIntent: clarificationConsultation.domainIntent,
          clarification: {
            policyId: clarificationPolicy.id,
            version: clarificationPolicy.version,
            question: clarification.question || clarificationReply,
            options: Array.isArray(clarification.options) ? clarification.options : [],
            requiredContext: Array.isArray(clarification.requiredContext)
              ? clarification.requiredContext
              : [],
          },
          consultation: clarificationConsultation,
          execution: clarificationExecution,
          agentTrace,
          metadata: {
            clarificationPolicy: {
              id: clarificationPolicy.id,
              version: clarificationPolicy.version,
              score: clarificationMatch.score,
            },
          },
        };
      }

      const preferredReceiptsForTurn = this.buildPreferredReceiptsForTurn(
        ctx.params.message,
        brokerKnownContext,
        ctx.params.preferredReceipts,
        session
      );

      const receiptSelectionResult = await this.selectRuntimeReceipt(ctx, {
        message: ctx.params.message,
        context: {
          knownContext: brokerKnownContext,
          semanticClassification,
          brokerRecommendation,
          effectiveChatMode,
          sessionId,
        },
        input: {
          message: ctx.params.message,
          knownContext: brokerKnownContext,
          workflowType: semanticClassification?.workflowType || null,
          domainIntent:
            semanticClassification?.domainIntent || brokerRecommendation?.intent || null,
        },
        forceReceipt: ctx.params.forceReceipt,
        preferredReceipts: preferredReceiptsForTurn,
        allowDraftReceipts: ctx.params.allowDraftReceipts === true,
        explainReceiptSelection: receiptSelectionDiagnosticsRequested,
        disableReceiptSelection: ctx.params.disableReceiptSelection === true,
      });

      let receiptSelectionMetadata = this.buildReceiptSelectionMetadata(receiptSelectionResult, {
        includeDiagnostics: receiptSelectionDiagnosticsRequested,
      });

      if (
        Array.isArray(receiptSelectionResult?.evaluation?.plannedToolCalls) &&
        receiptSelectionResult.execution &&
        typeof receiptSelectionResult.execution === 'object'
      ) {
        receiptSelectionResult.execution.plannedToolCalls =
          receiptSelectionResult.evaluation.plannedToolCalls.map((step) => ({
            step: Number(step?.step || 0) || null,
            action: step?.selectedAction || step?.action || null,
            requestedAction: step?.action || null,
            params: step?.params || {},
            status: step?.status || null,
          }));
      }

      if (forceReceiptRequested && receiptSelectionResult?.selected !== true) {
        throw new MoleculerClientError(
          `Forced receipt '${ctx.params.forceReceipt}' was not selected for execution.`,
          422,
          'RECEIPT_FORCED_NOT_SELECTED',
          {
            forceReceipt: ctx.params.forceReceipt,
            selectionMode: receiptSelectionResult?.mode || 'none',
          }
        );
      }

      const receiptSelectionExecutable =
        receiptSelectionResult?.selected === true &&
        (receiptSelectionResult?.evaluation
          ? receiptSelectionResult.evaluation.executable === true
          : true);

      if (forceReceiptRequested && !receiptSelectionExecutable) {
        throw new MoleculerClientError(
          `Forced receipt '${ctx.params.forceReceipt}' is not executable for the current context.`,
          422,
          'RECEIPT_FORCED_NOT_EXECUTABLE',
          {
            forceReceipt: ctx.params.forceReceipt,
            diagnostics: receiptSelectionResult?.diagnostics || null,
          }
        );
      }

      const shouldPreferReceiptExecution =
        receiptSelectionExecutable && ctx.params.disableReceiptSelection !== true;

      const routingDecision = decideRoutingTarget({
        effectiveChatMode,
        brokerRecommendation,
        message: ctx.params.message,
        chatModeSource,
      });
      executionTrace.recordStateTransition({
        family: 'routing',
        from: 'chat_mode_resolved',
        to: routingDecision.target,
        reason: routingDecision.label,
        metadata: {
          confidence: routingDecision.confidence,
          determinism: routingDecision.determinism,
          gapReason: routingDecision?.gap?.reason || null,
        },
      });

      // v0.57.3 — workLog callsite 1: routing classified
      turnWorkLog.addEntry({
        action: WORK_LOG_ACTIONS.ROUTING_CLASSIFIED,
        label: `Classified as ${brokerRecommendation?.intent || routingDecision.target || 'unknown'} inquiry`,
        metadata: {
          targetDomain: brokerRecommendation?.domain || null,
          primaryIntent: brokerRecommendation?.intent || null,
          reasonCode:
            routingDecision.target && routingDecision.target !== 'mark_unknown_execution_gap'
              ? 'INTENT_SIGNAL_DETECTED'
              : 'DEFAULT_ROUTE',
        },
      });

      if (
        routingDecision.target === 'mark_unknown_execution_gap' &&
        String(
          process.env.PERSONAL_AGENT_ENABLE_ROUTING_GAP_SHORT_CIRCUIT || 'false'
        ).toLowerCase() === 'true'
      ) {
        const responsePolicyContract = this.buildResponsePolicyContract({
          message: ctx.params.message,
          workflowType: semanticClassification?.workflowType || null,
          domainIntent:
            semanticClassification?.domainIntent || brokerRecommendation?.intent || null,
          knownContext: brokerKnownContext,
          receiptKnowledgeEvidence: receiptSelectionResult?.knowledgeEvidence || null,
          verifiedFacts: [],
        });
        const gapResponse = buildExecutionGapResponse({
          routingDecision,
          brokerRecommendation,
          message: ctx.params.message,
        });
        const stackResult = buildContextStack({
          systemPrompt: this.settings.systemPrompt,
          tenantFacts: [...(session.l1?.tenantFacts || []), ...scqaFacts],
          userProfile: session.l2?.userProfile || {},
          sessionHistory: [...(session.l3?.history || []), userMessage],
          fileAttachments: session.l3?.fileAttachments || [],
          bootstrapContext,
          knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
          toolContext: ctx.params.toolContext || null,
          maxContextTokens: this.settings.maxContextTokens,
        });
        const reply = [
          'Ich habe aktuell noch keinen belastbaren deterministischen Ausführungspfad für diese Anfrage.',
          gapResponse?.suggestions?.[0] || null,
          gapResponse?.suggestions?.[1] || null,
        ]
          .filter(Boolean)
          .join(' ');
        const finalized = synthesizeAndPurgeLayer4(stackResult.stack, reply);
        const execution = {
          status: 'partial',
          completedSteps: 0,
          steps: [],
          stopPoint: gapResponse,
          meta: executionTrace.summarize({
            toolCalls: toolCallTracker.summarize().calls,
            chatModeSource,
          }),
        };
        const responseStrategy = this.buildResponseStrategy({
          message: ctx.params.message,
          knowledgeContext,
          knownContext,
          existingAssumptions: Array.isArray(session.l3?.assumptions) ? session.l3.assumptions : [],
          execution,
        });
        turnGraph = addNode(turnGraph, {
          id: 'response:strategy',
          type: 'strategy',
          label: 'Response strategy',
          data: {
            audienceType: responseStrategy.audience || null,
            epistemicState: responseStrategy.epistemicState || null,
            abstractionLevel: responseStrategy.abstractionLevel || null,
            nextDialogueMove: responseStrategy.nextMove || null,
            decisionRole: responseStrategy.decisionRole || null,
            confidence:
              typeof responseStrategy.confidence === 'number' ? responseStrategy.confidence : null,
            assumptionCount: Array.isArray(responseStrategy.assumptions)
              ? responseStrategy.assumptions.length
              : 0,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'chat:mode',
          to: 'response:strategy',
          type: 'shapes',
        });
        const persisted = buildPersistableSessionState({
          id: sessionId,
          tenantId,
          userId,
          l1: finalized.stack.l1,
          l2: finalized.stack.l2,
          l3: {
            ...finalized.stack.l3,
            chatMode: effectiveChatMode,
            chatModeSource,
            lastClassification: session.l3.lastClassification,
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            stateMachine: summarizeStateMachine(stateMachine),
            turnGraph: summarizeTurnGraph(turnGraph),
            responseStrategy,
          },
          createdAt: session.createdAt,
        });
        await this.persistSession(ctx, tenantId, sessionId, persisted);
        // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
        // v0.56.3 — ZNP context signals
        const _hitlItemId2 = ctx.params?.knownContext?.hitlItemId ?? null;
        const _handoffCtx2 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId2);
        const _znpCtx2 = buildZnpContextSnapshot(ctx, session, semanticClassification);
        const personaResolution = await this.resolvePersonaForTrace(ctx, {
          tenantId,
          sessionId,
          sourceService: 'personal-agent',
          sourceAction: 'chat',
          workflowType: semanticClassification?.workflowType ?? null,
          domainIntent:
            semanticClassification?.domainIntent ?? brokerRecommendation?.intent ?? null,
          ..._znpCtx2,
          handoffPersonaId: _handoffCtx2.handoffPersonaId,
          hitlItemId: _hitlItemId2,
          workflowCompletionState: _handoffCtx2.workflowCompletionState,
        });

        // v0.57.3 — workLog callsite 3: persona resolved
        if (personaResolution?.roleLabel) {
          turnWorkLog.addEntry({
            action: WORK_LOG_ACTIONS.PERSONA_RESOLVED,
            label: getSafePersonaLabel(personaResolution.roleLabel),
            metadata: {
              roleLabel: personaResolution.roleLabel,
              source: personaResolution.source || 'session',
              updateReason: 'role_consistency_check',
            },
          });
        }

        return {
          success: true,
          sessionId,
          executionMode,
          chatMode: effectiveChatMode,
          reply,
          workflowType: responsePolicyContract.workflowType,
          domainIntent: responsePolicyContract.domainIntent,
          evidenceStatus: responsePolicyContract.evidenceStatus,
          missingEvidence: responsePolicyContract.missingEvidence,
          nextVerificationSteps: responsePolicyContract.nextVerificationSteps,
          guardrailCorrections: [],
          layer4Purged: finalized.layer4Purged,
          l3Compressed: finalized.stack.l3?.compressed || false,
          historyCount: Array.isArray(finalized.stack.l3?.history)
            ? finalized.stack.l3.history.length
            : 0,
          routing: {
            source: 'routing-graph',
            routeKey: null,
            routeLabel: routingDecision.label,
            primaryIntent: brokerRecommendation?.intent || null,
            secondaryIntents: [],
            requestedDomains: detectRequestedDomains(ctx.params.message),
            unsupportedDomains: [],
            warnings: [gapResponse.gapReason],
          },
          plan: null,
          execution,
          stateMachine: summarizeStateMachine(stateMachine),
          executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
          turnGraph: summarizeTurnGraph(turnGraph),
          responseStrategy,
          agentTrace: this.buildAgentTrace({
            routing: null,
            plan: null,
            execution,
            evidencePlan: null,
            consultation: null,
            responseStrategy,
            stateMachine,
            executionStateGraph,
            turnGraph,
            routingDecision,
            personaResolution,
            bootstrapContext,
            knowledgeScope: [
              ...(session.l3?.knowledgeScopeDataPoints || []),
              ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
            ],
            workLog: turnWorkLog.toArray(),
          }),
          ...(receiptSelectionMetadata ? { metadata: receiptSelectionMetadata } : {}),
        };
      }

      if (
        (routingDecision.target === 'consultation_node' ||
          routingDecision.target === 'consultation_intro') &&
        !shouldPreferReceiptExecution
      ) {
        stateMachine = transitionStateMachine(
          stateMachine,
          PERSONAL_AGENT_STATES.CONSULTATION_ACTIVE,
          {
            intent: brokerRecommendation?.intent || 'consultation',
          }
        );
        if (jobStore) {
          jobStore.appendLog(
            jobId,
            'consultation_mode_entered',
            25,
            'Agentic consultation loop starting...',
            {
              chatMode: CHAT_MODES.CONSULTATION,
            }
          );
        }

        const consultationResponseStrategy = this.buildResponseStrategy({
          message: ctx.params.message,
          knowledgeContext,
          knownContext: brokerKnownContext,
          existingAssumptions: Array.isArray(session.l3?.assumptions) ? session.l3.assumptions : [],
        });
        const recentHistoryWindow = this.buildConsultationRecentHistoryWindow(session);

        // Resolve blueprint policy for this consultation turn (stickiness + synthesis framing)
        const _consultationTurnIndex = Array.isArray(session.l3?.history)
          ? session.l3.history.length
          : 0;
        let _activeConsultationRoutingPolicy = null;
        let _activeConsultationSynthesisPolicy = null;
        let _activeConsultationStickinessStart = null;

        // Enrich detection context with broker/semantic signals so that
        // single-signal messages (e.g. "Bürgermeister von 74889 Sinsheim")
        // reach MATCH_THRESHOLD when the broker already knows the intent.
        const _bpDetectContext = {
          ...brokerKnownContext,
          intent: brokerRecommendation?.intent || brokerKnownContext?.intent || null,
          domainIntent:
            semanticClassification?.domainIntent || brokerKnownContext?.domainIntent || null,
        };
        const _bpPromptHints = extractPromptHints(ctx.params.message);
        const _bpSignalMatch = detectBlueprintIntent(
          ctx.params.message,
          _bpDetectContext,
          _bpPromptHints
        );

        // Fallback: if signal scoring misses, resolve blueprint directly by primary intent.
        // This covers cases where the broker or semantic classifier already identified the
        // blueprint intent but the message alone had < MATCH_THRESHOLD signal hits.
        const _bpDocForPolicy = _bpSignalMatch
          ? loadBlueprint(_bpSignalMatch.blueprintId)
          : findBlueprintByPrimaryIntent(brokerRecommendation?.intent) ||
            findBlueprintByPrimaryIntent(semanticClassification?.domainIntent) ||
            null;

        if (_bpDocForPolicy) {
          const _bpPolicy = extractBlueprintPolicy(_bpDocForPolicy);
          const _bpHasPolicy = Boolean(_bpPolicy.routingPolicy || _bpPolicy.synthesisPolicy);
          if (_bpHasPolicy) {
            // Embed blueprint identity so appliedPolicy exposes blueprintId/version to callers.
            _activeConsultationRoutingPolicy = _bpPolicy.routingPolicy
              ? {
                  ..._bpPolicy.routingPolicy,
                  _blueprintId: _bpDocForPolicy.id,
                  _blueprintVersion: _bpDocForPolicy.version || null,
                }
              : null;
            _activeConsultationSynthesisPolicy = _bpPolicy.synthesisPolicy;
            _activeConsultationStickinessStart = _consultationTurnIndex;
          }
        }

        if (!_activeConsultationRoutingPolicy && !_activeConsultationSynthesisPolicy) {
          const _sessionRp = session?.l3?.activeRoutingPolicy || null;
          const _sessionStart =
            typeof session?.l3?.activeStickinessStartTurn === 'number'
              ? session.l3.activeStickinessStartTurn
              : null;
          if (_sessionRp && _sessionStart !== null) {
            const _elapsed = _consultationTurnIndex - _sessionStart;
            const _sticky = checkStickinessRetain(_sessionRp, ctx.params.message, _elapsed);
            if (_sticky.retain) {
              _activeConsultationRoutingPolicy = _sessionRp;
              _activeConsultationSynthesisPolicy = session?.l3?.activeSynthesisPolicy || null;
              _activeConsultationStickinessStart = _sessionStart;
            }
          }
        }

        const consultationResult = await this.handleConsultationTurn(ctx, {
          message: ctx.params.message,
          brokerRecommendation,
          knowledgeContext,
          receiptKnowledgeEvidence: receiptSelectionResult?.knowledgeEvidence || null,
          responseStrategy: consultationResponseStrategy,
          semanticClassification,
          session,
          resolvedParams: session.resolvedParams,
          knownContext: brokerKnownContext,
          routingDecision,
          jobId,
          executionTrace,
          toolCallTracker,
          recentHistoryWindow,
          synthesisPolicy: _activeConsultationSynthesisPolicy,
          routingPolicy: _activeConsultationRoutingPolicy,
        });

        const consultationExecution = {
          status:
            consultationResult?.status === 'awaiting-onboarding'
              ? 'awaiting-onboarding'
              : 'consulting',
          plan: null,
          steps: [],
          stopPoint:
            consultationResult?.stopPoint && typeof consultationResult.stopPoint === 'object'
              ? consultationResult.stopPoint
              : null,
        };
        const consultationPrimaryIntent = this.deriveConsultationPrimaryIntent({
          brokerRecommendation,
          routingDecision,
        });
        const consultationRouting = {
          source: 'consultation',
          routeKey: null,
          routeLabel: 'consultation',
          primaryIntent: consultationPrimaryIntent,
          secondaryIntents: [],
          requestedDomains: detectRequestedDomains(ctx.params.message),
          unsupportedDomains: [],
          warnings: [],
          chatMode: CHAT_MODES.CONSULTATION,
        };

        const stackResult = buildContextStack({
          systemPrompt: this.settings.systemPrompt,
          tenantFacts: [...(session.l1?.tenantFacts || []), ...scqaFacts],
          userProfile: session.l2?.userProfile || {},
          sessionHistory: [...(session.l3?.history || []), userMessage],
          fileAttachments: session.l3?.fileAttachments || [],
          bootstrapContext,
          knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
          toolContext: ctx.params.toolContext || null,
          maxContextTokens: this.settings.maxContextTokens,
        });

        stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.SYNTHESIZING, {
          consultationFacts: Array.isArray(consultationResult.factsUsed)
            ? consultationResult.factsUsed.length
            : 0,
        });
        if (consultationExecution.status === 'awaiting-onboarding') {
          stateMachine = transitionStateMachine(
            stateMachine,
            PERSONAL_AGENT_STATES.AWAITING_USER_INPUT,
            {
              reasonCode: consultationExecution?.stopPoint?.reasonCode || null,
              blockedAction: consultationExecution?.stopPoint?.blockedAction || null,
              blockedStep: consultationExecution?.stopPoint?.blockedStep || null,
            }
          );
        }
        stateMachine = transitionStateMachine(
          stateMachine,
          deriveTerminalState({
            consultation: consultationResult,
            status: consultationExecution.status,
          }),
          {
            status: consultationExecution.status,
            openQuestions: Array.isArray(consultationResult.openQuestions)
              ? consultationResult.openQuestions.length
              : 0,
          }
        );

        // Reuse the responseStrategy that was passed to the consultation LLM
        const responseStrategy = consultationResponseStrategy;
        turnGraph = addNode(turnGraph, {
          id: 'response:strategy',
          type: 'strategy',
          label: 'Response strategy',
          data: {
            audienceType: responseStrategy.audience || null,
            epistemicState: responseStrategy.epistemicState || null,
            abstractionLevel: responseStrategy.abstractionLevel || null,
            nextDialogueMove: responseStrategy.nextMove || null,
            decisionRole: responseStrategy.decisionRole || null,
            confidence:
              typeof responseStrategy.confidence === 'number' ? responseStrategy.confidence : null,
            assumptionCount: Array.isArray(responseStrategy.assumptions)
              ? responseStrategy.assumptions.length
              : 0,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'chat:mode',
          to: 'response:strategy',
          type: 'shapes',
        });

        const finalized = synthesizeAndPurgeLayer4(stackResult.stack, consultationResult.reply);
        const persisted = buildPersistableSessionState({
          id: sessionId,
          tenantId,
          userId,
          l1: finalized.stack.l1,
          l2: finalized.stack.l2,
          l3: {
            ...finalized.stack.l3,
            chatMode: effectiveChatMode,
            chatModeSource,
            lastClassification: session.l3.lastClassification,
            consultationContext: {
              hypotheses: consultationResult.hypotheses,
              openQuestions: consultationResult.openQuestions,
              nextActions: consultationResult.nextActions,
              factsUsed: consultationResult.factsUsed,
              attemptsSummary: Array.isArray(consultationResult.attemptsSummary)
                ? consultationResult.attemptsSummary
                : [],
              ts: new Date().toISOString(),
            },
            stateMachine: summarizeStateMachine(stateMachine),
            executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
            responseStrategy,
            activeRoutingPolicy: _activeConsultationRoutingPolicy || null,
            activeSynthesisPolicy: _activeConsultationSynthesisPolicy || null,
            activeStickinessStartTurn:
              _activeConsultationStickinessStart !== null
                ? _activeConsultationStickinessStart
                : null,
          },
          createdAt: session.createdAt,
        });

        persisted.l3.onboardingQuestions = Array.isArray(session.l3?.onboardingQuestions)
          ? session.l3.onboardingQuestions
          : [];
        persisted.l3.assumptions = Array.isArray(session.l3?.assumptions)
          ? session.l3.assumptions
          : [];
        persisted.l3.planStack = Array.isArray(session.planStack) ? session.planStack : [];
        persisted.l3.resolvedParams =
          session.resolvedParams && typeof session.resolvedParams === 'object'
            ? session.resolvedParams
            : {};
        persisted.l3.lastCompletedPlan =
          session.l3?.lastCompletedPlan && typeof session.l3.lastCompletedPlan === 'object'
            ? session.l3.lastCompletedPlan
            : null;
        persisted.l3.stopPoint =
          consultationExecution?.stopPoint && typeof consultationExecution.stopPoint === 'object'
            ? consultationExecution.stopPoint
            : null;
        persisted.l3.criticalStepCheckpoints =
          session.l3?.criticalStepCheckpoints &&
          typeof session.l3.criticalStepCheckpoints === 'object'
            ? session.l3.criticalStepCheckpoints
            : {};

        assertNoL4RawInPersistedState(persisted);
        await this.persistSession(ctx, tenantId, sessionId, persisted);

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

        status = 'consulting';

        const consultationPayload = {
          hypotheses: consultationResult.hypotheses,
          openQuestions: consultationResult.openQuestions,
          nextActions: consultationResult.nextActions,
          factsUsed: consultationResult.factsUsed,
          attemptsSummary: Array.isArray(consultationResult.attemptsSummary)
            ? consultationResult.attemptsSummary
            : [],
          workflowType:
            consultationResult.workflowType || semanticClassification?.workflowType || null,
          domainIntent:
            consultationResult.domainIntent || semanticClassification?.domainIntent || null,
          evidenceStatus: consultationResult.evidenceStatus || 'unverified',
          missingEvidence: Array.isArray(consultationResult.missingEvidence)
            ? consultationResult.missingEvidence
            : [],
          nextVerificationSteps: Array.isArray(consultationResult.nextVerificationSteps)
            ? consultationResult.nextVerificationSteps
            : [],
          guardrailCorrections: Array.isArray(consultationResult.guardrailCorrections)
            ? consultationResult.guardrailCorrections
            : [],
          ...(Array.isArray(consultationResult.debugTrace)
            ? { debugTrace: consultationResult.debugTrace }
            : {}),
        };

        const _consultationEvidenceCandidates = this.buildEvidenceRequirementsForRevalidation({
          tenantId,
          sessionId,
          personaId: rawKnownContext?.personaId || null,
          responsibleRole: rawKnownContext?.responsibleRole || null,
          missingEvidence: consultationPayload.missingEvidence,
          evidencePlan: null,
          execution: consultationExecution,
        });
        if (_consultationEvidenceCandidates.length > 0) {
          this.recordEvidenceRequirementsForRevalidation(
            ctx,
            _consultationEvidenceCandidates
          ).catch((err) =>
            this.logger?.warn(`evidence requirement recording failed: ${err.message}`)
          );
        }

        const consultationAttempts = Array.isArray(consultationPayload.attemptsSummary)
          ? consultationPayload.attemptsSummary
          : [];

        // v0.57.3 — workLog callsite 4a: consultation synthesis
        if (consultationResult && !consultationResult._isFallback) {
          turnWorkLog.addEntry({
            action: WORK_LOG_ACTIONS.CONSULTATION_SYNTHESIS,
            label: `Synthesized response from ${consultationAttempts.length} tool calls`,
            metadata: {
              toolCount: consultationAttempts.length,
              sourceCategory: (() => {
                const d = String(brokerRecommendation?.domain || '').toLowerCase();
                if (d.includes('grid') || d.includes('netz')) return 'grid_data';
                if (d.includes('market') || d.includes('markt') || d.includes('price'))
                  return 'market_data';
                if (d.includes('geo') || d.includes('location') || d.includes('osm'))
                  return 'geo_data';
                if (d.includes('regulat') || d.includes('recht') || d.includes('compliance'))
                  return 'regulatory_data';
                return 'other';
              })(),
              phase: 'synthesis',
            },
          });
        } else {
          // callsite 4b: consultation fallback
          turnWorkLog.addEntry({
            action: WORK_LOG_ACTIONS.CONSULTATION_FALLBACK,
            label: `Used fallback: TOOLS_UNAVAILABLE`,
            metadata: {
              reason: 'TOOLS_UNAVAILABLE',
              phase: 'synthesis',
              attemptCount: consultationAttempts.length,
            },
          });
        }

        consultationAttempts.forEach((attempt, idx) => {
          const toolNodeId = `tool:consultation:${idx + 1}:${attempt.tool || 'unknown'}`;
          turnGraph = addNode(turnGraph, {
            id: toolNodeId,
            type: 'tool',
            label: attempt.tool || 'consultation-tool',
            data: {
              status: attempt.status || null,
              attempts: attempt.attempts || null,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'chat:mode',
            to: toolNodeId,
            type: 'invokes',
          });
        });

        const factsUsed = Array.isArray(consultationPayload.factsUsed)
          ? consultationPayload.factsUsed
          : [];
        factsUsed.slice(0, 8).forEach((fact, idx) => {
          const factNodeId = `fact:consultation:${idx + 1}`;
          turnGraph = addNode(turnGraph, {
            id: factNodeId,
            type: 'fact',
            label: `Consultation fact ${idx + 1}`,
            data: {
              source: fact?.source || null,
              value: fact?.value || null,
            },
          });
          turnGraph = addEdge(turnGraph, {
            from: 'chat:mode',
            to: factNodeId,
            type: 'grounds',
          });
        });

        turnGraph = finalizeTurnGraph(turnGraph, { status: 'completed' });

        // ═══ Consultation-to-Execution Bridge ═══
        let executionReadiness = null;
        let consultationPlanResults = null;
        let receiptReflectionResult = buildReceiptReflectionAuditSeed(receiptSelectionResult); // v0.57.5 #158
        // effectiveReceiptContext carries the hydrated context into executeWithReceipt.
        // Starts as brokerKnownContext; upgraded to patchedContext after a successful reflection.
        let effectiveReceiptContext = brokerKnownContext || {}; // v0.57.5 #158

        try {
          executionReadiness = buildConsultationExecutionPlan({
            message: ctx.params.message,
            consultation: consultationPayload,
            brokerRecommendation,
            knownContext: brokerKnownContext || {},
            semanticClassification,
            responseStrategy: consultationResponseStrategy,
            executionMode,
            routingPolicy: _activeConsultationRoutingPolicy || null,
            synthesisPolicy: _activeConsultationSynthesisPolicy || null,
          });

          turnGraph = addWorkflowPlanNode(turnGraph, executionReadiness);

          // ─── Receipt Selection Integration (v0.54.3) ─────
          // If receiptSelectionResult has a selectedReceipt and disableReceiptSelection is false,
          // use executeWithReceipt for deterministic receipt-based execution.
          let selectedReceipt = receiptSelectionResult?.selectedReceipt || null;

          // ─── Receipt Reflection / Context-Hydration Loop (v0.57.5 #158) ─────
          // When a receipt is selected but not executable due to scope-blocked or
          // missing-input steps, perform exactly one bounded reflection attempt:
          // extract structured context from the user message and session history,
          // validate the patch, merge it, and re-run receipt evaluation.
          // No WOL events, no tenant knowledge promotion, no raw-data persistence.
          if (
            selectedReceipt &&
            !ctx.params.disableReceiptSelection &&
            !forceReceiptRequested &&
            receiptSelectionResult?.evaluation?.executable === false &&
            hasScopeBlockedOrMissingSteps(receiptSelectionResult?.evaluation)
          ) {
            try {
              const reflectionEval = receiptSelectionResult.evaluation;
              const missingRequiredInputs = Array.isArray(reflectionEval?.missingRequiredInputs)
                ? reflectionEval.missingRequiredInputs
                : [];
              const scopeViolations = flattenScopeViolations(reflectionEval);

              // Source: current session only (tenant-scoped, sanitized by #149 infrastructure)
              const recentHistory = this.buildConsultationRecentHistoryWindow(session);

              const { system: reflSystem, user: reflUser } = buildReflectionPrompt({
                userMessage: ctx.params.message,
                consultationHistory: recentHistory,
                knownContext: sanitizeKnownContextForReflectionPrompt(brokerKnownContext || {}),
                missingRequiredInputs,
                scopeViolations,
                receiptId: receiptSelectionResult.receiptId || null,
              });

              const reflectionResponse = await this.callLlmGenerate(ctx, {
                system: reflSystem,
                user: reflUser,
                schema: REFLECTION_OUTPUT_SCHEMA,
                temperature: 0.1,
                maxTokens: 512,
              });

              // Unwrap structured response (broker vs local llm-client shape)
              const reflData =
                reflectionResponse &&
                typeof reflectionResponse === 'object' &&
                reflectionResponse.data &&
                typeof reflectionResponse.data === 'object'
                  ? reflectionResponse.data
                  : reflectionResponse || {};

              const rawPatch =
                reflData.resolvedContextPatch && typeof reflData.resolvedContextPatch === 'object'
                  ? reflData.resolvedContextPatch
                  : {};
              const rawConfidence =
                typeof reflData.confidence === 'string' ? reflData.confidence : 'low';
              const rawEvidence = typeof reflData.evidence === 'string' ? reflData.evidence : '';
              const rawUnresolvedScopes = Array.isArray(reflData.unresolvedScopes)
                ? reflData.unresolvedScopes
                : [];

              const { sanitizedPatch, rejectedKeys } = validateReflectionPatch({
                patch: rawPatch,
                missingRequiredInputs,
                scopeViolations,
              });

              const patchedFields = Object.keys(sanitizedPatch);

              if (patchedFields.length > 0) {
                // Merge via resolveContextMutation to enforce Zwiebelmodus semantics
                const { mergedParams: patchedContext } = resolveContextMutation(
                  brokerKnownContext || {},
                  sanitizedPatch
                );

                // Re-run receipt selection exactly once with the hydrated context
                const reflectedResult = await this.selectRuntimeReceipt(ctx, {
                  message: ctx.params.message,
                  context: {
                    knownContext: patchedContext,
                    semanticClassification,
                    brokerRecommendation,
                    effectiveChatMode,
                    sessionId,
                  },
                  input: {
                    message: ctx.params.message,
                    knownContext: patchedContext,
                    workflowType: semanticClassification?.workflowType || null,
                    domainIntent:
                      semanticClassification?.domainIntent || brokerRecommendation?.intent || null,
                  },
                  // Prefer the same receipt; do NOT forceReceipt (would throw if still blocked)
                  preferredReceipts: [receiptSelectionResult.receiptId].filter(Boolean),
                  allowDraftReceipts: ctx.params.allowDraftReceipts === true,
                  explainReceiptSelection: false,
                  disableReceiptSelection: false,
                });

                const reflectionResolved = reflectedResult?.evaluation?.executable === true;

                if (reflectionResolved) {
                  // Promote the reflected result into the live receipt selection state
                  selectedReceipt = reflectedResult?.selectedReceipt || selectedReceipt;
                  receiptSelectionResult.evaluation = reflectedResult.evaluation;
                  receiptSelectionResult.selectedReceipt =
                    reflectedResult.selectedReceipt || receiptSelectionResult.selectedReceipt;
                  // Ensure execution uses the hydrated context, not the original brokerKnownContext
                  effectiveReceiptContext = patchedContext; // v0.57.5 #158
                }

                receiptReflectionResult = {
                  ...(receiptReflectionResult || {}),
                  attempted: true,
                  outcome: reflectionResolved ? 'resolved' : 'still-blocked',
                  validationOutcome:
                    rejectedKeys.length > 0 ? 'accepted-with-rejections' : 'accepted',
                  resolvedFields: patchedFields,
                  confidence: rawConfidence,
                  evidence: String(rawEvidence).slice(0, 300),
                  unresolvedScopes: rawUnresolvedScopes,
                  rejectedKeys,
                  reEvaluation: {
                    performed: true,
                    executable: reflectedResult?.evaluation?.executable === true,
                  },
                  receipt: buildReceiptReflectionSummary(receiptSelectionResult),
                };
              } else {
                receiptReflectionResult = {
                  ...(receiptReflectionResult || {}),
                  attempted: true,
                  outcome: 'validation-rejected',
                  validationOutcome: 'rejected',
                  resolvedFields: [],
                  confidence: rawConfidence,
                  evidence: String(rawEvidence).slice(0, 300),
                  unresolvedScopes: rawUnresolvedScopes,
                  rejectedKeys,
                  reEvaluation: {
                    performed: false,
                    executable: null,
                  },
                  receipt: buildReceiptReflectionSummary(receiptSelectionResult),
                };
              }
            } catch (reflectionError) {
              this.logger?.warn(`Receipt reflection attempt failed: ${reflectionError.message}`);
              const reflectionOutcome =
                isActionUnavailable(reflectionError) || isNotFound(reflectionError)
                  ? 'unavailable'
                  : 'llm-error';
              receiptReflectionResult = {
                ...(receiptReflectionResult || {}),
                attempted: true,
                outcome: reflectionOutcome,
                validationOutcome: 'not-performed',
                resolvedFields: [],
                confidence: 'low',
                evidence: '',
                unresolvedScopes: [],
                rejectedKeys: [],
                reEvaluation: {
                  performed: false,
                  executable: null,
                },
                receipt: buildReceiptReflectionSummary(receiptSelectionResult),
              };
            }
          }

          if (receiptReflectionResult && receiptSelectionResult) {
            receiptReflectionResult.receipt = buildReceiptReflectionSummary(receiptSelectionResult);
          }
          // ─────────────────────────────────────────────────

          const useReceiptExecution =
            selectedReceipt &&
            !ctx.params.disableReceiptSelection &&
            receiptSelectionResult?.evaluation?.executable === true;

          if (useReceiptExecution) {
            try {
              const toolResolver = {
                executeTool: async (action, params) => {
                  const result = await ctx.call(action, params, { meta: ctx.meta });
                  return {
                    action,
                    status: result?.success === false ? 'failed' : 'completed',
                    result,
                    error:
                      result?.success === false ? result?.error?.message || result?.message : null,
                  };
                },
              };
              consultationPlanResults = await executeWithReceipt(
                selectedReceipt,
                this.buildReceiptExecutionContext({
                  message: ctx.params.message,
                  knownContext: {
                    ...effectiveReceiptContext,
                    ...(receiptSelectionResult?.evaluation?.plannedToolCalls?.[0]?.params || {}),
                  }, // v0.57.5 #158: patched after reflection + receipt-evaluated hints
                  resolvedParams: session?.resolvedParams || {},
                  observations: [],
                }),
                [],
                toolResolver,
                this.logger
              );
              receiptSelectionResult.execution = {
                used: true,
                executor: 'executeWithReceipt',
                fallbackReason: null,
                executedToolCalls: Array.isArray(consultationPlanResults?.steps)
                  ? consultationPlanResults.steps.map((step) => ({
                      step: Number(step?.step || 0) || null,
                      action: step?.action || step?.outcome?.action || null,
                      status: step?.status || null,
                      params: step?.params || {},
                    }))
                  : [],
              };
              if (receiptReflectionResult && receiptSelectionResult) {
                receiptReflectionResult.receipt =
                  buildReceiptReflectionSummary(receiptSelectionResult);
              }
            } catch (receiptExecError) {
              this.logger?.warn(
                `Receipt execution failed (${selectedReceipt.receiptId || selectedReceipt.id || 'unknown-receipt'}): ${receiptExecError.message}, falling back to legacy execution`
              );
              if (forceReceiptRequested) {
                throw new MoleculerClientError(
                  `Forced receipt execution failed: ${receiptExecError.message}`,
                  422,
                  'RECEIPT_FORCED_EXECUTION_FAILED',
                  {
                    forceReceipt: ctx.params.forceReceipt,
                  }
                );
              }
              receiptSelectionResult.execution = {
                used: false,
                executor: 'executeWithReceipt',
                fallbackReason: 'receipt_execution_failed',
              };
              // Fall back to legacy if receipt execution fails
              if (
                executionReadiness.canExecuteNow &&
                executionReadiness.executableSteps.length > 0
              ) {
                consultationPlanResults = await this.executeConsultationToolPlan(ctx, {
                  plan: executionReadiness,
                  knownContext: brokerKnownContext || {},
                  session,
                  executionTrace,
                  toolCallTracker,
                });
              }
            }
          } else if (
            executionReadiness.canExecuteNow &&
            executionReadiness.executableSteps.length > 0
          ) {
            receiptSelectionResult.execution = {
              used: false,
              executor: 'executeWithReceipt',
              fallbackReason:
                ctx.params.disableReceiptSelection === true
                  ? 'disabled_by_request'
                  : selectedReceipt
                    ? 'receipt_not_executable'
                    : 'no_selected_receipt',
            };
            // Legacy execution path (no receipt, or receipt selection disabled)
            consultationPlanResults = await this.executeConsultationToolPlan(ctx, {
              plan: executionReadiness,
              knownContext: brokerKnownContext || {},
              session,
              executionTrace,
              toolCallTracker,
            });
          }
          // ─────────────────────────────────────────────────

          if (jobStore) {
            jobStore.appendLog(
              jobId,
              'consultation_execution_bridge',
              45,
              `Execution readiness: ${executionReadiness.readiness} / workflow: ${executionReadiness.workflowType}${useReceiptExecution ? ` / receipt: ${selectedReceipt.id}` : ''}`,
              {
                canExecuteNow: executionReadiness.canExecuteNow,
                stepCount: executionReadiness.executableSteps.length,
                receiptUsed: Boolean(useReceiptExecution),
              }
            );
          }
        } catch (_bridgeError) {
          this.logger?.warn(
            `[actions-part-01-of-1] silent-catch-fallback (line 4370): ${_bridgeError && _bridgeError.message}`
          );
          executionReadiness = null;
          consultationPlanResults = null;
        }
        // ═══════════════════════════════════════

        const consultationExecutionForTrace = {
          ...consultationExecution,
          meta: executionTrace.summarize({
            toolCalls: toolCallTracker.summarize().calls,
            chatModeSource,
            consultationIterations: consultationAttempts.length,
          }),
        };
        const quality = this.buildQualitySummary({
          evidencePlan: null,
          execution: consultationExecution,
          consultation: consultationPayload,
        });
        receiptSelectionMetadata = this.buildReceiptSelectionMetadata(receiptSelectionResult, {
          includeDiagnostics: receiptSelectionDiagnosticsRequested,
        });
        // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
        // v0.56.3 — ZNP context signals
        const _hitlItemId3 =
          session?.l3?.stopPoint?.hitlItemId ?? ctx.params?.knownContext?.hitlItemId ?? null;
        const _handoffCtx3 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId3);
        const _znpCtx3 = buildZnpContextSnapshot(ctx, session, semanticClassification);
        const personaResolution = await this.resolvePersonaForTrace(ctx, {
          tenantId,
          sessionId,
          sourceService: 'personal-agent',
          sourceAction: 'chat',
          workflowType:
            consultationPayload?.workflowType ?? semanticClassification?.workflowType ?? null,
          domainIntent:
            consultationPayload?.domainIntent ?? semanticClassification?.domainIntent ?? null,
          ..._znpCtx3,
          handoffPersonaId: _handoffCtx3.handoffPersonaId,
          hitlItemId: _hitlItemId3,
          workflowCompletionState: _handoffCtx3.workflowCompletionState,
        });

        // v0.57.3 — workLog callsite 3: persona resolved
        if (personaResolution?.roleLabel) {
          turnWorkLog.addEntry({
            action: WORK_LOG_ACTIONS.PERSONA_RESOLVED,
            label: getSafePersonaLabel(personaResolution.roleLabel),
            metadata: {
              roleLabel: personaResolution.roleLabel,
              source: personaResolution.source || 'session',
              updateReason: 'role_consistency_check',
            },
          });
        }

        const activeConsultationPolicy =
          executionReadiness?.appliedPolicy ||
          (_activeConsultationRoutingPolicy
            ? {
                sessionIntent: _activeConsultationRoutingPolicy.sessionIntent || null,
                blueprintId: _activeConsultationRoutingPolicy._blueprintId || null,
                blueprintVersion: _activeConsultationRoutingPolicy._blueprintVersion || null,
                source: 'blueprint-policy',
              }
            : null);

        const agentTrace = this.buildAgentTrace({
          routing: consultationRouting,
          plan: null,
          execution: consultationExecutionForTrace,
          evidencePlan: null,
          consultation: consultationPayload,
          responseStrategy,
          stateMachine,
          executionStateGraph,
          turnGraph,
          routingDecision,
          personaResolution,
          bootstrapContext,
          knowledgeScope: [
            ...(session.l3?.knowledgeScopeDataPoints || []),
            ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
          ],
          workLog: turnWorkLog.toArray(),
          reflection: receiptReflectionResult, // v0.57.5 #158
          locationResolution: brokerKnownContext._locationResolutionTrace || null, // v0.60
          policy: activeConsultationPolicy,
        });

        persisted.l3.turnGraph = summarizeTurnGraph(turnGraph);

        const consultationExecutionPublic =
          receiptSelectionResult?.execution?.used === true &&
          Array.isArray(consultationPlanResults?.steps) &&
          consultationPlanResults.steps.length > 0
            ? {
                ...consultationExecution,
                status: 'completed',
                steps: consultationPlanResults.steps,
              }
            : consultationExecution;
        const groundedReceiptReply = this.buildGroundedReceiptReply(
          ctx.params.message,
          receiptSelectionResult,
          consultationPlanResults
        );

        const consultationGroundedReply = this.appendGroundingContractToReply(
          groundedReceiptReply || consultationResult.reply,
          {
            execution: consultationPlanResults || consultationExecutionPublic,
            knowledgeScope: [
              ...(session.l3?.knowledgeScopeDataPoints || []),
              ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
            ],
            missingEvidence: consultationPayload.missingEvidence,
            assumptions: consultationPayload.hypotheses,
          }
        );

        return {
          success: true,
          status,
          sessionId,
          executionMode,
          chatMode: effectiveChatMode,
          reply: consultationGroundedReply,
          workflowType: consultationPayload.workflowType,
          domainIntent: consultationPayload.domainIntent,
          evidenceStatus: consultationPayload.evidenceStatus,
          missingEvidence: consultationPayload.missingEvidence,
          nextVerificationSteps: consultationPayload.nextVerificationSteps,
          guardrailCorrections: consultationPayload.guardrailCorrections,
          consultation: consultationPayload,
          layer4Purged: finalized.layer4Purged,
          l3Compressed: Boolean(finalized.stack?.l3?.compressed),
          contextUsage: stackResult.usage,
          historyCount: finalized.stack?.l3?.history?.length || 0,
          fileProcessing,
          routing: consultationRouting,
          responseStrategy,
          policy: activeConsultationPolicy,
          executionReadiness: executionReadiness || null,
          consultationPlanResults: consultationPlanResults || null,
          plan: {
            steps: [],
            onboardingHints: [],
          },
          evidencePlan: null,
          evidenceGaps: [],
          evidenceConfidence: null,
          quality,
          agentTrace,
          stateMachine: summarizeStateMachine(stateMachine),
          executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
          turnGraph: summarizeTurnGraph(turnGraph),
          execution: consultationExecutionPublic,
          ...(receiptSelectionMetadata ? { metadata: receiptSelectionMetadata } : {}),
        };
      }

      // Log broker plan phase
      if (jobStore) {
        jobStore.appendLog(jobId, 'broker_plan', 20, 'Planning execution strategy...', {
          chatMode: effectiveChatMode,
        });
      }

      if (!hasApprovedHitlResumePlan) {
        const resumable = findResumableParentFrame(session.planStack);
        if (resumable?.parentFrame) {
          const freshDomains = detectRequestedDomains(ctx.params.message);
          const parentDomains = Array.isArray(resumable.parentFrame.routing?.requestedDomains)
            ? resumable.parentFrame.routing.requestedDomains
            : [];
          const domainMismatch =
            freshDomains.length > 0 &&
            freshDomains.some((domain) => !parentDomains.includes(domain));

          if (!domainMismatch) {
            const resumed = resumeParentPlanFrame(session.planStack, session.resolvedParams);
            if (resumed?.parentFrame) {
              session.planStack = resumed.planStack;
              routing = {
                ...(resumed.parentFrame.routing || {}),
                primaryIntent:
                  resumed.parentFrame.intent || resumed.parentFrame.routing?.primaryIntent || null,
              };
              plan = mergeResolvedParamsIntoPlan(resumed.parentFrame.plan, session.resolvedParams);
            }
          }
        }
      }

      // Approved HITL resume: use the stored plan from the blocked checkpoint instead of broker-derived plan
      if (!plan && hasApprovedHitlResumePlan) {
        plan = session.l3._approvedHitlResume || approvedHitlResumePlan;
        routing = {
          primaryIntent: plan.primaryIntent || 'approved_hitl_resume',
          requestedDomains: Array.isArray(plan.requestedDomains) ? plan.requestedDomains : [],
        };
      }

      if (!plan) {
        plan = buildExecutionPlan({
          message: ctx.params.message,
          brokerRecommendation,
          knowledgeContext,
          knownContext,
        });
        routing = {
          primaryIntent: plan.primaryIntent,
          requestedDomains: Array.isArray(plan.requestedDomains) ? plan.requestedDomains : [],
        };
      }

      const preflightKnownContext = this.hydrateKnownContextFromSession(
        { ...knownContext },
        session
      );
      if (inhouseData.length > 0) {
        preflightKnownContext.inhouseData = inhouseData;
      }
      const routedPlan = applyMissingContextFallback(plan, {
        knownContext: preflightKnownContext,
        executionMode,
      });
      stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.EXECUTION_PLANNED, {
        primaryIntent: routedPlan?.primaryIntent || null,
        stepCount: Array.isArray(routedPlan?.steps) ? routedPlan.steps.length : 0,
      });

      // Log execution start
      if (jobStore) {
        jobStore.appendLog(
          jobId,
          'broker_execute',
          50,
          `Executing plan (${Array.isArray(routedPlan?.steps) ? routedPlan.steps.length : 0} steps)...`,
          {
            planId: routedPlan?.id || null,
            primaryIntent: routing?.primaryIntent || null,
            stepCount: Array.isArray(routedPlan?.steps) ? routedPlan.steps.length : 0,
          }
        );
      }

      let execution = null;
      const selectedReceiptForExecution = receiptSelectionResult?.selectedReceipt || null;
      const canRunReceiptExecution =
        Boolean(selectedReceiptForExecution) &&
        ctx.params.disableReceiptSelection !== true &&
        (executionMode === EXECUTION_MODES.AUTO ||
          forceReceiptRequested ||
          shouldPreferReceiptExecution);

      if (canRunReceiptExecution) {
        try {
          const receiptExecutionContext = this.buildReceiptExecutionContext({
            message: ctx.params.message,
            knownContext: {
              ...preflightKnownContext,
              ...(routedPlan?.promptHints || {}),
              ...(receiptSelectionResult?.evaluation?.plannedToolCalls?.[0]?.params || {}),
            },
            resolvedParams: session?.resolvedParams || {},
            observations: [],
          });

          const receiptExecutionResult = await executeWithReceipt(
            selectedReceiptForExecution,
            receiptExecutionContext,
            [],
            {
              executeTool: async (action, params) => {
                const result = await ctx.call(action, params, {
                  meta: { ...ctx.meta, $gateway: false },
                });
                return {
                  action,
                  status: result?.success === false ? 'failed' : 'completed',
                  result,
                  error:
                    result?.success === false ? result?.error?.message || result?.message : null,
                };
              },
            },
            this.logger
          );

          execution = this.normalizeReceiptExecutionResult(receiptExecutionResult, {
            plan: routedPlan,
            message: ctx.params.message,
          });

          receiptSelectionResult.execution = {
            used: true,
            executor: 'executeWithReceipt',
            fallbackReason: null,
            executedToolCalls: Array.isArray(execution?.steps)
              ? execution.steps.map((step) => ({
                  step: Number(step?.step || 0) || null,
                  action: step?.action || null,
                  status: step?.status || null,
                  params: step?.params || {},
                }))
              : [],
          };
        } catch (receiptExecError) {
          receiptSelectionResult.execution = {
            used: false,
            executor: 'executeWithReceipt',
            fallbackReason: 'receipt_execution_failed',
          };

          if (forceReceiptRequested) {
            throw new MoleculerClientError(
              `Forced receipt execution failed: ${receiptExecError.message}`,
              422,
              'RECEIPT_FORCED_EXECUTION_FAILED',
              {
                forceReceipt: ctx.params.forceReceipt,
              }
            );
          }
        }
      } else if (forceReceiptRequested) {
        throw new MoleculerClientError(
          'Forced receipt was selected but cannot be executed in the current mode/context.',
          422,
          'RECEIPT_FORCED_NOT_EXECUTABLE',
          {
            executionMode,
          }
        );
      }

      if (!execution) {
        if (!receiptSelectionResult.execution) {
          receiptSelectionResult.execution = {
            used: false,
            executor: 'executeWithReceipt',
            fallbackReason:
              ctx.params.disableReceiptSelection === true ? 'disabled_by_request' : 'legacy_path',
          };
        }

        execution = await this.handleExecutionWithOnboarding(ctx, {
          message: ctx.params.message,
          plan: routedPlan,
          knownContext: preflightKnownContext,
          session,
          executionMode,
          executionTrace,
          toolCallTracker,
        });
      }
      receiptSelectionMetadata = this.buildReceiptSelectionMetadata(receiptSelectionResult, {
        includeDiagnostics: receiptSelectionDiagnosticsRequested,
      });
      const executionStepsForGraph = Array.isArray(execution?.steps) ? execution.steps : [];
      executionStepsForGraph.forEach((step) => {
        const stepNodeId = `tool:execution:${step?.step || 'x'}:${step?.action || 'unknown'}`;
        turnGraph = addNode(turnGraph, {
          id: stepNodeId,
          type: 'tool',
          label: step?.action || 'execution-step',
          data: {
            step: step?.step || null,
            status: step?.status || null,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'chat:mode',
          to: stepNodeId,
          type: 'invokes',
        });
      });
      stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.EXECUTION_RUNNING, {
        status: execution?.status || null,
        completedSteps: (Array.isArray(execution?.steps) ? execution.steps : []).filter(
          (step) => step?.status === 'completed'
        ).length,
      });

      // Log execution result
      if (jobStore) {
        jobStore.appendLog(
          jobId,
          'broker_execute_complete',
          70,
          `Execution ${execution?.status || 'unknown'}`,
          {
            executionStatus: execution?.status || null,
            completedSteps: (Array.isArray(execution?.steps) ? execution.steps : []).filter(
              (s) => s?.status === 'completed'
            ).length,
            totalSteps: Array.isArray(execution?.steps) ? execution.steps.length : 0,
          }
        );
      }

      let responsePlan = execution?.plan || routedPlan || plan;
      const receiptExecutionUsed = receiptSelectionResult?.execution?.used === true;
      const receiptGroundedReply = receiptExecutionUsed
        ? this.buildGroundedReceiptReply(ctx.params.message, receiptSelectionResult, execution)
        : null;
      status = execution?.status || 'completed';
      const evidenceGapsForGraph = Array.isArray(responsePlan?.evidencePlan?.gaps)
        ? responsePlan.evidencePlan.gaps
        : [];
      evidenceGapsForGraph.slice(0, 8).forEach((gap, idx) => {
        const gapNodeId = `gap:evidence:${idx + 1}`;
        turnGraph = addNode(turnGraph, {
          id: gapNodeId,
          type: 'gap',
          label: gap?.id || `Evidence gap ${idx + 1}`,
          data: {
            required: gap?.required || null,
            severity: gap?.severity || null,
          },
        });
        turnGraph = addEdge(turnGraph, {
          from: 'broker:recommendation',
          to: gapNodeId,
          type: 'requires_evidence',
        });
      });
      routing = {
        ...(routing || {}),
        primaryIntent: responsePlan?.primaryIntent || routing?.primaryIntent || null,
        requestedDomains: Array.isArray(responsePlan?.requestedDomains)
          ? responsePlan.requestedDomains
          : Array.isArray(routing?.requestedDomains)
            ? routing.requestedDomains
            : [],
      };

      if (
        (execution?.status === 'awaiting-onboarding' || execution?.status === 'partial') &&
        routing?.primaryIntent
      ) {
        const currentStack = Array.isArray(session.planStack) ? session.planStack : [];
        if (hasRecentIntentLoop(currentStack, routing.primaryIntent)) {
          try {
            assertNoRecentIntentLoop(currentStack, routing.primaryIntent);
          } catch (loopError) {
            this.logger?.warn(
              `Plan-stack loop guard triggered for intent ${routing.primaryIntent}: ${loopError.message}`
            );
          }
        }
        session.planStack = pushPlanFrame(
          currentStack,
          {
            intent: routing.primaryIntent,
            routing,
            plan: responsePlan,
            awaitingParams: execution.stopPoint?.missingParams || [],
            resolvedParamsSnapshot: { ...session.resolvedParams },
            hitlItemId: execution.stopPoint?.hitlItemId || null,
            blockedAction: execution.stopPoint?.blockedAction || null,
            blockedStep: execution.stopPoint?.blockedStep || null,
            checkpointKey:
              execution.stopPoint?.hitlItemId && responsePlan
                ? this.buildCriticalStepCheckpointKey(responsePlan, {
                    step: execution.stopPoint?.blockedStep || 0,
                    action: execution.stopPoint?.blockedAction || 'unknown-action',
                  })
                : null,
            planSnapshot:
              execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL'
                ? this.buildCriticalStepResumeSnapshot(responsePlan, {
                    action: execution.stopPoint?.blockedAction || null,
                    step: execution.stopPoint?.blockedStep || null,
                    responsibleRole: execution.stopPoint?.responsibleRole || null,
                    requiredResolverRoles: Array.isArray(execution.stopPoint?.requiredResolverRoles)
                      ? execution.stopPoint.requiredResolverRoles
                      : [],
                    personaId: execution.stopPoint?.personaId || null,
                    personaName: execution.stopPoint?.personaName || null,
                    personaType: execution.stopPoint?.personaType || null,
                    personaResolution: execution.stopPoint?.personaResolution || null,
                    routingContext: execution.stopPoint?.routingContext || null,
                  })
                : null,
            responsibleRole: execution.stopPoint?.responsibleRole || null,
            requiredResolverRoles: Array.isArray(execution.stopPoint?.requiredResolverRoles)
              ? execution.stopPoint.requiredResolverRoles
              : [],
            personaId: execution.stopPoint?.personaId || null,
            personaName: execution.stopPoint?.personaName || null,
            personaType: execution.stopPoint?.personaType || null,
            personaResolution: execution.stopPoint?.personaResolution || null,
            routingContext: execution.stopPoint?.routingContext || null,
          },
          { maxDepth: 5 }
        );
      }

      if (execution?.status === 'completed') {
        session.planStack = markTopFrameCompleted(
          session.planStack,
          routing?.primaryIntent || null
        );
        const stepResults = (Array.isArray(execution.steps) ? execution.steps : [])
          .filter((step) => step?.status === 'completed')
          .map((step) => step?.result?.data)
          .filter((data) => data && typeof data === 'object' && !Array.isArray(data))
          .reduce((acc, data) => ({ ...acc, ...data }), {});
        session.resolvedParams = {
          ...session.resolvedParams,
          ...stepResults,
        };
        // Track resolved capabilities to prevent broker from re-selecting them
        if (!session.resolvedCapabilities) session.resolvedCapabilities = [];
        if (routing?.primaryIntent) {
          session.resolvedCapabilities.push({
            capability: routing.primaryIntent,
            resolvedAt: new Date().toISOString(),
          });
        }
        if (routing?.primaryIntent) {
          session.l3.lastCompletedPlan = {
            intent: routing.primaryIntent,
            at: new Date().toISOString(),
          };
        }
      }

      session.l3.planStack = Array.isArray(session.planStack) ? session.planStack : [];
      session.l3.resolvedParams =
        session.resolvedParams && typeof session.resolvedParams === 'object'
          ? session.resolvedParams
          : {};
      session.l3.resolvedCapabilities = Array.isArray(session.resolvedCapabilities)
        ? session.resolvedCapabilities
        : [];

      const stackResult = buildContextStack({
        systemPrompt: this.settings.systemPrompt,
        tenantFacts: [...(session.l1?.tenantFacts || []), ...scqaFacts],
        userProfile: session.l2?.userProfile || {},
        sessionHistory: [...(session.l3?.history || []), userMessage],
        fileAttachments: session.l3?.fileAttachments || [],
        bootstrapContext,
        knowledgeScopeDataPoints: session.l3?.knowledgeScopeDataPoints || [],
        toolContext: ctx.params.toolContext || null,
        maxContextTokens: this.settings.maxContextTokens,
      });
      stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.SYNTHESIZING, {
        status: execution?.status || null,
        presentationCandidate: this.hasStructuredExecutionResult(execution),
      });

      // A) Strategic milestone: about to generate LLM synthesis
      if (jobStore) {
        jobStore.appendLog(jobId, 'llm_generating', 50, 'Generating synthesis reply...', {
          executionStatus: execution?.status || null,
          stepCount: Array.isArray(execution?.steps) ? execution.steps.length : 0,
        });
      }

      const responseStrategy = this.buildResponseStrategy({
        message: ctx.params.message,
        plan: responsePlan,
        execution,
        knowledgeContext,
        knownContext: preflightKnownContext,
        missingParams: execution?.stopPoint?.missingParams || [],
        existingAssumptions: Array.isArray(execution?.assumptions)
          ? execution.assumptions
          : Array.isArray(session.l3?.assumptions)
            ? session.l3.assumptions
            : [],
      });
      turnGraph = addNode(turnGraph, {
        id: 'response:strategy',
        type: 'strategy',
        label: 'Response strategy',
        data: {
          audienceType: responseStrategy.audience || null,
          epistemicState: responseStrategy.epistemicState || null,
          abstractionLevel: responseStrategy.abstractionLevel || null,
          nextDialogueMove: responseStrategy.nextMove || null,
          decisionRole: responseStrategy.decisionRole || null,
          confidence:
            typeof responseStrategy.confidence === 'number' ? responseStrategy.confidence : null,
          assumptionCount: Array.isArray(responseStrategy.assumptions)
            ? responseStrategy.assumptions.length
            : 0,
        },
      });
      turnGraph = addEdge(turnGraph, {
        from: 'chat:mode',
        to: 'response:strategy',
        type: 'shapes',
      });

      let synthesisText = this.synthesizeTurn({
        message: ctx.params.message,
        toolContext: ctx.params.toolContext,
        executionMode,
        plan: responsePlan,
        execution,
        fileProcessing,
        knowledgeContext,
        responseStrategy,
        ctx,
        tenantId,
        sessionId,
      });
      if (receiptGroundedReply) {
        synthesisText = receiptGroundedReply;
      }

      // A) Strategic milestone: synthesis done, now building presentation
      if (jobStore) {
        jobStore.appendLog(
          jobId,
          'synthesizing',
          80,
          'Synthesis complete, building presentation...',
          {
            replyLength: String(synthesisText || '').length,
          }
        );
      }

      // Try to render presentation for execution result
      let presentationResult = {};
      let presentationApplied = false;
      let presentationType = null;
      let presentationGrounding = null;

      if (receiptGroundedReply) {
        presentationApplied = true;
        presentationType = 'receipt_grounded_reply';
        presentationGrounding = {
          selectedType: presentationType,
          allowedTypes: ['receipt_grounded_reply', 'debug_summary'],
          blockedReason: null,
          sourceActions: ['energy-market.co2Intensity'],
          evidenceGapIds: [],
          basis: {
            hasDomainResult: true,
            hasVdmiShape: false,
            hasKpiShape: false,
            hasEvidenceGaps: false,
          },
        };
        presentationResult = {
          markdown: synthesisText,
          presentation: {
            type: presentationType,
            title: 'EV-Ladefenster nach CO₂-Prognose',
            summary: 'Receipt-Ausführung mit ausgewerteter CO₂-/Grünstrom-Prognose.',
            sources: ['energy-market.co2Intensity'],
            sections: [
              {
                title: 'Empfehlung',
                content: synthesisText,
              },
            ],
            nextActions: [
              {
                label: 'Laden im empfohlenen Fenster planen',
                action: 'schedule_ev_charging_window',
              },
            ],
          },
        };
      }

      // ── Phase 2: Evidence-Gap-Gate (before synthesis) ──
      // If critical evidence gaps exist, block synthesis and surface evidence_gap_table
      if (
        execution?.status === 'completed' &&
        !receiptExecutionUsed &&
        responsePlan?.evidencePlan &&
        shouldBlockSynthesisOnGaps(responsePlan.evidencePlan)
      ) {
        const fallbackGapMarkdown = this.buildEvidenceGapUserMessage(responsePlan.evidencePlan);
        try {
          const gapPresentation = buildEvidenceGapPresentation(responsePlan.evidencePlan);
          presentationResult = await ctx.call(
            'presentation.render',
            {
              intent: responsePlan?.primaryIntent || 'evidence_gap_analysis',
              audience: 'operations',
              preferredFormat: 'evidence_gap_table',
              domainResult: gapPresentation,
              context: {
                tenantId,
                sessionId,
                source: 'personal-agent-evidence-gate',
                phaseNote: 'evidence-plan-phase2-synthesis-gate',
                sourceActions: extractSourceActions(execution),
                evidencePlan: responsePlan.evidencePlan,
                allowedPresentationTypes: ['evidence_gap_table', 'debug_summary'],
              },
              locale: 'de-DE',
            },
            { meta: { ...ctx.meta, $gateway: false } }
          );

          if (
            presentationResult &&
            typeof presentationResult === 'object' &&
            presentationResult.markdown
          ) {
            presentationApplied = true;
            presentationType = 'evidence_gap_table';
            presentationGrounding =
              presentationResult?.presentation?.grounding ||
              evaluatePresentationGrounding({
                requestedType: 'evidence_gap_table',
                selectedType: 'evidence_gap_table',
                domainResult: gapPresentation,
                sourceActions: extractSourceActions(execution),
                evidencePlan: responsePlan.evidencePlan,
                allowedTypes: ['evidence_gap_table', 'debug_summary'],
              });
            // Synthesis is skipped — we replace reply with the gap table
            synthesisText = /evidence_gap_table_renderer_not_implemented/i.test(
              presentationResult.markdown
            )
              ? fallbackGapMarkdown
              : presentationResult.markdown;
            presentationResult.markdown = synthesisText;
          }
        } catch (error) {
          this.logger?.warn(`Evidence-gap presentation render failed: ${error.message}`);
          presentationApplied = true;
          presentationType = 'evidence_gap_table';
          presentationGrounding = evaluatePresentationGrounding({
            requestedType: 'evidence_gap_table',
            selectedType: 'evidence_gap_table',
            domainResult: buildEvidenceGapPresentation(responsePlan.evidencePlan),
            sourceActions: extractSourceActions(execution),
            evidencePlan: responsePlan.evidencePlan,
            allowedTypes: ['evidence_gap_table', 'debug_summary'],
          });
          presentationResult = {
            markdown: fallbackGapMarkdown,
            presentation: {
              type: 'evidence_gap_table',
              title: 'Fehlende Evidenz',
              summary: 'Für eine belastbare Antwort fehlen noch konkrete Nachweise.',
            },
          };
          synthesisText = fallbackGapMarkdown;
        }
      }

      if (execution?.status === 'awaiting-onboarding') {
        const onboardingQuestion = execution?.stopPoint?.onboardingQuestion;
        const questionText = onboardingQuestion?.questionText || execution?.stopPoint?.message;
        const isMandatoryHitlApproval =
          execution?.stopPoint?.reasonCode === 'MANDATORY_HITL_APPROVAL';

        if (isMandatoryHitlApproval) {
          stateMachine = transitionStateMachine(stateMachine, PERSONAL_AGENT_STATES.HITL_BLOCKED, {
            reasonCode: 'MANDATORY_HITL_APPROVAL',
            blockedAction: execution?.stopPoint?.blockedAction || null,
            blockedStep: execution?.stopPoint?.blockedStep || null,
            hitlItemId:
              onboardingQuestion?.hitlItem?.id || execution?.stopPoint?.hitlItemId || null,
          });
        }

        // ── Parent-Plan Resume Status Transparency ──
        // Wenn wir von einem resolved Zwischen-Intent zurückkehren,
        // zeigen wir dem Nutzer das Ziel + bestätigte Daten, nicht nur die nächste Frage
        let statusPrefix = '';
        const resumableFrame = findResumableParentFrame(session.planStack);
        const resolvedParamKeys = Object.keys(session.resolvedParams || {});
        if (resumableFrame?.parentFrame && resolvedParamKeys.length > 0) {
          const summaryParts = ['Wir arbeiten weiter an Ihrer Anfrage'];
          const ackKeys = resolvedParamKeys.slice(0, 3);
          const ackData = ackKeys.map((key) => `${key}: ${session.resolvedParams[key]}`).join(', ');
          if (ackData) {
            summaryParts.push(`Die bisher bestätigten Daten (${ackData}) bleiben erhalten.`);
          }
          statusPrefix = `${summaryParts.join('. ')}\n\n`;
        }

        const missingParams = Array.isArray(execution?.stopPoint?.missingParams)
          ? execution.stopPoint.missingParams
          : [];

        if (questionText) {
          let hitlOnboardingQuestion = onboardingQuestion;
          let replyMarkdown = questionText;
          let onboardingNextActions = [];

          if (isMandatoryHitlApproval) {
            hitlOnboardingQuestion = this.buildHitlOnboardingQuestion(
              execution?.stopPoint || {},
              responsePlan
            );
            replyMarkdown = this.buildHitlApprovalMarkdown(hitlOnboardingQuestion);
            onboardingNextActions = [
              {
                label: 'Freigabe öffnen',
                action: 'open_hitl_item',
                hitlItemId:
                  hitlOnboardingQuestion?.hitlItem?.id || execution?.stopPoint?.hitlItemId,
              },
            ];
          } else {
            const empathetic = await this.buildEmpathethicOnboardingReply({
              message: ctx.params.message,
              execution,
              plan: responsePlan,
              executionTrace,
            });
            replyMarkdown = empathetic.markdown || questionText;
            onboardingNextActions = empathetic.nextActions || [];
          }

          synthesisText = statusPrefix + replyMarkdown;

          presentationApplied = true;
          presentationType = 'conversational_onboarding';
          presentationResult = {
            type: 'conversational_onboarding',
            markdown: synthesisText,
            warnings: missingParams.map((param) => `missing_context:${param}`),
            presentation: {
              type: 'conversational_onboarding',
              title: 'Fehlende Eingaben',
              summary: isMandatoryHitlApproval
                ? 'Für den nächsten Schritt ist eine Freigabe erforderlich.'
                : 'Bitte ergänzen Sie die fehlenden Angaben, damit die Ausführung fortgesetzt werden kann.',
              markdown: replyMarkdown,
              warnings: missingParams.map((param) => `missing_context:${param}`),
              sections: [
                {
                  key: 'onboarding',
                  title: 'Benötigte Angaben',
                  body: replyMarkdown,
                },
              ],
              nextActions: onboardingNextActions,
              structuredData: {
                reasonCode: execution?.stopPoint?.reasonCode || 'MISSING_INPUTS',
                blockedAction: execution?.stopPoint?.blockedAction || null,
                blockedStep: execution?.stopPoint?.blockedStep || null,
                missingParams,
                onboardingQuestion:
                  (isMandatoryHitlApproval ? hitlOnboardingQuestion : onboardingQuestion) || null,
                hitlItem: isMandatoryHitlApproval
                  ? hitlOnboardingQuestion?.hitlItem ||
                    (execution?.stopPoint?.hitlItemId
                      ? { id: execution.stopPoint.hitlItemId, status: 'pending' }
                      : null)
                  : null,
                nextActions: onboardingNextActions,
              },
            },
          };
        }
      } else if (
        execution?.status === 'completed' &&
        this.hasStructuredExecutionResult(execution)
      ) {
        try {
          const domainResult = this.extractDomainResultFromExecution(execution);
          if (domainResult && Object.keys(domainResult).length > 0) {
            const intent =
              responsePlan?.primaryIntent || responsePlan?.routeKey || 'execution_result';
            const presentationContext = {
              tenantId,
              sessionId,
              processType: responsePlan?.routeKey || null,
              matrixId: domainResult?.matrix?.id || domainResult?.matrixId || null,
              taskId:
                domainResult?.taskId ||
                (Array.isArray(domainResult?.matrix?.tasks) && domainResult.matrix.tasks[0]
                  ? domainResult.matrix.tasks[0].taskId || null
                  : null),
              source: 'personal-agent',
              sourceActions: extractSourceActions(execution),
              evidencePlan: responsePlan?.evidencePlan || null,
            };

            const preferredFormat =
              intent && /vdmi|governance/i.test(String(intent)) ? 'vdmi_matrix_table' : 'auto';
            const groundingBeforeRender = evaluatePresentationGrounding({
              requestedType: preferredFormat,
              domainResult,
              sourceActions: presentationContext.sourceActions,
              evidencePlan: responsePlan?.evidencePlan || null,
            });

            presentationResult = await ctx.call(
              'presentation.render',
              {
                intent,
                audience: 'management',
                preferredFormat,
                domainResult,
                context: {
                  ...presentationContext,
                  allowedPresentationTypes: groundingBeforeRender.allowedTypes,
                  presentationGrounding: groundingBeforeRender,
                },
                locale: 'de-DE',
              },
              { meta: { ...ctx.meta, $gateway: false } }
            );

            if (
              presentationResult &&
              typeof presentationResult === 'object' &&
              presentationResult.markdown
            ) {
              presentationApplied = true;
              presentationType =
                presentationResult?.presentation?.type || presentationResult?.type || null;
              presentationGrounding =
                presentationResult?.presentation?.grounding ||
                evaluatePresentationGrounding({
                  requestedType: preferredFormat,
                  selectedType: presentationType,
                  domainResult,
                  sourceActions: presentationContext.sourceActions,
                  evidencePlan: responsePlan?.evidencePlan || null,
                  allowedTypes: groundingBeforeRender.allowedTypes,
                });
            }
          }
        } catch (error) {
          this.logger?.warn(`Presentation render failed (non-blocking): ${error.message}`);
          presentationApplied = false;
        }
      }

      const executionResponsePolicyContract = this.buildResponsePolicyContract({
        message: ctx.params.message,
        workflowType: responsePlan?.workflowType || semanticClassification?.workflowType || null,
        domainIntent:
          responsePlan?.domainIntent ||
          responsePlan?.primaryIntent ||
          semanticClassification?.domainIntent ||
          null,
        knownContext: preflightKnownContext,
        receiptKnowledgeEvidence: receiptSelectionResult?.knowledgeEvidence || null,
        responsePlan,
        execution,
        evidencePlan: receiptExecutionUsed ? null : responsePlan?.evidencePlan || null,
      });

      const _executionEvidenceCandidates = this.buildEvidenceRequirementsForRevalidation({
        tenantId,
        sessionId,
        personaId: rawKnownContext?.personaId || null,
        responsibleRole: rawKnownContext?.responsibleRole || null,
        missingEvidence: executionResponsePolicyContract.missingEvidence,
        evidencePlan: receiptExecutionUsed ? null : responsePlan?.evidencePlan || null,
        execution,
      });
      if (_executionEvidenceCandidates.length > 0) {
        this.recordEvidenceRequirementsForRevalidation(ctx, _executionEvidenceCandidates).catch(
          (err) => this.logger?.warn(`evidence requirement recording failed: ${err.message}`)
        );
      }

      const executionTimeoutFallback =
        execution?.status === 'partial' ||
        execution?.status === 'timeout' ||
        execution?.stopPoint?.reasonCode === 'TIMEOUT';
      const executionGuardedReply = this.applyResponsePolicyGuardrails({
        reply: presentationApplied ? presentationResult.markdown : synthesisText,
        contract: executionResponsePolicyContract,
        timeoutFallback: executionTimeoutFallback,
      });
      // vdmi_matrix_table presentations are self-grounded (the RACI matrix includes
      // all evidence and assumptions). Skip the grounding contract to keep
      // presentation.markdown === reply as required by the grounding contract test.
      const _groundingContractArgs =
        presentationApplied && presentationType === 'vdmi_matrix_table'
          ? {}
          : {
              execution,
              knowledgeScope: [
                ...(session.l3?.knowledgeScopeDataPoints || []),
                ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
              ],
              missingEvidence: executionResponsePolicyContract.missingEvidence,
              assumptions: execution?.assumptions,
            };
      const responseReply = this.appendGroundingContractToReply(
        executionGuardedReply.reply,
        _groundingContractArgs
      );
      turnGraph = addNode(turnGraph, {
        id: 'answer:final',
        type: 'answer',
        label: 'Final answer',
        data: {
          status,
          presentationApplied,
          replyLength: String(responseReply || '').length,
        },
      });
      turnGraph = addEdge(turnGraph, {
        from: 'chat:mode',
        to: 'answer:final',
        type: 'produces',
      });
      turnGraph = finalizeTurnGraph(turnGraph, {
        status: status === 'completed' ? 'completed' : 'incomplete',
      });

      const finalized = synthesizeAndPurgeLayer4(stackResult.stack, responseReply);
      stateMachine = transitionStateMachine(
        stateMachine,
        deriveTerminalState({ execution, status }),
        {
          status,
          stopReason: execution?.stopPoint?.reasonCode || null,
          presentationApplied,
        }
      );
      const persisted = buildPersistableSessionState({
        id: sessionId,
        tenantId,
        userId,
        l1: finalized.stack.l1,
        l2: finalized.stack.l2,
        l3: {
          ...finalized.stack.l3,
          chatMode: effectiveChatMode,
          chatModeSource,
          lastClassification: session.l3.lastClassification,
          stateMachine: summarizeStateMachine(stateMachine),
          executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
          turnGraph: summarizeTurnGraph(turnGraph),
          responseStrategy,
        },
        createdAt: session.createdAt,
      });
      persisted.l3.onboardingQuestions = Array.isArray(session.l3?.onboardingQuestions)
        ? session.l3.onboardingQuestions
        : [];
      persisted.l3.chatMode = effectiveChatMode;
      persisted.l3.consultationContext = null;
      persisted.l3.assumptions = this.mergeAssumptions(
        session.l3?.assumptions || [],
        execution?.assumptions || []
      );
      persisted.l3.planStack = Array.isArray(session.planStack) ? session.planStack : [];
      persisted.l3.resolvedParams =
        session.resolvedParams && typeof session.resolvedParams === 'object'
          ? session.resolvedParams
          : {};
      persisted.l3.lastCompletedPlan =
        session.l3?.lastCompletedPlan && typeof session.l3.lastCompletedPlan === 'object'
          ? session.l3.lastCompletedPlan
          : null;
      persisted.l3.stopPoint =
        execution?.stopPoint && typeof execution.stopPoint === 'object'
          ? execution.stopPoint
          : null;
      persisted.l3.criticalStepCheckpoints =
        session.l3?.criticalStepCheckpoints &&
        typeof session.l3.criticalStepCheckpoints === 'object'
          ? session.l3.criticalStepCheckpoints
          : {};

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
      execution.meta = executionTrace.summarize({
        toolCalls: toolCallTracker.summarize().calls,
        chatModeSource,
        presentationApplied,
      });
      const quality = this.buildQualitySummary({
        evidencePlan: responsePlan.evidencePlan || null,
        execution,
        consultation: null,
      });
      // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
      // v0.56.2 — persona resolution for agentTrace (best-effort, never throws)
      // v0.56.3 — ZNP context signals
      const _hitlItemId4 = ctx.params?.knownContext?.hitlItemId ?? null;
      const _handoffCtx4 = await this.getPersonaHandoffSnapshotContext(ctx, _hitlItemId4);
      const _znpCtx4 = buildZnpContextSnapshot(ctx, session, semanticClassification);
      const personaResolution = await this.resolvePersonaForTrace(ctx, {
        tenantId,
        sessionId,
        sourceService: 'personal-agent',
        sourceAction: 'chat',
        workflowType:
          executionResponsePolicyContract?.workflowType ??
          semanticClassification?.workflowType ??
          null,
        domainIntent:
          executionResponsePolicyContract?.domainIntent ??
          semanticClassification?.domainIntent ??
          null,
        ..._znpCtx4,
        handoffPersonaId: _handoffCtx4.handoffPersonaId,
        hitlItemId: _hitlItemId4,
        workflowCompletionState: _handoffCtx4.workflowCompletionState,
      });
      const agentTrace = this.buildAgentTrace({
        routing: {
          source: responsePlan.source,
          routeKey: responsePlan.routeKey,
          routeLabel: responsePlan.routeLabel,
          primaryIntent: responsePlan.primaryIntent,
          warnings: responsePlan.warnings,
        },
        plan: responsePlan,
        execution,
        evidencePlan: responsePlan.evidencePlan || null,
        consultation: null,
        responseStrategy,
        stateMachine,
        executionStateGraph,
        turnGraph,
        routingDecision,
        personaResolution,
        bootstrapContext,
        knowledgeScope: [
          ...(session.l3?.knowledgeScopeDataPoints || []),
          ...(session.l2?.userProfile?.knowledgeScopeDataPoints || []),
        ],
        workLog: turnWorkLog.toArray(),
        locationResolution: brokerKnownContext._locationResolutionTrace || null, // v0.60
      });

      // Log completion
      if (jobStore) {
        jobStore.appendLog(jobId, 'chat_complete', 100, `Chat completed with status=${status}`, {
          status,
          presentationApplied,
          replyLength: String(responseReply || '').length,
        });
      }

      return {
        success: true,
        status,
        sessionId,
        executionMode,
        chatMode: effectiveChatMode,
        reply: responseReply,
        workflowType: executionResponsePolicyContract.workflowType,
        domainIntent: executionResponsePolicyContract.domainIntent,
        evidenceStatus: executionResponsePolicyContract.evidenceStatus,
        missingEvidence: executionResponsePolicyContract.missingEvidence,
        nextVerificationSteps: executionResponsePolicyContract.nextVerificationSteps,
        guardrailCorrections: executionGuardedReply.guardrailCorrections,
        presentationApplied,
        presentationType: presentationType || null,
        presentationGrounding,
        presentation: presentationApplied
          ? {
              ...(presentationResult.presentation || {}),
              type: presentationType || presentationResult?.type || null,
              title: presentationResult?.presentation?.title || null,
              summary: presentationResult?.presentation?.summary || null,
              markdown: presentationResult.markdown,
              warnings:
                presentationResult?.presentation?.warnings || presentationResult?.warnings || [],
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
        responseStrategy,
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
          chatMode: effectiveChatMode,
        },
        plan: {
          status: responsePlan.status,
          steps: responsePlan.steps,
          onboardingHints: responsePlan.onboardingHints,
        },
        evidencePlan: responsePlan.evidencePlan || null,
        evidenceGaps: Array.isArray(responsePlan?.evidencePlan?.gaps)
          ? responsePlan.evidencePlan.gaps
          : [],
        evidenceConfidence:
          typeof responsePlan?.evidencePlan?.confidence === 'number'
            ? responsePlan.evidencePlan.confidence
            : null,
        quality,
        agentTrace,
        stateMachine: summarizeStateMachine(stateMachine),
        executionStateGraph: summarizeExecutionStateGraph(executionStateGraph),
        turnGraph: summarizeTurnGraph(turnGraph),
        execution,
        ...(receiptSelectionMetadata ? { metadata: receiptSelectionMetadata } : {}),
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
        chatMode: session.chatMode || session?.l3?.chatMode || CHAT_MODES.CONSULTATION,
        chatModeSource: session?.l3?.chatModeSource || null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        stateMachine:
          session?.l3?.stateMachine && typeof session.l3.stateMachine === 'object'
            ? session.l3.stateMachine
            : null,
        executionStateGraph:
          session?.l3?.executionStateGraph && typeof session.l3.executionStateGraph === 'object'
            ? session.l3.executionStateGraph
            : null,
        turnGraph:
          session?.l3?.turnGraph && typeof session.l3.turnGraph === 'object'
            ? session.l3.turnGraph
            : null,
        planStack: Array.isArray(session?.l3?.planStack) ? session.l3.planStack : [],
        resolvedParams:
          session?.l3?.resolvedParams && typeof session.l3.resolvedParams === 'object'
            ? session.l3.resolvedParams
            : {},
        l2: session.l2,
        l3: session.l3,
        layer4: null,
      };
    },
  },

  pullProactiveMessages: {
    rest: 'GET /session/:sessionId/proactive-messages',
    params: {
      sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      personaId: { type: 'string', optional: true, trim: true, max: 180 },
      limit: {
        type: 'number',
        optional: true,
        convert: true,
        integer: true,
        min: 1,
        max: 100,
        default: 20,
      },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Pull queued proactive persona messages for the current session',
      parameters: [
        {
          in: 'path',
          name: 'sessionId',
          required: true,
          schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
        },
        {
          in: 'query',
          name: 'personaId',
          required: false,
          schema: { type: 'string', example: 'tenant-a/thorsten-human' },
        },
        {
          in: 'query',
          name: 'limit',
          required: false,
          schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
        },
      ],
    },
    async handler(ctx) {
      const tenantId = getTenantId(ctx);
      const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
      const sessionId = String(ctx.params.sessionId || '').trim();
      const explicitPersonaId = String(ctx.params.personaId || '').trim() || null;
      const limit = Number(ctx.params.limit || 20);

      await this.loadSession(ctx, tenantId, sessionId, userId, { createIfMissing: true });

      const persona = await this.resolvePersonaForSession(ctx, {
        tenantId,
        sessionId,
        personaId: explicitPersonaId,
      });

      if (!persona?.id) {
        return {
          success: true,
          sessionId,
          personaId: null,
          count: 0,
          proactiveMessages: [],
        };
      }

      const pending = await this.fetchPendingPersonaInboxMessages(ctx, {
        tenantId,
        personaId: persona.id,
        sessionId,
        limit,
      });

      return {
        success: true,
        sessionId,
        personaId: persona.id,
        count: pending.length,
        proactiveMessages: pending.map((item) => this.toPublicProactiveMessage(item)),
      };
    },
  },

  acknowledgeProactiveMessage: {
    rest: 'POST /session/:sessionId/proactive-messages/:id/acknowledge',
    params: {
      sessionId: { type: 'string', min: 1, trim: true, max: 120 },
      id: { type: 'string', min: 1, trim: true, max: 120 },
      personaId: { type: 'string', optional: true, trim: true, max: 180 },
    },
    openapi: {
      tags: [OPENAPI_TAG],
      summary: 'Acknowledge a proactive persona message',
      parameters: [
        {
          in: 'path',
          name: 'sessionId',
          required: true,
          schema: { type: 'string', example: 'pa_a1b2c3d4-e5f6-4789-a012-b3c4d5e6f7a8' },
        },
        {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string', example: 'inbox-1' },
        },
        {
          in: 'query',
          name: 'personaId',
          required: false,
          schema: { type: 'string', example: 'tenant-a/thorsten-human' },
        },
      ],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
            },
            examples: {
              default: {
                value: {},
              },
            },
          },
        },
      },
    },
    async handler(ctx) {
      const tenantId = getTenantId(ctx);
      const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
      const sessionId = String(ctx.params.sessionId || '').trim();
      const explicitPersonaId = String(ctx.params.personaId || '').trim() || null;

      await this.loadSession(ctx, tenantId, sessionId, userId, { createIfMissing: true });
      const persona = await this.resolvePersonaForSession(ctx, {
        tenantId,
        sessionId,
        personaId: explicitPersonaId,
      });

      if (!persona?.id) {
        throw new MoleculerClientError(
          'Persona not resolved for session',
          404,
          'PERSONA_SESSION_NOT_RESOLVED'
        );
      }

      const response = await ctx.call(
        'persona-inbox.acknowledge',
        {
          tenantId,
          id: ctx.params.id,
        },
        { meta: { ...ctx.meta, tenantId, $gateway: false } }
      );

      return {
        success: true,
        sessionId,
        personaId: persona.id,
        item: this.toPublicProactiveMessage(response?.item || {}),
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
        userId: current.userId || userId,
        l1: { tenantFacts: current.l1?.tenantFacts || [] },
        l2: current.l2,
        l3: {
          history: [],
          fileAttachments: [],
          summary: null,
          compressed: false,
          chatMode: 'auto',
          chatModeSource: null,
          lastClassification: null,
          consultationContext: null,
          planStack: Array.isArray(current?.l3?.planStack) ? current.l3.planStack : [],
          resolvedParams:
            current?.l3?.resolvedParams && typeof current.l3.resolvedParams === 'object'
              ? current.l3.resolvedParams
              : {},
          stateMachine: null,
          executionStateGraph: null,
          turnGraph: null,
        },
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

  'dream-pipeline': {
    params: {
      tenantId: { type: 'string', optional: true, trim: true, min: 1, max: 120 },
      sessionId: { type: 'string', trim: true, min: 1, max: 120 },
      userId: { type: 'string', optional: true, trim: true, min: 1, max: 120 },
    },
    async handler(ctx) {
      const tenantId = String(ctx.params.tenantId || getTenantId(ctx) || 'default');
      const sessionId = String(ctx.params.sessionId || '').trim();
      const userId = String(ctx.params.userId || ctx.meta?.authUser?.userId || 'anonymous');

      try {
        await this.broker.waitForServices(['object-store'], 10_000);
      } catch (_err) {
        this.logger?.warn(
          `[actions-part-01-of-1] silent-catch-fallback (line 5936): ${_err && _err.message}`
        );
        return {
          success: false,
          sessionId,
          tenantId,
          status: 'deferred',
          reason: 'DEPENDENCY_NOT_READY',
        };
      }

      const profileNamespace = tenantNamespace(PROFILE_NAMESPACE, tenantId);

      await this.runDream(this.broker, {
        tenantId,
        sessionId,
        userId,
        profileNamespace,
        authMeta: this.buildDreamAuthMeta(ctx.meta, tenantId, userId),
      });

      return {
        success: true,
        sessionId,
        tenantId,
        status: 'processed',
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
                  dreamPending: {
                    type: 'boolean',
                    description: 'true if inactivity timer is active',
                  },
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
      const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
      await this.assertStoredSessionOwnerAccess(ctx, tenantId, sessionId, userId, {
        allowMissing: true,
      });
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
      limit: {
        type: 'number',
        integer: true,
        min: 1,
        max: 200,
        optional: true,
        default: 50,
        convert: true,
      },
      offset: {
        type: 'number',
        integer: true,
        min: 0,
        optional: true,
        default: 0,
        convert: true,
      },
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
        if (
          err?.code === 'NOT_FOUND' ||
          err?.type === 'NOT_FOUND' ||
          err?.message?.includes('not found')
        ) {
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
};
