# ADR-001: Fernwaerme-/Sektorkopplungs-Service (Gap-1)

## Status
Proposed

## Kontext
Die Troisdorf-Demonstrationsstory (10-MW-KI-Rechenzentrum) offenbart, dass Cernion keine native Abbildung von Fernwaermeinfrastruktur, Waermenetzen oder KWK-Abwaerme-Einspeisung hat. Die Abwaerme eines Rechenzentrums (6-7 MW thermisch) kann nicht in ein Nahwaermenetz modelliert werden.

## Problem
- Kein Service fuer Fernwaermenetz-Topologie
- Keine Kopplung zwischen Stromanschlusspruefung und thermischer Infrastruktur
- Keine Waermebilanz-Berechnung
- Sektorenkopplung ist nur als generische ZNP-Annahme abbildbar (Workaround)

## Optionen

### Option A: Neuer Service `heat-network`
- Dedizierter Microservice fuer Waermenetze, KWK, Abwaerme
- Vorteile: Klare Separation, eigene Datenhaltung, spezialisierte APIs
- Nachteile: Zusaetzliche Komplexitaet, neuer Service-Overhead

### Option B: Erweiterung von `assets.service`
- Assets erhalten Typ `heat-producer`, `heat-consumer`, `heat-network`
- Vorteile: Bestehende Infrastruktur wiederverwendet
- Nachteile: `assets.service` ist bereits umfangreich, Sektorkopplung ist querliegend

### Option C: ZNP-Layer-Erweiterung (Layer 3)
- Neuer ZNP-Layer fuer thermische Infrastruktur
- Vorteile: Passt zur bestehenden ZNP-Architektur
- Nachteile: ZNP ist fuer elektrische Netzplanung optimiert, nicht fuer Thermodynamik

### Option D: Partner-API-Adapter
- Integration mit externem Waermenetz-Tool (z.B. STANET, PSS-SINCAL)
- Vorteile: Nutzt vorhandene Spezialtools
- Nachteile: Externe Abhaengigkeit, Lizenzkosten, Datenmapping

## Empfehlung
**Option A (neuer Service `heat-network`)** als langfristige Loesung, aber zunaechst **Option C (ZNP-Layer 3)** als pragmatischen Zwischenschritt. Ein dedizierter Service wird erst sinnvoll, wenn mehrere Kunden Fernwaerme als Kerngeschaeft haben.

## Konsequenzen
- Positiv: Troisdorf-Story kann Waermeaspekte nativ abbilden
- Negativ: Erhoehte Architekturkomplexitaet
- Risiko: Ueberdimensionierung, wenn nur wenige Kunden Fernwaerme nutzen

## Links
- [Troisdorf Story Proposal](../../VDMI_E2E_Troisdorf_Story_Proposal.md)
- [Gap-1: Fehlender Fernwaerme-Service](../../VDMI_E2E_Troisdorf_Story_Proposal.md#gap-1)
