# Headless Signals (#722)

This adds a Signal contract and `signal.state.changed.v1` to #693. Function,
Coverage, Activation, SharedAgent and JournalEntry (including the attention
extension from #715) retain their contracts. Signal associations follow the
current function model's operation references and identity lineage; they confer
no permission.

```text
Signal {
  signalId, operationId, functionIds[], label,
  kind: score|count|state|finding|timestamp,
  value?, unit?, asOf,
  state: ok|warn|breach|gap|needs_context|unknown,
  severity?, code?, threshold?, dueAt?,
  context: { kind, ref }?, evidenceRef?
}

signal.state.changed.v1 {
  tenantId, signalId, functionIds[], context?: { kind, ref },
  fromState, toState, asOf, eventId
}
```

`signalId` is operation-scoped. Technical field names identify scalar signals;
code/identity hashes identify findings independently of array order. Duplicates
are coalesced. Native `signals[]` replaces projection, even when empty; operation,
function and context provenance cannot be overridden by a response. Native
`needs_context` and `unknown` never become findings. `asOf` comes from the response
`timestamp`; responses without a timestamp use the rules' fixed provenance date.
The layer does not invent an observation timestamp or freshness claim.

Projection rules are technical roles and token patterns in
`signal-projection.rules.json`. Normalized numeric `*Score`/`*Completeness` fields
use warning/breach thresholds 0.8/0.5 and recovery hysteresis 0.02. Findings use
severity classes. `missing*` arrays emit a count plus stable individual findings.
Unknown severity stays `unknown`. Explicit failed/not-found responses and
unavailable/unknown/outside-tenant statuses suppress findings. Without context,
`needs_*`/`missing_*` responses and every contextual assessment are
`needs_context`, including their scores and arrays. With supplied context,
projected missing statuses and missing entries become `gap`; native `needs_context`
remains authoritative. A finding is `warn`/`breach` or kind `finding`, excluding
`needs_context`, `unknown` and `gap` first.

## Catalog generation and limitations

`npm run generate:signal-catalog` writes `signal-catalog.json` and its report.
`npm run check:signal-catalog` executes the same deterministic generator and
compares both artifacts byte-for-byte without writing. Inputs include action
OpenAPI response schemas/parameters, the operation index, function model, rules,
source files and the existing sandbox seed. Source hashes expose drift. Run the
operation-index and function-model generators first after merging main.

Only the generator performs no-context probes. It starts an isolated local
broker containing the unchanged Dashboard, real sandbox runtime and temporary
PouchDB object store, using the seed's tenant and a fixed clock. Downstream
services not loaded in this sandbox use the Dashboard's existing error-isolated
fallbacks; no external service or network request is started. The sandbox seed
is available through the existing Dashboard implementation. The report names
this deliberately limited environment, failures, uncovered field roles,
classifications, signal kinds and function association counts. Runtime/catalog
parameter paths are data in `signal-catalog.parameters.json`.

An assessment with missing-input tokens or findings/incomplete scores is
`contextual`; other responding operations are `standing`. Failed probes default
to contextual and retain their reason. Context kinds come from technical
parameter-name patterns. A contextual operation with no applicable input remains
skipped, even if a context object is present. The version-2 catalog stores only
operation classification, context/parameter names, function associations and
signal definitions (`signalId`, `label`, `kind`, `sourceField`, optional `unit`,
`stateRule`). Repeated finding rows share one field definition; `:*` denotes
runtime identities derived from each finding. Empty finding arrays still declare
their field role. Native definitions retain their declared identity and unit.
No observed values, concrete finding records or response schemas are retained.
Probe summaries contain only `responded`, `statusClass` and top-level `fields`.

`stateRule` references `signal-projection.rules.json`: `score` uses its normalized
thresholds/hysteresis; `severity` uses its severity lists; `tokens` uses its status
patterns. `nonempty` and `missing` use `contextMissingState` (`gap`) with context and
`needs_context` without context for nonempty arrays and their individual items.
`ok` is informational and `native` preserves the native state. All rules remain subject to the runtime unavailable/context guards.
Runtime projection requires actual response fields. Operations with no matching
roles remain reported rather than padded with invented signals. Tests validate
all committed definitions and replay independent observation fixtures; neither
unit tests nor the harness perform catalog probes. Catalog size is gated below
300,000 bytes.

## Broker actions, identity and retention

`signals.catalog({ tenantId?, functionId? })` requires the existing authenticated
principal and returns catalog entries associated with the current model.
`signals.observe({ tenantId, functionId, context?, operationIds? })` requires that
same principal and accepts an optional subset of operation IDs, never an arbitrary
action. `context` has opaque `kind` and `ref`; optional `params` supplies existing
case inputs. Only declared parameter names are forwarded. A supplied context is
retained only when an actual operation parameter receives it; an unused reference
cannot create `gap`. Tenant overrides are rejected. `kind: case` maps `ref` to `caseId` when declared.

Only indexed read operations in the function's mandate pass the existing policy,
No-Call, scope, capability-governance and backend-role guards. Calls forward the
caller metadata unchanged. Backend guards remain authoritative. Agents use their
technical `ROLE_USER`/`read-only` principal, never a human's rights. Agent contexts
come only from referenced cases in activation reasons or the function journal,
loaded through existing case visibility checks. No accessible reference means
only standing observations. Required values are not guessed.

A successful observation returns `{ signals, calledOperations }`. The agent
requests one selected operation per observation, charging the unchanged operation
cost before invocation. Catalog/context reads are bookkeeping, not additional
operation units. Wake, LLM, directory and inbox costs retain #697 semantics.
Only signal findings feed proposals; one cycle prepares at most one proposal.
The minimum allowance counts standing catalog operations; a contextual read must
still fund its own operation before execution.

Persistence uses `createPouchDbLifecycleMixin`, `SIGNALS_DB_PATH` (default
`./data/signals`). One document per tenant retains only the latest state per
`(signalId, context.kind, context.ref)`, not response values, histories or inputs.
The configurable `maxStatesPerTenant` defaults to 512; least-recently observed
keys are compacted away. Concurrent writers retry revision conflicts. An evicted
key's next observation establishes a new baseline. The first baseline emits no
change; equal states and changes inside score recovery hysteresis emit no event.
Only persisted state transitions emit a tenant-scoped event. Event IDs identify
the persisted transition. Delivery uses the local broker; this layer introduces
no durable event-outbox guarantee. A failed event delivery is logged.

The service has no timer, polling, startup observation or data-event subscription.
Only an agent cycle or authenticated request invokes observation. Wake listens
for changed-state events scoped to affected `functionIds`. Signal push gaps expose
`context_required` or `observation_required`: observing-derived events do not
create an independent producer that can detect changes while all observers sleep.
Existing adaptive scheduled/hybrid wake remains available.

## Acceptance evidence

`tests/signals.test.js` covers AC-02/03 across the entire committed catalog,
AC-04 roles/native precedence, AC-05 hysteresis/change/tenant retention, AC-06 real
Dashboard cycles without and with existing-case fixture context, AC-07 no timed
observation, AC-09 unchanged technical identity and denied privileged roles.
I-11's real adapter and separate negative self-tests cover context suppression,
determinism (including values) and calls only from cycles/requests.

See [SHARED_SERVICE_GAPS.md](SHARED_SERVICE_GAPS.md) for contextual gap lists,
confirmed reactions and the additive #727 contract.
