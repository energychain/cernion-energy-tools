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
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
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
      'Standard factual question about the energy domain (grid, market, regulatory). CET routes ' +
      'internally and answers directly with evidence, guardrails, and process context. Try this first ' +
      '— it covers most requests without needing search/describe/execute_read.',
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
      'recipes. Returns compact typed refs (cernion://{kind}/{id}) — use cernion_describe for full detail.',
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
      'explicit method+path. Server-side allowlist enforced — refused if the operation is not GET or ' +
      'on the small read-classified POST allowlist (evidence-router, knowledge-rag, receipt dry-runs).',
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
      'Never writes by itself. Returns a cernion://intent/{id} ref for cernion_execute_process.',
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
      'prepare-and-execute in one shot. NOTE: intents created with a domain-agnostic operationFamily ' +
      'have no wired auto-execution (by design — see docs/mcp-server.md) and will fail execute with a ' +
      'clear error; reject still works for those.',
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

function buildSessionMcpServer(broker, sessionMeta) {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
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
          const result = await broker.call(def.action, args || {}, { meta: { ...sessionMeta } });
          return toolSuccessResult(result);
        } catch (err) {
          return toolErrorResult(err);
        }
      }
    );
  }
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

      const server = buildSessionMcpServer(broker, auth.meta);
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
