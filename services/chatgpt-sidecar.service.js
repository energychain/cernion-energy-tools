'use strict';

/**
 * ChatGPT Sidecar session-ticket facade (energychain/cernion-energy-tools#388,
 * first-card slice).
 *
 * Approved scope (owner comment 2026-07-05T14:10:06Z):
 *   POST   /api/chatgpt-sidecar/sessions
 *   DELETE /api/chatgpt-sidecar/sessions/:sessionId   (authenticated Cernion side only)
 *   GET    /api/chatgpt-sidecar/s/:ticket/manifest
 *   POST   /api/chatgpt-sidecar/s/:ticket/ask
 *   GET    /api/chatgpt-sidecar/s/:ticket/ask          (browser read-only facade)
 *   POST   /api/chatgpt-sidecar/s/:ticket/plan
 *   GET    /api/chatgpt-sidecar/s/:ticket/plan         (browser read-only facade)
 *   POST   /api/chatgpt-sidecar/s/:ticket/datapoints   (draft_write only)
 *   GET    /api/chatgpt-sidecar/s/:ticket/metering
 *
 * `execute`, `controlled_write`, `process_execute` and `requires_confirmation`
 * are policy outcomes only in this slice (see evaluateWriteRequest) — nothing
 * in this file mutates production state outside the draft datapoint path.
 * `dossier` is deferred to a later slice.
 *
 * Ticket-scoped routes (`/s/:ticket/*`) are intentionally reachable with zero
 * Cernion auth token — the opaque ticket itself is the credential, resolved
 * server-side against the session store. `sessions` create/delete require a
 * real authenticated tenant plus the `chatgpt-sidecar-creator` role (see
 * assertCreatorAllowed) so a bare CERNION_READONLY_TOKEN cannot mint sessions.
 */

const crypto = require('crypto');
const { MoleculerClientError } = require('moleculer').Errors;
const { hasRole } = require('../src/auth/rbac');
const { getAuthenticatedTenant } = require('../src/agent-sidecar-policy');
const {
  defaultStore,
  isValidTtl,
  TTL_OPTIONS,
  DEFAULT_TTL,
} = require('../src/chatgpt-sidecar-session-store');
const {
  DEFAULT_WRITE_SCOPE,
  normalizeCapabilityProfile,
  resolveWriteScope,
  evaluateWriteRequest,
  redactSessionForClient,
  resolveOntologyContext,
} = require('../src/chatgpt-sidecar-session-policy');
const { buildPromptText } = require('../src/chatgpt-sidecar-prompt');
const {
  compileReadOnlyExecutionPlan,
  buildAskBlueprintAnswer,
} = require('../src/blueprint-rest-plan-compiler');

const OPENAPI_TAG = 'ChatGPT Sidecar';
const CREATOR_ROLE = 'chatgpt-sidecar-creator';
const MAX_BROWSER_QUERY_LENGTH = 2000;

function buildPositiveFollowUps(kind, details = {}) {
  const followUps = {
    capability_not_granted: [
      {
        missing: details.capability || 'requested capability',
        enablesDossierAddition:
          'An authenticated Cernion-side creator can provision a new scoped session that includes this capability.',
      },
      {
        missing: 'safe browser query within the current capability profile',
        enablesDossierAddition:
          'Retry with one of the manifest-listed capability ids to stay inside this ticket scope.',
      },
    ],
    expired_or_revoked_ticket: [
      {
        missing: 'active ChatGPT Sidecar session ticket',
        enablesDossierAddition:
          'Ask an authenticated Cernion-side creator to generate a fresh scoped session URL.',
      },
    ],
    unsupported_browser_query: [
      {
        missing: 'shorter GET question or task',
        enablesDossierAddition:
          `Retry with a URL-encoded question/task up to ${MAX_BROWSER_QUERY_LENGTH} characters using the manifest template.`,
      },
    ],
  };
  return followUps[kind] || [];
}

function buildPolicyBlockedResponse({ reason, capability, action }) {
  return {
    success: false,
    error: 'sidecar_policy_blocked',
    reason,
    capability,
    action,
    notAvailable: ['write_or_consequential_action', 'ungranted_capability'],
    positiveFollowUps: buildPositiveFollowUps(reason, { capability }),
  };
}

function getAuthenticatedUserId(ctx) {
  return ctx?.meta?.apiToken?.userId || ctx?.meta?.authUser?.userId || null;
}

function getAuthTokenScope(ctx) {
  return ctx?.meta?.apiToken?.scope || (ctx?.meta?.authSession ? 'session' : null);
}

function buildManifestUrl(baseUrl, ticket) {
  const prefix = baseUrl ? String(baseUrl).replace(/\/+$/, '') : '';
  return `${prefix}/api/chatgpt-sidecar/s/${ticket}/manifest`;
}

function shortHash(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

function generateDraftDatapointName(sessionId) {
  const suffix = crypto.randomBytes(6).toString('hex');
  const shortSession = String(sessionId)
    .replace(/[^a-z0-9]/gi, '')
    .slice(-8)
    .toLowerCase();
  return `cgs-draft-${shortSession}-${suffix}`;
}

function parseOptionalObject(value, fallback = {}) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeBrowserText(value, fieldName) {
  const normalized = String(value || '').trim();
  if (normalized.length > MAX_BROWSER_QUERY_LENGTH) {
    throw new MoleculerClientError(
      `${fieldName} is too long for the browser-compatible ChatGPT Sidecar GET facade.`,
      400,
      'CHATGPT_SIDECAR_BROWSER_QUERY_TOO_LONG',
      { positiveFollowUps: buildPositiveFollowUps('unsupported_browser_query') }
    );
  }
  return normalized;
}

async function handleAsk(ctx, { browserFacade = false } = {}) {
  const session = resolveActiveSessionOrFail(ctx.params.ticket);
  const rawQuestion = ctx.params.question || ctx.params.query || ctx.params.q;
  const question = browserFacade ? normalizeBrowserText(rawQuestion, 'query') : rawQuestion;
  if (!question) {
    throw new MoleculerClientError(
      'question is required.',
      400,
      'CHATGPT_SIDECAR_QUESTION_REQUIRED'
    );
  }

  const capability = ctx.params.capability || null;
  if (capability && !session.capabilityProfile.includes(capability)) {
    defaultStore.recordMeteringEvent(session.sessionId, 'blocked_policy_attempt', {
      capability,
      action: browserFacade ? 'browser_ask' : 'ask',
    });
    return buildPolicyBlockedResponse({
      reason: 'capability_not_granted',
      capability,
      action: browserFacade ? 'browser_ask' : 'ask',
    });
  }

  defaultStore.recordMeteringEvent(session.sessionId, 'ask_call', {
    capability,
    transport: browserFacade ? 'browser_get' : 'post',
  });

  const context = parseOptionalObject(ctx.params.context);
  const inputs = parseOptionalObject(ctx.params.inputs);
  const ontologyEnabled = session.capabilityProfile.includes('ontology-guardrail');
  const ontology = resolveOntologyContext({ ontologyEnabled, capability });
  if (ontologyEnabled) {
    defaultStore.recordMeteringEvent(session.sessionId, 'ontology_guardrail_used', {
      capability,
      supported: ontology?.supported || false,
    });
  }

  const restPlan = compileReadOnlyExecutionPlan({
    question,
    context: { ...context, ...inputs, tenantId: session.tenantId },
    broker: ctx.broker,
  });

  if (restPlan.ok) {
    const answer = buildAskBlueprintAnswer(restPlan, { question, sessionId: null });
    return { ...answer, ontology };
  }

  const result = await ctx.call('personal-agent.askCernionAgent', {
    question,
    sessionId: null,
    context: { ...context, tenantId: session.tenantId },
    inputs,
    domain: 'auto',
    mode: 'answer',
    maxEvidence: 5,
  });

  return { ...result, ontology };
}

async function handlePlan(ctx, { browserFacade = false } = {}) {
  const session = resolveActiveSessionOrFail(ctx.params.ticket);
  const task = browserFacade
    ? normalizeBrowserText(ctx.params.task || ctx.params.q, 'task')
    : ctx.params.task;
  if (!task || task.length < 3) {
    throw new MoleculerClientError('task is required.', 400, 'CHATGPT_SIDECAR_TASK_REQUIRED');
  }

  const capability = ctx.params.capability || null;
  if (capability && !session.capabilityProfile.includes(capability)) {
    defaultStore.recordMeteringEvent(session.sessionId, 'blocked_policy_attempt', {
      capability,
      action: browserFacade ? 'browser_plan' : 'plan',
    });
    return buildPolicyBlockedResponse({
      reason: 'capability_not_granted',
      capability,
      action: browserFacade ? 'browser_plan' : 'plan',
    });
  }

  defaultStore.recordMeteringEvent(session.sessionId, 'plan_call', {
    capability,
    transport: browserFacade ? 'browser_get' : 'post',
  });

  const context = parseOptionalObject(ctx.params.context);
  const ontologyEnabled = session.capabilityProfile.includes('ontology-guardrail');
  const ontology = resolveOntologyContext({ ontologyEnabled, capability });
  if (ontologyEnabled) {
    defaultStore.recordMeteringEvent(session.sessionId, 'ontology_guardrail_used', {
      capability,
      supported: ontology?.supported || false,
    });
  }

  const recommendation = await ctx.call('capability-broker.recommend', {
    mode: 'initial',
    task,
    knownContext: { ...context, tenantId: session.tenantId },
  });

  const restPlan = compileReadOnlyExecutionPlan({
    question: task,
    context: { ...context, tenantId: session.tenantId },
    broker: ctx.broker,
  });

  return {
    success: true,
    recommendation,
    restPlan: restPlan.ok
      ? { resolved: restPlan.resolved, recommendedEndpoints: restPlan.recommendedEndpoints }
      : { ok: false, reason: restPlan.reason },
    ontology,
    writeScope: session.writeScope,
  };
}

// Fails closed: requires a real authenticated tenant, a non-read-only token
// scope, and the explicit `chatgpt-sidecar-creator` role/scope — an operator
// must grant that role deliberately (e.g. custom API-token scope or IdP group
// mapping); it is never implied by `full-access` alone, unlike the existing
// `hitl-approver` transition role.
function assertCreatorAllowed(ctx) {
  const tenantId = getAuthenticatedTenant(ctx);
  if (!tenantId) {
    throw new MoleculerClientError(
      'Authentication required to create or revoke a ChatGPT Sidecar session.',
      401,
      'AUTH_REQUIRED'
    );
  }

  const scope = getAuthTokenScope(ctx);
  if (scope === 'read-only') {
    throw new MoleculerClientError(
      'A read-only token cannot create or revoke a ChatGPT Sidecar session.',
      403,
      'CHATGPT_SIDECAR_CREATE_FORBIDDEN'
    );
  }

  const roles = ctx?.meta?.authUser?.roles || [];
  if (!hasRole(roles, CREATOR_ROLE)) {
    throw new MoleculerClientError(
      `Role required: ${CREATOR_ROLE}.`,
      403,
      'CHATGPT_SIDECAR_CREATE_FORBIDDEN'
    );
  }

  return { tenantId, userId: getAuthenticatedUserId(ctx) };
}

// Unknown and revoked tickets return the identical hard failure (404) so a
// caller cannot use response shape to confirm a ticket ever existed. Expiry
// is a distinguishable, expected lifecycle event and returns 410 with a
// regenerate-session instruction, per the issue's acceptance criteria.
function resolveActiveSessionOrFail(ticket) {
  const resolution = defaultStore.resolveByTicket(ticket);
  if (resolution.status === 'not_found') {
    throw new MoleculerClientError(
      'Unknown or revoked ChatGPT Sidecar session ticket.',
      404,
      'CHATGPT_SIDECAR_TICKET_NOT_FOUND'
    );
  }
  if (resolution.status === 'expired') {
    throw new MoleculerClientError(
      'This ChatGPT Sidecar session has expired. Ask the user to generate a new session/prompt.',
      410,
      'CHATGPT_SIDECAR_SESSION_EXPIRED'
    );
  }
  return resolution.session;
}

module.exports = {
  name: 'chatgpt-sidecar',

  actions: {
    createSession: {
      rest: 'POST /sessions',
      params: {
        ttl: { type: 'string', optional: true, default: DEFAULT_TTL },
        capabilityProfile: { type: 'array', optional: true, default: [] },
        writeScope: { type: 'string', optional: true, default: DEFAULT_WRITE_SCOPE },
        origin: { type: 'string', optional: true, default: 'chatgpt_prompt_generator' },
        metadata: { type: 'object', optional: true, default: {} },
        baseUrl: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Create a ChatGPT Sidecar session ticket with scoped capabilities',
        description:
          'Requires an authenticated Cernion tenant/user with the chatgpt-sidecar-creator ' +
          'role. Returns an opaque ticket URL and backend-generated prompt text; the ' +
          'response never echoes the session id/prompt back through the ticket endpoints.',
      },
      async handler(ctx) {
        const { tenantId, userId } = assertCreatorAllowed(ctx);

        if (!isValidTtl(ctx.params.ttl)) {
          throw new MoleculerClientError(
            `Invalid ttl. Allowed values: ${Object.keys(TTL_OPTIONS).join(', ')}.`,
            400,
            'CHATGPT_SIDECAR_INVALID_TTL'
          );
        }

        const capabilityProfile = normalizeCapabilityProfile(ctx.params.capabilityProfile);
        const writeScope = resolveWriteScope(ctx.params.writeScope);

        const created = defaultStore.createSession({
          tenantId,
          userId,
          ttl: ctx.params.ttl,
          capabilityProfile,
          writeScope,
          origin: ctx.params.origin,
          metadata: ctx.params.metadata,
          baseUrl: ctx.params.baseUrl,
        });

        if (!created.ok) {
          throw new MoleculerClientError(
            'Unable to create ChatGPT Sidecar session.',
            400,
            'CHATGPT_SIDECAR_SESSION_CREATE_FAILED'
          );
        }

        const { session } = created;
        defaultStore.recordMeteringEvent(session.sessionId, 'session_created', {
          ttl: session.ttl,
        });

        const manifestUrl = buildManifestUrl(session.baseUrl, session.ticket);
        const promptText = buildPromptText({
          manifestUrl,
          expiresAt: session.expiresAt,
          capabilityProfile: session.capabilityProfile,
          writeScope: session.writeScope,
          ontologyEnabled: session.capabilityProfile.includes('ontology-guardrail'),
        });

        return {
          success: true,
          sessionId: session.sessionId,
          ticketUrl: manifestUrl,
          expiresAt: session.expiresAt,
          promptText,
          capabilities: session.capabilityProfile,
          writeScope: session.writeScope,
        };
      },
    },

    revokeSession: {
      rest: 'DELETE /sessions/:sessionId',
      params: { sessionId: { type: 'string', min: 1 } },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Revoke a ChatGPT Sidecar session (authenticated Cernion side only)',
      },
      handler(ctx) {
        const { tenantId } = assertCreatorAllowed(ctx);
        const result = defaultStore.revoke(ctx.params.sessionId, { tenantId });
        if (!result.ok) {
          throw new MoleculerClientError(
            'Session not found.',
            404,
            'CHATGPT_SIDECAR_SESSION_NOT_FOUND'
          );
        }
        defaultStore.recordMeteringEvent(result.session.sessionId, 'session_revoked', {});
        return {
          success: true,
          sessionId: result.session.sessionId,
          revokedAt: result.session.revokedAt,
        };
      },
    },

    manifest: {
      rest: 'GET /s/:ticket/manifest',
      params: { ticket: { type: 'string', min: 1 } },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Read the session-scoped capability manifest (allowlist only)',
        parameters: [
          {
            name: 'ticket',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Opaque ChatGPT Sidecar session ticket.',
          },
        ],
      },
      handler(ctx) {
        const session = resolveActiveSessionOrFail(ctx.params.ticket);
        defaultStore.recordMeteringEvent(session.sessionId, 'manifest_read', {});
        const redacted = redactSessionForClient(session);
        return {
          success: true,
          schemaVersion: 'cernion.chatgpt-sidecar.v1',
          ...redacted,
          endpoints: {
            manifest: `GET /api/chatgpt-sidecar/s/${session.ticket}/manifest`,
            ask: `POST /api/chatgpt-sidecar/s/${session.ticket}/ask`,
            browserAsk: `GET /api/chatgpt-sidecar/s/${session.ticket}/ask?query={urlencoded_question}&capability={optional_capability}`,
            plan: `POST /api/chatgpt-sidecar/s/${session.ticket}/plan`,
            browserPlan: `GET /api/chatgpt-sidecar/s/${session.ticket}/plan?task={urlencoded_task}&capability={optional_capability}`,
            datapoints: `POST /api/chatgpt-sidecar/s/${session.ticket}/datapoints`,
            metering: `GET /api/chatgpt-sidecar/s/${session.ticket}/metering`,
          },
          browserFacade: {
            safety: 'read_only_non_consequential',
            maxQueryLength: MAX_BROWSER_QUERY_LENGTH,
            positiveFollowUps: {
              expiredOrRevokedTicket: buildPositiveFollowUps('expired_or_revoked_ticket'),
              unsupportedBrowserQuery: buildPositiveFollowUps('unsupported_browser_query'),
            },
            unavailableOperations: [
              'datapoint_write_via_get',
              'hitl_or_workflow_creation',
              'mail_or_webhook',
              'mako_billing_settlement_tariff',
              'smgw_cls_device_control_dispatch',
              'external_connector_call',
              'public_context_or_production_mutation',
            ],
          },
        };
      },
    },

    ask: {
      rest: 'POST /s/:ticket/ask',
      params: {
        ticket: { type: 'string', min: 1 },
        question: { type: 'string', optional: true },
        query: { type: 'string', optional: true },
        context: { type: 'object', optional: true, default: {} },
        inputs: { type: 'object', optional: true, default: {} },
        capability: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Ask Cernion through the session-scoped evidence/capability facade',
      },
      async handler(ctx) {
        return handleAsk(ctx);
      },
    },

    browserAsk: {
      rest: 'GET /s/:ticket/ask',
      params: {
        ticket: { type: 'string', min: 1 },
        question: { type: 'string', optional: true },
        query: { type: 'string', optional: true },
        q: { type: 'string', optional: true },
        context: { type: 'any', optional: true },
        inputs: { type: 'any', optional: true },
        capability: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Ask Cernion through a browser-compatible read-only GET facade',
        description:
          'For prompt-only ChatGPT.com usage where only URL reads are available. This ' +
          'facade is read-only and delegates to the same session policy as POST ask.',
      },
      async handler(ctx) {
        return handleAsk(ctx, { browserFacade: true });
      },
    },

    plan: {
      rest: 'POST /s/:ticket/plan',
      params: {
        ticket: { type: 'string', min: 1 },
        task: { type: 'string', min: 3 },
        context: { type: 'object', optional: true, default: {} },
        capability: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Resolve a request to a Blueprint/Capability Broker route (no execution)',
      },
      async handler(ctx) {
        return handlePlan(ctx);
      },
    },

    browserPlan: {
      rest: 'GET /s/:ticket/plan',
      params: {
        ticket: { type: 'string', min: 1 },
        task: { type: 'string', optional: true },
        q: { type: 'string', optional: true },
        context: { type: 'any', optional: true },
        capability: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Resolve a request through a browser-compatible read-only GET facade',
        description:
          'For prompt-only ChatGPT.com usage where only URL reads are available. This ' +
          'facade is read-only and delegates to the same session policy as POST plan.',
      },
      async handler(ctx) {
        return handlePlan(ctx, { browserFacade: true });
      },
    },

    datapoints: {
      rest: 'POST /s/:ticket/datapoints',
      params: {
        ticket: { type: 'string', min: 1 },
        capability: { type: 'string', optional: true, default: 'draft-datapoints' },
        writeClass: { type: 'string', optional: true, default: DEFAULT_WRITE_SCOPE },
        value: { type: 'any' },
        description: { type: 'string', optional: true, default: '' },
        message: { type: 'string', optional: true },
      },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Create a draft datapoint through the session (draft_write only)',
        description:
          'Only draft_write mutates in this slice. controlled_write, process_execute and ' +
          'requires_confirmation return a policy decision without creating anything.',
      },
      async handler(ctx) {
        const session = resolveActiveSessionOrFail(ctx.params.ticket);
        const capability = ctx.params.capability || 'draft-datapoints';

        const decision = evaluateWriteRequest({
          requestedWriteClass: ctx.params.writeClass,
          session,
          capability,
        });

        if (decision.decision !== 'allowed') {
          defaultStore.recordMeteringEvent(session.sessionId, 'blocked_policy_attempt', {
            action: 'datapoints',
            writeClass: decision.writeClass,
            reason: decision.reason,
          });
          return {
            success: false,
            error: 'sidecar_policy_blocked',
            decision: decision.decision,
            reason: decision.reason,
            writeClass: decision.writeClass,
          };
        }

        const now = new Date().toISOString();
        const promptHash = shortHash(ctx.params.message);
        const name = generateDraftDatapointName(session.sessionId);

        await ctx.call('datapoint.create', {
          name,
          value: ctx.params.value,
          description: ctx.params.description,
          owner: 'chatgpt-sidecar',
          tags: ['chatgpt-sidecar', 'draft'],
          oeoTags: [],
          provenance: 'chatgpt_sidecar',
          metadata: {
            origin: 'chatgpt_sidecar',
            sessionId: session.sessionId,
            tenantId: session.tenantId,
            userId: session.userId,
            capability,
            promptHash,
            timestamp: now,
            policyResult: decision.decision,
          },
        });

        defaultStore.recordMeteringEvent(session.sessionId, 'draft_datapoint_created', {
          capability,
        });

        return {
          success: true,
          datapointName: name,
          capability,
          writeScope: 'draft_write',
          createdAt: now,
          policyResult: decision.decision,
        };
      },
    },

    metering: {
      rest: 'GET /s/:ticket/metering',
      params: { ticket: { type: 'string', min: 1 } },
      openapi: {
        tags: [OPENAPI_TAG],
        summary: 'Read a redacted metering summary for the session',
        parameters: [
          {
            name: 'ticket',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Opaque ChatGPT Sidecar session ticket.',
          },
        ],
      },
      handler(ctx) {
        const session = resolveActiveSessionOrFail(ctx.params.ticket);
        const summary = defaultStore.getMeteringSummary(session.sessionId);
        return { success: true, ...summary };
      },
    },
  },
};
