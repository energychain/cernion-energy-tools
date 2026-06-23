# Besondere Netznutzung Impact Map

## Ziel

Die Besondere-Netznutzung Impact Map macht Par.-19-StromNEV-, Selbstverbrauchs- und Sondernetznutzungsfaelle als dossierfaehige Prozess- und Evidenzkarte sichtbar. Sie verbindet Antrag, Formular, Frist, Mengenbasis, Berechnungsreferenz, Abrechnungswirkung, EOG-/Netzentgeltwirkung, Tarifbezug, Kundenkommunikation und Owner in einer read-only Sicht.

## Nicht-Ziele

- Keine Rechtsauslegung oder Freigabeentscheidung.
- Keine Par.-19-Berechnungsmaschine und keine Rueckverguetungsberechnung.
- Keine Billing-, Settlement-, Tarif-, EOG- oder Kundenkommunikations-Mutation.
- Keine HITL-Anlage, kein externer Connector und kein Personal-Agent-Sonderweg.
- Keine neue Fallpersistenz im ersten Slice.

## Datenvertrag

`dashboard-api.specialGridUsageImpactMapStatus` akzeptiert evidenzorientierte Parameter:

- `caseId`, `caseType`, `customerId`
- `applicationStatus`, `formStatus`, `deadlineStatus`
- `quantityBasis`, `calculationLogicRef`
- `billingImpact`, `eogImpact`, `tariffImpact`
- `communicationStatus`, `ownerRole`
- `regulatoryUncertainty`, `sourceDatapoints`

Die Action leitet daraus Status, Readiness, Evidence Items, fehlende Nachweise, positive Follow-ups und ein Slim-Dossier-Evidence-Objekt ab.

## Evidence Requirements

- Antrag/Intake muss als Quelle oder Status belegbar sein.
- Formularvollstaendigkeit und Friststatus muessen explizit sein.
- Mengenbasis muss source-backed sein.
- Berechnungslogik wird nur referenziert, nicht neu berechnet.
- Billing-, EOG- und Tarifwirkungen werden als Referenzen gefuehrt.
- Kundenkommunikation wird als Readiness gefuehrt, nicht gesendet.
- Owner/naechste Rolle ist erforderlich, damit die Map handlungsfaehig bleibt.

## Standardpfad

`Capability Broker -> dashboard-api.specialGridUsageImpactMapStatus -> Hydration Registry -> Slim Answer Dossier`

Die Hydration-Regel ist read-only allowlisted und formatiert nur answer-ready Fakten, offene Gaps, Follow-ups und Side-Effect-Guards.

## Beispielablauf

1. Fachliche Anfrage nennt `caseId`, `caseType`, Frist- und Mengenstatus.
2. Capability Broker routet auf `special_grid_usage_impact_map`.
3. Dashboard API erzeugt eine Impact Map mit fehlenden Nachweisen.
4. Answer Dossier zeigt Status, erste Luecke und naechsten positiven Follow-up.
5. Consequential Actions bleiben explizit nicht aufgerufen.
