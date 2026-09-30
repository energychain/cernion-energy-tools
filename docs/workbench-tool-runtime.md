# Workbench Governed Tool Runtime

The Workbench Tool Runtime is the CET-owned execution boundary for Open WebUI and other Workbench clients. Clients may request or suggest tool use, but CET authorizes, records and renders tool runs.

## Scope

Initial tool classes:

- `web_fetch`
- `web_browse`
- `mail_search`
- `mail_read`
- `document_fetch`
- `api_lookup`

The runtime stores every execution as a case-bound ToolRun and represents outputs as EvidenceRefs and/or receipt references. Raw credentials, service tokens and unrestricted tool output are not returned to Open WebUI or the LLM context.

## Governance

Tool availability is filtered by the Tool/Skill Governance Map using:

- tenant and actor identity
- current case domain
- actor roles
- tool side-effect class
- allowed/blocked tool lists
- sensitivity constraints where applicable

Supported side-effect classes:

- `read_only_external`
- `internal_cet_state`
- `internal_master_data`
- `external_business_effect`

`external_business_effect` remains blocked unless a future explicit CET RBAC/HITL path enables it. The current runtime records blocked attempts as ToolRuns with `status: blocked` and a `blockedReason`.

## APIs

- `GET /api/workbench/tools?domain=...`
- `POST /api/workbench/cases/:caseId/tools/:toolId/run`
- `GET /api/workbench/cases/:caseId/tool-runs`
- `GET /api/workbench/cases/:caseId/tool-runs/:toolRunId`
- `GET /api/workbench/governance-map/:domain`
- `POST /api/workbench/skills/filter`

## ToolRun result

A ToolRun contains:

- `toolRunId`
- `caseId`
- `tenantId`
- `actorId`
- `toolId`
- `toolClass`
- `sideEffectClass`
- `status`
- `inputSummary`
- `outputSummary`
- `evidenceRefs`
- `receiptRefs`
- `auditRef`
- timestamps
- optional `blockedReason`

## Skills

The governance map also filters Workbench playbooks/skills. Only active, role-compatible and domain-allowed skills are returned. Draft skills remain stored but are ignored by runtime filtering.

## Boundary

This runtime does not implement full browser automation, live mail access or tenant skill learning by itself. Those are separate connector/skill issues. This issue establishes the governed execution and audit contract they build on.
