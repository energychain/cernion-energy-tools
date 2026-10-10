# Messwert-/EDM-Plausibilitätsfall

Generated: 2026-10-10T13:25:30.222Z

Status: observed
Priority: 2

## Zweck

Strukturiert Fälle, in denen Messwerte, Lastgänge, Verbrauchs-/Erzeugungsdaten oder EDM-Daten auffällig, unvollständig oder erklärungsbedürftig sind.

## Typische Eingangssignale

- Verbrauch oder Erzeugung wirkt unplausibel
- Lastgang enthält Lücken, Ausreißer oder Sprünge
- Werte passen nicht zu Zeitraum, Wetter, Anlage, Vertrag oder Historie
- Messwerte fehlen oder sind verspätet
- Ersatzwerte, Prognosen und Ist-Werte werden vermischt
- Abweichung ist sichtbar, aber Ursache unklar

## Fachliche Kernobjekte

- Case
- Messwert
- Lastgang
- Zeitreihe
- Zählpunkt / MaLo / MeLo
- Zeitraum
- Ist-Wert
- Ersatzwert
- Prognosewert
- Referenzwert
- Auffälligkeit
- Plausibilitätsgrad
- Einflussfaktor
- Klärhypothese
- Datenlücke
- Entscheidungspunkt

## Prozessmuster

- Fall aufnehmen
- Messobjekt und Zeitraum bestimmen
- Datenqualität prüfen
- Auffälligkeiten erkennen
- Referenz- oder Vergleichswerte suchen
- fachliche Hypothesen bilden
- Evidenzstatus trennen
- Handlungsrelevanz einschätzen
- Klärpfad oder Beobachtung empfehlen

## Practice Layer

CET darf:

- Auffälligkeit markieren
- Zeitraum eingrenzen
- Vergleich mit Historie oder Prognose vorbereiten
- Datenlücke oder Ersatzwertstatus benennen
- Rückfrage an Messstellenbetrieb oder Sachbearbeitung formulieren
- Beobachtung oder Eskalation empfehlen

CET darf nicht:

- Messwert als falsch behaupten, wenn nur Auffälligkeit belegt ist
- Fehlerursache verbindlich behaupten, wenn sie nur plausibel ist
- abrechnungsrelevante Korrektur ohne Nachweis und HITL anstoßen
- Ersatzwert, Prognosewert und Ist-Wert unmarkiert vermischen

## Evidence vs Practice

Harte Evidenz ist nötig für:

- Korrektur eines abrechnungsrelevanten Messwerts
- verbindliche Aussage über Fehlerursache
- externe Reklamation
- produktive Änderung in EDM-/Abrechnungssystemen

Fachliche Plausibilisierung reicht für:

- Auffälligkeit markieren
- Hypothesen formulieren
- Zeitraum eingrenzen
- historischen Vergleich vorbereiten
- Rückfrage formulieren
- Eskalationsbedarf vorschlagen

## Zustände

- `new` — Fall ist aufgenommen.
- `data_scope_defined` — Messobjekt und Zeitraum sind bestimmt.
- `anomaly_detected` — Eine Auffälligkeit wurde erkannt.
- `plausibility_checked` — Erste Plausibilitätsdimensionen wurden geprüft.
- `hypothesis_ready` — Mögliche Ursachen sind formuliert.
- `evidence_required` — Für eine abschließende Aussage fehlen Nachweise.
- `action_recommended` — Beobachten, Rückfragen, Eskalieren oder Korrigieren ist vorgeschlagen.
- `human_decision_required` — Mensch muss über Korrektur, externe Kommunikation oder Eskalation entscheiden.

## Plausibilitätsdimensionen

- Vollständigkeit
- Kontinuität
- Größenordnung
- historischer Vergleich
- Kontextvergleich
- Prozessrelevanz

## Typische Hypothesen

- Datenlücke oder verspätete Lieferung
- Ersatzwert statt gemessenem Wert
- falsche Zuordnung von Messobjekt oder Zeitraum
- technische Störung
- verändertes Nutzungsverhalten
- saisonaler oder wetterbedingter Effekt
- Prognosemodell passt nicht zum aktuellen Zustand
- Bilanzierungs-/Importfehler

## Next Best Actions

- Zeitraum und Messobjekt eindeutig bestimmen
- Wert gegen historischen Vergleichszeitraum prüfen
- Datenlücke oder Ersatzwertstatus klären
- Auffälligkeit markieren, aber Ursache noch nicht behaupten
- Rückfrage an Messstellenbetrieb/Sachbearbeitung vorbereiten
- bei hoher Prozessrelevanz HITL-Eskalation vorschlagen

## OpenWebUI-Routing

Usertext → Messwert-/EDM-Plausibilitätsfall → Zeitraum/Messobjekt → Auffälligkeit → Plausibilisierung → Handlungsoption

## Anti-Pattern

Nicht:

Der Messwert ist nicht nachweislich falsch, daher keine Handlung.

Sondern:

Der Messwert ist nicht abschließend als falsch belegt. Er ist aber plausibilisierungsbedürftig. Fachlich sinnvoll wäre jetzt ...

## Code-/Doku-Signale

- `docs/validation/739-routing.json` (308 hits)
- `src/capability-catalog.js` (299 hits)
- `src/evidence-registry.js` (187 hits)
- `services/api.service.js` (163 hits)
- `src/answer-dossier-hydration-rules.json` (144 hits)
- `services/energy-market.service.js` (139 hits)
- `services/dashboard-api/methods-part-05-of-14.js` (131 hits)
- `services/forecast.service.js` (115 hits)
- `services/dashboard-api/methods-part-02-of-14.js` (114 hits)
- `docs/sonarcloud-security-review.json` (109 hits)
- `services/dashboard-api/actions-part-01-of-8.js` (109 hits)
- `services/capability-broker.service.js` (108 hits)
- `services/agent.service.js` (100 hits)
- `docs/reviews/730-capability-routing-evaluation.json` (97 hits)
- `services/dashboard-api/methods-part-04-of-14.js` (96 hits)
- `MCP_TOOLS.md` (94 hits)
- `services/residual-load.service.js` (94 hits)
- `src/report-builder.js` (91 hits)
- `services/dashboard-api/methods-part-13-of-14.js` (88 hits)
- `services/forecast-engine.service.js` (81 hits)
- `services/in-memory-join.service.js` (77 hits)
- `src/cookbook-recipes.js` (77 hits)
- `src/forecast-evaluation.js` (76 hits)
- `services/dashboard-api/methods-part-03-of-14.js` (75 hits)
- `src/workbench-activity-taxonomy.js` (75 hits)
