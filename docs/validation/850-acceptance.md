# RC3: verständliche Chatantworten (#850)

Hinweise werden vor der Zustellmarkierung geprüft. Zurückgehaltene interne Prüfhinweise,
englische Systemtexte, UUIDs und technische Bezeichner bleiben unzugestellt; das Audit
vermerkt `notice_withheld` mit `delivered: false`. Die Prüfung ändert weder Sichtrechte
noch Empfängerzuordnung. Fachliche Vorschläge bleiben nutzbar; interne Review-Vorschläge
sind ausdrücklich als solche gekennzeichnet. Signalzustände erhalten deutsche Texte.
Fallbezüge werden aus der bestehenden Fallnummernvergabe als F-Nummern dargestellt.

Funktionslisten erscheinen bei ausdrücklich angefragten Funktionen oder notwendiger
Funktionsauswahl. Die Anzeigenamen stammen aus dem generierten deutschen Katalog;
interne Labels und Schlüssel dienen weiter der Zuordnung. Die Lokalisierung verwendet
wiederverwendbare Begriffübersetzungen und ergänzt keine technischen Suchbegriffe.

Messwertantworten behalten eine Herkunftszeile. Spitzenwert und Zeitpunkt erscheinen
nur einmal, auch bei Folgefragen und erneuter Übermittlung derselben Datei. Der
Abfrageblock wird bei ausdrücklich angefragtem Rechenweg oder Details angezeigt.
Allgemeine angehängte Empfehlungen werden satzweise entfernt; die fachliche Antwort
und ausdrücklich angefragte konkrete Schritte bleiben erhalten.

Quellenfehler erklären fehlende Angaben oder eine ausbleibende Antwort in Fachsprache.
Technische Feldnamen und Wiederholungsanweisungen werden nicht als Antwort übernommen.
Entwürfe erhalten den gespeicherten Anzeigenamen des Mappings; unbekannte Einzelangaben
erscheinen einheitlich als `[… Deutsche Bezeichnung]`. Der Anzeigename wird bei der
Mapping-Provisionierung über `displayName` bzw. `--display-name` gespeichert und verleiht
keine zusätzlichen Rechte. Transportidentitäten ersetzen den Anzeigenamen nicht.

| Abnahmekriterium                                                           | umgesetzt in                                                                                                     | Test                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Anforderung 1: verständliche Hinweise, Filter, kein Verbrauch, Audit       | `shared-service-agent.service.js`, `shared-service-notices.js`, `shared-service-notices.service.js`              | `workbench-850.test.js`: Szenario 1; bestehende Hinweise-/RC3-Tests                      |
| Anforderung 2: bedarfsgerechte deutsche Funktionsvorschläge                | `workbench-content-turn.js`, `capability-clarification.js`, Funktionskatalog-Generator und Übersetzungsvokabular | Szenarien 2–3 im tatsächlichen Chat; `capability-clarification.test.js`                  |
| Anforderung 3: keine Messwertdopplung, Herkunft bleibt, Details auf Wunsch | `workbench-understanding.js`, `dataset-query.js`, `dataset-routing.js`, `workbench-content-turn.js`              | Szenarien 4–5; `dataset.service.test.js`                                                 |
| Anforderung 4: keine unverlangten Füll-Empfehlungen                        | `workbench-answer-filter.js`, `workbench-chat-presentation.js`, `structured-message.js`                          | Szenario 4 und eigener Empfehlungstest; #813/#838/#846                                   |
| Anforderung 5: Quellenfehler fachlich                                      | `workbench-tool-answer.js`, `workbench-understanding.js`                                                         | Szenario 6, Feldfehler und Timeout; Capability-Regressionen                              |
| Anforderung 6: bekannte Signatur, einheitliche unbekannte Platzhalter      | `workbench-store.js`, `workbench.service.js`, `workbench-provisioning.js`, `workbench-chat-presentation.js`      | Szenario 7 über gemappten Chat und Entwurfsrenderer                                      |
| Szenario 1: interner Review plus echte Wechselwirkung                      | Hinweisfilter vor Zustellung; Audit ohne Zustellbeleg                                                            | echter Hinweisbroker, persistierte Warteschlange, Verlauf und Audit, Wiederholungsaufruf |
| Szenario 2: Protokoll zusammenfassen                                       | bedarfsgerechte Funktionsliste                                                                                   | Inhalts-Chat ohne optionale Liste; Live-Abnahme ergänzt                                  |
| Szenario 3: passende Funktionen ausdrücklich abfragen                      | deutsche generierte Anzeigenamen                                                                                 | Inhalts-Chat mit deutscher auswählbarer Liste; Kataloglokalisierung                      |
| Szenario 4: Spitzenlast im Text- und Dateikanal                            | kanonische Datensatzantwort und Herkunft                                                                         | beide Kanäle einschließlich Folgeturn; Live-Abnahme ergänzt                              |
| Szenario 5: Rechenweg zeigen                                               | explizite Detailanforderung mit bestehendem Datensatzbezug                                                       | Folgeturn zeigt Abfrageblock und Herkunft                                                |
| Szenario 6: MaStR-Feld fehlt oder Timeout                                  | Fachmeldung statt technischer Feldanweisung                                                                      | beide Fehlerarten, zentrale Antwortpipeline                                              |
| Szenario 7: Antwort als ben fertigstellen                                  | gespeicherter Mapping-Anzeigename, Entwurfssignatur                                                              | tatsächlicher gemappter Chat und Entwurf; Live-Abnahme ergänzt                           |

Alle neuen inhaltlichen Fixtures werden durch `scripts/generate-conversation-fixtures.js`
erzeugt. Lastgang und Dateikanal verwenden `scripts/generate-dataset-fixtures.js`.
Die Abnahmetests benötigen keine echten Namen, E-Mail-Adressen oder Unternehmen.

## Lokale Prüfungen

Die Entwicklungsumgebung muss Testmodus verwenden, damit ausschließlich synthetische
Testschlüssel und die Test-Stubs aktiv sind:

```bash
NODE_ENV=test npm test -- --runInBand --forceExit
NODE_ENV=test npm run release:check
npm run lint
npx prettier --check '**/*.js'
npm run build
node scripts/generate-conversation-fixtures.js --check
node scripts/generate-dataset-fixtures.js --check
npm run check:function-model
```

Es gibt keinen Typecheck-Befehl in diesem CommonJS-Projekt. Die Python-Abhängigkeiten
für die vorhandenen Prognosetests werden gemäß CI in `.venv-forecast` installiert.

## Live-Abnahme starten (hier nicht ausgeführt)

Die bestehenden Skripte wurden erweitert: `validate-rc3-closeout-live.js` prüft #850
Szenarien 1, 2, 4 und 7; `validate-workbench-813-live.js` ergänzt 2 und 7. Beide nutzen
lokale isolierte Broker, temporäre Datenbanken, synthetische Quellen und die zentrale
Sprachschnittstelle. Szene 1 kombiniert einen synthetischen internen Review-Vorschlag
mit der tatsächlich erzeugten Wechselwirkungsmeldung und prüft Audit sowie Warteschlange.
Der Dateikanal nutzt die tatsächliche Extraktion eines generierten CSV-Anhangs.

Ausschließlich eine gesonderte Testkonfiguration verwenden, keine Produktionskonfiguration
oder Produktionsendpunkte. Die Skripte senden keine E-Mails und führen kein Deployment aus.
Das vorhandene Budget beendet die Abnahme bei Aufruf- oder Kontingentgrenzen.

```bash
WORKBENCH_ENV_FILE=/absoluter/pfad/zur/test.env \
  LIVE_MAX_MODEL_CALLS=120 LIVE_MAX_TOKENS=1000000 \
  node scripts/validate-rc3-closeout-live.js

WORKBENCH_ENV_FILE=/absoluter/pfad/zur/test.env \
  LIVE_MAX_MODEL_CALLS=120 LIVE_MAX_TOKENS=1000000 \
  node scripts/validate-workbench-813-live.js
```

Die Ergebnisse werden unter `docs/validation` geschrieben; fehlgeschlagene Prüfungen
führen zu einem Fehlerstatus. Diese Live-Skripte wurden für #850 nur syntaktisch geprüft.
