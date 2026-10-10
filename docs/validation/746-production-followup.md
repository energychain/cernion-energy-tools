# Workbench: Nacharbeit nach Produktionstest am 2026-10-07

Die Quellenwahl im Workbench verlangte für die allgemeine Willi-Artikelsuche ein
zusätzliches Personen-Mapping, obwohl der Facade-Pfad diese allgemeine Suche
bereits ohne Mapping aufrufen konnte. Die Zuordnung wird jetzt nur für
mandantenbezogene föderierte Quellen verlangt. Die vom Router ermittelte
primaryDomain ergänzt die Lagebild-Hypothesen. Explizite Facade-Lagebilder haben
Vorrang vor Text-Taxonomie-Hinweisen; ein EDIFACT-Schlüsselwort ist keine
Voraussetzung. Die bestehende Service-/Gateway-Autorisierung bleibt erhalten.

Willi-Abfragen verwenden Anliegen und retrievalTerms, höchstens 200 Zeichen.
WORKBENCH_RETRIEVAL_TIMEOUT_MS begrenzt die Runde auf 12000 ms (Default).
Quellenbudgets im Katalog: 4000 ms, für Willi und föderierte Suche 10000 ms.
Jede Quelle startet unabhängig; eine hängende Quelle verliert nicht die Treffer
anderer Quellen. Der Quellensammler endet knapp vor dem geerbten Moleculer-Timeout,
damit timeout/ms-Diagnostik noch zurückgegeben werden kann. Simulierte 7-s-Willi-
Antwort wird angenommen; eine schnelle Quelle endet vorher. Ein hängender
Collector endet am Gesamtbudget. knowledge-rag beginnt parallel zum Verstehen;
Treffer werden anschließend gegen das aktualisierte Lagebild geprüft.

Relevanzregeln gelten für alle Quellen. Für Planer-Evidenz verlangt der Katalog
zusätzlich Standort-Identifikatoren und deren Werte im Treffer; ein bloßes
Domänen-Tag ersetzt diese Prüfung nicht. Die Quellenzeile verwendet tatsächlich
referenzierte Claims. Datumswerte bleiben Datumswerte; Telefon/E-Mail/IBAN und
Referenzmasken werden nur lokal rückübersetzt. Unbekannte Masken werden neutral
ersetzt. Die Reidentifikationsmap verlässt den Prozess nicht.

Ohne WORKBENCH_LLM_THINKING gilt minimal nur für Verstehen, Provider-Standard
für Antworten. Bei Folgeturns gilt WORKBENCH_LLM_THINKING_FOLLOWUP=low; default
wählt den Standard. Gemini wiederholt einen 400-thinking-Fehler einmal ohne
thinkingConfig. Text/Structured/Chat bleiben im zentralen LLM-Pfad; unrelated
400s und ein zweiter thinking-Fehler werden nicht zusätzlich wiederholt.
Fehlerlogs enthalten Klasse, Status und feste sichere Diagnose, keine
Provider-Echos oder Dokumentteile.

Bedingte Entwürfe verwenden condition im Claim-Schema. Gleich bedingte Absätze
werden zusammengefasst; höchstens zwei Varianten, gemeinsame Anrede/Grußformel
werden je Variante ergänzt. Die Voraussetzung steht außerhalb des fertigen
Textes. Sie ist keine Bestätigung eines tatsächlich unbekannten Status.
Der Versand-Hinweis wird nur durch eine ausdrückliche äußere Versandbitte
ausgelöst, nicht allein durch den Modell-Flag oder einen Entwurfswunsch.

## Echter Kollegen-Test

Nur src/llm-client.js; Gemini mit folgendem Produktions-Paar:

```dotenv
WORKBENCH_LLM_MODEL=gemini-3.5-flash-lite,gemini-flash-latest
WORKBENCH_LLM_TIMEOUT_MS=15000,45000
WORKBENCH_LLM_THINKING=minimal,default
WORKBENCH_LLM_THINKING_FOLLOWUP=low
WORKBENCH_RETRIEVAL_TIMEOUT_MS=12000
```

Anonymisierter Lieferantenbrief zu einer Netzanmeldung zum Lieferbeginn,
DAR/Marktlokation/Datum 05.10.2026, gefolgt von der Eingangsbestätigung und
„Mach mir die Antwort fertig“. Dies ist eine rekonstruierte anonymisierte
Polarstern-Situation, nicht der vollständige Originalbrief. Willi und weitere
Quellen sind dokumentierte lokale Stubs mit Inhalt; kein Zugriff auf
Produktions-Willi und keine echte Retrieval-Latenzmessung. Die 7-s-Grenze wird
separat im Budget-Test simuliert.

| Lauf | Turn | gesamt ms | understand ms | retrieve ms | answer ms |
|---|---|---:|---:|---:|---:|
| Zwischenstand | 1 | 24129 | 2764 | 6 | 21258 |
| Zwischenstand | 2 | 11096 | 2376 | 6 | 8671 |
| Zwischenstand | 3 | 5298 | 0 | 1 | 5249 |
| Gemessener Modell-/Budgetstand | 1 | 24130 | 2406 | 7 | 21585 |
| Gemessener Modell-/Budgetstand | 2 | 6759 | 2628 | 4 | 4069 |
| Gemessener Modell-/Budgetstand | 3 | 4106 | 0 | 1 | 4052 |

Beide final gemessenen Folgeturns <12 s. Erstturn 24,1 s; kein Leistungsversprechen.
Willi in allen Turns available; analysis-planner skipped ohne passende
Standort-Planungsaufgabe. Datum nicht maskiert. Fachliche Erwartung: Prozessantwort
zum Lieferbeginn, nicht baulicher Netzanschluss. Alle Antworten bestanden die
Schema-Validierung. Folgeturn-Evidenz ist auf vier kurze Treffer reduziert;
letzte Antwort auf 600 Zeichen. Vollverlauf wird nicht erneut mitgegeben.
Rohtexte und Phasen-/Quellenmetadaten in den beiden JSON-Berichten.

Rubrik 1–5 (final): verstanden 5; nützlich 4; Ton 4; Entwurf brauchbar 4;
ehrlich bei Unsicherheit 3. Die Bedingungen sind klar; der Erstentwurf enthält
unter einer bedingten Variante dennoch „wurde bzw. wird“ zur Übermittlung.
Das ist ein offener Qualitätsrand des Modells und muss vor Verwendung angepasst
werden. Die technische Handlungssperre verhindert eigenständigen Versand.

## Validierung und Risiko

904 Tests aus 21 Suites (Workbench, Scrubber, zentrale LLM-Fassade,
Willi-Facade, Gateway/RBAC/HITL) bestanden; danach gezielte Wiederholung der
geänderten Pfade und 16 Nacharbeitstests. Harness: 86 Tests in 33,13 s (<60 s).
HTTP-e2e: 21,38 s; Disclaimer-Wächter im Korpus und Quellen-/Masken-/Versand-
Tests grün. lint: 0 Fehler, eine bestehende Warnung. check:llm und
check:domain-free-core, git diff --check geprüft. TDD-Matrix-Hardgate 66/66
(100%); audit:openapi ohne Fehler (474 bestehende Warnungen). Keine generierte Datei
von Hand bearbeitet. Der generische Darstellungsbegriff „Variante“ ist im
Domänenfrei-Wächter begründet freigegeben; Standort-Auswahlbegriffe liegen im
Quellenkatalog, nicht in einer neuen Kern-Regex.

GitNexus: Scrubber CRITICAL (7 direkte Aufrufer, 9 Prozessgruppen); Quellenwahl,
Relevanzfilter, Phasenoptionen und lokale Identifier-Kontexte HIGH. Adapter und
Collector-Körper LOW laut statischem Graphen; dynamische zentrale Provider-
Aufrufe sind in diesem Graphen nur teilweise sichtbar. Regressionen wurden
gezielt geprüft. Höhere Retrieval-Budgets können Requests länger binden.
Öffentliche Willi-Artikelsuche nun ohne zusätzliche Personen-Zuordnung;
mandantenbezogene Federation bleibt geschützt. Masken-Rückübersetzung erfolgt
nur im lokalen Workbench-Kontext, nicht pauschal für andere Facade-Aufrufer.

Abschluss-detect_changes: 23 Dateien, 69 Symbole, 21 Abläufe, CRITICAL.
Betroffen sind die erwarteten Workbench-/Facade-/LLM- und Quellensammler-Pfade;
der gemeinsame Scrubber erreicht weitere Dienste. Diese Einstufung ist höher
als die isolierte LOW-Einstufung der Retrieval-Budgetkorrektur.
