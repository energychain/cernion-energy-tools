# Shared Service Wake (#699)

`wake` implements scheduling for the #693 SharedAgent contract. It creates no
agents, runs no operations, grants no permissions, calls no LLM and emits no
consumption. Its sole execution boundary is:

```text
shared-service-agent.runCycle({ tenantId, agentId })
  -> { findings: nonnegative integer | array, consumedUnits: nonnegative number, proposals: array }
```

Findings/proposals may carry ISO `dueAt`. #697 owns wake-unit consumption and final
budget enforcement. Without #697, production attempts are journaled errors and
stop until funded activation. Only tests supply an exact-signature contract stub;
the adapter selects the real service automatically once its file lands on main.

## Modes, sources and gaps

Moleculer's existing wildcard matcher matches Function.events.listens against the
model's emitted events. Additional producer names can be injected as availableEvents.
The initial mode is schedule without a matched producer, otherwise hybrid. A
matching, scoped event confirms push availability and promotes to pushMode (event
by default, optionally hybrid). Pure event mode has no polling due time.

Each event requires tenantId and either an exact functionId or a sourceId contained
in that function's dataSources. Event names alone never select a tenant. Existing
datasource, MQTT, HITL and webhook sources are treated generically; no handwritten
event-name list or domain logic is added. Current datasource/MQTT emissions often
omit tenant metadata and cannot wake a tenant. Outgoing webhook delivery is not an
incoming producer. Properly scoped producers are follow-up work.

`wake.pushGaps({tenantId?})` reports `{tenantId, agentId, functionId, eventType,
reason}`. Missing listeners use `eventType: "*"`, reason missing_listener; listeners
without matching producers use missing_producer. These are structural desired
event types, not invented business events. Eligible agents also journal their gaps.
Both this action and `wake.metrics({tenantId?})` require the existing authenticated
principal and reject tenant mismatches. No REST routes are introduced.

## Adaptive timing and attention

Empty cycles multiply intervalSec by emptyFactor up to maximumIntervalSec.
Consecutive nonempty cycles shorten it after frequentFindings; nearby dueAt values
in nonempty findings/proposals shorten it further. Empty cycles always back off.
The initial rhythm is Function.wake.intervalSec, then matching injected datasource
refreshIntervalSec/options.intervalMinutes, otherwise defaultIntervalSec. The current
registry has no universal refresh-cadence field; adapters can inject existing
registry/cache metadata as dataSources. Bounds/factors are configurable.

Before claiming and again before execution the scheduler requires active lifecycle,
active CET responsibility, nonretired attention, allowanceExhausted=false and
allowance >= minimumAllowance. Missing attention fails closed. Exhaustion,
sleeping/retired, dormancy and human handoff prevent dispatch. A blocked record
is rearmed only by an activation event with increased cumulative replenishedUnits
and sufficient allowance. Lifecycle events and timer ticks never refill budget.
Configure minimumAllowance to match #697's wake cost if changing that cost.

## Persistence and concurrency

The PouchDB lifecycle mixin owns SHARED_SERVICE_WAKE_DB_PATH, default
`./data/shared_service_wake`. There is one record per agent, one last activation
snapshot per tenant/function, cumulative counters, bounded event keys and a bounded
latest journal outbox. Agent identity is expected to remain stable per function as
required by #697. There are no growing turn/consumption arrays.

Stored function IDs resolve before lookup; unknown/ambiguous lineage fails closed
without duplicating claims to successors. Mutations retry revision conflicts. A
due cycle is claimed with PouchDB revision compare-and-swap before journal/agent
calls. Its aggregate sequence creates a private cycle ID; running claims block
further work. Event IDs (eventId, messageId, otherwise Moleculer Context.id) have a
bounded replay cache. Replays older than this horizon cannot be detected forever.

Dispatch is at most once: incomplete claims after process failure are not retried
or expired automatically. Their awaiting journal record exposes the uncertain
outcome. Operators must reconcile it before clearing a stuck claim. Exactly-once
completion would require idempotency in #697, which the two-parameter contract
does not provide. Revision safety requires the same authoritative PouchDB store;
independent replicated databases are not consensus. Native local PouchDB also
enforces its own process lock.

Exactly one timer exists per instance, regardless of agent count. Overlapping tick
scans are prevented; due agents are processed serially. stopped clears the timer,
prevents new dispatch and drains tasks before the mixin closes storage. Slow cycles
delay other due work. Journal failures retain a pending entry and block the next
cycle until publication; deterministic journal IDs permit safe retries.

## Metrics and defaults

Cumulative per-agent counters are wakes, emptyWakes, pushWakes, pushShare,
consumedUnits (reported by #697) and errors. The authenticated metrics action
exposes them. Moleculer gauges shared.service.wake.total, .empty, .push.share and
.consumed.units expose them to configured reporters with tenantId/agentId labels.
Journal.digest adds optional wakeMetrics[] from immutable journal refs; no service
call or LLM is needed and digests without wake activity remain unchanged.

| Setting | Default |
| --- | ---: |
| defaultIntervalSec | 900 |
| minimumIntervalSec / maximumIntervalSec | 60 / 86400 |
| emptyFactor / findingFactor | 2 / 0.5 |
| frequentFindings | 2 |
| deadlineWindowSec / deadlineFactor | 3600 / 0.25 |
| timerIntervalMs | 1000 |
| minimumAllowance | 0.1 |
| pushMode | event |
| conflictRetries | 8 |
| eventHistoryLimit | 128 |

Model, clock, availableEvents and dataSources are injectable. No new dependency,
queue, cron or event in a domain service is introduced.
