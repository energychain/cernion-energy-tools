# Case Type Index

Generated: 2026-10-10T03:02:13.755Z

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
- Status: draft
- Priority: 3
- Cluster: `casework-and-assistance`, `tenant-and-operation`, `openwebui-agentic-routing`
- Signals: 25 code/doc signal files
- Canon: `falltypen/KUNDEN_SERVICE_KLAERFALL.md`

Strukturiert unklare oder mehrdeutige Kunden-, Service- oder Assistenzanfragen, die mehrere energiewirtschaftliche Prozesse berühren können.
