# Workbench Willi-MaKo Evidence Connector

CET remains the case, audit and governance owner. Willi-MaKo is integrated as a tenant-scoped MaKo diagnostic evidence source for Workbench/Open WebUI cases.

## Prerequisites

Before a Workbench case can use Willi-MaKo evidence, CET must have:

- a Willi-MaKo mandant/user mapping via `/api/workbench/admin/willi-mako/mappings`;
- a tenant-scoped role alignment via `/api/workbench/admin/willi-mako/role-alignments` or the safe defaults;
- server-side Willi-MaKo service configuration (`WILLI_MAKO_BASE_URL` plus `WILLI_MAKO_CET_SERVICE_SECRET` or `WILLI_MAKO_CET_SERVICE_TOKEN`).

The connector does not use the legacy/global Willi admin token for customer Workbench flows.

## APIs

- `GET /api/workbench/willi-mako/sessions`
- `POST /api/workbench/cases/:caseId/willi-mako/evidence`
- `POST /api/workbench/cases/:caseId/willi-mako/link`

All calls are tenant-bound and actor-bound. A Willi mandant/user/email without an enabled CET mapping fails closed.

## Evidence model

Willi diagnostic summaries are stored as Workbench EvidenceRefs:

- `sourceType: willi_mako_ref`
- evidence types such as `mako_process_trace`, `mako_error_code_diagnosis`, `aperak_message`, `contrl_message`, `mscons_message_status` or `utilmd_master_data`
- `evidenceRole: diagnostic_signal`
- `claimStrength: supporting`
- `readinessReviewRequired: true`

APERAK/Z18 summaries emit routing signals such as `market_communication`, `aperak_z18` and `market_master_data`, but they do not automatically resolve the case. APERAK/AHB segment context, master-data history and human review remain required before any final claim.

## Safety boundaries

- Raw Willi chat history is not returned to Open WebUI or injected into LLM context.
- Service credentials/tokens/signatures never appear in Workbench responses, ToolRuns or EvidenceRefs.
- Willi staff visibility does not grant CET cross-tenant authority.
- Case linking writes an explicit Willi service API request and returns only a safe confirmation.
- No external MaKo message is prepared or sent by this connector.
