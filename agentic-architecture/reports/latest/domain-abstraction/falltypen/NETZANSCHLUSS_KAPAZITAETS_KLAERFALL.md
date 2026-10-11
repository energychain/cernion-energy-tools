# Netzanschluss-/Kapazitäts-Klärfall

Generated: 2026-10-11T01:32:48.510Z

Status: observed
Priority: 4

## Zweck

Beschreibt Netzanschluss-/Kapazitäts-Klärfall als natürliches energiewirtschaftliches Arbeitsmodell ohne abschließende Entscheidungsfiktion.

## Typische Eingangssignale

- Welches Anschlussobjekt, welche Leistung und welcher Netzverknüpfungspunkt sind betroffen?
- Geht es um erste Einschätzung, Prüfauftrag oder externe Zusage?
- Welche Netzebene und welcher Zeitraum sind relevant?

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

- interne Einschätzung
- Klärpunktliste
- Rückfrageentwurf
- Readiness-Strukturierung

CET darf nicht:

- finale Entscheidung ohne Nachweis behaupten
- externe Wirkung ohne HITL auslösen
- fachliche Unsicherheit technisch wegdefinieren

## Evidence vs Practice

Harte Evidenz ist nötig für:

- Anschlussobjekt, Leistung, Netzgebiet und Netzebene
- Netzbetreiber-/Planungsrückmeldung für verbindliche Zusagen
- HITL vor externer Machbarkeits- oder Anschlusszusage

Fachliche Plausibilisierung reicht für:

- interne Einschätzung
- Klärpunktliste
- Rückfrageentwurf
- Readiness-Strukturierung

## Zustände

- `new` — Fall ist aufgenommen.
- `hypothesis_ready` — Arbeitshypothese ist formuliert.
- `human_decision_required` — Externe Wirkung oder produktive Änderung braucht HITL.

## Next Best Actions

- Anschlussobjekt und Leistungsbedarf strukturieren
- offene technische und planerische Klärpunkte benennen
- Readiness und nächsten Prüfauftrag vorbereiten

## OpenWebUI-Routing

Usertext → Netzanschluss-/Kapazitäts-Klärfall → Klärpunkte → Evidence Boundary → Next Best Action

## Anti-Pattern

Nicht:

Keine finale Evidenz, daher keine Hilfe.

Sondern:

CET hält Unsicherheit sichtbar und macht den Fall arbeitsfähig.

## Code-/Doku-Signale

- `docs/agent-responses/rd-audit.json` (236 hits)
- `src/capability-catalog.js` (91 hits)
- `services/capability-broker.service.js` (67 hits)
- `src/report-builder.js` (44 hits)
- `src/answer-dossier-hydration-rules.json` (35 hits)
- `services/personal-agent/shared.js` (30 hits)
- `src/consultation-execution-bridge.js` (26 hits)
- `src/personal-agent-routing.js` (21 hits)
- `src/validation-findings.js` (21 hits)
- `services/assets.service.js` (20 hits)
- `src/case-type-routing.js` (20 hits)
- `src/evidence-registry.js` (18 hits)
- `docs/v0.52-implementation-plans/v0.52.8-conversational-onboarding.md` (17 hits)
- `docs/v0.52-implementation-plans/v0.52.x-agentic-redteam-uat-bank-dd.md` (17 hits)
- `src/semantic-domains.js` (17 hits)
- `services/dashboard-api/methods-part-13-of-14.js` (16 hits)
- `services/mastr-quality.service.js` (14 hits)
- `integrations/budibase/README.md` (13 hits)
- `services/redispatch-expost.service.js` (13 hits)
- `src/blueprints/grid-connection-validation-v1.json` (13 hits)
- `services/community.service.js` (12 hits)
- `services/personal-agent/methods-part-03-of-11.js` (12 hits)
- `services/znp.service.js` (11 hits)
- `docs/ONBOARDING_NETZPLANUNG.md` (10 hits)
- `docs/ui-contracts/14-finding-code-recommendations.md` (10 hits)
