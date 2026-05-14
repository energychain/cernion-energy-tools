# UI Contract 41 — Personal Agent (v0.52.0)

## Scope
Interaktive Chat-Schnittstelle mit Zwiebelmodus (L0–L4), Session-Wiederherstellung und Session-Reset.

## Endpoints

### 1) POST /api/personal-agent/chat
- Action: `personal-agent.chat`
- Zweck: Führt einen Chat-Turn aus, baut den Kontext-Stack auf und liefert Antworttext.
- Wichtig: Layer 4 ist transient; Roh-JSON wird nach Synthese verworfen und nicht persistiert.

Request:
```json
{
  "message": "Prüfe bitte die Netzsituation in Troisdorf.",
  "sessionId": "optional-existing-session-id"
}
```

Response:
```json
{
  "success": true,
  "sessionId": "pa_...",
  "reply": "...",
  "layer4Purged": true,
  "l3Compressed": false,
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

### 2) GET /api/personal-agent/session/:sessionId
- Action: `personal-agent.getSession`
- Zweck: Session-Rehydration im Frontend nach Reload (Layer 3 Verlauf + Layer 2 Profil-Info).

Response:
```json
{
  "success": true,
  "sessionId": "pa_...",
  "createdAt": "2026-05-14T09:00:00.000Z",
  "updatedAt": "2026-05-14T09:02:00.000Z",
  "l2": { "userProfile": {} },
  "l3": {
    "history": [
      { "role": "user", "text": "...", "ts": "..." },
      { "role": "assistant", "text": "...", "ts": "..." }
    ],
    "summary": null,
    "compressed": false
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
