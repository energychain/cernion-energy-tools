# Cernion Lagebild-Exploration Protokoll

**Zweck:** Leitfaden für die iterative, systematische Analyse aller Moleculer-Services durch Claude oder Hermes, um ein belastbares architektonisches Lagebild zu erhalten.
**Ziel:** Vermeidung von Kontext-Überlastung durch Tranchierung und Nutzung standardisierter Bewertungsfragen.

---

## 1. Das Tranchen-Modell (Iterative Exploration)

Wir analysieren die über 70 Services nicht in einem einzigen, riesigen Durchgang, sondern in **vier thematischen Slices (Tranchen)**. Dies sichert eine hohe Analysetiefe und verhindert, dass die evaluierende KI Details übersieht.

```
┌────────────────────────────────────────────────────────┐
│ TRANCHE A: Die Datensensoren (Layer 1)                 │
│ Fokus: Passive Datenbeschaffung, APIs, Zustandslos     │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ TRANCHE B: Die Infrastruktur & Transport (Layer 0)     │
│ Fokus: Gateways, Auth, Token, Ingestion, Datapoints    │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ TRANCHE C: Die Orchestrierung & Use Cases (Layer 2)    │
│ Fokus: ZNP, CYA, VDMI, Grid, Sharing, Berichte         │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ TRANCHE D: Die kognitiven Agenten-Cores (Layer 3)       │
│ Fokus: Personal-Agent, Finance-Agent, Dialogführung    │
└────────────────────────────────────────────────────────┘
```

---

## 2. Der Audit-Promp-Template für Claude / Hermes

Für jede Tranche übergibst du der KI (Claude oder Hermes) den nachfolgenden Prompt zusammen mit den Code-Dateien der jeweiligen Tranche.

```text
Du bist ein erfahrener Software-Architekt und evaluierst das Backend von Cernion Energy Tools.
Wir führen eine Schichtenarchitektur (Strict Layering) mit kaskadierenden Capability-Brokern und No-Code-Receipts ein.

Hier ist unser Soll-Referenzmodell:
- Layer 3 (Kognitiver Dialog): Nur Dialog, Slot-Filling, ReAct, keine fachlichen Rechenregeln.
- Layer 2 (Semantische Orchestrierung): Deklarative Receipts, Use Cases, mathematische Verknüpfung von L1-Daten, OEO-Semantik.
- Layer 1 (Daten & Ressourcen): Reine, passive, zustandslose Datenbeschaffung (MaStR, GSI, OSM, etc.). Keine KI, kein Text-Output für Nutzer.
- Layer 0 (System & Infrastruktur): Transport, API-Gateways, Auth, Token, Ingestion-Pipelines.

Deine Aufgabe ist es, die beigefügten Services dieser Tranche zu analysieren und ein scharfes Lagebild zu zeichnen.

Bewerte jeden Service einzeln nach diesen drei Kriterien:

1. Schichtstreue (Layer-Adherence): 
   Liegt der Service in der korrekten Schicht oder gibt es "Leckagen" (z. B. L1-Service generiert Text; L2-Service verwaltet Dialogzustand)?
2. Abhängigkeitsrichtung (No-Upward-Dependencies): 
   Ruft der Service Logik aus höheren Schichten auf oder umgeht er die vorgesehenen Broker-Schnittstellen (Layer-Skipping)?
3. Härtungs-Zustand (Hardcoded vs. Declarative):
   Enthält der Service hartcodierte Spezial-Weichen (Regex-Abfragen, Sonder-Ifs für Orte/Geräte), die eigentlich in ein deklaratives L2-Receipt-JSON gehören?

Gib deine Bewertung für jeden Service in folgendem Format aus:

### [Service-Name]
- **Empfohlene Zielschicht:** [Layer 0 / 1 / 2 / 3]
- **Status-Ampel:** [GRÜN / GELB / ROT]
- **Befund Schichtstreue:** [Detaillierte Analyse]
- **Befund Abhängigkeiten:** [Detaillierte Analyse]
- **Befund Härtungs-Zustand:** [Detaillierte Analyse]
- **Konkrete Aufräum-Empfehlung:** [Was muss gelöscht, verschoben oder in ein JSON-Receipt ausgelagert werden?]
```

---

## 3. Die Tranchen im Detail (Zugeordnete Dateien)

### TRANCHE A: Die Datensensoren (Layer 1)
*Fokus: Sind diese Services wirklich passiv und frei von Dialog-Annahmen?*
*   `services/energy-market.service.js`
*   `services/entsoe.service.js`
*   `services/osm-geo.service.js`
*   `services/residual-load.service.js`
*   `services/assets.service.js`
*   `services/mastr-monitor.service.js`
*   `services/mastr-quality.service.js`
*   `services/slp.service.js`
*   `services/edm.service.js` (und `services/edm-*.service.js`)

---

### TRANCHE B: Die Infrastruktur & Transport (Layer 0)
*Fokus: Wie sauber sind die technischen Schleusen? Gibt es hier unzulässigen fachlichen Code?*
*   `services/api.service.js`
*   `services/dashboard-api.service.js`
*   `services/auth.service.js`
*   `services/token-manager.service.js`
*   `services/datapoint.service.js`
*   `services/datasource-registry.service.js` (und `services/datasource-*.service.js`)
*   `services/system.service.js`
*   `services/tenant-quota.service.js`

---

### TRANCHE C: Die Orchestrierung & Use Cases (Layer 2)
*Fokus: Welche dieser Dienste sind bereits deklarativ vorbereitet? Wo sind Berechnungen und Datenverknüpfungen noch hart im Code verdrahtet?*
*   `services/agent-receipts.service.js`
*   `services/capability-broker.service.js`
*   `services/znp.service.js`
*   `services/cya.service.js`
*   `services/vdmi.service.js` (und `services/vdmi-*.service.js`)
*   `services/grid-connection.service.js`
*   `services/grid-operations.service.js`
*   `services/energy-sharing.service.js` (und `services/energy-sharing-*.service.js`)
*   `services/utility-report.service.js`
*   `services/redispatch-expost.service.js`
*   `services/hitl.service.js`

---

## TRANCHE D: Die kognitiven Agenten-Cores (Layer 3)
*Fokus: Befreiung von jeglicher Fachdomäne. Wo stecken hier die größten Legacy-Fallen und hartcodierten Weichen?*
*   `services/personal-agent.service.js` (Hauptfokus: 303 KB Code!)
*   `services/agent.service.js`
*   `services/finance-agent.service.js`
*   `services/customer-service.service.js`
