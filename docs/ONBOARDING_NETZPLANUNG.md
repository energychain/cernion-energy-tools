# Cernion — Onboarding: Netzplanung

**Version:** 0.34.0 | **Stand:** 2026-04-29
**Zielgruppe:** Netzplanungsteam, Netztechniker, Netzanalytiker

---

## Ihre Rolle in Cernion

| Eigenschaft | Wert |
|-------------|------|
| `actor.role` | `grid_operator` |
| Persona-Namespace | `cya_mem_grid_operator` |
| Schwerpunkt | Netzanschluss, Topologie, Redispatch, §14a, Substation-Finder |
| Standardton | technisch-präzise, entscheidungsorientiert |

**Was Sie sehen:** MaStR-Installationsbestand, Grid-Daten (OSM-basiert), Topologie-Hops,
Redispatch-Exportdaten, Substation-Finder, §14a-Flexibilität, Netzkapazitäten.

**Was nicht im Zugang:** Day-Ahead-Börsenpreise, Kundenmanagement, Direktvermarktungs-Portfolios.

Das Tool-Routing ist **rollenbasiert** — als `grid_operator` erhält der Agent automatisch
die relevanten Werkzeuge. Sie müssen nicht angeben, welche Datenquellen genutzt werden sollen.

---

## Erste Schritte: Profil anlegen

Das Profil steuert, welche Werkzeuge der Agent bevorzugt, welchen Ton er in der Analyse
wählt und welche regulatorischen Schwerpunkte er setzt. Das Profil ist persistent und lernt
mit jeder Analyse.

### Profil erstellen

```bash
curl -s -X POST http://localhost:3000/api/cya/profile \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "id": "netzplanung_suedpfalz",
    "actor": {
      "role": "grid_operator",
      "organization": "Stadtwerke Südpfalz Netz GmbH"
    },
    "tone": "technisch-präzise",
    "strategic_goals": [
      "Netzkapazität für Erneuerbaren-Ausbau sichern",
      "Redispatch 2.0 Settlement-Readiness herstellen",
      "§14a-Flexibilitätspotenzial im NS-Netz aktivieren"
    ],
    "constraints": [
      {
        "type": "regulatory",
        "value": "BNetzA-Vorgaben zur Netzneutralität einhalten",
        "priority": "high"
      }
    ],
    "explicitPreferences": {
      "language": "de",
      "detailLevel": "technical",
      "includeOsmEvidence": true
    },
    "priorityFocusAreas": ["capacity", "grid_expansion", "redispatch"]
  }'
```

**Erwartete Antwort:**
```json
{
  "id": "netzplanung_suedpfalz",
  "profile": {
    "actor": { "role": "grid_operator", "organization": "Stadtwerke Südpfalz Netz GmbH" },
    "tone": "technisch-präzise",
    "strategic_goals": ["..."],
    "profileVersion": 1,
    "createdAt": "2026-04-29T..."
  }
}
```

**Die Profil-ID merken** — sie wird bei jeder Analyse als `profile_id` übergeben.

---

## Analyse starten: POST /api/cya/generate

### Vollständiges Beispiel: Neue Anlage im Netz beurteilen (Standort Höheinöd)

```bash
curl -s -X POST http://localhost:3000/api/cya/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "profile_id": "netzplanung_suedpfalz",
    "context": {
      "location": "Höheinöd",
      "postleitzahl": "66989",
      "capacity_mw": 8.5,
      "focus_areas": ["capacity", "grid_expansion", "section14a", "redispatch"]
    }
  }'
```

**Antwort (HTTP 202 — Async Job):**
```json
{
  "jobId": "job_abc123",
  "status": "pending",
  "statusUrl": "/api/jobs/job_abc123/status",
  "resultUrl": "/api/jobs/job_abc123/result"
}
```

**Status pollen:**
```bash
watch -n 2 'curl -s http://localhost:3000/api/jobs/job_abc123/status | jq ".percent, .phase"'
```

**Ergebnis abrufen:**
```bash
curl -s http://localhost:3000/api/jobs/job_abc123/result | jq '.'
```

### Was die Antwort enthält

| Feld | Bedeutung |
|------|-----------|
| `narrative.headline` | Kurzbewertung in 1–2 Sätzen |
| `narrative.summary` | Vollständige Analyse (markdown) |
| `narrative.keyPoints[]` | Die 3–5 wichtigsten Erkenntnisse |
| `narrative.recommendations[]` | Konkrete Handlungsempfehlungen |
| `regulatory_graph.signals[]` | Erkannte regulatorische Risikosignale (z.B. `VOLTAGE_HOP_REQUIRED`) |
| `regulatory_graph.graphBased` | `true` = Ontologie-Graph genutzt; `false` = Regex-Fallback |
| `grounding.facts[]` | Belegte Fakten mit Datenquelle und Konfidenz |
| `grounding.topologyHop` | Spannungsebenen-Hop-Analyse (falls `capacity_mw` gesetzt) |
| `grounding.toolSetRationale` | Begründung welche MCP-Tools verwendet wurden |
| `grounding.signalOverrides[]` | Automatisch hinzugezogene Zusatz-Tools |
| `context.confidence` | Gesamtkonfidenz: `high` / `medium` / `low` |

### Was `graphBased: true` bedeutet

Wenn `regulatory_graph.graphBased: true`, hat der Agent den **Central Asset Ontology Graph**
genutzt — eine strukturelle Analyse des MaStR-Anlagenbestands am Standort als Graphobjekt.
Das bedeutet:
- Signale basieren auf nachgewiesenen Kanten (z.B. `VERBUNDEN_MIT`-Kante zu einem NAP)
- Jedes Signal enthält `evidence: [nodeId]` für Nachvollziehbarkeit (EU AI Act Art. 12)
- Höhere Präzision als Regex-basierte Textanalyse

Wenn `graphBased: false`: Der Standort hat keinen MaStR-Bestand oder die Anlage ist
nicht im Graph — der Agent fällt auf Regex-Regelauswertung zurück.

---

## Der Zwiebelmodus erklärt

### Wie der Context Manager funktioniert

Der Zwiebelmodus beschreibt, wie der Agent bei komplexen Standorten schrittweise
tiefer in die Analyse geht. Stellen Sie sich eine Zwiebel vor:

- **Außenring:** Überblick — Gesamtstand Kapazität, Anlagenbestand, grobe Topologie
- **Mittlerer Ring:** Fokus auf kritische Signale — z.B. VOLTAGE_HOP_REQUIRED Detail
- **Kern:** Detailanalyse — Substation-Koordinaten, spezifische Netzknoten

Der Agent navigiert automatisch nach innen, wenn ein Signal entdeckt wird das
eine tiefere Betrachtung erfordert.

### Wann wird hineingezoomt?

| Signal | Auslöser | Zoom-Aktion |
|--------|----------|-------------|
| `VOLTAGE_HOP_REQUIRED` | Anlage ≥ 10 MW → MS/HS-Anschluss nötig | Agent sucht HS-Umspannwerk via OSM |
| `MISSING_NAP` | Keine NAP-Kante im MaStR | Detailabfrage Netzanschlusspunkt |
| `HIGH_CURTAILMENT` | Hohe Abregelung im Bestand | Redispatch-Exportdaten werden gezogen |
| `GRID_TOPOLOGY_RADIAL` | Radiale Netztopologie erkannt | Topologie-Details via OSM |

### Breadcrumb in der Antwort lesen

```json
{
  "context_manager": {
    "iterationCount": 2,
    "breadcrumb": ["Höheinöd-Gesamt", "Höheinöd-NAP-Detail"],
    "focusNodeId": "NAP_SEE999952467552"
  }
}
```

`iterationCount: 2` bedeutet: Der Agent hat in einer zweiten Runde die NAP-Details
analysiert. `focusNodeId` ist der Knoten auf dem der aktuelle Fokus liegt.

### maxIterations: warum mehrere Runden?

Das System begrenzt die Tiefe auf `maxIterations: 3` um Endlos-Schleifen zu verhindern.
Bei komplexen Fällen (z.B. Anlage ohne NAP + benötigter HS-Hop + hohe Abregelung)
sind 3 Analyserunden nötig. Jede Runde wird im `context_manager.iterationLog` protokolliert
(EU AI Act Art. 12 Audit-Trail).

---

## Ihr Profil lernt mit

### Was nach jeder Analyse implizit gespeichert wird

Nach jeder abgeschlossenen Analyse aktualisiert das System automatisch Ihr Profil
(nicht-blockierend, transparent im Hintergrund):

| Was gespeichert wird | Beispiel |
|----------------------|---------|
| Analysierhäufigkeit je Fokusbereich | `focusAreaFrequency.capacity: 8` |
| Welche Signals Sie wiederholt gesehen haben | `signalReactions.VOLTAGE_HOP_REQUIRED.seen: 3` |
| Welche MCP-Tools häufig genutzt wurden | `toolUsage.cernion_grid_data: 9` |
| Durchschnittliche Konfidenz Ihrer Analysen | `averageConfidence: 0.74` |

### Nach 5 Analysen zum selben Fokusbereich

```json
"preferences": {
  "focusAreaWeights": {
    "capacity": 1.0,
    "redispatch": 0.5,
    "section14a": 0.25
  },
  "preferredTools": ["cernion_grid_data", "cernion_installations_local", "osm_substation_finder"]
}
```

Der Agent priorisiert bei der nächsten Analyse automatisch `capacity`-Tools und
blendet Tools mit geringer Relevanz für Ihre Arbeitsweise aus.

### Eigene Präferenzen explizit setzen: PATCH /api/cya/profile/:id

Regulatorische "rote Linien" und strategische Ziele können jederzeit überschrieben werden:

```bash
curl -s -X PATCH http://localhost:3000/api/cya/profile/netzplanung_suedpfalz \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "constraints": [
      {
        "type": "regulatory",
        "value": "§ 14a EnWG — Mindestleistung 4,2 kW muss sichergestellt sein",
        "priority": "high"
      },
      {
        "type": "operational",
        "value": "Keine Topologie-Änderungen ohne Freigabe MS-Netz-Planung",
        "priority": "critical"
      }
    ],
    "priorityFocusAreas": ["capacity", "grid_expansion", "section14a"],
    "tone": "technisch-präzise"
  }'
```

**Wichtig:** `constraints` und `priorityFocusAreas` sind der **innere Ring** der Zwiebel
— sie werden niemals durch implizites Lernen überschrieben. Nur ein explizites PATCH
kann sie ändern.

---

## Typische Workflows

### Workflow 1: Neue Anlage im Netz beurteilen

**Szenario:** Ein Projektierer reicht einen Netzanschlussantrag für eine 12 MW Windanlage
in PLZ 66989 ein. Sie möchten die Netzauswirkung einschätzen.

**Schritt 1: Analyse starten**
```bash
curl -s -X POST http://localhost:3000/api/cya/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "profile_id": "netzplanung_suedpfalz",
    "context": {
      "location": "Höheinöd",
      "postleitzahl": "66989",
      "capacity_mw": 12,
      "focus_areas": ["capacity", "grid_expansion"]
    }
  }'
```

**Schritt 2: Ergebnis auswerten**

Bei einer 12 MW Anlage wird `VOLTAGE_HOP_REQUIRED` mit Severity `warning` ausgelöst:
```json
{
  "regulatory_graph": {
    "signals": [{
      "ruleId": "VOLTAGE_HOP_REQUIRED",
      "severity": "warning",
      "description": "Anlage ≥ 10 MW erfordert HS-Netzanschluss (110 kV)",
      "evidence": ["SUBSTATION_Pirmasens_HS"]
    }]
  },
  "grounding": {
    "topologyHop": {
      "needsHop": true,
      "requiredVoltageClass": "HS",
      "physicalConnectionPoint": "UW Pirmasens Nord",
      "distanceKm": 3.2
    }
  }
}
```

**Schritt 3: Mit Ergebnis weiterarbeiten**

Das `narrative.recommendations` Array enthält konkrete nächste Schritte:
- Umspannwerk-Kapazitätsprüfung
- MS/HS-Transformator-Reservierung
- Zeitplan für Netzausbaumaßnahme

---

### Workflow 2: Redispatch-Situation analysieren

**Szenario:** Überprüfung des Redispatch-2.0-Portfolios vor Settlement-Abschluss.

```bash
curl -s -X POST http://localhost:3000/api/cya/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "profile_id": "netzplanung_suedpfalz",
    "context": {
      "location": "Südpfalz",
      "focus_areas": ["redispatch", "capacity"]
    }
  }'
```

**Relevante Signale für Redispatch:**

| Signal | Bedeutung | Handlungsempfehlung |
|--------|-----------|---------------------|
| `HIGH_CURTAILMENT` | Hohe Abregelungsquote im Bestand | Settlement-Daten auf Vollständigkeit prüfen |
| `MISSING_NAP` | Anlage ohne MaStR-NAP | Stammdaten vor Settlement korrigieren |

Der Agent zieht automatisch über `cernion_redispatch_export` die Redispatch-2.0-fähigen
Anlagen (≥ 100 kW) und bewertet Settlement-Readiness.

---

### Workflow 3: §14a-Flexibilitätspotenzial ermitteln

**Szenario:** Quantifizierung des §14a-Steuerungspotenzials im NS-Netz.

```bash
curl -s -X POST http://localhost:3000/api/cya/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "profile_id": "netzplanung_suedpfalz",
    "context": {
      "location": "Südpfalz",
      "focus_areas": ["section14a", "capacity"]
    }
  }'
```

**Signal `SECTION14A_GAP` interpretieren:**

```json
{
  "ruleId": "SECTION14A_GAP",
  "severity": "info",
  "description": "Steuerbare Verbrauchseinrichtungen im NS-Netz nicht vollständig erfasst",
  "evidence": ["REGION_66989"]
}
```

Das Signal zeigt: Wallboxen und Wärmepumpen im Gebiet sind in MaStR vorhanden,
aber noch nicht alle mit §14a-Steuervertrag registriert. Die Analyse enthält
eine Schätzung des aktivierbaren Flexibilitätspotenzials in kW.

---

## Häufige Fragen (FAQ)

### Was bedeutet `graphBased: false`?

Der Standort hat keinen MaStR-Anlagenbestand oder die Anlagen sind nicht im
Ontologie-Graph erfasst. Der Agent fällt auf Regex-Regelauswertung zurück — die
Ergebnisse sind weniger präzise. Lösung: `capacity_mw` und PLZ im Request angeben,
damit der Agent über `postleitzahl`-Filter gezielt sucht.

### Wie lange dauert eine Analyse?

| Analysetyp | Typische Dauer |
|------------|----------------|
| Einfache Standortanalyse (1–2 Fokus) | 5–10 Sekunden |
| Komplexe Analyse (4 Fokus, capacity_mw gesetzt) | 15–30 Sekunden |
| Multi-Perspektiven-Analyse (3 Perspektiven) | 30–60 Sekunden |

Alle Analysen laufen asynchron (HTTP 202). Das Pollen per `statusUrl` zeigt
den Fortschritt in Prozent.

### Kann ich mehrere Standorte oder Perspektiven vergleichen?

Ja — der `compare-perspectives` Endpoint erstellt parallele Analysen:

```bash
curl -s -X POST http://localhost:3000/api/cya/compare-perspectives \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  -d '{
    "profile_ids": ["netzplanung_suedpfalz", "netzplanung_pfalz_nord"],
    "context": {
      "location": "Rheinland-Pfalz",
      "focus_areas": ["capacity", "redispatch"]
    }
  }'
```

### Was passiert wenn ich keine capacity_mw angebe?

Der `VOLTAGE_HOP_REQUIRED`-Check wird nicht ausgeführt. Alle anderen Analysen
laufen normal. Für Netzanschluss-Beurteilungen immer `capacity_mw` setzen.

### Wie exportiere ich eine Analyse als PDF?

```bash
SESSION_ID="<session_id aus Ergebnis>"
curl -s "http://localhost:3000/api/cya/sessions/${SESSION_ID}/export/pdf" \
  -H "Authorization: Bearer ck_<ihr-token>" \
  --output analyse_hoeheinsoed.pdf
```

---

*Cernion Energy Tools v0.34.0 | Netzplanung-Onboarding | Stand: 2026-04-29*
