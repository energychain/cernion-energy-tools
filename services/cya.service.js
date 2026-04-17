'use strict';

const { MoleculerError } = require('moleculer').Errors;
const { retrieveContextData, mergeProvidedData } = require('../src/cya-data-retriever');
const { buildRegulatoryGraph } = require('../src/cya-regulatory-graph');
const { buildGrounding } = require('../src/cya-grounding');
const { synthesizeNarrative, synthesizePersonaEvaluation, synthesizeConsensusWith } = require('../src/cya-synthesis');
const { startJob, appendLog } = require('../src/job-store');
const { PERSONA_ENUM, validatePerspectives, getPersona } = require('../src/cya-agent-personas');
const { retrievePersonaContext, buildPersonaGrounding } = require('../src/cya-persona-memory');
const { MAX_DIALOGUE_ROUNDS, detectConflicts, buildNegotiationPrompt } = require('../src/cya-conflict-detector');

const PROFILE_ID_PATTERN = /^[a-z0-9_]+$/;
const ACTOR_ROLES = [
  'grid_operator',
  'supplier',
  'project_developer',
  'direct_marketer',
  'metering_operator',
  'regulator',
  'municipality',
  'journalist',
  'citizen',
];
const FOCUS_AREAS = [
  'capacity',
  'renewables',
  'grid_expansion',
  'redispatch',
  'energy_sharing',
  'digitalization',
  'compliance',
  'customer',
  'investment',
  'section14a',
  'nova',
];

const SESSION_NAMESPACE = 'cya_sessions';
const PROFILE_NAMESPACE = 'cya_profiles';

module.exports = {
  name: 'cya',
  timeout: 180000,

  settings: {
    defaultTone: 'diplomatisch, rechtssicher',
  },

  actions: {
    createProfile: {
      rest: 'POST /profile',
      params: {
        profile_id: { type: 'string', pattern: PROFILE_ID_PATTERN, max: 64 },
        actor: {
          type: 'object',
          props: {
            role: { type: 'enum', values: ACTOR_ROLES },
            organization: { type: 'string', optional: true },
            department: { type: 'string', optional: true },
          },
        },
        strategic_goals: { type: 'array', items: 'string', min: 1, max: 10 },
        tone: { type: 'string', optional: true },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Create or update a stakeholder profile',
        description:
          'Stores a stakeholder profile for the CYA Agent in the Object Store namespace `cya_profiles`.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['profile_id', 'actor', 'strategic_goals'],
                properties: {
                  profile_id: { type: 'string', pattern: '^[a-z0-9_]+$', maxLength: 64, example: 'stadtwerk_regulierung' },
                  actor: {
                    type: 'object',
                    required: ['role'],
                    example: {
                      role: 'grid_operator',
                      organization: 'Stadtwerke Beispiel',
                      department: 'Regulierung',
                    },
                    properties: {
                      role: { type: 'string', enum: ACTOR_ROLES },
                      organization: { type: 'string', nullable: true },
                      department: { type: 'string', nullable: true },
                    },
                  },
                  strategic_goals: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string' }, example: ['Rechtssicherheit stärken', 'Investitionsargumentation verbessern'] },
                  tone: { type: 'string', nullable: true, example: 'diplomatisch, rechtssicher' },
                },
              },
              examples: {
                default: {
                  value: {
                    profile_id: 'stadtwerk_regulierung',
                    actor: {
                      role: 'grid_operator',
                      organization: 'Stadtwerke Beispiel',
                      department: 'Regulierung',
                    },
                    strategic_goals: ['Rechtssicherheit stärken', 'Investitionsargumentation verbessern'],
                    tone: 'diplomatisch, rechtssicher',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Profile persisted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    profile_id: { type: 'string', example: 'stadtwerk_regulierung' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { profile_id, actor, strategic_goals, tone } = ctx.params;
        const payload = {
          actor,
          strategic_goals,
          tone: tone || this.settings.defaultTone,
          createdAt: new Date().toISOString(),
        };

        await ctx.call('object-store.put', {
          namespace: PROFILE_NAMESPACE,
          key: profile_id,
          payload,
        });

        return { success: true, profile_id, createdAt: payload.createdAt };
      },
    },

    getProfile: {
      rest: 'GET /profile/:profile_id',
      params: {
        profile_id: { type: 'string' },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Load a stakeholder profile',
        description: 'Loads a single CYA profile from the Object Store namespace `cya_profiles`.',
        parameters: [
          {
            name: 'profile_id',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'stadtwerk_regulierung' },
          },
        ],
        responses: {
          200: {
            description: 'Profile found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    profile_id: { type: 'string' },
                    profile: {
                      type: 'object',
                      properties: {
                        actor: { type: 'object' },
                        strategic_goals: { type: 'array', items: { type: 'string' } },
                        tone: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
                examples: {
                  default: {
                    value: {
                      success: true,
                      profile_id: 'stadtwerk_regulierung',
                      profile: {
                        actor: { role: 'grid_operator', organization: 'Stadtwerke Beispiel', department: 'Regulierung' },
                        strategic_goals: ['Rechtssicherheit stärken'],
                        tone: 'diplomatisch, rechtssicher',
                        createdAt: '2026-04-14T16:00:00.000Z',
                      },
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Profile not found' },
        },
      },
      async handler(ctx) {
        const profile = await this.loadProfile(ctx, ctx.params.profile_id);
        return { success: true, profile_id: ctx.params.profile_id, profile };
      },
    },

    listProfiles: {
      rest: 'GET /profiles',
      params: {
        limit: { type: 'number', optional: true, default: 50, convert: true },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'List stakeholder profiles',
        description: 'Lists stored CYA profiles from the Object Store namespace `cya_profiles`.',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'number', default: 50, example: 50 },
          },
        ],
        responses: {
          200: {
            description: 'Profile list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    count: { type: 'number', example: 1 },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          namespace: { type: 'string' },
                          key: { type: 'string' },
                          payload: { type: 'object' },
                          createdAt: { type: 'string', format: 'date-time' },
                          updatedAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
                examples: {
                  default: {
                    value: {
                      success: true,
                      count: 1,
                      items: [
                        {
                          namespace: 'cya_profiles',
                          key: 'stadtwerk_regulierung',
                          payload: {
                            actor: { role: 'grid_operator' },
                            strategic_goals: ['Rechtssicherheit stärken'],
                            tone: 'diplomatisch, rechtssicher',
                          },
                          createdAt: '2026-04-14T16:00:00.000Z',
                          updatedAt: '2026-04-14T16:00:00.000Z',
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const result = await ctx.call('object-store.query', {
          namespace: PROFILE_NAMESPACE,
          selector: {},
          limit: ctx.params.limit,
        });
        const items = Array.isArray(result?.docs) ? result.docs : [];
        return { success: true, count: items.length, items };
      },
    },

    generate: {
      rest: 'POST /generate',
      params: {
        profile_id: { type: 'string' },
        target_audience: { type: 'string' },
        context: {
          type: 'object',
          props: {
            location: { type: 'string', optional: true },
            trigger: { type: 'string' },
            focus_areas: {
              type: 'array',
              min: 1,
              items: {
                type: 'enum',
                values: FOCUS_AREAS,
              },
            },
          },
        },
        session_id: { type: 'string', optional: true },
        perspectives: {
          type: 'array',
          optional: true,
          items: {
            type: 'enum',
            values: PERSONA_ENUM,
          },
          max: PERSONA_ENUM.length,
        },
      },
      // NOTE: capacity_mw goes inside context (not top-level) so it flows
      // through to cya-data-retriever.retrieveContextData → assessTopologyHop.
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Generate profile-aware narrative',
        description:
          'Runs the full CYA pipeline: data retrieval, deterministic regulatory graph, grounding, and LLM synthesis. Returns Option-B response structure.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['profile_id', 'target_audience', 'context'],
                properties: {
                  profile_id: { type: 'string', example: 'stadtwerk_regulierung' },
                  target_audience: { type: 'string', example: 'Aufsichtsrat' },
                  perspectives: {
                    type: 'array',
                    nullable: true,
                    items: { type: 'string', enum: PERSONA_ENUM },
                    minItems: 1,
                    maxItems: PERSONA_ENUM.length,
                    description: 'Enable multi-agent orchestration mode with stakeholder perspectives. If omitted, defaults to classic single-agent v0.26.8 behavior.',
                    example: ['technical', 'commercial'],
                  },
                  context: {
            capacity_mw: { type: 'number', optional: true },
                    required: ['trigger', 'focus_areas'],
                    example: {
                      location: 'Ludwigshafen',
                      trigger: 'Presseanfrage zur Netzstabilität',
                      focus_areas: ['capacity', 'compliance', 'nova'],
                    },
                    properties: {
                      location: { type: 'string', nullable: true },
                      trigger: { type: 'string' },
                      focus_areas: { type: 'array', minItems: 1, items: { type: 'string', enum: FOCUS_AREAS } },
                      capacity_mw: {
                        type: 'number',
                        nullable: true,
                        description: 'Asset capacity in MW. If >= 10 MW, triggers 110-kV topology hop detection via OSM.',
                        example: 10,
                      },
                    },
                  },
                  session_id: { type: 'string', nullable: true, example: 'cya_1713110400000' },
                },
              },
              examples: {
                default: {
                  value: {
                    profile_id: 'stadtwerk_regulierung',
                    target_audience: 'Aufsichtsrat',
                    perspectives: ['technical', 'commercial'],
                    context: {
                      location: 'Ludwigshafen',
                      trigger: 'Presseanfrage zur Netzstabilität',
                      focus_areas: ['capacity', 'compliance', 'nova'],
                      capacity_mw: 10,
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          202: {
            description: 'Job accepted and queued for async processing',
            headers: {
              Location: {
                schema: { type: 'string' },
                description: 'Relative URI to job status endpoint (/api/jobs/:jobId/status)',
              },
              'Retry-After': {
                schema: { type: 'string' },
                description: 'Suggested polling interval in seconds',
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    jobId: { type: 'string', example: '6fd38b12-a3f4-41d5-8f49-e7f9c1b2d3e4' },
                    status: { type: 'string', enum: ['queued'], example: 'queued' },
                    message: { type: 'string', example: 'Job started. Poll /api/jobs/:jobId/status for progress.' },
                    statusUrl: { type: 'string', example: '/api/jobs/6fd38b12-a3f4-41d5-8f49-e7f9c1b2d3e4/status' },
                    resultUrl: { type: 'string', example: '/api/jobs/6fd38b12-a3f4-41d5-8f49-e7f9c1b2d3e4/result' },
                  },
                },
              },
            },
          },
          200: {
            description: 'Pipeline result (internal/direct calls only; external callers receive 202)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    session_id: { type: 'string' },
                    status: { type: 'string', enum: ['completed', 'needs_clarification'] },
                    profile_id: { type: 'string' },
                    target_audience: { type: 'string' },
                    grounding: { type: 'object' },
                    regulatory_graph: { type: 'object' },
                    narrative: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        headline: { type: 'string' },
                        executiveSummary: { type: 'string' },
                        keyPoints: { type: 'array', items: { type: 'string' } },
                        recommendedActions: { type: 'array', items: { type: 'string' } },
                        riskNotes: { type: 'array', items: { type: 'string' } },
                      },
                    },
                    clarification: { type: 'object', nullable: true },
                    metadata: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { profile_id, target_audience, context, perspectives } = ctx.params;

        // Validate perspectives if provided
        if (perspectives && perspectives.length > 0) {
          const validation = validatePerspectives(perspectives);
          if (!validation.valid) {
            throw new MoleculerError(
              `Invalid perspective(s): ${validation.invalidPersonas.join(', ')}`,
              400,
              'INVALID_PERSPECTIVES',
              { invalidPersonas: validation.invalidPersonas }
            );
          }
          // Multi-agent path: Phase 1–2 shared, Phase 3–4 per-persona, conflict loop
          return startJob(ctx, { service: 'cya', action: 'generate' }, async (jobId) => {
            const sessionId = ctx.params.session_id || `cya_${Date.now()}`;
            return this.runMultiAgentOrchestration(ctx, {
              jobId,
              sessionId,
              profile_id,
              target_audience,
              context,
              perspectives,
            });
          });
        }

        // Classic v0.26.8 single-agent path
        return startJob(ctx, { service: 'cya', action: 'generate' }, async (jobId) => {
          const profile = await this.loadProfile(ctx, profile_id);
          const sessionId = ctx.params.session_id || `cya_${Date.now()}`;

          // Phase 1: Data Retrieval
          appendLog(jobId, 'phase_1_retrieval', 0, 'Starting context data retrieval...');
          const retrieval = await retrieveContextData(ctx, {
            profile,
            target_audience,
            context,
          });
          appendLog(jobId, 'phase_1_retrieval', 33, 'Context data retrieval complete');

          // Phase 2: Regulatory Graph
          appendLog(jobId, 'phase_2_graph', 33, 'Building deterministic regulatory graph...');
          const regulatoryGraph = buildRegulatoryGraph({
            retrieval,
            context,
            profile,
            topologyHop: retrieval.topologyHop,
          });
          appendLog(jobId, 'phase_2_graph', 66, 'Regulatory graph complete');

          // Phase 3: Grounding & Clarification Check
          appendLog(jobId, 'phase_3_grounding', 66, 'Merging grounding layer...');
          const grounding = buildGrounding({
            retrieval,
            regulatoryGraph,
            context,
            topologyHop: retrieval.topologyHop,
          });
          appendLog(jobId, 'phase_3_grounding', 75, 'Grounding merge complete');

          if (grounding.requiresClarification) {
            appendLog(jobId, 'phase_3_grounding', 85, 'Clarification required — returning HITL prompt');
            const response = this.buildClarificationResponse({
              sessionId,
              profileId: profile_id,
              targetAudience: target_audience,
              grounding,
              regulatoryGraph,
              context,
            });

            await this.saveSession(ctx, sessionId, {
              status: response.status,
              profile_id,
              target_audience,
              context,
              profile,
              retrieval,
              regulatory_graph: regulatoryGraph,
              grounding,
              narrative: null,
              clarification: response.clarification,
              createdAt: response.metadata.createdAt,
              updatedAt: response.metadata.updatedAt,
              history: [],
            });

            appendLog(jobId, 'phase_3_grounding', 100, 'Clarification session saved');
            return response;
          }

          // Phase 4: LLM Synthesis
          appendLog(jobId, 'phase_4_synthesis', 75, 'Starting LLM synthesis...');
          const synthesis = await synthesizeNarrative({
            mode: 'generate',
            profile,
            target_audience,
            context,
            grounding,
            regulatoryGraph,
          });
          appendLog(jobId, 'phase_4_synthesis', 100, 'LLM synthesis complete');

          const response = this.buildCompletedResponse({
            sessionId,
            profileId: profile_id,
            targetAudience: target_audience,
            grounding,
            regulatoryGraph,
            context,
            narrative: synthesis.narrative,
          });

          await this.saveSession(ctx, sessionId, {
            status: response.status,
            profile_id,
            target_audience,
            context,
            profile,
            retrieval,
            regulatory_graph: regulatoryGraph,
            grounding,
            narrative: synthesis.narrative,
            clarification: null,
            createdAt: response.metadata.createdAt,
            updatedAt: response.metadata.updatedAt,
            history: [],
          });

          return response;
        });
      },
    },

    refine: {
      rest: 'POST /refine',
      params: {
        session_id: { type: 'string' },
        user_feedback: { type: 'string', optional: true },
        agent_clarification_response: { type: 'string', optional: true, nullable: true },
        // Structured HITL override: supplies hard facts to rebuild the deterministic
        // Regulatory Graph (Phase 2). Completely separate from agent_clarification_response
        // which is free-text guidance into Phase 3 (LLM) only.
        clarification_response: {
          type: 'object',
          optional: true,
          props: {
            provided_data: { type: 'object', optional: true },
          },
        },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Refine a generated narrative',
        description: 'Refines an existing CYA session with user feedback or clarification input (Option-B response structure).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['session_id'],
                properties: {
                  session_id: { type: 'string', example: 'cya_1713110400000' },
                  user_feedback: { type: 'string', nullable: true, example: 'Bitte stärker auf §14a fokussieren' },
                  agent_clarification_response: { type: 'string', nullable: true, example: 'Bitte Region auf Ludwigshafen eingrenzen' },
                    clarification_response: {
                      type: 'object',
                      nullable: true,
                      description: 'Structured HITL data override. Supplies hard facts (capacity, redispatch, NOVA, etc.) to rebuild the deterministic Regulatory Graph. Bypasses failed MCP fetch-routines for the listed focus areas. Separate from agent_clarification_response (free-text LLM guidance).',
                      example: null,
                      properties: {
                        provided_data: {
                          type: 'object',
                          description: 'Map of focusArea -> user-supplied text. Each entry replaces a failed or missing retrieval item with trusted:true, dataProvenance:"user_asserted".',
                          example: {
                            capacity: 'Lokale PV-Durchdringung 8 MW, 10-MW-Speicher muss ans 110-kV-UW Meckesheim (Netze BW).',
                            redispatch: 'Netzregion leidet unter §13a-Abregelungen von Wind/PV.',
                            nova: 'Netze BW prüft Trafo-Ausbau, Flexibilität fehlt.',
                            investment: 'Kommune Mauer will Gewerbesteuer sichern.',
                          },
                        },
                      },
                    },
                },
              },
              examples: {
                default: {
                  value: {
                    session_id: 'cya_1713110400000',
                    user_feedback: 'Bitte stärker auf §14a fokussieren',
                    agent_clarification_response: null,
                      clarification_response: null,
                  },
                },
                  hitl_override: {
                    summary: 'HITL: supply missing focus-area data after needs_clarification',
                    value: {
                      session_id: 'cya_1776232540896',
                      clarification_response: {
                        provided_data: {
                          capacity: 'Lokale PV-Durchdringung 8 MW, 10-MW-Speicher muss ans 110-kV-UW Meckesheim (Netze BW).',
                          redispatch: 'Netzregion leidet unter §13a-Abregelungen von Wind/PV.',
                          nova: 'Netze BW prüft Trafo-Ausbau, Flexibilität fehlt.',
                          investment: 'Kommune Mauer will Gewerbesteuer sichern.',
                        },
                      },
                    },
                  },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Refinement result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    session_id: { type: 'string' },
                    status: { type: 'string', enum: ['completed', 'needs_clarification'] },
                    profile_id: { type: 'string' },
                    target_audience: { type: 'string' },
                    grounding: { type: 'object' },
                    regulatory_graph: { type: 'object' },
                    narrative: { type: 'object', nullable: true },
                    clarification: { type: 'object', nullable: true },
                    metadata: { type: 'object' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const session = await this.loadSession(ctx, ctx.params.session_id);
        const profile = session.profile || (await this.loadProfile(ctx, session.profile_id));
        const userFeedback = String(ctx.params.user_feedback || '').trim();
        const clarificationInput = String(ctx.params.agent_clarification_response || '').trim();

        const providedData = ctx.params.clarification_response?.provided_data;
        const hasProvidedData = providedData && typeof providedData === 'object' && Object.keys(providedData).length > 0;

        // Multi-agent refine path: re-run orchestration with enriched data or feedback
        if (session.perspectives?.length > 0) {
          return this.refineMultiAgent(ctx, {
            session,
            profile,
            sessionId: ctx.params.session_id,
            userFeedback,
            clarificationInput,
            providedData: hasProvidedData ? providedData : null,
          });
        }

        // HITL structured override path (Phase 2 rebuild):
        // provided_data supplies hard facts → mergeProvidedData → re-run Regulatory
        // Graph + Grounding deterministically. No MCP retries. No LLM in Phase 2.
        // agent_clarification_response (free-text) is only used in Phase 3 below.
        if (hasProvidedData) {
          const enrichedRetrieval = mergeProvidedData(session.retrieval, providedData);
          const topologyHop = enrichedRetrieval.topologyHop || session.retrieval?.topologyHop || null;
          const enrichedGraph = buildRegulatoryGraph({
            retrieval: enrichedRetrieval,
            context: session.context,
            profile,
            topologyHop,
          });
          const enrichedGrounding = buildGrounding({
            retrieval: enrichedRetrieval,
            regulatoryGraph: enrichedGraph,
            context: session.context,
            topologyHop,
          });

          const refinedContext = { ...session.context, clarification: clarificationInput || null };
          const synthesis = await synthesizeNarrative({
            mode: 'refine',
            profile,
            target_audience: session.target_audience,
            context: refinedContext,
            grounding: enrichedGrounding,
            regulatoryGraph: enrichedGraph,
            userFeedback,
            previousNarrative: session.narrative || null,
          });

          const response = this.buildCompletedResponse({
            sessionId: ctx.params.session_id,
            profileId: session.profile_id,
            targetAudience: session.target_audience,
            grounding: enrichedGrounding,
            regulatoryGraph: enrichedGraph,
            context: refinedContext,
            narrative: synthesis.narrative,
            createdAt: session.createdAt,
          });

          const history = Array.isArray(session.history) ? session.history : [];
          history.push({
            timestamp: response.metadata.updatedAt,
            user_feedback: userFeedback || null,
            agent_clarification_response: clarificationInput || null,
            provided_data_keys: Object.keys(providedData),
          });

          // Re-persist with enriched retrieval so subsequent refine calls use
          // the repaired grounding state, not the original gap-filled one.
          await this.saveSession(ctx, ctx.params.session_id, {
            ...session,
            status: response.status,
            retrieval: enrichedRetrieval,
            regulatory_graph: enrichedGraph,
            grounding: enrichedGrounding,
            context: refinedContext,
            narrative: synthesis.narrative,
            clarification: null,
            updatedAt: response.metadata.updatedAt,
            history,
          });

          return response;
        }

        // Standard re-serve guard: if still needs_clarification and no free-text
        // clarification was given, return the clarification prompt again.
        if (session.status === 'needs_clarification' && !clarificationInput) {
          return this.buildClarificationResponse({
            sessionId: ctx.params.session_id,
            profileId: session.profile_id,
            targetAudience: session.target_audience,
            grounding: session.grounding,
            regulatoryGraph: session.regulatory_graph,
            context: session.context,
            createdAt: session.createdAt,
          });
        }

        const refinedContext = {
          ...session.context,
          clarification: clarificationInput || null,
        };

        const synthesis = await synthesizeNarrative({
          mode: 'refine',
          profile,
          target_audience: session.target_audience,
          context: refinedContext,
          grounding: session.grounding,
          regulatoryGraph: session.regulatory_graph,
          userFeedback,
          previousNarrative: session.narrative || null,
        });

        const response = this.buildCompletedResponse({
          sessionId: ctx.params.session_id,
          profileId: session.profile_id,
          targetAudience: session.target_audience,
          grounding: session.grounding,
          regulatoryGraph: session.regulatory_graph,
          context: refinedContext,
          narrative: synthesis.narrative,
          createdAt: session.createdAt,
        });

        const history = Array.isArray(session.history) ? session.history : [];
        history.push({
          timestamp: response.metadata.updatedAt,
          user_feedback: userFeedback || null,
          agent_clarification_response: clarificationInput || null,
        });

        await this.saveSession(ctx, ctx.params.session_id, {
          ...session,
          status: response.status,
          context: refinedContext,
          narrative: synthesis.narrative,
          clarification: null,
          updatedAt: response.metadata.updatedAt,
          history,
        });

        return response;
      },
    },
  },

  methods: {
    async loadProfile(ctx, profileId) {
      try {
        const result = await ctx.call('object-store.get', {
          namespace: PROFILE_NAMESPACE,
          key: profileId,
        });
        const profile = result?.payload || null;
        if (!profile) {
          throw new MoleculerError('PROFILE_NOT_FOUND', 404, 'PROFILE_NOT_FOUND');
        }
        return profile;
      } catch (err) {
        if (err?.code === 404 || err?.type === 'OBJECT_NOT_FOUND' || err?.message === 'PROFILE_NOT_FOUND') {
          throw new MoleculerError('PROFILE_NOT_FOUND', 404, 'PROFILE_NOT_FOUND');
        }
        throw err;
      }
    },

    async loadSession(ctx, sessionId) {
      try {
        const result = await ctx.call('object-store.get', {
          namespace: SESSION_NAMESPACE,
          key: sessionId,
        });
        const session = result?.payload || null;
        if (!session) {
          throw new MoleculerError('SESSION_NOT_FOUND', 404, 'SESSION_NOT_FOUND');
        }
        return session;
      } catch (err) {
        if (err?.code === 404 || err?.type === 'OBJECT_NOT_FOUND' || err?.message === 'SESSION_NOT_FOUND') {
          throw new MoleculerError('SESSION_NOT_FOUND', 404, 'SESSION_NOT_FOUND');
        }
        throw err;
      }
    },

    async saveSession(ctx, sessionId, payload) {
      await ctx.call('object-store.put', {
        namespace: SESSION_NAMESPACE,
        key: sessionId,
        payload,
      });
    },

    buildCompletedResponse(input) {
      const now = new Date().toISOString();
      const createdAt = input.createdAt || now;
      const updatedAt = now;

      const response = {
        success: true,
        session_id: input.sessionId,
        status: 'completed',
        profile_id: input.profileId,
        target_audience: input.targetAudience,
        grounding: input.grounding,
        regulatory_graph: input.regulatoryGraph,
        narrative: input.narrative,
        clarification: null,
        metadata: {
          createdAt,
          updatedAt,
          focus_areas: input.context?.focus_areas || [],
          trigger: input.context?.trigger || null,
          location: input.context?.location || null,
        },
      };

      if (input.multi_perspective) {
        response.multi_perspective = input.multi_perspective;
      }

      return response;
    },

    buildClarificationResponse(input) {
      const now = new Date().toISOString();
      const createdAt = input.createdAt || now;
      const updatedAt = now;

      const response = {
        success: true,
        session_id: input.sessionId,
        status: 'needs_clarification',
        profile_id: input.profileId,
        target_audience: input.targetAudience,
        grounding: input.grounding,
        regulatory_graph: input.regulatoryGraph,
        narrative: null,
        clarification: input.grounding?.clarification || {
          question: 'Bitte fehlende Kontextinformationen ergänzen.',
          reason: 'clarification_required',
          suggestedInputs: [],
        },
        metadata: {
          createdAt,
          updatedAt,
          focus_areas: input.context?.focus_areas || [],
          trigger: input.context?.trigger || null,
          location: input.context?.location || null,
        },
      };

      if (input.multi_perspective) {
        response.multi_perspective = input.multi_perspective;
      }

      return response;
    },

    // -----------------------------------------------------------------------
    // Multi-agent orchestrator helpers (v0.26.9)
    // -----------------------------------------------------------------------

    /**
     * Run the full multi-agent orchestration pipeline.
     * Phase 1–2 are shared; Phase 3–4 are parallelized per persona.
     * Conflict detection runs after Phase 4 with up to MAX_DIALOGUE_ROUNDS.
     *
     * @param {import('moleculer').Context} ctx
     * @param {{ jobId: string|null, sessionId: string, profile_id: string, target_audience: string, context: Object, perspectives: string[], preloadedRetrieval?: Object, profile?: Object, createdAt?: string }} args
     */
    async runMultiAgentOrchestration(ctx, args) {
      const {
        jobId, sessionId, profile_id, target_audience,
        context, perspectives, preloadedRetrieval, createdAt,
      } = args;

      const log = (phase, pct, msg) => { if (jobId) appendLog(jobId, phase, pct, msg); };

      // Phase 1 + 2 (shared baseline — skipped when preloaded retrieval supplied)
      log('phase_1_retrieval', 0, 'Multi-agent: shared context retrieval...');
      const profile = args.profile || await this.loadProfile(ctx, profile_id);
      const retrieval = preloadedRetrieval
        || await retrieveContextData(ctx, { profile, target_audience, context });
      log('phase_1_retrieval', 20, 'Shared retrieval complete');

      log('phase_2_graph', 20, 'Multi-agent: shared regulatory graph...');
      const regulatoryGraph = buildRegulatoryGraph({
        retrieval, context, profile, topologyHop: retrieval.topologyHop,
      });
      log('phase_2_graph', 35, 'Shared regulatory graph complete');

      const baselineGrounding = buildGrounding({
        retrieval, regulatoryGraph, context, topologyHop: retrieval.topologyHop,
      });

      // Phase 3: parallel per-persona grounding
      log('phase_3_grounding', 35, `Multi-agent: Phase 3 for [${perspectives.join(', ')}]...`);
      const personaGroundings = await this.buildPersonaGroundings(ctx, perspectives, baselineGrounding);
      log('phase_3_grounding', 55, 'Per-persona groundings complete');

      // Phase 4: parallel per-persona synthesis
      log('phase_4_synthesis', 55, 'Multi-agent: per-persona synthesis...');
      const stakeholderStates = await this.runPersonaSynthesis(
        perspectives, personaGroundings,
        { profile, target_audience, context, regulatoryGraph }
      );
      log('phase_4_synthesis', 75, 'Per-persona synthesis complete');

      // Conflict negotiation loop
      const { finalStates, dialogueRounds, conflictResolved, consensusNarrative } =
        await this.runConflictNegotiation(
          stakeholderStates, baselineGrounding.facts,
          { profile, target_audience, context, regulatoryGraph }
        );
      log('phase_4_synthesis', 90, `Conflict resolved: ${conflictResolved}`);

      const multiPerspective = {
        perspectives,
        stakeholder_states: finalStates,
        dialogue_rounds: dialogueRounds.length,
        conflict_resolved: conflictResolved,
      };

      // HITL escalation when conflict cannot be resolved automatically
      if (!conflictResolved) {
        const { blockers, triggers } = detectConflicts(finalStates);
        const clarification = {
          question: `Stakeholder-Konflikt nicht automatisch auflösbar. Blockierende Perspektiven: ${blockers.join(', ')}. Bitte klären Sie: ${triggers.join(', ') || 'fehlende Fakten ergänzen'}.`,
          reason: 'multi_agent_conflict_unresolved',
          suggestedInputs: triggers.length > 0 ? triggers : baselineGrounding.dataGaps?.map((g) => g.focusArea) || [],
        };
        const hitlGrounding = { ...baselineGrounding, clarification, requiresClarification: true };
        const hitlResponse = this.buildClarificationResponse({
          sessionId, profileId: profile_id, targetAudience: target_audience,
          grounding: hitlGrounding, regulatoryGraph, context, createdAt,
          multi_perspective: multiPerspective,
        });
        await this.saveSession(ctx, sessionId, {
          status: 'needs_clarification', profile_id, target_audience, context, profile,
          retrieval, regulatory_graph: regulatoryGraph, grounding: hitlGrounding,
          narrative: null, clarification, perspectives, stakeholder_states: finalStates,
          dialogue_rounds: dialogueRounds, conflict_resolved: false,
          createdAt: hitlResponse.metadata.createdAt,
          updatedAt: hitlResponse.metadata.updatedAt, history: [],
        });
        log('phase_4_synthesis', 100, 'Multi-agent HITL escalation saved');
        return hitlResponse;
      }

      // Consensus achieved
      const narrative = consensusNarrative?.narrative || null;
      const completedResponse = this.buildCompletedResponse({
        sessionId, profileId: profile_id, targetAudience: target_audience,
        grounding: baselineGrounding, regulatoryGraph, context, narrative,
        createdAt, multi_perspective: multiPerspective,
      });
      await this.saveSession(ctx, sessionId, {
        status: 'completed', profile_id, target_audience, context, profile,
        retrieval, regulatory_graph: regulatoryGraph, grounding: baselineGrounding,
        narrative, clarification: null, perspectives, stakeholder_states: finalStates,
        dialogue_rounds: dialogueRounds, conflict_resolved: true,
        createdAt: completedResponse.metadata.createdAt,
        updatedAt: completedResponse.metadata.updatedAt, history: [],
      });
      log('phase_4_synthesis', 100, 'Multi-agent session saved');
      return completedResponse;
    },

    /**
     * Build per-persona groundings in parallel (Phase 3 fan-out).
     * @param {import('moleculer').Context} ctx
     * @param {string[]} perspectives
     * @param {Object} baseline - Shared baseline grounding
     * @returns {Promise<Object.<string, Object>>} Map of personaId → grounding
     */
    async buildPersonaGroundings(ctx, perspectives, baseline) {
      const entries = await Promise.all(
        perspectives.map(async (personaId) => {
          const memoryContext = await retrievePersonaContext(ctx, personaId, { limit: 3 });
          const grounding = buildPersonaGrounding(baseline, memoryContext, personaId);
          return [personaId, grounding];
        })
      );
      return Object.fromEntries(entries);
    },

    /**
     * Run Phase 4 per-persona synthesis in parallel.
     * @param {string[]} perspectives
     * @param {Object.<string, Object>} personaGroundings
     * @param {{ profile: Object, target_audience: string, context: Object, regulatoryGraph: Object }} args
     * @returns {Promise<Object.<string, Object>>} Map of personaId → stakeholder state
     */
    async runPersonaSynthesis(perspectives, personaGroundings, args) {
      const entries = await Promise.all(
        perspectives.map(async (personaId) => {
          const persona = getPersona(personaId);
          const grounding = personaGroundings[personaId];
          const state = await synthesizePersonaEvaluation({
            persona,
            profile: args.profile,
            target_audience: args.target_audience,
            context: args.context,
            grounding,
            regulatoryGraph: args.regulatoryGraph,
          });
          return [personaId, state];
        })
      );
      return Object.fromEntries(entries);
    },

    /**
     * Run the conflict negotiation loop (up to MAX_DIALOGUE_ROUNDS).
     * Returns early when consensus is reached or no conflict exists.
     *
     * @param {Object} stakeholderStates
     * @param {Object[]} sharedFacts
     * @param {{ profile: Object, target_audience: string, context: Object, regulatoryGraph: Object }} synthesisArgs
     * @returns {Promise<{ finalStates: Object, dialogueRounds: Object[], conflictResolved: boolean, consensusNarrative?: Object }>}
     */
    async runConflictNegotiation(stakeholderStates, sharedFacts, synthesisArgs) {
      const dialogueRounds = [];
      const initialConflict = detectConflicts(stakeholderStates);

      if (!initialConflict.hasConflict) {
        // No conflict — synthesize consensus immediately
        const consensus = await synthesizeConsensusWith({
          ...synthesisArgs, stakeholderStates, sharedFacts, round: 0,
        });
        return { finalStates: stakeholderStates, dialogueRounds, conflictResolved: true, consensusNarrative: consensus };
      }

      let currentStates = { ...stakeholderStates };
      for (let round = 1; round <= MAX_DIALOGUE_ROUNDS; round++) {
        const conflict = detectConflicts(currentStates);
        // eslint-disable-next-line no-await-in-loop
        const consensus = await synthesizeConsensusWith({
          ...synthesisArgs, stakeholderStates: currentStates, sharedFacts, round,
        });
        dialogueRounds.push({
          round,
          blockers: conflict.blockers,
          triggers: conflict.triggers,
          consensusReached: consensus.consensusReached,
          unresolvedConflicts: consensus.unresolvedConflicts,
        });
        if (consensus.consensusReached) {
          return { finalStates: currentStates, dialogueRounds, conflictResolved: true, consensusNarrative: consensus };
        }
      }

      return { finalStates: currentStates, dialogueRounds, conflictResolved: false };
    },

    /**
     * Handle refine for multi-agent sessions.
     * If provided_data supplied: re-run full orchestration with enriched retrieval.
     * Otherwise: re-synthesize consensus with updated user feedback.
     *
     * @param {import('moleculer').Context} ctx
     * @param {{ session: Object, profile: Object, sessionId: string, userFeedback: string, clarificationInput: string, providedData: Object|null }} args
     */
    async refineMultiAgent(ctx, { session, profile, sessionId, userFeedback, clarificationInput, providedData }) {
      if (providedData) {
        const enrichedRetrieval = mergeProvidedData(session.retrieval, providedData);
        return this.runMultiAgentOrchestration(ctx, {
          jobId: null,
          sessionId,
          profile_id: session.profile_id,
          target_audience: session.target_audience,
          context: session.context,
          perspectives: session.perspectives,
          preloadedRetrieval: enrichedRetrieval,
          profile,
          createdAt: session.createdAt,
        });
      }

      if (session.status === 'needs_clarification' && !clarificationInput) {
        return this.buildClarificationResponse({
          sessionId, profileId: session.profile_id, targetAudience: session.target_audience,
          grounding: session.grounding, regulatoryGraph: session.regulatory_graph,
          context: session.context, createdAt: session.createdAt,
          multi_perspective: {
            perspectives: session.perspectives,
            stakeholder_states: session.stakeholder_states || {},
            dialogue_rounds: (session.dialogue_rounds || []).length,
            conflict_resolved: false,
          },
        });
      }

      // Re-synthesize consensus with updated feedback (no Phase 1–3 re-run)
      const updatedFeedback = [userFeedback, clarificationInput].filter(Boolean).join(' | ');
      const consensus = await synthesizeConsensusWith({
        stakeholderStates: session.stakeholder_states || {},
        sharedFacts: session.grounding?.facts || [],
        profile,
        target_audience: session.target_audience,
        context: { ...session.context, clarification: updatedFeedback || null },
        round: (session.dialogue_rounds || []).length + 1,
      });

      const multiPerspective = {
        perspectives: session.perspectives,
        stakeholder_states: session.stakeholder_states || {},
        dialogue_rounds: (session.dialogue_rounds || []).length + 1,
        conflict_resolved: consensus.consensusReached,
      };

      const response = this.buildCompletedResponse({
        sessionId, profileId: session.profile_id, targetAudience: session.target_audience,
        grounding: session.grounding, regulatoryGraph: session.regulatory_graph,
        context: session.context, narrative: consensus.narrative,
        createdAt: session.createdAt, multi_perspective: multiPerspective,
      });

      const history = Array.isArray(session.history) ? session.history : [];
      history.push({
        timestamp: response.metadata.updatedAt,
        user_feedback: userFeedback || null,
        agent_clarification_response: clarificationInput || null,
        multi_agent_round: true,
      });

      await this.saveSession(ctx, sessionId, {
        ...session,
        status: response.status,
        narrative: consensus.narrative,
        clarification: null,
        updatedAt: response.metadata.updatedAt,
        dialogue_rounds: session.dialogue_rounds || [],
        history,
      });

      return response;
    },
  },
};

// LIVE-CSV-SESSION-SHAPE: {
//   // Quelle: agent.service.js (GET /agent/session/:id/csv), nicht datasource-* / energy-market
//   // Storage: File-backed in data/sessions/<sessionId>.json
//   id: '<sessionId-uuid>',
//   createdAt: 'ISO-8601',
//   problem: '<user prompt>',
//   plan: {
//     summary: '...',
//     requiredInputs: [{ name: '...', default: '...' }],
//     steps: [{ step: 1, action: 'service.action', params: { ... } }],
//   },
//   userInputs: { ... },
//   results: { interpretation: '...', stepResults: [...] } | null,
//   status: 'awaiting_inputs' | 'completed' | 'needs_clarification',
//   // Für Live-CSV wird die effektive Query zur Laufzeit gebaut aus:
//   // requiredInputs defaults + session.userInputs + URL query params; letzter Step erhält format='csv'.
// }
