# Strukturierte Nachrichten im Chat

CET erkennt strukturierte Nachrichten vor der Dokument- und Tabellenverarbeitung. Der generische Einstieg liegt in `src/structured-message.js`; Adapter stehen in `src/structured-message-adapters.json`. Die EDIFACT-Syntax und Typkonfiguration befinden sich außerhalb dieses Kerns. MSCONS und der Chat nutzen denselben Segment-/Escape-Parser aus `src/edifact-base.js`.

Originaldateien kommen über den vorhandenen Dateikanal (#790), einschließlich `.edi`/`.edifact` mit `application/edifact`; alternativ funktionieren UTF-8-Textdateien, Open-WebUI-Volltext-Kontexte und direkt eingefügter Nachrichtentext. Explizite betrieblich konfigurierte Allowlisten müssen die zusätzlichen Endungen freigeben. Die bisherigen Tenant-, Clearance-, Größen- und Scannerprüfungen gelten weiter.

Nachrichten, Segmente und konfigurierte Gruppen werden vollständig im vorhandenen Tenant-Datensatzspeicher abgelegt. Im bestehenden datapoint/OEMetadata-Katalog stehen Typen, Versionen, Provenienz als Nutzerangabe und Prüfungsbefunde. Gleicher Inhalt erzeugt keine zweite Version; geänderter Inhalt mit gleichem Dateinamen erzeugt eine neue Version. Gelöschte Anhänge werden beim erneuten Übermitteln nicht automatisch wiederhergestellt. Mehrere Chats können auf denselben Datensatz verweisen. Allgemeine Folgefragen übernehmen dabei keine konkurrierende Tabelle; bei konkurrierenden Datensätzen muss die Frage den Nachrichtengegenstand ausdrücklich benennen. Neu eingefügte Tabellen gehen weiterhin durch den Tabellenpfad.

Die Konfiguration `src/edifact-message-types.json` beschreibt Mindestsegmente, Gruppengrenzen und numerische Extraktion für INVOIC, MSCONS, UTILMD und APERAK. Syntaxprüfungen vergleichen UNT-/UNZ-Zähler und Referenzen und melden fehlende Abschlüsse. INVOIC-Beträge werden centgenau ausgewertet; Positionssumme gegen Netto sowie Netto plus Steuer gegen Gesamtbetrag, negative Beträge und statistische Ausreißer werden mit Nachrichten-/Segmentbezug benannt. Währungen werden getrennt summiert. Dies sind konfigurierte Mindestprüfungen, keine vollständige fachliche oder versionsspezifische Konformitätszertifizierung.

Codebedeutungen kommen ausschließlich aus `willi-mako.resolveStructure`, Kategorie `edifact`, mit benannter Quelle. Fehlende, unpassende oder nicht erreichbare Quellen und nicht abgefragte Qualifier bleiben ausdrücklich ungeklärt. Die Anzahl externer Nachschlagevorgänge ist begrenzt.

Folgefragen wie „Schlüssele Rechnung SYN-INV-002 auf“ und „Welche Rechnungen über 1.000 €?“ gehen über `dataset.query`. Auswahl und Berechnung erfolgen deterministisch auf den lokal gespeicherten Nachrichten; der Betragsfilter bezieht sich auf den ausgewiesenen EUR-Gesamtbetrag. Unbekannte Rechnungen erhalten einen leeren Trefferbefund. Einzelabfragen mit mehr als 100 Treffern werden mit einer ausdrücklichen Budgetmeldung abgewiesen. Ein Überblick benennt, wenn nur die ersten zehn Nachrichten einzeln dargestellt werden; alle Nachrichten bleiben gespeichert.

Die normale Antwortphase verwendet nur diese Abfrageevidenz. Rohsegmente, lokale Nachrichteninhalte und FTX-Nutzdaten gelangen nicht in Modellprompts; die zentrale LLM-Fassade übernimmt zusätzlich PII-Maskierung. Eine Modellformulierung, die erforderliche Werte oder Befunde verliert, wird durch die deterministische Antwort ersetzt. Bei unklarem Zweck kommt nach dem Überblick eine natürliche Frage; derselbe Anhang löst sie im selben Chat nicht erneut aus.

Die synthetischen Testdaten entstehen in `scripts/generate-edifact-fixtures.js`. `scripts/validate-edifact-live.js` prüft drei Läufe der Akzeptanzfragen mit der real konfigurierten zentralen LLM-Fassade und isolierter Persistenz. Keine Modellnamen sind im Skript festgelegt. Der Bericht wird vom Skript erzeugt, nicht von Hand gepflegt. Für einen Lauf:

```sh
WORKBENCH_ENV_FILE=/pfad/zur/lokalen/.env node scripts/validate-edifact-live.js
```

Das Skript verwendet einen Interchange mit drei erfundenen Rechnungen und rein synthetischem Fülltext über 525 KB. Quellenzugriffe auf Willi-Mako sind real; fehlende Antworten werden nicht durch erfundene Definitionen ersetzt. Authentifizierte HTTP-Regressionen sichern Originaldatei und Volltext-Fallback; separate Tests sichern die MSCONS-/EDM-Regression, Escape-Trennung und Tenant-Grenzen. Kein Deployment ist Teil dieser Änderung.
