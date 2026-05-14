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
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Run one Personal-Agent chat turn with deterministic L0-L4 context stacking',
        description:
          'Builds a deterministic context stack (L0-L4), enforces token budgets, and guarantees Layer 4 purge after synthesis. ' +
          'Layer-4 raw tool JSON is never persisted.',
      },
      async handler(ctx) {
        const tenantId = getTenantId(ctx);
        const userId = String(ctx.meta?.authUser?.userId || 'anonymous');
        const sessionId = String(ctx.params.sessionId || `pa_${crypto.randomUUID()}`);
        const session = await this.loadSession(ctx, tenantId, sessionId, userId);
        const userMessage = {
          role: 'user',
          text: ctx.params.message,
          ts: new Date().toISOString(),
        };

        const stackResult = buildContextStack({
          systemPrompt: this.settings.systemPrompt,
          tenantFacts: session.l1?.tenantFacts || [],
          userProfile: session.l2?.userProfile || {},
          sessionHistory: [...(session.l3?.history || []), userMessage],
          toolContext: ctx.params.toolContext || null,
          maxContextTokens: this.settings.maxContextTokens,
        });

        const synthesisText = this.synthesizeTurn({
          message: ctx.params.message,
          toolContext: ctx.params.toolContext,
        });

        const finalized = synthesizeAndPurgeLayer4(stackResult.stack, synthesisText);
        const persisted = buildPersistableSessionState({
          id: sessionId,
          tenantId,
          userId,
          l1: finalized.stack.l1,
          l2: finalized.stack.l2,
          l3: finalized.stack.l3,
          createdAt: session.createdAt,
        });

        assertNoL4RawInPersistedState(persisted);
        await this.persistSession(ctx, tenantId, sessionId, persisted);

        return {
          success: true,
          sessionId,
          reply: synthesisText,
          layer4Purged: finalized.layer4Purged,
          l3Compressed: Boolean(finalized.stack?.l3?.compressed),
          contextUsage: stackResult.usage,
          historyCount: finalized.stack?.l3?.history?.length || 0,
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
          l3: { history: [], summary: null, compressed: false },
          createdAt: current.createdAt,
        });

        await this.persistSession(ctx, tenantId, current.id, resetState);

        return {
          success: true,
          sessionId: current.id,
          reset: true,
          keptLayer2: true,
        };
      },
    },
  },

  methods: {
    synthesizeTurn({ message, toolContext }) {
      if (toolContext && toolContext.responseRaw) {
        const keyCount = Object.keys(toolContext.responseRaw || {}).length;
        return `Tool-Ergebnis verarbeitet (${keyCount} Felder). Zusammenfassung erstellt und Layer 4 verworfen.`;
      }
      return `Verstanden. Nächster Schritt für: ${String(message).trim().slice(0, 240)}`;
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

    async loadSession(ctx, tenantId, sessionId, userId) {
      const namespace = tenantNamespace(SESSION_NAMESPACE, tenantId);
      const userProfile = await this.loadUserProfile(ctx, tenantId, userId);

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
          l3: payload.l3 || { history: [], summary: null, compressed: false },
          createdAt: payload.createdAt || new Date().toISOString(),
          updatedAt: payload.updatedAt || null,
        };
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }

        return {
          id: sessionId,
          tenantId,
          userId,
          l1: { tenantFacts: [] },
          l2: { userProfile },
          l3: { history: [], summary: null, compressed: false },
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
