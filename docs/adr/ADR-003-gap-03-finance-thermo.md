# ADR-003: Finance Agent Thermo-Oekonomie (Gap-3)

## Status
Proposed

## Kontext
Der Finance Agent (`finance-agent.service`) fuehrt regulatorische Finanzanalysen durch, hat aber keinen Kontext fuer Thermo-Oekonomie: Investitionskosten Trafo-Ausbau, Waermeliefervertraege, Opportunitaetskosten, KWKG/EEWaermeG-Foerderfaehigkeit.

## Problem
- Keine Investitionsrechnung fuer Netzausbau + Waermevertrag + Kraftwerks-OM
- Business Case ist nicht vollstaendig deterministisch pruefbar
- Der Finance Agent ist deterministisch (kein LLM), daher koennen keine neuen oekonomischen Domänen "ad-hoc" gelernt werden

## Optionen

### Option A: Erweiterung der Prompts/Regeln in `finance-agent.service`
- Neue Regelmodule fuer Thermo-Oekonomie
- Vorteile: Konsistent mit bestehendem deterministischem Ansatz
- Nachteile: Jede neue Domäne erfordert Code-Aenderung

### Option B: MCP-Tooling fuer Investitionsrechnung
- Externes MCP-Tool (z.B. Excel-Modell, spezialisierte Berechnungsengine)
- Vorteile: Flexibel, kann von Domain-Experten gepflegt werden
- Nachteile: Externe Abhaengigkeit, Determinismus schwieriger zu garantieren

### Option C: Pluggable Calculation Modules
- `finance-agent.service` laedt Module aus `src/finance-modules/`
- Vorteile: Erweiterbar ohne Service-Code zu aendern
- Nachteile: Erhoehte Testkomplexitaet, Modul-API muss stabil sein

## Empfehlung
**Option C (Pluggable Calculation Modules)** als langfristige Architektur, zunaechst aber **Option A** fuer die Troisdorf-Story. Ein erstes Modul `thermo-economics` sollte folgende Parameter unterstuetzen:
- `heatCapacityKW`: thermische Leistung
- `heatContractDurationYears`: Vertragslaufzeit
- `heatPriceEurPerMWh`: Waermepreis
- `cogenerationBonus`: KWKG-Bonus
- `gridExpansionCost`: Netzausbaukosten

## Konsequenzen
- Positiv: Business Cases werden vollstaendiger und ueberpruefbarer
- Negativ: Erhoehter Wartungsaufwand fuer oekonomische Regeln
- Risiko: Oekonomische Annahmen veralten schnell (Strompreise, Foerderung)

## Links
- [Troisdorf Story Proposal](../../VDMI_E2E_Troisdorf_Story_Proposal.md)
- [Gap-3: Finance Agent ohne Thermo-Oekonomie](../../VDMI_E2E_Troisdorf_Story_Proposal.md#gap-3)
