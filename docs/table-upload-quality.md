# Tabellen-Uploads: Kontrollsummen, Blätter und Einheiten

Chat-Datensätze und gestreamte Aktendatensätze verwenden denselben numerischen
Helfer (`src/dataset-table-quality.js`). Es gibt keine Fachwort- oder Bezeichnungslisten.

## Kontrollsummen

Eine Zeile ist zunächst nur ein Kandidat: Kennungs-/Beschreibungsspalten sind leer
oder enthalten höchstens eine Bezeichnung mit abweichender Zeichenstruktur.
Kennungsartige Spalten haben mindestens 80 % unterschiedliche Werte; bekannte
sensitive Kennungsspalten bleiben ebenfalls geschützt. Ein normal ausgefüllter
Schlüssel wird nicht durch eine fehlende Gruppenzuordnung zur Summenzeile.
Numerische Kennungen mit Leerstellen werden zusätzlich anhand ganzzahliger Werte
und mindestens 80 % gleicher, von null verschiedener Schritte im Schema-Sample
(maximal 256 Zeilen) geschützt. Auch rein numerische Tabellen können Kandidaten
mit leerer kennungsartiger Spalte enthalten. Ohne strukturelles Signal werden Zahlenfolgen nicht bereinigt.

Der Kandidat muss zu mindestens zwei Datenzeilen passen. Geprüft werden der
benachbarte zusammenhängende Block sowie der bisherige bzw. folgende Datenbereich.
Dadurch werden Zwischen-, führende, abschließende und wiederholte Gesamtsummen
berücksichtigt. Verglichen werden alle ausgefüllten, nicht sensitiven Zahlenspalten.
Die Toleranz beträgt `max(0,02; |Datensumme| × 10⁻⁸)` je Spalte. Rein nullwertige
Blöcke reichen nicht als Beleg. Eine abweichende Kontrollsumme wird nur ausgeschlossen,
wenn mindestens zwei unabhängige Spalten und mindestens 80 % der verglichenen
Spalten übereinstimmen; die Bestätigung meldet dann die Abweichung ausdrücklich.

Unbewiesene Kandidaten gehen wieder in die numerische Prüfung ein. Wird die
Zuordnung dadurch widersprüchlich, bleiben alle Zeilen Daten. Kontrollmetadaten
sind auf 1.000 Zeilen bzw. 4 MiB begrenzt; bei Überschreitung erfolgt ebenfalls
keine teilweise Bereinigung. Der Aktenpfad prüft über geordnete SQLite-Iteratoren,
auch außerhalb des Schemasamples und über Batchgrenzen hinweg.
Späte Bezeichnungen in zunächst numerisch erkannten Spalten sind nur vorläufig
zugelassen: Jede betroffene Zeile muss anschließend als Kontrollsumme belegt sein.
Andernfalls scheitert die Ableitung wie bei anderen numerischen Typfehlern.
Nach der Prüfung behalten die Datenspalten ihren ursprünglichen numerischen Typ.

Bei der Trennzeichenauswahl zählt die ursprüngliche Zeilenmenge einschließlich
Kontrollzeilen. Dadurch verdrängt eine falsche Komma-Zerlegung bei deutschen
Dezimalzahlen nicht die korrekt erkannte, bereits bereinigte Tabelle.

Kontrollzeilen liegen mit Originalwerten, Quellzeilennummer, geprüftem Bereich und
Abgleich in `quality.controls`, außerhalb der abfragbaren Datentabelle. Die
Ablagebestätigung nennt Anzahl und Abgleich. Gruppen-/Gesamtsummen entstehen aus
SQL-Abfragen der verbleibenden Daten. Originaldateien bleiben verfügbar.

## Blätter und Varianten

Explizite Blattnamen stehen im Ablagetitel und in jeder Herkunftsangabe.
Die Wiederholungserkennung berücksichtigt neben dem Inhalt auch das Blatt;
identische Blätter werden daher separat abgelegt. Versionen bleiben je Blatt getrennt.

Varianten haben dieselben Spaltennamen/-typen und eindeutige, nicht leere
kennungsartige Spalten mit mindestens 80 % unterschiedlichen Werten. Mindestens
zwei Kennungen und mindestens 80 % der größeren Zeilenmenge müssen übereinstimmen.
Die tatsächliche Überdeckung wird über SQLite geprüft. Textuelle/sensitive Schlüssel
haben Vorrang; andernfalls können numerische Schlüssel mit maximaler Überdeckung
verwendet werden. Ohne eindeutige Zuordnung bleibt die normale Auswahlrückfrage. Strukturgleiche
Geschwisterblätter derselben Datei werden auch ohne belegte Variantenbeziehung
gemeinsam als Kandidaten erhalten; ein einzelner Modelltreffer verdrängt sie nicht.

Ohne Blattbezug werden verknüpfte Varianten gemeinsam abgefragt; auch ein nur auf
ein Blatt zeigender Manifest-Fragetyp ergänzt die Geschwisterblätter. Ausgegeben
werden die getrennten Ergebnisse, Datensummen, deren gerichtete Differenz
(zweites minus erstes Blatt in kanonischer Blattreihenfolge), geänderte gemeinsame
Zeilen und nur einseitig vorhandene Kennungen. Gruppierte und gefilterte Differenzen
verwenden die ausgeführten Aggregationen. Ihre Beschriftung entsteht aus
Aggregatfunktion und Quellspalte; interne Plan-Aliase dienen ausschließlich dem
Ergebniszugriff. Je Blatt abweichende Aliase werden über Funktion und Feld verbunden.
Bei unterschiedlichen Einheiten wird
keine numerische Differenz gebildet. Blattweite Zeilenvergleiche beziehen sich auf
die gesamten Blätter. Unterschiedliche Schemas werden nicht still vereinigt.

Varianten führen denselben einmal geplanten Aggregations-/Filterplan je Blatt aus;
nur die Quell-ID wird auf das jeweilige Blatt gebunden. So entstehen keine
Vergleichspaare aus unabhängig gewählten Gruppierungen. Eine echte Datenzeile
mit leerer Gruppenzuordnung bleibt enthalten; ihre Gruppe heißt in Antworten
„ohne Gruppenangabe“. Der leere Gruppenschlüssel allein belegt keine Kontrollsumme.

## Einheiten und Korrekturen

`src/dataset-clarification.js` verwaltet den gemeinsamen Rückfragezustand im
geschützten Tenant-Katalog: `kind`, `status`, `conversationId`, versionierte
`targets`, `allowedAnswers`, Zeitstempel und Antwort. Blattwahl und Einheitenfrage
verwenden dieselben Zustandsübergänge. Die gespeicherten Antwortoptionen enthalten
Datei-/Blattnamen, Versionen, Wertspalten und Einheitenbezeichnungen aus `Intl`.
Eigene Einheiten sind als `Spaltenname = Einheit` möglich. Es gibt keine
handgepflegte Liste von Einheiten oder Formulierungen zur Absichtserkennung.

Die Workbench prüft diesen Zustand vor Projekt-, Memory- und allgemeiner
Semantikerkennung. Passende Antworten werden direkt über den auditierten
Datensatzpfad gespeichert und schließen die beantwortete Frage. Mehrdeutige
Einheitenantworten öffnen eine Blattwahl mit erhaltenem Einheitenvorschlag;
die anschließende Auswahl übernimmt diesen Vorschlag. Bei mehreren Wertspalten
bleibt die Frage bis zur Bestätigung aller Felder offen. Nicht passende Fragen
werden regulär abgefragt und verbrauchen die Rückfrage nicht. Wiederholte gültige
Bestätigungen nennen den gespeicherten Wert ohne weiteren Änderungsaudit.
Eine ausdrückliche Blattwahl bleibt auch nach beantworteter Einheitenfrage
deterministisch möglich. Nackte Korrekturen behalten ihren bisherigen Objektbezug.

Erst wenn eine veröffentlichte Wert-Aggregation oder ein numerischer Überblick eine
Spalte ohne Einheit benötigt, fragt die Abfrage gezielt nach deren Einheit. Reine
Zeilenanzahlen lösen keine Einheitenfrage aus. `semantic.unitQuestion` speichert die
Frage einmal je Datensatz mit Gespräch und betroffenen Spalten. Eine passende,
auch knappe Einheitenantwort wird diesen Spalten zugeordnet, auditiert gespeichert
und mit `answeredAt` abgeschlossen. Einheiten in eckigen/runden Klammern des
Spaltennamens gelten als bekannt; Datentypen wie `number` sind keine Einheiten.

Der vorhandene auditierte Datensatz-Korrekturpfad nimmt semantische Korrekturen,
Blattwahl und die Bestätigung echter Datenzeilen entgegen. Die Klassifikation ist
schema-gebunden und nutzt ausschließlich Metadaten, keine Zeilen oder Zellwerte.
Eine Änderung braucht einen wörtlichen Beleg aus der aktuellen Nutzernachricht;
Fragen und Berechnungsbitten bleiben Abfragen. Eine Einheitenantwort setzt eine
offene Frage im selben Gespräch voraus. Eine ausdrückliche Einheitenangabe ist
auch ohne offene Frage möglich. Ein fehlender Spaltenbezug wird nur bei genau
einem offenen Feld oder einer einzigen numerischen, nicht sensitiven Wertspalte
ergänzt. Der wörtliche Einheitenbeleg kann eine abweichende Modellnormalisierung
ersetzen und wird als Einheit gespeichert, ohne Wörterbuch oder Phrasenliste.
Eine ausdrücklich gemeinsame Angabe für strukturgleiche Blätter derselben Datei
wird je Blatt über denselben Auditpfad gespeichert; ohne belegten Mehrblattbezug
bleibt die Auswahlrückfrage bestehen. Folgeabfragen verwenden die gespeicherten
Spalteneinheiten aus dem Katalog. Ohne tatsächliche Änderung gibt es keine
Korrekturbestätigung. Mehrdeutige Korrekturen fragen mit
Datei-/Blattnamen und Version, ohne interne IDs, nach dem Datensatz. Titel stammen
aus dem Quelldateinamen. Eine Blattwahl gilt für das
jeweilige Gespräch; explizite Blattnennung bzw. Vergleich können andere Blätter
wieder berücksichtigen. Wiederhergestellte Kontrollzeilen sind regulär abfragbare
Daten, die Korrektur bleibt im Audit nachvollziehbar. Der normale Löschpfad
für Chat-Datensätze wird dadurch nicht auf Aktendatensätze erweitert; deren
Quelle wird weiterhin über die Projektakte entfernt. Keine neue Umgebungsvariable.

Der Workbench-Gesprächszustand hält Tabellenbezug, offene Datensatzauswahl und das
zuletzt verwendete Einzelobjekt getrennt vom austauschbaren Retrieval-Verlauf.
Eine eindeutige Blattantwort auf eine offene Auswahl wird anhand der gespeicherten
Kandidaten zugeordnet. Nackte Korrekturen bleiben beim zuletzt genannten Objekt;
eine neue Aussage hat weiterhin Vorrang vor einem früheren Datensatz.
Varianten werden nach der Quellenauswahl mit festen IDs abgefragt und gemeinsam
verglichen, ohne einen zweiten Selektor. Auch bei Zählplänen löst eine im Vergleich
veröffentlichte Datensumme die relevante Einheitenrückfrage aus.

Das generierte Praxis-Szenario „Export mit Summenzeilen und Variantenblatt“ enthält
zwei Blätter, drei Kontrollzeilen, eine echte Datenzeile ohne Gruppenzuordnung,
einen Vergleich sowie Einheiten- und Blattkorrektur. Der Live-Praxislauf ist ein
separater Release-Nachweis und wird nicht durch die Offline-Prüfungen ersetzt.
