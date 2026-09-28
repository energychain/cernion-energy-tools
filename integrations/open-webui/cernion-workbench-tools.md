# Open WebUI / Cernion Workbench tool contract

Use these Workbench endpoints from Open WebUI tools or middleware. Do not expose CET service tokens to the browser or model context.

## Tools

- `cernion_workbench_chat` → `POST /api/workbench/chat`
- `cernion_get_case` → `GET /api/workbench/cases/:caseId`
- `cernion_list_cases` → `GET /api/workbench/cases`
- `cernion_list_events` → `GET /api/workbench/events`
- `cernion_ack_event` → `POST /api/workbench/events/:eventId/ack`
- `cernion_attach_evidence` → `POST /api/workbench/cases/:caseId/evidence`
- `cernion_render_dossier` → `POST /api/workbench/cases/:caseId/dossier`

## System rule

For energiewirtschaftliche tasks, call `cernion_workbench_chat` first. Continue the same Open WebUI conversation through the same `openWebuiConversationId`; CET decides whether the turn is classify or continue.

If CET returns `readinessState=evidence_required`, ask for evidence or show missing evidence. Do not claim approval, Freigabe, Buchung, market-message dispatch or binding regulatory conclusions.
