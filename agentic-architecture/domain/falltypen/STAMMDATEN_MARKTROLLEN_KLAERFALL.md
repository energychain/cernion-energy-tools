# Stammdaten-/Marktrollen-Klärfall

Generated: 2026-10-11T01:32:48.510Z

Status: observed
Priority: 1

## Zweck

Strukturiert Fälle, in denen energiewirtschaftliche Stammdaten, Marktrollen oder Objektbeziehungen unvollständig, widersprüchlich oder implizit sind.

## Typische Eingangssignale

- MaLo, MeLo, Zählpunkt, Adresse oder Kundendaten passen nicht zusammen
- Netzbetreiber, Lieferant, Messstellenbetreiber oder Bilanzkreis sind unklar
- Stammdaten aus verschiedenen Quellen widersprechen sich
- Ein Prozess scheitert, obwohl die fachliche Absicht erkennbar ist
- Eine Anfrage enthält natürliche Hinweise, aber keine vollständigen Identifikatoren

## Fachliche Kernobjekte

- Case
- MaLo / MeLo / Zählpunkt
- Kunde / Vertragspartner
- Adresse / Anschlussobjekt
- Netzbetreiber
- Lieferant
- Messstellenbetreiber
- Bilanzierungsbezug
- Datenquelle
- Widerspruch
- Arbeitshypothese
- Klärfrage
- Process State

## Prozessmuster

- Fall aufnehmen
- energiewirtschaftliche Entitäten extrahieren
- Marktrollen identifizieren
- Stammdatenquellen gegenüberstellen
- Widersprüche oder Lücken markieren
- plausible Ursachen bilden
- Evidenzstatus je Aussage trennen
- nächste Klärfrage oder Rückfrage vorbereiten
- Arbeitsstand dokumentieren

## Practice Layer

CET darf:

- Inkonsistenzen sichtbar machen
- wahrscheinliche Ursachen vorschlagen
- fachliche Rückfragen formulieren
- Klärpfad empfehlen
- Vorgang für Menschen bearbeitbar machen

CET darf nicht:

- Marktrolle endgültig behaupten, wenn sie nur vermutet ist
- widersprüchliche Datenstände als verbindlich darstellen
- externe Prozesshandlungen ohne HITL auslösen
- rechtliche oder regulatorische Entscheidung simulieren

## Evidence vs Practice

Harte Evidenz ist nötig für:

- finale Stammdatenänderung
- externe Marktkommunikation
- verbindliche Aussage gegenüber Dritten
- produktive Korrektur in einem führenden System

Fachliche Plausibilisierung reicht für:

- interne Einordnung
- Klärfallstrukturierung
- Hypothesenbildung
- Rückfrageentwurf
- Priorisierung des nächsten Arbeitsschritts

## Zustände

- `new` — Fall ist aufgenommen, aber fachlich noch nicht strukturiert.
- `entities_detected` — Relevante Objekte und Rollen wurden erkannt.
- `inconsistency_found` — Mindestens ein Widerspruch oder eine Datenlücke ist benannt.
- `hypothesis_ready` — Eine oder mehrere plausible Ursachen sind formuliert.
- `clarification_needed` — Eine Rückfrage oder externe/interne Klärung ist nötig.
- `human_decision_required` — Änderung, Eskalation oder externe Aussage braucht HITL.
- `resolved_for_now` — Fall ist arbeitsfähig abgeschlossen, auch wenn Nachdokumentation offen bleibt.

## Next Best Actions

- fehlende MaLo/MeLo nachfordern
- zuständigen Netzbetreiber für das Anschlussobjekt bestätigen lassen
- Adresse gegen Zählpunkt/Anschlussobjekt prüfen
- wahrscheinlichsten Klärpfad benennen
- Rückfrage an Marktpartner oder Sachbearbeitung vorbereiten

## OpenWebUI-Routing

Usertext → Stammdaten-/Marktrollen-Klärfall → Entitäten/Widersprüche → Klärpfad → Tool-/Evidence-Auswahl

## Anti-Pattern

Nicht:

Keine ausreichende Evidenz. Keine Antwort möglich.

Sondern:

Die Datenlage reicht nicht für eine abschließende Stammdatenaussage. Fachlich sichtbar sind diese Widersprüche. Der nächste sinnvolle Klärschritt ist ...

## Code-/Doku-Signale

- `services/utility-report.service.js` (310 hits)
- `docs/agent-responses/rd-audit.json` (301 hits)
- `src/report-builder.js` (237 hits)
- `src/capability-catalog.js` (231 hits)
- `services/grid-operations.service.js` (191 hits)
- `services/edm.service.js` (164 hits)
- `services/capability-broker.service.js` (129 hits)
- `services/finance-agent.service.js` (122 hits)
- `docs/validation/739-routing.json` (115 hits)
- `services/agent.service.js` (113 hits)
- `services/mastr-quality.service.js` (112 hits)
- `services/dashboard-api/methods-part-13-of-14.js` (102 hits)
- `services/vnb-monitor.service.js` (102 hits)
- `services/assets.service.js` (100 hits)
- `src/consultation-execution-bridge.js` (97 hits)
- `services/api.service.js` (94 hits)
- `src/validation-findings.js` (91 hits)
- `services/dashboard-api/actions-part-01-of-8.js` (83 hits)
- `services/bilanzkreis.service.js` (75 hits)
- `services/energy-sharing.service.js` (74 hits)
- `src/evidence-registry.js` (73 hits)
- `services/dashboard-api/methods-part-07-of-14.js` (71 hits)
- `docs/validation/752-before-cache.json` (70 hits)
- `services/ewk-monitoring.service.js` (70 hits)
- `src/answer-dossier-hydration-rules.json` (70 hits)
