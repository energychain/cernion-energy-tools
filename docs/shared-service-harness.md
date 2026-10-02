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

Set `SHARED_SERVICE_TEST_ADAPTER=/absolute/path/to/adapter.js`. The CommonJS module
exports `createAdapter({ functions, jest })` returning a fresh instance exposing:

- `apply(step)`: send tenant-scoped versioned touch/correction events, feed the
  existing turn signal path, issue an activity query, or advance the fake clock.
  Set touch `at` from that clock. Wait until events and at most one handoff cycle
  settle before returning. Observe actual operations and Knowledge/RAG calls.
- `snapshot()`: return the test-only observation envelope used by the oracles:
  `fresh`, `activations`, `agents`, `activationBound`, `tenantBudget`,
  `operationAttempts`, `activityQueries`, `emptyWakes`, `corrections`, `journal`,
  `authorizationChecks`, `handoffs`. Records keep the #693 fields and event names.
  Derive bounds independently from the function graph and tenant configuration,
  not from the number of activations being tested. Compute the journal digest
  independently from the response being checked. Capture before/after target,
  authorization and policy values around correction/coverage changes.
- `close()`: stop the broker and release timers and owned handles; called even
  when a step or invariant fails.

Adapters must instantiate the real services and inject an in-memory PouchDB test
double at the existing lifecycle-mixin seam. Production persistence remains through
`createPouchDbLifecycleMixin`; no adapter or DB dependency is introduced by #702.
They must exercise fresh state, touched/uncovered functions, denied external-effect
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

## Wording to reconcile during upstream integration

I-3 follows #702 literally: the total active count must fit both the independent
neighborhood bound and the tenant budget. #696 describes its budget specifically
as the number of CET-responsible functions. The adapter must document how its
configured budget maps to the total-active bound; the harness does not change
production budget policy to resolve this difference.

I-2 currently asserts that an uncovered activation with `touchedAt` is active.
#696 also allows dormancy after inactivity. When that service lands, agree the
observation window for “touched” and test it explicitly rather than weakening the
assertion silently. Both issues are pending real-service integration, not changes
to the #693 records or versioned events.

The existing Workbench intent router predates the domain-free core and contains
catalog vocabulary in older branches. It is not silently allowlisted in full.
#700 must expose its new generic activity-query logic at a checkable core path
(or add a reviewed scan boundary); add that path to the core config when it lands.
