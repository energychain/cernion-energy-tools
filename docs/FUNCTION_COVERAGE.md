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
and Domain Router selected capabilities. Router candidateCapabilities,
recommendedCapabilities and operationCandidates are excluded entirely. Domain labels, prompts and replies
are never classified into functions by this service. OpenAI governance requests use
these same Workbench actions. Only read-only requests pass the determined intent
mode; chat keeps its original parameters and the hook classifies missing intent
through the existing Workbench classifier.

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

Events preserve the epic fields and add turn identity for #715:

- `function.touched.v1`: `{tenantId, actorId, functionId, conversationId, confidence, at, turnRef}`
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
| maxSignalsPerTurn | 5 | Maximum touched functions per turn; explicit selections precede operation mappings |
| maxInputSignalsPerTurn | 64 | Maximum collected IDs per kind before mapping |
| maxOperationFunctionShare | 0.10 | Operations mapped to a larger share of the model are excluded |
| hubFeatures | `{}` | Additional operation/declared-action/service hub features, unioned with model parameters |
| maxPendingTurns | 128 | Maximum background recordings from Workbench |

Weights: knowledge/status 0.04, data lookup 0.10, case start/decision support 0.40,
case followup 0.30, tool request/evidence attachment 0.50. Evidence attachments select
the attachment band without storing their content. Repeated touches in one session
increase accumulated mass; a different session increases the new touch's weight.
`score = 1 - exp(-sum(weight * 2^(-age/halfLifeMs)))` stays in [0,1]. Reads at the same
`asOf` are deterministic and never write or emit. `nextDecayAt` identifies one
half-life after the latest touch, not a scheduled event.

Operation filtering also honors `statistics.automaticHubs` and model
`parameters.hubFeatures` for operations, declared actions and owning services. No
action denylist exists. Successful calls contribute operation IDs; unselected
receipt IDs and unexecuted tool plans do not establish executed work. Excess input
IDs/mapped functions increment `signalOverflow` and produce a count-only warning;
filtered aggregate operations increment `suppressedOperations`. Neither diagnostic
stores chat contents. Event confidence is the base intent weight; repetition affects
only coverage mass, so recurring questions cannot cross the activation threshold.

New records retain the model source hash to distinguish a current exact ID from an
older retained ID involved in a split. Reads still resolve older IDs through lineage.

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
await their owning services. The explicitly authorized PR #712 review correction adds the activation confidence
threshold; it adds no agent, scheduler, journal, correction or public UI behavior.


## Signal precision review (PR #712)

Measured with the merged committed model (106 functions), the same capability
selection, production neighbor budget 8 and empty tenant state. Counts include
all active direct/CET functions; activation uses the persisted exact model scope.
The previous mapping and confidence policy are compared with the revised policy.

| Turn kind | Before touched / active | After touched / active |
| --- | ---: | ---: |
| knowledge_query with successful knowledge-rag.query | 1 / 3 | 1 / 0 |
| case_start with internal vdmi.dossier only | 49 / 49 | 0 / 0 |
| case_start with one selected capability | 1 / 9 | 1 / 9 |

The review's earlier model mapped the aggregate operation to 62 functions; after
the required main merge it maps to 49. The filter excludes it in either model.
The real-broker regression uses budget 2 and proves one directly touched function
plus at most two eligible direct neighbors. Router proposals contribute zero
functions. Weak observations remain available to coverage reads, including IDs
retained in older split lineage, but never activate or renew complementary work.

`turnRef` is the already hashed source reference of the completed turn; all mapped functions from one source receive the same value. It contains no chat text or raw source identifier.
