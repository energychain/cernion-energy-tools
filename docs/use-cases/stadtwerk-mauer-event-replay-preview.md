# Stadtwerk Mauer Event Replay Preview

## Product Cut

`stadtwerk_mauer_event_replay_preview` is the first read-only slice for Stadtwerk Mauer event simulation. It exposes a deterministic synthetic event catalog and replay preview without starting a recurring simulation or injecting events into runtime systems.

## Event Envelope

Each preview event is tenant-bound to `stadtwerk-mauer` and includes:

- `eventId`
- `tenantId`
- `occurredAt`
- `eventType`
- `sparte`
- `marketRole`
- `sourceActor`
- `payload`
- `expectedRouting`
- `evidenceQuality`
- `sideEffectPolicy`
- `followUpClass`

## Covered Event Families

The catalog covers PV/electrician flows, grid connection, market communication, metering/EDM, customer service, Strom/Gas/Wasser/Waerme, operations incidents, procurement/balancing, and Energy Sharing / paragraph 42c context.

## Replay Contract

`GET /api/dashboard/stadtwerk-mauer-event-replay-preview?seed=<seed>&count=<n>` returns the same ordered replay preview for the same seed and count. `count` is bounded by the catalog size. Optional filters (`eventType`, `sparte`, `marketRole`, `sourceActor`) only narrow the preview; they do not mutate or persist anything.

## Safety Guards

Out of scope for this slice:

- scheduler, cron, event injection, event persistence, queue, stream, or event bus
- Eve runtime, agent execution, or agent artifact generation
- customer, MaKo, MSB, supplier, or electrician communication
- external connectors
- workflow, task, HITL, NOVA, or VDMI mutation
- grid/device control, billing, settlement, tariff, or switching execution
- Personal-Agent hardcoding

Consequential outcomes are represented only as `followUpClass`, `expectedRouting`, and positive dossier follow-ups.
