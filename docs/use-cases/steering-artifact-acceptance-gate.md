# Steering Artifact Acceptance Gate

## Zweck

`steering_artifact_acceptance_gate` bewertet vorgeschlagene Steuerungsartefakte vor dem Rollout als read-only Akzeptanz- und Pflege-Gate. Der erste Nutzen ist eine klare Aussage, ob Karte, Liste, Workbench-Item oder Fuehrungsartefakt operativ pflegbar ist, bevor daraus neue Dokumentationslast entsteht.

## Erste Slice

- Action: `dashboard-api.steeringArtifactAcceptanceGateStatus`
- API: `GET /api/dashboard/steering-artifact-acceptance-gate`
- Safety: read-only, advisory, non-consequential
- Consumption path: Capability Broker -> Dashboard API -> Hydration Registry -> Slim Dossier / Workbench renderer

## Evidenz

Die Capability strukturiert skalare Evidenz zu Artefakttyp, Zielrolle, Use Case, Karten-/Item-Anzahl, Pflegezeit, Aktualisierungstakt, Owner, Stellvertretung, Nutzungsnachweis, Eskalations-/Abbruchkriterium und Rollout-Entscheidung.

Statuswerte:

- `missing_acceptance_evidence`
- `needs_maintenance_owner`
- `ready_for_limited_rollout`
- `should_retire_or_rework`

## Grenzen

Diese Slice erzeugt keine Budibase-Zeilen, keine Workflows, keine HITL-Items und keine externen Benachrichtigungen. Sie mutiert keine MaKo-, Billing-, Settlement-, Tarif- oder Geraetesteuerungsdaten und fuegt keinen Personal-Agent-Sonderweg hinzu.
