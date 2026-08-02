'use strict';

/**
 * MCP Server meta-tools (v0.99.2)
 *
 * Nine layer-based meta-tools that expose the ~1,100+ REST operations of
 * this platform to MCP clients without a 1:1 tool-per-endpoint mapping (see
 * docs/mcp-server.md for the full design). This service is the thin
 * protocol-facing layer: each action orchestrates existing services
 * (`agent-manifest`, `personal-agent`, `evidence-router`, `copilot-process`,
 * `job-status`, `agent-receipts`, `cookbook`, `hitl`, `agent-sidecar`,
 * `tenant-quota`) plus `src/blueprint-registry.js` directly (a plain module,
 * not a service — see the `blueprint` branches in `search`/`describe` for
 * why it's used instead of `blueprint-management`) rather than
 * reimplementing them.
 *
 * These actions are dispatched two ways:
 *  - by `src/mcp-transport.js`, which speaks the real MCP JSON-RPC protocol
 *    over the `/api/mcp` streamable-HTTP endpoint (see that module for how
 *    `ctx.meta.mcpBearerToken` / `ctx.meta.authUser` / `ctx.meta.tenantId`
 *    get populated from the session's bearer token);
 *  - directly over REST via each action's own `rest:` alias (autoAliases on
 *    the `/api` route), for debugging and for callers that don't speak MCP.
 *    In that path `ctx.meta` is populated the same way onBeforeCall does it
 *    for every other endpoint (see services/api.service.js).
 *
 * IMPORTANT — read before extending: `executeRead` and `runReceipt` (mode:
 * "run") are the two write/consequential-adjacent surfaces here; they are
 * deliberately conservative (see their handlers' comments) rather than
 * attempting a generic "execute anything" dispatcher.
 */

const axios = require('axios');
const { MoleculerClientError } = require('moleculer').Errors;
const { buildRef, parseRef } = require('../src/mcp-uri');
const { checkExecuteReadPolicy } = require('../src/mcp-execute-read-policy');
const { assertFullAccessForWrite } = require('../src/mcp-rbac-gate');
const { RESERVED_FAMILIES, resolveIntentId } = require('../src/mcp-reserved-families');
const { loadBlueprint, listBlueprints } = require('../src/blueprint-registry');

const SEARCH_KINDS = ['capability', 'operation', 'receipt', 'blueprint', 'recipe'];
const DESCRIBE_KINDS = ['capability', 'operation', 'receipt', 'blueprint', 'recipe'];
const PROCESS_STATUS_KINDS = ['intent', 'job', 'hitl'];
const OPENAPI_TAG = 'MCP Server';

function textIncludes(haystackParts, needle) {
  const q = String(needle || '')
    .toLowerCase()
    .trim();
  if (!q) return true;
  return haystackParts
    .filter(Boolean)
    .map((p) => String(p).toLowerCase())
    .some((p) => p.includes(q));
}

function resolveKindAndId(ctx, allowedKinds) {
  const fromRef = parseRef(ctx.params.ref);
  const kind = fromRef?.kind || ctx.params.kind;
  const id = fromRef?.id || ctx.params.id;
  if (!kind || !allowedKinds.includes(kind)) {
    throw new MoleculerClientError(
      `Unsupported or missing kind (expected one of: ${allowedKinds.join(', ')})`,
      422,
      'MCP_UNSUPPORTED_KIND',
      { kind, allowedKinds }
    );
  }
  if (!id) {
    throw new MoleculerClientError('Missing id (or a fully-qualified ref)', 422, 'MCP_MISSING_ID', {
      kind,
    });
  }
  return { kind, id };
}

module.exports = {
  name: 'mcp-server',

  actions: {
    // ── Layer 1: Ask ────────────────────────────────────────────────────
    ask: {
      rest: 'POST /ask',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_ask' },
      params: {
        question: { type: 'string', min: 1, max: 8000 },
        context: { type: 'object', optional: true },
        sessionId: { type: 'string', optional: true },
        domain: { type: 'string', optional: true },
        mode: { type: 'string', optional: true },
        format: {
          type: 'enum',
          values: ['compact', 'dossier'],
          optional: true,
          default: 'compact',
        },
        maxEvidence: { type: 'number', optional: true, convert: true, min: 1, max: 12 },
        parentDossierId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        // The REST equivalents (POST /api/copilot/ask-cernion-agent,
        // /answer-dossier) require the full-access role — see
        // src/mcp-rbac-gate.js for why this must be enforced here too.
        assertFullAccessForWrite(ctx.meta);
        const { question, context, sessionId, domain, maxEvidence, parentDossierId } = ctx.params;
        if (ctx.params.format === 'dossier') {
          const result = await ctx.call('personal-agent.answerDossier', {
            question,
            sessionId,
            domain,
            context,
            maxEvidence,
            parentDossierId,
            mode: parentDossierId ? 'answer_dossier_followup' : 'answer_dossier',
          });
          return { success: true, resolved: { tool: 'cernion_ask', format: 'dossier' }, ...result };
        }
        const result = await ctx.call('personal-agent.askCernionAgent', {
          question,
          sessionId,
          context,
          domain,
          mode: ctx.params.mode,
          maxEvidence,
        });
        return { success: true, resolved: { tool: 'cernion_ask', format: 'compact' }, ...result };
      },
    },

    // ── Layer 2: Discover & understand ─────────────────────────────────
    search: {
      rest: 'POST /search',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_search' },
      params: {
        query: { type: 'string', min: 1, max: 500 },
        kind: { type: 'enum', values: SEARCH_KINDS, optional: true },
        domain: { type: 'string', optional: true },
        limit: { type: 'number', optional: true, convert: true, min: 1, max: 50, default: 10 },
      },
      async handler(ctx) {
        const { query, domain, limit } = ctx.params;
        const kinds = ctx.params.kind ? [ctx.params.kind] : SEARCH_KINDS;
        const perKindLimit = Math.max(limit, 5);

        const searchers = {
          capability: async () => {
            const res = await ctx.call('agent-manifest.listCapabilities', { domain });
            return (res.data || [])
              .filter((c) =>
                textIncludes([c.capability, c.intent, c.domain, ...(c.keywords || [])], query)
              )
              .slice(0, perKindLimit)
              .map((c) => ({
                ref: buildRef('capability', c.capability),
                kind: 'capability',
                title: c.capability,
                summary: c.intent || '',
                riskClass: 'read',
              }));
          },
          operation: async () => {
            const res = await ctx.call('agent-manifest.listOperations', { domain });
            return (res.data || [])
              .filter((op) =>
                textIncludes([op.operationId, op.path, op.summary, ...(op.tags || [])], query)
              )
              .slice(0, perKindLimit)
              .map((op) => ({
                ref: buildRef('operation', op.operationId || `${op.method} ${op.path}`),
                kind: 'operation',
                title: op.operationId || `${op.method} ${op.path}`,
                summary: op.summary || `${op.method} ${op.path}`,
                riskClass: checkExecuteReadPolicy(op.method, op.path).allowed ? 'read' : 'write',
              }));
          },
          receipt: async () => {
            const res = await ctx.call('agent-receipts.list', { domain, limit: 200 });
            return (res.data || [])
              .filter((r) =>
                textIncludes([r.receiptId, r.title, r.description, ...(r.tags || [])], query)
              )
              .slice(0, perKindLimit)
              .map((r) => ({
                ref: buildRef('receipt', r.receiptId),
                kind: 'receipt',
                title: r.title,
                summary: r.description || '',
                riskClass: 'write',
              }));
          },
          blueprint: async () => {
            // src/blueprint-registry.js, not blueprint-management.list — it's
            // the unified view cernion_ask's own L3 broker consults (static
            // repo blueprints merged with governance-promoted ones via
            // setRuntimeBlueprint), not just the draft/active subset tracked
            // in blueprint-management's PouchDB. A real gap this closes:
            // built-in blueprints (e.g. ev-charging-co2-optimization-v1) were
            // invisible to cernion_search/describe before this, even though
            // askCernionAgent could already route to them internally —
            // confirmed against a real user report where an MCP client found
            // the blueprint mentioned by name in an ask response but
            // cernion_describe couldn't resolve it. Draft (not-yet-promoted)
            // blueprints are intentionally out of scope here — those are
            // governance-workflow-internal, not yet part of live routing.
            return listBlueprints()
              .filter((b) => textIncludes([b.id, b.title, b.description], query))
              .slice(0, perKindLimit)
              .map((b) => ({
                ref: buildRef('blueprint', b.id),
                kind: 'blueprint',
                title: b.title || b.id,
                summary: b.description || '',
                riskClass: 'write',
              }));
          },
          recipe: async () => {
            const res = await ctx.call('cookbook.search', {
              query: query.length >= 5 ? query : query.padEnd(5, ' '),
              limit: perKindLimit,
            });
            return (res.data || []).map((r) => ({
              ref: buildRef('recipe', r.id),
              kind: 'recipe',
              title: r.title || r.id,
              summary: r.description || r.summary || '',
              riskClass: 'read',
            }));
          },
        };

        const settled = await Promise.allSettled(kinds.map((k) => searchers[k]()));
        const results = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
        const errors = settled
          .map((s, i) =>
            s.status === 'rejected' ? { kind: kinds[i], message: s.reason?.message } : null
          )
          .filter(Boolean);

        return {
          success: true,
          query,
          kinds,
          count: Math.min(results.length, limit),
          results: results.slice(0, limit),
          ...(errors.length ? { partialErrors: errors } : {}),
        };
      },
    },

    describe: {
      rest: 'POST /describe',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_describe' },
      params: {
        ref: { type: 'string', optional: true },
        kind: { type: 'enum', values: DESCRIBE_KINDS, optional: true },
        id: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const { kind, id } = resolveKindAndId(ctx, DESCRIBE_KINDS);

        if (kind === 'capability') {
          const res = await ctx.call('agent-manifest.getCapability', { name: id });
          return { success: true, ref: buildRef(kind, id), kind, data: res.data };
        }

        if (kind === 'operation') {
          const res = await ctx.call('agent-manifest.listOperations', {});
          const op = (res.data || []).find((row) => row.operationId === id);
          if (!op) {
            throw new MoleculerClientError(
              `Operation not found: ${id}`,
              404,
              'MCP_OPERATION_NOT_FOUND',
              {
                id,
              }
            );
          }
          return {
            success: true,
            ref: buildRef(kind, id),
            kind,
            data: { ...op, executeReadPolicy: checkExecuteReadPolicy(op.method, op.path) },
          };
        }

        if (kind === 'receipt') {
          const receipt = await ctx.call('agent-receipts.get', { id });
          let explanation = null;
          try {
            explanation = await ctx.call('agent-receipts.explainStored', { id });
          } catch (err) {
            explanation = { success: false, error: err.message };
          }
          return {
            success: true,
            ref: buildRef(kind, id),
            kind,
            data: { receipt: receipt.data, explanation: explanation.data || explanation },
          };
        }

        if (kind === 'blueprint') {
          // src/blueprint-registry.js — see the matching comment in `search`
          // above for why (not blueprint-management.get, which only sees
          // draft/promoted governance-workflow blueprints, not built-in ones).
          const blueprint = loadBlueprint(id);
          if (!blueprint) {
            throw new MoleculerClientError(
              `Blueprint not found: ${id}`,
              404,
              'MCP_BLUEPRINT_NOT_FOUND',
              {
                id,
              }
            );
          }
          return { success: true, ref: buildRef(kind, id), kind, data: blueprint };
        }

        // kind === 'recipe'
        const res = await ctx.call('cookbook.get', { id });
        return { success: true, ref: buildRef(kind, id), kind, data: res.data };
      },
    },

    // ── Layer 3: Read ───────────────────────────────────────────────────
    executeRead: {
      rest: 'POST /execute-read',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_execute_read' },
      params: {
        ref: { type: 'string', optional: true },
        operationId: { type: 'string', optional: true },
        method: { type: 'string', optional: true },
        path: { type: 'string', optional: true },
        pathParams: { type: 'object', optional: true, default: {} },
        query: { type: 'object', optional: true, default: {} },
        body: { type: 'object', optional: true },
      },
      async handler(ctx) {
        let method = ctx.params.method;
        let path = ctx.params.path;

        if (!method || !path) {
          const opRef = parseRef(ctx.params.ref);
          const operationId = opRef?.id || ctx.params.operationId;
          if (!operationId) {
            throw new MoleculerClientError(
              'execute_read requires either (ref or operationId) or (method and path)',
              422,
              'MCP_MISSING_OPERATION'
            );
          }
          const res = await ctx.call('agent-manifest.listOperations', {});
          const op = (res.data || []).find((row) => row.operationId === operationId);
          if (!op) {
            throw new MoleculerClientError(
              `Operation not found: ${operationId}`,
              404,
              'MCP_OPERATION_NOT_FOUND',
              { operationId }
            );
          }
          method = op.method;
          path = op.path;
        }

        const policy = checkExecuteReadPolicy(method, path);
        if (!policy.allowed) {
          throw new MoleculerClientError(
            `execute_read refused: ${method} ${path} is not on the read-only allowlist (${policy.reason})`,
            403,
            'MCP_EXECUTE_READ_FORBIDDEN',
            { method, path, reason: policy.reason }
          );
        }

        let resolvedPath = String(path).replace(/\/api/, '');
        for (const [name, value] of Object.entries(ctx.params.pathParams || {})) {
          resolvedPath = resolvedPath.replace(`:${name}`, encodeURIComponent(String(value)));
        }
        if (/:[a-zA-Z_]+/.test(resolvedPath)) {
          throw new MoleculerClientError(
            `Unresolved path parameter(s) in ${resolvedPath} — supply them via pathParams`,
            422,
            'MCP_UNRESOLVED_PATH_PARAM'
          );
        }

        const bearerToken = ctx.meta?.mcpBearerToken;
        if (!bearerToken) {
          throw new MoleculerClientError(
            'execute_read requires an authenticated MCP session bearer token',
            401,
            'MCP_NO_BEARER_TOKEN'
          );
        }

        const port = process.env.PORT || 3000;
        const url = `http://127.0.0.1:${port}/api${resolvedPath}`;

        try {
          const response = await axios({
            method: method.toLowerCase(),
            url,
            params: ctx.params.query,
            data: method.toUpperCase() === 'POST' ? ctx.params.body : undefined,
            headers: { Authorization: `Bearer ${bearerToken}` },
            timeout: 10000,
            validateStatus: () => true,
          });

          const result = {
            success: response.status >= 200 && response.status < 300,
            resolvedRequest: { method: method.toUpperCase(), path: resolvedPath },
            status: response.status,
            data: response.data,
          };
          if (response.data && typeof response.data === 'object' && response.data.jobId) {
            result.jobRef = buildRef('job', response.data.jobId);
          }
          return result;
        } catch (err) {
          throw new MoleculerClientError(
            `execute_read upstream call failed: ${err.message}`,
            502,
            'MCP_EXECUTE_READ_UPSTREAM_ERROR',
            { method, path: resolvedPath }
          );
        }
      },
    },

    // ── Layer 3b: Curated receipts (plan always; run creates an intent) ──
    runReceipt: {
      rest: 'POST /run-receipt',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_run_receipt' },
      params: {
        id: { type: 'string', optional: true },
        receipt: { type: 'object', optional: true },
        context: { type: 'object', optional: true, default: {} },
        input: { type: 'object', optional: true, default: {} },
        mode: { type: 'enum', values: ['plan', 'run'], optional: true, default: 'plan' },
      },
      async handler(ctx) {
        if (!ctx.params.id && !ctx.params.receipt) {
          throw new MoleculerClientError(
            'run_receipt requires either id (stored receipt) or receipt (inline definition)',
            422,
            'MCP_MISSING_RECEIPT'
          );
        }

        const testResult = await ctx.call('agent-receipts.test', {
          id: ctx.params.id,
          receipt: ctx.params.receipt,
          context: ctx.params.context,
          input: ctx.params.input,
        });
        const plan = testResult.data;

        if (ctx.params.mode === 'plan' || !plan.executable) {
          return {
            success: true,
            mode: 'plan',
            ref: plan.receiptId ? buildRef('receipt', plan.receiptId) : null,
            plan,
            ...(ctx.params.mode === 'run' && !plan.executable
              ? {
                  note: 'Not executable yet — see missingRequiredInputs/errors. Returning plan only.',
                }
              : {}),
          };
        }

        // mode: 'run' and executable — no direct auto-execution path exists
        // for arbitrary receipts server-side (see docs/mcp-server.md), so we
        // route through the same intent mechanism cernion_prepare_process
        // uses rather than inventing an unreviewed execution path.
        assertFullAccessForWrite(ctx.meta);
        const intentResult = await ctx.call('copilot-process.prepareProcessIntent', {
          operationFamily: 'agent-receipt',
          proposedAction: `run_receipt:${plan.receiptId}`,
          targetType: 'agentReceipt',
          targetId: plan.receiptId,
          inputSummary: `Run receipt ${plan.receiptId} (${plan.plan.steps.length} planned step(s))`,
          payload: {
            receiptId: plan.receiptId,
            context: ctx.params.context,
            input: ctx.params.input,
            plan,
          },
          risk: 'medium',
          reason: 'cernion_run_receipt mode=run',
        });

        return {
          success: true,
          mode: 'run',
          plan,
          intent: intentResult.receipt,
          executeVia: intentResult.executeVia,
          note:
            'Receipts have no direct auto-execution path — a confirmation intent was created instead. ' +
            'Use cernion_execute_process with the returned intent ref after human confirmation.',
        };
      },
    },

    // ── Layer 4: Write (two-phase, single path) ────────────────────────
    prepareProcess: {
      rest: 'POST /prepare-process',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_prepare_process' },
      params: {
        operationFamily: { type: 'string', min: 1, max: 64 },
        proposedAction: { type: 'string', min: 1, max: 200 },
        targetType: { type: 'string', optional: true },
        targetId: { type: 'string', optional: true },
        inputSummary: { type: 'string', optional: true, max: 500 },
        payload: { type: 'object', optional: true, default: {} },
        risk: {
          type: 'enum',
          values: ['low', 'medium', 'high'],
          optional: true,
          default: 'medium',
        },
        reason: { type: 'string', optional: true, max: 500 },
        correlationId: { type: 'string', optional: true },
        decisionFrameId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        assertFullAccessForWrite(ctx.meta);

        const reservedFamily = RESERVED_FAMILIES[ctx.params.operationFamily];
        if (reservedFamily) {
          if (!ctx.params.reason) {
            throw new MoleculerClientError(
              `reason is required for operationFamily "${ctx.params.operationFamily}"`,
              422,
              'MCP_MISSING_REASON'
            );
          }
          const familyParams = reservedFamily.buildParams(ctx.params.payload || {}, ctx.params);
          const result = await ctx.call(reservedFamily.action, familyParams);
          return { ...result, ref: buildRef('intent', resolveIntentId(result)) };
        }

        const result = await ctx.call('copilot-process.prepareProcessIntent', ctx.params);
        return { ...result, ref: buildRef('intent', result.receipt.intentId) };
      },
    },

    executeProcess: {
      rest: 'POST /execute-process',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_execute_process' },
      params: {
        ref: { type: 'string', optional: true },
        intentId: { type: 'string', optional: true },
        action: { type: 'enum', values: ['execute', 'reject'], optional: true, default: 'execute' },
        reason: { type: 'string', optional: true },
        executedBy: { type: 'string', optional: true },
        rejectedBy: { type: 'string', optional: true },
        correlationId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        assertFullAccessForWrite(ctx.meta);
        const refParsed = parseRef(ctx.params.ref);
        const intentId = refParsed?.id || ctx.params.intentId;
        if (!intentId) {
          throw new MoleculerClientError(
            'execute_process requires intentId (or a cernion://intent/{id} ref)',
            422,
            'MCP_MISSING_INTENT_ID'
          );
        }

        if (ctx.params.action === 'reject') {
          if (!ctx.params.reason) {
            throw new MoleculerClientError(
              'reject requires reason',
              422,
              'MCP_MISSING_REJECT_REASON'
            );
          }
          return ctx.call('copilot-process.rejectProcessIntent', {
            intentId,
            reason: ctx.params.reason,
            rejectedBy: ctx.params.rejectedBy,
          });
        }

        try {
          return await ctx.call('copilot-process.executeProcessIntent', {
            intentId,
            executedBy: ctx.params.executedBy,
            correlationId: ctx.params.correlationId,
          });
        } catch (err) {
          if (err.type === 'UNKNOWN_OPERATION_FAMILY') {
            throw new MoleculerClientError(
              `Intent ${intentId} belongs to a domain-agnostic operationFamily with no wired ` +
                'auto-execution — by design, generic process intents establish the intake/HITL ' +
                'boundary only and must be executed by a human outside this API. See docs/mcp-server.md.',
              409,
              'MCP_INTENT_REQUIRES_MANUAL_EXECUTION',
              { intentId }
            );
          }
          throw err;
        }
      },
    },

    // ── Layer 5: Status ─────────────────────────────────────────────────
    processStatus: {
      rest: 'POST /process-status',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_process_status' },
      params: {
        ref: { type: 'string', optional: true },
        kind: { type: 'enum', values: PROCESS_STATUS_KINDS, optional: true },
        id: { type: 'string', optional: true },
        list: { type: 'enum', values: ['open'], optional: true },
      },
      async handler(ctx) {
        if (ctx.params.list === 'open') {
          const [intents, hitlItems] = await Promise.allSettled([
            ctx.call('copilot-process.listProcessIntents', {
              status: 'pending_confirmation',
              limit: 50,
            }),
            ctx.call('hitl.list', { status: 'pending', limit: 50 }),
          ]);
          return {
            success: true,
            list: 'open',
            intents: intents.status === 'fulfilled' ? intents.value.intents : [],
            hitlItems: hitlItems.status === 'fulfilled' ? hitlItems.value.items : [],
            note: 'Async jobs are not bulk-listable — check individual cernion://job/{id} refs.',
          };
        }

        const { kind, id } = resolveKindAndId(ctx, PROCESS_STATUS_KINDS);

        if (kind === 'intent') {
          const data = await ctx.call('copilot-process.getProcessIntent', { intentId: id });
          return { success: true, ref: buildRef(kind, id), kind, data };
        }
        if (kind === 'job') {
          const data = await ctx.call('job-status.status', { jobId: id });
          return { success: true, ref: buildRef(kind, id), kind, data };
        }
        // kind === 'hitl'
        const data = await ctx.call('hitl.get', { id });
        return { success: true, ref: buildRef(kind, id), kind, data: data.item };
      },
    },

    // ── Layer 0: Context ────────────────────────────────────────────────
    getContext: {
      rest: 'POST /get-context',
      openapi: { tags: [OPENAPI_TAG], summary: 'MCP meta-tool: cernion_get_context' },
      params: {
        tenantId: { type: 'string', optional: true },
      },
      async handler(ctx) {
        const descriptor = await ctx.call('agent-sidecar.descriptor', {});
        const tenantId = ctx.params.tenantId || ctx.meta?.tenantId || null;

        let quotas = null;
        let quotasNote;
        if (tenantId) {
          try {
            const res = await ctx.call('tenant-quota.getQuotas', { id: tenantId });
            quotas = res.data;
          } catch (err) {
            quotasNote = `Quota lookup skipped: ${err.message}`;
          }
        } else {
          quotasNote =
            'No tenantId available on this session — pass one explicitly to include quotas.';
        }

        return {
          success: true,
          descriptor,
          tenantId,
          quotas,
          ...(quotasNote ? { quotasNote } : {}),
          persona: ctx.meta?.authUser || null,
        };
      },
    },
  },
};
