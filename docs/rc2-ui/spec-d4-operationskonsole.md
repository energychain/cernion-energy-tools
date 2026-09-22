# CET RC2 UI — Spec D4 Operationskonsole

Status: Phase D implemented on `feat/cet-release-rc2-ui`.

## Mindestziel

Die Operationskonsole macht CET REST-/Capability-Aufgaben erreichbar, ohne Governance-Grenzen zu verdecken.

## Fachliche Bindungen

- Nutzt Operation Search, Capability Card, Operation Form und Permission Panel.
- Zeigt Methode, Risk-Class, `governancePolicyId`, Policy-Grenze und Zulässigkeit.
- Trennt `Projected Result` und `Unprojected Raw Result`.
- Nicht-projiziertes JSON bleibt Rohantwort und ist kein Nachweis.
- Console-Nutzung wird als Bedarfssignal protokolliert.
- Keine externen Fachsystem-Writes und keine direkten Moleculer Calls aus der UI.

## Psychologische / Usability-Ziele

- Nutzer sieht vor dem Vorbereiten, welche Grenze und Rolle gelten.
- Rohdaten wirken nicht wie Nachweis oder Entscheidung.

## Akzeptanzsatz

> Ich kann REST-/Capability-Aufgaben nutzen, ohne die Governance-Grenze zu übersehen oder Rohdaten mit Nachweisen zu verwechseln.

## Tests

- `tests/cet-ui-rc2.phase-d-surfaces.test.js`
