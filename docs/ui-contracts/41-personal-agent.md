# UI Contract 41 — Personal Agent (v0.53.9)

## Scope
Interaktive Chat-Schnittstelle mit Zwiebelmodus (L0–L4), Capability-Routing, HITL-Planmodus, Session-Wiederherstellung und Session-Reset. Seit dem aktuellen Unreleased-Schnitt zusätzlich mit deterministischem Execution-State-Graph, expliziter Routing-Edge-Entscheidung und strukturierter Execution-Observability.

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
    "gridOperatorName": "Stadtwerke Troisdorf",
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
  "chatModeSource": "api",
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
    "stopPoint": null,
    "meta": {
      "totalMs": 1835,
      "llmCallCount": 2,
      "toolCallCount": 2,
      "llmCalls": [
        { "phase": "chat_mode_classifier", "latencyMs": 128 },
        { "phase": "consultation_synthesis", "latencyMs": 422 }
      ],
      "toolCalls": [
        { "phase": "execution", "tool": "grid-connection.fnavValidate", "success": true, "retries": 0 },
        { "phase": "execution", "tool": "finance-agent.fnavEconomics", "success": true, "retries": 0 }
      ],
      "brokerDecisions": [
        {
          "intent": "grid-connection.fnav",
          "capability": "netzfahrplan_fnav_assessment",
          "confidence": 0.92,
          "scoringBreakdown": { "rawScore": 3, "finalConfidence": 0.92 }
        }
      ],
      "stateTransitions": [
        { "family": "chat_mode", "from": "consultation", "to": "execution", "reason": "api" }
      ]
    }
  },
  "responseStrategy": {
    "audience": "leadership",
    "audienceConfidence": 0.78,
    "epistemicState": "inferable",
    "abstractionLevel": "executive",
    "nextMove": "state_assumption",
    "assumptions": [
      {
        "type": "working_assumption",
        "statement": "Vorläufige Annahme: ..."
      }
    ],
    "lead": "Vorläufige Annahme:",
    "shouldHideInternalSchema": true,
    "confidence": 0.88
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

Neu ab v0.53.9 (strukturiert, nicht im Freitext `reply`):
```json
{
  "quality": {
    "groundedness": {
      "score": 0.82,
      "basis": "evidence_plan",
      "confidence": 0.82
    },
    "uncertainty": {
      "score": 0.18,
      "reasons": [],
      "requiresHITL": false
    }
  },
  "agentTrace": {
    "traceId": "trace_...",
    "planning": {
      "source": "capability-broker",
      "primaryIntent": "financier_due_diligence_assessment",
      "routeKey": null,
      "routeLabel": "financier_due_diligence_assessment",
      "planStatus": "ready",
      "plannedSteps": 1,
      "warnings": []
    },
    "execution": {
      "status": "partial",
      "completedSteps": 0,
      "stopReason": "MANDATORY_HITL_APPROVAL",
      "hitlItemId": "hitl-...",
      "criticalStepBlocked": true,
      "meta": {
        "llmCallCount": 1,
        "toolCallCount": 0,
        "totalMs": 740
      }
    },
    "routingDecision": {
      "target": "execution_node",
      "label": "Execution path",
      "confidence": 0.92,
      "determinism": "deterministic",
      "gapReason": null
    },
    "responseStrategy": {
      "audienceType": "leadership",
      "audience": "leadership",
      "audienceConfidence": 0.78,
      "epistemicState": "inferable",
      "abstractionLevel": "executive",
      "nextMove": "state_assumption",
      "nextDialogueMove": "state_assumption",
      "decisionRole": "strategic_assumption",
      "confidence": 0.88,
      "workingAssumptions": [
        {
          "type": "working_assumption",
          "statement": "Vorläufige Annahme: ...",
          "basis": "contextual-inference",
          "confidence": "medium",
          "status": "inferred"
        }
      ],
      "userFacingQuestionStyle": "confirmation",
      "shouldHideInternalSchema": true,
      "assumptionCount": 1
    },
    "evidence": {
      "source": "registry",
      "registryKey": "financier_due_diligence_assessment",
      "confidence": 0.4,
      "gapIds": ["netzanschlusszusage"]
    },
    "stateMachine": {
      "turnId": "turn_pa_...",
      "currentState": "hitl_blocked",
      "status": "completed",
      "transitions": [
        { "state": "init", "at": "2026-05-21T10:00:00.000Z", "details": {} },
        { "state": "session_loaded", "at": "2026-05-21T10:00:00.100Z", "details": {} },
        { "state": "knowledge_oriented", "at": "2026-05-21T10:00:00.200Z", "details": {} },
        { "state": "broker_recommended", "at": "2026-05-21T10:00:00.300Z", "details": {} },
        { "state": "chat_mode_resolved", "at": "2026-05-21T10:00:00.400Z", "details": { "chatMode": "execution" } },
        { "state": "execution_planned", "at": "2026-05-21T10:00:00.500Z", "details": { "primaryIntent": "financier_due_diligence_assessment" } },
        { "state": "execution_running", "at": "2026-05-21T10:00:01.000Z", "details": { "status": "partial" } },
        { "state": "synthesizing", "at": "2026-05-21T10:00:01.100Z", "details": {} },
        { "state": "hitl_blocked", "at": "2026-05-21T10:00:01.200Z", "details": { "stopReason": "MANDATORY_HITL_APPROVAL" } }
      ]
    },
    "executionStateGraph": {
      "graphId": "exec_state_pa_...",
      "fingerprint": "f81d4fae7dec11d0",
      "currentState": "ready_for_routing",
      "chatMode": "execution",
      "executionMode": "auto",
      "transitions": [
        { "state": "initialized", "at": "2026-05-21T10:00:00.000Z", "details": { "chatMode": "execution" } },
        { "state": "api_params_validated", "at": "2026-05-21T10:00:00.050Z", "details": { "source": "api", "confidence": 1 } },
        { "state": "execution_mode_resolved", "at": "2026-05-21T10:00:00.060Z", "details": { "executionMode": "auto" } },
        { "state": "ready_for_routing", "at": "2026-05-21T10:00:00.070Z", "details": { "chatMode": "execution" } }
      ]
    },
    "toolAttempts": []
  },
  "executionStateGraph": {
    "graphId": "exec_state_pa_...",
    "currentState": "ready_for_routing",
    "chatMode": "execution",
    "executionMode": "auto"
  },
  "turnGraph": {
    "turnId": "graph_pa_...",
    "status": "completed",
    "chatMode": "execution",
    "executionMode": "auto",
    "nodeCount": 7,
    "edgeCount": 6,
    "byType": {
      "message": 1,
      "context": 1,
      "knowledge": 1,
      "broker": 1,
      "tool": 2,
      "answer": 1
    }
  }
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

Wichtig (Kompatibilität): Das top-level `execution`-Objekt im Consultation-Pfad bleibt unverändert (`status`, `plan`, `steps`). Vertiefte Laufzeit-Metadaten stehen in `agentTrace.execution.meta`. Die optionale `responseStrategy`-Struktur ist rein additiv und bleibt getrennt vom Freitext `reply`.

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
  "chatModeSource": "cached",
  "createdAt": "2026-05-14T09:00:00.000Z",
  "updatedAt": "2026-05-14T09:02:00.000Z",
  "executionStateGraph": {
    "graphId": "exec_state_pa_...",
    "currentState": "ready_for_routing",
    "chatMode": "consultation",
    "executionMode": "auto"
  },
  "l2": { "userProfile": {} },
  "l3": {
    "history": [
      { "role": "user", "text": "...", "ts": "..." },
      { "role": "assistant", "text": "...", "ts": "..." }
    ],
    "summary": null,
    "compressed": false,
    "chatMode": "consultation",
    "chatModeSource": "cached",
    "lastClassification": {
      "fingerprint": "6dcd4ce23d88e2ee",
      "chatMode": "consultation",
      "source": "cached",
      "confidence": 0.95,
      "timestamp": "2026-05-21T11:22:33.000Z"
    },
    "executionStateGraph": {
      "currentState": "ready_for_routing",
      "chatMode": "consultation"
    }
  },
  "layer4": null
}
```

### Routing-Gap Short-Circuit (Feature Flag)
- Der explizite Routing-Gap-Kurzschluss (`mark_unknown_execution_gap`) ist aktuell **opt-in** und standardmäßig deaktiviert.
- Aktivierung nur über: `PERSONAL_AGENT_ENABLE_ROUTING_GAP_SHORT_CIRCUIT=true`
- Ohne Aktivierung bleibt das bestehende deterministische Fallback-Verhalten kompatibel.

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
- Kritische Flows (z.B. finanzielle/regulatorische Entscheidungspfade) erzwingen Step-Level-HITL auch im `executionMode: "auto"` (`reasonCode: "MANDATORY_HITL_APPROVAL"`).
- Nach externer Freigabe kann derselbe Schritt im nächsten Turn fortgesetzt werden; dazu wird das freigegebene Artefakt über `knownContext.hitlItemId` referenziert.
- Agentische Begründung/Trace wird ausschließlich strukturiert über `agentTrace` im Response geliefert, nicht als Debug-Text im Feld `reply`.
