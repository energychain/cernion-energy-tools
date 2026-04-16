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
