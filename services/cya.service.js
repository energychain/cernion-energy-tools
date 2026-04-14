'use strict';

const { MoleculerError } = require('moleculer').Errors;

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
          namespace: 'cya_profiles',
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
          namespace: 'cya_profiles',
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
        summary: 'Generate profile-aware narrative (stub)',
        description:
          'Stub endpoint for the CYA generation pipeline. Loads the profile and returns a session placeholder.',
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
            description: 'Stub response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    session_id: { type: 'string' },
                    status: { type: 'string', example: 'stub' },
                    message: { type: 'string', example: 'Phase 1-3 not yet implemented' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { profile_id, session_id } = ctx.params;
        await this.loadProfile(ctx, profile_id);
        return {
          session_id: session_id || `cya_${Date.now()}`,
          status: 'stub',
          message: 'Phase 1-3 not yet implemented',
        };
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
        summary: 'Refine a generated narrative (stub)',
        description: 'Stub endpoint for narrative refinement or HITL clarification handling.',
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
            description: 'Stub refinement response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    session_id: { type: 'string' },
                    status: { type: 'string', example: 'stub' },
                    message: { type: 'string', example: 'Refinement not yet implemented' },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        return {
          session_id: ctx.params.session_id,
          status: 'stub',
          message: 'Refinement not yet implemented',
        };
      },
    },
  },

  methods: {
    async loadProfile(ctx, profileId) {
      try {
        const result = await ctx.call('object-store.get', {
          namespace: 'cya_profiles',
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
  },
};
