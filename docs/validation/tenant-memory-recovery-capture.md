# Produktionsfix #766: Recovery und Erfassung

Validiert am 11.10.2026 mit ausschließlich synthetischen Akteuren und frischen Ankern.
Der ausführbare Nachweis liegt in `scripts/validate-tenant-memory-live.js`, die unveränderten
Ergebnisse aus dem Skript in `tenant-memory-live.json`.

## Ursachen und Änderungen

- Die Recovery begrenzte lokale Aufrufe auf 1.000 ms, verwendete für Modellprüfungen
  die Verstehen-Optionen und startete jede Sekunde erneut. Sie nutzt jetzt dieselben
  Assessment-Optionen wie der Turn, eine persistierte
  Warteschlange mit Backoff, Versuchsgrenze und begrenzter Batch-Größe. Standardintervall:
  30 Sekunden. `Retry-After` geht vor; es gibt keinen sofortigen Retry in der Fassade.
- Das Assessment übergab Schema-Einschränkungen, die der echte strukturierte Providerpfad
  zurückwies. Es nutzt nun die bestehende Provider-Schema-Konvertierung; die vollständige
  lokale Validierung bleibt bestehen und verlangt ein Urteil für jeden Kandidaten.
- Die Verstehen-Anweisung konnte örtliche Planungen als Einzelfall ausschließen. Zusätzlich
  paraphrasierte das Modell `basis` und erfand Kategorien als Ankerqualifikatoren. Die
  Anweisung trennt Erfassen von Zustimmung; die vorhandene budgetierte Reparatur korrigiert
  unzureichend belegte Zitate. Nur belegte Namensbestandteile bleiben Qualifikatoren.
- Die bisherige Folgenprüfung übersah gelegentlich mittelbare Abhängigkeiten. Das geschlossene
  Assessment-Schema erfasst zunächst mögliche Folgen, betroffene Nachfolgelösungen und deren
  Verfügbarkeit. Die fachliche Verbindung bleibt Modellarbeit, ohne Domänenregeln im Core.
- Gedächtnisevidenz behält ihre Herkunft, auch wenn der Object-Store-Kollektor den Retrieval-
  Quelltyp überschreibt. Sie wird nicht als externe Regel für Plausibilitätshinweise verwendet.
- Die Info-Zeile hing am Abschluss des Hintergrundjobs. Sie wird nun sofort pro Turn ausgegeben;
  Hintergrund- und Recovery-Ergebnisse haben eigene Zeilen, mit Tenant und sicheren Fehlerdetails.
- Bekannte Gedächtnisanker werden auch in frischen Gesprächen vor dem Datensatzpfad abgefragt.
  Bestehende Datensatzkorrekturen behalten ihren Gesprächsbezug.

## Live-Abnahme

```bash
WORKBENCH_ENV_FILE=/path/to/.env \
WORKBENCH_LLM_TIMEOUT_MS=15000,45000 \
node scripts/validate-tenant-memory-live.js
```

Das konfigurierte echte Modell wird ausschließlich über `src/llm-client.js` angesprochen.
Object-Store und Notice-Dienst sind real und lokal isoliert. Wissensquellen sind leer;
ein absichtlich konkurrierender Datensatz-Stub liefert einen fremden synthetischen Lastgang.
Die Abfrage muss trotzdem beide Gedächtnisquellen aus einem frischen Gespräch zeigen.
Eine Verbindung darf im Turn oder, wenn dessen Wartebudget abläuft, per Notice erscheinen.
`connectionChannel` hält den tatsächlich beobachteten Weg fest. Mehrere belegte Aussagen
pro Person sind zulässig; entscheidend sind beide Quellen.

| Reihenfolge | Läufe | Beide festgehalten | Verbindung genannt | Notice zugestellt | Abfrage mit beiden |
| ----------- | ----: | ------------------ | ------------------ | ----------------- | ------------------ |
| ben → anna  |     2 | ja                 | ja                 | ja                | ja                 |
| anna → ben  |     2 | ja                 | ja                 | ja                | ja                 |

Das Skript prüft außerdem deutsche Datumsdarstellung und Funktionen in Klartext. Ein
synthetischer gespeicherter Prüfauftrag wird einmal durch die echte Recovery erneut geprüft.
Danach beobachtet das Skript 31 Sekunden ohne weitere Recovery-Aktivität. Laufzeit, Versuchszahl,
Prüfstatus und Betriebslogs stehen im JSON-Bericht.

## GitNexus und Regression

Upstream-Impact wurde vor Symboländerungen geprüft. HIGH: `understand` (zwei direkte
Aufrufer, 13 betroffene Symbole, vier Content-Turn-Flows), `source`/`factText` (Quellenanzeige
und Evidenz), sowie die neuen gemeinsamen Konfigurations-/Assessment-Einstiegspunkte.
Der unverändert wiederverwendete Provider-Schema-Helfer hat ebenfalls HIGH-Impact.
Recovery, per-Turn-Logging und der isolierte Live-Validator wurden als LOW eingestuft.
Die genaue Änderungsprüfung erfolgt zusätzlich vor dem Commit und gegen `origin/main`.

Lokale Gates und CI werden in der AC-Tabelle des PR mit Ergebnissen auf dem finalen Head
festgehalten. Externe Integrationstests, die einen laufenden MCP-Server benötigen, werden
separat als solche ausgewiesen; der Live-Modellnachweis oben ersetzt keine MCP-Integration.
