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
persisted routing result; assertions never name the chosen capability. Every neighbor
edge from the committed `function-model.json` is preserved and checked for equality.
The only operation fixture restricts each function to one of its own real, permitted
contextual Dashboard reads, selected from the committed signal/operation catalogs.
The test does not create edges or seed coverage, recipients, agents or proposals.

External Open-WebUI IDs (`alice`, `bob`) differ from their mapped CET actor IDs
(`cet-alice`, `cet-bob`). Assertions use the CET IDs for coverage, context creators,
proposal associations and internal inbox delivery. No agent-persona entries are created.

External seams are empty startup embeddings/knowledge hints and a deterministic
structured proposal summary at the existing LLM facade. Text/chat generation
throws; no LLM credentials or network are required. All observations, budget charges,
proposal persistence/delivery, corrections and visibility checks run normally.

The creator receives a gap notice after exactly one activating case turn, at observed
coverage below the threshold. Further real case follow-ups fund at least one internal
proposal; this preserves the normal allowance and HITL policies.

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
8. Bob's confirmed “Ich übernehme …” transfers human coverage and retires the
   complementary agent.
9. Bob's inventory confirmation returns a polite admin-only answer and journals
   the rejection; no client exception and inventory remains false.

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
