# Case Type Routing

Generated: 2026-10-11T01:32:48.510Z

OpenWebUI und Agentic Core sollen bei fachlichen Anfragen zuerst Falltypen erkennen, nicht direkt Tools auswählen.

## Routing-Kontrakt

Usertext -> case_type_candidates[] -> clarification_questions[] -> evidence_requirements[] -> next_best_actions[] -> allowed_tools[]

## Grundregel

Fehlende Evidenz blockiert finale Behauptungen, externe Wirkung und produktive Änderungen. Sie blockiert nicht Fallstrukturierung, Hypothesenbildung, Plausibilisierung, Rückfragen oder Next Best Actions.

## Falltyp-Routing

### Stammdaten-/Marktrollen-Klärfall

Routing:

Usertext → Stammdaten-/Marktrollen-Klärfall → Entitäten/Widersprüche → Klärpfad → Tool-/Evidence-Auswahl

Typische Signale:

- MaLo, MeLo, Zählpunkt, Adresse oder Kundendaten passen nicht zusammen
- Netzbetreiber, Lieferant, Messstellenbetreiber oder Bilanzkreis sind unklar
- Stammdaten aus verschiedenen Quellen widersprechen sich
- Ein Prozess scheitert, obwohl die fachliche Absicht erkennbar ist
- Eine Anfrage enthält natürliche Hinweise, aber keine vollständigen Identifikatoren

Erlaubte Assistenz ohne harte Evidenz:

- interne Einordnung
- Klärfallstrukturierung
- Hypothesenbildung
- Rückfrageentwurf
- Priorisierung des nächsten Arbeitsschritts

HITL/Evidence-Grenze:

- finale Stammdatenänderung
- externe Marktkommunikation
- verbindliche Aussage gegenüber Dritten
- produktive Korrektur in einem führenden System

### Messwert-/EDM-Plausibilitätsfall

Routing:

Usertext → Messwert-/EDM-Plausibilitätsfall → Zeitraum/Messobjekt → Auffälligkeit → Plausibilisierung → Handlungsoption

Typische Signale:

- Verbrauch oder Erzeugung wirkt unplausibel
- Lastgang enthält Lücken, Ausreißer oder Sprünge
- Werte passen nicht zu Zeitraum, Wetter, Anlage, Vertrag oder Historie
- Messwerte fehlen oder sind verspätet
- Ersatzwerte, Prognosen und Ist-Werte werden vermischt
- Abweichung ist sichtbar, aber Ursache unklar

Erlaubte Assistenz ohne harte Evidenz:

- Auffälligkeit markieren
- Hypothesen formulieren
- Zeitraum eingrenzen
- historischen Vergleich vorbereiten
- Rückfrage formulieren
- Eskalationsbedarf vorschlagen

HITL/Evidence-Grenze:

- Korrektur eines abrechnungsrelevanten Messwerts
- verbindliche Aussage über Fehlerursache
- externe Reklamation
- produktive Änderung in EDM-/Abrechnungssystemen

### Kunden-/Service-Klärfall

Routing:

Usertext → Kunden-/Service-Klärfall → Anliegen/Zuständigkeit/fehlende Daten → Antwortentwurf oder interner Klärpfad

Typische Signale:

- Kunde beschreibt Problem ohne klare Prozesszuordnung
- Anfrage betrifft mehrere Bereiche wie Vertrag, Netz, Messung, Abrechnung, Prognose oder Anlage
- wichtige Identifikatoren fehlen
- Sachverhalt ist fachlich verständlich, aber nicht systematisch modelliert
- Antwort ist möglich, aber nicht abschließend entscheidbar
- Zuständigkeit zwischen Kunde, Netzbetreiber, Lieferant, Messstellenbetrieb oder interner Sachbearbeitung ist unklar

Erlaubte Assistenz ohne harte Evidenz:

- Anliegen strukturieren
- mögliche Zuständigkeiten benennen
- fehlende Angaben anfordern
- Antwortentwurf vorbereiten
- interne Klärnotiz erstellen
- Next Best Action vorschlagen

HITL/Evidence-Grenze:

- verbindliche Kundenauskunft
- Vertragsänderung
- Abrechnungskorrektur
- externe Kommunikation im Namen eines Unternehmens
- Zusage zu Netzanschluss, Preis, Frist oder technischer Machbarkeit

### Netzanschluss-/Kapazitäts-Klärfall

Routing:

Usertext → Netzanschluss-/Kapazitäts-Klärfall → Klärpunkte → Evidence Boundary → Next Best Action

Typische Signale:

- Welches Anschlussobjekt, welche Leistung und welcher Netzverknüpfungspunkt sind betroffen?
- Geht es um erste Einschätzung, Prüfauftrag oder externe Zusage?
- Welche Netzebene und welcher Zeitraum sind relevant?

Erlaubte Assistenz ohne harte Evidenz:

- interne Einschätzung
- Klärpunktliste
- Rückfrageentwurf
- Readiness-Strukturierung

HITL/Evidence-Grenze:

- Anschlussobjekt, Leistung, Netzgebiet und Netzebene
- Netzbetreiber-/Planungsrückmeldung für verbindliche Zusagen
- HITL vor externer Machbarkeits- oder Anschlusszusage

### Prognose-/Abweichungsfall

Routing:

Usertext → Prognose-/Abweichungsfall → Klärpunkte → Evidence Boundary → Next Best Action

Typische Signale:

- Welche Prognose, welcher Ist-Wert und welches Zeitfenster sind betroffen?
- Welche Abweichung ist fachlich oder wirtschaftlich handlungsrelevant?
- Geht es um Beobachtung, Korrektur oder Eskalation?

Erlaubte Assistenz ohne harte Evidenz:

- Abweichung einordnen
- Hypothesen bilden
- Sensitivitäten benennen
- Klärpfad vorbereiten

HITL/Evidence-Grenze:

- Prognoseobjekt, Ist-Wert, Zeitfenster und Referenz
- Kontextfaktoren für Ursachenhypothesen
- HITL vor markt- oder abrechnungsrelevanter Korrektur

### Redispatch-/Steuerbarkeits-Readiness

Routing:

Usertext → Redispatch-/Steuerbarkeits-Readiness → Klärpunkte → Evidence Boundary → Next Best Action

Typische Signale:

- Welche Anlage, Marktrolle und technische Steuerkette sind betroffen?
- Welche Nachweise zur Steuerbarkeit oder Kommunikation liegen vor?
- Geht es um Readiness, Befassung oder verbindliche Freigabe?

Erlaubte Assistenz ohne harte Evidenz:

- Readiness-Strukturierung
- Klärpunktliste
- Nachweisbedarf benennen
- Befassung vorbereiten

HITL/Evidence-Grenze:

- Anlagenidentität, Betreiber, technische Steuerbarkeit und Kommunikationsweg
- Nachweise für prozessuale/vertragliche Voraussetzungen
- HITL vor Freigabe, externer Meldung oder produktiver Steuerhandlung

### Wärme-/Gas-/EOG-Szenariofall

Routing:

Usertext → Wärme-/Gas-/EOG-Szenariofall → Klärpunkte → Evidence Boundary → Next Best Action

Typische Signale:

- Welches Gebiet, welche Infrastruktur und welcher Betrachtungszeitraum sind betroffen?
- Welche Annahmen sind gesetzt und welche Klärpunkte offen?
- Geht es um Befassung, Szenariovergleich oder Beschlussvorbereitung?

Erlaubte Assistenz ohne harte Evidenz:

- Szenarien strukturieren
- Annahmen offenlegen
- Befassung vorbereiten
- Klärpunkte priorisieren

HITL/Evidence-Grenze:

- Gebiet, Annahmen, Infrastrukturstand und Szenariogrenzen
- Quellen für Kosten-/Risiko-/Zeitdimensionen
- HITL vor Beschluss-, Freigabe- oder Stilllegungswirkung
