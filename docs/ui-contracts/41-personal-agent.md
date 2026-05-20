# UI Contract 41 — Personal Agent (v0.53.1)

## Scope
Interaktive Chat-Schnittstelle mit Zwiebelmodus (L0–L4), Capability-Routing, HITL-Planmodus, Session-Wiederherstellung und Session-Reset.

## Endpoints

### 1) POST /api/personal-agent/chat
- Action: `personal-agent.chat`
- Zweck: Führt einen Chat-Turn aus. Unterstützt zwei Modi: `execution` (deterministischer Plan/Steps) und `consultation` (beratende Synthese ohne Step-Ausführung).
- Wichtig: Layer 4 ist transient; Roh-JSON wird nach Synthese verworfen und nicht persistiert.

Request:
```json
{
  "message": "Prüfe bitte die Netzsituation in Troisdorf.",
  "sessionId": "optional-existing-session-id",
  "executionMode": "auto",
  "chatMode": "execution",
  "knownContext": {
    "gridOperatorName": "TWL Netze",
    "fnavProfile": {
      "requestedCapacity": 5000,
      "flexibleCapacity": 2000
    }
  }
}
```

Response:
```json
{
  "success": true,
  "status": "completed",
  "sessionId": "pa_...",
  "executionMode": "auto",
  "chatMode": "execution",
  "reply": "...",
  "layer4Purged": true,
  "l3Compressed": false,
  "routing": {
    "source": "routing-matrix",
    "routeKey": "fnav-finance",
    "routeLabel": "fNAV + Finance",
    "primaryIntent": "grid-connection.fnav",
    "secondaryIntents": ["finance-agent.analyze"],
    "requestedDomains": ["fnav", "finance"],
    "unsupportedDomains": [],
    "warnings": []
  },
  "plan": {
    "status": "ready",
    "steps": [
      {
        "step": 1,
        "action": "grid-connection.fnavValidate",
        "purpose": "fNAV-Profil technisch validieren",
        "source": "routing-matrix"
      },
      {
        "step": 2,
        "action": "finance-agent.fnavEconomics",
        "purpose": "Wirtschaftliche Einordnung aus fNAV-Profil ableiten",
        "source": "routing-matrix",
        "dependsOnStep": 1
      }
    ]
  },
  "execution": {
    "status": "completed",
    "completedSteps": 2,
    "steps": [
      {
        "step": 1,
        "action": "grid-connection.fnavValidate",
        "status": "completed"
      },
      {
        "step": 2,
        "action": "finance-agent.fnavEconomics",
        "status": "completed"
      }
    ],
    "stopPoint": null
  },
  "contextUsage": {
    "l0": 12,
    "l1": 4,
    "l2": 20,
    "l3": 140,
    "l4": 0,
    "total": 176,
    "maxContextTokens": 128000
  },
  "historyCount": 2
}
```

Consultation-Response (gekürzt):
```json
{
  "success": true,
  "status": "consulting",
  "sessionId": "pa_...",
  "executionMode": "auto",
  "chatMode": "consultation",
  "reply": "Vorläufige Einordnung ...",
  "consultation": {
    "hypotheses": [
      { "statement": "...", "confidence": "medium", "evidence": "..." }
    ],
    "openQuestions": [
      { "question": "...", "whyRelevant": "..." }
    ],
    "nextActions": [
      { "action": "Prüfmodus starten", "description": "..." }
    ],
    "factsUsed": [
      { "source": "user_prompt", "value": "..." }
    ]
  },
  "execution": {
    "status": "consulting",
    "plan": null,
    "steps": []
  }
}
```

HITL-Response (gekürzt):
```json
{
  "success": true,
  "executionMode": "hitl",
  "plan": {
    "status": "ready",
    "steps": [{ "step": 1, "action": "grid-connection.fnavValidate" }]
  },
  "execution": {
    "status": "skipped",
    "steps": [],
    "stopPoint": null
  }
}
```

Partial-Execution-Response (gekürzt):
```json
{
  "execution": {
    "status": "partial",
    "completedSteps": 1,
    "stopPoint": {
      "status": "interface-placeholder",
      "reasonCode": "MISSING_INPUTS",
      "blockedStep": 2,
      "placeholderId": "ph-..."
    }
  }
}
```

### 2) GET /api/personal-agent/session/:sessionId
- Action: `personal-agent.getSession`
- Zweck: Session-Rehydration im Frontend nach Reload (Layer 3 Verlauf + Layer 2 Profil-Info).

Response:
```json
{
  "success": true,
  "sessionId": "pa_...",
  "chatMode": "consultation",
  "createdAt": "2026-05-14T09:00:00.000Z",
  "updatedAt": "2026-05-14T09:02:00.000Z",
  "l2": { "userProfile": {} },
  "l3": {
    "history": [
      { "role": "user", "text": "...", "ts": "..." },
      { "role": "assistant", "text": "...", "ts": "..." }
    ],
    "summary": null,
    "compressed": false,
    "chatMode": "consultation"
  },
  "layer4": null
}
```

### 3) POST /api/personal-agent/session/:sessionId/reset
- Action: `personal-agent.resetSession`
- Zweck: Context-Flush für Session (L3 zurücksetzen), L2-Profil bleibt erhalten.

Response:
```json
{
  "success": true,
  "sessionId": "pa_...",
  "reset": true,
  "keptLayer2": true
}
```

## Guarantees
- L4 enthält maximal ein aktives Tool.
- L4-Rohdaten werden nie in Object-Store/DB persistiert.
- Session-Persistenz enthält nur L1/L2/L3 und Metadaten.
- `executionMode: "hitl"` liefert denselben stabilen Plan wie `auto`, führt aber keine Tool-Calls aus.
- Multi-Domain-Ketten sind nur entlang der Routing-Matrix erlaubt; zusätzliche Domains führen zu kontrollierter Partial Execution mit explizitem Stop-Marker.
