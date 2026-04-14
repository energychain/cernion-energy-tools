'use strict';

const { MoleculerError } = require('moleculer').Errors;
const { retrieveContextData } = require('../src/cya-data-retriever');
const { buildRegulatoryGraph } = require('../src/cya-regulatory-graph');
const { buildGrounding } = require('../src/cya-grounding');
const { synthesizeNarrative } = require('../src/cya-synthesis');

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
      },
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
                  context: {
                    type: 'object',
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
                    context: {
                      location: 'Ludwigshafen',
                      trigger: 'Presseanfrage zur Netzstabilität',
                      focus_areas: ['capacity', 'compliance', 'nova'],
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Pipeline result',
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
        const { profile_id, target_audience, context } = ctx.params;
        const profile = await this.loadProfile(ctx, profile_id);
        const sessionId = ctx.params.session_id || `cya_${Date.now()}`;

        const retrieval = await retrieveContextData(ctx, {
          profile,
          target_audience,
          context,
        });

        const regulatoryGraph = buildRegulatoryGraph({ retrieval, context, profile });
        const grounding = buildGrounding({ retrieval, regulatoryGraph, context });

        if (grounding.requiresClarification) {
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

          return response;
        }

        const synthesis = await synthesizeNarrative({
          mode: 'generate',
          profile,
          target_audience,
          context,
          grounding,
          regulatoryGraph,
        });

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
      },
    },

    refine: {
      rest: 'POST /refine',
      params: {
        session_id: { type: 'string' },
        user_feedback: { type: 'string', optional: true },
        agent_clarification_response: { type: 'string', optional: true, nullable: true },
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
                },
              },
              examples: {
                default: {
                  value: {
                    session_id: 'cya_1713110400000',
                    user_feedback: 'Bitte stärker auf §14a fokussieren',
                    agent_clarification_response: null,
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

      return {
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
    },

    buildClarificationResponse(input) {
      const now = new Date().toISOString();
      const createdAt = input.createdAt || now;
      const updatedAt = now;

      return {
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
    },
  },
};
