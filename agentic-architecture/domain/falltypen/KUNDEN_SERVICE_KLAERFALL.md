# Kunden-/Service-Klärfall

Generated: 2026-10-10T19:29:08.782Z

Status: draft
Priority: 3

## Zweck

Strukturiert unklare oder mehrdeutige Kunden-, Service- oder Assistenzanfragen, die mehrere energiewirtschaftliche Prozesse berühren können.

## Typische Eingangssignale

- Kunde beschreibt Problem ohne klare Prozesszuordnung
- Anfrage betrifft mehrere Bereiche wie Vertrag, Netz, Messung, Abrechnung, Prognose oder Anlage
- wichtige Identifikatoren fehlen
- Sachverhalt ist fachlich verständlich, aber nicht systematisch modelliert
- Antwort ist möglich, aber nicht abschließend entscheidbar
- Zuständigkeit zwischen Kunde, Netzbetreiber, Lieferant, Messstellenbetrieb oder interner Sachbearbeitung ist unklar

## Fachliche Kernobjekte

- Case
- Anliegen
- Kunde
- Vertrag
- Anschlussobjekt
- MaLo / MeLo / Zählpunkt
- Anlage
- Zeitraum
- betroffene Marktrolle
- Zuständigkeit
- fehlende Information
- Antwortentwurf
- Rückfrage
- Eskalationspunkt
- Human Decision Point

## Prozessmuster

- Anfrage aufnehmen
- Anliegen in natürlicher Sprache zusammenfassen
- mögliche Falltypen erkennen
- betroffene Objekte und Rollen extrahieren
- fehlende Informationen benennen
- Zuständigkeit oder Klärpfad ableiten
- Antwortentwurf oder interne Notiz vorbereiten
- HITL-Punkte markieren
- nächsten Arbeitsschritt empfehlen

## Practice Layer

CET darf:

- Anliegen strukturieren
- mögliche Zuständigkeiten benennen
- fehlende Angaben anfordern
- Antwortentwurf vorbereiten
- interne Klärnotiz erstellen
- Next Best Action vorschlagen

CET darf nicht:

- verbindliche Kundenauskunft ohne ausreichende Datenlage geben
- Vertrags-, Preis-, Frist- oder Netzanschlusszusage simulieren
- externe Kommunikation ohne HITL auslösen
- unklare Anfrage zu früh auf ein einzelnes Tool verengen

## Evidence vs Practice

Harte Evidenz ist nötig für:

- verbindliche Kundenauskunft
- Vertragsänderung
- Abrechnungskorrektur
- externe Kommunikation im Namen eines Unternehmens
- Zusage zu Netzanschluss, Preis, Frist oder technischer Machbarkeit

Fachliche Plausibilisierung reicht für:

- Anliegen strukturieren
- mögliche Zuständigkeiten benennen
- fehlende Angaben anfordern
- Antwortentwurf vorbereiten
- interne Klärnotiz erstellen
- Next Best Action vorschlagen

## Zustände

- `new` — Anfrage ist aufgenommen.
- `intent_summarized` — Anliegen wurde in fachlicher Sprache zusammengefasst.
- `possible_case_types_identified` — Ein oder mehrere mögliche Falltypen wurden erkannt.
- `missing_information_identified` — Fehlende Angaben sind benannt.
- `responsibility_hypothesized` — Eine wahrscheinliche Zuständigkeit ist formuliert.
- `draft_ready` — Antwortentwurf oder interne Klärnotiz ist vorbereitet.
- `human_review_required` — Antwort oder Handlung braucht menschliche Prüfung.
- `ready_for_next_step` — Der nächste Arbeitsschritt ist klar.

## Untertypen

- Abrechnungsfrage
- Messwertfrage
- Vertrags-/Tariffrage
- Netz-/Anschlussfrage
- Anlagen-/Prosumer-Frage
- Störungs-/Prozessfrage

## Next Best Actions

- Anliegen fachlich zusammenfassen
- fehlende Identifikatoren anfordern: Vertragskonto, Zählpunkt, Zeitraum, Adresse
- Falltyp bestimmen: Rechnung, Messwert, Vertrag, Netz, Anlage, Störung
- Antwortentwurf mit Unsicherheiten vorbereiten
- interne Klärnotiz für Sachbearbeitung erzeugen
- HITL markieren, wenn externe Aussage verbindlich werden könnte

## OpenWebUI-Routing

Usertext → Kunden-/Service-Klärfall → Anliegen/Zuständigkeit/fehlende Daten → Antwortentwurf oder interner Klärpfad

## Anti-Pattern

Nicht:

Bitte wählen Sie ein Tool oder einen Prozess.

Sondern:

Ich fasse den Fall zuerst fachlich zusammen, benenne fehlende Informationen und schlage den nächsten Klärschritt vor.

## Code-/Doku-Signale

- `src/capability-catalog.js` (476 hits)
- `agentic-architecture/domain/ENERGY_DOMAIN_CANON.md` (311 hits)
- `agentic-architecture/reports/latest/domain-abstraction/ENERGY_DOMAIN_CANON.md` (311 hits)
- `agentic-architecture/reports/latest/architecture-scan.md` (262 hits)
- `services/capability-broker.service.js` (259 hits)
- `src/report-builder.js` (174 hits)
- `services/chatgpt-sidecar.service.js` (156 hits)
- `feedback/HYGIENE_SPRINT.md` (145 hits)
- `function-model.report.md` (138 hits)
- `docs/v0.58-architecture/lagebild/tranche_c.md` (136 hits)
- `src/cookbook-recipes.js` (129 hits)
- `src/answer-dossier-hydration-rules.json` (127 hits)
- `docs/v0.58-architecture/lagebild/roles_audit.md` (119 hits)
- `docs/agent-responses/rd-audit.json` (118 hits)
- `services/api.service.js` (114 hits)
- `agentic-architecture/reports/latest/scan-summary.json` (99 hits)
- `agentic-architecture/reports/latest/refactoring-backlog.md` (93 hits)
- `docs/ARCHITECTURE.md` (93 hits)
- `services/dashboard-api/methods-part-07-of-14.js` (93 hits)
- `docs/v0.52-implementation-plans/v0.52.8-conversational-onboarding.md` (89 hits)
- `docs/v0.58-architecture/lagebild/tranche_b.md` (88 hits)
- `docs/validation/739-routing.json` (88 hits)
- `services/business-intelligence.service.js` (88 hits)
- `docs/v0.58-architecture/LAGEBILD_EXPLORATION_PROTOCOL.md` (87 hits)
- `src/evidence-registry.js` (85 hits)
