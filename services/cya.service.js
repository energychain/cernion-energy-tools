'use strict';

const { MoleculerError } = require('moleculer').Errors;
const { retrieveContextData, mergeProvidedData } = require('../src/cya-data-retriever');
const { buildRegulatoryGraph, buildRegulatoryGraphFromOntology } = require('../src/cya-regulatory-graph');
const { buildOntologyGraph } = require('../src/cya-ontology-graph');
const { CyaContextManager } = require('../src/cya-context-manager');
const { buildGrounding } = require('../src/cya-grounding');
const { synthesizeNarrative, synthesizePersonaEvaluation, synthesizeConsensusWith } = require('../src/cya-synthesis');
const { startJob, appendLog } = require('../src/job-store');
const { PERSONA_ENUM, validatePerspectives, getPersona } = require('../src/cya-agent-personas');
const { getTemplate, listTemplates } = require('../src/cya-profile-templates');
const { buildCyaNarrativePdf } = require('../src/cya-report-builder');
const { retrievePersonaContext, buildPersonaGrounding } = require('../src/cya-persona-memory');
const { MAX_DIALOGUE_ROUNDS, detectConflicts, buildNegotiationPrompt } = require('../src/cya-conflict-detector');
const a2a = require('../src/cya-a2a-protocol');
const { graphCache } = require('../src/cya-graph-cache');
const { getTenantId, tenantNamespace } = require('../src/tenant-context');

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

        const tenantId = getTenantId(ctx);
        const ns = tenantNamespace(PROFILE_NAMESPACE, tenantId);

        await ctx.call('object-store.put', {
          namespace: ns,
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
        const tenantId = getTenantId(ctx);
        const ns = tenantNamespace(PROFILE_NAMESPACE, tenantId);
        const profile = await this.loadProfile(ctx, ctx.params.profile_id, ns);
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
        const tenantId = getTenantId(ctx);
        const ns = tenantNamespace(PROFILE_NAMESPACE, tenantId);
        const result = await ctx.call('object-store.query', {
          namespace: ns,
          selector: {},
          limit: ctx.params.limit,
        });
        const items = Array.isArray(result?.docs) ? result.docs : [];
        return { success: true, count: items.length, items };
      },
    },

    'profile.update': {
      rest: 'PATCH /profile/:id',
      params: {
        id:                  { type: 'string', pattern: PROFILE_ID_PATTERN, max: 64 },
        constraints:         { type: 'array', optional: true, items: { type: 'object', props: { topic: 'string', rule: 'string' } } },
        explicitPreferences: { type: 'object', optional: true },
        priorityFocusAreas:  { type: 'array', optional: true, items: 'string' },
        tone:                { type: 'string', optional: true, max: 200 },
        strategic_goals:     { type: 'array', optional: true, items: 'string' },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Explicit profile update (inner Zwiebel layer)',
        description:
          'Merges explicit user preferences into a CYA profile without touching ' +
          'implicitly derived stats. Part of the Progressive Profiling Zwiebelmodus (v0.34.0).',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', example: 'stadtwerk_regulierung' } },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  constraints:         { type: 'array', items: { type: 'object', properties: { topic: { type: 'string' }, rule: { type: 'string' } } }, nullable: true },
                  explicitPreferences: { type: 'object', nullable: true },
                  priorityFocusAreas:  { type: 'array', items: { type: 'string' }, nullable: true },
                  tone:                { type: 'string', nullable: true, example: 'sachlich, rechtssicher' },
                  strategic_goals:     { type: 'array', items: { type: 'string' }, nullable: true },
                },
              },
              examples: {
                default: {
                  value: {
                    constraints: [{ topic: 'Dunkelflaute', rule: 'Keine spekulativen Szenarien ohne Quellenangabe' }],
                    priorityFocusAreas: ['redispatch', 'capacity'],
                    tone: 'sachlich, direkt',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Profile updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id:      { type: 'string' },
                    profile: { type: 'object' },
                    updated: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          404: { description: 'Profile not found' },
        },
      },
      async handler(ctx) {
        const { id, ...explicitUpdate } = ctx.params;

        const existing = await ctx.call('object-store.get', {
          namespace: PROFILE_NAMESPACE,
          key: id,
        }).catch(() => null);

        if (!existing?.payload) {
          throw new MoleculerError(`Profile '${id}' not found`, 404, 'PROFILE_NOT_FOUND');
        }

        const { mergeExplicitIntoProfile } = require('../src/cya-profile-observer');
        const updated = mergeExplicitIntoProfile(existing.payload, explicitUpdate);

        await ctx.call('object-store.put', {
          namespace: PROFILE_NAMESPACE,
          key: id,
          payload: updated,
        });

        return { id, profile: updated, updated: true };
      },
    },

    listTemplates: {
      rest: 'GET /templates',
      openapi: {
        tags: ['CYA Agent'],
        summary: 'List prebuilt CYA profile templates',
        description: 'Returns read-only CYA profile templates for bootstrap and onboarding flows.',
        responses: {
          200: {
            description: 'Template list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    templates: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          templateId: { type: 'string', example: 'vnb_defensiv' },
                          name: { type: 'string', example: 'VNB Defensiv' },
                          description: { type: 'string' },
                          role: { type: 'string', enum: ACTOR_ROLES },
                          suggestedAudiences: { type: 'array', items: { type: 'string' } },
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
      async handler() {
        const templates = listTemplates().map((templateId) => {
          const template = getTemplate(templateId);
          return {
            templateId: template.templateId,
            name: template.name,
            description: template.description,
            role: template.actor.role,
            suggestedAudiences: template.suggestedAudiences,
          };
        });

        return { success: true, templates };
      },
    },

    getTemplate: {
      rest: 'GET /templates/:templateId',
      params: {
        templateId: { type: 'string' },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Load one prebuilt CYA profile template',
        parameters: [
          {
            name: 'templateId',
            in: 'path',
            required: true,
            schema: { type: 'string', example: 'vnb_defensiv' },
          },
        ],
        responses: {
          200: {
            description: 'Template found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    template: { type: 'object' },
                  },
                },
              },
            },
          },
          404: { description: 'Template not found' },
        },
      },
      async handler(ctx) {
        const template = getTemplate(ctx.params.templateId);
        if (!template) {
          throw new MoleculerError('TEMPLATE_NOT_FOUND', 404, 'TEMPLATE_NOT_FOUND');
        }
        return { success: true, template };
      },
    },

    createFromTemplate: {
      rest: 'POST /profile/from-template',
      params: {
        templateId: { type: 'string' },
        profile_id: { type: 'string', pattern: PROFILE_ID_PATTERN, max: 64 },
        overrideMode: { type: 'enum', values: ['append', 'replace'], optional: true, default: 'replace' },
        overrides: {
          type: 'object',
          optional: true,
          props: {
            organization: { type: 'string', optional: true },
            department: { type: 'string', optional: true },
            strategic_goals: { type: 'array', items: 'string', optional: true },
            tone: { type: 'string', optional: true },
          },
        },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Create CYA profile from template',
        description: 'Creates or updates a profile from a predefined template plus optional overrides.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['templateId', 'profile_id'],
                properties: {
                  templateId: { type: 'string', example: 'vnb_defensiv' },
                  profile_id: { type: 'string', pattern: '^[a-z0-9_]+$', maxLength: 64, example: 'vnb_heidelberg_reg' },
                  overrideMode: { type: 'string', enum: ['append', 'replace'], default: 'replace' },
                  overrides: {
                    type: 'object',
                    nullable: true,
                    example: {
                      organization: 'Stadtwerke Heidelberg Netze GmbH',
                      department: 'Regulierung',
                      strategic_goals: ['Transparenz gegenüber Aufsichtsrat stärken'],
                      tone: 'sachlich, rechtssicher',
                    },
                    properties: {
                      organization: { type: 'string', nullable: true },
                      department: { type: 'string', nullable: true },
                      strategic_goals: { type: 'array', items: { type: 'string' } },
                      tone: { type: 'string' },
                    },
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    templateId: 'vnb_defensiv',
                    profile_id: 'vnb_heidelberg_reg',
                    overrideMode: 'append',
                    overrides: {
                      organization: 'Stadtwerke Heidelberg Netze GmbH',
                      department: 'Netzplanung',
                      strategic_goals: ['Transparenz gegenüber Aufsichtsrat stärken'],
                      tone: 'sachlich, rechtssicher',
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Profile created from template',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    profile_id: { type: 'string', example: 'vnb_heidelberg_reg' },
                    templateId: { type: 'string', example: 'vnb_defensiv' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          404: { description: 'Template not found' },
        },
      },
      async handler(ctx) {
        const { templateId, profile_id, overrideMode = 'replace', overrides = {} } = ctx.params;
        const template = getTemplate(templateId);

        if (!template) {
          throw new MoleculerError('TEMPLATE_NOT_FOUND', 404, 'TEMPLATE_NOT_FOUND');
        }

        const actor = {
          role: template.actor.role,
          organization: Object.prototype.hasOwnProperty.call(overrides, 'organization')
            ? overrides.organization
            : template.actor.organization,
          department: Object.prototype.hasOwnProperty.call(overrides, 'department')
            ? overrides.department
            : template.actor.department,
        };

        let strategicGoals = Array.isArray(template.strategic_goals) ? [...template.strategic_goals] : [];
        if (Array.isArray(overrides.strategic_goals) && overrides.strategic_goals.length > 0) {
          strategicGoals = overrideMode === 'append'
            ? [...strategicGoals, ...overrides.strategic_goals]
            : [...overrides.strategic_goals];
        }

        const tone = overrides.tone || template.tone || this.settings.defaultTone;

        const createResult = await ctx.call('cya.createProfile', {
          profile_id,
          actor,
          strategic_goals: strategicGoals,
          tone,
        });

        return {
          success: true,
          profile_id,
          templateId,
          createdAt: createResult.createdAt,
        };
      },
    },

    exportPdf: {
      rest: 'GET /sessions/:session_id/export/pdf',
      params: {
        session_id: { type: 'string', example: 'cya_1713110400000' },
        language: { type: 'string', optional: true, enum: ['de', 'en'], default: 'de' },
        includeRegulatoryDetails: { type: 'boolean', optional: true, default: true },
        includeDataBasis: { type: 'boolean', optional: true, default: true },
        includeAITransparency: { type: 'boolean', optional: true, default: true },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Export CYA session as PDF',
        description:
          'Renders a completed CYA session (single or multi-perspective) as a PDF document. ' +
          'Returns a binary PDF buffer with Content-Disposition attachment header. ' +
          'Requires session status to be `completed`.',
        parameters: [
          {
            in: 'path',
            name: 'session_id',
            required: true,
            schema: { type: 'string', example: 'cya_1713110400000' },
          },
          {
            in: 'query',
            name: 'language',
            required: false,
            schema: { type: 'string', enum: ['de', 'en'], default: 'de' },
            example: 'de',
          },
          {
            in: 'query',
            name: 'includeRegulatoryDetails',
            required: false,
            schema: { type: 'boolean', default: true },
          },
          {
            in: 'query',
            name: 'includeDataBasis',
            required: false,
            schema: { type: 'boolean', default: true },
          },
          {
            in: 'query',
            name: 'includeAITransparency',
            required: false,
            schema: { type: 'boolean', default: true },
          },
        ],
        responses: {
          200: {
            description: 'PDF binary stream',
            content: {
              'application/pdf': {
                schema: { type: 'string', format: 'binary' },
              },
            },
          },
          404: { description: 'Session not found' },
          409: { description: 'Session not completed yet' },
        },
      },
      async handler(ctx) {
        const {
          session_id,
          language = 'de',
          includeRegulatoryDetails = true,
          includeDataBasis = true,
          includeAITransparency = true,
        } = ctx.params;

        const session = await this.loadSession(ctx, session_id);

        if (session.status !== 'completed') {
          throw new MoleculerError(
            'Session is not completed yet',
            409,
            'SESSION_NOT_COMPLETED',
            { status: session.status }
          );
        }

        const pdfBuffer = await buildCyaNarrativePdf(session, {
          language,
          includeRegulatoryDetails,
          includeDataBasis,
          includeAITransparency,
        });

        ctx.meta.$responseType = 'application/pdf';
        ctx.meta.$responseHeaders = {
          'Content-Disposition': `attachment; filename="cya-${session_id}.pdf"`,
        };

        return pdfBuffer;
      },
    },

    exportJson: {
      rest: 'GET /sessions/:session_id/export/json',
      params: {
        session_id: { type: 'string', example: 'cya_1713110400000' },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Export CYA session as JSON',
        description: 'Returns the full CYA session object as structured JSON for downstream processing.',
        parameters: [
          {
            in: 'path',
            name: 'session_id',
            required: true,
            schema: { type: 'string', example: 'cya_1713110400000' },
          },
        ],
        responses: {
          200: {
            description: 'Session JSON export',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    session_id: { type: 'string' },
                    exportedAt: { type: 'string', format: 'date-time' },
                    session: { type: 'object' },
                  },
                },
                examples: {
                  default: {
                    value: {
                      success: true,
                      session_id: 'cya_1713110400000',
                      exportedAt: '2026-04-18T10:00:00.000Z',
                      session: {},
                    },
                  },
                },
              },
            },
          },
          404: { description: 'Session not found' },
        },
      },
      async handler(ctx) {
        const { session_id } = ctx.params;
        const session = await this.loadSession(ctx, session_id);

        return {
          success: true,
          session_id,
          exportedAt: new Date().toISOString(),
          session,
        };
      },
    },

    'session.a2aLog': {
      rest: 'GET /sessions/:id/a2a-log',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Get A2A message log for a CYA session (v0.35.0)',
        description: 'Returns the full Agent-to-Agent communication log for a session, sorted by timestamp. Each entry is an A2AMessage envelope.',
        'x-oeo-class': 'OEO:AgentCommunication',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', example: 'cya_1713110400000' },
          },
        ],
        responses: {
          200: {
            description: 'A2A message log',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    messageCount: { type: 'integer' },
                    messages: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          messageId: { type: 'string', format: 'uuid' },
                          eventName: { type: 'string' },
                          sessionId: { type: 'string' },
                          fromPersona: { type: 'string' },
                          toPersona: { type: 'string', nullable: true },
                          payload: { type: 'object' },
                          timestamp: { type: 'string', format: 'date-time' },
                          protocolVersion: { type: 'string' },
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
        const { id } = ctx.params;
        let all = [];
        try {
          all = await ctx.call('object-store.list', { namespace: a2a.A2A_NAMESPACE }) || [];
        } catch (err) {
          this.logger.warn('[A2A] object-store.list failed:', err.message);
        }
        const messages = all
          .filter((entry) => entry && entry.payload && entry.payload.sessionId === id)
          .sort((x, y) => new Date(x.payload.timestamp) - new Date(y.payload.timestamp))
          .map((entry) => entry.payload);
        return {
          sessionId: id,
          messageCount: messages.length,
          messages,
        };
      },
    },

    'session.a2aAnalysis': {
      rest: 'GET /sessions/:id/a2a-analysis',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Analyse des A2A-Logs für eine CYA-Session (v0.38.2)',
        description: 'Wertet den persistierten Agent-to-Agent Kommunikations-Log einer Session aus. Liefert strukturierte Insights über Persona-Verdicts, Konflikte, Negotiation-Runden und Consensus-Ergebnis.',
        'x-oeo-class': 'OEO:AgentCommunication',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', example: 'cya_1713110400000' },
          },
        ],
        responses: {
          200: {
            description: 'A2A-Log-Analyse',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    analysis: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        totalMessages: { type: 'integer' },
                        conflictsDetected: { type: 'integer' },
                        negotiationRounds: { type: 'integer' },
                        consensusReached: { type: 'boolean' },
                        consensusRound: { type: 'integer', nullable: true },
                        hitlEscalated: { type: 'boolean' },
                        durationMs: { type: 'number', nullable: true },
                        blockerPersonas: { type: 'array', items: { type: 'string' } },
                        signalsSeen: { type: 'array', items: { type: 'string' } },
                      },
                    },
                    summary: { type: 'string', nullable: true },
                    message: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
      async handler(ctx) {
        const { analyzeLog, summarizeLog } = require('../src/cya-a2a-analyzer');
        const logResult = await ctx.call('cya.session.a2aLog', { id: ctx.params.id });
        if (!logResult || !logResult.messages || logResult.messages.length === 0) {
          return {
            sessionId: ctx.params.id,
            analysis: null,
            summary: null,
            message: 'Kein A2A-Log für diese Session vorhanden',
          };
        }
        const analysis = analyzeLog(logResult.messages);
        return {
          sessionId: ctx.params.id,
          analysis,
          summary: summarizeLog(analysis),
        };
      },
    },

    'a2aStats': {
      rest: 'GET /a2a-stats',
      params: {
        limit: { type: 'number', convert: true, optional: true, default: 100, min: 1, max: 1000 },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Globale A2A-Statistiken über alle Sessions (v0.38.2)',
        description: 'Aggregiert A2A-Logs aus allen gespeicherten Sessions und liefert Konsens-Rate, Eskalations-Rate, häufigste Blocker-Persona und häufigste Signals. Limit-Parameter verhindert Timeout bei vielen Sessions.',
        'x-oeo-class': 'OEO:AgentCommunication',
        parameters: [
          {
            in: 'query',
            name: 'limit',
            required: false,
            schema: { type: 'integer', default: 100, minimum: 1, maximum: 1000, example: 100 },
            description: 'Maximale Anzahl ausgewerteter Sessions (default: 100, max: 1000)',
          },
        ],
        responses: {
          200: {
            description: 'Aggregierte A2A-Statistiken',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionCount: { type: 'integer' },
                    stats: {
                      type: 'object',
                      properties: {
                        totalSessions: { type: 'integer' },
                        consensusRate: { type: 'number' },
                        avgNegotiationRounds: { type: 'number' },
                        hitlEscalationRate: { type: 'number' },
                        mostFrequentBlocker: { type: 'string', nullable: true },
                        mostFrequentSignal: { type: 'string', nullable: true },
                        avgDurationMs: { type: 'number', nullable: true },
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
        const { analyzeLog, aggregateLogs } = require('../src/cya-a2a-analyzer');
        const limit = ctx.params.limit || 100;

        // TODO: Pagination für >1000 Sessions (analog mastr-monitor)
        let all = [];
        try {
          all = await ctx.call('object-store.list', { namespace: a2a.A2A_NAMESPACE }) || [];
        } catch (err) {
          this.logger.warn('[A2A Stats] object-store.list failed:', err.message);
        }

        if (all.length === 0) {
          const { aggregateLogs: agg } = require('../src/cya-a2a-analyzer');
          return { sessionCount: 0, stats: agg([]) };
        }

        // Alle Messages nach sessionId gruppieren
        const sessionMap = {};
        for (const entry of all) {
          const msg = entry && entry.payload ? entry.payload : null;
          if (!msg || !msg.sessionId) continue;
          if (!sessionMap[msg.sessionId]) sessionMap[msg.sessionId] = [];
          sessionMap[msg.sessionId].push(msg);
        }

        // Sessions auf limit begrenzen (neueste zuerst, anhand erster Message)
        const sessions = Object.values(sessionMap)
          .sort((a, b) => {
            const ta = a[0] && a[0].timestamp ? new Date(a[0].timestamp).getTime() : 0;
            const tb = b[0] && b[0].timestamp ? new Date(b[0].timestamp).getTime() : 0;
            return tb - ta;
          })
          .slice(0, limit);

        const sessionAnalyses = sessions.map((msgs) => analyzeLog(msgs));

        return {
          sessionCount: sessions.length,
          stats: aggregateLogs(sessionAnalyses),
        };
      },
    },

    'session.contextState': {
      rest: 'GET /sessions/:id/context-state',
      params: {
        id: { type: 'string' },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Get persisted Zwiebelmodus context state for a CYA session (v0.37.0)',
        description: 'Returns the serialized CyaContextManager zoom-state for session resumption. Enables refine calls to continue with identical onion context. Object Store namespace: cya_context_states.',
        'x-oeo-class': 'OEO:ContextManagement',
        parameters: [
          {
            in: 'path',
            name: 'id',
            required: true,
            schema: { type: 'string', example: 'cya_1713110400000' },
            description: 'CYA Session ID',
          },
        ],
        responses: {
          200: {
            description: 'Persisted context state',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    outerContext: {
                      type: 'object',
                      nullable: true,
                      properties: {
                        goal: { type: 'string', nullable: true },
                        focusArea: { type: 'array', items: { type: 'string' } },
                      },
                    },
                    currentDepth: { type: 'integer', example: 1 },
                    breadcrumb: { type: 'array', items: { type: 'string' } },
                    iterationLog: { type: 'array', items: { type: 'object' } },
                    maxIterations: { type: 'integer', example: 3 },
                    zoomStack: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'nodeId history for zoomIn operations',
                    },
                    savedAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          404: {
            description: 'No context state found for this session',
          },
        },
      },
      async handler(ctx) {
        const { id } = ctx.params;
        const result = await ctx.call('object-store.get', {
          namespace: 'cya_context_states',
          key: `ctx_${id}`,
        }).catch(() => null);
        if (!result?.payload) {
          throw new MoleculerClientError(
            `No context state for session '${id}'`,
            404,
            'CONTEXT_STATE_NOT_FOUND'
          );
        }
        return { sessionId: id, ...result.payload };
      },
    },

    'export.oeo-stub': {
      rest: 'GET /graph/export/oeo-stub',
      // ─────────────────────────────────────────────────────────────────────
      // OEO Export Stub — Science-Ready Hook (introduced v0.34.1)
      //
      // This endpoint exports the live Graphology ontology graph as a
      // JSON-LD skeleton, ready for OEO class mapping by external contributors.
      //
      // CURRENT STATUS: oeoStub is null (NOT_IMPLEMENTED).
      //   graphology.nodes + graphology.edges are fully populated.
      //
      // TARGET FORMAT: Open Energy Ontology (OEO) JSON-LD
      //   https://github.com/OpenEnergyPlatform/ontology
      //
      // CONTRIBUTOR: implement src/oeo-exporter-stub.js → transformToOEO()
      //   See CONTRIBUTING_SCIENCE.md for instructions.
      // ─────────────────────────────────────────────────────────────────────
      params: {
        operator: { type: 'string', optional: true },
        location:  { type: 'string', optional: true },
        baseIri:   { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { buildOntologyGraph } = require('../src/cya-ontology-graph');
        const { exportGraphForOeo }  = require('../src/oeo-exporter-stub');

        // Minimaler Graph mit Stub-Knoten wenn keine Operator-Daten übergeben
        // Forscher können den Endpoint ohne Auth testen
        const stubInstallations = ctx.params.operator ? [] : [
          {
            EinheitMastrNummer: 'SEE999952467552',
            name: 'Solarpark Höheinöd (Demo)',
            leistungKw: 2103.7,
            spannungsebene: 'MS',
            technologie: 'SOLAR',
            ibJahr: 2009,
            status: 35,
            koordinaten: { lat: 49.2167, lon: 7.6333 },
          },
        ];

        const graph = buildOntologyGraph(stubInstallations, null);
        const payload = exportGraphForOeo(graph, {
          baseIri: ctx.params.baseIri || 'https://cernion.example/graph/',
        });

        return {
          ok: true,
          ...payload,
        };
      },
    },

    'graph.cacheStatus': {
      rest: 'GET /graph/cache',
      openapi: {
        summary: 'Ontologie-Graph Cache Status',
        description: 'Gibt den aktuellen L1-Cache-Status des Ontologie-Graphen zurück. Für Ops-Monitoring und Debugging.',
        tags: ['CYA Agent'],
        responses: {
          200: {
            description: 'Cache-Statistiken',
            content: { 'application/json': { schema: { type: 'object', properties: {
              ok: { type: 'boolean' },
              cache: { type: 'object' },
            }}}},
          },
        },
      },
      // Gibt den aktuellen L1-Cache-Status zurück (für Monitoring/Ops)
      handler(ctx) {  // eslint-disable-line no-unused-vars
        return {
          ok: true,
          cache: graphCache.getStats(),
        };
      },
    },

    'graph.invalidate': {
      rest: 'DELETE /graph/cache/:operatorId',
      params: {
        operatorId: { type: 'string', min: 1, max: 100 },
      },
      openapi: {
        summary: 'Ontologie-Graph Cache invalidieren',
        description: 'Invalidiert den Graphen für einen VNB. Wird automatisch ausgelöst bei mastr-monitor.delta.detected.',
        tags: ['CYA Agent'],
        responses: {
          200: {
            description: 'Invalidierungsbestätigung',
            content: { 'application/json': { schema: { type: 'object', properties: {
              key:         { type: 'string' },
              invalidated: { type: 'boolean' },
            }}}},
          },
        },
      },
      // Invalidiert den Graphen für einen VNB (z.B. nach MaStR-Update)
      async handler(ctx) {
        const key = graphCache.buildKey(ctx.params.operatorId);
        const result = await graphCache.invalidate(
          key,
          ctx.call.bind(ctx)
        );
        this.broker.emit('cya.ontology.graph.invalidated', {
          operatorId: ctx.params.operatorId,
          cacheKey: key,
          timestamp: new Date().toISOString(),
        });
        return result;
      },
    },

    compareProfiles: {
      rest: 'POST /compare-perspectives',
      params: {
        profile_ids: { type: 'array', items: 'string', min: 2, max: 5 },
        target_audience: { type: 'string' },
        context: {
          type: 'object',
          example: {
            location: 'Heidelberg',
            trigger: 'Presseanfrage zur Netzstabilität',
            focus_areas: ['capacity', 'compliance'],
            capacity_mw: 10,
          },
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
            capacity_mw: { type: 'number', optional: true },
          },
        },
        session_id: { type: 'string', optional: true },
      },
      openapi: {
        tags: ['CYA Agent'],
        summary: 'Generate multi-perspective comparison from profiles/templates',
        description:
          'Runs phases 1–3 once (retrieval/graph/grounding) and executes phase 4 synthesis in parallel for 2–5 profile IDs or template IDs.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['profile_ids', 'target_audience', 'context'],
                properties: {
                  profile_ids: {
                    type: 'array',
                    minItems: 2,
                    maxItems: 5,
                    items: { type: 'string' },
                    example: ['vnb_defensiv', 'projektierer_offensiv'],
                  },
                  target_audience: { type: 'string', example: 'Aufsichtsrat' },
                  context: {
                    type: 'object',
                    required: ['trigger', 'focus_areas'],
                    example: {
                      location: 'Heidelberg',
                      trigger: 'Presseanfrage zur Netzstabilität',
                      focus_areas: ['capacity', 'compliance'],
                      capacity_mw: 10,
                    },
                    properties: {
                      location: { type: 'string', nullable: true, example: 'Heidelberg' },
                      trigger: { type: 'string', example: 'Presseanfrage zur Netzstabilität' },
                      focus_areas: {
                        type: 'array',
                        minItems: 1,
                        items: { type: 'string', enum: FOCUS_AREAS },
                        example: ['capacity', 'compliance'],
                      },
                      capacity_mw: {
                        type: 'number',
                        nullable: true,
                        description: 'Optional asset capacity in MW for topology-hop logic.',
                        example: 10,
                      },
                    },
                  },
                  session_id: { type: 'string', nullable: true, example: 'cya_mp_1713110400000' },
                },
              },
              examples: {
                default: {
                  value: {
                    profile_ids: ['vnb_defensiv', 'projektierer_offensiv'],
                    target_audience: 'Aufsichtsrat',
                    context: {
                      location: 'Heidelberg',
                      trigger: 'Presseanfrage zur Netzstabilität',
                      focus_areas: ['capacity', 'compliance'],
                      capacity_mw: 10,
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Comparison result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    session_id: { type: 'string' },
                    status: { type: 'string', enum: ['completed', 'needs_clarification'] },
                    perspectiveCount: { type: 'number', example: 2 },
                    grounding: { type: 'object' },
                    regulatory_graph: { type: 'object' },
                    perspectives: { type: 'array', items: { type: 'object' } },
                    metadata: { type: 'object' },
                  },
                },
              },
            },
          },
          404: { description: 'Profile/template not found' },
        },
      },
      async handler(ctx) {
        const { profile_ids, target_audience, context, session_id } = ctx.params;

        const profiles = [];
        for (const id of profile_ids) {
          let profile = null;
          try {
            profile = await this.loadProfile(ctx, id);
            profile._sourceType = 'profile';
            profile._sourceId = id;
          } catch (err) {
            if (err?.code === 404 || err?.type === 'PROFILE_NOT_FOUND') {
              const template = getTemplate(id);
              if (template) {
                profile = {
                  actor: template.actor,
                  strategic_goals: template.strategic_goals,
                  tone: template.tone,
                  _sourceType: 'template',
                  _sourceId: id,
                };
              }
            } else {
              throw err;
            }
          }

          if (!profile) {
            throw new MoleculerError(`Profile or template '${id}' not found`, 404, 'PROFILE_OR_TEMPLATE_NOT_FOUND');
          }
          profiles.push(profile);
        }

        const retrieval = await retrieveContextData(ctx, {
          profile: profiles[0],
          target_audience,
          context,
          actorRole: profiles[0]?.actor?.role || null,
          ontologySignals: null,
        });

        // Phase 2: Ontology layer (v0.32.0+v0.36.0 cached) — non-blocking, falls back to Regex if null
        const { graphSignals: _gsPreload, contextManager: _cmPreload } = await this._buildOntologyLayer(
          retrieval,
          context?.goal || null,
          Array.isArray(context?.focus_areas) ? context.focus_areas : []
        );
        // v0.37.0 — Persist context state non-blocking
        const _preloadSessionId = ctx.params.session_id || null;
        if (_cmPreload && _preloadSessionId) {
          this._persistContextState(_preloadSessionId, _cmPreload)
            .catch((err) => this.logger.warn('[ContextManager] persist failed:', err.message));
        }
        const regulatoryGraph = _gsPreload || buildRegulatoryGraph({
          retrieval,
          context,
          profile: profiles[0],
          topologyHop: retrieval.topologyHop,
        });

        const grounding = buildGrounding({
          retrieval,
          regulatoryGraph,
          context,
          topologyHop: retrieval.topologyHop,
        });
        // v0.33 — Dynamic Tool Router transparency fields (EU AI Act Art. 12)
        if (retrieval.toolSetRationale) grounding.toolSetRationale = retrieval.toolSetRationale;
        if (retrieval.signalOverrides) grounding.signalOverrides = retrieval.signalOverrides;

        if (grounding.requiresClarification || !Array.isArray(grounding.facts) || grounding.facts.length === 0) {
          return {
            success: true,
            status: 'needs_clarification',
            clarification: grounding.clarification || { reason: 'insufficient_facts' },
            grounding,
            regulatory_graph: regulatoryGraph,
          };
        }

        const perspectives = await Promise.all(
          profiles.map(async (profile) => {
            try {
              const synthesis = await synthesizeNarrative({
                mode: 'generate',
                profile,
                target_audience,
                context,
                grounding,
                regulatoryGraph,
              });

              return {
                profileId: profile._sourceId,
                profileType: profile._sourceType,
                role: profile.actor?.role || null,
                organization: profile.actor?.organization || null,
                tone: profile.tone || null,
                narrative: synthesis.narrative,
                status: 'completed',
              };
            } catch (err) {
              return {
                profileId: profile._sourceId,
                profileType: profile._sourceType,
                role: profile.actor?.role || null,
                status: 'error',
                error: String(err?.message || 'synthesis_failed'),
              };
            }
          })
        );

        const now = new Date().toISOString();
        const sessionId = session_id || `cya_mp_${Date.now()}`;
        await this.saveSession(ctx, sessionId, {
          session_id: sessionId,
          status: 'completed',
          type: 'multi_perspective',
          profile_ids,
          target_audience,
          context,
          grounding,
          regulatory_graph: regulatoryGraph,
          perspectives,
          createdAt: now,
          updatedAt: now,
        });

        return {
          success: true,
          session_id: sessionId,
          status: 'completed',
          perspectiveCount: perspectives.length,
          grounding: {
            confidence: grounding.confidence,
            factCount: grounding.facts?.length || 0,
            dataGaps: grounding.dataGaps,
          },
          regulatory_graph: regulatoryGraph,
          perspectives,
          metadata: {
            createdAt: now,
            focus_areas: context.focus_areas,
            trigger: context.trigger,
            location: context.location,
          },
        };
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
            actorRole: profile?.actor?.role || null,
            ontologySignals: null,
          });
          appendLog(jobId, 'phase_1_retrieval', 33, 'Context data retrieval complete');

          // Phase 2: Ontology layer + Regulatory Graph (v0.32.0)
          appendLog(jobId, 'phase_2_graph', 33, 'Building deterministic regulatory graph...');
          const { graphSignals: _gsMain, contextManager: _cmMain } = await this._buildOntologyLayer(
            retrieval,
            ctx.params.goal || null,
            Array.isArray(context?.focus_areas) ? context.focus_areas : []
          );
          // v0.37.0 — Persist context state non-blocking
          if (_cmMain && sessionId) {
            this._persistContextState(sessionId, _cmMain)
              .catch((err) => this.logger.warn('[ContextManager] persist failed:', err.message));
          }
          const regulatoryGraph = _gsMain || buildRegulatoryGraph({
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
          // v0.33 — Dynamic Tool Router transparency fields (EU AI Act Art. 12)
          if (retrieval.toolSetRationale) grounding.toolSetRationale = retrieval.toolSetRationale;
          if (retrieval.signalOverrides) grounding.signalOverrides = retrieval.signalOverrides;
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

          // Progressive Profiling: implicit extraction after session close (v0.34.0)
          // Non-blocking — observer failure must not delay the response
          {
            const _completedSession = {
              status: 'completed', profile_id, context,
              regulatory_graph: regulatoryGraph, grounding,
              retrieval, history: [],
              narrative: synthesis.narrative,
            };
            this._observeAndUpdateProfile(profile_id, _completedSession)
              .catch(err => this.logger.warn('profile-observer failed (non-blocking):', err.message));
          }

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

        // v0.37.0 — Restore Zwiebelmodus context state (non-blocking, optional)
        // ontologyGraph is not directly available here; restore is best-effort from saved state.
        // The restored contextManager is available for downstream re-use if needed.
        const _restoredCtxManager = await this._restoreContextState(
          ctx.params.session_id,
          session._ontologyGraph || null
        ).catch(() => null);
        if (_restoredCtxManager) {
          this.logger.info('[ContextManager] Restored zoom context for session:', ctx.params.session_id);
        }

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
          // v0.33 — Dynamic Tool Router transparency fields (EU AI Act Art. 12)
          if (enrichedRetrieval.toolSetRationale) enrichedGrounding.toolSetRationale = enrichedRetrieval.toolSetRationale;
          if (enrichedRetrieval.signalOverrides) enrichedGrounding.signalOverrides = enrichedRetrieval.signalOverrides;

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
    /**
     * Build ontology graph + context manager from retrieval result (Phase 2 helper).
     * Returns { ontologyGraph, contextManager, graphSignals } or all-null on missing data.
     * Non-blocking — never throws; failures return null values so Regex fallback kicks in.
     *
     * @param {Object} retrieval - Phase 1 retrieval result
     * @param {string|null} goal
     * @param {string[]} focusAreas
     * @returns {{ ontologyGraph, contextManager, graphSignals }}
     */
    async _buildOntologyLayer(retrieval, goal, focusAreas) {
      try {
        const installations = retrieval?.installations;
        if (!Array.isArray(installations) || installations.length === 0) {
          return { ontologyGraph: null, contextManager: null, graphSignals: null };
        }

        // ── Cache-Key aus Operator-Identifier ableiten ───────────────────────
        const operatorId =
          retrieval.operator ||
          retrieval.gridOperatorId ||
          retrieval.installations?.[0]?.Netzbetreiber ||
          'unknown';
        const cacheKey = graphCache.buildKey(operatorId);

        // ── L1-Lookup (synchron, <1ms) ────────────────────────────────────────
        let ontologyGraph = graphCache.getL1(cacheKey);

        // ── L2-Lookup (async, Object Store) ──────────────────────────────────
        if (!ontologyGraph) {
          ontologyGraph = await graphCache.getL2(cacheKey, this.broker.call.bind(this.broker));
        }

        // ── Cache-Miss: Graph neu bauen und persistieren ──────────────────────
        if (!ontologyGraph) {
          ontologyGraph = buildOntologyGraph(installations, retrieval.topologyHop || null);
          graphCache.set(cacheKey, ontologyGraph, this.broker.call.bind(this.broker))
            .catch(err => this.logger?.warn('[GraphCache] write failed:', err.message));

          this.broker.emit('cya.ontology.graph.built', {
            cacheKey,
            nodeCount: ontologyGraph.order,
            edgeCount: ontologyGraph.size,
            timestamp: new Date().toISOString(),
          });
        }

        // ── Context Manager (unverändert) ─────────────────────────────────────
        const contextManager = new CyaContextManager(ontologyGraph);
        contextManager.setOuterContext(goal || null, focusAreas || []);

        const firstMastr = installations[0]?.EinheitMastrNummer;
        let graphSignals = null;
        if (firstMastr) {
          const focusNodeId = `INSTALLATION:${firstMastr}`;
          graphSignals = buildRegulatoryGraphFromOntology(ontologyGraph, focusNodeId);
        }

        return { ontologyGraph, contextManager, graphSignals };
      } catch (err) {
        // Non-blocking — Regex fallback remains intact
        this.logger?.warn('CYA ontology layer build failed (fallback to regex):', err.message);
        return { ontologyGraph: null, contextManager: null, graphSignals: null };
      }
    },

    async loadProfile(ctx, profileId, namespace = PROFILE_NAMESPACE) {
      try {
        const result = await ctx.call('object-store.get', {
          namespace,
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

    /**
     * Progressive Profiling: extract implicit signals from a completed session
     * and merge them into the profile (outer Zwiebel layer). Non-blocking.
     * Also writes a compact session summary into the role-specific persona namespace
     * (first write activation of persona memory, v0.34.0).
     * @param {string} profileId
     * @param {Object} session - Completed session payload
     */
    async _observeAndUpdateProfile(profileId, session) {
      const { extractImplicitSignals, mergeImplicitIntoProfile } = require('../src/cya-profile-observer');

      const existing = await this.broker.call('object-store.get', {
        namespace: PROFILE_NAMESPACE,
        key: profileId,
      }).catch(() => null);
      if (!existing?.payload) return;

      const signals = extractImplicitSignals(session);
      const updated = mergeImplicitIntoProfile(existing.payload, signals);

      await this.broker.call('object-store.put', {
        namespace: PROFILE_NAMESPACE,
        key: profileId,
        payload: updated,
      });

      // Persona memory write (v0.34.0 — first activation)
      const role = existing.payload?.actor?.role;
      if (role) {
        await this._writePersonaMemory(role, session, signals).catch(() => null);
      }
    },

    /**
     * Write a compact session summary into the role-specific persona memory namespace.
     * @param {string} actorRole
     * @param {Object} session
     * @param {Object} signals - extracted implicit signals
     */
    async _writePersonaMemory(actorRole, session, signals) {
      const { ACTOR_ROLE_PERSONA_NAMESPACE } = require('../src/cya-agent-personas');
      const namespace = ACTOR_ROLE_PERSONA_NAMESPACE[actorRole];
      if (!namespace) return;

      const memoryDoc = {
        summary:      session.narrative?.headline || session.narrative?.title || '',
        focusAreas:   signals.focusAreas,
        signalsSeen:  signals.signalsSeen,
        confidence:   signals.confidence,
        createdAt:    new Date().toISOString(),
        tags:         signals.focusAreas,
      };

      const key = `mem_${Date.now()}`;
      await this.broker.call('object-store.put', {
        namespace,
        key,
        payload: memoryDoc,
      });
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
        || await retrieveContextData(ctx, { profile, target_audience, context, actorRole: profile?.actor?.role || null, ontologySignals: null });
      log('phase_1_retrieval', 20, 'Shared retrieval complete');

      log('phase_2_graph', 20, 'Multi-agent: shared regulatory graph...');
      const { graphSignals: _gsMulti } = await this._buildOntologyLayer(
        retrieval,
        args.goal || null,
        Array.isArray(context?.focus_areas) ? context.focus_areas : []
      );
      const regulatoryGraph = _gsMulti || buildRegulatoryGraph({
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
        { profile, target_audience, context, regulatoryGraph, sessionId }
      );
      log('phase_4_synthesis', 75, 'Per-persona synthesis complete');

      // Conflict negotiation loop
      const { finalStates, dialogueRounds, conflictResolved, consensusNarrative } =
        await this.runConflictNegotiation(
          stakeholderStates, baselineGrounding.facts,
          { profile, target_audience, context, regulatoryGraph, sessionId }
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

      // Progressive Profiling: implicit extraction after multi-agent session close (v0.34.0)
      {
        const _completedSession = {
          status: 'completed', profile_id, context,
          regulatory_graph: regulatoryGraph, grounding: baselineGrounding,
          retrieval, history: [], narrative,
        };
        this._observeAndUpdateProfile(profile_id, _completedSession)
          .catch(err => this.logger.warn('profile-observer failed (non-blocking):', err.message));
      }

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
          // A2A: Persona hat Verdict abgegeben
          if (args.sessionId) {
            await this._emitA2AMessage(a2a.personaEvaluated(args.sessionId, personaId, state));
          }
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
      const sessionId = synthesisArgs.sessionId || null;
      const initialConflict = detectConflicts(stakeholderStates);

      if (!initialConflict.hasConflict) {
        // No conflict — synthesize consensus immediately
        const consensus = await synthesizeConsensusWith({
          ...synthesisArgs, stakeholderStates, sharedFacts, round: 0,
        });
        if (sessionId) {
          await this._emitA2AMessage(a2a.consensusReached(sessionId, { narrative: consensus.narrative, round: 0 }));
        }
        return { finalStates: stakeholderStates, dialogueRounds, conflictResolved: true, consensusNarrative: consensus };
      }

      // Conflict detected — emit once before loop
      if (sessionId) {
        await this._emitA2AMessage(a2a.conflictDetected(sessionId, {
          blockers: initialConflict.blockers,
          approvers: initialConflict.approvers,
          triggers: initialConflict.triggers,
        }));
      }

      let currentStates = { ...stakeholderStates };
      for (let round = 1; round <= MAX_DIALOGUE_ROUNDS; round++) {
        const conflict = detectConflicts(currentStates);
        // eslint-disable-next-line no-await-in-loop
        const consensus = await synthesizeConsensusWith({
          ...synthesisArgs, stakeholderStates: currentStates, sharedFacts, round,
        });

        // Bug-fix: update currentStates if LLM returns updatedStates (hook for future rounds)
        if (consensus.updatedStates) {
          currentStates = consensus.updatedStates;
        }

        const roundEntry = {
          round,
          blockers: conflict.blockers,
          triggers: conflict.triggers,
          consensusReached: consensus.consensusReached,
          unresolvedConflicts: consensus.unresolvedConflicts,
        };
        dialogueRounds.push(roundEntry);

        if (sessionId) {
          // eslint-disable-next-line no-await-in-loop
          await this._emitA2AMessage(a2a.negotiationRound(sessionId, roundEntry));
        }

        if (consensus.consensusReached) {
          if (sessionId) {
            // eslint-disable-next-line no-await-in-loop
            await this._emitA2AMessage(a2a.consensusReached(sessionId, { narrative: consensus.narrative, round }));
          }
          return { finalStates: currentStates, dialogueRounds, conflictResolved: true, consensusNarrative: consensus };
        }
      }

      if (sessionId) {
        const lastUnresolved = dialogueRounds.length > 0
          ? dialogueRounds[dialogueRounds.length - 1].unresolvedConflicts
          : [];
        await this._emitA2AMessage(a2a.consensusFailed(sessionId, {
          unresolvedConflicts: lastUnresolved,
          roundsAttempted: MAX_DIALOGUE_ROUNDS,
        }));
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

    /**
     * Persist the CyaContextManager zoom-state for a session into Object Store.
     * Fire-and-forget (non-blocking) — errors are logged as warnings only.
     * Namespace: cya_context_states, Key: ctx_{sessionId}
     * @param {string} sessionId
     * @param {import('../src/cya-context-manager').CyaContextManager} contextManager
     */
    async _persistContextState(sessionId, contextManager) {
      if (!sessionId || !contextManager) return;
      const state = contextManager.serialize();
      this.broker.call('object-store.put', {
        namespace: 'cya_context_states',
        key: `ctx_${sessionId}`,
        payload: {
          ...state,
          savedAt: new Date().toISOString(),
          sessionId,
        },
      }).catch((err) =>
        this.logger.warn('[ContextManager] persist failed (non-blocking):', err.message)
      );
    },

    /**
     * Restore a CyaContextManager from Object Store for a session.
     * Returns null if state not found, deserialization fails, or graph is incompatible.
     * @param {string} sessionId
     * @param {import('graphology').Graph} ontologyGraph
     * @returns {Promise<import('../src/cya-context-manager').CyaContextManager|null>}
     */
    async _restoreContextState(sessionId, ontologyGraph) {
      if (!sessionId || !ontologyGraph) return null;
      try {
        const { CyaContextManager } = require('../src/cya-context-manager');
        const result = await this.broker.call('object-store.get', {
          namespace: 'cya_context_states',
          key: `ctx_${sessionId}`,
        });
        if (!result?.payload) return null;
        const cm = CyaContextManager.deserialize(result.payload, ontologyGraph);
        if (!cm.isCompatibleWith(ontologyGraph)) {
          this.logger.info('[ContextManager] state incompatible with current graph, rebuilding');
          return null;
        }
        return cm;
      } catch {
        return null;
      }
    },

    /**
     * Emit and persist an A2A message envelope.
     * Fire-and-forget for persistence; validates before emit.
     *
     * @param {object} msg - A2AMessage envelope from cya-a2a-protocol
     */
    async _emitA2AMessage(msg) {
      a2a.validateMessage(msg);
      this.broker.emit(msg.eventName, msg);
      this.broker.call('object-store.put', {
        namespace: a2a.A2A_NAMESPACE,
        key: msg.messageId,
        payload: msg,
      }).catch((err) =>
        this.logger.warn('[A2A] persist failed (non-blocking):', err.message)
      );
    },
  },

  events: {
    // A2A-Event-Monitoring: CYA reagiert auf eigene A2A-Events
    // (Basis für künftige externe Subscriber, z.B. Dashboard-Alerts)
    'cya.a2a.consensus.failed': {
      async handler(ctx) {
        this.logger.warn(
          '[A2A] Consensus failed for session:',
          ctx.params.sessionId,
          '— HITL escalation triggered'
        );
        // Erweiterungspunkt: Alert, Webhook, Dashboard-Event
      },
    },
    'cya.a2a.conflict.detected': {
      async handler(ctx) {
        this.logger.info(
          '[A2A] Conflict detected in session:',
          ctx.params.sessionId,
          '— blockers:', ctx.params.payload && ctx.params.payload.blockers
        );
      },
    },

    // ── Ontologie-Graph Cache Events (v0.36.0) ────────────────────────────────
    'cya.ontology.graph.built': {
      handler(ctx) {
        this.logger.info(
          '[OntologyGraph] Built and cached:',
          ctx.params.cacheKey,
          `(${ctx.params.nodeCount} nodes, ${ctx.params.edgeCount} edges)`
        );
      },
    },
    'cya.ontology.graph.invalidated': {
      handler(ctx) {
        this.logger.info(
          '[OntologyGraph] Cache invalidated for operator:',
          ctx.params.operatorId
        );
      },
    },

    // ── MaStR-Monitor Auto-Invalidierung (v0.36.0) ───────────────────────────
    'mastr-monitor.delta.detected': {
      // Automatische Cache-Invalidierung wenn MaStR-Delta erkannt
      async handler(ctx) {
        const operatorId = ctx.params?.operator || ctx.params?.bdewCode;
        if (!operatorId) return;
        const key = graphCache.buildKey(operatorId);
        await graphCache.invalidate(key, this.broker.call.bind(this.broker))
          .catch(() => null);
        this.logger.info(
          '[OntologyGraph] Auto-invalidated after MaStR delta for:',
          operatorId
        );
      },
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
