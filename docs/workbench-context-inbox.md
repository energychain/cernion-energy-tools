# Workbench Context, Playbooks and Inbox Tasks

RC3 adds a CET-owned context and task layer for Open WebUI clients. Open WebUI remains the UI/client; CET owns context selection, governance, case state and audit.

## User and workspace context

Workbench admins can store tenant-bound user-context profiles and workspace-context profiles. These profiles hold role families, allowed domains, sensitivity clearance, language/tone preferences, evidence-handling preferences and default no-call guards. Workbench chat loads these profiles server-side before calling the Domain Router, so profile/playbook context is not taken from user-editable prompt text.

Context loaded into classify/continue is summarized and sensitivity-filtered. Raw Open WebUI notes, calendar entries, workspace documents, task payloads or automation triggers are not injected blindly into LLM context.

## ContextRefs

Open WebUI artifacts can be represented as governed `ContextRef` records:

- `openwebui_note_ref`
- `openwebui_calendar_event_ref`
- `openwebui_workspace_doc_ref`
- `openwebui_task_ref`
- `openwebui_automation_trigger_ref`

A ContextRef is routing/UI/task context by default. Promotion into EvidenceRefs must use the explicit evidence attach path.

## Playbook registry

CET playbooks are tenant/workspace/domain/role scoped process hints. They carry routing signals, required evidence, allowed/blocked actions, no-call guards, handoff rules and event rules. Default playbooks cover MaKo clarification, EDM measurement issues, grid-connection prechecks, dossier/no-call review and Willi-MaKo supporting evidence usage.

Playbooks are audited CET records, not unmanaged prompt text. They can influence routing and no-call/evidence guidance, but they do not bypass Capability Broker, receipts, RBAC, HITL or Domain Router governance.

## Inbox tasks

Workbench Case Events can be derived into actionable inbox tasks. Tasks track:

- attention state, e.g. `evidence_required`, `clarification_required`, `readiness_review_required`, `domain_changed`
- owner role
- blocking reason
- next safe action
- assignment
- status: `open`, `in_progress`, `resolved`, `dismissed`

Displaying a task does not acknowledge or resolve the underlying Case Event. Resolving/dismissing a task records explicit task state but keeps the event audit trail intact.

## API surface

- `POST /api/workbench/admin/user-contexts`
- `POST /api/workbench/admin/workspace-contexts`
- `POST /api/workbench/context-refs`
- `GET /api/workbench/playbooks`
- `POST /api/workbench/playbooks`
- `GET /api/workbench/inbox/tasks`
- `POST /api/workbench/inbox/tasks/:taskId/assign`
- `POST /api/workbench/inbox/tasks/:taskId/resolve`
- `POST /api/workbench/inbox/tasks/:taskId/dismiss`

All endpoints remain tenant-bound and use CET authentication/RBAC. Open WebUI automation may display/remind/open tasks through this Workbench boundary but may not perform external or binding actions without CET governance.
