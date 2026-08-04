'use strict';

/**
 * The real MCP protocol endpoint (`POST/GET/DELETE /api/mcp`, JSON-RPC 2.0
 * over the streamable-HTTP transport). This is the only place in the repo
 * that speaks MCP wire protocol — everything it does is delegate to the
 * `mcp-server` Moleculer service's 9 actions (services/mcp-server.service.js)
 * for actual behavior.
 *
 * One MCP session = one `StreamableHTTPServerTransport` + one dedicated
 * `McpServer` whose 9 tool callbacks are closed over that session's resolved
 * auth (`src/mcp-auth.js`), captured once at session-initialize time. This
 * avoids re-verifying the bearer token on every tool call while still
 * gating writes correctly (src/mcp-rbac-gate.js runs inside the downstream
 * `mcp-server.*` actions using that captured `ctx.meta`).
 *
 * Registered as raw (non-aliased) handlers on the `/api` route in
 * services/api.service.js, the same pattern already used there for
 * `/metrics` and the datasource upload endpoints — raw handlers get the
 * native Node req/res and bypass `onBeforeCall`'s token resolution, which is
 * why auth is done here explicitly via `resolveMcpAuth` instead.
 */

const { randomUUID } = require('crypto');
const { z } = require('zod');
const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js');
const { resolveMcpAuth } = require('./mcp-auth');
const { version: packageVersion } = require('../package.json');

const SERVER_INFO = { name: 'cernion-energy-tools', version: packageVersion };
const MAX_BODY_BYTES = 10 * 1024 * 1024; // generous for tool-call payloads (e.g. receipt inputs)

const anyObject = () => z.record(z.string(), z.any()).optional();

// One entry per meta-tool from docs/mcp-server.md. `annotations` follow the
// convention already used by src/energy-sidecar-mcp-bridge.js's
// toMcpTool() (safetyClass/sideEffects-style hints), translated to the
// MCP-standard ToolAnnotations fields.
const TOOL_DEFS = [
  {
    name: 'cernion_ask',
    action: 'mcp-server.ask',
    title: 'Ask Cernion',
    description:
      'Open-ended factual/regulatory question (grid, market, process, compliance). CET routes ' +
      'internally and answers with evidence, guardrails, and process context — good for explanatory ' +
      'or document-grounded questions. NOT reliable yet for a specific structured data point tied to ' +
      'a known entity (e.g. "what is the gas storage fill level", "what is the BDEW/EIC code of ' +
      'company X", "what is the CO2 intensity forecast for postal code Y") — internal routing ' +
      'sometimes falls back to generic document search for these instead of the matching structured ' +
      'operation, even though one exists and works. For that shape of question, try cernion_search ' +
      '(kind=operation) + cernion_execute_read FIRST; fall back to cernion_ask only if no matching ' +
      'operation is found, or for genuinely open-ended/explanatory questions.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      question: z.string().min(1).max(8000),
      context: anyObject(),
      sessionId: z.string().optional(),
      domain: z.string().optional(),
      mode: z.string().optional(),
      format: z.enum(['compact', 'dossier']).optional(),
      maxEvidence: z.number().min(1).max(12).optional(),
      parentDossierId: z.string().optional(),
    },
  },
  {
    name: 'cernion_search',
    action: 'mcp-server.search',
    title: 'Search Cernion catalogue',
    description:
      'Unified search over capabilities, REST operations, agent receipts, blueprints, and cookbook ' +
      'recipes. Returns compact typed refs (cernion://{kind}/{id}) — use cernion_describe for full ' +
      'detail, cernion_execute_read to run a read-classified operation directly. Prefer this ' +
      '(kind=operation) + cernion_execute_read over cernion_ask when the question wants one specific ' +
      "structured data point (a price, a fill level, a company's BDEW/EIC code, a forecast value) " +
      "rather than an open-ended explanation — cernion_ask's internal routing is less reliable for that shape of question.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      query: z.string().min(1).max(500),
      kind: z.enum(['capability', 'operation', 'receipt', 'blueprint', 'recipe']).optional(),
      domain: z.string().optional(),
      limit: z.number().min(1).max(50).optional(),
    },
  },
  {
    name: 'cernion_describe',
    action: 'mcp-server.describe',
    title: 'Describe a Cernion ref',
    description:
      'Full detail for any ref returned by cernion_search: operation schema/policy, receipt payload ' +
      'plus dry-run explanation, blueprint definition and lifecycle status, or recipe steps.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      ref: z.string().optional(),
      kind: z.enum(['capability', 'operation', 'receipt', 'blueprint', 'recipe']).optional(),
      id: z.string().optional(),
    },
  },
  {
    name: 'cernion_execute_read',
    action: 'mcp-server.executeRead',
    title: 'Execute a read-only operation',
    description:
      'Executes a read-only REST operation selected via ref (from cernion_search/describe) or an ' +
      'explicit method+path. Server-side classification enforced (~556 operations recognized as ' +
      'read-safe regardless of HTTP verb) — refused if the operation is a genuine write, or an ' +
      'admin/secret surface. Use this + cernion_search for a specific structured data point instead ' +
      "of cernion_ask — see cernion_ask's description for why.",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: {
      ref: z.string().optional(),
      operationId: z.string().optional(),
      method: z.string().optional(),
      path: z.string().optional(),
      pathParams: anyObject(),
      query: anyObject(),
      body: anyObject(),
    },
  },
  {
    name: 'cernion_run_receipt',
    action: 'mcp-server.runReceipt',
    title: 'Run a curated agent receipt',
    description:
      'Plans (mode=plan, default) or runs (mode=run) a curated playbook receipt. mode=run never writes ' +
      'directly — if the plan is executable it creates a confirmation intent via the same path as ' +
      'cernion_prepare_process, which cernion_execute_process must then confirm.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      id: z.string().optional(),
      receipt: anyObject(),
      context: anyObject(),
      input: anyObject(),
      mode: z.enum(['plan', 'run']).optional(),
    },
  },
  {
    name: 'cernion_prepare_process',
    action: 'mcp-server.prepareProcess',
    title: 'Prepare a process intent',
    description:
      'Prepares any mutation (business write or governance action) as a pending_confirmation intent. ' +
      'Never writes by itself. Returns a cernion://intent/{id} ref for cernion_execute_process.\n\n' +
      'operationFamily is the routing key. Most values go through the generic intake path (real ' +
      'execution needs a developer to wire a dispatch case first — see cernion_execute_process). ' +
      'Six operationFamily values are reserved and route to dedicated, fully-executable actions — for ' +
      'these, reason is required and payload must contain:\n' +
      '- "vdmi": payload.matrixId, payload.evidenceType, payload.reference (payload.content optional). ' +
      'Injects VDMI evidence.\n' +
      '- "gridConnection": at least one of payload.gridOperatorId / payload.gridOperatorBdew / ' +
      'payload.gridOperatorName (payload.includeCapacityCheck optional). Runs the Netzanschluss ' +
      'validation pipeline.\n' +
      '- "znp": payload.projectId, payload.text. Adds a ZNP planning assumption.\n' +
      '- "connectionRejectionEvidence": payload.gridOperatorId, payload.applicantReference, ' +
      'payload.loadAssumptionKw, payload.netzverknuepfungspunktId, payload.voltageLevel, ' +
      'payload.bottleneckDescription, payload.n1QualityStatus ' +
      '(COMPLIANT|NON_COMPLIANT|CONDITIONALLY_COMPLIANT|UNKNOWN), payload.decision ' +
      '(GO|CONDITIONAL|NO_GO|PENDING). Creates a connection-rejection evidence package.\n' +
      '- "vdmiFindingMitigation": payload.findingId, payload.owner, payload.dueAt, payload.plan. ' +
      'Submits a mitigation plan for a VDMI finding.\n' +
      '- "vdmiFindingResolution": payload.findingId, payload.resolutionReason (payload.evidenceRef ' +
      'optional). Resolves/closes a VDMI finding. NOTE: the underlying REST operation looks read-only ' +
      'by name (its summary starts with "Resolve...") but is a genuine write — do not attempt this via ' +
      'cernion_execute_read (it is explicitly refused there); use this operationFamily instead.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      operationFamily: z.string().min(1).max(64),
      proposedAction: z.string().min(1).max(200),
      targetType: z.string().optional(),
      targetId: z.string().optional(),
      inputSummary: z.string().max(500).optional(),
      payload: anyObject(),
      risk: z.enum(['low', 'medium', 'high']).optional(),
      reason: z.string().max(500).optional(),
      correlationId: z.string().optional(),
      decisionFrameId: z.string().optional(),
    },
  },
  {
    name: 'cernion_execute_process',
    action: 'mcp-server.executeProcess',
    title: 'Execute or reject a process intent',
    description:
      'Executes (action=execute, default) or rejects (action=reject) a pending_confirmation intent by ' +
      'id/ref. Deliberately a separate tool call from cernion_prepare_process so a client cannot ' +
      'prepare-and-execute in one shot. Intents from the 6 reserved operationFamily values (vdmi, ' +
      'gridConnection, znp, connectionRejectionEvidence, vdmiFindingMitigation, vdmiFindingResolution ' +
      '— see cernion_prepare_process) execute for real. NOTE: intents from any other (generic) ' +
      'operationFamily have no wired auto-execution (by design — see docs/mcp-server.md) and will fail ' +
      'execute with a clear error; reject still works for those.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: {
      ref: z.string().optional(),
      intentId: z.string().optional(),
      action: z.enum(['execute', 'reject']).optional(),
      reason: z.string().optional(),
      executedBy: z.string().optional(),
      rejectedBy: z.string().optional(),
      correlationId: z.string().optional(),
    },
  },
  {
    name: 'cernion_process_status',
    action: 'mcp-server.processStatus',
    title: 'Check process/job/HITL status',
    description:
      'Unified status for anything in flight: a process intent, an async job, or a HITL item — by ref, ' +
      'or list="open" for an overview of pending intents and HITL items.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      ref: z.string().optional(),
      kind: z.enum(['intent', 'job', 'hitl']).optional(),
      id: z.string().optional(),
      list: z.enum(['open']).optional(),
    },
  },
  {
    name: 'cernion_get_context',
    action: 'mcp-server.getContext',
    title: 'Get session context',
    description:
      'Tenant/session context at the start of a conversation: sidecar descriptor and (if a tenantId is ' +
      'known) quota snapshot. Optional — call this to make cernion_ask more precise up front.',
    annotations: { readOnlyHint: true },
    inputSchema: { tenantId: z.string().optional() },
  },
];

// Resources (v0.99.4): design principle #6 from the original concept doc —
// "Blueprints/Receipts zusätzlich als MCP-Resources, damit Clients mit
// Resource-Support sie ohne Tool-Call browsen können." Backed entirely by
// the existing cernion_search/describe actions (list/read respectively) —
// no new business logic, just the MCP resource-template protocol shape
// around what already exists. `search`'s query param requires a non-empty
// string; a single space trims to empty inside its textIncludes() filter,
// which is how these list callbacks ask for "everything of this kind"
// rather than a text match. Capped at 50 per kind (search's own max) —
// real pagination (MCP's cursor mechanism) is a reasonable follow-up if
// any of these kinds outgrows that.
const RESOURCE_KINDS = {
  capability: { title: 'Cernion Capabilities', description: 'Capability-broker catalog entries.' },
  receipt: { title: 'Cernion Agent Receipts', description: 'Curated playbook receipts.' },
  blueprint: { title: 'Cernion Blueprints', description: 'Governance blueprint definitions.' },
  recipe: { title: 'Cernion Cookbook Recipes', description: 'Curated implementation recipes.' },
};

// Prompts (v0.99.4): one per cookbook recipe (src/cookbook-recipes.js via
// cookbook.list) — recipes are already curated "how to accomplish X" guides
// with an ordered step plan, which is exactly what an MCP prompt is for.
// Fetched once per session at initialize time; advisory (a cookbook outage
// just means no prompts get registered, not a failed session).
function renderRecipePromptText(recipe) {
  const steps = (recipe.process || [])
    .slice()
    .sort((a, b) => (a.step || 0) - (b.step || 0))
    .map((step) => `${step.step}. ${step.description} (internally: ${step.action})`)
    .join('\n');
  return [
    `Task: ${recipe.problem}`,
    '',
    'Suggested approach (curated CET recipe). For each step below, use ' +
      'cernion_search/cernion_describe to find the matching operation, then ' +
      'cernion_execute_read if it resolves to a read-classified operation ' +
      '(or cernion_prepare_process/cernion_execute_process if it is a write):',
    steps,
    '',
    `Expected result: ${recipe.expectedResult}`,
  ].join('\n');
}

async function registerRecipePrompts(server, broker, sessionMeta) {
  try {
    const result = await broker.call('cookbook.list', {}, { meta: { ...sessionMeta } });
    const recipes = Array.isArray(result?.data) ? result.data : [];
    for (const recipe of recipes) {
      if (!recipe?.id) continue;
      server.registerPrompt(
        recipe.id,
        { title: recipe.title, description: recipe.problem },
        async () => ({
          description: recipe.title,
          messages: [
            { role: 'user', content: { type: 'text', text: renderRecipePromptText(recipe) } },
          ],
        })
      );
    }
  } catch {
    // Advisory only — a cookbook outage shouldn't block MCP session init.
  }
}

function toolSuccessResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function toolErrorResult(err) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { error: err.message, type: err.type || err.name || 'Error', data: err.data },
          null,
          2
        ),
      },
    ],
  };
}

// Self-healing guard (v0.99.4): a production instance was observed
// answering `initialize`/`tools/list` correctly (both served straight out
// of this file's static TOOL_DEFS) while every actual tool call failed
// with SERVICE_NOT_FOUND for `mcp-server.*` — i.e. `index.js`'s glob
// service loader hadn't picked up `services/mcp-server.service.js` on
// that running process, even though it ships in the same deploy. Rather
// than only documenting "redeploy fixes it", each tool call now checks
// the broker's own action registry first and lazily loads the service if
// it's missing — cheap on the normal path (`registry.actions.get` is an
// O(1) lookup, ~0.1ms measured), and turns a silent, confusing
// SERVICE_NOT_FOUND into either a working call or a clear, specific error
// if `mcp-server` is registered but genuinely broken (as opposed to simply
// not loaded).
function hasMcpServerActions(broker) {
  return TOOL_DEFS.every((def) => broker.registry.actions.get(def.action));
}

async function ensureMcpServerActions(broker) {
  if (hasMcpServerActions(broker)) return;

  const services = broker.registry.getServiceList({ withActions: true });
  const registeredService = services.find((service) => service.name === 'mcp-server');
  if (registeredService) {
    throw new Error('mcp-server service is registered but its MCP actions are not available');
  }

  // broker.createService() already fires-and-forgets service._start() when
  // broker.started is true (see moleculer's ServiceBroker#createService /
  // #_restartService) — it does NOT await it. The explicit await below is
  // required so hasMcpServerActions() below observes the service's actions
  // as registered rather than racing service._start()'s own async
  // registerLocalService() call. Verified (tests/mcp-transport.test.js)
  // this doesn't double-register: Moleculer's registerLocalService is
  // idempotent for the same service instance either way.
  const service = broker.createService(require('../services/mcp-server.service'));
  if (broker.started && typeof service._start === 'function') {
    await service._start();
  }

  if (!hasMcpServerActions(broker)) {
    throw new Error('mcp-server service was loaded but its MCP actions are still unavailable');
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('MCP request body exceeds size limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function buildSessionMcpServer(broker, sessionMeta) {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
  });
  let ensureMcpServerPromise = null;
  const ensureMcpServerReady = async () => {
    if (hasMcpServerActions(broker)) return;
    if (!ensureMcpServerPromise) {
      ensureMcpServerPromise = ensureMcpServerActions(broker).finally(() => {
        ensureMcpServerPromise = null;
      });
    }
    await ensureMcpServerPromise;
  };

  for (const def of TOOL_DEFS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      },
      async (args) => {
        try {
          await ensureMcpServerReady();
          const result = await broker.call(def.action, args || {}, { meta: { ...sessionMeta } });
          return toolSuccessResult(result);
        } catch (err) {
          return toolErrorResult(err);
        }
      }
    );
  }

  for (const [kind, meta] of Object.entries(RESOURCE_KINDS)) {
    server.registerResource(
      kind,
      new ResourceTemplate(`cernion://${kind}/{id}`, {
        list: async () => {
          await ensureMcpServerReady();
          const result = await broker.call(
            'mcp-server.search',
            { query: ' ', kind, limit: 50 },
            { meta: { ...sessionMeta } }
          );
          return {
            resources: (result.results || []).map((r) => ({
              uri: r.ref,
              name: r.title,
              description: r.summary,
              mimeType: 'application/json',
            })),
          };
        },
      }),
      meta,
      async (uri, variables) => {
        await ensureMcpServerReady();
        const result = await broker.call(
          'mcp-server.describe',
          { kind, id: variables.id },
          { meta: { ...sessionMeta } }
        );
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }
    );
  }

  await ensureMcpServerReady();
  await registerRecipePrompts(server, broker, sessionMeta);

  return server;
}

function writeJsonError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * @param {import('moleculer').ServiceBroker} broker
 */
function createMcpHttpHandlers(broker) {
  // sessionId -> { transport, server }. Single-process, in-memory — matches
  // job-store/rate-quota-store's own in-memory-only conventions elsewhere
  // in this codebase; MCP sessions are short-lived (one client connection).
  const sessions = new Map();

  async function post(req, res) {
    const sessionId = req.headers['mcp-session-id'];
    // Behind services/api.service.js's `/api` route, moleculer-web's own
    // bodyParsers middleware already consumes and parses the JSON body into
    // `req.body` before this raw alias handler runs (same as the
    // `POST /datasources/uploads` raw handler on that route) — re-reading
    // the stream here would hang. Fall back to reading it ourselves only
    // when nothing pre-parsed it (e.g. this handler mounted standalone, as
    // tests/mcp-transport.test.js does).
    let body = req.body;
    if (body === undefined) {
      try {
        body = await readJsonBody(req);
      } catch (err) {
        writeJsonError(res, 400, `Invalid JSON-RPC body: ${err.message}`);
        return;
      }
    }

    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId).transport.handleRequest(req, res, body);
      return;
    }

    if (!sessionId && isInitializeRequest(body)) {
      const auth = await resolveMcpAuth(broker, req.headers['authorization']);
      if (!auth.ok) {
        writeJsonError(res, auth.status, auth.message);
        return;
      }

      const server = await buildSessionMcpServer(broker, auth.meta);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { transport, server });
        },
        onsessionclosed: (closedSessionId) => {
          sessions.delete(closedSessionId);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    writeJsonError(
      res,
      400,
      sessionId
        ? 'Unknown or expired mcp-session-id'
        : 'First request on a new MCP connection must be an "initialize" request'
    );
  }

  async function get(req, res) {
    const sessionId = req.headers['mcp-session-id'];
    const session = sessionId && sessions.get(sessionId);
    if (!session) {
      writeJsonError(res, 400, 'Unknown or expired mcp-session-id');
      return;
    }
    await session.transport.handleRequest(req, res);
  }

  async function del(req, res) {
    const sessionId = req.headers['mcp-session-id'];
    const session = sessionId && sessions.get(sessionId);
    if (!session) {
      writeJsonError(res, 400, 'Unknown or expired mcp-session-id');
      return;
    }
    await session.transport.handleRequest(req, res);
    sessions.delete(sessionId);
  }

  return { post, get, delete: del };
}

module.exports = { createMcpHttpHandlers, TOOL_DEFS };
