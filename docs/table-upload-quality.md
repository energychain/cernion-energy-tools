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
verwenden die ausgeführten Aggregationen. Bei unterschiedlichen Einheiten wird
keine numerische Differenz gebildet. Blattweite Zeilenvergleiche beziehen sich auf
die gesamten Blätter. Unterschiedliche Schemas werden nicht still vereinigt.

## Einheiten und Korrekturen

Erst wenn eine veröffentlichte Wert-Aggregation oder ein numerischer Überblick eine
Spalte ohne Einheit benötigt, fragt die Abfrage gezielt nach deren Einheit. Reine
Zeilenanzahlen lösen keine Einheitenfrage aus. `semantic.unitQuestion` speichert die
Frage einmal je Datensatz; bestätigte Einheiten gelten in Folgeturns.

Der vorhandene auditierte Datensatz-Korrekturpfad nimmt semantische Korrekturen,
Blattwahl und die Bestätigung echter Datenzeilen entgegen. Die Klassifikation ist
schema-gebunden und nutzt ausschließlich Metadaten, keine Zeilen oder Zellwerte.
Mehrdeutige Korrekturen fragen nach dem Datensatz. Eine Blattwahl gilt für das
jeweilige Gespräch; explizite Blattnennung bzw. Vergleich können andere Blätter
wieder berücksichtigen. Wiederhergestellte Kontrollzeilen sind regulär abfragbare
Daten, die Korrektur bleibt im Audit nachvollziehbar. Der normale Löschpfad
für Chat-Datensätze wird dadurch nicht auf Aktendatensätze erweitert; deren
Quelle wird weiterhin über die Projektakte entfernt. Keine neue Umgebungsvariable.

Das generierte Praxis-Szenario „Export mit Summenzeilen und Variantenblatt“ enthält
zwei Blätter, drei Kontrollzeilen, eine echte Datenzeile ohne Gruppenzuordnung,
einen Vergleich sowie Einheiten- und Blattkorrektur. Der Live-Praxislauf ist ein
separater Release-Nachweis und wird nicht durch die Offline-Prüfungen ersetzt.
