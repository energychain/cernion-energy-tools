# CET RC2 UI — Spec D2 Vorgangsansicht

Status: Phase D implemented on `feat/cet-release-rc2-ui`.

## Mindestziel

Die Vorgangsansicht ist die zentrale Arbeitsfläche für einen Vorgang.

## Fachliche Bindungen

- Fünf Grammatikteile in fester Reihenfolge: Vorgang, Quellen, Prüfung, Unsicherheit, Freigabe.
- Zeigt aktive Rolle, Übernahmezustand, nächsten Beitrag und Entscheidungsdistanz.
- Freigabesatz bleibt sichtbar; `Das System entscheidet nicht.` ist die Verantwortungsgrenze.
- Aktionen sind `basisRev`-gebunden.
- Grenzen, Quellen, Historie und Seit-Zugriff-Kontext bleiben sichtbar.

## Psychologische / Usability-Ziele

- Reduzierte Entscheidungslast durch Kriterienliste statt freiem Score.
- Unsicherheit wird als Arbeitsgegenstand gezeigt, nicht versteckt.
- Mobile Minimalprominenz: Vorgang, nächster Beitrag, Freigabesatz.

## Akzeptanzsatz

> Ich verstehe, was passiert ist, warum meine Rolle betroffen ist und was als nächstes zu tun ist.

## Tests

- `tests/cet-ui-rc2.phase-d-surfaces.test.js`
