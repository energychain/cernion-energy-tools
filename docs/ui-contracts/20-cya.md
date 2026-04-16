# UI Contract: CYA Agent API

> **Page ID:** `cya`
> **Version:** 0.26.7
> **Last updated:** 2026-04-16

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
    "dataGaps": []
  },
  "regulatory_graph": {
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

**Document Owner:** Backend/Frontend Sync Team
**Last Reviewed:** 2026-04-16
**Next Review:** Post-v0.26.8 (topology-hop generalization)
