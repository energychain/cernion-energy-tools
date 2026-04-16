# Decisions on Multi-Agent CYA Orchestrator Architecture

> **Context:** Responses to the "Further Considerations" raised during the initial implementation planning for the Synthetic Stakeholder Dialogues.

## 1. API Shape Decision
**Question:** Keep multi-agent mode behind `POST /api/cya/generate` options, or introduce a separate contract to reduce compatibility risk?

**Decision:** Keep it behind `POST /api/cya/generate` options (Strictly Backward Compatible).
**Rationale:** We do not want to fork the frontend logic. The UI should continue calling `/generate`. If the payload includes a trigger array (e.g., `"perspectives": ["technical", "commercial", "legal"]`), the backend internally routes to the new Orchestrator flow. If the field is missing, the system defaults to the classic v0.26.8 single-pipeline execution. This minimizes regression risk and allows for a phased rollout in the Vue UI.

## 2. Memory Backend Choice
**Question:** Use PouchDB-backed Object Store namespaces first, or plan a later indexing layer once persona-tagged document ingestion is defined?

**Decision:** Use existing PouchDB-backed Object Store namespaces as an MVP.
**Rationale:** Do not block the Multi-Agent orchestrator development waiting for a perfect semantic chunking/vector pipeline. For the initial implementation, let the Sub-Agents query their domain context via `object-store.query` restricted by their Persona namespace/tags (even if it's just structured JSON documents for now). The underlying semantic indexing engine (e.g., LanceDB integration) can be transparently swapped out later in `object-store.service.js` without touching the CYA Orchestrator logic.

## 3. Persona Source of Truth
**Question:** Reuse user-authored CYA profiles, or create an internal fixed catalog for technical/commercial/compliance roles?

**Decision:** Create an internal fixed catalog for Sub-Agents.
**Rationale:** The user-authored profiles (e.g., `stadtwerk_regulierung`) define the target audience and tone for the final *output* narrative. The Sub-Agents, however, need highly deterministic, system-level prompts to act reliably as a "Technical Planner" or "Compliance Officer" during internal negotiations. These should be hardcoded in a new module (e.g., `src/cya-agent-personas.js`) so we can tightly control their conflict-detection heuristics and grounding rules.

## 4. Perspectives Enum
**Question:** Make `perspectives` a strict enum from `src/cya-agent-personas.js`?

**Decision:** Yes.
**Rationale:** We must prevent hallucinated or unsupported roles. The orchestrator must validate the incoming `perspectives` array against a hardcoded enum (e.g., `['technical', 'commercial', 'compliance']`). This ensures predictable state management and guarantees that every requested persona has a defined system prompt and mapped Object Store namespace.

## 5. Memory Abstraction Layer
**Question:** Start MVP memory with Object Store namespaces plus `tags` conventions and keep retrieval behind an abstraction?

**Decision:** Yes.
**Rationale:** Encapsulate the persona memory fetch inside a dedicated helper function (e.g., `retrievePersonaContext(personaId)`). For the MVP, this function simply executes an `object-store.query` filtering by the appropriate tags/namespace. This abstraction boundary is critical: it allows us to seamlessly swap out the simple PouchDB query for a LanceDB vector search in the future without modifying the orchestrator or sub-agent logic.

## 6. Execution Divergence Point (Phase 1-3 vs Shared)
**Question:** Should personas rerun full retrieval/grounding independently, or share deterministic Phase 1–3 outputs and diverge only in persona memory plus synthesis?

**Decision:** Share Phase 1 & 2 (Base Reality), Diverge in Phase 3 (Grounding/Negotiation).
**Rationale:** Running Phase 1 (Retrieval) independently for each persona is inefficient and risks API rate limits (fetching the same MaStR/OSM data multiple times). 
- **The Flow:** The Orchestrator runs Phase 1 and Phase 2 once. This creates the "objective physical/regulatory reality" of the asset.
- **The Split:** The Orchestrator then passes this shared baseline into parallel Phase 3 executions for each persona. During Phase 3, the Sub-Agent queries its specific Object Store memory, interprets the baseline facts through its persona lens, and emits its specific risks/blocks. The Orchestrator then synthesizes these divergent Phase 3 outputs into the final narrative.
