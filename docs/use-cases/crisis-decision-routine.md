# Crisis Decision Routine

## Scope

`crisis_decision_routine` is a read-only evidence and management-readiness view for recurring crisis or ad-hoc topics. It turns a topic into dossier-safe facts: affected service or population group, required measures, finance exposure, knowledge state, training or operating-model need, owner, next decision gate, blocked follow-up and source evidence.

## First Slice

- Dashboard action: `dashboard-api.crisisDecisionRoutineStatus`
- REST route: `GET /api/dashboard/crisis-decision-routine`
- Capability key: `crisis_decision_routine`
- Hydration path: Capability Broker -> dashboard read action -> Hydration Registry -> slim Answer Dossier evidence

## Out Of Scope

- No new crisis persistence service, task backend or approval engine.
- No HITL, NOVA, VDMI, finance or operational mutation.
- No calendar, email, Teams or external connector.
- No automatic decision closure or legal/regulatory authority claim.
- No Personal-Agent hardcoding or one-off n8n branch.

## Acceptance Signals

The routine is decision-ready only when impact, measures, finance impact, knowledge state, training or operating-model need, owner, next gate and blocked follow-up are present. Missing fields are returned as positive follow-ups so the dossier can show what evidence would make the next management decision more reliable.
