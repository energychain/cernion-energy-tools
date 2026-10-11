# Case Type Index

Generated: 2026-10-11T01:32:48.510Z

Diese Datei ist ein Shepherd-Arbeitsmodell. Sie beschreibt natürliche energiewirtschaftliche Falltypen für CET, keine abschließenden regulatorischen Prozesse.

## Reifegrade

- draft: erstes Arbeitsmodell, noch nicht belastbar an Code/Routing angebunden
- observed: Signale im Code/Tests/OpenAPI/Doku gefunden
- routable: kann vom Agentic Core als Falltyp erkannt werden
- actionable: kann Next Best Actions und HITL-Punkte erzeugen
- validated: durch UAT/echte Fälle bestätigt

## Falltypen

### Stammdaten-/Marktrollen-Klärfall

- ID: `stammdaten_marktrollen_klaerfall`
- Status: observed
- Priority: 1
- Cluster: `mako-and-edm`, `casework-and-assistance`, `openwebui-agentic-routing`
- Signals: 25 code/doc signal files
- Canon: `falltypen/STAMMDATEN_MARKTROLLEN_KLAERFALL.md`

Strukturiert Fälle, in denen energiewirtschaftliche Stammdaten, Marktrollen oder Objektbeziehungen unvollständig, widersprüchlich oder implizit sind.

### Messwert-/EDM-Plausibilitätsfall

- ID: `messwert_edm_plausibilitaetsfall`
- Status: observed
- Priority: 2
- Cluster: `mako-and-edm`, `forecast-and-market`, `evidence-and-trust`
- Signals: 25 code/doc signal files
- Canon: `falltypen/MESSWERT_EDM_PLAUSIBILITAETSFALL.md`

Strukturiert Fälle, in denen Messwerte, Lastgänge, Verbrauchs-/Erzeugungsdaten oder EDM-Daten auffällig, unvollständig oder erklärungsbedürftig sind.

### Kunden-/Service-Klärfall

- ID: `kunden_service_klaerfall`
- Status: routable
- Priority: 3
- Cluster: `casework-and-assistance`, `tenant-and-operation`, `openwebui-agentic-routing`
- Signals: 25 code/doc signal files
- Canon: `falltypen/KUNDEN_SERVICE_KLAERFALL.md`

Strukturiert unklare oder mehrdeutige Kunden-, Service- oder Assistenzanfragen, die mehrere energiewirtschaftliche Prozesse berühren können.

### Netzanschluss-/Kapazitäts-Klärfall

- ID: `netzanschluss_kapazitaets_klaerfall`
- Status: observed
- Priority: 4
- Cluster: `casework-and-assistance`, `openwebui-agentic-routing`
- Signals: 25 code/doc signal files
- Canon: `falltypen/NETZANSCHLUSS_KAPAZITAETS_KLAERFALL.md`

Beschreibt Netzanschluss-/Kapazitäts-Klärfall als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.

### Prognose-/Abweichungsfall

- ID: `prognose_abweichungsfall`
- Status: observed
- Priority: 5
- Cluster: `casework-and-assistance`, `openwebui-agentic-routing`
- Signals: 25 code/doc signal files
- Canon: `falltypen/PROGNOSE_ABWEICHUNGSFALL.md`

Beschreibt Prognose-/Abweichungsfall als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.

### Redispatch-/Steuerbarkeits-Readiness

- ID: `redispatch_steuerbarkeits_readiness`
- Status: observed
- Priority: 6
- Cluster: `casework-and-assistance`, `openwebui-agentic-routing`
- Signals: 25 code/doc signal files
- Canon: `falltypen/REDISPATCH_STEUERBARKEITS_READINESS.md`

Beschreibt Redispatch-/Steuerbarkeits-Readiness als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.

### Wärme-/Gas-/EOG-Szenariofall

- ID: `waerme_gas_eog_szenariofall`
- Status: observed
- Priority: 7
- Cluster: `casework-and-assistance`, `openwebui-agentic-routing`
- Signals: 25 code/doc signal files
- Canon: `falltypen/WAERME_GAS_EOG_SZENARIOFALL.md`

Beschreibt Wärme-/Gas-/EOG-Szenariofall als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.
