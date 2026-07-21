# White-Label MaKo API Migration Readiness

## Purpose

Suppliers and grid operators that started on a full white-label stack often need to move business logic, tariffing, billing, receivables and customer service into their own backend while keeping Marktkommunikation (MaKo) as an externally operated layer. This use case gives that migration team a **read-only readiness dossier** that keeps two things separate:

- API/integration migration observations and completion criteria (`evu_api_migration_diagnostics`),
- official MaLo/MeLo/UTILMD/MSCONS/EDM market-communication evidence versus portal hints and synthetic sandbox transcripts (`market_communication_evidence_chain`).

This is a documentation and routing-verification slice over two **existing** dossier routes. It does not add a MaKo backend, AS4 transport, GPKE/EBD process engine, EDIFACT generation, external connector, or billing/tariff integration.

## Boundary

The slice composes only existing, already-shipped surfaces:

- `GET /api/dashboard/evu-api-migration-diagnostics` / `dashboard-api.evuApiMigrationDiagnosticsStatus`
- `GET /api/dashboard/market-communication-evidence-chain` / `dashboard-api.marketCommunicationEvidenceChainStatus`
- Capability Broker keys `evu_api_migration_diagnostics` and `market_communication_evidence_chain`
- Answer-Dossier hydration for those two status actions
- optionally, **synthetic Stadtwerk-Mauer sandbox evidence** via the existing read-only `stadtwerk-mauer-external-interface-stubs.getStatus` (`GET /status`) — this only reports counts/transcripts already recorded for the `mako_lieferantenwechsel` stub family; it never triggers a new simulation and is never treated as real Marktkommunikation

Explicitly **not** part of this slice, even though they exist elsewhere in the codebase as future integration boundaries: `mscons-import.parse`, `mscons-import.import`, `williMakoEnabled`, `edm.*` mutation paths, and the `mako_lieferantenwechsel` sandbox *write* path. None of these are enabled or invoked here.

## Two routes, two kinds of evidence

### `evu_api_migration_diagnostics` — integration/migration diagnostics

Use for questions about the REST/API migration itself: which endpoint, method, auth scope, request shape, validation error, response code, completion criterion, owner and next step apply to a White-Label → own-backend cutover step. It never calls a live endpoint, runs an OAuth flow, reads a secret, executes a JSON Patch, retries a request, closes a migration task, or creates a HITL item.

### `market_communication_evidence_chain` — MaKo/EDM evidence chain

Use for questions about whether a market-communication fact (MaLo/MeLo identity, UTILMD master-data path, MSCONS/meter-value delivery, EDM data quality, dynamic-tariff/iMSys billing readiness) is backed by **official** evidence or only by a **hint**. Portal screenshots, provider statements and customer statements are surfaced as hints, never as proof. It never persists MaKo state, never parses UTILMD/EDIFACT, and never releases settlement or billing.

## Evidence classes

Every fact in the dossier carries one of three evidence classes:

- `official` — a real MaLo/MeLo/UTILMD/MSCONS/EDM record, or a real API response/validation observation from the migration diagnostics route.
- `operator_observation` — a portal hint, provider statement, or customer statement supplied by the operator; useful context, never proof.
- `synthetic_stub` — a Stadtwerk-Mauer sandbox transcript (`mako_lieferantenwechsel`, `msb_edm_plausibility`, etc.); demonstrates the process shape only and must never be presented as a successful real MaKo, GPKE/EBD, AS4, meter, billing or settlement outcome.

## Completion criteria

The dossier is "complete" for a migration step only when it can point to `official` evidence for the fact in question (or an explicit, positively-framed follow-up naming the missing MaLo/MeLo/UTILMD/MSCONS/EDM record, owner and deadline). `operator_observation` and `synthetic_stub` entries close a gap in the narrative but never close the evidence gap itself.

## Non-goals

- No AS4 transport, no EDIFACT generation or dispatch, no UTILMD/MSCONS import and no `williMakoEnabled` activation.
- No GPKE/EBD deadline engine or process execution.
- No MaKo dispatch, supplier switch (Lieferantenwechsel), billing, settlement, tariff, CRM, customer communication, webhook, device-control, HITL/workflow or external connector call.
- No secrets, certificates, wallet/key material, credential creation/broadening or production data.
- No Personal-Agent hardcoding and no production deployment.

Any real transport/process-engine/connector slice for MaKo-as-a-Service requires a separately authorized architecture and security track.

## Example prompts

Migration diagnostics:

> "Pruefe White-Label API Migration Diagnostics fuer den Wechsel vom Full-White-Label-Setup zu unserem eigenen Backend: Schnittstellenmigration, OAuth Scope Diagnose, Request Validation Error, Response Code Diagnostics und Endpoint /api/v2/malo/patch."

MaKo evidence-chain review:

> "Pruefe die Marktkommunikations Evidenzkette fuer die White-Label Migration mit MaLo MeLo UTILMD Stammdatenweg, MSCONS Zaehlerwerten und EDM Datenqualitaet Nachweis vs. synthetischem Sandbox-Hinweis."

Both prompts route to a read-only dossier status action; neither prompt — including a variant that explicitly asks to dispatch, import, or settle — resolves to a dispatch, import, billing, settlement, tariff or external-call action.

## Safety

Safety classification: `read_only_migration_readiness_dossier`. Both underlying routes are read-only and dossier-safe; no route in this slice mutates MaKo, EDM, billing, settlement, tariff, CRM, HITL, webhook or device-control state, and no route makes an external call.
