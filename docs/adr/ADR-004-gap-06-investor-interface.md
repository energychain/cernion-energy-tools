# ADR-004: Investor-Interface und Kommunikation (Gap-6)

## Status
Proposed

## Kontext
In der Troisdorf-Story gibt es Rollen wie "Investor-Interface" und "Kommunikation/Lokalpolitik". Diese sind in VDMI als Rollen modellierbar, aber es gibt keinen Service, der Freigabe-Prozesse, NDAs, oeffentliche Berichte oder Investor-Kommunikation verwaltet.

## Problem
- Kein dedizierter Service fuer Investor-Beziehungen
- Kommunikation bleibt ausserhalb des Systems (manuell/E-Mail)
- Keine strukturierte Freigabe-Prozesse fuer Vorstandsindikationen
- Kein Audit-Trail fuer Kommunikation mit Externen

## Optionen

### Option A: Neuer Service `communications`
- Dedizierter Service fuer Freigaben, NDAs, Berichte, Pressemitteilungen
- Vorteile: Klare Verantwortlichkeit, vollstaendiger Audit-Trail
- Nachteile: Zusaetzliche Komplexitaet, Overhead fuer ein Randgebiet

### Option B: CYA + Webhooks
- `cya.service` generiert regulatorische Argumentation
- Webhooks senden Ergebnisse an externe Systeme (E-Mail, CRM)
- Vorteile: Nutzt bestehende Infrastruktur, minimaler Aufwand
- Nachteile: Kein strukturierter Freigabe-Prozess im System

### Option C: VDMI-Erweiterung fuer Kommunikations-Tasks
- Neue Task-Typen in VDMI: `communication`, `approval`, `nda-required`
- Vorteile: Kommunikation ist im Entscheidungs-Nervensystem sichtbar
- Nachteile: VDMI ist fuer Rollen-/Entscheidungsmanagement, nicht fuer Content-Erstellung

## Empfehlung
**Option B (CYA + Webhooks)** als pragmatische Kurzfristloesung, **Option A** erst bei Nachfrage aus mehreren Kunden. Die Troisdorf-Story kann mit der bestehenden Infrastruktur erzaehlt werden, ohne einen neuen Service zu rechtfertigen.

## Konsequenzen
- Positiv: Minimaler Implementierungsaufwand
- Negativ: Investor-Kommunikation bleibt teilweise manuell
- Risiko: Bei regulatorischen Anforderungen (z.B. Boersennotierte Stadtwerke) koennte ein Audit-Trail fuer Kommunikation zwingend werden

## Links
- [Troisdorf Story Proposal](../../VDMI_E2E_Troisdorf_Story_Proposal.md)
- [Gap-6: Kein Investor-Interface/Kommunikations-Service](../../VDMI_E2E_Troisdorf_Story_Proposal.md#gap-6)
