# CR-0003-missing-agent-fields: Drei fehlende Response-Felder in Agenten-Endpunkten

**Typ:** Change Request (CR)
**Erstellt:** 2026-04-05
**Erstellt durch:** Backend (post-gate verification session v0.20.4, `docs/ui-contract-verification.md`)
**Status:** open
**Priorität:** medium
**Ziel-Version:** 0.21.x
**Verwandt:** `CR-0003.md` (umfassende Version inkl. DELETE-Endpunkte)

---

## Hintergrund

Die UI-Contract-Verifikation (v0.20.4) hat drei fehlende Felder in den Agenten-Responses
identifiziert. Diese Felder stehen in den ursprünglichen UI-Contracts (v0.19.0) als spezifiziert,
wurden aber nie implementiert. Es handelt sich **nicht** um Bugs, sondern um genuine
Feature-Lücken (spekulative Vorausplanung in den Contracts).

Alle drei sind in `docs/ui-contract-verification.md` als `❌ (not present)` markiert.

---

## Feld 1 — `steps[].findingCode` (grid-connection)

### Problem

`GET /api/grid-connection/validations` und `POST /api/grid-connection/validate` liefern
`steps[]` mit `step`, `name`, `status` — aber kein `findingCode` pro Schritt.

### Ist-Zustand

```json
"steps": [
  { "step": 1, "name": "Installation Lookup", "status": "pass" },
  { "step": 2, "name": "Capacity Check",      "status": "fail" }
]
```

### Soll-Zustand

```json
"steps": [
  { "step": 1, "name": "Installation Lookup", "status": "pass", "findingCode": null },
  { "step": 2, "name": "Capacity Check",      "status": "fail", "findingCode": "GC_CAPACITY_INSUFFICIENT" }
]
```

### Workaround (Contract bereits aktualisiert)

UI filtert `findings[]` nach `finding.step === stepNumber` für per-Step-Anzeige.

### Implementierungshinweis

- Service: `services/grid-connection.service.js` — Step-Ergebnis-Mapping anpassen
- Bestehende Findings kennen bereits den zugehörigen Step

---

## Feld 2 — `curtailment` Top-Level-Objekt (redispatch-expost)

### Problem

Step 4 (`curtailmentCorrelation`) berechnet Abregelungsdaten intern, exponiert aber
weder die Datenquelle (`source`) noch einen direkten `highFrequencyFlag` als top-level
Response-Felder.

### Ist-Zustand

```json
"riskAssessment": {
  "riskLevel":                       "medium",
  "curtailmentGWh":                  123.4,
  "estimatedLostCompensationEur":    45000,
  "blockedFractionPercent":          23.1
}
```

### Soll-Zustand

Neues top-level Objekt `curtailment` zusätzlich zu `riskAssessment`:

```json
"curtailment": {
  "totalGWh":          123.4,
  "source":            "netztransparenz" | "datapoint" | "none",
  "highFrequencyFlag": false
}
```

`highFrequencyFlag: true` wenn Finding `RD_HIGH_CURTAILMENT_PERIOD` in `findings[]` vorhanden.
`source` aus dem Step-4-Kontext: Weg A → `"netztransparenz"`, Weg B → `"datapoint"`.

### Workaround (Contract bereits aktualisiert)

- `curtailmentGWh` über `riskAssessment.curtailmentGWh` verfügbar
- High-frequency-Flag über Presence von Finding `RD_HIGH_CURTAILMENT_PERIOD` ermittelbar

### Implementierungsaufwand: Gering

Step 4 kennt Quelle und Flag bereits intern. Nur das Mapping ins Return-Objekt fehlt.

---

## Feld 3 — `portfolioSource` / `portfolio.weg` (redispatch-expost)

### Problem

Der alte Contract spezifizierte `portfolio.weg: "A" | "B"` als direktes Response-Feld.
Aktuell kann Weg B nur indirekt über Finding `RD_USED_WEG_B` in `findings[]` erschlossen werden.

### Ist-Zustand

Kein direktes Portfolio-Weg-Feld im Response. `tryDatapointFallback()` setzt Weg B intern,
persistiert ihn als Finding, gibt ihn aber nicht im Root-Objekt zurück.

### Soll-Zustand

Erweiterung des `summary`-Objekts:

```json
"summary": {
  "totalInstallations":  59,
  "portfolioSource":     "weg_a" | "weg_b",
  "findingsCount":       { "info": 2, "warning": 3, "error": 0 },
  "durationMs":          45230
}
```

### Workaround (Contract bereits aktualisiert)

Presence von Finding `RD_USED_WEG_B` in `findings[]` zeigt Weg B an.

### Implementierungsaufwand: Gering

```js
// services/redispatch-expost.service.js — tryDatapointFallback() bereits bekannt:
return { success: true, id, portfolioSource: usedWegB ? 'weg_b' : 'weg_a', ...report };
```

---

## Akzeptanzkriterien

- [ ] `steps[].findingCode` in `grid-connection` Response vorhanden (null wenn kein Finding)
- [ ] `curtailment.totalGWh`, `curtailment.source`, `curtailment.highFrequencyFlag` in `redispatch-expost` Response
- [ ] `summary.portfolioSource` (`"weg_a"` | `"weg_b"`) in `redispatch-expost` Response
- [ ] `docs/ui-contracts/06-grid-connection.md` und `docs/ui-contracts/08-redispatch.md` aktualisiert
- [ ] Unit-Tests für alle drei neuen Felder
- [ ] OpenAPI-Audit besteht (`npm run audit:openapi`)
- [ ] `❌`-Einträge in `docs/ui-contract-verification.md` auf `✅` gesetzt

---

## Betroffene Dateien (voraussichtlich)

| Datei | Änderung |
|-------|----------|
| `services/grid-connection.service.js` | `findingCode` in `steps[]` Mapping |
| `services/redispatch-expost.service.js` | `curtailment` top-level + `summary.portfolioSource` |
| `docs/ui-contracts/06-grid-connection.md` | `steps[].findingCode` Hinweis entfernen |
| `docs/ui-contracts/08-redispatch.md` | `curtailment` + `portfolioSource` Felder hinzufügen |
| `docs/ui-contract-verification.md` | `❌` → `✅` nach Implementierung |

---

## Notizen

- Übergeordneter CR mit DELETE-Endpunkten: `feedback/CR-0003.md`
- Diese drei Felder haben jeweils einen funktionierenden Workaround — kein akuter Handlungsbedarf
- Alle drei Implementierungen sind gering aufwendig (< 1h pro Feld)
