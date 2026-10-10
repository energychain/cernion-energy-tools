# Case Type Routing

Generated: 2026-10-10T19:29:08.782Z

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
