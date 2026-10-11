# Prognose-/Abweichungsfall

Generated: 2026-10-11T01:32:48.510Z

Status: observed
Priority: 5

## Zweck

Beschreibt Prognose-/Abweichungsfall als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.

## Typische Eingangssignale

- Welche Prognose, welcher Ist-Wert und welches Zeitfenster sind betroffen?
- Welche Abweichung ist fachlich oder wirtschaftlich handlungsrelevant?
- Geht es um Beobachtung, Korrektur oder Eskalation?

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

- Abweichung einordnen
- Hypothesen bilden
- Sensitivitäten benennen
- Klärpfad vorbereiten

CET darf nicht:

- finale Entscheidung ohne Nachweis behaupten
- externe Wirkung ohne HITL auslösen
- fachliche Unsicherheit technisch wegdefinieren

## Evidence vs Practice

Harte Evidenz ist nötig für:

- Prognoseobjekt, Ist-Wert, Zeitfenster und Referenz
- Kontextfaktoren für Ursachenhypothesen
- HITL vor markt- oder abrechnungsrelevanter Korrektur

Fachliche Plausibilisierung reicht für:

- Abweichung einordnen
- Hypothesen bilden
- Sensitivitäten benennen
- Klärpfad vorbereiten

## Zustände

- `new` — Fall ist aufgenommen.
- `hypothesis_ready` — Arbeitshypothese ist formuliert.
- `human_decision_required` — Externe Wirkung oder produktive Änderung braucht HITL.

## Next Best Actions

- Abweichung und Zeitraum eingrenzen
- plausible Ursachen und Einflussfaktoren strukturieren
- Beobachten, Rückfragen, Korrigieren oder Eskalieren empfehlen

## OpenWebUI-Routing

Usertext → Prognose-/Abweichungsfall → Klärpunkte → Evidence Boundary → Next Best Action

## Anti-Pattern

Nicht:

Keine finale Evidenz, daher keine Hilfe.

Sondern:

CET hält Unsicherheit sichtbar und macht den Fall arbeitsfähig.

## Code-/Doku-Signale

- `src/capability-catalog.js` (210 hits)
- `services/mastr-monitor.service.js` (158 hits)
- `docs/validation/739-routing.json` (150 hits)
- `docs/sonarcloud-security-review.json` (144 hits)
- `services/energy-market.service.js` (141 hits)
- `services/forecast-sandbox.service.js` (133 hits)
- `src/report-builder.js` (124 hits)
- `services/in-memory-join.service.js` (120 hits)
- `src/answer-dossier-hydration-rules.json` (111 hits)
- `services/forecast.service.js` (109 hits)
- `services/residual-load.service.js` (101 hits)
- `src/evidence-registry.js` (91 hits)
- `services/capability-broker.service.js` (88 hits)
- `services/forecast-engine.service.js` (78 hits)
- `services/entsoe.service.js` (76 hits)
- `src/forecast-evaluation.js` (76 hits)
- `services/dashboard-api/methods-part-11-of-14.js` (73 hits)
- `services/api.service.js` (69 hits)
- `services/agent.service.js` (66 hits)
- `src/oep-delta-engine.js` (65 hits)
- `docs/reviews/730-capability-routing-evaluation.json` (63 hits)
- `docs/ui-contracts/24-forecast-engine.md` (62 hits)
- `src/forecast-sandbox-openapi.js` (60 hits)
- `MCP_TOOLS.md` (59 hits)
- `src/forecast-portfolio.js` (56 hits)
