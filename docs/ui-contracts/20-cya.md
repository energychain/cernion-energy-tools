# UI Contract: CYA Agent API

> **Page ID:** `cya`
> **Version:** 0.44.5
> **Last updated:** 2026-05-06
---

## Endpoints & HTTP Patterns

| Method | URL | HTTP Response | Purpose |
|--------|-----|---|---------|
| `POST` | `/api/cya/profile` | 200/422 | Create or update stakeholder profile |
| `GET` | `/api/cya/profile/:profile_id` | 200/404 | Load one profile |
| `GET` | `/api/cya/profiles` | 200 | List profiles |
| `POST` | `/api/cya/generate` | **202/200** | Generate narrative (async REST / sync internal) |
| `POST` | `/api/cya/refine` | 200 | Refine session with clarification response |
| `GET` | `/api/jobs/:jobId/status` | 200 | Poll async generation progress |
| `GET` | `/api/jobs/:jobId/result` | 200 | Fetch completed result |

---

## POST /api/cya/generate — Async Job Pattern (v0.26.5+)

### Request

```json
{
  "profile_id": "stadtwerk_regulierung",
  "location": "Höheinöd",
  "context": {
    "capacity_mw": 50,
    "location": "Höheinöd"
  },
  "focus_areas": ["capacity", "renewables", "section14a"]
}
```

### Response: HTTP 202 (REST Gateway)

```json
{
  "jobId": "cya_job_abc123",
  "status": "queued",
  "statusUrl": "/api/jobs/cya_job_abc123/status",
  "resultUrl": "/api/jobs/cya_job_abc123/result",
  "retryAfter": "PT5S"
}
```

**Client Flow:**
1. POST /api/cya/generate → HTTP 202 + jobId
2. Poll GET /api/jobs/{jobId}/status every 3–5 seconds
3. When status = 'completed', GET /api/jobs/{jobId}/result

### Response: Full Result (Sync Internal OR HTTP 200 After Polling)

```json
{
  "success": true,
  "session_id": "cya_1713110400000",
  "status": "completed",
  "profile_id": "stadtwerk_regulierung",
  "target_audience": "Aufsichtsrat",
  "grounding": {
    "confidence": "high",
    "confidenceScore": 85,
    "facts": [
      {
        "statement": "SEE900000952467552 (PV, 8 kW, commissioned 2009) — legacy asset in area",
        "category": "technical",
        "confidence": "high",
        "sources": ["cernion_installations_local"],
        "dataProvenance": "mastr_machine_verified",
        "trusted": false
      },
      {
        "statement": "No utility-scale storage (>50 kW) detected in Höheinöd",
        "category": "technical",
        "confidence": "high",
        "sources": ["cernion_installations_local"],
        "dataProvenance": "mastr_machine_verified",
        "trusted": false
      },
      {
        "statement": "Peak household load: ~8 kW (from meter data provided)",
        "category": "technical",
        "confidence": "medium",
        "sources": ["user_input"],
        "dataProvenance": "user_asserted",
        "trusted": true,
        "note": "[Nutzerangabe – nicht maschinell verifiziert]"
      }
    ],
    "topologyHop": {
      "needsHop": false,
      "capacityMw": 50,
      "reason": "capacity_below_threshold",
      "thresholdMw": 10
    },
    "toolSetRationale": "actorRole=grid_operator; focusAreas=[capacity,renewables]; signal-override: HIGH_CURTAILMENT → REDISPATCH added",
    "signalOverrides": [
      {
        "ruleId": "HIGH_CURTAILMENT",
        "tool": "cernion_redispatch_export",
        "injectedTool": "cernion_redispatch_export",
        "reason": "HIGH_CURTAILMENT → REDISPATCH added"
      }
    ],
    "dataGaps": []
  },
  "regulatory_graph": {
    "graphBased": true,
    "evaluatedRules": 9,
    "triggeredRules": ["HIGH_RENEWABLE_SHARE", "SECTION14A_GAP"],
    "severityCount": { "critical": 0, "high": 0, "warning": 2, "info": 0 },
    "signals": [
      {
        "ruleId": "HIGH_RENEWABLE_SHARE",
        "severity": "info",
        "description": "Hoher Anteil erneuerbarer Erzeugung",
        "statement": "Renewable generation share >80%; überangebot risk",
        "confidence": "high"
      },
      {
        "ruleId": "SECTION14A_GAP",
        "severity": "warning",
        "description": "§14a steerable load unterbesetzt",
        "statement": "Target: >20% steerable load by 2026; current gap indicates investment opportunity",
        "confidence": "medium"
      }
    ]
  },
  "narrative": {
    "title": "Höheinöd: Erneuerbare Erzeugung und §14a-Flexibilität",
    "headline": "Gegenwärtig ist Höheinöd ein Hotspot für Erzeugungsausbau mit Flexibilitätspotenzial",
    "executiveSummary": "Area demonstrates strong renewable potential (legacy PV asset, good insolation) combined with untapped demand-side flexibility. §14a-eligible load (heat pumps, home storage controls) represents near-term value creation opportunity.",
    "keyPoints": [
      "Legacy PV asset (2009, 8 kW) with 15-year operational history documents long-term grid stability",
      "Zero utility-scale storage — residential battery retrofit recommended (ROI: 7–9 years)",
      "§14a steerable load target of 20% currently at 0%; smart home integration via HEM can unlock 3–5 kW controllable capacity"
    ],
    "recommendedActions": [
      "Verify peak load profile with customer (currently 8 kW estimated); consider sub-metering for granular §14a enrollment",
      "Screen for battery retrofit suitability (roof orientation, structural capacity); reference existing asset (SEE900000952467552) for engineering baseline",
      "Engage VNB early for frequency-based §14a certification (§14a Abs. 3) — avoids engineering surprises at grid connection"
    ],
    "riskNotes": [
      "MaStR data for Höheinöd current as of 2025-Q4; if asset SEE900000952467552 has been repowered or removed, recalibrate analysis",
      "§14a 20% target is aspirational; actual eligibility depends on VNB grid topology and load diversity — confirm with BDEW methodology",
      "User-provided peak load (8 kW) from single meter reading; recommend 12-month profile for robustness"
    ]
  },
  "metadata": {
    "createdAt": "2026-04-16T10:00:00.000Z",
    "updatedAt": "2026-04-16T10:02:35.000Z",
    "focus_areas": ["capacity", "renewables"],
    "location": "Höheinöd",
    "capacity_mw": 50,
    "phaseProgress": {
      "phase_1_retrieval": 100,
      "phase_2_graph": 100,
      "phase_3_grounding": 100,
      "phase_4_synthesis": 100
    },
    "trustedFactCount": 1
  }
}
```

---

## POST /api/cya/refine — HITL Clarification Response

For unresolved multi-agent consensus failures, the clarification response can also include a directly created `hitl_item` so the UI can deep-link into the approval dashboard immediately.

```json
{
  "status": "needs_clarification",
  "session_id": "cya_1713110400000",
  "hitl_item": {
    "id": "hitl_abc123",
    "kind": "cya-consensus-failed",
    "status": "pending"
  }
}
```

### Clarification Request (from generate when status='needs_clarification')

```json
{
  "status": "needs_clarification",
  "session_id": "cya_1713110400000",
  "clarification": {
    "reason": "insufficient_fact_quality",
    "message": "Peak household load unknown; required for §14a feasibility assessment",
    "suggestedFocusAreas": ["investment", "section14a"]
  },
  "narrative": null
}
```

### Refine Request (Client Submits Clarification)

```json
{
  "session_id": "cya_1713110400000",
  "clarification_response": {
    "provided_data": {
      "peak_load_kw": 8.5,
      "meter_type": "smart_meter_installed",
      "flex_load_kw": 2.0,
      "notes": "Heat pump installed 2025; 2 kW flexible load capacity"
    }
  }
}
```

### Refine Response (Full Synthesis with HITL Data)

Same structure as successful generate response, but:
- `grounding.facts` now includes user-asserted facts:
  ```json
  {
    "statement": "Peak load: 8.5 kW (2025 meter profile); smart meter capable",
    "confidence": "medium",
    "dataProvenance": "user_asserted",
    "trusted": true,
    "note": "[Nutzerangabe – nicht maschinell verifiziert]"
  }
  ```
- `metadata.trustedFactCount`: 1
- `narrative` regenerated with HITL data integrated (guardrail: trusted facts capped at 'medium' confidence)

---

## UI Behavior (v0.26.7)

### Synchronous Path (Internal Service Calls)

- Service-to-service: `POST /api/cya/generate` returns 200 immediately with full result
- No jobId, no polling required
- Use for backend-to-backend orchestration

### Asynchronous Path (REST / Browser Clients)

**Flow Diagram:**
```
[Browser]
   |
   +-- POST /api/cya/generate ---> [API Gateway] (ctx.meta.$gateway=true)
   |                                     |
   |                              HTTP 202 + jobId ──┐
   |                                                 |
   +-- GET /api/jobs/{jobId}/status [poll every 3s]
   |    └─> { status: "phase_1_retrieval 33%", ... }
   |
   +-- When status="completed", GET /api/jobs/{jobId}/result
        └─> Full response JSON (same as internal 200)
```

**Client Implementation (Pseudocode):**
```javascript
async function generateNarrative(payload) {
  // 1. Start async job
  const jobStart = await fetch('/api/cya/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Authorization': 'Bearer TOKEN' }
  });

  if (jobStart.status === 202) {
    const { jobId } = await jobStart.json();

    // 2. Poll progress
    while (true) {
      const statusResp = await fetch(`/api/jobs/${jobId}/status`);
      const { status } = await statusResp.json();

      if (status === 'completed') {
        // 3. Fetch result
        const resultResp = await fetch(`/api/jobs/${jobId}/result`);
        return await resultResp.json();
      }

      // Back off 3–5 seconds
      await sleep(3000);
    }
  } else if (jobStart.status === 200) {
    // Sync fallback (internal caller)
    return await jobStart.json();
  }
}
```

### Status Badges (Confidence & Clarification)

| Badge | Color | Show When | Meaning |
|-------|-------|-----------|---------|
| 🟢 **High** | Green | confidenceScore ≥ 75 | Facts strongly grounded |
| 🟡 **Medium** | Yellow | 50 ≤ confidenceScore < 75 | Some gaps, mostly valid |
| 🔴 **Low** | Red | confidenceScore < 50 | Significant unknowns |
| ❓ **Clarification Needed** | Gray | status = 'needs_clarification' | User input required |

### Fact Source Icons (EU AI Act Transparency)

- 📊 **cernion_installations_local** → Machine-verified MaStR asset data
- 🗺️ **osm** → Overpass/OpenStreetMap topology data
- 💬 **query.ask** → LLM-synthesized response
- ⚠️ **user_asserted** → HITL-provided (XAI marker applied)

---

## Error Responses

## POST /api/cya/generate — Multi-Agent Mode (v0.26.9+)

### Trigger

Pass `"perspectives"` array in the request body. Valid values: `technical`, `commercial`, `compliance`.
Absent or empty → classic single-agent behavior (backward compatible).

```json
{
  "profile_id": "stadtwerk_regulierung",
  "target_audience": "Aufsichtsrat",
  "context": { "location": "Höheinöd", "capacity_mw": 50 },
  "perspectives": ["technical", "commercial", "compliance"]
}
```

### Additional Response Fields (when `perspectives` provided)

The response includes all standard fields (`grounding`, `narrative`, `regulatory_graph`, `metadata`)
**plus** a `multi_perspective` field:

```json
{
  "success": true,
  "session_id": "cya_1713110400000",
  "status": "completed",
  "narrative": { "...": "consensus narrative (same shape as classic mode)" },
  "multi_perspective": {
    "perspectives": ["technical", "commercial", "compliance"],
    "stakeholder_states": {
      "technical": {
        "personaId": "technical",
        "personaLabel": "Grid Planning & Operations",
        "verdict": "conditional",
        "summary": "Transformer upgrade required at 110 kV substation Meckesheim",
        "conflictTriggers": ["overload_risk"],
        "keyPoints": ["Current load 82% of rated capacity", "§14a reduces peak by ~30%"],
        "riskNotes": ["N-1 redundancy not guaranteed during upgrade period"]
      },
      "commercial": {
        "personaId": "commercial",
        "personaLabel": "Commercial & Finance",
        "verdict": "approved",
        "summary": "ROI positive at 11 years; KfW subsidy reduces capex by 40%",
        "conflictTriggers": [],
        "keyPoints": ["Upgrade cost 120k EUR; KfW 270 covers 48k EUR"],
        "riskNotes": ["Interest rate sensitivity: +1% → +0.8 yr amortization"]
      },
      "compliance": {
        "personaId": "compliance",
        "personaLabel": "Legal & Regulatory",
        "verdict": "conditional",
        "summary": "TA-Netz compliance requires Liegenschaft agreement before commissioning",
        "conflictTriggers": ["liegenschaft_unsecured"],
        "keyPoints": ["EnWG §17 grid connection right established", "BNetzA 6-month approval window"],
        "riskNotes": ["Liegenschaft easement must be notarized before MaStR registration"]
      }
    },
    "dialogue_rounds": 1,
    "conflict_resolved": true
  }
}
```

### HITL Escalation (Unresolved Conflict)

When all `MAX_DIALOGUE_ROUNDS` (3) are exhausted without consensus, the response uses
`status: "needs_clarification"` with the blocker details in `clarification.reason = "multi_agent_conflict_unresolved"`:

```json
{
  "status": "needs_clarification",
  "clarification": {
    "question": "Stakeholder-Konflikt nicht automatisch auflösbar. Blockierende Perspektiven: technical. Bitte klären Sie: overload_risk.",
    "reason": "multi_agent_conflict_unresolved",
    "suggestedInputs": ["overload_risk"]
  },
  "multi_perspective": {
    "perspectives": ["technical", "commercial", "compliance"],
    "stakeholder_states": { "...": "..." },
    "dialogue_rounds": 3,
    "conflict_resolved": false
  }
}
```

Resolve by calling `POST /api/cya/refine` with `clarification_response.provided_data` — same as classic HITL.
The multi-agent pipeline re-runs from Phase 3 with the enriched facts.

### Error: Invalid Perspectives

```json
{
  "code": 400,
  "type": "INVALID_PERSPECTIVES",
  "message": "Invalid perspective(s): unknown_persona",
  "data": { "invalidPersonas": ["unknown_persona"] }
}
```

---

## Error Responses

| Code | Error | Cause | Recovery |
|------|-------|-------|----------|
| 404 | `PROFILE_NOT_FOUND` | profile_id does not exist | Verify profile_id or create profile |
| 404 | `SESSION_NOT_FOUND` | session_id does not exist | Start new generate |
| 422 | `VALIDATION_ERROR` | Missing/invalid params | Review request schema |
| 503 | `LLM_NOT_CONFIGURED` | Gemini API key not set | Admin: set env var GEMINI_API_KEY |
| 429 | `TOO_MANY_REFINE_CYCLES` | >5 refine calls per session | Create new session; provide full context upfront |

---

## Example: Höheinöd PoC (Complete Flow)

**Step 1:** User selects "Höheinöd" location and presses "Generate"

```bash
curl -X POST http://localhost:3000/api/cya/generate \
  -H "Authorization: Bearer token_abc" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "stadtwerk_regulierung",
    "location": "Höheinöd",
    "context": { "capacity_mw": 50 },
    "focus_areas": ["capacity", "renewables"]
  }'
```

**Response:** HTTP 202
```json
{ "jobId": "cya_abc123", "statusUrl": "/api/jobs/cya_abc123/status" }
```

**Step 2:** Client polls status
```bash
curl http://localhost:3000/api/jobs/cya_abc123/status
```

**Response:** Still processing
```json
{ "status": "phase_2_graph", "progress": 40, "message": "Evaluating 9 rules..." }
```

**Step 3:** Polling again → completed
```json
{ "status": "completed" }
```

**Step 4:** Fetch result
```bash
curl http://localhost:3000/api/jobs/cya_abc123/result
```

**Response:** Full `generate` response (as above)

---

## PATCH /api/cya/profile/:id — Explicit Profile Update (v0.34.0+)

Updates the **inner layer** of a profile (explicit preferences, constraints, strategic goals).
Implicit/statistical fields (`implicitStats`, `focusAreaFrequency`, etc.) are protected and cannot be overwritten via this endpoint.

**Request**

```http
PATCH /api/cya/profile/{id}
Content-Type: application/json
```

```json
{
  "constraints": [{ "type": "regulatory", "value": "§ 14a EnWG", "priority": "high" }],
  "explicitPreferences": { "language": "de", "detailLevel": "technical" },
  "priorityFocusAreas": ["grid_connection", "redispatch"],
  "tone": "formal",
  "strategic_goals": ["Redispatch 2.0 compliance by Q3 2026"]
}
```

All fields are optional. An empty body is a valid no-op (increments `profileVersion` + `updatedAt`).

**Response 200**

```json
{
  "id": "vnb_stromdao",
  "profile": {
    "actor": "vnb",
    "explicitPreferences": { "language": "de", "detailLevel": "technical" },
    "constraints": [{ "type": "regulatory", "value": "§ 14a EnWG", "priority": "high", "setAt": "2026-04-29T..." }],
    "priorityFocusAreas": ["grid_connection", "redispatch"],
    "tone": "formal",
    "strategic_goals": ["Redispatch 2.0 compliance by Q3 2026"],
    "implicitStats": { "sessionCount": 5, "averageConfidence": 0.72 },
    "profileVersion": 4,
    "updatedAt": "2026-04-29T..."
  },
  "updated": true
}
```

**Errors**

| Code | Error | Cause |
|------|-------|-------|
| 404 | `PROFILE_NOT_FOUND` | Profile with given id does not exist |
| 422 | `VALIDATION_ERROR` | id contains illegal characters (only `a-z0-9_` allowed) |

---

## Progressive Profiling — Zwiebelmodus (v0.34.0+)

The CYA profile uses a **two-layer (Zwiebel) model**:

| Layer | Fields | Updated by |
|-------|--------|------------|
| **Outer (implicit)** | `implicitStats`, `focusAreaFrequency`, `signalReactions`, `toolUsage`, `preferences.focusAreaWeights`, `preferences.preferredTools`, `averageConfidence` | Automatic after every completed session |
| **Inner (explicit)** | `constraints`, `explicitPreferences`, `priorityFocusAreas`, `tone`, `strategic_goals` | `PATCH /api/cya/profile/:id` only |

**Invariant:** The outer layer never overwrites the inner layer. The inner layer never touches statistical counters.

**Implicit enrichment flow:**
1. Session completes → `_observeAndUpdateProfile` fires (non-blocking)
2. `extractImplicitSignals(session)` reads `context.focus_areas`, `regulatory_graph.signals[].ruleId`, `grounding.toolSetRationale`, `grounding.signalOverrides`
3. `mergeImplicitIntoProfile` increments counters, recomputes `focusAreaWeights` and `preferredTools`
4. Updated profile persisted to `cya_profiles` PouchDB namespace
5. If actor role present: `_writePersonaMemory` writes a memory doc to `cya_mem_<role>` namespace

**Tool-registry integration:** On the next `generate` call `deriveToolHints(profile)` feeds `profileHints` into `resolveToolSet` — boosting preferred focus areas, promoting frequently-used tools, suppressing low-sensitivity signals.

**Full profile shape (v0.34.0):**

```json
{
  "actor": "vnb",
  "tone": "formal",
  "strategic_goals": ["..."],
  "constraints": [{ "type": "regulatory", "value": "...", "priority": "high", "setAt": "..." }],
  "explicitPreferences": {},
  "priorityFocusAreas": [],
  "implicitStats": {
    "sessionCount": 12,
    "averageConfidence": 0.74,
    "focusAreaFrequency": { "grid_connection": 8, "redispatch": 4 },
    "signalReactions": { "VOLTAGE_HOP_REQUIRED": { "seen": 3, "refined": 1 } },
    "toolUsage": { "cernion_grid_data": 9, "osm_substation_finder": 3 }
  },
  "preferences": {
    "focusAreaWeights": { "grid_connection": 1.0, "redispatch": 0.5 },
    "preferredTools": ["cernion_grid_data", "cernion_installations_local"]
  },
  "profileVersion": 7,
  "createdAt": "2026-04-01T...",
  "updatedAt": "2026-04-29T...",
  "lastActiveAt": "2026-04-29T..."
}
```

**UI Hints:**
- Display `preferences.preferredTools` as a "Frequently Used Tools" badge list.
- Show `focusAreaWeights` as a bar chart (max = 1.0).
- The `PATCH` endpoint enables a "Meine Einstellungen" form in the UI for explicit overrides.
- `profileVersion` can be used for optimistic-concurrency display ("Profile last updated...").

---

## Field Reference: v0.32 + v0.33 Additions

### `regulatory_graph.graphBased` (v0.32)

| Field | Type | Always present | Description |
|-------|------|----------------|-------------|
| `graphBased` | `boolean` | No (absent when regex fallback used) | `true` when regulatory graph was built from the Central Asset Ontology (Graphology DirectedGraph). `false`/absent = legacy regex pipeline. |

The UI can show a badge (e.g. 🔬 **Ontology-Based**) when `graphBased === true`.

### `grounding.toolSetRationale` (v0.33)

| Field | Type | Always present | Description |
|-------|------|----------------|-------------|
| `toolSetRationale` | `string` | No (absent when no actorRole in profile) | Human-readable rationale for which MCP tools were selected. Format: `actorRole=X; focusAreas=[...]; signal-override: ...`. EU AI Act Art. 12 traceability field. |

### `grounding.signalOverrides` (v0.33)

| Field | Type | Always present | Description |
|-------|------|----------------|-------------|
| `signalOverrides` | `SignalOverride[]` | No (absent or `[]` when no signals triggered overrides) | Array of tools injected by ontology signal rules. |

**`SignalOverride` shape:**
```json
{
  "ruleId": "HIGH_CURTAILMENT",
  "tool": "cernion_redispatch_export",
  "injectedTool": "cernion_redispatch_export",
  "reason": "HIGH_CURTAILMENT → REDISPATCH added"
}
```

**Possible `ruleId` values:**

| ruleId | Injected tool | Trigger condition |
|--------|--------------|-------------------|
| `VOLTAGE_HOP_REQUIRED` | `osm_substation_finder` | Capacity requires MS/HS voltage hop |
| `MISSING_NAP` | `cernion_grid_data` | No Netzanschlusspunkt in MaStR |
| `HIGH_CURTAILMENT` | `cernion_redispatch_export` | Curtailment signal from ontology |
| `GRID_TOPOLOGY_RADIAL` | `osm_grid_topology` | Radial grid topology detected |

**UI Hint:** `signalOverrides` can drive a collapsible "Datenquellen-Erweiterungen" panel showing which extra MCP tools were auto-invoked and why.

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.35.0 | 2026-04-28 | Agent-to-Agent Protocol: new `GET /api/cya/sessions/:id/a2a-log` endpoint; Moleculer event bus (`cya.a2a.*`); bug-fix `currentStates` update between negotiation rounds. |
| 0.34.0 | 2026-04-29 | Progressive Profiling (Zwiebelmodus): `PATCH /api/cya/profile/:id` explicit inner-layer update; implicit outer-layer enrichment via `_observeAndUpdateProfile` after every session; `profileHints` integration in tool-registry; persona memory first write. |
| 0.33.0 | 2026-04-28 | Added `grounding.toolSetRationale`, `grounding.signalOverrides` (Dynamic Tool Router, v0.33). No new REST endpoints. |
| 0.32.0 | 2026-04-28 | Added `regulatory_graph.graphBased` (Central Asset Ontology, v0.32). No new REST endpoints. |
| 0.26.9 | 2026-04-16 | Multi-agent mode (`perspectives` array), `multi_perspective` response field. |

---

**Document Owner:** Backend/Frontend Sync Team
**Last Reviewed:** 2026-04-28
**Next Review:** Post-v0.35.0 (A2A log UI panel)

---

## GET /api/cya/sessions/:id/a2a-log (v0.35.0)

Returns the full Agent-to-Agent communication log for a CYA session.
Each entry is a structured `A2AMessage` envelope emitted during multi-agent orchestration.

**Request:**
```
GET /api/cya/sessions/{sessionId}/a2a-log
```

**Response:**
```json
{
  "sessionId": "cya_1713110400000",
  "messageCount": 5,
  "messages": [ /* A2AMessage[] sorted by timestamp */ ]
}
```

**`A2AMessage` shape:**

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | `string` (UUID) | Unique envelope ID |
| `eventName` | `string` (enum) | See event names below |
| `sessionId` | `string` | CYA Session correlation ID |
| `fromPersona` | `string` | Sender: `'technical'`, `'commercial'`, `'compliance'`, `'orchestrator'` |
| `toPersona` | `string \| null` | Recipient (null = broadcast to all) |
| `payload` | `object` | Event-specific data (see below) |
| `timestamp` | `string` (ISO 8601) | Emission time |
| `protocolVersion` | `'1.0'` | A2A protocol version |

**Event names:**

| `eventName` | Emitted by | `payload` fields |
|---|---|---|
| `cya.a2a.persona.evaluated` | Each persona (→ orchestrator) | `verdict`, `summary`, `conflictTriggers`, `keyPoints`, `riskNotes` |
| `cya.a2a.conflict.detected` | Orchestrator (broadcast) | `blockers[]`, `approvers[]`, `conflictTriggers[]` |
| `cya.a2a.negotiation.round` | Orchestrator (broadcast) | `round`, `blockers[]`, `triggers[]`, `consensusReached`, `unresolvedConflicts[]` |
| `cya.a2a.consensus.reached` | Orchestrator (broadcast) | `narrative`, `round` |
| `cya.a2a.consensus.failed` | Orchestrator (broadcast) | `unresolvedConflicts[]`, `roundsAttempted`, `escalation: 'HITL'` |

**Moleculer Event Bus:** All 5 events are also published on the Moleculer broker
(`this.broker.emit`) for external subscribers (dashboards, alerts, webhooks).
Messages are persisted in the `cya_a2a_messages` object-store namespace.

**UI Hint:** An "A2A Kommunikations-Log" timeline panel can be built from this endpoint,
showing the dialogue flow between personas and the conflict resolution rounds.
Only relevant for sessions with `multi_perspective.perspectives` set (multi-agent mode).

---

## GET /api/cya/graph/cache (neu in v0.36.0)

Gibt den aktuellen L1-Cache-Status des Ontologie-Graphen zurück.
Für Ops-Monitoring und Debugging. Kein Auth erforderlich (read-only).

**Response:**

```json
{
  "ok": true,
  "cache": {
    "l1Entries": 2,
    "ttlSeconds": 86400,
    "namespace": "cya_ontology_graphs",
    "entries": [
      {
        "key": "ontology_snb961471621746",
        "nodeCount": 6,
        "edgeCount": 5,
        "cachedAt": "2026-04-28T08:00:00.000Z",
        "hitCount": 12,
        "stale": false
      }
    ]
  }
}
```

## DELETE /api/cya/graph/cache/:operatorId (neu in v0.36.0)

Invalidiert den Ontologie-Graphen für einen VNB (beide Cache-Tiers).
Wird automatisch ausgelöst bei `mastr-monitor.delta.detected`.
Kann manuell nach MaStR-Datenaktualisierungen aufgerufen werden.

**Path-Param:** `operatorId` — BDEW-Code, MaStR-ID oder VNB-Kurzname (max. 100 Zeichen)

**Response:**

```json
{
  "key": "ontology_snb961471621746",
  "invalidated": true
}
```

## Ontologie-Graph Lifecycle (v0.36.0 Two-Tier Cache)

```
Aufbau:        Beim ersten Pipeline-Aufruf pro operatorId (Cache-Miss)
L1-Cache:      In-Memory Map, max. 20 VNBs, TTL 24h (stirbt bei Restart)
L2-Cache:      Object Store 'cya_ontology_graphs', überlebt Restart
Warm-up:       L2-Hit befüllt automatisch L1 (nächste Abfrage = <1ms)
Invalidierung: Automatisch via mastr-monitor.delta.detected
               Manuell via DELETE /api/cya/graph/cache/:operatorId
```

**Moleculer Events:**

| Event | Wann | `params` |
|-------|------|----------|
| `cya.ontology.graph.built` | Bei Cache-Miss (Graph neu gebaut) | `cacheKey`, `nodeCount`, `edgeCount`, `timestamp` |
| `cya.ontology.graph.invalidated` | Bei manueller Invalidierung | `operatorId`, `cacheKey`, `timestamp` |

**Object Store Namespace:** `cya_ontology_graphs`

**Payload-Shape im Object Store:**
```json
{
  "serialized": { "attributes": {}, "nodes": [...], "edges": [...] },
  "cachedAt": "2026-04-28T08:00:00.000Z",
  "nodeCount": 6,
  "edgeCount": 5,
  "ttlSeconds": 86400
}
```
---

## GET /api/cya/sessions/:id/context-state (neu in v0.37.0)

Gibt den persistierten Zwiebelmodus-Zustand einer Session zurück.
Ermöglicht Session-Wiederaufnahme mit identischem Zoom-Kontext.

**Path-Param:** `id` — CYA Session ID (z.B. `cya_1713110400000`)

**Response:**
```json
{
  "sessionId":    "cya_1713110400000",
  "outerContext": { "goal": "Netzkapazitätsanalyse", "focusArea": ["capacity"] },
  "currentDepth": 1,
  "breadcrumb":   ["Ziel: Netzkapazitätsanalyse", "Fokus: SEE999952467552 (r=2)"],
  "iterationLog": [
    { "operation": "set_outer_context", "nodeId": null, "meta": {}, "timestamp": "..." },
    { "operation": "zoom_in", "nodeId": "SEE999952467552", "meta": { "radius": 2, "subGraphNodes": 5 }, "timestamp": "..." }
  ],
  "maxIterations": 3,
  "zoomStack":    ["SEE999952467552"],
  "savedAt":      "2026-05-01T10:00:00.000Z"
}
```

**Object Store Namespace:** `cya_context_states`

**Key-Format:** `ctx_{sessionId}`

**Lifecycle:**
- Gespeichert: nach jeder Phase-2-Ausführung (non-blocking, fire-and-forget)
- Wiederhergestellt: am Anfang jedes `POST /api/cya/refine`-Calls
- Kompatibilitätsprüfung: alle `zoomStack`-nodeIds werden gegen den aktuellen Ontologie-Graphen geprüft; bei Inkompatibilität wird `null` zurückgegeben und der State verworfen

**Fehler:**
- `404 CONTEXT_STATE_NOT_FOUND` — kein State für die Session vorhanden
