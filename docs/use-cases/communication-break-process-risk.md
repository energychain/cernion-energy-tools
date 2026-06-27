# Communication Break Process Risk

## Zweck

`communication_break_process_risk` bewertet Kommunikationsbrueche als read-only Prozess- und Evidenzrisiko. Die Capability hilft, fachbereichsuebergreifende Entscheidungen nicht als Personen- oder Konfliktthema zu behandeln, sondern als klaerbaren Prozesszustand mit Protokoll, Rueckfragefenster, Informationspflicht, fachlicher Begleitung, Owner und naechstem Evidenzpunkt.

## Erste Slice

- Action: `dashboard-api.communicationBreakProcessRiskStatus`
- API: `GET /api/dashboard/communication-break-process-risk`
- Safety: read-only, advisory, non-consequential
- Consumption path: Capability Broker -> Dashboard API -> Hydration Registry -> Slim Dossier / Workbench renderer

## Evidenz

Die Capability strukturiert skalare Evidenz zu Prozess/Domaene, betroffener Entscheidung, Praesentations- und Protokollstatus, Rueckfragefenster, Informationspflicht, fachlicher Begleitung, Owner, Stellvertretung, blockierter Entscheidung, naechstem Evidenzpunkt, Faelligkeit und Eskalations-/Abbruchkriterium.

Statuswerte:

- `missing_process_context`
- `blocked_decision_needs_evidence`
- `needs_owner_due_date`
- `communication_break_risk_open`
- `process_risk_ready_for_next_gate`

## Grenzen

Diese Slice erzeugt kein Personen-/HR-Scoring, keine Sentimentanalyse, keine Mail-, Kalender- oder Chat-Ingestion, keine Budibase-Zeilen, keine Workflows, keine HITL-Items und keine externen Benachrichtigungen. Sie mutiert keine MaKo-, Billing-, Settlement-, Tarif- oder Geraetesteuerungsdaten und fuegt keinen Personal-Agent-Sonderweg hinzu.
