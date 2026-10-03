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
No handwritten domain word list is used. Generic catalog collisions may only be
exempted with a term and a reviewable reason in
`scripts/domain-free-core.allowlist.json`; a longer domain phrase is not exempted
by allowing one of its generic tokens. The contamination self-test creates a
fixture file from an actual catalog keyword and verifies CLI exit status 1.

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
