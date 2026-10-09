# Workbench Governed Tool Runtime

The Workbench Tool Runtime is the CET-owned execution boundary for Open WebUI and other Workbench clients. Clients may request or suggest tool use, but CET authorizes, records and renders tool runs.

## Scope

Initial tool classes:

- `web_fetch`
- `web_browse`
- `mail_search`
- `mail_read`
- `mail_attachment_ref`
- `document_fetch`
- `api_lookup`

The runtime stores every execution as a case-bound ToolRun and represents outputs as EvidenceRefs and/or receipt references. Raw credentials, service tokens and unrestricted tool output are not returned to Open WebUI or the LLM context.

## Governance

Tool availability is filtered by the Tool/Skill Governance Map using:

- tenant and actor identity
- current case domain
- actor roles
- tool side-effect class
- allowed/blocked tool lists
- sensitivity constraints where applicable

Supported side-effect classes:

- `read_only_external`
- `internal_cet_state`
- `internal_master_data`
- `external_business_effect`

`external_business_effect` remains blocked unless a future explicit CET RBAC/HITL path enables it. The current runtime records blocked attempts as ToolRuns with `status: blocked` and a `blockedReason`.

## APIs

- `GET /api/workbench/tools?domain=...`
- `POST /api/workbench/cases/:caseId/tools/:toolId/run`
- `GET /api/workbench/cases/:caseId/tool-runs`
- `GET /api/workbench/cases/:caseId/tool-runs/:toolRunId`
- `GET /api/workbench/governance-map/:domain`
- `POST /api/workbench/skills/filter`

## ToolRun result

A ToolRun contains:

- `toolRunId`
- `caseId`
- `tenantId`
- `actorId`
- `toolId`
- `toolClass`
- `sideEffectClass`
- `status`
- `inputSummary`
- `outputSummary`
- `evidenceRefs`
- `receiptRefs`
- `auditRef`
- timestamps
- optional `blockedReason`

## Skills

The governance map also filters Workbench playbooks/skills. Only active, role-compatible and domain-allowed skills are returned. Draft skills remain stored but are ignored by runtime filtering.

## Boundary

This runtime does not implement full browser automation, live mail access or tenant skill learning by itself. Those are separate connector/skill issues. This issue establishes the governed execution and audit contract they build on.

## Web Evidence Connector

`web_fetch` now performs a bounded, CET-governed fetch and stores the result as a Workbench EvidenceRef. It is intended for public web evidence such as grid-connection public context, public registry pages, regulatory publications and public PDFs.

Safety boundaries:

- only `http`/`https` URLs are accepted;
- localhost, private-network, link-local, multicast and reserved targets are blocked unless an explicit internal/test override is supplied server-side;
- raw HTML is stripped before UI/LLM-facing summaries are produced;
- large responses are bounded and unsupported content types fail closed;
- failed fetches are recorded as failed ToolRuns with a `blockedReason` instead of disappearing as chat failures;
- successful fetches create supporting EvidenceRefs with URL, content type, retrieval timestamp, safe snippet, source fingerprint and content hash where available.

The connector creates `evidence.available`/readiness-review signals as supporting evidence only. Web evidence is never treated as sole authority for binding claims, approvals, Anschlusszusagen or regulatory conclusions.

## Mail Evidence Connector

`mail_search`, `mail_read` and `mail_attachment_ref` use tenant-bound Workbench mail account references. Mail account credentials are stored inside CET as AES-256-GCM encrypted secrets and never returned to Open WebUI, ToolRuns, EvidenceRefs or LLM context.

Mail account provisioning:

- `POST /api/workbench/mail/accounts`
- `GET /api/workbench/mail/accounts`
- `DELETE /api/workbench/mail/accounts/:mailAccountRef`

Runtime boundaries:

- only read/search/reference actions are exposed;
- `mail_send`, reply and forward remain blocked as `external_business_effect`;
- message bodies are reduced to bounded safe snippets;
- attachments are represented as metadata EvidenceRefs unless a separate ingestion path handles bytes;
- mail output becomes supporting EvidenceRefs such as `mail_thread`, `mail_message` and `mail_attachment_metadata`;
- the connector is prepared for `himalaya`/IMAP-backed tenant accounts, while secrets remain server-side and encrypted.

## Willi-MaKo Evidence Connector

Willi-MaKo is exposed to Workbench as a supporting MaKo diagnostic source, not a second case authority. CET maps Willi mandants/users to CET tenants/actors first, then uses the tenant-scoped Willi service API to discover sessions, attach safe diagnostic summaries and link CET cases back to Willi sessions.

Connector APIs:

- `GET /api/workbench/willi-mako/sessions`
- `POST /api/workbench/cases/:caseId/willi-mako/evidence`
- `POST /api/workbench/cases/:caseId/willi-mako/link`

Attached summaries become `willi_mako_ref` EvidenceRefs with `evidenceRole: diagnostic_signal` and `claimStrength: supporting`. APERAK/Z18 evidence strengthens MaKo/master-data routing but never resolves a case automatically. Raw Willi chat history and service credentials are never returned to Open WebUI or LLM context. See `docs/workbench-willi-mako-connector.md`.

## Read capabilities in content answers (#755, Part B)

The understood situation carries a turn-local `dataNeeds` string. An empty value skips
both tool planning and execution, including follow-up questions without fresh data needs.
The bounded plan/act/observe loop runs alongside knowledge retrieval within the same
`WORKBENCH_RETRIEVAL_TIMEOUT_MS` deadline. It uses `llm-client.generateChat` and candidates
ranked by the existing operation index, function hypotheses and capability catalog.
Only indexed, agentable `data_read` / `dashboard_read` operations with direct execution,
no declared effects/writes and an allowed `checkExecuteReadPolicy` decision are candidates.
The existing `assertReadObservation` guard checks scope, function mandate, No-Call rules,
required parameters and backend roles before the delegated broker call. User statements
about their role or employer update `actorContext` only; they never grant authorization.
Mapping domain restrictions apply before tools are offered, and identity/tenant overrides
and secret parameters are refused. Results carrying a different tenant are refused and
secret fields are removed before output or model context.

Parameters are validated against the generated OpenAPI request schema. The model can
request a local `projection` using the existing tabular-intelligence operations (select,
filter, aggregate, sort, limit). `excludeObservation` and `excludeField` allow a later
result to exclude keys from a previous local observation; the complete bounded result,
not its displayed sample, supplies those keys. Missing fields fail explicitly. This
supports data comparisons without domain rules or model arithmetic in the core.

Limits:

- `WORKBENCH_MAX_TOOL_CALLS`: maximum attempted calls per turn, default 3, ceiling 12.
- `WORKBENCH_TOOL_RESULT_CHARS`: displayed/model result characters per call, default 6000,
  ceiling 16000; at most 20 displayed rows.
- Raw results: at most 2 MB and the existing tabular source limit of 50000 rows.
- Planning and backend calls use the remaining retrieval deadline; backend retries are
  disabled. A timeout stops waiting and prevents subsequent calls. A started read may
  still finish in its underlying connector; no write operation is admitted.

Tool failures, missing parameters, unavailable capabilities and exhausted budgets remain
explicit observations. The independent answer phase still runs and provides a partial
answer, with the concrete missing data or error. Successful observations become evidence
with operation name, parameters, timestamp and truncation limits. Retrieval time is never
presented as a verified source data date. `phaseTimes.toolsMs` and per-operation `sources`
include status, duration and row count. Knowledge-only turns have `toolsMs: 0`.

`outputKind: analysis` suppresses unsolicited correspondence, including stale drafts.
An explicit current request for a draft retains precedence. A grounded `actorContext`
update reaches the answer prompt and replaces the previous self-description while
leaving the authenticated mapping and its permissions intact.

Validation uses synthetic data in `tests/workbench-capability-loop.test.js`; the site
ranking example does not assert a live registry result or live-provider latency.

Provider tool declarations preserve the input and projection JSON schemas. The adapter
uses the provider JSON Schema parameter field; local OpenAPI validation remains mandatory. Function-call
signatures remain in the private planner history. Cached reads are reauthorized against
current tenant, scope, roles and domain restrictions before being reused. Canonical
identifier values stay in local evidence; existing answer-context masking and the sole
LLM facade protect every provider request.

Bounded canonical results are also rendered directly alongside the provenance report.
This preserves computed rows/rankings when a model claim is rejected by the existing
answer guard. It does not relax claim grounding or infer completeness from a successful
read. Follow-up interpretation can reuse recent evidence after authorization without
new tool calls.
