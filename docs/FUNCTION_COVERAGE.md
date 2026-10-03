# Observed function coverage (#695)

Coverage describes observed activity, never competence, responsibility or authority.
It does not feed RBAC, role families, domainsAllowed, sensitivity clearance, case
visibility, tool policy or command enablement. No observed coverage means only no
qualifying observation in the retained time range.

## Completed-turn observations

Workbench `chat` and `query` and OpenAI chat completions reuse one shared
before/after/error hook implementation. Delegated governance requests are observed
only at Workbench. Successful downstream
calls contribute their action identifiers and existing structured Capability Broker
and Domain Router capability/operation candidates. Domain labels, prompts and replies
are never classified into functions by this service. OpenAI governance requests use
these same Workbench actions and pass their already determined intent mode.

The hook captures only IDs in bounded sets, restores the original call function on
success/error, and starts coverage recording without awaiting persistence or event
delivery. A failed originating turn produces no touches. Missing services, excessive
pending work, unmapped signals and recording errors are bounded operational diagnostics.
No external dependency or public route is added. Other OpenAI models contribute their existing structured downstream results and
successful action IDs through that same seam; returned, unexecuted tool calls do not
produce executed-action signals.

Authentication/tenant mapping remains in Workbench. The observation uses the principal
of its mapped downstream calls. A caller must supply a stable `requestId` (or
`correlationId`) for retry idempotency; otherwise the broker request ID identifies that
individual invocation. Matrix transport integration is deferred.

## Internal contracts and privacy

- `function-coverage.recordTouch`: protected local ingestion; authenticated tenant and
  actor must match. Only model-resolved operation/capability IDs generate observations.
- `byActor`: self, or existing ROLE_TENANT_ADMIN / ROLE_ADMIN / ROLE_UTILITY_HQ viewers.
- `byFunction` / `matrix`: those management roles only. ROLE_UTILITY_HQ receives
  tenant-specific hashed actor IDs and no recent references; admin roles may view IDs.
- Reads accept `limit` 1–100 (default 50), `offset`, and optional ISO `asOf` up to the
  injected clock's present. They return `{items, nextOffset}`. No REST aliases.
- `maintain`: management-only explicit outbox replay/expiry purge, or privacy deletion
  using `deleteActorId`. It touches this service's database only.

Each read row retains the epic Coverage fields `{tenantId, actorId, functionId, score,
signalCount, lastSignalAt, origin}` and adds bounded explainability: `coverageScore`,
`observedActivity`, `scoreVersion`, `asOf`, `lastTouchedAt`, `nextDecayAt`, signal-class
counts and recent hashed source references. `origin` is always `observed`; corrections
belong to #701. `resolveFunctionId` runs for every stored identity. Empty/ambiguous
lineage is omitted instead of copying a person's coverage to multiple descendants.

Events retain exactly the epic fields:

- `function.touched.v1`: `{tenantId, actorId, functionId, conversationId, confidence, at}`
- `function.coverage.changed.v1`: `{tenantId, actorId, functionId, score, origin}`

Conversation IDs in observations/events are tenant-bound SHA-256 references, not
chat-history access tokens. Source references are hashed too. No message, response,
attachment content, tool input/output, arbitrary metadata or policy is stored.

## Configuration and scoring

Versioned defaults live in `src/function-coverage-config.json`, overridden by service
`settings.coverage`; tests inject `settings.model` and `settings.clock`.

| Parameter | Default | Meaning |
| --- | --- | --- |
| scoreVersion | 1 | Scoring configuration identifier |
| halfLifeMs | 30 days | Half-life of accumulated signal mass |
| retentionMs | 180 days | Touch retention and retry deduplication horizon |
| hysteresis | 0.05 | Minimum absolute difference from last persisted changed-event score |
| crossConversationMultiplier | 1.5 | Weight increase after observing a different conversation |
| recentReferenceLimit | 8 | Maximum references per read row |
| maxSignalsPerTurn | 64 | Maximum mapped functions per turn |
| maxPendingTurns | 128 | Maximum background recordings from Workbench |

Weights: knowledge/status 0.04, data lookup 0.10, case start/decision support 0.40,
case followup 0.30, tool request/evidence attachment 0.50. Evidence attachments select
the attachment band without storing their content. Repeated touches in one session
increase accumulated mass; a different session increases the new touch's weight.
`score = 1 - exp(-sum(weight * 2^(-age/halfLifeMs)))` stays in [0,1]. Reads at the same
`asOf` are deterministic and never write or emit. `nextDecayAt` identifies one
half-life after the latest touch, not a scheduled event.

Touch IDs hash tenant + actor + source type/reference + function + signal class.
In-process writes are serialized (the repository uses a single-process broker).
The persisted touch contains at most two pending event records. Successful emission
removes its marker; failures retain it for retry or `maintain`. Delivery is at least
once across a crash after emission and before marker removal; consumers must remain
idempotent. Duplicate recorded touches never increase scores or enqueue new events.

Persistence uses createPouchDbLifecycleMixin and CET_FUNCTION_COVERAGE_DB_PATH
(default ./data/cet_function_coverage). Each touch is a separate closed document,
without a growing tenant-level array. Active tenants purge expired documents on
recording; operators should invoke `maintain` for inactive tenants and privacy requests.
Expired touches never contribute to reads. Source conversations/cases and function
model data are never deleted. Retention bounds retained history by time, not traffic;
queries scan tenant documents in 256-row DB pages, so very large tenants may require a
later aggregate/index optimization. Shutdown drains accepted background writes.

## Harness and scope

The real adapter extends the activation adapter merged in #709. It instantiates both
real services using the existing `memory-pouch.js` constructor seam, supplies coverage
and event observations plus before/after authorization decisions and policy snapshots,
and preserves the existing fake-timer shutdown loop. I-3 now runs against real activation
state after coverage signals; I-8 remains todo until #701. Other dependent invariants
await their owning services. This issue adds no activation, agent, scheduler, journal,
correction or public UI behavior.
