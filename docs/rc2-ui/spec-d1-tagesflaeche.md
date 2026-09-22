# CET RC2 UI — Spec D1 Tagesfläche

Status: Phase D implemented on `feat/cet-release-rc2-ui`.

## Mindestziel

Die Tagesfläche beantwortet: **Was braucht heute meine Aufmerksamkeit?** Sie ist keine KPI-Seite.

## Fachliche Bindungen

- Nutzt `TagesflaecheGroup` und `VorgangCard` statt generischer Task Cards.
- Zeigt Mandant/Rolle über die Session Shell.
- Zeigt Aufmerksamkeitsgrund, Rollenwirkung, nächsten Beitrag und Übernahmezustand.
- Leere Zustände unterscheiden keine Aufmerksamkeit, keine Rolle, kein Tenant-Datenstand, Placeholder-Agent und API/Auth-Fehler.

## Psychologische / Usability-Ziele

- Orientierung vor Kennzahlen.
- Nächster Beitrag beschreibt Beitrag, nicht Ergebnis.
- Nutzer sieht sofort, was heute Aufmerksamkeit braucht und welchen Beitrag er leisten soll.

## Akzeptanzsatz

> Ich sehe sofort, was heute meine Aufmerksamkeit braucht und welchen Beitrag ich leisten soll.

## Tests

- `tests/cet-ui-rc2.phase-d-surfaces.test.js`
