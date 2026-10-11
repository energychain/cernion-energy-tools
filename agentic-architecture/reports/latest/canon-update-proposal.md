# Canon Update Proposal

Generated: 2026-10-11T01:32:43.513Z

## Proposed persistent canon files

- `ARCHITECTURE_CANON.md` — target architecture and layer boundaries.
- `AGENTIC_CORE_DIRECTIVE.md` — directive for every coding agent that touches chat, routing, capabilities, evidence, HITL, or tools.
- `DOMAIN_ONTOLOGY.md` — stable fachliche primitives and synonyms.
- `NAMING_CONVENTIONS.md` — service/action/file naming rules and anti-patterns.
- `E2E_PROCESS_MAP.md` — user-facing EVU/Stadtwerk process map.
- `OPENWEBUI_AGENTIC_ROUTING.md` — how OpenWebUI sees and must route capabilities.
- `REFACTORING_BACKLOG.md` — persistent, small, PR-ready cleanup queue.

## First canon rule candidates

- New fachliche services must declare their capability mapping, evidence boundary, HITL boundary, and OpenAPI/OpenWebUI exposure state.
- The agentic core must route via capabilities and process state, not only filename/service-name keyword matching.
- Sidecars are advisory until a Tool Contract explicitly marks write/action permissions and required human approval.
- Public/user-facing claims require evidence or a bounded uncertainty statement.
- Refactors that rename functions/classes/services require GitNexus impact analysis before edits.

## Canon bootstrap status

This run created placeholder canon files only if missing. They are intended to be edited by the Shepherd in later review cycles, not overwritten each scan.
