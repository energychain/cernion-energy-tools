# Tenant-Datenkatalog – Phase 1

Open WebUI muss angehängte Dateien im **Volltextmodus** übermitteln. CET erkennt CSV,
TSV, Markdown-Tabellen und XLSX-Text (wiederholte `Spalte: Wert`-Paare). Mehrere Blätter
können durch `Sheet: Name` oder `Blatt: Name` getrennt werden. Ein eigener Transport
für Originaldateien ist eine spätere Phase. Ausschnitte aus einer RAG-Suche lassen
sich nicht als vollständige Datei rekonstruieren.

Die vollständigen typisierten Zeilen liegen lokal in SQLite, getrennt je authentifiziertem
Tenant. Zeitspalten behalten den Originalwert und einen UTC-Wert. Der Pool verwendet die
native Fehlerbehandlung, WAL-Einstellungen und Shutdown-Verwaltung des bestehenden
EDM-Pools. Katalog und OEMetadata liegen im bestehenden datapoint-Service; es gibt keine
zusätzliche Katalogdatenbank. Die Datensatz-Einträge verwenden einen eigenen tenantgebundenen
Schlüsselbereich und erscheinen nicht in der allgemeinen datapoint-Liste.

Jeder gespeicherte Datensatz ist eine **Nutzerangabe**, mit Person, Rollen, Datum,
Dateiname und Gesprächsbezug. Die Sichtbarkeit ist tenantweit; die bestehende
Vertraulichkeitsprüfung gilt auch beim Lesen, Korrigieren und Löschen. Systemdaten
werden dadurch nicht überschrieben. Mehrdeutige Datensätze werden zur Auswahl genannt.

## Verwendung

- Datei anhängen und beispielsweise nach Auffälligkeiten fragen. Die Antwort liefert
  Maximum mit Zeitpunkt, Minimum, Mittelwert, leere Werte, Zeitlücken, doppelte UTC-Zeiten,
  Zeitumstellungen, statistische Ausreißer und, bei geeigneter Einheit und Zeitraster,
  die integrierte Menge. Am Ende steht ein korrigierbarer Bestätigungssatz.
- Folgeturn oder anderer Chat im selben Tenant: nach Daten, Maximum, Mittelwert oder
  Monatswerten fragen. Zahlen kommen ausschließlich aus `dataset.query`.
- „Die Werte sind kWh je Viertelstunde“ korrigiert die Semantik, ohne die Zeilen erneut
  hochzuladen. Die Korrektur enthält einen Audit-Eintrag. Wenn die Interpretation nicht
  gelingt, bleibt die bisherige Semantik erhalten und CET sagt das ausdrücklich.
- Eine geänderte Datei mit demselben Dateinamen und Blatt erzeugt eine neue Version.
  Alte Versionen bleiben mit `id` und `version` abfragbar.
- „Lösch den Datensatz …“ entfernt sämtliche Versionen dieser Datensatzfamilie aus
  SQLite und dem Katalog. SQLite verwendet `secure_delete`, WAL-Checkpoint und `VACUUM`;
  datapoint kompaktiert die entfernten Revisionen. Der separate Lösch-Audit enthält
  Tenant, Akteur, Datensatz-ID, Inhaltshash, Vertraulichkeitsstufe und Datum, keine Zeilen.

Open WebUI sendet Anhänge in jedem Turn erneut. Der Hash entsteht aus den vollständigen,
typisierten Zellen. CSV, Markdown und Schlüssel/Wert-Darstellungen desselben Inhalts
erzeugen weder neue Datensätze noch Versionen oder weitere Bestätigungssätze. Eine
aktuelle Frage wird erneut deterministisch abgefragt. Für gewöhnliche Gesprächsaufträge
werden bereits gespeicherte Tabellen aus dem Dokumentpfad entfernt.
Der Hash im bestehenden Lösch-Audit verhindert auch, dass ein erneut gesendeter alter
Anhang den gelöschten Datensatz wieder anlegt. Die aktuelle Frage wird über
`dataset.query` mit dem ehrlichen Hinweis auf den nicht mehr vorhandenen Datensatz
beantwortet; andere aktive Datensätze werden durch einen wiederholten Löschauftrag
nicht entfernt.

Kleine Tabellen werden nur für die aktuelle Rechenfrage ausgewertet, wenn sie unter der
Wegwerfgrenze liegen und weder Zeitreihe noch Kennungsfelder enthalten. Im Zweifel
wird gespeichert.

## Grenzen und Betrieb

| Einstellung | Default | Bedeutung |
| --- | --- | --- |
| `WORKBENCH_DATASET_DB_PATH` | `data/datasets` | SQLite-Zeilenablage |
| `WORKBENCH_DATASET_MAX_ROWS` | 50000 | Zeilen pro Blatt |
| `WORKBENCH_DATASET_MAX_BYTES` | 8000000 | UTF-8-Bytes des Tabelleninhalts |
| `WORKBENCH_DATASET_MAX_COLUMNS` | 128 | Spalten pro Blatt |
| `WORKBENCH_DATASET_DISPOSABLE_ROWS` | 20 | Wegwerfgrenze, exklusiv |
| `WORKBENCH_DATASET_TIMEZONE` | `Europe/Berlin` | Explizit benannte Annahme bei fehlender Zeitzone |

Zusätzlich gelten Gateway-Request-Limit und `WORKBENCH_DOCUMENT_MAX_CHARS`. Der Proxy
muss große vollständige Requests zulassen, beispielsweise `client_max_body_size 10m`
bei nginx; die Einstellungen müssen aufeinander abgestimmt sein. Grenzen werden vor
dem Speichern geprüft. Eine Überschreitung liefert eine ehrliche Fehlermeldung;
es gibt keine stille Kürzung. Auch zu große Abfrageergebnisse werden zurückgewiesen.

Semantik und Abfragepläne verwenden ausschließlich `src/llm-client.js`. Modellprompts
enthalten Schema, Profilstatistik und datenschutzgefilterte äußere Frage. Weder Rohzeilen
noch Zellstichproben gehen an das Modell. Filter und Aggregate sind schema-validiert;
SQL-Werte sind gebunden und Bezeichner geprüft. Freies SQL, Joins und Schreiboperationen
sind nicht erlaubt. Der Capability-Loop bietet nur `dataset.query` an; die interne
Aufnahme und Verwaltung sind getrennte, geschützte Aktionen.

## Referenz und Abnahme

Fixtures werden ausschließlich synthetisch durch `scripts/generate-dataset-fixtures.js`
erzeugt. Die Textdarstellungen entstehen zur Testlaufzeit. Das kleine Referenzmanifest
kann mit `node scripts/generate-dataset-fixtures.js --check` überprüft werden.

| AC | Nachweis |
| --- | --- |
| 01 | Vollständige 35.040 Zeilen, CSV/Markdown/XLSX-Text, Bestätigung und OEMetadata |
| 02 | Andere Person und anderer Chat im selben Tenant, einschließlich HTTP |
| 03 | 1.243,7 kW am 14.01.2025 18:15; 3.478,874 MWh; lokale Monats-/Tageswerte |
| 04 | Semantikkorrektur ohne Zeilen-Upload, auch bei erneut übermitteltem Anhang |
| 05 | Kleine temporäre Tabelle ohne Katalogeintrag |
| 06 | Hash-Deduplizierung über Darstellungen und neue Version bei verändertem Inhalt |
| 07 | Physisches Löschen aller Versionen mit Audit |
| 08 | Prompt-Spy, fremder Tenant, Vertraulichkeit und keine freie SQL-Ausführung |
| 09 | Explizite Zeilen-, Byte- und Spaltenlimits ohne Kürzung |
| 10 | Repository-Gates und ausschließlich generierte synthetische Fixtures |

Die Zeitumstellung am 30.03. hat 92 lokale Viertelstunden, die am 26.10. hat 100.
Die fehlende beziehungsweise doppelte Ortszeitstunde ist nach UTC-Normalisierung keine
gewöhnliche Datenlücke oder Duplikat. Vier leere Messwerte werden nicht geschätzt und
bei Summen ausgelassen. Ausreißer sind statistische Hinweise (drei Standardabweichungen),
keine Behauptung eines fachlichen Fehlers.

## Antwort- und Kalenderfilterregeln

Datensatzfragen durchlaufen die normale Antwortphase mit aggregierter `dataset.query`-
Evidenz und `answerMs`. Zahlen bleiben an das deterministische Ergebnis gebunden;
bei Antwortausfall bleibt eine passende Kurzantwort mit Herkunft verfügbar.
Spitzenwert-, Energie- und Mittelwertfragen liefern gezielte Sätze. Nur Überblicks-
und Auffälligkeitsfragen erhalten einen Bericht. Mittelwerte werden auf eine,
Energiesummen in MWh auf höchstens drei Nachkommastellen deutsch formatiert.

Datum und Zeit ohne Offset in `from`/`to` beziehen sich auf die Datensatzzeitzone;
explizite Offsetgrenzen bezeichnen Zeitpunkte. Kalendergrenzen im Abfrageplan werden
lokal ausgewertet, auch wenn die Planphase eine Mitternachtsgrenze mit `Z` liefert.
`to` ist exklusiv. Leistungssummen ohne Zeitfaktor sind im Executor verboten;
Energie entsteht ausschließlich durch Integration mit dem bestätigten Zeitraster.

Shared-Service-Notices im Chat benötigen aktuellen Funktions- und gegebenenfalls
Fallbezug sowie die bestehenden Sichtbarkeitsprüfungen. Fachfremde Hinweise bleiben
in der Warteschlange. Der vollständige Neuigkeitenabruf und Tenant-Gedächtnis-Notices
behalten ihren bisherigen Zugriffspfad; interne Referenzen bleiben strukturiert
für Reaktionen verfügbar und erscheinen nicht im Hinweistext.

### Relevanz und reproduzierbare Kennzahlen

Ein vorhandener Datensatz ist keine automatische Antwortquelle. Die Workbench prüft
Katalogmetadaten (Titel/Dateiname, Anker, Größenart und Zeitraum) zusammen mit der aktuellen
Frage und dem zuletzt belegten Gesprächsbezug. Ohne passenden Bezug bleibt `dataset.query`
aus der Kandidatenliste. Passende Tabellen und andere Lesewerkzeuge können im selben
Capability-Lauf abgefragt werden; Tenant-Gedächtnisfragen behalten ihren bestehenden Pfad.
Auch eine neue Datei wird zuerst abgelegt und bestätigt, ohne eine fremde Frage auf die
Tabelle umzuleiten.

Standardfragen nach Überblick, Qualität, Min/Max, Mittelwert, Summe/Energie und Kalenderwerten
werden ohne LLM-Abfrageplan berechnet. Die Kennzahlenbasis umfasst sämtliche Zeilen des
Datensatzes beziehungsweise des angefragten Zeitraums. Interne Messwertfilter beeinflussen
nur die erweiterte Auswertung, nicht Zeilen-/Leerwertzahlen, Integral oder Qualitätsbefunde.
Minima und Maxima enthalten den zugehörigen Zeitpunkt; das gilt auch für gruppierte
Abfragen. Lücken und Zeitumstellungen werden für den tatsächlichen Zeitraum ausgewertet.

Die reproduzierbare Live-Prüfung verwendet ausschließlich generierte synthetische Daten:

```bash
WORKBENCH_ENV_FILE=/path/to/configured.env \
WORKBENCH_VALIDATION_REPORT=/tmp/dataset-routing-live.json \
node scripts/validate-workbench-dataset-routing-live.js
```

Der Modellweg ist die zentrale LLM-Fassade ohne Modellüberschreibung. Katalog, Executor und
Workbench laufen real; Register- und Gedächtnisquellen liefern kontrollierte synthetische
Antworten. Der Bericht prüft drei unabhängige Läufe je Frage gegen 35.040 Zeilen, vier
Leerwerte, 1.243,7 kW am 14.01.2025 um 18:15 und 3.478,874 MWh sowie zwei fremde Fragen.
Die fremden Fragen müssen das Registerwerkzeug beziehungsweise das Tenant-Gedächtnis
nutzen und dürfen keine Datensatzantwort liefern. Ein fehlgeschlagener Check führt zu
Exit-Code 1.
