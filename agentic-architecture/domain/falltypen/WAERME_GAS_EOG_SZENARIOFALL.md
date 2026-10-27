# Wärme-/Gas-/EOG-Szenariofall

Generated: 2026-10-27T18:01:48.358Z

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

- `docs/validation/tenant-memory-868-live.json` (497 hits)
- `src/capability-catalog.js` (338 hits)
- `docs/validation/practice-evaluation-887-live-1.md` (239 hits)
- `docs/validation/practice-evaluation-baseline-corrected.json` (191 hits)
- `docs/validation/practice-evaluation-baseline-corrected.md` (191 hits)
- `docs/validation/issue-874-before.md` (184 hits)
- `docs/validation/practice-evaluation-baseline.md` (184 hits)
- `docs/validation/739-routing.json` (183 hits)
- `docs/validation/practice-evaluation-baseline.json` (183 hits)
- `services/capability-broker.service.js` (180 hits)
- `docs/validation/tenant-memory-live.json` (175 hits)
- `docs/validation/tenant-memory-863-live.json` (138 hits)
- `src/evidence-registry.js` (132 hits)
- `src/answer-dossier-hydration-rules.json` (108 hits)
- `services/eog-calculator.service.js` (85 hits)
- `docs/eog-calculator-quality-element.md` (77 hits)
- `docs/reviews/730-capability-routing-evaluation.json` (67 hits)
- `docs/validation/rc3-closeout-live.json` (67 hits)
- `services/dashboard-api/methods-part-12-of-14.js` (64 hits)
- `docs/validation/practice-evaluation-rc3-real-cases-live-1.md` (58 hits)
- `docs/validation/practice-evaluation-927b-live-2.md` (55 hits)
- `services/dashboard-api/methods-part-06-of-14.js` (53 hits)
- `services/gasnetz-waermeplanung.service.js` (53 hits)
- `docs/validation/practice-evaluation-889-live-1.md` (52 hits)
- `docs/validation/practice-evaluation-889-live-2.md` (52 hits)
