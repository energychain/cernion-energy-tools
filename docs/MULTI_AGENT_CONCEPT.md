# Synthetic Stakeholder Dialogues: Multi-Agent Architecture

> **Type:** Architecture Concept
> **Status:** Draft
> **Target Version:** Post-v0.26.8 (Cernion CYA)
> **Author:** Rhajaina
> **Date:** 2026-04-16

---

## 1. Executive Summary

This document proposes an architectural evolution for the Cernion CYA Agent, transforming the linear 4-phase pipeline (v0.26.8) into an **Orchestrator-Pattern Multi-Agent Framework** ("Synthetic Stakeholder Dialogues").

The goal is to solve the systemic EVU problem of "toxic, manual coordination meetings" by allowing distinct CYA-Agent Personas (e.g., Grid Planning, Controlling, Legal/Compliance) to negotiate grid connection scenarios autonomously, leveraging isolated memories, before presenting a consolidated, conflict-resolved plan to the human decision-maker.

## 2. Core Principles

1.  **Persona Isolation (Decentralized Memory):** Agents must not share a single monolithic LLM context. A `Grid Planner` agent queries technical standards (VDE-FNN) from its own memory space; a `Legal` agent queries EnWG and internal compliance rules.
2.  **KRITIS-Compliant Architecture:** To avoid external dependencies (like cloud-hosted Vector DBs), agent memories are backed by the existing **Object Store** (e.g., MinIO/S3 compatible) used in the "In-House Data Feature". 
3.  **Orchestrator Pattern:** A central session controller ("Master Agent" or "Meeting Chair") manages the state, delegates evaluation to sub-agents, collects their responses, and synthesizes the final outcome.
4.  **Graceful HITL (Human-in-the-Loop):** If sub-agents reach a hard conflict or hit a `needs_clarification` threshold (e.g., missing budget data), the Orchestrator pauses the negotiation and bubbles the clarification request up to the human user, retaining the async job pattern defined in v0.26.5.

## 3. Architecture Integration (Extending v0.26.8)

The current architecture relies on a linear 4-Phase pipeline:
`Retrieval (1) -> Regulatory Graph (2) -> Grounding (3) -> Synthesis (4)`

To support Multi-Agent dialogues, we wrap Phase 1-3 inside parallel executions per Persona, and upgrade Phase 4 into the Orchestrator.

### Revised Workflow

**Phase 1: Session Initiation (Orchestrator)**
*   Receives `POST /api/cya/generate` with a `scenario` (e.g., "Connect 5MW Data Center").
*   Determines required Stakeholders based on the scenario (e.g., `[technical_planning, commercial, compliance]`).

**Phase 2: Parallel Stakeholder Evaluation (Sub-Agents)**
*   The Orchestrator spins up parallel sub-processes.
*   Each Sub-Agent executes the standard **Phase 1 (Retrieval)** and **Phase 2 (Regulatory Graph)** *but constrained to their specific profile and isolated Object Store namespace*.
*   *Example:* The Technical Agent resolves `VOLTAGE_THRESHOLDS` (A1 feature) to `MS, severity: none` and retrieves OSM data. The Commercial Agent retrieves internal budget constraints from its designated Object Store path.

**Phase 3: Asynchronous Negotiation & Grounding (The "Dialogue")**
*   Sub-Agents submit their `signals[]` and `facts[]` to the Orchestrator.
*   The Orchestrator detects conflicts (e.g., Technical says "Approved, copper expansion", Commercial says "Rejected, budget exceeded").
*   *Synthetic Dialogue:* The Orchestrator prompts the Sub-Agents to resolve the conflict (e.g., "Technical, can we use a flexible NAV (§14a) to reduce CAPEX to meet Commercial's budget?").
*   *HITL Trigger:* If unresolved, the Orchestrator emits `needs_clarification` (Current UI Contract).

**Phase 4: Multi-Perspective Synthesis (Extending F2)**
*   The Orchestrator generates the final Narrative.
*   Output structure maps directly to the planned **F2: Multi-Perspective Synthesis** feature in `CR-CYA-NEXT.md`, presenting the consensus, remaining risks, and individual stakeholder views.

## 4. Data Ingestion & Indexing (In-House Data Integration)

To supply the agents with context without violating KRITIS constraints (no external SaaS Vector DBs), we leverage the existing **In-House Data Feature** (Layer 2 data pipeline).

1.  **Upload & Tagging:** Utilities upload internal documents (e.g., grid capacity reports, budget guidelines, legal precedents) via the existing Cernion frontend. Each document is tagged with specific Persona access rights (e.g., `tag: legal`, `tag: technical`).
2.  **Local Indexing:** Instead of an external Vector DB, documents are parsed, chunked, and stored natively in the **Object Store**. We can utilize embedded, file-based vector search (like LanceDB operating directly on the Object Store) or integrate the embeddings securely into the existing Graphology/PouchDB setup.
3.  **Agent Retrieval:** During Phase 1 (Retrieval), the Sub-Agent queries the Object Store using its assigned Persona tag. It retrieves only the locally indexed document chunks relevant to its domain.

## 5. Technical Hooks (Moleculer Backend)

To implement this without breaking the existing `20-cya.md` contract:

1.  **Async Job Engine:** The existing HTTP 202 polling mechanism is perfect. The `status` field simply cycles through `negotiation_round_1`, `negotiation_round_2`, etc.
2.  **Session Persistence:** The `cya_sessions` PouchDB doc will need an array: `stakeholder_states: [{ persona: 'tech', facts: [] }, ...]`.
3.  **Token Propagation (A2):** The `cernionToken` must be passed down to all sub-agent MCP calls to ensure deterministic MaStR retrieval works across the board.
4.  **Refinement Loop (A3):** The `refinement_cycle` directly supports the user intervening in a stalled negotiation.

## 6. Next Steps for Implementation

1.  **Define Sub-Agent Personas:** Formalize the system prompts and Object Store access policies/tags for the 3 primary roles (Technical, Commercial, Compliance).
2.  **Data Ingestion Pipeline:** Extend the In-House Data Feature to automatically chunk and index PDFs into the Object Store with Persona tags.
3.  **Orchestrator Logic:** Write the conflict-detection heuristic (when to prompt agents to negotiate vs. when to hit the `needs_clarification` guardrail).
4.  **Pilot Scenario:** Implement the "5MW Battery with flexible NAV" edge case as the test harness.