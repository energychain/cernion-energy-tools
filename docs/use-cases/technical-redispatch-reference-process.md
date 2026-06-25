# Technical Redispatch Reference Process

Issue: #295

This reference process validates the governance primitive stack for a technical
`redispatch` / `steuerbarkeitscheck` control case.

## Scope

The explicit service path is `governance.runRedispatchReferenceProcess`.

It composes the existing primitives:

- VDMI row shape with `controlCase`, `evidenceRequirements`, and `decisionPolicy`
- `governance.evaluatePolicy`
- `governance.deriveHitlResolverRoles`
- `governance.recordDecisionAudit`
- `governance.verifyDecisionAuditTrail`

The action is classified as `controlled_reference_write`: it appends exactly one
local decision/evidence audit entry and performs no operational side effects.

## Reference Row

The default row uses:

- `controlCase: redispatch`
- responsible VDMI role: `ROLE_NETZBETRIEB`
- contributor VDMI role: `ROLE_NETZPLANUNG`
- required evidence:
  - `technical_controllability_evidence`
  - `redispatch_scope_assessment`
  - `grid_operations_decision_basis`
- decision policy:
  - `onMissingEvidence: mandatory_human_decision`
  - `onConflictingSources: mandatory_human_decision`

This differs from the commercial/regulatory #296 reference process. #295
escalates on missing technical evidence; #296 escalates on financial or
regulatory impact.

## Guards

The reference action does not call:

- HITL creation
- grid or device control
- Redispatch dispatch
- MaKo, settlement, tariff, or billing execution
- external connectors
- Personal Agent execution

No Capability Broker route, Hydration Registry rule, Slim Dossier formatter,
REST endpoint, or cockpit UI is added in this slice because the reference action
has an explicit audit append. Future conversational or dossier consumption must
expose a separate read-only template/status action first.
