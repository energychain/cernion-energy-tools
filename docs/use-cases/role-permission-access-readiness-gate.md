# Role-Permission / AccessManager Readiness Gate

## Purpose

The Role-Permission / AccessManager Readiness Gate is a read-only evidence contract for operational role readiness. It classifies supplied facts about role profiles, portal access, sFTP routes, permissions, IT/security clearance, training proof, reapproval status, owner, due date, and source evidence into a dossier-safe readiness status.

The first slice does not connect to AccessManager, provision IAM/RBAC state, store credentials, create users, mint tokens, send notifications, or execute workflow/HITL actions.

## Inputs

- `roleId`, `roleName`, `processType`, `gridOperatorId`, `accessManagerRef`, `tenantScope`
- `portalAccess`, `sftpRoute`, `rolePermission`, `securityClearance`, `trainingProof`, `reapprovalStatus`
- `owner`, `dueDate`, `sourcePath`, `sourceRef`, `caseId`
- `blockedAccess`, `missingEvidence`, `evidenceGaps`

## Status Model

- `unknown`
- `needs_role_profile`
- `needs_portal_access`
- `needs_sftp_route`
- `needs_role_permission`
- `needs_security_clearance`
- `needs_training_proof`
- `needs_reapproval_decision`
- `blocked_by_access_gap`
- `ready_for_operational_role`

## Dossier Evidence

The endpoint returns:

- `roleContext`
- `readinessSignals[]`
- `evidenceGaps[]`
- `blockers[]`
- `nextActions[]`
- `positiveFollowUps[]`
- `validationFindings[]`
- `sourceActions.notCalled[]`
- `dossierEvidence`

Each missing data point maps to a positive follow-up, for example missing `trainingProof` enables training readiness evidence and missing `reapprovalStatus` enables AccessManager reapproval evidence.

## Safety Guards

The gate is `read_only`. It may reference existing role/access concepts but must not call or mutate:

- AccessManager or external IAM systems
- IAM/RBAC/user/tenant/token provisioning
- credential storage
- HITL, VDMI, or workflow state
- notification or escalation systems
- external connectors
- Personal-Agent execution shortcuts

Consumption must stay on the standard path:

`Capability Broker -> dashboard-api.rolePermissionAccessReadinessGateStatus -> Hydration Registry -> Slim Answer Dossier`
