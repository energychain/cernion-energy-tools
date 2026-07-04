# Gremiencoach Workbook Readiness

## Decision

#386 is implemented as a private-prep, read-only readiness contract for anonymized VNB committee workbooks.

The first slice exposes `dashboard-api.gremiencoachWorkbookReadinessStatus` and `GET /api/dashboard/gremiencoach-workbook-readiness`. It returns deterministic scalar rows for candidate claims, evidence gaps, process/VDMI context, draft artifact intents, guardrails and positive follow-ups.

## Safety Boundary

The endpoint does not upload, parse, retain, embed, train on or quote private Word, PowerPoint, Excel, PDF, protocol, email or Teams content. Draft artifact rows describe allowed intents only; they do not create Office files.

Out of scope: M365/SharePoint/Graph, mail/calendar/task actions, publication, finance/legal/regulatory decisions, MaKo, billing, settlement, tariff, device control, HITL/workflow execution, Budibase writes, secrets/key material and Personal-Agent hardcoding.

## Consumption Path

- Capability Broker route: `gremiencoach_workbook_readiness`
- Read-only action: `dashboard-api.gremiencoachWorkbookReadinessStatus`
- Hydration rule: `dashboard-api.gremiencoachWorkbookReadinessStatus`
- Evidence Registry key: `gremiencoach_workbook_readiness`

Unsupported claims remain `not_yet_claimable` until the required evidence boundary is supplied.
