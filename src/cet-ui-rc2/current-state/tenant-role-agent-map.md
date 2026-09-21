# CET UI RC2 — Current-State Mapping: Tenant, Role, Agent and HITL

Status: implementation discovery for #CETReleaseRC2
Base: `origin/main` at PR #590 merge plus branch `feat/cet-release-rc2-ui`
Date: 2026-09-21

## Purpose

This document maps the existing CET surfaces that RC2 UI must reuse before introducing new contracts. It separates confirmed code from partial support and assumptions.

RC2 premise:

- A tenant represents a Stadtwerk / energy utility.
- A user belongs to one tenant and may have multiple tenant-scoped roles.
- A role may be assigned to several people.
- A role may have no human user.
- Empty roles are served by tenant-scoped placeholder agents that may take HITLs for their role.

## Confirmed code surfaces

### Tenant context

Code:

- `src/tenant-context.js`

Confirmed behavior:

- `DEFAULT_TENANT = 'default'`
- `getTenantId(ctx)` reads `ctx.meta.tenantId` and falls back to `default`.
- `tenantNamespace(baseNamespace, tenantId)` creates tenant namespace strings.
- `tenantKey(baseKey, tenantId)` creates tenant-prefixed keys.
- `validateTenantId(tenantId)` accepts lowercase `a-z`, `0-9`, `-`, up to 64 characters.
- `isTenantAllowed(tenantId)` uses optional `CERNION_ALLOWED_TENANTS` allowlist.

RC2 implication:

- UI Gateway must resolve tenant through existing gateway/meta flow, not from arbitrary frontend body fields only.
- RC2 test tenants should use lowercase/hyphen IDs, e.g. `rc2-stadtwerk-a`.

### Tenant and user provisioning registry

Code:

- `src/provisioning-registry.js`
- `scripts/provision-tenant.js`
- package scripts `tenant:create`, `user:create`

Confirmed behavior:

- `upsertTenant({ tenantId, name })` persists tenant registry rows.
- `upsertUser({ tenantId, userId, email })` persists user registry rows.
- Registry rows include `tenantId`, `userId`, optional `email`, `createdAt`, `updatedAt`, `source`.
- The registry does not currently model assigned roles on users.

RC2 implication:

- The existing provisioning registry can confirm tenant/user existence.
- It is insufficient as the role assignment source for RC2 UI.
- RC2 role assignment should use `agent-persona` / role metadata or add a thin RC2 adapter rather than overloading provisioning rows without tests.

### Caller role extraction

Code:

- `src/auth-role-helpers.js`

Confirmed behavior:

- `extractCallerRoles(ctx)` reads roles/groups/scopes from `ctx.meta.authUser`, `ctx.meta.roles`, `ctx.meta.apiToken.scopes`, `ctx.meta.apiToken.scope`, `ctx.meta.scopes`.
- `hasFullAccessPrincipal(ctx)` recognizes `full-access` and `cross-tenant-admin`.
- `callerHasAnyRole(ctx, requiredRoles)` checks role overlap and treats empty requirements as permissive for backward compatibility.

RC2 implication:

- UI Gateway can reuse this helper for resolver-role enforcement and active-role validation.
- RC2 must not expose role choices the caller does not present in the tenant context.

### Agent/persona registry

Code:

- `services/agent-persona.service.js`
- `tests/agent-persona.service.test.js`

Confirmed behavior:

- Persona schema includes `tenantId`, `id`, `personaName`, `personaType`, `assignedRoles`, `communicationChannels`, `status`.
- `personaType` enum currently includes `human` and `specialized-agent`.
- `assignedRoles` is an array of strings.
- `agent-persona.resolveByRole` resolves active personas for a role inside a tenant and returns `items[]`.
- Tests confirm same persona ID can exist in different tenants and reads are tenant-isolated.

RC2 implication:

- Existing `agent-persona` is the closest match for role-to-person/agent assignment.
- A placeholder agent can likely be represented as a `specialized-agent` persona with assigned role and tenant.
- If RC2 needs a distinct semantic type `placeholder-agent`, this requires an extension of `PERSONA_TYPES`; otherwise use `personaType: specialized-agent` plus RC2 metadata/resolution policy.

### HITL role/persona routing

Code:

- `services/hitl.service.js`
- `tests/hitl.service.test.js`

Confirmed behavior:

- `hitl.create` accepts `responsibleRole`, `requiredResolverRoles`, `personaId`, `routingContext`.
- `hitl.create` calls `resolvePersonaRouting(ctx, tenantId, params)`.
- Role resolution calls `agent-persona.resolveByRole` with `{ tenantId, role }`.
- When a persona is found, HITL stores `personaId`, `personaName`, `personaType`, `responsibleRole`, `requiredResolverRoles`.
- If roles exist but no persona is found, HITL stores role metadata with null persona fields.
- `resolveItem` enforces resolver roles via `auth-role-helpers` unless caller has full-access/cross-tenant-admin.

RC2 implication:

- HITL already has the key role-based route and tenant-isolated persona lookup needed for Freigabeanforderung.
- RC2 placeholder-agent behavior should either seed a specialized-agent persona for empty roles or extend `resolvePersonaRouting` to synthesize a placeholder agent. Seeding is lower risk.
- Tests must verify empty role does not become an error and is addressable by placeholder agent.

### VDMI role derivation and routing

Code:

- `src/vdmi-hitl-role-derivation.js`
- `services/vdmi.service.js`

Confirmed behavior:

- `deriveHitlResolverRoles(input)` extracts responsible/contributor roles from VDMI rows.
- Missing responsible role is tracked as evidence gap, not silent success.
- `vdmi.service.js` also resolves personas by role through `agent-persona.resolveByRole`.

RC2 implication:

- Existing VDMI role derivation is useful for future role bridge mapping.
- RC2 should still define its own reference fixture roles because RC1/VDMI example roles are not canonical for the new UI reference case.

## Partial support / gaps

### User-to-role mapping

Current support:

- `agent-persona.assignedRoles` maps personas to roles.
- `auth-role-helpers.extractCallerRoles(ctx)` maps request metadata to caller roles.

Gap:

- `provisioning-registry.upsertUser` does not store roles.
- There is no single explicit `user belongs to tenant and has roles` domain object found in discovery.

RC2 handling:

- For RC2 UI, model the active user/session context as a UI Gateway view model assembled from tenant meta + auth roles + agent/persona registry.
- Do not assume provisioning user registry alone is enough.

### Placeholder agents

Current support:

- `agent-persona` supports `personaType: specialized-agent`.
- HITL can route to a persona resolved by role.

Gap:

- No confirmed `placeholder-agent` persona type.
- No confirmed automatic placeholder creation when role is empty.

RC2 handling:

- Lowest-risk RC2 fixture: create/represent placeholder agents as `specialized-agent` personas with deterministic IDs, e.g. `rc2-stadtwerk-a/agent-market-admin`.
- Add `resolutionPolicy` or metadata to mark them as placeholder-role agents if needed.
- If product semantics require a distinct `placeholder-agent`, add it only with RED tests against `agent-persona.service`.

### Multiple people per role

Current support:

- `agent-persona.resolveByRole` returns `items[]`, not a single item.
- HITL routing currently takes the first item when resolving by role.

Gap:

- HITL default selection picks first persona; RC2 O1 needs explicit two-person Marktkommunikation handling for Übernahme/concurrency.

RC2 handling:

- UI daily surface and Laufkarten state must model multiple eligible actors for a role.
- HITL routing may continue to assign first persona for simple resolver workflows, but RC2 claim/Übernahme logic must not collapse the role to one person before claim.

### Canonical RC2 role IDs

Current support:

- `agent-persona.service.js` defines a separate `ROLE_IDS` catalog: `grid_planner`, `asset_mdm_operator`, `redispatch_coordinator`, `market_communication_operator`, `governance_reviewer`, `system_agent`.
- RC1 tests use legacy/example `ROLE_*` names.

Gap:

- RC2 requires six fachliche Rollenfamilien: Marktkommunikation, Regulierungsmanagement, Controlling, Abteilungsleitung, Geschäftsführung, Mandantenadministration.
- There is no confirmed exact canonical API role set for all six.

RC2 handling:

- Do not reuse RC1 `ROLE_MANAGEMENT` as Geschäftsführung/Abteilungsleitung.
- Task A7 must either map to existing role IDs or introduce RC2-local test role IDs explicitly marked as fixture IDs.
- A later product hardening step should align these with the canonical role/persona catalog.

## Recommended RC2 reference fixture

Tenant:

- `rc2-stadtwerk-a`

Human personas:

- `rc2-stadtwerk-a/mako-1` — Marktkommunikation
- `rc2-stadtwerk-a/mako-2` — Marktkommunikation
- `rc2-stadtwerk-a/regulatory-1` — Regulierungsmanagement
- `rc2-stadtwerk-a/controlling-1` — Controlling
- `rc2-stadtwerk-a/department-lead-1` — Abteilungsleitung
- `rc2-stadtwerk-a/gf-1` — Geschäftsführung
- `rc2-stadtwerk-a/admin-1` — Mandantenadministration

Placeholder agent:

- `rc2-stadtwerk-a/agent-unassigned-role` — specialized-agent or future placeholder-agent for one unassigned role family

Cross-tenant negative fixture:

- `rc2-stadtwerk-b/mako-1` must never satisfy `rc2-stadtwerk-a` role resolution.

## Implementation rules derived from mapping

1. UI Gateway session context must expose tenant, current user/persona, available active roles and placeholder-agent routes.
2. Role switching must be restricted to roles present in the current tenant context.
3. Empty roles must not render as blank owner fields.
4. Empty roles should resolve to a placeholder agent or explicit placeholder-agent-needed state.
5. HITLs should use `responsibleRole` / `requiredResolverRoles` and, when possible, persona routing.
6. Claim/Übernahme concurrency must not use HITL first-person routing as its only ownership model.
7. RC2 tests must include two Marktkommunikation humans and one unassigned role family.
8. RC1 example roles remain historical fixture roles and are not canonical RC2 UI role IDs.

## Verification commands used for discovery

```bash
rg -n "getTenantId|tenantId|x-tenant-id|tenant:create|user:create|createTenant|createUser|role|roles|ROLE_|hitl|placeholder|agent" services src tests package.json
```

Reviewed files:

- `src/tenant-context.js`
- `src/provisioning-registry.js`
- `src/auth-role-helpers.js`
- `services/agent-persona.service.js`
- `services/hitl.service.js`
- `src/vdmi-hitl-role-derivation.js`
- `services/vdmi.service.js`
- `tests/agent-persona.service.test.js`
- `tests/hitl.service.test.js`
