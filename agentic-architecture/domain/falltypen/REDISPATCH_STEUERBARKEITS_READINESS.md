# Redispatch-/Steuerbarkeits-Readiness

Generated: 2026-10-11T01:32:48.510Z

Status: observed
Priority: 6

## Zweck

Beschreibt Redispatch-/Steuerbarkeits-Readiness als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.

## Typische Eingangssignale

- Welche Anlage, Marktrolle und technische Steuerkette sind betroffen?
- Welche Nachweise zur Steuerbarkeit oder Kommunikation liegen vor?
- Geht es um Readiness, Befassung oder verbindliche Freigabe?

## Fachliche Kernobjekte

- Case
- Actor / Human
- Process State
- Evidence Requirement
- Next Best Action

## Prozessmuster

- Fall aufnehmen
- Kontext und offene Punkte strukturieren
- Arbeitshypothesen bilden
- Evidenzstatus trennen
- nächsten fachlichen Schritt vorbereiten

## Practice Layer

CET darf:

- Readiness-Strukturierung
- Klärpunktliste
- Nachweisbedarf benennen
- Befassung vorbereiten

CET darf nicht:

- finale Entscheidung ohne Nachweis behaupten
- externe Wirkung ohne HITL auslösen
- fachliche Unsicherheit technisch wegdefinieren

## Evidence vs Practice

Harte Evidenz ist nötig für:

- Anlagenidentität, Betreiber, technische Steuerbarkeit und Kommunikationsweg
- Nachweise für prozessuale/vertragliche Voraussetzungen
- HITL vor Freigabe, externer Meldung oder produktiver Steuerhandlung

Fachliche Plausibilisierung reicht für:

- Readiness-Strukturierung
- Klärpunktliste
- Nachweisbedarf benennen
- Befassung vorbereiten

## Zustände

- `new` — Fall ist aufgenommen.
- `hypothesis_ready` — Arbeitshypothese ist formuliert.
- `human_decision_required` — Externe Wirkung oder produktive Änderung braucht HITL.

## Next Best Actions

- Readiness als Arbeitszustand einordnen
- fehlende Voraussetzungen und Klärpunkte benennen
- nächste Befassung oder Prüfauftrag vorbereiten

## OpenWebUI-Routing

Usertext → Redispatch-/Steuerbarkeits-Readiness → Klärpunkte → Evidence Boundary → Next Best Action

## Anti-Pattern

Nicht:

Keine finale Evidenz, daher keine Hilfe.

Sondern:

CET hält Unsicherheit sichtbar und macht den Fall arbeitsfähig.

## Code-/Doku-Signale

- `docs/agent-responses/rd-audit.json` (667 hits)
- `src/capability-catalog.js` (586 hits)
- `src/answer-dossier-hydration-rules.json` (416 hits)
- `docs/validation/739-routing.json` (372 hits)
- `services/capability-broker.service.js` (345 hits)
- `src/validation-findings.js` (314 hits)
- `services/dashboard-api/methods-part-04-of-14.js` (201 hits)
- `services/dashboard-api/methods-part-05-of-14.js` (183 hits)
- `services/redispatch-expost.service.js` (180 hits)
- `services/api.service.js` (179 hits)
- `src/evidence-registry.js` (171 hits)
- `services/dashboard-api/methods-part-06-of-14.js` (166 hits)
- `src/report-builder.js` (165 hits)
- `services/dashboard-api/methods-part-03-of-14.js` (153 hits)
- `docs/reviews/730-capability-routing-evaluation.json` (128 hits)
- `function-model.report.md` (117 hits)
- `services/dashboard-api/methods-part-07-of-14.js` (113 hits)
- `docs/use-cases/redispatch-test-readiness-akte.md` (109 hits)
- `src/vdmi-blueprint-pack-seeds.js` (102 hits)
- `services/dashboard-api/methods-part-13-of-14.js` (98 hits)
- `services/znp.service.js` (96 hits)
- `integrations/budibase/README.md` (95 hits)
- `services/dashboard-api/actions-part-01-of-8.js` (78 hits)
- `services/grid-operations.service.js` (77 hits)
- `services/dashboard-api/methods-part-11-of-14.js` (74 hits)
