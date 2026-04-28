# Cernion — Onboarding: Leitwarte

**Version:** 0.34.0 | **Stand:** 2026-04-29
**Zielgruppe:** Leitwarte, Schichtleitung, Netzbetrieb

---

## Ihre Rolle in Cernion

| Eigenschaft | Wert |
|-------------|------|
| `actor.role` | `grid_operator` |
| Fokus | Operativer Netzbetrieb, Echtzeit-Steuerung, Schichtübergabe |
| Kernzugang | Grid-Daten, §14a-Flex-Steuerung, MQTT-Steuerbefehle, Lastprognose |
| Nicht im Zugang | Day-Ahead-Marktpreise, Kundendaten, Direktvermarktungs-Portfolios |

Der Agent erkennt automatisch Ihren operativen Fokus und wählt die richtigen
Werkzeuge — Sie müssen keine Datenquellen benennen.

---

## Profil anlegen

Einmalig bei der Einrichtung. Das Profil steuert Ton, Werkzeuge und Schwerpunkte.

```bash
curl -s -X POST http://localhost:3000/api/cya/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "id": "leitwarte_schicht_a",
    "actor": {
      "role": "grid_operator",
      "organization": "Leitwarte Netz GmbH"
    },
    "tone": "präzise, handlungsorientiert",
    "strategic_goals": [
      "Netzstabilität sichern",
      "§14a-Steuerbefehle lückenlos dokumentieren",
      "Schichtübergabe mit aktueller Netzsituation unterstützen"
    ],
    "constraints": [
      {
        "type": "operational",
        "value": "Keine Steuerbefehle ohne vorherige Kapazitätsbeurteilung",
        "priority": "critical"
      }
    ],
    "explicitPreferences": {
      "language": "de",
      "detailLevel": "operational",
      "shortAnswers": true
    },
    "priorityFocusAreas": ["capacity", "redispatch", "section14a"]
  }'
```

**Profil-ID merken:** `leitwarte_schicht_a`

---

## Tagesgeschäft: Was kann der Agent für die Leitwarte?

### Aktuelle Netzsituation einschätzen

```bash
curl -s -X POST http://localhost:3000/api/cya/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "profile_id": "leitwarte_schicht_a",
    "context": {
      "location": "Netzgebiet Südpfalz",
      "focus_areas": ["capacity", "redispatch"]
    }
  }'
```

**Welche Signals sind für die Leitwarte relevant:**

| Signal | Bedeutung | Sofortmaßnahme |
|--------|-----------|----------------|
| `VOLTAGE_HOP_REQUIRED` | Anlage am Kapazitätslimit — HS-Anschluss nötig | Netzplanung informieren |
| `HIGH_CURTAILMENT` | Hohe Abregelung läuft oder droht | Redispatch-Auftrag prüfen |
| `SECTION14A_GAP` | §14a-Potenzial nicht aktiviert | Dimming-Plan anpassen |
| `GRID_TOPOLOGY_RADIAL` | Radiales Netz ohne Ringschluss | Ersatzschaltung vorbereiten |
| `MISSING_NAP` | Anlage ohne Netzanschlusspunkt in MaStR | Stammdaten-Korrektur anfordern |

**`signalOverrides` in der Antwort lesen:**

```json
"grounding": {
  "signalOverrides": [
    {
      "ruleId": "HIGH_CURTAILMENT",
      "tool": "cernion_redispatch_export",
      "reason": "Curtailment signal from ontology — Redispatch data auto-fetched"
    }
  ]
}
```

Das bedeutet: Der Agent hat wegen `HIGH_CURTAILMENT` automatisch Redispatch-Daten
gezogen — ohne dass Sie das explizit angefordert haben. Das ist das **Pain-Driven
Tool-Routing**: Die Werkzeuge folgen dem Problem, nicht umgekehrt.

---

### §14a-Dimming dokumentieren

**Flex-Aktion auslösen:**

```bash
curl -s -X POST http://localhost:3000/api/flex/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "eventId": "flex_event_20260429_schicht_a",
    "devices": [
      { "deviceId": "wallbox_001", "dimmingPercent": 50 },
      { "deviceId": "wp_strasse_15", "dimmingPercent": 60 }
    ],
    "durationMinutes": 90,
    "reason": "Netzüberlastung Strang Hauptstraße — §14a EnWG"
  }'
```

**Antwort enthält:**
```json
{
  "mqttPublished": true,
  "mqttMessageId": "msg_xyz789",
  "entlastungsnachweis": {
    "id": "EN_20260429_001",
    "downloadUrl": "/api/flex/entlastungsnachweis/EN_20260429_001"
  }
}
```

**Entlastungsnachweis abrufen:**

```bash
curl -s "http://localhost:3000/api/flex/entlastungsnachweis/EN_20260429_001" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  --output entlastungsnachweis_20260429.pdf
```

**MQTT QoS 2 — was das für die Leitwarte bedeutet:**

`mqttPublished: true` bedeutet: Der Steuerbefehl wurde an den MQTT-Broker
übergeben. QoS 2 garantiert **genau einmal** Zustellung — kein Doppelsteuerbefehl
auch wenn die Verbindung kurz unterbrochen wird.

Wenn die Steuerbox offline ist: Der Befehl wartet im persistenten MQTT-Broker
und wird zugestellt sobald die Steuerbox wieder online ist.

---

### Prognose für Schichtübergabe

```bash
curl -s -X POST http://localhost:3000/api/cya/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "profile_id": "leitwarte_schicht_a",
    "context": {
      "location": "Netzgebiet Südpfalz",
      "focus_areas": ["capacity"]
    }
  }'
```

Die Antwort enthält im `narrative.summary` eine Zusammenfassung der aktuellen
Netzlage — geeignet als Grundlage für das Schichtübergabeprotokoll.

**Detaillierte Lastprognose (Day-Ahead-Fahrplan):**

```bash
curl -s "http://localhost:3000/api/forecast/schedule?date=2026-04-30" \
  -H "Authorization: Bearer ck_<ihr-token>"
```

---

## Tool-Routing verstehen

### Warum sieht die Leitwarte andere Daten als der Projektierer?

Das System nutzt rollenbasiertes Tool-Routing. Als `grid_operator` mit operativem
Fokus werden priorisiert:

| Tool | Wann aktiviert | Typische Leitwarten-Frage |
|------|----------------|--------------------------|
| `cernion_grid_data` | Immer für `capacity` | "Wie ist die aktuelle Netzlast?" |
| `cernion_redispatch_export` | Bei `HIGH_CURTAILMENT` Signal | "Welche Anlagen regeln gerade ab?" |
| `vnbdigital_control_measures` | Bei `section14a` Fokus | "Welche §14a-Maßnahmen sind aktiv?" |
| `osm_substation_finder` | Bei `VOLTAGE_HOP_REQUIRED` | "Welches Umspannwerk ist zuständig?" |

Ein Projektierer (Rolle `project_developer`) erhält dagegen bevorzugt Planungstools
(NOVA-Entscheidungen, ZNP-Projektdaten) die für die Leitwarte nicht relevant sind.

### `toolSetRationale` in der Antwort lesen

```json
"grounding": {
  "toolSetRationale": "grid_operator + capacity + redispatch → Tools: cernion_grid_data, cernion_redispatch_export. Signal HIGH_CURTAILMENT → osm_grid_topology added."
}
```

Diese Begründung erklärt in einem Satz, warum der Agent genau diese Werkzeuge
gewählt hat. Nützlich für die Dokumentation und bei Rückfragen.

---

## Ihr Profil lernt mit

Nach jeder abgeschlossenen Analyse speichert das System automatisch (unsichtbar):

- Wie oft Sie `capacity` und `redispatch` analysiert haben
- Welche Signals Sie regelmäßig sehen
- Welche Tools häufig für Ihre Analysen nötig waren

**Nach 3–5 Analysen** kennt der Agent Ihre häufigsten Fragestellungen und
priorisiert die relevanten Werkzeuge beim nächsten Aufruf automatisch stärker.

### Explizite rote Linien setzen

Wenn sich operative Vorgaben ändern, sofort im Profil aktualisieren:

```bash
curl -s -X PATCH http://localhost:3000/api/cya/profile/leitwarte_schicht_a \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "constraints": [
      {
        "type": "operational",
        "value": "Keine automatischen MaStR-Änderungen ohne Freigabe Netzplanung",
        "priority": "critical"
      },
      {
        "type": "regulatory",
        "value": "§14a Mindestleistung 4,2 kW — unter keinen Umständen unterschreiten",
        "priority": "high"
      }
    ]
  }'
```

Constraints sind **permanent** — sie werden durch automatisches Lernen nicht
überschrieben.

---

## FAQ Leitwarte

### MQTT-Steuerbefehl nicht bestätigt: was tun?

1. Prüfen ob `mqttPublished: true` in der Flex-Antwort
2. Steuerbox-Verbindungsstatus prüfen (MQTT-Subscriber online?)
3. Nach Reconnect der Steuerbox: QoS 2 Befehl wird automatisch zugestellt
4. Wenn Steuerbox dauerhaft offline: Manuelle Steuermaßnahme nach internem Protokoll

```bash
# MQTT-Persistenz-Status prüfen (Broker läuft intern)
curl -s http://localhost:3000/api/mqtt-broker/stats \
  -H "Authorization: Bearer ck_<ihr-token>"
```

### Analyse dauert länger als 30 Sekunden: Timeout-Handling

Analysen laufen asynchron — es gibt keinen Timeout für den Client. Den Job
weiter pollen:

```bash
JOB_ID="<jobId aus Antwort>"
# Fortschritt prüfen
curl -s "http://localhost:3000/api/jobs/${JOB_ID}/status" | jq '.percent, .phase'
# Ergebnis wenn 100%
curl -s "http://localhost:3000/api/jobs/${JOB_ID}/result"
```

Wenn der Job nach 15 Minuten noch nicht abgeschlossen ist: Netzverbindung zum
Cernion-Backend prüfen. Der lokale Fallback liefert Ergebnisse aus dem MaStR-Cache.

### Entlastungsnachweis nicht generiert: Voraussetzungen prüfen

Ein Entlastungsnachweis wird nur generiert wenn:
1. `mqttPublished: true` in der Flex-Antwort
2. Die Steuerung tatsächlich ausgeführt wurde (PUBCOMP empfangen)
3. `durationMinutes` abgelaufen ist

```bash
# Status eines konkreten Flex-Events prüfen
curl -s "http://localhost:3000/api/flex/events/flex_event_20260429_schicht_a" \
  -H "Authorization: Bearer ck_<ihr-token>" | jq '.status, .mqttAcknowledged'
```

### Wie exportiere ich die Situationsanalyse für das Schichtbuch?

```bash
SESSION_ID="<session_id aus Analyse-Ergebnis>"
curl -s "http://localhost:3000/api/cya/sessions/${SESSION_ID}/export/pdf" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  --output schichtbuch_$(date +%Y%m%d_%H%M).pdf
```

---

*Cernion Energy Tools v0.34.0 | Leitwarte-Onboarding | Stand: 2026-04-29*
