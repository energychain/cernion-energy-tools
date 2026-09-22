# CET RC2 UI — Spec D3 Nachweisansicht

Status: Phase D implemented on `feat/cet-release-rc2-ui`.

## Mindestziel

Die Nachweisansicht zeigt den eingefrorenen, reproduzierbaren Nachweisstand.

## Fachliche Bindungen

- Zeigt Freeze-Zeitpunkt und eingefrorenen Präsentations-/Interaktionsstand.
- Zeigt materialisierte Aussagen mit Quelle und `granularitaet`.
- `einzeldatensatz` bleibt hash/ref-only und wird als `nur mit Quelle reproduzierbar` markiert.
- Freigabeanforderungen werden mit Rolle/Actor/Zeit über `ApprovalRequestCard` dargestellt.
- Nicht-projizierte Rohantworten erscheinen hier nicht als Nachweis.

## Psychologische / Usability-Ziele

- Vertrauen durch Reproduzierbarkeit, Quelle, Zeit und Attribution.
- Keine Scheinsicherheit bei fehlender Quelle oder Einzeldatensatzgrenze.

## Akzeptanzsatz

> Ich kann nachvollziehen, welcher Stand eingefroren wurde und welche Aussagen belegbar sind.

## Tests

- `tests/cet-ui-rc2.phase-d-surfaces.test.js`
