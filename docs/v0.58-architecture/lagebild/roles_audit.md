# Audit Report: Fachliche Rollen & Actor-Zugehörigkeiten (Erweitert)

**Zweck:** Zuordnung aller 76 Moleculer-Services zu internen und externen fachlichen Rollen.
**Bedeutung für die Zielarchitektur:** Bestimmt die Berechtigungs- und Datengrenzen (Trust Boundaries) für die Layer-2-Blueprints und das kaskadierende Broker-Routing.
**Generiert am:** 2026-05-31T15:08:07.276Z (UTC)

---

## 1. Die erweiterten Fachlichen Rollen (Actor-Ebenen)

Neben den klassischen Stadtwerk-internen Rollen bezieht Cernion die gesamte Energiewertschöpfungskette und alle externen Marktteilnehmer ein:

### A. Stadtwerk-interne Rollen
1.  **ROLE_GRID_OPERATOR (Netzbetreiber - VNB/DSO):** Technische Netzplanung, §14a EnWG, Netzbetrieb, physikalische Assets.
2.  **ROLE_COMMERCIAL_SUPPLY (Netzwirtschaft / Lieferant):** Handels- und Abrechnungsprozesse (Bilanzkreise, Flex-Markt).
3.  **ROLE_UTILITY_HQ (Stadtwerk Holding):** Kaufmännische Führung, übergreifendes BI, Großinvestitionen (VDMI).

### B. Stadtwerk-externe & Markt-Rollen
4.  **ROLE_PROSUMER (Kunde / Prosumer / Endnutzer):** dezentrale Edge-Optimierungen (Wallboxen, dezentrales Teilen).
5.  **ROLE_PROJECT_DEVELOPER (Projektentwickler / Planer):** Realisierung von EE-Anlagen, Vorprüfung, Netzanschlussbegehren (NAB).
6.  **ROLE_REGULATOR (Regulierer / Behörde - z. B. BNetzA):** Compliance, Veröffentlichungen, Strukturberichte (§14d).
7.  **ROLE_LAND_LESSOR (Verpächter / Grundeigentümer):** Liegenschaften und Flurstücke für EE-Anlagen.
8.  **ROLE_TSO (Übertragungsnetzbetreiber - ÜNB):** Großskaliger Redispatch, europäische Netzdaten (ENTSO-E).
9.  **ROLE_INVESTOR (Investor / Bank / Finanzierer):** Investitions-Due-Diligence, Risikoanalyse (CYA), kaufmännische Absicherung.
10. **ROLE_MUNICIPALITY (Gemeinde / Kommune):** Kommunale Wärmeplanung, Liegenschaften, offene Geodaten.

---

## 2. Aggregierte Verteilung der Services auf alle Rollen

Insgesamt wurden alle **76 Services** bewertet. Die primäre fachliche Zuordnung ergibt folgendes erweitertes Lagebild:

- **🧑‍💻 ROLE_PROSUMER (Endkunde):** 3 Services
- **📈 ROLE_COMMERCIAL_SUPPLY (Netzwirtschaft):** 13 Services
- **⚡ ROLE_GRID_OPERATOR (VNB/Netzbetrieb):** 27 Services
- **🏢 ROLE_UTILITY_HQ (Stadtwerk Holding):** 8 Services
- **🏡 ROLE_MUNICIPALITY (Gemeinde/Kommune):** 2 Services
- **🏗️ ROLE_PROJECT_DEVELOPER (Projektentwickler):** 5 Services
- **⚖️ ROLE_REGULATOR (Regulierer/Behörde):** 3 Services
- **🚜 ROLE_LAND_LESSOR (Verpächter/Landwirt):** 3 Services
- **🌐 ROLE_TSO (Übertragungsnetzbetreiber):** 3 Services
- **💰 ROLE_INVESTOR (Investor/Bank/Finanzier):** 9 Services

--- 

## 3. Strategisches Audit nach Rollen

### Fachgebiet: Kunde / Prosumer / Endnutzer
**Bedeutung:** B2C/Edge-Relevanz (Wallboxen, HEMS, dezentrales Energy Sharing, Heimanlagen).

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `object-store.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_UTILITY_HQ` | ROLE_PROSUMER (1), ROLE_UTILITY_HQ (1), ROLE_MUNICIPALITY (1) |
| `datasource-registry.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_TSO` | ROLE_PROSUMER (1), ROLE_TSO (1) |
| `customer-service.service.js` | Tranche D | Layer 3 (Agent) | `ROLE_GRID_OPERATOR` | ROLE_PROSUMER (16), ROLE_GRID_OPERATOR (4), ROLE_UTILITY_HQ (2) |


### Fachgebiet: Netzwirtschaft / Lieferant / Aggregator
**Bedeutung:** Kommerzielle Marktteilnahme (Bilanzkreise, Beschaffung, Flexibilitätsvermarktung, SLP-Vertrieb).

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `slp.service.js` | Tranche A | Layer 1 (Sensor) | `None` | ROLE_COMMERCIAL_SUPPLY (17) |
| `edm.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (2), ROLE_GRID_OPERATOR (2), ROLE_PROJECT_DEVELOPER (2) |
| `edm-validation.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (2), ROLE_GRID_OPERATOR (1), ROLE_UTILITY_HQ (1) |
| `edm-virtual.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_UTILITY_HQ` | ROLE_COMMERCIAL_SUPPLY (1), ROLE_UTILITY_HQ (1), ROLE_PROJECT_DEVELOPER (1) |
| `eic-codes.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (16), ROLE_GRID_OPERATOR (1), ROLE_UTILITY_HQ (1) |
| `gas-storage.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (3), ROLE_GRID_OPERATOR (1), ROLE_UTILITY_HQ (1) |
| `datasource-classifier.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (1), ROLE_GRID_OPERATOR (1), ROLE_UTILITY_HQ (1) |
| `mqtt-broker.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_MUNICIPALITY` | ROLE_COMMERCIAL_SUPPLY (1), ROLE_MUNICIPALITY (1) |
| `bilanzkreis.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_UTILITY_HQ` | ROLE_COMMERCIAL_SUPPLY (17), ROLE_UTILITY_HQ (16), ROLE_PROSUMER (1) |
| `flex.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_PROSUMER` | ROLE_COMMERCIAL_SUPPLY (17), ROLE_PROSUMER (2), ROLE_GRID_OPERATOR (1) |
| `forecast-engine.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (18), ROLE_GRID_OPERATOR (3), ROLE_PROJECT_DEVELOPER (2) |
| `forecast.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (17), ROLE_GRID_OPERATOR (4), ROLE_MUNICIPALITY (2) |
| `settlement.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_COMMERCIAL_SUPPLY (18), ROLE_GRID_OPERATOR (3), ROLE_PROJECT_DEVELOPER (2) |


### Fachgebiet: Netzbetreiber / Netzbetrieb (VNB / DSO)
**Bedeutung:** Technische Netzführung, §14a EnWG-Steuerung, Netzanschluss-Prüfungen, physikalische Assets.

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `energy-market.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_PROJECT_DEVELOPER` | ROLE_GRID_OPERATOR (7), ROLE_PROJECT_DEVELOPER (3), ROLE_PROSUMER (2) |
| `residual-load.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_COMMERCIAL_SUPPLY` | ROLE_GRID_OPERATOR (5), ROLE_COMMERCIAL_SUPPLY (3), ROLE_MUNICIPALITY (3) |
| `assets.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_MUNICIPALITY` | ROLE_GRID_OPERATOR (7), ROLE_MUNICIPALITY (3), ROLE_PROJECT_DEVELOPER (3) |
| `mastr-monitor.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_PROJECT_DEVELOPER` | ROLE_GRID_OPERATOR (18), ROLE_PROJECT_DEVELOPER (2), ROLE_COMMERCIAL_SUPPLY (1) |
| `mastr-quality.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_PROJECT_DEVELOPER` | ROLE_GRID_OPERATOR (23), ROLE_PROJECT_DEVELOPER (3), ROLE_REGULATOR (3) |
| `mscons-import.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_UTILITY_HQ` | ROLE_GRID_OPERATOR (1), ROLE_UTILITY_HQ (1) |
| `oep.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_PROJECT_DEVELOPER` | ROLE_GRID_OPERATOR (4), ROLE_PROJECT_DEVELOPER (3), ROLE_COMMERCIAL_SUPPLY (1) |
| `api.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_REGULATOR` | ROLE_GRID_OPERATOR (9), ROLE_REGULATOR (6), ROLE_COMMERCIAL_SUPPLY (5) |
| `dashboard-api.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_TSO` | ROLE_GRID_OPERATOR (8), ROLE_TSO (4), ROLE_COMMERCIAL_SUPPLY (3) |
| `auth.service.js` | Tranche B | Layer 0 (Infra) | `None` |  |
| `token-manager.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_UTILITY_HQ` | ROLE_GRID_OPERATOR (2), ROLE_UTILITY_HQ (1), ROLE_REGULATOR (1) |
| `datapoint.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_REGULATOR` | ROLE_GRID_OPERATOR (2), ROLE_REGULATOR (2), ROLE_COMMERCIAL_SUPPLY (1) |
| `system.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_PROJECT_DEVELOPER` | ROLE_GRID_OPERATOR (2), ROLE_PROJECT_DEVELOPER (2), ROLE_COMMERCIAL_SUPPLY (1) |
| `job-status.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_UTILITY_HQ` | ROLE_GRID_OPERATOR (2), ROLE_UTILITY_HQ (2) |
| `query.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_PROJECT_DEVELOPER` | ROLE_GRID_OPERATOR (3), ROLE_PROJECT_DEVELOPER (2), ROLE_TSO (2) |
| `in-memory-join.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_COMMERCIAL_SUPPLY` | ROLE_GRID_OPERATOR (4), ROLE_COMMERCIAL_SUPPLY (3), ROLE_MUNICIPALITY (2) |
| `datasource-connector.service.js` | Tranche B | Layer 0 (Infra) | `None` |  |
| `datasource-discovery.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_PROSUMER` | ROLE_GRID_OPERATOR (2), ROLE_PROSUMER (1), ROLE_COMMERCIAL_SUPPLY (1) |
| `datasource-watcher.service.js` | Tranche B | Layer 0 (Infra) | `None` |  |
| `agent-receipts.service.js` | Tranche C | Layer 2 (Orchestration) | `None` |  |
| `grid-connection.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_REGULATOR` | ROLE_GRID_OPERATOR (38), ROLE_REGULATOR (4), ROLE_COMMERCIAL_SUPPLY (2) |
| `grid-operations.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_PROJECT_DEVELOPER` | ROLE_GRID_OPERATOR (24), ROLE_PROJECT_DEVELOPER (4), ROLE_REGULATOR (4) |
| `vnb-monitor.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_REGULATOR` | ROLE_GRID_OPERATOR (21), ROLE_REGULATOR (18), ROLE_UTILITY_HQ (3) |
| `ewk-monitoring.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_REGULATOR` | ROLE_GRID_OPERATOR (4), ROLE_REGULATOR (3), ROLE_PROSUMER (2) |
| `nova.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_MUNICIPALITY` | ROLE_GRID_OPERATOR (4), ROLE_MUNICIPALITY (2), ROLE_PROJECT_DEVELOPER (2) |
| `personal-agent.service.js` | Tranche D | Layer 3 (Agent) | `ROLE_INVESTOR` | ROLE_GRID_OPERATOR (9), ROLE_INVESTOR (5), ROLE_COMMERCIAL_SUPPLY (3) |
| `agent.service.js` | Tranche D | Layer 3 (Agent) | `ROLE_COMMERCIAL_SUPPLY` | ROLE_GRID_OPERATOR (10), ROLE_COMMERCIAL_SUPPLY (7), ROLE_PROJECT_DEVELOPER (6) |


### Fachgebiet: Stadtwerk / Konzern-Mutter (Utility HQ)
**Bedeutung:** Zentrale Governance, kaufmännisches Controlling, Business Intelligence, Konzessionsberichte.

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `web-search.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_REGULATOR` | ROLE_UTILITY_HQ (2), ROLE_REGULATOR (2), ROLE_COMMERCIAL_SUPPLY (1) |
| `tenant-quota.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_PROJECT_DEVELOPER` | ROLE_UTILITY_HQ (1), ROLE_PROJECT_DEVELOPER (1) |
| `observability.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_PROJECT_DEVELOPER` | ROLE_UTILITY_HQ (16), ROLE_PROJECT_DEVELOPER (1), ROLE_INVESTOR (1) |
| `presentation.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_GRID_OPERATOR` | ROLE_UTILITY_HQ (17), ROLE_GRID_OPERATOR (2), ROLE_COMMERCIAL_SUPPLY (1) |
| `capability-broker.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_UTILITY_HQ (16), ROLE_GRID_OPERATOR (6), ROLE_INVESTOR (4) |
| `utility-report.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_REGULATOR` | ROLE_UTILITY_HQ (19), ROLE_REGULATOR (19), ROLE_GRID_OPERATOR (8) |
| `business-intelligence.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_PROSUMER` | ROLE_UTILITY_HQ (16), ROLE_PROSUMER (3), ROLE_PROJECT_DEVELOPER (3) |
| `company.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_UTILITY_HQ (16), ROLE_GRID_OPERATOR (3), ROLE_MUNICIPALITY (1) |


### Fachgebiet: Gemeinde / Kommune (Municipality)
**Bedeutung:** Kommunale Wärmeplanung, öffentliche Liegenschaften, Geodaten-Bezug.

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `datasource-cache.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_PROJECT_DEVELOPER` | ROLE_MUNICIPALITY (1), ROLE_PROJECT_DEVELOPER (1), ROLE_REGULATOR (1) |
| `hitl.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_INVESTOR` | ROLE_MUNICIPALITY (2), ROLE_INVESTOR (2), ROLE_PROJECT_DEVELOPER (1) |


### Fachgebiet: Projektentwickler / Planungsbüro
**Bedeutung:** Realisierung von EE-Anlagen, Speichern, Wärmenetzen. Fokus auf Netzanschlussbegehren (NAB) und Vorprüfung.

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `edm-messkonzept.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_UTILITY_HQ` | ROLE_PROJECT_DEVELOPER (2), ROLE_UTILITY_HQ (1) |
| `znp.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_PROJECT_DEVELOPER (20), ROLE_GRID_OPERATOR (7), ROLE_COMMERCIAL_SUPPLY (2) |
| `cookbook.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_PROJECT_DEVELOPER (16), ROLE_GRID_OPERATOR (3), ROLE_COMMERCIAL_SUPPLY (1) |
| `blindflug-radar.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_TSO` | ROLE_PROJECT_DEVELOPER (3), ROLE_TSO (2), ROLE_COMMERCIAL_SUPPLY (1) |
| `eog-calculator.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_PROJECT_DEVELOPER (16), ROLE_GRID_OPERATOR (1), ROLE_UTILITY_HQ (1) |


### Fachgebiet: Regulierer / Behörde (z. B. BNetzA)
**Bedeutung:** Regulatorische Compliance, Marktüberwachung, Veröffentlichungen, Systemprüfungen.

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `knowledge-rag.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_GRID_OPERATOR` | ROLE_REGULATOR (3), ROLE_GRID_OPERATOR (1), ROLE_UTILITY_HQ (1) |
| `backup-orchestrator.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_LAND_LESSOR` | ROLE_REGULATOR (1), ROLE_LAND_LESSOR (1) |
| `nbp-monitor.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_REGULATOR (17), ROLE_GRID_OPERATOR (5), ROLE_PROJECT_DEVELOPER (2) |


### Fachgebiet: Verpächter / Grundeigentümer (Landowner)
**Bedeutung:** Liegenschaften und Flurstücke für Wind- und Solarkraftwerke, dezentrales Erzeugungs-Sharing.

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `osm-geo.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_GRID_OPERATOR` | ROLE_LAND_LESSOR (16), ROLE_GRID_OPERATOR (7), ROLE_PROJECT_DEVELOPER (2) |
| `energy-sharing.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_LAND_LESSOR (16), ROLE_GRID_OPERATOR (7), ROLE_PROJECT_DEVELOPER (2) |
| `energy-sharing-allocation.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_LAND_LESSOR (16), ROLE_GRID_OPERATOR (3), ROLE_REGULATOR (3) |


### Fachgebiet: Übertragungsnetzbetreiber (ÜNB / TSO)
**Bedeutung:** Großskaliger Redispatch, Systemsicherheit, europäische Netzdatenströme.

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `entsoe.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_PROJECT_DEVELOPER` | ROLE_TSO (33), ROLE_PROJECT_DEVELOPER (3), ROLE_COMMERCIAL_SUPPLY (2) |
| `german-grid.service.js` | Tranche A | Layer 1 (Sensor) | `ROLE_PROJECT_DEVELOPER` | ROLE_TSO (19), ROLE_PROJECT_DEVELOPER (4), ROLE_PROSUMER (2) |
| `redispatch-expost.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_TSO (17), ROLE_GRID_OPERATOR (7), ROLE_REGULATOR (3) |


### Fachgebiet: Investor / Finanzierer / Bank
**Bedeutung:** Projekt-Due-Diligence, Risikoanalyse (CYA), kaufmännische Bewertung, Freigaben (VDMI).

| Service | Tranche | Technische Schicht (Target) | Sekundäre Rolle | Relevante Signale |
| :--- | :--- | :---: | :---: | :--- |
| `webhooks.service.js` | Tranche B | Layer 0 (Infra) | `ROLE_PROSUMER` | ROLE_INVESTOR (2), ROLE_PROSUMER (1), ROLE_GRID_OPERATOR (1) |
| `cya.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_INVESTOR (16), ROLE_GRID_OPERATOR (4), ROLE_PROJECT_DEVELOPER (4) |
| `vdmi.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_GRID_OPERATOR` | ROLE_INVESTOR (17), ROLE_GRID_OPERATOR (4), ROLE_REGULATOR (2) |
| `vdmi-evidence.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_UTILITY_HQ` | ROLE_INVESTOR (16), ROLE_UTILITY_HQ (2), ROLE_REGULATOR (2) |
| `vdmi-findings.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_UTILITY_HQ` | ROLE_INVESTOR (16), ROLE_UTILITY_HQ (2), ROLE_REGULATOR (2) |
| `vdmi-human-override.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_REGULATOR` | ROLE_INVESTOR (16), ROLE_REGULATOR (2), ROLE_UTILITY_HQ (1) |
| `vdmi-spectator.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_UTILITY_HQ` | ROLE_INVESTOR (16), ROLE_UTILITY_HQ (1), ROLE_REGULATOR (1) |
| `investment-planning.service.js` | Tranche C | Layer 2 (Orchestration) | `ROLE_PROJECT_DEVELOPER` | ROLE_INVESTOR (17), ROLE_PROJECT_DEVELOPER (16), ROLE_GRID_OPERATOR (2) |
| `finance-agent.service.js` | Tranche D | Layer 3 (Agent) | `ROLE_GRID_OPERATOR` | ROLE_INVESTOR (19), ROLE_GRID_OPERATOR (6), ROLE_PROJECT_DEVELOPER (4) |


--- 

## 4. Taktische Erkenntnisse für die v0.58-Bespielung & Trust Boundaries

1. **Das Endkunden-Privileg (ROLE_PROSUMER) vs. Netzbetrieb:**
   * Services wie `energy-market.service.js` (CO2/GSI-Preise) gehören fachlich an die **Schnittstelle zum Endkunden**.
   * *Taktische Invariante:* Diese Services dürfen niemals interne VNB-Informationen (z. B. unverschlüsselte Transformator-Restkapazitäten) an L3 Personal-Agents leaken, die im Auftrag eines Kunden-Abonnements ausgeführt werden.

2. **Der Projektentwickler-Hebel (ROLE_PROJECT_DEVELOPER):**
   * Services wie `znp.service.js` (Zielnetzplanung) und `grid-connection.service.js` sind hochgradig relevant für Projektentwickler, die freie Netzkapazitäten für Solarparks suchen.
   * *Nutzen für L2-Blueprints:* Ein L2-Blueprint für ein Netzanschlussbegehren (NAB) erlaubt es dem Projektentwickler, Vorprüfungen selbstständig im Dialog durchzuführen, ohne den VNB-Planer manuell zu belasten. Die Ausführung wird durch den L2-Broker abgesichert.

3. **Investoren-Transparenz (ROLE_INVESTOR) und Risikoanalyse:**
   * Investoren verlangen fundierte Rendite- und Risikonachweise (`cya`, `vdmi`). Ein L2-Blueprint für Due Diligence bündelt historische Lastgänge, Investitionsplanungen und CapEx-Abschätzungen zu einem klaren, maschinenlesbaren Nachweis.

4. **Die Regulator-Schleuse (ROLE_REGULATOR):**
   * Aufsichtsbehörden erhalten aggregierte Daten über `vnb-monitor` und `utility-report`. Die strikte Trennung sorgt dafür, dass nur die gesetzlich geforderten Aggregate (Layer 2) und niemals Rohdaten (Layer 1) nach außen gegeben werden.

