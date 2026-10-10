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
