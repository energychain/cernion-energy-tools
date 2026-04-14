# UI Contract: CYA Agent API

> **Page ID:** `cya`
> **Version:** 0.26.2
> **Last updated:** 2026-04-14

---

## Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `POST` | `/api/cya/profile` | Create or update stakeholder profile |
| `GET` | `/api/cya/profile/:profile_id` | Load one profile |
| `GET` | `/api/cya/profiles` | List profiles |
| `POST` | `/api/cya/generate` | Run full CYA pipeline (Option B) |
| `POST` | `/api/cya/refine` | Refine existing CYA session |

---

## Option-B response envelope (`generate`, `refine`)

```json
{
  "success": true,
  "session_id": "cya_1713110400000",
  "status": "completed",
  "profile_id": "stadtwerk_regulierung",
  "target_audience": "Aufsichtsrat",
  "grounding": {
    "confidence": "medium",
    "confidenceScore": 62,
    "requiresClarification": false,
    "facts": [],
    "dataGaps": [],
    "regulatorySignals": []
  },
  "regulatory_graph": {
    "evaluatedRules": 8,
    "triggeredRules": 2,
    "severityCount": { "critical": 0, "warning": 2, "info": 0 },
    "signals": []
  },
  "narrative": {
    "headline": "...",
    "executiveSummary": "...",
    "keyPoints": ["..."],
    "recommendedActions": ["..."],
    "riskNotes": ["..."]
  },
  "clarification": null,
  "metadata": {
    "createdAt": "2026-04-14T18:00:00.000Z",
    "updatedAt": "2026-04-14T18:00:00.000Z",
    "focus_areas": ["capacity", "compliance"],
    "trigger": "Presseanfrage",
    "location": "Ludwigshafen"
  }
}
```

### Clarification state

If confidence is low or required context is missing:
- `status = "needs_clarification"`
- `narrative = null`
- `clarification` contains next required user input

---

## UI behavior

- Keep session state via `session_id`.
- Show confidence badge from `grounding.confidence`.
- Render deterministic findings from `regulatory_graph.signals`.
- If `status=needs_clarification`, show clarification prompt and submit answer via `POST /api/cya/refine` using `agent_clarification_response`.

---

## Errors

- `404 PROFILE_NOT_FOUND` for unknown profile
- `404 SESSION_NOT_FOUND` for unknown session
- `422 VALIDATION_ERROR` for malformed payloads
- `503 LLM_NOT_CONFIGURED` if Gemini key is not configured
