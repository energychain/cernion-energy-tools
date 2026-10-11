# Wärme-/Gas-/EOG-Szenariofall

Generated: 2026-10-11T01:32:48.510Z

Status: observed
Priority: 7

## Zweck

Beschreibt Wärme-/Gas-/EOG-Szenariofall als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.

## Typische Eingangssignale

- Welches Gebiet, welche Infrastruktur und welcher Betrachtungszeitraum sind betroffen?
- Welche Annahmen sind gesetzt und welche Klärpunkte offen?
- Geht es um Befassung, Szenariovergleich oder Beschlussvorbereitung?

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

- Szenarien strukturieren
- Annahmen offenlegen
- Befassung vorbereiten
- Klärpunkte priorisieren

CET darf nicht:

- finale Entscheidung ohne Nachweis behaupten
- externe Wirkung ohne HITL auslösen
- fachliche Unsicherheit technisch wegdefinieren

## Evidence vs Practice

Harte Evidenz ist nötig für:

- Gebiet, Annahmen, Infrastrukturstand und Szenariogrenzen
- Quellen für Kosten-/Risiko-/Zeitdimensionen
- HITL vor Beschluss-, Freigabe- oder Stilllegungswirkung

Fachliche Plausibilisierung reicht für:

- Szenarien strukturieren
- Annahmen offenlegen
- Befassung vorbereiten
- Klärpunkte priorisieren

## Zustände

- `new` — Fall ist aufgenommen.
- `hypothesis_ready` — Arbeitshypothese ist formuliert.
- `human_decision_required` — Externe Wirkung oder produktive Änderung braucht HITL.

## Next Best Actions

- Szenarioannahmen transparent machen
- Klärpunkte und Befassungsstand trennen
- nächste Befassung oder Workshop-Unterlage vorbereiten

## OpenWebUI-Routing

Usertext → Wärme-/Gas-/EOG-Szenariofall → Klärpunkte → Evidence Boundary → Next Best Action

## Anti-Pattern

Nicht:

Keine finale Evidenz, daher keine Hilfe.

Sondern:

CET hält Unsicherheit sichtbar und macht den Fall arbeitsfähig.

## Code-/Doku-Signale

- `src/capability-catalog.js` (338 hits)
- `docs/validation/739-routing.json` (183 hits)
- `services/capability-broker.service.js` (180 hits)
- `src/evidence-registry.js` (132 hits)
- `src/answer-dossier-hydration-rules.json` (108 hits)
- `services/eog-calculator.service.js` (85 hits)
- `docs/eog-calculator-quality-element.md` (77 hits)
- `docs/reviews/730-capability-routing-evaluation.json` (67 hits)
- `services/dashboard-api/methods-part-12-of-14.js` (64 hits)
- `services/dashboard-api/methods-part-06-of-14.js` (53 hits)
- `services/gasnetz-waermeplanung.service.js` (53 hits)
- `services/znp.service.js` (49 hits)
- `services/dashboard-api/methods-part-07-of-14.js` (48 hits)
- `services/api.service.js` (47 hits)
- `services/gas-storage.service.js` (41 hits)
- `src/report-builder.js` (41 hits)
- `function-model.report.md` (40 hits)
- `services/gas-capacity-order-revision-gate.service.js` (37 hits)
- `src/vdmi-blueprint-pack-seeds/stadtwerk-mauer-gas-transformation-dataroom-review-v1.json` (37 hits)
- `services/chatgpt-sidecar.service.js` (33 hits)
- `src/cookbook-recipes.js` (32 hits)
- `src/validation-findings.js` (32 hits)
- `services/dashboard-api/methods-part-13-of-14.js` (30 hits)
- `services/eic-codes.service.js` (30 hits)
- `services/dashboard-api/actions-part-04-of-8.js` (29 hits)
