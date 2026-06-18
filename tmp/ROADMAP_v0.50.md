# CERNION ROADMAP: 5-Baustein Implementierungsplan
## CR-CERNION-2026-05-12 — Mandatsblatt → Produktmuster

**Datum:** 2026-05-12
**Anforderer:** Thorsten Zoerner / STROMDAO GmbH
**Ziel:** Führungsmandate aus dem STROMDAO-Mandatsblatt in operative Entscheidungslogik und validierbare Umsetzung übersetzen.
**Codebasis:** Cernion Energy Tools v0.50.2 (71 Services, Moleculer.js)
**Constraint:** Maximale Wiederverwendung, keine doppelte Implementierung.

---

## 0. Kontext: Das STROMDAO-Mandatsblatt

Das Mandatsblatt validiert Leistung an 6 Dimensionen:
1. Operative Stabilität
2. End-to-End-Bereinigung
3. Abbau von Schatten-IT / Blindflug
4. Schutz vor kaufmännischen / regulatorischen Risiken
5. Portfolio-Steuerung
6. Explizite Steuerung impliziter Flexibilität

Diese 6 Dimensionen werden NICHT als 6 separate Services modelliert. Stattdessen werden sie in 5 Bausteine übersetzt, die auf bestehende Cernion-Services aufsetzen.

---

## 1. BAUSTEIN: Interface Placeholder Agent (IP)

### Zweck im Mandatsblatt
Deckt Dimension 2 (End-to-End-Bereinigung) und 3 (Blindflug-Abbau): Jede Lücke in einer E2E-Prozesskette muss als expliziter Slot sichtbar sein — nicht als stillschweigende Annahme.

### Neue Dateien
| Datei | Zweck |
|-------|-------|
| `services/interface-placeholder.service.js` | Deterministischer Service, kein LLM |
| `src/interface-placeholder-schema.js` | Enums: PLACEHOLDER_REASON, BLOCKING_LEVEL, SIGNAL_CODES |
| `tests/interface-placeholder.service.test.js` | Unit-Tests |
| `tests/interface-placeholder-e2e.test.js` | Blackbox-Tests |

### Actions
| Action | Input | Output |
|--------|-------|--------|
| `markGap` | `{role, reason, blockingLevel, replacementCriteria}` | Placeholder-Node |
| `requestEvidence` | `{placeholderId}` | Evidence-Signals |
| `returnMinimalStatus` | `{placeholderId}` | Minimal-Status (immer `confidence: low`) |
| `listGaps` | — (tenant implicit) | Placeholder-Node[] |
| `resolveGap` | `{placeholderId, resolution}` | Resolved-Node |

### Wiederverwendung bestehender Services
| Service | Nutzung |
|---------|---------|
| `capability-broker.service.js` | Fallback bei `score === 0` → IP-Empfehlung |
| `cya.service.js` + `src/cya-regulatory-graph.js` | `buildPlaceholderNode()` Factory |
| `hitl.service.js` | `blockingLevel: hard` → HITL-Trigger |
| `object-store.service.js` | Persistenz Phase 1.5 (MVP: In-Memory) |
| `api.service.js` | REST-Aliase |

### Datenmodell (JSON)
```json
{
  "placeholderId": "ph_netzanschluss_2026_001",
  "tenantId": "stromdao",
  "role": "grid_connection_validator",
  "reason": "NEEDS_OWNER | NEEDS_INTERFACE | NEEDS_EVIDENCE | NEEDS_DECISION | PLANNED_AGENT",
  "blockingLevel": "soft | hard",
  "signalCodes": ["NEEDS_OWNER", "NEEDS_INTERFACE"],
  "replacementCriteria": {
    "kind": "agent | api | process",
    "capabilityHint": "string",
    "deadline": "ISO8601"
  },
  "agentType": "interface_placeholder_agent",
  "confidence": "low",
  "status": "placeholder_gap",
  "createdAt": "ISO8601",
  "resolvedAt": "ISO8601 | null"
}
```

### MVP-Scope
- 3 Actions mit In-Memory-Registry
- Capability-Broker-Fallback
- CYA-Graph-Integration
- Tenant-Isolation via `getTenantId(ctx)`

### Out-of-Scope (Follow-up CRs)
- Persistente Registry (Object-Store Phase 1.5)
- Automatisches Replacement-Routing
- A2A-Protokoll-Integration

---

## 2. BAUSTEIN: Portfolio-Logik (PL)

### Zweck im Mandatsblatt
Deckt Dimension 5 (Portfolio-Steuerung): Anschluss-, Redispatch-, Beschaffungs- und Flexibilitätsporfolio müssen vergleichbar sein.

### Architekturentscheidung
**KEIN neuer Service.** Portfolio-Logik wird in bestehende Services integriert:

| Ziel-Service | Erweiterung | Begründung |
|-------------|-------------|------------|
| `services/znp.service.js` | `znp.assessPortfolio(projectId)` | ZNP ist bereits das Planungs-Asset-System. Portfolio ist eine Betrachtungsebene über ZNP-Projekten. |
| `services/finance-agent.service.js` | `finance-agent.portfolioMetrics(scenarioIds[])` | fNAV, RegKonto, TOTEX sind bereits hier. |
| `services/eog-calculator.service.js` | `eog-calculator.portfolioScenario(inputs)` | CAPEX/OPEX/TOTEX-Berechnungen existieren. |

### Neue Dateien
| Datei | Zweck |
|-------|-------|
| `src/portfolio-schema.js` | Szenario-Typen, Kriterien-Enum, Empfehlungs-Enum |
| `tests/portfolio-logic-integration.test.js` | Integrationstests |

### Kernlogik: Portfolio-Entscheidungsmatrix
Deterministische Scoring-Matrix (kein LLM):

| Kriterium | Gewicht | Quelle |
|-----------|---------|--------|
| wirtschaftlich | 0.30 | `eog-calculator` (CAPEX/OPEX/TOTEX) |
| regulatorisch | 0.25 | `mandate-compass` (Mandats-Alignment) |
| technisch | 0.25 | `znp` (N-1, Kapazität, g-Faktor) |
| zeitlich | 0.20 | `redispatch-expost` (Zeitdruck, Saisonalität) |

```javascript
// Deterministisch — kein LLM
overallScore = sum(criteriaScores[i] * weights[i])
if (overallScore >= 0.75) decision = "approve"
else if (overallScore >= 0.50) decision = "conditional"
else decision = "reject"
```

### Integration mit Interface Placeholder
Vor jeder Portfolio-Entscheidung:
```
portfolio-decision.evaluateScenario
  → interface-placeholder.canExecuteAction({action: "decision_commit"})
  → Wenn harter Placeholder → `decisionStatus: "blocked"`
  → Wenn weicher Placeholder → `decisionStatus: "assumptions_required"`
```

---

## 3. BAUSTEIN: Investitionsplanung / Budgetumsteuerung (IB)

### Zweck im Mandatsblatt
Deckt Dimension 4 (Schutz vor kaufmännischen Risiken) und 5 (Portfolio-Steuerung): Investitionen müssen gegen Mandatsziele validiert und Budgets bei Störungsdruck umgesteuert werden können.

### Architekturentscheidung
**KEIN neuer Service.** Erweiterung bestehender Services:

| Ziel-Service | Erweiterung |
|-------------|-------------|
| `services/finance-agent.service.js` | Neue Action `budgetScenario(budgetId, reallocations[])` |
| `services/eog-calculator.service.js` | Neue Action `investmentDelta(scenarioA, scenarioB)` |
| `services/redispatch-expost.service.js` | Neue Action `costAccumulation(auditIds[])` |

### Neue Dateien
| Datei | Zweck |
|-------|-------|
| `src/investment-schema.js` | Budget-Enum, Umsteuerungs-Regeln |
| `tests/investment-planning-integration.test.js` | Integrationstests |

### Kernlogik: Budgetumsteuerung bei Störungsdruck
```
1. Monatlicher Soll-Ist-Vergleich aus Redispatch-Expost
2. Wenn Abweichung > Threshold (z.B. 15%):
   a. Identifiziere betroffene Budget-Positionen
   b. Prüfe Mandats-Alignment (Mandats-Kompass)
   c. Erzeuge Interface-Placeholder für nicht genehmigte Umsteuerung
   d. HITL-Trigger bei `blockingLevel: hard` (z.B. > 1M EUR)
3. Document Trail in Object-Store
```

### Datenmodell (PouchDB / Object-Store)
```json
{
  "budgetId": "budget_2026_invest",
  "tenantId": "stromdao",
  "totalBudgetEUR": 5000000,
  "allocations": [
    {"category": "grid_expansion", "plannedEUR": 2000000, "committedEUR": 1500000},
    {"category": "redispatch_buffer", "plannedEUR": 500000, "committedEUR": 750000}
  ],
  "reallocations": [
    {"from": "grid_expansion", "to": "redispatch_buffer", "amountEUR": 250000, "trigger": "STOERUNG_Q2_2026", "approvedBy": "userId | null"}
  ],
  "mandateAlignment": {
    "mandateId": "stromdao-netze-2026",
    "aligned": true,
    "checkDate": "ISO8601"
  }
}
```

### Guardrail
- Budget-Commits über > 1M EUR erfordern explizite HITL-Freigabe
- Jede Umsteuerung hinterlässt Audit-Trail in `object-store`
- `interface-placeholder` blockiert ungenehmigte Umsteuerung

---

## 4. BAUSTEIN: Störungen als Investitionssignale (SI)

### Zweck im Mandatsblatt
Deckt Dimension 1 (Operative Stabilität) und 6 (Explizite Steuerung impliziter Flexibilität): Störungen dürfen nicht nur reaktiv bearbeitet werden, sondern müssen als Input für Investitions- und Flexibilitätsentscheidungen fließen.

### Architekturentscheidung
**Neuer Service:** `services/disturbance-signal.service.js` — NEIN, vermischt Domänen.

**Stattdessen:** Erweiterung `services/blindflug-radar.service.js` (aus vorherigem Plan) + Integration in Portfolio-Logik.

| Ziel-Service | Erweiterung |
|-------------|-------------|
| `services/blindflug-radar.service.js` | Neue Signal-Typen: `DISTURBANCE_PATTERN`, `REPEATING_FAULT` |
| `services/forecast-engine.service.js` | Neue Action `disturbanceTrend(region, timeWindow)` |
| `services/portfolio-decision.service.js` *(neu, Phase 4)* | `recommendFromDisturbances(disturbanceIds[])` |

### Neue Dateien
| Datei | Zweck |
|-------|-------|
| `src/disturbance-schema.js` | Störungs-Typen, Korrelations-Regeln |
| `tests/disturbance-signal-integration.test.js` | Integrationstests |

### Kernlogik: Störungsdruck → Investitionssignal
```
1. Blindflug-Radar scannt Redispatch-Audits, Grid-Operations, MaStR
2. Pattern-Erkennung:
   - ≥3 Störungen gleichen Typs in 90 Tagen → `signalType: DISTURBANCE_PATTERN`
   - wiederkehrende Fehler ohne Maßnahme → `signalType: REPEATING_FAULT`
3. Korrelation mit Portfolio:
   a. Welche Assets / Regionen betroffen?
   b. Welche Investitionsoptionen existieren in ZNP?
   c. Cost-of-Do-Nothing vs. Cost-of-Investment
4. Output: Investitionsempfehlung mit Störungsbegründung
```

### Beispiel-Domain-Fall
```
Setup:
- Redispatch-Expost zeigt 4x Störung "Trafo Überlastung" in Q1/2026
- Grid-Operations bestätigt: N-1-Verletzung bei Trafo T-42

Ablauf:
1. blindflug-radar.scanBlindflug → signalType: DISTURBANCE_PATTERN
2. disturbance-signal.correlate → assetId: "trafo_t42", region: "industriegebiet_nord"
3. znp.projects.list → offenes Projekt "Trafo T-42 Ersatz" (CAPEX 450k€)
4. portfolio-decision.evaluate → Störungskosten (4x Redispatch ~80k€/Q) vs. Investition
5. Output: Empfehlung "Trafo-Tausch vorziehen", confidence: high
```

### Integration mit Interface Placeholder
- Wenn Störungskorrelation unvollständig (fehlende Asset-Daten) → `interface-placeholder.markGap({reason: "NEEDS_EVIDENCE"})`
- Wenn Investitionsempfehlung Mandatsgrenzen verletzt → `blockingLevel: hard`

---

## 5. BAUSTEIN: Netzfahrplan / fNAV als Alternative zu Kupferausbau (NF)

### Zweck im Mandatsblatt
Deckt Dimension 4 (regulatorische Risiken) und 6 (Flexibilitätssteuerung): Ein formaler Netzfahrplan rechtssichert Ablehnungen. fNAV (flexibler Netzanschlussvertrag) reduziert Kupferausbau durch vertragliche Flexibilität.

### Architekturentscheidung
**KEIN neuer Service.** Integration in bestehende Grid-Services:

| Ziel-Service | Erweiterung |
|-------------|-------------|
| `services/grid-operations.service.js` | Neue Action `netzfahrplan.generate(region, assets[])` |
| `services/grid-connection.service.js` | Neue Action `fnav.validate(connectionId, flexibilityProfile)` |
| `services/finance-agent.service.js` | Neue Action `fnavEconomics(connectionId)` (vermiedene Kupferkosten) |
| `services/znp.service.js` | Layer-2.5: Strategische Annahmen für fNAV-Szenarien |

### Neue Dateien
| Datei | Zweck |
|-------|-------|
| `src/netzfahrplan-schema.js` | Fahrplan-Typen, fNAV-Profile, Kapazitäts-Regeln |
| `tests/netzfahrplan-integration.test.js` | Integrationstests |

### Kernlogik: Netzfahrplan
```
1. Aggregation aller Erzeugungs- und Verbrauchsfahrpläne (MaStR, EDM)
2. Berücksichtigung bestehender fNAV-Verträge (max. Leistung, Spitzenkappung)
3. N-1-Prüfung für jede Netzknoten
4. Ausgabe: Formaler Netzfahrplan als Beweis für Kapazitätsstatus
5. Bei Ablehnung: Nachweis, dass alle zumutbaren Maßnahmen ausgeschöpft
```

### Kernlogik: fNAV als Kupferalternative
```
Input: Anschlussbegehren (z.B. 18 MW Wärmepumpe)
1. Grid-Connection prüft: Reiner Kupferausbau = 18 MW
2. fNAV-Szenario berechnen:
   a. Statische Spitzenkappung (z.B. 9,5 MW max. Bezug)
   b. Dynamische Flexibilität (batteriegestützt, steuerbar)
3. N-1-Prüfung mit fNAV-Profil
4. Wenn N-1 erfüllt → fNAV-Vertrag als Alternative
5. Wenn N-1 nicht erfüllt → Kupferausbau nötig, aber mit geringerer Dimension
6. Output: Vergleichsszenario (Kupfer vs. fNAV)
```

### Datenmodell: fNAV-Profil
```json
{
  "fnavId": "fnav_wwvp_2026_001",
  "tenantId": "stromdao",
  "connectionId": "grid_con_wwvp_001",
  "profileType": "static_cap | dynamic_flex | hybrid",
  "maxPowerKW": 9500,
  "peakShaving": {
    "enabled": true,
    "maxPeakKW": 9500,
    "peakDurationHours": 4
  },
  "flexibilityOptions": [
    {"type": "battery_storage", "capacityKWh": 20000, "responseTimeSec": 30}
  ],
  "gridCostAvoidanceEUR": 1200000,
  "annualFeeEUR": 45000,
  "validFrom": "2026-07-01",
  "validTo": "2031-06-30"
}
```

### Integration mit Portfolio-Logik
```
portfolio-decision.evaluateScenario
  → grid-connection.validate (mit/ohne fNAV)
  → finance-agent.portfolioMetrics (fNAV-Einsparung vs. Kupferkosten)
  → eog-calculator.investmentDelta (TOTEX-Vergleich)
```

### Integration mit Interface Placeholder
- Wenn fNAV-Profil unvollständig → `NEEDS_EVIDENCE`
- Wenn BNetzA-Zulassung fehlt → `NEEDS_DECISION` (hard)
- W cuando keine Asset-Daten für N-1-Prüfung → `NEEDS_INTERFACE`

### Statusabgleich v0.51.6 (Cleanup-Release)

**Validiert gegen den implementierten Stand `v0.51.5` / dokumentiert in `v0.51.6`.**

#### Bereits umgesetzt in der Codebasis
- `src/netzfahrplan-schema.js` existiert und liefert den deterministischen Kern für fNAV-/Netzfahrplan-Bewertung:
  - `normaliseFnavProfile()`
  - `resolveN1Threshold()`
  - `checkN1Compliance()`
  - `resolveGovernanceStatus()`
  - `checkEvidenceCompleteness()`
- `services/grid-operations.service.js` enthält `netzfahrplanGenerate` als technische Phase-5-Pipeline (Profil → N-1 → Feasibility → Governance).
- `services/grid-connection.service.js` enthält `fnavValidate` als deterministische Grid-Connection-Einbettung.
- `services/finance-agent.service.js` enthält `fnavEconomics` für vermiedene CAPEX, Payback und kommerzielle Flags.
- `services/api.service.js` exponiert die Phase-5-REST-Aliase und OpenAPI-Dokumentation.
- `services/znp.service.js` nutzt bereits Layer-2.5-fNAV-Annahmen (`kaufmaennischeFreigabeFnav`) im strategischen Portfolio-Kontext.
- Tests sind vorhanden (`tests/netzfahrplan-schema.test.js`, `tests/netzfahrplan-integration.test.js`, API-/Dashboard-Regressionen).

#### Gegenüber diesem Roadmap-Stand bewusst vereinfacht / auf spätere Releases verschoben
- **N-1-Konfiguration:** Die aktuelle Implementierung arbeitet mit env-basierten Defaults plus expliziten Request-Overrides. Die vollständige Herkunft aus `src/domain-config.js` inkl. automatischer Tenant-/Projekt-/Szenario-Auflösung ist **nicht** Bestandteil von `v0.51.5` und wird in spätere Releases verschoben.
- **Governance-Artefakte:** Die Phase-5-Endpunkte berechnen Governance-Blocker deterministisch, erzeugen aber aktuell **keine direkten** `interface-placeholder`- oder HITL-Artefakte. Diese Anbindung bleibt Follow-up-Scope.
- **Formaler Beweis / Decision Chain:** Die aktuellen Antworten liefern Findings, N-1-Transparenz und Governance-Felder, aber noch keinen expliziten End-to-End-`decisionChain`-/`proof`-Payload über Technik, Wirtschaft und Governance hinweg.
- **Vollständiges Roadmap-fNAV-Profil:** Das ausgelieferte Modell priorisiert deterministische Kerndaten (`requestedCapacity`, `firmCapacity`, `flexibleCapacity`, `contractStatus`, `legalStatus`, `evidenceLevel`, `resultingEffectiveCapacity`). Felder wie `connectionId`, `validFrom`, `validTo`, `flexibilityOptions[]`, `annualFeeEUR` als gemeinsames Vertragsobjekt und erweiterte Peak-Shaving-Strukturen bleiben spätere Ausbaupunkte.
- **Capability Broker Discovery:** Es gibt aktuell keinen dedizierten Capability-Eintrag für `netzfahrplan` / `fnav`; Discovery läuft indirekt über bestehende Portfolio-/ZNP-Kapazitäten. Ein eigener Katalogeintrag wird später ergänzt.

#### Release-Interpretation
- `v0.51.5` gilt als **funktionaler Phase-5-Release**.
- `v0.51.6` ist ein **Cleanup-/Dokumentations-Release**, das den Abgleich zwischen Roadmap-Plan und tatsächlich gelieferter Phase-5-Scope nachvollziehbar macht.
- Die oben genannten offenen Punkte sind **keine Regressionen**, sondern bewusst nicht in den deterministischen Kern von `v0.51.5` aufgenommen worden.

---

## 6. ZENTRALE REUSE-MAP (Gesamt)

| Bestehender Service | Wie oft wiederverwendet | Durch welche Bausteine |
|---------------------|------------------------|----------------------|
| `capability-broker.service.js` / `src/capability-catalog.js` | 5x | Alle 5 Bausteine |
| `cya.service.js` / `src/cya-regulatory-graph.js` | 3x | IP, PL, IB |
| `znp.service.js` | 4x | PL, IB, SI, NF |
| `finance-agent.service.js` | 4x | PL, IB, SI, NF |
| `eog-calculator.service.js` | 3x | PL, IB, NF |
| `redispatch-expost.service.js` | 3x | IB, SI, PL |
| `grid-operations.service.js` | 3x | SI, NF, PL |
| `grid-connection.service.js` | 2x | NF, PL |
| `object-store.service.js` | 4x | IP, IB, SI, PL |
| `hitl.service.js` | 2x | IP, IB |
| `api.service.js` | 5x | Alle 5 Bausteine |
| `agent.service.js` / `src/agent-planning-utils.js` | 1x | PL (optional LLM) |

**Anti-Duplikat-Regeln (hart):**
1. Kein zweiter Object-Store → `object-store` mit Namespaces
2. Kein zweiter QDrant-Client → `query.service.js` delegieren
3. Kein zweite Tenant-Isolation → immer `getTenantId(ctx)`
4. Kein zweite Job-Status-Tracking → `job-status.service.js`
5. Kein zweite Graph-Engine → `cya-regulatory-graph.js` erweitern

---

## 7. PHASENPLAN (Empfohlene Umsetzungsreihenfolge)

### Phase 1: Interface Placeholder Agent (Woche 1)
**Warum zuerst:** IP ist Infrastruktur für alle anderen Bausteine. Ohne explizite Lückenmarkierung können Portfolio-, Investitions- und Störungslogiken nicht unterscheiden zwischen "Daten fehlen" und "Entscheidung steht".

1. `src/interface-placeholder-schema.js`
2. `services/interface-placeholder.service.js` (3 Actions)
3. `src/capability-catalog.js` — Eintrag `interface_placeholder`
4. `services/capability-broker.service.js` — Fallback-Logik
5. `src/cya-regulatory-graph.js` — `buildPlaceholderNode()`
6. `services/api.service.js` — Aliase
7. Tests

**Erster PR:** `feat/interface-placeholder-agent`

### Phase 2: Portfolio-Logik (Woche 2)
**Abhängigkeit:** Keine harte Abhängigkeit, aber IP verbessert die UX (Lücken sichtbar).

1. `src/portfolio-schema.js`
2. Erweiterung `znp.service.js` — `assessPortfolio()`
3. Erweiterung `finance-agent.service.js` — `portfolioMetrics()`
4. Erweiterung `eog-calculator.service.js` — `portfolioScenario()`
5. `src/capability-catalog.js` — Eintrag `portfolio_decision`
6. Tests

**PR:** `feat/portfolio-logic`

### Phase 3: Investitionsplanung / Budgetumsteuerung (Woche 3)
**Abhängigkeit:** Benötigt PL (Szenario-Bewertung) und IP (Blocker-Prüfung).

1. `src/investment-schema.js`
2. Erweiterung `finance-agent.service.js` — `budgetScenario()`
3. Erweiterung `eog-calculator.service.js` — `investmentDelta()`
4. Erweiterung `redispatch-expost.service.js` — `costAccumulation()`
5. Integration `interface-placeholder` für Budget-Commits > 1M EUR
6. Tests

**PR:** `feat/investment-planning`

### Phase 4: Störungen als Investitionssignale (Woche 4)
**Abhängigkeit:** Benötigt IP (Datenlücken) und PL (Investitionsempfehlung).

1. `src/disturbance-schema.js`
2. Erweiterung `blindflug-radar.service.js` — Signal-Typen `DISTURBANCE_PATTERN`, `REPEATING_FAULT`
3. Erweiterung `forecast-engine.service.js` — `disturbanceTrend()`
4. Integration mit `portfolio-decision`
5. Tests

**PR:** `feat/disturbance-signals`

### Phase 5: Netzfahrplan / fNAV (Woche 5-6)
**Abhängigkeit:** Benötigt PL (Szenario-Vergleich) und IP (Evidenzlücken).

1. `src/netzfahrplan-schema.js`
2. Erweiterung `grid-operations.service.js` — `netzfahrplan.generate()`
3. Erweiterung `grid-connection.service.js` — `fnav.validate()`
4. Erweiterung `finance-agent.service.js` — `fnavEconomics()`
5. ZNP Layer-2.5: Strategische Annahmen für fNAV
6. Tests

**PR:** `feat/netzfahrplan-fnav`

### Phase 6: Integration & Hardening (Woche 7)
- End-to-End-Tests über alle 5 Bausteine
- Cross-Tenant-Isolation validieren
- Performance-Test: Object-Store Mango-Queries
- Dokumentation: `llm.txt` Update

---

## 8. NEUE SERVICES vs. GEÄNDERTE SERVICES (Zusammenfassung)

### Neue Services (1)
| Service | Begründung |
|---------|------------|
| `services/interface-placeholder.service.js` | Querschnittliche Infrastruktur für Lückenmarkierung. Darf nicht in CYA/Agent vermischt werden. |

### Geänderte Services (10)
| Service | Änderung | Durch welchen Baustein |
|---------|----------|----------------------|
| `capability-broker.service.js` | Fallback-Logik | IP |
| `cya.service.js` / `src/cya-regulatory-graph.js` | `buildPlaceholderNode()`, neue Kanten-Typen | IP, PL |
| `znp.service.js` | `assessPortfolio()`, Layer-2.5 fNAV | PL, NF |
| `finance-agent.service.js` | `portfolioMetrics()`, `budgetScenario()`, `fnavEconomics()` | PL, IB, NF |
| `eog-calculator.service.js` | `portfolioScenario()`, `investmentDelta()` | PL, IB |
| `redispatch-expost.service.js` | `costAccumulation()` | IB, SI |
| `grid-operations.service.js` | `netzfahrplan.generate()` | NF, SI |
| `grid-connection.service.js` | `fnav.validate()` | NF |
| `blindflug-radar.service.js` | Signal-Typen `DISTURBANCE_PATTERN`, `REPEATING_FAULT` | SI |
| `forecast-engine.service.js` | `disturbanceTrend()` | SI |

### Unberührte Services (wichtig)
| Service | Warum unberührt |
|---------|-----------------|
| `vdmi.service.js` | VDMI bleibt eigenständig; Placeholder sind explizit vom Modellierer zu setzen |
| `edm.service.js` | EDM ist Datenquelle, keine Entscheidungslogik |
| `agent.service.js` | Kein Code-Change (nur Catalog-Referenz) |
| `datasource-registry.service.js` | Nur Lesen, keine Änderung |
| `object-store.service.js` | Nur Aufrufe, keine Änderung |

---

## 9. RISIKEN & MITIGATION

| Risiko | P | Impact | Mitigation |
|--------|---|--------|------------|
| Placeholder als fachliche Wahrheit missverstanden | M | H | Response immer `agentType: interface_placeholder_agent`, `confidence: low` |
| Capability-Broker Flood | M | M | Fallback nur bei `score === 0`. Threshold-Logging. |
| HITL-Flood bei Budget-Commits | L | H | Default `soft`. `hard` nur > 1M EUR oder regulatorisch. |
| In-Memory-Datenverlust (MVP) | H | M | MVP-Disclaimer. Phase 1.5: Object-Store-Persistenz. |
| fNAV rechtlich nicht haltbar | M | H | `finance-agent` berechnet nur; rechtliche Prüfung bleibt menschlich. |
| Störungskorrelation false positive | M | M | Mindestens 3 Vorkommen in 90 Tagen. Menschliche Bestätigung vor Investition. |
| Tenant-Leakage | L | Kritisch | `getTenantId(ctx)` überall. E2E-Isolation-Tests. |
| Zirkuläre Abhängigkeiten | M | H | E2E-Prozesskarte darf nicht Blindflug-Radar aufrufen (und umgekehrt). |

---

## 10. NÄCHSTE SCHRITTE / OFFENE ENTSCHEIDUNGEN

1. **Persistenz-Strategie:** Object-Store (PouchDB) im MVP für alle Features, oder SQLite/PostgreSQL?
2. **Portfolio-Regeln:** Sind Entscheidungsregeln hardcoded oder tenant-konfigurierbar?
3. **HITL-Routing:** Wer bekommt `hard`-Blockaden? (C-Level, Product Owner, Domain-Expert)
4. **fNAV-Rechtsrahmen:** Wie eng bindet Cernion den Nutzer an rechtssichere fNAV-Verträge?
5. **QDrant-Integration:** Nutzt Mandats-Kompass native QDrant-Queries oder delegiert an `query.service.js`?

---

## 11. DELIVERABLES

| Dokument | Ort |
|----------|-----|
| Dieser Plan | `docs/plans/2026-05-12-cernion-roadmap-5-feature-plan.md` (bereits existent, erweitert) |
| Schema-Module | `src/*-schema.js` (5 Dateien) |
| Service-Module | `services/interface-placeholder.service.js` (1 neu) + 10 Patches |
| Tests | `tests/*.test.js` (~15 Dateien) |
| API-Doku | `llm.txt` (Update) |
