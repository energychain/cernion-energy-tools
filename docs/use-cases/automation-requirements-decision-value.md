# Automation Requirements Decision Value

`automation_requirements_decision_value` is a read-only evidence gate for VNB/EVU teams that receive PowerBI, Power Automate, dashboard, Office automation or workflow wishes before the decision value is explicit.

The capability turns a tool request into a dossier-safe requirements card: which source system is affected, which moving-data flow moves, who owns the decision, which manual effort is reduced, which control point improves, which decision becomes possible, which follow-up process is enabled and where the stop/rollback guard is.

## Scope

- Capability key: `automation_requirements_decision_value`
- Read-only action: `dashboard-api.automationRequirementsDecisionValueStatus`
- HTTP route: `GET /api/dashboard/automation-requirements-decision-value`
- Evidence registry key: `automation_requirements_decision_value`
- Hydration action: `dashboard-api.automationRequirementsDecisionValueStatus`

## Required Evidence

- Requirement identity: `requirementId` or `requestTitle`
- Request type: dashboard, report, workflow, PowerBI, Power Automate or other automation wish
- Process area, decision owner and target gate
- Source system and moving-data flow
- Manual effort baseline
- Operational control point
- Decision value
- Follow-up process
- Data quality status
- Rollback or stop criterion
- Source snapshot and evidence references

## Statuses

- `needs_source_system`
- `needs_moving_data_flow`
- `needs_control_point`
- `needs_decision_value`
- `needs_follow_up_process`
- `needs_data_quality`
- `needs_rollback_or_stop_criterion`
- `ready_for_requirements_review`

## Non-Goals

This is not a requirements backend, workflow engine, approval queue, PowerBI builder, Power Automate builder, Office connector, ticket integration or cockpit UI. It must not create workflows, HITL items, VDMI mutations, external connector calls or Personal Agent shortcuts.
