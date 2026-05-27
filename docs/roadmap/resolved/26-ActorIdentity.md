# v0.55.x Actor Identity & Routing - Bigger Picture

## Purpose

This document serves as the stable, overarching context for CoPilot Plan Mode when planning `v0.55.x` milestones.

`v0.55.x` addresses a fundamental architectural gap: the lack of a persistent, addressable Actor Identity & Routing Framework within the Cernion Energy Tools. Currently, the Personal Agent operates ephemerally, and VDMI matrix roles point to abstract entities rather than concrete, addressable humans or specialized agents. This hinders reliable cross-user HITL (Human-in-the-Loop) workflows and multi-agent coordination beyond a single chat session.

## Core Problem Statement

The Personal Agent (as a system gatekeeper via its chat endpoint) needs to be a persistent, reusable actor, not just a session-bound instance. VDMI matrices define roles (`finance-agent@cernion`, `billing@stadtwerk`), but these roles currently lack a mapping to an addressable persona (human or agent) that can receive proactive notifications, especially for HITL approvals, across different communication channels and tenant boundaries. Each Personal Agent instance is implicitly linked to a `sessionId` and a `userId` within a `tenantId`, but there's no framework to resolve a `VDMI role` to a `specific, addressable Persona` (human or specialized agent) that belongs to the *same tenant* and can be notified.

## Architectural Vision for v0.55.x

Introduce a robust, tenant-aware Actor Identity & Routing Framework. This framework will:

1.  **Define and persist Actor Personas:** Establish a central registry for all active participants in Cernion workflows, whether they are human users or dedicated AI agents.
2.  **Map roles to Personas:** Enable VDMI matrices and other workflow definitions to reference specific `PersonaId`s (tenant-scoped) instead of generic role strings.
3.  **Facilitate cross-user/cross-agent communication:** Provide mechanisms to reliably route notifications, HITL requests, and delegated tasks to the correct Persona via their preferred communication channels, always respecting tenant boundaries.
4.  **Ensure Tenant and User Isolation:** The core principle is that a Persona, and any associated Personal Agent, is *always* firmly bound to a single `tenantId`. Cross-tenant interactions for operational workflows (like HITL approvals) are explicitly prohibited by design, unless specifically configured via a highly secured delegation policy (non-goal for v0.55.x).

## Key Components to be Introduced/Modified

*   **`agent-persona.service.js` (NEW):** A central Moleculer service to manage the lifecycle (CRUD) and data of `Actor Personas`.
*   **`notification.service.js` (NEW/ENHANCED):** A service responsible for sending proactive, tenant-aware notifications to Personas via their configured communication channels (e.g., Signal, Email, internal Cernion UI).
*   **`personal-agent.service.js` (MODIFIED):**
    *   Integrate with `agent-persona.service` to resolve roles to Personas.
    *   Modify HITL handling to proactively notify the *responsible Persona* (not just the originating user) via `notification.service`.
    *   Potentially allow linking a `PersonalAgentSessionId` to a specific `PersonaId` for an "always-on" gatekeeper.
*   **`vdmi.service.js` (MODIFIED):**
    *   Update VDMI task definitions to reference `PersonaId`s (or resolve roles to Personas internally) for `verantwortlich`, `durchführend`, `mitwirkend`, `informiert`.
    *   Integrate with `agent-persona.service` to validate Persona assignments.
    *   When a HITL item is created, pass the `PersonaId` of the responsible actor to the `notification.service`.
*   **`hitl.service.js` (MODIFIED):** Ensure it works seamlessly with `agent-persona.service` to manage approvals for specific Personas.

## Persona Data Structure (`agent-persona.service.js` payload)

Each `Persona` should have:

*   `id`: Unique `PersonaId` (e.g., `tenantX/thorsten-human`, `tenantY/finance-agent`).
*   `tenantId`: The specific tenant this Persona belongs to (MANDATORY).
*   `personaName`: Display name (e.g., "Thorsten Zoerner", "Cernion Finance Agent").
*   `personaType`: `human` | `specialized-agent`.
*   `openclawUserId` (optional for `human`): The OpenClaw internal `userId`.
*   `assignedRoles`: `Array<string>` (e.g., `['billing@stadtwerk', 'management']`).
*   `communicationChannels`: `Array<{type: 'email'|'telegram'|'signal'|'openclaw-chat', address: string}>`.
*   `defaultPersonalAgentSessionId` (optional for `human` or `specialized-agent`): A persistent `sessionId` for proactive communication.
*   `status`: `active` | `inactive` | `on-leave`.
*   `createdAt`, `updatedAt`.

## Non-Goals for v0.55.x

*   **Full autonomous self-configuration of Personas:** Persona creation and role assignment will initially be manual or administrative, not driven solely by LLM inference.
*   **Complex multi-tenant delegation policies:** Focus is on robust single-tenant routing. Cross-tenant delegation is a future, higher-security-tier consideration.
*   **Migrating all existing VDMI roles:** Focus on core VDMI workflows first; phased migration of existing role strings is expected.

## Proposed Milestones (v0.55.x)

### v0.55.0 - Actor Persona Foundation
Create the `agent-persona.service.js` with schema, persistence (PouchDB/Object Store), and basic CRUD actions (create, get, list, update). Implement tenant-aware IDs.

### v0.55.1 - Role-to-Persona Resolution
Integrate `agent-persona.service` into `vdmi.service.js` and `personal-agent.service.js` to enable resolution of VDMI roles to concrete `PersonaId`s.

### v0.55.2 - Proactive Notification & HITL Routing
Implement `notification.service.js`. Modify `personal-agent.service.js` and `vdmi.service.js` to use `notification.service` for routing `MANDATORY_HITL_APPROVAL` events to the responsible Persona's communication channels. This includes proper handling of the `[embed]` directive for HITL items.

### v0.55.3 - Agent Persona "Always-On" Capability (Optional/Future)
Explore enabling persistent `PersonalAgentSessionId`s for Personas, allowing them to receive proactive messages and manage background tasks even without an active user chat.

## CoPilot Planning Protocol

For every `v0.55.x` milestone:

1.  Use this `Bigger Picture` document as stable context.
2.  Ask CoPilot for a `Plan Mode` response only.
3.  Require CoPilot to inspect the current codebase before proposing edits.
4.  Require a file-by-file implementation plan.
5.  Require tests and acceptance criteria.
6.  Review the plan before allowing implementation.
