# Shared Service acceptance harness (#702)

The harness checks generic invariants from #693. It implements no shared-service
business behavior and never grants coverage-based authorization. Existing guards,
RBAC, HITL, `domainsAllowed` and `sensitivityClearance` remain authoritative.

## Commands

- `npm run check:domain-free-core`: scan configured core files using live catalogs.
- `npm run test:shared-service:ci`: check + oracle/generator self-tests + three fixed
  seeds (702, 693, 20261003). A shared 59-second process deadline enforces AC-05;
  dependency installation is outside that runtime.
- `npm run test:shared-service`: the same checks plus a cryptographically random
  uint32 seed. Nightly/manual CI uses this command too.
- `SHARED_SERVICE_SEED=123 npm run test:shared-service`: replay a local seed.

Failures include the seed, invariant ID and a deletion-minimized ordered history.
Each candidate is replayed with a fresh adapter. Minimization preserves the original
invariant failure; it is deletion-minimal, not necessarily globally shortest.
Jest fake timers exercise time jumps without waiting in real time.

## Catalog check

`scripts/domain-free-core.config.json` controls paths/globs, minimum token length
(default 5) and allowlist location. Only explicitly listed future paths may be
absent. Empty scans, missing required files and empty vocabularies fail closed.
Add the actual paths of upstream implementations to this configuration when they
land, including helper modules and any split service files. Static function model
data is a vocabulary source, not core code.

Vocabulary comes from capability IDs, capability domains/keywords, operation
index domains, semantic-domain IDs/labels/departments/indicator keywords and real
function labels/keywords when available. Full values and tokens above the minimum
length are checked case-insensitively, including comments and literals; camelCase,
underscore and hyphen identifiers are covered. Unicode normalization is applied.
No handwritten domain word list is used. Generic catalog collisions are automatically
exempted using the committed reference vocabulary described below. Remaining
exceptions require a term and a reviewable reason in
`scripts/domain-free-core.allowlist.json`; a longer domain phrase is not exempted
by allowing one of its generic tokens. The contamination self-test creates a
fixture file from an actual catalog keyword and verifies CLI exit status 1.

## Neutral reference corpus (#713)

Run `npm run generate:domain-free-vocabulary` manually to sample dependency code
in `node_modules`, never CET source/services: CET itself contains frequent domain
terminology and cannot provide a neutral baseline. Packages and source paths are
sorted canonically, with at most 40 files per top-level package (including scoped
packages). Nested `node_modules`, hidden paths, symlinks inside packages, `.min.`
files and non-code files are excluded. Packages without eligible source files
still count in the denominator. `referenceCorpus` configures source extensions
and the per-package cap.

Each catalog term counts at most once per package, using the check's normalization
and word boundaries. `genericPackageShare` defaults to 0.05: a term occurring in
at least 5% of packages is general vocabulary. Only qualifying terms are stored
in `scripts/domain-free-core.generic-vocabulary.json`, with package shares,
sample counts, parameters and the fixed `referenceCorpus.generatedAt` ISO timestamp.
Set that timestamp deliberately when refreshing; wall clock time is never used,
so identical inputs produce byte-identical JSON.

The check reads only the committed artifact and reports automatically exempted
terms/counts and redundant manual exceptions as informational fields. It does
not read installed dependencies or enforce corpus drift on dependency updates.
New catalog terms remain checked until deliberately measured. To refresh: install
existing dependencies, update the fixed timestamp if appropriate, run the generator,
review terms and shares, remove now-redundant allowlist entries, and run
`npm run test:shared-service:ci`. Remaining contract vocabulary and German exceptions
retain their reasons. Raising the threshold can re-enable stored terms; lowering
it requires regeneration because below-threshold terms are absent from the artifact.

## Current upstream gaps and activation

On the #702 baseline, #694–#701 implementations are absent. Each real-service
invariant is therefore a `test.todo` naming its missing paths and upstream issues.
Separate positive/negative oracle tests are active today. The simulation currently
uses a contract-shaped input recorder with latent activations and no agents. It
validates generator inputs and replay plumbing, **not** the absent service behavior.
No replacement activation/coverage/learning/scheduler implementation is included.

The readiness table in `tests/helpers/shared-service/invariants.js` checks actual
files (and the #700 router mode). Once prerequisites exist, each corresponding
service test automatically becomes active. Without an adapter it fails with an
explicit integration instruction, rather than remaining silently todo. If upstream
chooses different module paths, update the readiness table and core path config.

## Real-service adapter seam

The harness automatically loads `tests/helpers/shared-service/real-adapter.js`
when that file exists. `SHARED_SERVICE_TEST_ADAPTER=/absolute/path/to/adapter.js`
overrides this default. Each service issue (#695–#701) extends the shared adapter
with its own observations and makes the corresponding service invariants pass.
The file is supplied by those issues, not created by this harness.

An adapter may return a partial observation envelope. Missing-service arrays may
be omitted or empty; their invariants remain `todo` until dependencies exist.
Active invariants still require their own observations and cannot pass merely
because an unrelated field is absent. The CommonJS module
exports `createAdapter({ functions, jest })` returning a fresh instance exposing:

- `apply(step)`: send tenant-scoped versioned touch/correction events, feed the
  existing turn signal path, issue an activity query, or advance the fake clock.
  Set touch `at` from that clock. Wait until events and at most one handoff cycle
  settle before returning. Observe actual operations and Knowledge/RAG calls.
- `snapshot()`: return the test-only observation envelope used by the oracles:
  `fresh`, `activations`, `agents`, `functions`, `tenantBudget`, `minWeight`,
  `now`, `restWindowMs`,
  `operationAttempts`, `activityQueries`, `emptyWakes`, `corrections`, `journal`,
  `authorizationChecks`, `handoffs`. Records keep the #693 fields and event names.
  Supply the function graph (including tenant neighbor overlays), CET budget,
  `minWeight` and `restWindowMs` from the service configuration. `now` is epoch
  milliseconds from the fake clock (defaults to `Date.now()`). Compute the journal digest
  independently from the response being checked. Capture before/after target,
  authorization and policy values around correction/coverage changes.
- `close()`: stop the broker and release timers and owned handles; called even
  when a step or invariant fails.

Adapters must instantiate the real services and inject an in-memory PouchDB test
double at the existing lifecycle-mixin seam. Production persistence remains through
`createPouchDbLifecycleMixin`; no adapter or DB dependency is introduced by #702.
For the services already implemented, exercise fresh state, touched/uncovered functions, denied external-effect
attempts, activity queries, empty wakes, all four correction targets, unchanged
permission decisions and second-user handoff; observations must not remain empty.
The default trace recorder is never accepted as a real-service adapter.

## Function source and optional sandbox

`function-model.json` automatically takes precedence over the neutral 24-function
fixture. Both an array and `{ functions: [...] }` are accepted. Invalid or duplicate
IDs in a real model fail, rather than falling back to a fixture. No catalog
projection or graph algorithm from #694 is implemented here.

A sandbox can be supplied through the same adapter. Run the same seeds, generator
and oracles with its tenant-scoped data and no separate scenario expectations.
External-effect execution stays denied; the optional sandbox is not a CI prerequisite.

## Decisions after review

These rules implement the [clarification in #693](https://github.com/energychain/cernion-energy-tools/issues/693#issuecomment-5962863441).

I-3 limits CET-responsible functions to `tenantBudget`, independently of human
activity. Every CET-responsible function must be a direct neighbor of a touched
function with edge weight at least `minWeight` (harness default 0.5). The total
active count must not exceed the unique touched-function count plus that budget.
Touches are read from tenant-scoped activations with `touchedAt`; adjacency comes
from the supplied Function graph, never from an activation's own `reason[]`.
Each of the three violations has a separate negative self-test.

I-2 only checks functions touched within the inclusive interval
`[now - restWindowMs, now]`. The harness default is 24 hours (86,400,000 ms),
exported as `DEFAULT_REST_WINDOW_MS`. Adapters supply #696's configured rest
window as `snapshot().restWindowMs`; direct oracle callers may also pass
`assertInvariants(state, ids, { now, restWindowMs })`. Outside that window,
`dormant` is allowed and I-2 does not demand an agent. Tests cover both the exact
boundary and a dormant function outside the window.

#700 places generic `system_activity_query` recognition and response logic in a
separate module, such as `src/workbench-system-activity.js`. This optional future
path is configured for the core scan. The existing intent router calls that
module; its older branches are not blanket-allowlisted.

## Journal observations (#698)

The existing activation `real-adapter.js` from #709 also starts the real `journal`
service, reusing `memory-pouch.js` at the constructor seam and retaining the
existing fake-timer-aware `close()`. `snapshot().journal` contains actual records
for all observed tenants, including correction refs. Real activation transitions
from touches, received coverage and time advances automatically populate it.
Fixture lifecycle/correction events are also delivered to the real subscribers.
Both services use the same injected clock and function model. Missing services'
observations remain empty; no agent, activity-query or learning behavior is simulated.

`tests/shared-service-journal.service.test.js` checks immutable writes,
deterministic digests, visibility, identity lineage, the production activation
producer, event retries and lossless retention. The journal persistence test
checks real PouchDB restarts and archival. I-3 remains active against the actual
activation service; I-5 and I-7 remain explicit todos pending #700 and #701.


## Attention observations (#715)

I-10 is active against the real activation service and checks three independent
properties: relevance does not increase without a refreshing input, committed
consumption never exceeds funded allowance, and funded units never increase
without an activating turn. It also checks nonnegative/capped allowance and the
total tenant funding bound. The dependency table requires the actual activation
service and `src/function-attention.js`; no agent implementation is needed.

The adapter adds `attentionTransitions[]` with `{tenantId, functionId, before,
after, turns, refreshed}`, plus aggregate `activatingTurns`, `allowancePerTurn`
and `allowanceCap`. `before`/`after` are actual attention values; `turns` is the
persisted activating-counter difference. Refresh expectations derive from supplied
touch/feedback/correction inputs and observed Coverage-produced touches, not from
the resulting relevance. Snapshots include newly created attention with a zero
funding baseline, so unauthorized creation of allowance cannot evade the oracle.

The seeded simulation adds consumption (wake/llm/operation), feedback
(accepted/used/rejected), and authenticated retain/unretain/pin/unpin correction
steps. A graph-derived neutral prefix guarantees consumption, a nonrefreshing
turn and an inert time advance for every fixed seed. I-10 exercise detection
requires actual decay, successful consumption and a step without turns. Positive
and separate negative self-tests cover all three properties. I-3 remains active;
I-1/I-2/I-4–I-9 keep their existing upstream-service dependencies and todos.

## Agent observations (#697)

The real adapter starts `shared-service-agent` and the existing internal persona
inbox. Snapshots add real `agents`, denied `operationAttempts` and `handoffs` after
human coverage replaces CET responsibility. I-1, I-2, I-4 and I-9 now run alongside
I-3 and I-10. A graph-derived seeded prefix touches both ends of an eligible edge
and delivers second-person coverage so handoff exercise cannot be accidental.
Each actual external/high operation is separately attempted and rejected in
`tests/shared-service-agent.service.test.js`; 24 seeded draws from the real model
exercise generic mandate and lifecycle behavior.

All active real-service invariants share each fixed-seed execution and are checked
after every step. Individual invariant tests still verify their own exercise;
this avoids multiplying broker/database work as services arrive. Observation
caching applies only within those deterministic histories; injected isolated
service tests read fresh snapshots. No production behavior or oracle is replaced.
See `docs/SHARED_SERVICE_AGENT.md` for costs, feedback and the exact #699 interface.

## Wake observations (#699)

I-6 is active against the real wake service and the real shared-service agent from
#697 / PR #718. The adapter preserves agents, denied operationAttempts and handoffs.
The graph-derived prefix supplies actual human turns followed by wake-exercise.
It advances the injected clock to an actual agent's persisted nextAt and dispatches
shared-service-agent.runCycle({tenantId, agentId}) through the scheduler. emptyWakes
records before/after intervals only when the persisted empty-cycle counter increases.
Hybrid promotion keeps due scheduling exercisable for real-model listeners.
I-3 and I-10 continue against real activation and actual agent consumption.

Separate tests cover pure event/no polling, tenant/scope rejection, exhausted
attention, funding-only rearming, errors, two-instance revision claims, one timer,
shutdown and real PouchDB restart with journal metrics. See
[SHARED_SERVICE_WAKE.md](SHARED_SERVICE_WAKE.md) for boundaries and parameters.
The unchanged 59-second harness deadline applies; each PR reports measured runtime.

## Signal observations (#722)

I-11 requires `services/signals.service.js`, `src/signal-projection.js` and the real
agent. `signalObservations[]` records actual persisted observations: an input hash
(response, operation and context), signals with IDs/kinds/states, complete-output
fingerprints and preceding outputs for identical inputs, source (`agent-cycle` or
`request`), actual findings and the cycle's actual proposal count. A bounded
snapshot keeps the last 64 observations; no production persistence is substituted.
A separate `signalCalls[]` trace includes calls with no projected output. Request
origins are marked explicitly around adapter requests; unmarked non-cycle calls
are `outside` and fail I-11. Separate negative self-tests corrupt findings,
proposals, determinism, call origins and observation origins.

The adapter starts the real signals service at the existing PouchDB constructor
seam. Upstream Dashboard responses are replayed from the committed catalog,
including explicit native context states; the adapter never probes real Dashboard
operations or generates a catalog. Each fixed-seed real history includes two
identical authenticated requests with a catalog-derived opaque context. Actual
agent cycles remain wrapped to associate proposal counts with their observations.
The existing I-1–I-10 dependencies and observations are preserved, including the
still-pending #700/#701 service dependencies. No #721 core file is changed.

The local and CI commands print wall-clock runtime and enforce the same 59-second
deadline. PR #722 reports both measurements. AC-06 separately uses real Dashboard
operations through real agent cycles; these are requested observations, not
catalog probes. All AC-03 checks read the committed catalog without live calls.
