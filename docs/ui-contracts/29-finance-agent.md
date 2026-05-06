# UI Contract 29 — Finance Agent

Version: 0.44.5
Status: Draft (backend-owned)

## Purpose

Deterministic finance/regulatory analysis for VNB use cases with evidence-bound synthesis.

Pipeline:
1. Query planning (ontology + legal intents)
2. Retrieval via `knowledge-rag.query`
3. L1/L2 evidence arbitration (`rule_plus_hyde` default)
4. Compliance checks (legal references + conflict detection)
5. Guarded synthesis (no claims without evidence)
6. Audit trail persistence (PouchDB)

## Base Path

`/api/finance-agent`

## Endpoints

### 1) POST `/analyze`
Run one finance analysis and persist result.

Request:
- `query` (required, min 8 chars)
- `mode`: `rule_only | rule_plus_hyde` (default `rule_plus_hyde`)
- `profileId`: string (optional, CYA Profil)
- `topK`: integer 2..20 (default `6`)
- `minScore`: number 0..1 (default `0.35`)
- `includeTrace`: boolean (default `false`)
- `sessionId`: string (optional)
- `datapointContext`: string[] (optional, explizite L1-Faktquellen)
- `includeMemoryContext`: boolean (default `true`)
- `includeA2AContext`: boolean (default `true`)
- `includeDatapointsContext`: boolean (default `true`)
- `contextLimit`: integer 1..20 (default `5`)
- `persistMemory`: boolean (default `true`)
- `persistDatapoints`: boolean (default `false`)
- `allowHypotheticals`: boolean (default `false`)

Response:
- `success`, `id`
- `status`: `ok | needs_clarification | hypothetical_scenario`
- `summary`, `answer`, `claims[]`
- `assumptions[]` (bei `hypothetical_scenario`)
- `hitlItem` (bei `hypothetical_scenario`, direkter Review-Link)
- `evidence[]` (pointId, score, level, text, metadata, oeoTags)
- `legalReferences[]`, `oeoTags[]`
- `findings[]`, `findingsCount`
- `steps[]`, optional `trace`
- `metadata.context` with loaded context counts (inkl. `profileLoaded`, `datapointContextLoaded`)
- `metadata.persistedDatapoint` (Ergebnis der optionalen Datapoint-Persistenz)

### 2) GET `/analyses`
List persisted analyses (newest first).

Query params:
- `status` (optional)
- `limit` (default `20`, max `100`)

### 3) GET `/analyses/:id`
Get full persisted analysis document.

### 4) GET `/prompts`
Expose internal prompt templates for governance/transparency.

### 5) POST `/memory`
Store (upsert) session memory in Object Store namespace `finance_agent_memory`.

Request:
- `sessionId` (required)
- `memory` (required object)

### 6) GET `/memory/:sessionId`
Read stored session memory for follow-up analyses.

## Finding Codes (Finance Agent)

- `FA_QUERY_PLANNED`
- `FA_EVIDENCE_RETRIEVED`
- `FA_RULE_EVIDENCE_USED`
- `FA_HYDE_CONTEXT_USED`
- `FA_RULE_HYDE_CONFLICT`
- `FA_REGULATORY_REFERENCES_MISSING`
- `FA_SYNTHESIS_GUARDED`
- `FA_NEEDS_CLARIFICATION`

## Notes

- Für `hypothetical_scenario` erzeugt der Backend-Flow zusätzlich ein HITL-Review-Item und gibt es direkt als `hitlItem` zurück.

- `L1_Rule` evidence is always prioritized over `L2_HyDE`.
- `L2_HyDE` is context only; conflicting polarity triggers a warning finding.
- Bei fehlender L1-Basis und `allowHypotheticals=true` liefert der Agent ein explizit markiertes Szenario (`hypothetical_scenario`).
- Missing legal references forces conservative downgrade to `needs_clarification`.
- Missing optional context providers (`object-store`, `datapoint`, `cya`) does not fail analysis; service degrades gracefully.
