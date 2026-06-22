# Stadtwerk Mauer Capability Projection

Issue #264 Phase 2 exposes a read-only role/capability projection for the Stadtwerk Mauer MVP.

The slice reuses the shipped `stadtwerk_mauer_vdmi_profile`, Capability Broker catalog metadata, Hydration Registry rules, and generated LLM/tool descriptors. It does not create Eve agents, choose an Eve artifact repository, schedule events, provision tenants, or execute workflows.

## API

- Action: `dashboard-api.stadtwerkMauerCapabilityProjectionStatus`
- REST: `GET /api/dashboard/stadtwerk-mauer-capability-projection`
- Capability: `stadtwerk_mauer_capability_projection`
- Default tenant/profile: `stadtwerk-mauer`
- Default roles: `management`, `grid-planning`, `asset-management`, `regulatory`

Optional query params:

- `roles=management,grid-planning`
- `includeConsequential=true|false`
- `includeDescriptorSources=true|false`

## Contract

The response is dossier-safe and read-only:

- role-scoped read-only capabilities
- role-scoped advisory capabilities
- consequential follow-up classes, marked as non-executable proposal/task/VDMI/NOVA handoffs
- VDMI responsibilities and source profile roles
- evidence gaps and positive follow-ups
- descriptor provenance
- no-side-effect guard list

Consequential entries are classification facts only. They are not executable actions.

## Out Of Scope

- Eve runtime, scheduler, channels, subagents, or agent files
- event simulation or event injection
- tenant/user/token provisioning
- NOVA, VDMI, HITL, workflow, task, notification, or external connector mutation
- Personal-Agent hardcoding or one-off n8n branches
- #252 security/key-policy work
