# MCP Server (v0.99.2)

A real MCP (Model Context Protocol) server — JSON-RPC 2.0 over the
streamable-HTTP transport — sitting in front of this platform's REST API.
It exposes **9 meta-tools** instead of a 1:1 tool-per-endpoint mapping, per
the original design concept. It authenticates with the same Bearer tokens
as the REST API (`ck_...` API tokens, `csess_...` session tokens, or legacy
plain tokens).

- Endpoint: `POST/GET/DELETE /api/mcp`
- Transport implementation: `src/mcp-transport.js`
- Tool business logic: `services/mcp-server.service.js`
- Also reachable per-tool over plain REST for debugging: `POST /api/mcp-server/<action>` (e.g. `POST /api/mcp-server/search`), same auth as everything else on `/api`.

## Connecting

```bash
curl -sX POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer ck_...' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```

The response carries an `mcp-session-id` header; subsequent requests
(`tools/list`, `tools/call`, ...) must include that same header. A
`DELETE /api/mcp` with the header ends the session early.

Any MCP-SDK client works too — see `tests/mcp-transport.test.js` for a
full round-trip example using `@modelcontextprotocol/sdk`'s
`StreamableHTTPClientTransport`.

## The 9 tools

| # | Tool | Maps to | Read-only? |
|---|------|---------|------------|
| 1 | `cernion_ask` | `personal-agent.askCernionAgent` / `.answerDossier` | No — POST, gated (see Auth) |
| 2 | `cernion_search` | `agent-manifest.list{Capabilities,Operations}`, `agent-receipts.list`, `blueprint-management.list`, `cookbook.search` | Yes |
| 3 | `cernion_describe` | `agent-manifest.getCapability`, `agent-receipts.get`+`explainStored`, `blueprint-management.get`, `cookbook.get` | Yes |
| 4 | `cernion_execute_read` | Loopback HTTP call into `/api/...` (see below) | Yes, allowlisted |
| 5 | `cernion_run_receipt` | `agent-receipts.test` (plan); `copilot-process.prepareProcessIntent` (run) | plan: yes; run: no |
| 6 | `cernion_prepare_process` | `copilot-process.prepareProcessIntent` | No |
| 7 | `cernion_execute_process` | `copilot-process.executeProcessIntent` / `.rejectProcessIntent` | No |
| 8 | `cernion_process_status` | `copilot-process.getProcessIntent`/`.listProcessIntents`, `job-status.status`, `hitl.get`/`.list` | Yes |
| 9 | `cernion_get_context` | `agent-sidecar.descriptor`, `tenant-quota.getQuotas` | Yes |

Typed refs use `cernion://{kind}/{id}` (`src/mcp-uri.js`) with
`kind ∈ {capability, operation, receipt, blueprint, recipe, intent, job,
hitl}` — `search`/`describe` emit them, the write/status tools accept them
back instead of requiring separate id+kind params.

## Deviations from the original concept doc — read before relying on this

The original design doc (see project memory / PR description) assumed a
few things about the existing REST surface that turned out not to hold once
checked against the real code. Documenting them here so nobody re-discovers
the hard way:

1. **No `confirmation_token`.** `copilot-process.prepareProcessIntent` only
   ever returns an `intentId` — there is no signed confirmation token
   anywhere in that service. `cernion_execute_process` therefore only takes
   `intentId` (or a `cernion://intent/{id}` ref). The safety property the
   concept wanted — "a client cannot prepare-and-execute in one shot" — is
   still preserved structurally (two separate tool calls, the id must be
   echoed back), just without a cryptographic token.

2. **Generic process intents don't auto-execute — by design, not a gap.**
   `copilot-process.js`'s `_executeIntent` dispatch table only has cases for
   4 reserved operation families (`vdmi`, `gridConnection`, `znp`,
   `connectionRejectionEvidence`), each with its own dedicated `prepare*`
   REST action. Any intent created through the **generic**
   `prepareProcessIntent` (which is all `cernion_prepare_process` and
   `cernion_run_receipt` mode=run currently use) will get
   `UNKNOWN_OPERATION_FAMILY` if you try to execute it — the docstring in
   `copilot-process.service.js` calls this "establishes the intake/
   classification/HITL boundary only." `cernion_execute_process` catches
   that specific error and rewraps it with a clearer message
   (`MCP_INTENT_REQUIRES_MANUAL_EXECUTION`) rather than a raw 400. Rejecting
   a generic intent still works fully.
   **v1.1 follow-up**: wire the 4 reserved-family `prepare*` actions
   (`prepareVdmiEvidence`, `prepareGridConnectionValidation`,
   `prepareZnpAssumption`, `prepareConnectionRejectionEvidence`) into
   `cernion_prepare_process` so at least those get real end-to-end
   execution through MCP. Not done here — each has its own param shape
   that needs the same care this file's ground-truth research took for the
   generic path.

3. **Receipts have no direct execution path either.** There is no
   "run this receipt for real" REST action — only `test`/`testStored`
   (dry-run planning, confirmed to never call write actions) and
   `explain`/`explainStored`. `cernion_run_receipt` mode=run therefore
   doesn't invent one: if the dry-run plan is executable, it creates a
   confirmation intent (`operationFamily: 'agent-receipt'`) the same way
   `cernion_prepare_process` does, which inherits deviation #2 above —
   i.e. it still needs a human to actually carry out the change today.

4. **`kind: "object"` is not implemented in `cernion_search`/`describe`.**
   The concept doc's `kind` enum included `object`. The only real backing
   candidate, `object-store.query`, requires a caller-supplied `namespace`
   (Mango selector scoped to one namespace) — it isn't a free-text
   discovery surface, so it doesn't fit `search`'s "find things by query"
   contract. Left out rather than forced.

5. **`cernion_execute_read` is allowlist-based, not universal**, even
   though the concept called for covering "all ~1,100 endpoints." See
   "How execute_read actually works" below for why, and what's covered.

## How `execute_read` actually works

`agent-manifest.listOperations()` gives `{method, path, operationId}` for
every catalogued REST operation, but nothing that maps back to the actual
Moleculer action that serves it (moleculer-web's alias→action resolution
lives entirely inside `services/api.service.js` and isn't exposed). Rather
than re-implementing that routing table (risking silent drift from the
real one, and re-implementing the auth/RBAC/tenant-scoping/rate-limiting
`onBeforeCall` already does correctly), `execute_read` makes a genuine HTTP
loopback call to `http://127.0.0.1:${PORT}/api${path}`, forwarding the
calling MCP session's real Bearer token. This means execute_read
operations run through the *exact same* gateway stack as a direct REST
call — no duplicated security logic, and it automatically covers any
future REST endpoint without code changes here.

A request is allowed (`src/mcp-execute-read-policy.js`) if:
- the method is GET (mirrors `src/gateway-request-classifiers.js`'s
  `isReadMethod`), or
- it's one of a short list of POST endpoints that are read/dry-run despite
  the verb (`evidence-router/route`, `knowledge-rag/{query,semantic,
  federated-search}`, `agent-receipts/{select,evaluate,test,explain}`,
  `cookbook/{search,validate}`, `copilot/{ask-cernion-agent,answer-dossier}`)

and is denied regardless of method if the path matches an admin/secret
surface (`backup`, `restore`, `system/admin`, `domain-routes/reload`,
`token-manager`, `auth`, `tenant-quotas`) — the concept doc's "Nicht
exponieren" list.

## Auth and RBAC — why this needed its own gate

`/api/mcp` is registered as a **raw** (non-aliased) route handler, the same
pattern already used for `/metrics` and the datasource upload endpoints —
which means it bypasses `services/api.service.js`'s `onBeforeCall`
entirely, including its bearer-token resolution and RBAC enforcement.
`src/mcp-auth.js` replicates that resolution (ck_ API token via
`token-manager.verify`, csess_ session token via `auth.verify`, legacy
plain-Bearer passthrough) once per MCP session, at the `initialize` call —
the resolved `ctx.meta` is then reused for every tool call in that session.

Critically, `onBeforeCall`'s `enforceRbacForPath` requires the
**`full-access` role for any non-GET request**, with a short exemption
list this repo doesn't need here. Bypassing that check would let a
`read-only`-scoped API token reach writes through MCP that it can't reach
through REST — a real gap, not a hypothetical one. `src/mcp-rbac-gate.js`
enforces the same rule, called explicitly inside the write-shaped actions
(`ask`, `prepareProcess`, `executeProcess`, and `runReceipt`'s mode=run
branch) before they touch anything. Legacy plain-Bearer tokens are exempt
here too, matching `onBeforeCall`'s own legacy branch (which also never
calls `enforceRbacForPath`) — that's an existing platform behavior this
file inherits, not something introduced by the MCP server.

`execute_read` doesn't need this separate gate — it goes through the real
gateway via HTTP loopback, so RBAC is enforced by the actual `onBeforeCall`
for whatever downstream path it hits.

## Not exposed

Following the concept doc's scope: backup/restore, tenant-quota writes,
system admin tools, and `domain-routes/reload` are excluded via the
`execute_read` denylist. HITL `approve`/`reject`/`escalate` (which require
the separate `hitl-approver` role) are not wired into any of the 9 tools —
only read access (`hitl.get`/`.list` via `cernion_process_status`).
