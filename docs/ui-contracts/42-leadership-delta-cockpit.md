# UI Contract: Fuehrungscockpit Delta Steuerung

> **Page ID:** `leadership-delta-cockpit`
> **Version:** 0.64.5
> **Last updated:** 2026-06-24

---

## Primary API Endpoint

- `GET /api/dashboard/leadership-delta-cockpit`

**Auth:** Bearer token with `read-only` scope.

---

## Request

`GET /api/dashboard/leadership-delta-cockpit?topic=zielnetzplanung&domain=znp&ownerRole=netzstrategie&dueAt=2026-Q3&evidenceStatus=partial&blockedDecision=zielnetzpfad&escalationState=watch&nextLever=resolve_evidence_gap&newSignals=mastr-delta,znp-cost&linkedEntities=znp:2030&sourceSignals=decision-frame,hitl`

Supported filters and smoke parameters:

- `gridOperatorId`, `bdewCode`
- `topicId`, `topic`, `domain`, `role`, `status`
- `ownerRole`, `dueAt`, `dueBefore`
- `evidenceStatus`, `blockedDecision`, `escalationState`, `nextLever`
- `knownBaseline`, `newSignals`, `linkedEntities`, `sourceSignals`
- `includeDegradedSample`, `limit`

---

## Response Shape

```json
{
  "capabilityKey": "leadership_delta_cockpit",
  "safety": "read_only",
  "status": "blocked",
  "topicCount": 1,
  "statusDistribution": { "blocked": 1 },
  "topics": [
    {
      "topicId": "leadership-delta:zielnetzplanung",
      "title": "zielnetzplanung",
      "domain": "znp",
      "status": "blocked",
      "deltaSummary": {
        "signalCount": 2,
        "newestSignal": "mastr-delta",
        "summary": "2 new signal(s) require leadership attention"
      },
      "knownBaseline": null,
      "newSignals": ["mastr-delta", "znp-cost"],
      "owner": { "role": "netzstrategie" },
      "dueAt": "2026-Q3",
      "evidenceStatus": "partial",
      "blockedDecision": "zielnetzpfad",
      "escalation": { "state": "watch", "escalated": false },
      "nextLever": "resolve_evidence_gap",
      "linkedEntities": ["znp:2030"],
      "sourceSignals": ["decision-frame", "hitl"]
    }
  ],
  "missingEvidence": [],
  "positiveFollowUps": [],
  "sourceActions": {
    "inspected": ["dashboard-api.leadershipDeltaCockpitStatus"],
    "referenced": ["decision-frame.list", "hitl.list", "nova.listDecisions"],
    "notCalled": ["hitl.create", "nova.apply", "external.connector.call"]
  },
  "_errors": []
}
```

---

## Display Rules

- Show one row per `topics[]` item.
- Use `status` as the primary classification: `known`, `delta_detected`, `evidence_gap`, `blocked`, `decision_ready`, `escalated`, `closed`.
- Render `_errors` as degraded-source warnings; keep the rest of the cockpit visible.
- Treat `sourceActions.notCalled` as audit evidence, not as user action labels.

---

## Guards

This contract is read-only. The endpoint must not create HITL items, approve or apply NOVA decisions, mutate VDMI or Decision Frame state, sync MS365, call external connectors, run billing/settlement/tariff/MaKo actions, or introduce Personal-Agent special routing.
