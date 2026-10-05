# Shared Service integration through Open WebUI (#729)

Run `npm run test:e2e:shared-service`. This separate CI job starts every core and
custom `*.service.js` as the entrypoint does, excluding only `api` and `mqtt-broker`.
It uses real PouchDB/SQLite services and a child process with a fresh temporary
working directory, isolated job/tenant/quota/forecast paths and no inherited credentials or
`.env`. No dependencies are added. #731 is already on the base, so shutdown must
succeed normally; every real stop hook is checked and no known-error suppression remains.
The child redirects only the two legacy absolute `data/sessions` and `data/reports`
filesystem paths into its temporary directory; their service code stays unchanged.

The test calls `openai-compatible.chatCompletions` with a service token and real
Workbench tenant/user mappings for Alice and Bob. The broker recommendation and
domain routing run normally. Selected capabilities are read from the actual
persisted routing result; assertions never name the chosen capability. A fixture
graph, derived from the committed function/signal/operation catalogs, connects all
possible touched functions to two distinct functions with permitted contextual
Dashboard reads. These real reads accept case IDs and reliably produce missing
input signals. This prevents #730 selection changes from choosing away the
integration under test. The selected functions' other operation memberships are
restricted in the fixture to those reads, keeping this test independent of unrelated
backends. The harness separately retains the unmodified committed graph and every
invariant.

The only external seams are empty embedding vectors for startup enrichment and
empty knowledge routing hints. Text/chat/structured LLM generation throws and its
call count must stay zero. No selected capability, case state, coverage, activation,
agent, gap, notice, correction or authorization result is stubbed.

The script prints a compact snapshot after every required step and the turn
transcript. It checks:

1. Explicit case start creates a case through the mapped Workbench principal.
2. Alice and Bob have independent coverage; the service token has none.
3. The actual case is present in complementary activation reasons; an agent exists.
4. A real contextual Dashboard observation creates an open gap list.
5. Alice receives an `L-` notice on her next mapped turn.
6. `L-n erledigt` is confirmed; gaps remain open until verified closed. A subsequent
   “Darum musst du dich nicht kümmern” correction removes CET responsibility only
   after confirmation.
7. Undo restores that confirmed responsibility change through the learning service.
8. Bob's confirmed self-responsibility transfers human coverage and retires the
   complementary agent.
9. Bob's inventory request is recognized, but confirmation fails without admin
   authority; inventory remains false.

Additional negative turns keep the case count unchanged. An unmapped service turn
increments the skip counter and receives no coverage. Unit tests additionally cover
IDs-only output, tenant/clearance/registered-agent/read-only checks, `off`, invalid
settings, journal failure, bounded relevant-turn expiration, German/English
correction variations, readable labels and at most five candidates. The existing
PouchDB restart tests use the additive agent context action seam.

A newly qualifying recipient can receive an already open gap on its next
observation even if the first observation preceded human coverage. Republishing
uses the same content-event identity, preserving once-only delivery to people who
already received it.

For reproducible reporting, record the final line's wall-clock time separately from
Jest's test duration. The local acceptance run on Node 24.18 started 155 services,
completed in 7.83 s, and passed every real stop hook. Its corresponding unchanged
harness invariants completed in 29.44 s. CI independently repeats the e2e on Node 22.
