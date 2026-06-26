# Anschlusskapazitaet Evidence Queue

This Wave-2 slice turns a broad VNB connection-capacity workflow into a small
read-only evidence queue for dossier and management review.

## In Scope

- Connection request id and Netzverknuepfungspunkt hint.
- Capacity assumption, grid restriction hint and future-demand context.
- Legal question marker and fNAV option marker as evidence questions only.
- Evidence status, owner, due date, next gate, missing evidence and positive
  follow-ups.
- Capability Broker routing and Answer Dossier hydration through
  `dashboard-api.anschlusskapazitaetEvidenceQueueStatus`.

## Guards

- No capacity reservation.
- No grid-connection approval or rejection.
- No fNAV or legal decision.
- No billing, tariff, MaKo, settlement, HITL, external connector or production
  mutation.
- No Personal-Agent shortcut or one-off n8n branch.

## Smoke Path

Use authenticated read-only `GET /api/dashboard/anschlusskapazitaet-evidence-queue`
requests with partial and complete query parameters. A partial request should
return explicit gaps and `sourceActions.notCalled`; a complete request should
return `ready_for_review` without executing any consequential action.
