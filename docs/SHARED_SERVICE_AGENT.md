# Shared Service Agent (#697)

`shared-service-agent` is one function-parametrized Moleculer service. It owns no
intervals or timers. #699 calls the protected action
`shared-service-agent.runCycle({ tenantId, agentId })`, which returns exactly
`{ findings: number, consumedUnits: number, proposals: number }`. Without #699,
creation, reactivation and attention-tier transitions each request one cycle.
Consumption notifications alone never request another cycle.

The public authenticated actions are `agents.list`, `agents.get` and
`agents.retire`, forwarded to the same service. Retirement requires the existing
`ROLE_ADMIN` or `ROLE_TENANT_ADMIN` principal; reads require an authenticated tenant
and actor. These are broker actions without new REST routes. The protected
`executeOperation` action exposes the same enforced execution path for diagnostics.
It uses the technical agent's permissions, never the diagnostic caller's roles.

## Lifecycle and attention

`function.activation.changed.v1` creates exactly one stable agent identity per
tenant/function when responsibility is CET's. Lifecycle follows
`proposed → active ⇄ sleeping → retired`. Loss of responsibility, dormant state or
attention retirement retires it. Exhaustion or inadequate units sleeps it. A
subsequent activation event supplying adequate units may reactivate it; wall time
never creates credit. Manual retirement remains in force. `attention`, including
tier, is copied from activation; only activation's real human feedback policy can
establish a function. Stored identities use `resolveFunctionId` through the existing
membership-aware `resolveRecords` helper. Ambiguous execution/feedback references
fail closed. After a model split, successors have distinct identities and remain
retired until an explicit activation. Historic counters and a pending journal
entry remain attached to only one identity; ambiguous proposal associations are
not copied. A singular successor keeps the original agent identity.

The activation consumer enqueues work without awaiting it from the producer's
serialized event outbox. Otherwise the consumption/lifecycle feedback path would
deadlock. Consumers of agent lifecycle must likewise schedule a later `runCycle`
rather than await it from the lifecycle callback. Work serializes in the existing
single-process broker. `settle()` drains accepted work for deterministic tests and
shutdown. Every cost-bearing step reads the current activation again; cached events
cannot authorize work after a handoff.

## Mandate and permissions

Mandates derive from the function's operation references and the committed operation
index: `agentable: true`, none/low consequence and only internal effects. Unknown
metadata, external effects, process starts, privileged mutation and global No-Call
catalog entries are denied. The existing capability governance evaluator also
checks capability exclusions, required inputs and HITL requirements. Calls go to
existing Moleculer actions with unchanged backend guards, tenant context and
`actorType: shared-service-agent`; there is no authorization bypass.

The technical principal defaults to `ROLE_USER` and `read-only`. `actorRoles` and
`actorScopes` are deployment settings, independent of observed coverage. The
agent never copies a human caller's roles, creates a token, or derives permission
from responsibility/coverage. Ordinary tenant/role/scope checks run before each
operation; the backend remains authoritative. Required operation inputs are not
invented. An unavailable service or denied backend call ends the cycle with its
error class in the journal.

## Units and sparse work

| Setting | Default |
| --- | ---: |
| `unitCosts.wake` | 0.1 |
| `unitCosts.operation` | 0.25 |
| `unitCosts.llm` | 1 |
| `maxOperationsPerCycle` | 2 |
| `maxFindings` | 20 |
| `maxProposalsPerAgent` | 20 |
| `maxCoverageRecords` | 256 |
| `coverageThreshold` | 0.5 |

Costs and positive limits are validated at creation. Each attempted cost-bearing
step emits exactly its configured units via `shared-agent.consumption.v1` and waits
for activation's committed consumption counter before doing work. Rejected funding
means zero work. There is no local or time-based funding. Activation supplies at
most two units per activating tenant turn, apportioned by relevance. #699 does not
charge separately: `runCycle` charges wake units even for an empty observation.

A cycle selects eligible operations from `signals.catalog` and observes through
`signals.observe` (#722). Without accessible case references it selects only
standing operations. Referenced activation/journal cases supply contextual inputs
under the technical read-only principal. Only signal `warn`/`breach` or `finding`
values count, with `needs_context` and `unknown` excluded first. Each called
operation retains its configured unit cost; catalog bookkeeping adds no charge.
See [SIGNALS.md](SIGNALS.md) for projection, context and state-event contracts. An empty observation never calls an LLM. Findings plus eligible recipients
and enough units for both LLM and delivery permit `src/llm-client.js`'s structured
facade, with explicit tenant quota context. Invalid model output or quota errors
produce an error-class journal entry, never a proposal.

Recipients come from observed coverage of neighboring functions. The existing
`agent-persona.list` resolves those actor identities to active human personas by
`openclawUserId`/identity, never configured roles. Proposals use only the internal
`persona-inbox.enqueue` channel, with idempotency keys; no HITL notification dispatch
or external messaging is invoked. Directory reads and each inbox delivery cost
operation units. A typical one-read, one-recipient proposal costs **1.85 units**.
Without a matching human persona it remains a finding in the journal. A shortage
before LLM sleeps the agent until a funding event supplies a useful cycle's units.

## Human feedback

`shared-service-agent.resolveProposal({ tenantId, ref, outcome })` accepts
`accepted|used|rejected` from an authenticated recipient. It resolves the existing
inbox item and emits `shared-agent.feedback.v1` using the proposal's persisted
agent/function association. Existing `hitl.item.resolved` events use the same
association if present: approved → accepted, completed → used, rejected → rejected.
The existing `persona-inbox.resolveByHitlItem` action also publishes a versioned
resolution event after persistence. A recipient's accepted/used/rejected resolution
through that original action reaches the same feedback path automatically; no new
chat flow is required. Unknown or unauthenticated resolutions do not invent a
positive outcome.
Unrelated, other-tenant and duplicate resolutions do not manufacture feedback.
No proposal is auto-approved, and no observed finding counts as positive feedback.
The first terminal human resolution determines the proposal's outcome.

## Persistence and audit

Agents use `createPouchDbLifecycleMixin`,
`SHARED_SERVICE_AGENT_DB_PATH` (default `./data/shared-service-agent`). One tenant
document contains at most the current model's agent identities, a bounded coverage
cache and at most 20 recent/open proposal associations per agent. Pending lifecycle
and feedback publication are persisted for retry. An unresolved proposal limit
blocks new proposals rather than discarding a human's pending work.

Every accepted cycle, including aborted/error/retired attempts, calls
`journal.append`; the entry includes the error class without private error messages.
The latest failed append is persisted. Further cycles retry it before spending,
providing backpressure instead of an unbounded journal queue. Immutable duplicate
entry IDs are accepted only after verifying the existing record. Human resolutions
append a journal settlement referencing the proposal entry. Journal retention and
existing inbox storage remain owned by those services.

The harness instantiates the real agent and inbox at the existing in-memory PouchDB
constructor seam. Its observations include real agents, rejected operation attempts
and second-person handoffs. I-1/I-2/I-3/I-4/I-9/I-10 run together after every step of
each fixed-seed history; each invariant still independently requires actual
exercise. Missing #699/#700/#701 invariants remain explicit todos. Isolated upstream
unit tests can disable agent integration with `withAgents: false`.

## Additive proposal notice event (#723)

After persisting the proposal association and at least one successful persona-inbox
delivery, the service emits `shared-agent.proposal.created.v1 { tenantId, agentId,
functionId, proposalRef, summary, createdAt }`. Summary is the fixed safe text
`Internal review requested.`; recipient-visible notice text comes from Function
labels and deterministic templates. This adds no LLM call, operation charge,
feedback or new proposal execution. `notices.resolveRef` maps displayed short refs
back to the existing proposal ref for #701; the original proposal resolution
recipient guard remains authoritative. See [SHARED_SERVICE_NOTICES.md](SHARED_SERVICE_NOTICES.md).
