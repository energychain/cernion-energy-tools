# MCP Server (v0.99.2, extended v0.99.3, v0.99.4, v0.99.5, v0.99.6, v0.99.7)

A real MCP (Model Context Protocol) server — JSON-RPC 2.0 over the
streamable-HTTP transport — sitting in front of this platform's REST API.
It exposes **9 meta-tools** instead of a 1:1 tool-per-endpoint mapping, per
the original design concept. It authenticates with the same Bearer tokens
as the REST API (`ck_...` API tokens, `csess_...` session tokens, or legacy
plain tokens) — or, for clients that can only do OAuth (e.g. claude.ai's
remote connector UI), via the OAuth 2.1 flow in `docs/oauth.md`, which
issues that same kind of token through a browser-based authorization step.

- Endpoint: `POST/GET/DELETE /api/mcp`
- Transport implementation: `src/mcp-transport.js`
- Tool business logic: `services/mcp-server.service.js`
- Also reachable per-tool over plain REST for debugging: `POST /api/mcp-server/<action>` (e.g. `POST /api/mcp-server/search`), same auth as everything else on `/api`.
- OAuth 2.1 authorization layer (v0.99.4): `docs/oauth.md`

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
| 2 | `cernion_search` | `agent-manifest.list{Capabilities,Operations}`, `agent-receipts.list`, `src/blueprint-registry.js` (v0.99.5, see below), `cookbook.search` | Yes |
| 3 | `cernion_describe` | `agent-manifest.getCapability`, `agent-receipts.get`+`explainStored`, `src/blueprint-registry.js` (v0.99.5, see below), `cookbook.get` | Yes |
| 4 | `cernion_execute_read` | Loopback HTTP call into `/api/...` (see below) | Yes, allowlisted |
| 5 | `cernion_run_receipt` | `agent-receipts.test` (plan); `copilot-process.prepareProcessIntent` (run) | plan: yes; run: no |
| 6 | `cernion_prepare_process` | `copilot-process.prepareProcessIntent`, or one of 4 dedicated `prepare*` actions for reserved families (v0.99.3, see below) | No |
| 7 | `cernion_execute_process` | `copilot-process.executeProcessIntent` / `.rejectProcessIntent` | No |
| 8 | `cernion_process_status` | `copilot-process.getProcessIntent`/`.listProcessIntents`, `job-status.status`, `hitl.get`/`.list` | Yes |
| 9 | `cernion_get_context` | `agent-sidecar.descriptor`, `tenant-quota.getQuotas` | Yes |

Typed refs use `cernion://{kind}/{id}` (`src/mcp-uri.js`) with
`kind ∈ {capability, operation, receipt, blueprint, recipe, intent, job,
hitl}` — `search`/`describe` emit them, the write/status tools accept them
back instead of requiring separate id+kind params.

## Resources and prompts (v0.99.4)

Design principle #6 from the original concept doc: "Blueprints/Receipts
zusätzlich als MCP-Resources, damit Clients mit Resource-Support sie ohne
Tool-Call browsen können." Both are backed entirely by existing actions —
no new business logic, just the MCP resource/prompt protocol shape around
what `cernion_search`/`describe` and `cookbook.list` already do.

**Resources** — one `ResourceTemplate` per browsable kind
(`cernion://{kind}/{id}` for `kind ∈ {capability, receipt, blueprint,
recipe}`):
- `resources/list` calls `mcp-server.search` with an all-matching query
  (capped at 50 per kind — `search`'s own max; real cursor-based pagination
  is a reasonable follow-up if any kind outgrows that)
- `resources/read` calls `mcp-server.describe` for the matched `{id}` and
  returns its JSON as the resource content

**Prompts** — one MCP prompt per cookbook recipe (`cookbook.list`, 45 as of
this writing), registered once per session at `initialize` time. Each
prompt's `get` renders the recipe's `problem` as the task, its ordered
`process` steps as a suggested approach (pointing the caller at
`cernion_search`/`describe`/`execute_read`/`prepare_process` to find and run
the MCP-reachable equivalent of each internal step), and `expectedResult` as
the goal. Advisory — a `cookbook.list` failure just means no prompts get
registered for that session, not a failed `initialize`.

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
   6 reserved operation families (`vdmi`, `gridConnection`, `znp`,
   `connectionRejectionEvidence`, and as of v0.99.7
   `vdmiFindingMitigation`/`vdmiFindingResolution`), each with its own
   dedicated `prepare*` REST action. Any intent created through the
   **generic** `prepareProcessIntent` (which is what `cernion_run_receipt`
   mode=run uses, and what `cernion_prepare_process` falls back to for any
   `operationFamily` outside the reserved ones) will get
   `UNKNOWN_OPERATION_FAMILY` if you try to execute it — the docstring in
   `copilot-process.service.js` calls this "establishes the intake/
   classification/HITL boundary only." `cernion_execute_process` catches
   that specific error and rewraps it with a clearer message
   (`MCP_INTENT_REQUIRES_MANUAL_EXECUTION`) rather than a raw 400. Rejecting
   a generic intent still works fully.
   **As of v0.99.3** (extended v0.99.7), `cernion_prepare_process` routes
   the reserved `operationFamily` values to their dedicated `prepare*`
   actions instead of the generic one (see "Reserved operation families"
   below) — those now execute for real through `cernion_execute_process`,
   closing this gap for the families that have one. Everything else still
   needs a developer to add a reviewed dispatch case in `_executeIntent`
   first — that's a deliberate governance boundary, not something MCP
   should paper over. See "Full capability exposure (v0.99.7)" below for
   why only 2 of ~19 unwired VDMI write operations were added, not all of
   them.

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
   though the concept called for covering "all ~1,100 endpoints." As of
   v0.99.5 the allowlist is index-driven (~556 operations classified
   `data_read`/`dashboard_read`/`advisory_plan`) rather than a ~10-entry
   hand-curated list, but it's still a classification-based gate, not
   "everything goes." See "How execute_read actually works" below.

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
- the path doesn't match the admin/secret denylist below (checked first,
  always wins — see below), **and**
- `operation-capability-index.json` classifies it as read-safe (v0.99.5,
  see "The allowlist redesign" below), **or**, if it isn't in that index,
  the method is GET (mirrors `src/gateway-request-classifiers.js`'s
  `isReadMethod`) or it's one of a short fallback list of POST endpoints
  that are read/dry-run despite the verb (`evidence-router/route`,
  `knowledge-rag/{query,semantic,federated-search}`,
  `agent-receipts/{select,evaluate,test,explain}`, `cookbook/{search,
  validate}`, `copilot/{ask-cernion-agent,answer-dossier}`)

and is denied regardless of method or classification if the path matches
an admin/secret surface (`backup`, `restore`, `system/admin`,
`domain-routes/reload`, `tokens`, `auth`, `tenant-quotas`) — the concept
doc's "Nicht exponieren" list, plus token/auth surfaces added defensively.

### The allowlist redesign (v0.99.5) — and two real bugs it fixed

Real-world testing (an MCP client via claude.ai asking a CO₂-intensity
question) hit `energy-market.co2Intensity` refused by `execute_read` —
it's POST (takes a body), so the original hand-curated ~10-entry
`POST_ALLOWLIST_PATH_PATTERNS` list didn't cover it, even though it's a
genuine, side-effect-free read. That list was always going to under-cover:
every read-shaped POST across the platform (energy-market, entsoe,
gas-storage, german-grid, oep, osm-geo, residual-load, tabular, and more)
had the identical gap.

The fix: `execute_read` now consults `operation-capability-index.json` —
the same deterministic classification (`src/operation-capability-
classifier.js`) already computed for all ~880 operations and relied on
elsewhere in the platform (e.g. the ChatGPT sidecar's own read-only
fallback) — as the primary source of truth, rather than re-deriving it by
hand. `data_read`/`dashboard_read` operations are read-safe when
`recommendedExecutionMode: 'direct'` (empirically always true for those
two kinds, no exceptions found across the index). `advisory_plan`
operations need `recommendedExecutionMode: 'explain_only'` specifically —
**not** uniformly `'direct'` like the other two kinds — because at least
one operation (`znp_deleteProject`, a real `DELETE`) is misclassified as
`advisory_plan` in the index but correctly flagged `recommendedExecutionMode:
'confirm'`; checking the mode per-kind lets genuinely read-only
`advisory_plan` endpoints (like `evidence-router.route`) through while
still catching that one. GET-by-convention and the original small POST
allowlist remain as a fallback for anything not (yet) in the index.

Investigating the CO₂ report also surfaced a second, unrelated bug: the
denylist targeted `/token-manager/*`, but the service is actually mounted
at `/tokens` (see `services/token-manager.service.js`) — so `GET
/api/tokens` (token metadata — masked values, but still names, tenant/user
IDs, scopes, active status, potentially across more than the caller's own
tenant) was never actually blocked, despite that clearly being the intent.
Fixed alongside the allowlist redesign; caught by cross-checking this file
against the operation index, not by the original report.

## Blueprint discoverability (v0.99.5)

From the same real-world report above: `cernion_ask`'s response mentioned
a blueprint (`ev-charging-co2-optimization-v1`) by name — its own internal
routing (`src/l3-broker.js`) already knew about it — but `cernion_describe`
couldn't resolve it. Root cause: `search`/`describe`'s `blueprint` kind
queried `blueprint-management` (the PouchDB-backed governance-lifecycle
system: draft → validate → test → promote → rollback), which only tracks
blueprints someone has actually drafted/promoted through that workflow. It
never saw **built-in** blueprints shipped as static files in
`src/blueprints/*.json` — which is most of them, including this one.

`src/blueprint-registry.js` is the actual unified view — the same one
`cernion_ask`'s L3 broker consults — merging the static repo files with an
in-memory overlay that `blueprint-management.service.js` populates via
`setRuntimeBlueprint()` on promote/rollback/startup. `search`/`describe`
now call `listBlueprints()`/`loadBlueprint()` from that module directly
(a plain function call, not a service — no `ctx.call` needed) instead of
`blueprint-management.list`/`.get`. Scope note: not-yet-promoted **drafts**
are intentionally excluded — those are governance-workflow-internal, not
part of what `cernion_ask` can actually route to yet.

## Tool-selection steering: cernion_ask vs. cernion_search+execute_read (v0.99.6)

A third real-world report (claude.ai asking for the current German gas
storage fill level) found the same pattern as the CO₂ report above, but
this time the underlying data path was already correct
(`gas-storage.countryStorage` classifies `data_read`/agentable, reachable
via `execute_read` since v0.99.5's redesign) — the gap was purely which
tool got called. `cernion_ask`'s internal routing
(`personal-agent.askCernionAgent`, a much larger system this MCP layer
doesn't touch) sometimes falls back to generic knowledge-RAG document
search for a specific structured data point tied to a named entity,
instead of recognizing it as a request for a matching operation.

Nothing to fix in `askCernionAgent` itself from here — but `cernion_ask`'s
tool description previously said "try this first... covers most requests
without needing search/describe/execute_read", which actively steered
MCP clients away from the more reliable path for exactly this question
shape. `cernion_ask`, `cernion_search`, and `cernion_execute_read`'s
descriptions now explicitly point structured/quantitative questions
(prices, fill levels, forecasts, a named entity's code) at
`cernion_search` (kind=operation) + `cernion_execute_read` first, and
reserve `cernion_ask` for open-ended/explanatory questions or as a
fallback when no matching operation exists. A prompt-engineering-level
fix, not a code fix — worth knowing if `askCernionAgent`'s own routing
improves later, since these descriptions would then be overly cautious.

## Full capability exposure (v0.99.7)

Scoping question from the platform owner: "are we still meaningfully behind
what the REST API/OpenAPI spec can do, especially for VDMI (processes) and
structured retrieval/filtering?" Two real, confirmed gaps, one incidental
security finding:

**1. `cernion_describe(kind=operation)` had no parameter/body schema.** It
returned only `{method, path, operationId, summary, tags, aliases}` — an
MCP client had no way to discover what to filter/pass (query params, body
fields) before calling `execute_read`, even though the full OpenAPI
`parameters`/`requestBody` schema (with types, required fields, examples)
was already sitting in `openapi-export.json` for every operation, just
never carried through `agent-manifest.listOperations()`. Fixed by having
`loadOperations()`/`dedupeOperations()` (`services/agent-manifest.
service.js`) also capture `description` (not just `summary` — often has the
real usage guidance, see `gas-storage_countryStorage`'s "Use cases:..."
prose), `parameters`, and `requestBody` straight from the parsed spec.
`describe`'s operation branch already spread `...op` into its response, so
no change was needed there — the new fields just flow through. `search`'s
operation results are untouched (still the lean `{ref, kind, title,
summary, riskClass}` shape) since a 10-row search list isn't the place for
full schemas — that's what `describe` is for.

**2. VDMI write coverage was 1 of ~20 operations.** All 24 VDMI
*read*-shaped operations were already reachable via `cernion_search`+
`execute_read`. But only `prepareVdmiEvidence` had a dedicated
prepare→confirm→execute path — `nominate`, `confirm-nomination`, `detect`,
`revert`, `findings/mitigate`, `findings/resolve`, `evidence/sign`, and
others had none. This is **not** purely an MCP-layer gap: `copilot-process.
service.js`'s `_executeIntent` dispatch table is deliberately hand-reviewed
per operation (see deviation #2 above) — there is no generic "execute
whatever the intent says" path, by design, since each write needs its own
validation review (see the `connectionRejectionEvidence` `decision`-enum
gap in "Reserved operation families" below for why that caution is
warranted). One target, VDMI nomination, doesn't even have a real Phase 3
execute path server-side yet (`prepareVdmiValidation`'s own response says
`"Noch nicht implementiert (Phase 3)"`) — building that is a platform
feature, not something to bolt on under an MCP release. Given that, v0.99.7
adds the 2 highest-value, lowest-risk additions —
`vdmiFindingMitigation`/`vdmiFindingResolution` (see "Reserved operation
families" below) — rather than rushing all ~19 through in one pass. The
remaining VDMI write operations, and the still-unimplemented nomination
Phase 3, are deliberately deferred to a future release with its own
per-action review, not silently dropped.

**3. Security finding made while confirming #2's target list**:
`vdmi.resolveFinding` — a genuine write (persists `finding.status =
'resolved'` to PouchDB) — was misclassified `data_read`/`recommended
ExecutionMode: direct` in `operation-capability-index.json`, meaning it was
silently reachable through the supposedly read-only `cernion_execute_read`
tool. Root cause: `src/operation-capability-classifier.js`'s
`QUERY_VERB_PATTERN` treats any POST operation whose summary starts with
"resolve" as a read query (correct for genuine cases like
`chatgpt-sidecar.plan`'s "Resolve a request to a route (no execution)",
wrong here — "resolve" also means "close out a stateful entity"). Auditing
every operation the same heuristic let through found 2 more real instances:
`interface-placeholder.resolveGap` and `job-status.resolveAlarm`. Not fixed
in the classifier itself — it's relied on by other consumers beyond MCP, so
narrowing the "resolve" verb there needs its own dedicated audit — instead
overridden in `src/mcp-execute-read-policy.js` (`KNOWN_MISCLASSIFIED_
WRITE_PATTERNS`) the same way v0.99.5 handled `znp_deleteProject`'s
misclassification. All 3 are now explicitly denied by `execute_read`
regardless of index classification; see the module comment there for the
exact paths and regression tests in `tests/mcp-execute-read-policy.test.js`.

## Reserved operation families (v0.99.3, extended v0.99.7)

`cernion_prepare_process`'s `operationFamily` param routes to one of two
places (`src/mcp-reserved-families.js`):

- One of the 6 reserved values below → the matching dedicated `prepare*`
  action in `services/copilot-process.service.js`, whose intent **does**
  execute for real via `cernion_execute_process`.
- Anything else → the generic `prepareProcessIntent` (deviation #2 above —
  no auto-execution without a developer adding a dispatch case).

| `operationFamily` | Required `payload` fields | Optional `payload` fields | Executes as |
|---|---|---|---|
| `vdmi` | `matrixId`, `evidenceType`, `reference` | `content` | `vdmi.evidence` — injects VDMI evidence |
| `gridConnection` | at least one of `gridOperatorId` / `gridOperatorBdew` / `gridOperatorName` | `includeCapacityCheck` | `grid-connection.validate` — runs the Netzanschluss validation pipeline (up to 2 min) |
| `znp` | `projectId`, `text` | — | `znp.addAssumption` — adds a ZNP planning assumption |
| `connectionRejectionEvidence` | `gridOperatorId`, `applicantReference`, `loadAssumptionKw`, `netzverknuepfungspunktId`, `voltageLevel`, `bottleneckDescription`, `n1QualityStatus` (`COMPLIANT`\|`NON_COMPLIANT`\|`CONDITIONALLY_COMPLIANT`\|`UNKNOWN`), `decision` (`GO`\|`CONDITIONAL`\|`NO_GO`\|`PENDING`) | — | `connection-rejection-evidence.create` — creates an evidence package |
| `vdmiFindingMitigation` (v0.99.7) | `findingId`, `owner`, `dueAt`, `plan` | — | `vdmi.mitigateFinding` — submits a mitigation plan for a VDMI finding |
| `vdmiFindingResolution` (v0.99.7) | `findingId`, `resolutionReason` | `evidenceRef` | `vdmi.resolveFinding` — resolves/closes a VDMI finding |

`reason` (top-level, not inside `payload`) is required for all 6 — the
dedicated actions require it themselves.

**A bug found and worked around, not fixed at the source**:
`prepareConnectionRejectionEvidence` validates `decision` as a plain
string, not against the target action's actual enum (`GO`/`CONDITIONAL`/
`NO_GO`/`PENDING`) — existing tests even pass `'REJECTED'`, which isn't a
valid value and would fail at `executeProcessIntent` time, after
confirmation. `src/mcp-reserved-families.js` validates `decision` against
the real enum itself before calling the REST action, so MCP callers get a
clear `422 MCP_INVALID_RESERVED_FAMILY_FIELD` up front instead of a
confusing failure after the human has already confirmed. Not fixed in
`copilot-process.service.js` itself, to avoid touching existing call sites
(including tests that rely on the current loose validation) for a fix
that's only load-bearing through the new MCP path.

The original 4 families' read-only context endpoints
(`getVdmiContext`, `listOpenResponsibilities`, `getZnpProjectStatus`,
`getGridConnectionValidation`) needed no changes — they're plain GET
routes, so `cernion_search`/`describe`/`execute_read` already reach them
via the normal operation catalogue. `connectionRejectionEvidence` has no
equivalent context endpoint in `copilot-process.service.js` (a pre-existing
asymmetry with the other 3 families, not something this change introduces).
`vdmiFindingMitigation`/`vdmiFindingResolution` likewise reuse an existing
read endpoint, `vdmi.findings` (`GET /api/vdmi/findings`), for existence
checks in their `prepare*` actions rather than needing a new one.

**`vdmiFindingResolution` is the write-path fix for the v0.99.7 execute_read
security finding below** — before this, `vdmi.resolveFinding` had no MCP
write path *and* was reachable through the read-only tool by mistake.

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
