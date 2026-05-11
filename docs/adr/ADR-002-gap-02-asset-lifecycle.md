# ADR-002: Kraftwerksrevision und Asset-Lifecycle (Gap-2)

## Status
Proposed

## Kontext
Die Troisdorf-Story enthaelt die Annahme, dass das HKW Troisdorf-Mitte in Q2/2027 eine Revision hat. Ein neues Rechenzentrum (Q3/2027) koennte Abwaerme liefern, die die Revision flexibilisiert. Diese zeitliche Abhaengigkeit ist in Cernion nicht modellierbar.

## Problem
- `assets.service` verwaltet Anlagen als statische Datensaetze
- Keine zeitlichen Zustaende (Revision, Instandhaltung, RUL)
- Keine Service fuer Kraftwerksrevision oder Asset-Lifecycle-Management
- Abhaengigkeiten wie "RZ-Waerme ermoeglicht HKW-Revision" koennen nicht modelliert werden

## Optionen

### Option A: Erweiterung von `assets.service`
- Neue Actions: `scheduleRevision`, `getMaintenanceWindow`, `calculateRUL`
- Vorteile: Zentrale Asset-Information, keine Service-Splitting
- Nachteile: `assets.service` wuerde umfangreicher werden

### Option B: Neuer Service `asset-lifecycle`
- Dedizierter Service fuer Revisionen, Instandhaltung, Ersatzplanung
- Vorteile: Klare Trennung statischer Daten vs. dynamischer Lifecycle
- Nachteile: Neue Infrastruktur, Konsistenz mit `assets.service`

### Option C: Integration in VDMI-Tasks
- Revisionen und Lifecycle-Events werden als VDMI-Tasks mit Due-Dates modelliert
- Vorteile: Nutzt bestehende VDMI-Infrastruktur
- Nachteile: VDMI ist fuer Rollen-/Entscheidungsmanagement, nicht fuer technische Asset-Planung

## Empfehlung
**Option A (Erweiterung von `assets.service`)** fuer den nahen Zeitraum. Die Erweiterung um `lifecycleEvents` (Array von Revisionen, Instandhaltungen) ist minimal invasiv und passt zur bestehenden Datenhaltung.

## Konsequenzen
- Positiv: Zeitliche Abhaengigkeiten werden abbildbar
- Negativ: `assets.service` waechst weiter
- Risiko: Bei sehr komplexen Lifecycle-Modellen koennte ein eigener Service spaeter noetig werden

## Links
- [Troisdorf Story Proposal](../../VDMI_E2E_Troisdorf_Story_Proposal.md)
- [Gap-2: Fehlender Asset-Lifecycle-Service](../../VDMI_E2E_Troisdorf_Story_Proposal.md#gap-2)
