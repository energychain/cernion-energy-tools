# Gaskapazitaetsbestellung Revisionsgate

Issue: #248

Service: `gas-capacity-order-revision-gate`

## Ziel

Das Revisionsgate dokumentiert, ob eine Gaskapazitaets-Jahresbestellung fachlich belastbar belegt ist. Es verbindet Toolwert, Sicherheitsaufschlag, Kaltjahr-/Rebound-Szenario, reversible RLM-Lasten, Engpasshistorie, Netzkopplungspunkt-Verteilung, Entgeltwirkung, technische Flexibilitaet und Beschlusslage zu einer dossierfaehigen Statussicht.

## Nicht-Ziele

- Keine Gaskapazitaetsbestellung oder Nominierung.
- Keine Vertragsmutation.
- Keine MaKo-, Settlement- oder Billing-Schreiboperation.
- Keine Drucksteuerung oder Netzoperation.
- Keine HITL-Freigabe und kein externer Connector.
- Keine neue Live-Forecast- oder Gasregelengine.

## API- und Servicegrenze

- `POST /api/gas-capacity-order-revision-gate/evaluate`
  - Safety: non-consequential.
  - Schreibt nur ein tenant-lokales Evidence-/Readiness-Objekt.
- `GET /api/gas-capacity-order-revision-gate/status`
  - Safety: read-only.
  - Dossier-safe Statuspfad fuer Hydration Registry und Answer Dossier.
- `GET /api/gas-capacity-order-revision-gate/revisions`
  und `GET /api/gas-capacity-order-revision-gate/revisions/:revisionId`
  - Safety: read-only.

## Datenvertrag

`evaluate` akzeptiert:

- `orderYear`
- `gridOperatorId`
- `nkpIds`
- `toolValueMwhPerDay`
- `securityMarkupPercent`
- `coldYearScenario`
- `industrialReboundScenario`
- `reversibleRlmLoads`
- `historicalBottleneckEvidence`
- `nkpDistribution`
- `tariffImpact`
- `pressureMaintenanceFlexibility`
- `maintenanceWindows`
- `decisionForum`
- `decisionStatus`
- `sourceActions`

Das Ergebnis enthaelt `revisionId`, `evidenceStatus`, `readinessScore`, `recommendedStatus`, `blockingFindings`, `missingDataPoints`, `positiveFollowUps`, `sourceActions` und `answerFacts`.

## Evidence Requirements

Pflicht- und Revisionsnachweise:

- Toolwert als Baseline.
- Kaltjahr-Szenario fuer Spitzenlast- und Sicherheitsaufschlagsbegruendung.
- Industrie-Rebound und reversible RLM-Lasten fuer Nachfragerisiko.
- Historische Engpassnaehe.
- NKP-Verteilung und Konzentrationsrisiko.
- Entgelt-/Tariffolge.
- Druck- und Wartungsflexibilitaet.
- Dokumentierter Bestellbeschluss mit Forum und Status.
- Quell-Action-Referenzen zu Gas-, Forecast-, Grid-, Finance-, VDMI-/Evidence- oder Presentation-Bausteinen.

## Positive Follow-ups

Fehlende Datenpunkte werden nicht geraten. Sie werden als `missingDataPoint` mit `enablesDossierAddition` sichtbar, zum Beispiel:

- `cold_year_scenario` ergaenzt Kaltjahr-Peak-Risiko und Sicherheitsaufschlag.
- `industrial_rebound_scenario` ergaenzt rebound-sensitive Nachfragebewertung.
- `nkp_distribution` ergaenzt NKP-Allokation und Konzentrationsrisiko.
- `decision_resolution` ergaenzt Beschlussforum und Bestellstatus.

## Consumption Contract

Capability Broker routet Gaskapazitaetsbestellung-, Kaltjahr-, RLM-, NKP-, Sicherheitsaufschlag-, Druckflexibilitaets- und Bestellbeschluss-Intents auf `gas-capacity-order-revision-gate.getStatus`.

Die Hydration Registry darf nur den read-only Statuspfad aufrufen. Personal Agent und n8n benoetigen keine Sonderverzweigung und keine hardcodierte Route.
