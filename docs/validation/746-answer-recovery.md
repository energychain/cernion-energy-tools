# #746: Antwortschema, Evidenz und sicherer Rückfall

Basis: `origin/main` / `f211ce28167803eb28bca27d9c837e3887669497` (PR #750).
Branch: `fix/746-answer-schema-recovery`. Draft-PR; nicht mergen.

## Verhalten

Gemini erhält über `src/llm-client.js` / `options.responseSchema` ein natives
Antwortschema. Alle Antwortbereiche und claim-Felder sind im Providerschema
verpflichtend; leere Bereiche werden als leere Arrays ausgegeben. Dadurch lässt
Gemini den proaktiven Entwurf nicht als optionales Feld weg. Das Providerschema
enthält Struktur, Typen, Pflichtfelder und Provenienz-Enums. Längen-/Anzahlgrenzen,
Zusatzfeldverbote und die vollständige Schema-Prüfung bleiben bei AJV. Das volle
Schema mit allen Einschränkungen wurde im echten Lauf mit HTTP 400 abgelehnt;
das kompakte Schema funktionierte. Diese Trennung entspricht der von Google
beschriebenen begrenzten Unterstützung von JSON-Schema und komplexen Schemas:
[Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output).

Ungültiges JSON oder eine ungültige lokale Schema-Prüfung erlauben genau einen
Reparaturversuch. Er verwendet höchstens drei Treffer mit jeweils 240 Zeichen.
Beide Aufrufe teilen sich das konfigurierte Antwortbudget. Providerfehler und
Timeouts erzeugen keine zusätzliche Schema-Reparatur. Fehlerdiagnostik enthält
Fehlerklasse, Providerstatus, Ausgabelänge und Trunkierungsstatus, keine Inhalte.

Die normale Antwort erhält höchstens fünf Treffer, jeweils maximal 500 Zeichen
um das zum Anliegen und den Retrieval-Begriffen passendste Fenster. Auswahl nach
lexikalischer Relevanz, dann Quellenscore. Deduplizierung nach Dokument/Abschnitt
und normalisiertem Gesamttext. Die ursprüngliche Evidenz bleibt im Antwort-Trace.
Ein Rendering-Wächter verwirft übernommene Evidenzabsätze und wiederholte claims;
Quellen erscheinen nur für tatsächlich verwendete evidenceIds einmal am Ende,
als Titel/Kennung. Ein unvollständig gefilterter Entwurf wird ganz verworfen.

Der LLM-freie Rückfall enthält ein kurzes, gescrubbtes Anliegen, bekannte
fachliche Kennungen und den nächsten Schritt aus dem Lagebild. Keine Feldlisten,
E-Mail-Adressen, Rohzitate oder Zusagewörter. Ein vorhandener alter Entwurf wird
im Rückfall nicht übernommen. Der Ersatz ist ausschließlich eine neutrale
Zwischennachricht mit Ergebnisplatzhalter. Der Rückfall behauptet keine
Bestätigung, Zustimmung, Ablehnung oder erfolgte Prüfung.

Variantenbedingungen werden einmal als `Variante A/B – wenn …:` gerendert;
vorangestellte `Variante N`, `Falls`, `wenn` und `nur wenn` werden entfernt.
Ein proaktives Entwurfsflag verdrängt die Antwort auf eine fachliche Folgefrage
nicht. Nur ein ausdrücklicher reiner Entwurfswunsch lässt die Einordnung entfallen.

`phaseTimes.answerMs` misst die Wanduhrzeit inklusive gescheitertem Modellaufruf,
Reparatur und Rendering. `answerAttempts` macht die Anzahl der Aufrufe sichtbar.
No-call-Guards, RBAC, HITL und Außenwirkungsgrenzen wurden nicht geändert.

## Echter Kollegen-Test

Es stand kein Zugriff auf die Produktions-Willi-Evidenz zur Verfügung. Die Mail
ist eine rekonstruierte, anonymisierte Polarstern-ähnliche Anfrage, nicht die
vollständige Originalmail. Das Modell ist echt; sechs Retrieval-Treffer sind
lokale Stubs, davon fünf lange Willi-EBD-Testtexte mit bis zu 1.600 Zeichen und
ein lokaler Prozesshinweis. E_0608/BDEW-Titel dienen nur der Szenario-Zuordnung;
die Testtexte sind synthetisch und keine authentischen BDEW-Zitate. Der Akteur
hat keine Willi-Zuordnung. Der Lauf verwendet den echten Workbench-Broker-Pfad.

Konfiguration:

```dotenv
LLM_PROVIDER=gemini
WORKBENCH_LLM_MODEL=gemini-3.5-flash-lite,gemini-flash-latest
WORKBENCH_LLM_TIMEOUT_MS=15000,45000
WORKBENCH_LLM_THINKING=minimal,default
WORKBENCH_LLM_THINKING_FOLLOWUP=low
WORKBENCH_RETRIEVAL_TIMEOUT_MS=12000
```

Reproduktion nach Bereitstellung des LLM-Schlüssels im Prozess:
`node scripts/validate-workbench-746-recovery-live.js`.

Der erfolgreiche finale Lauf ist vollständig in
[746-answer-recovery-live.json](746-answer-recovery-live.json) enthalten.

| Turn | Gesamt | Verstehen | Retrieval | Antworten | Versuche | Ergebnis |
|---|---:|---:|---:|---:|---:|---|
| 1: eingefügte Mail | 32.253 ms | 2.654 ms | 13 ms | 29.457 ms | 1 | gültiges Schema, fachliche Antwort, zwei vollständige Varianten |
| 2: Bedeutung der Eingangsbestätigung | 9.315 ms | 2.595 ms | 11 ms | 6.654 ms | 1 | fachliche Erklärung und MaKo-Prozessantwort |
| 3: Antwort fertig machen | 4.433 ms | 0 ms | 1 ms | 4.400 ms | 1 | zwei vollständige bedingte Entwürfe |

Kein Schemafehler, Reparaturversuch oder Rückfall im erfolgreichen Lauf.
Keine Maskentokens, rohen Evidenzabsätze oder Standard-Disclaimer. Willi-Mako
liefert fünf Treffer; der Antwortschritt dedupliziert sie. Die Quellenzeile
enthält nur tatsächlich verwendete Quellenkennungen.

Beispiel Turn 1: „Eine Netzanmeldung zum Lieferbeginn bedarf einer fachlichen
Prozessantwort über den Marktkommunikations-Kanal, wobei eine technische
Eingangsbestätigung hierfür unzureichend ist und aus der Lieferantenmail keine
Frist abgeleitet werden darf.“

Beispiel Turn 2: „Das Vorliegen der Eingangsbestätigung bestätigt nur den
technischen Eingang, ersetzt jedoch nicht die erforderliche fachliche
Prozessantwort über den Marktkommunikations-Kanal.“

Beispiel Variantenkopf: „Variante A – wenn die Netzanmeldung nach interner
Prüfung bestätigt werden kann:“.

Manuelle Rubrik, 1 = unbrauchbar / 5 = sehr gut:

| Turn | verstanden? | nützlich? | Ton? | Entwurf brauchbar? | ehrlich bei Unsicherheit? |
|---|---:|---:|---:|---:|---:|
| 1 | 5 | 5 | 4 | 4 | 5 |
| 2 | 5 | 5 | 4 | 4 | 4 |
| 3 | 5 | 4 | 4 | 4 | 4 |

Die Statusvarianten sind ausdrücklich bedingt. Vor Verwendung muss die Person
prüfen, welche Voraussetzung zutrifft. Turn 3 formuliert „baldmöglichst“, obwohl
kein Zeitpunkt belegt ist; diese Formulierung sollte redaktionell geprüft werden.
Die synthetische Evidenz ersetzt keine Validierung aktueller MaKo-Regeln.

Zwei weitere Läufe zeigen Provider-Latenz statt Schemafehler:
[Timeout-Lauf](746-answer-recovery-timeout-live.json) und
[zweiter Timeout-Lauf](746-answer-recovery-timeout-repeat-live.json).
Erstturn-Gesamtdauer 47.897 bzw. 47.764 ms; `answerMs` 45.012 bzw. 45.013 ms.
Die Rückfälle sind neutrale Zwischennachrichten ohne rohe Quellen oder Zusagen.
Folgeturns dieser Läufe: 9.349 / 8.511 und 8.903 / 9.752 ms.
Die erfolgreiche Erstturn-Messung ist daher keine garantierte Latenz. Ein früherer
Entwicklungsstand lieferte 10.182 / 8.175 / 4.452 ms; ein weiterer
16.782 / 7.283 / 16.078 ms. Diese Entwicklungswerte sind keine Messung des finalen
Prompts und werden nicht als Abnahmewerte verwendet.

## Validierung

- Neue Regressionen: JSON-/Schemafehler → genau eine Reparatur; zweiter Fehler →
  neutraler Rückfall; Providerfehler ohne Schema-Reparatur; gemeinsames Zeitbudget;
  gekürzte/deduplizierte Evidenz; Rohtext-/E-Mail-/Zusage-Wächter; Quellenzeile;
  Variantenköpfe; Folgefrage versus Entwurfswunsch; Kürzung an Wortgrenzen.
- Broker-Test: 100 ms fehlgeschlagener Aufruf + 150 ms Reparatur erscheinen
  gemeinsam in `phaseTimes.answerMs`; kein Versandaufruf.
- Breite Regression: 1.053 Tests / 28 Suites grün vor den abschließenden
  Promptpräzisierungen; finale fokussierte Regression: 487 Tests / 4 Suites grün.
- Shared-Service-Harness: 86 Tests grün, 27,24 s (< 60 s).
- HTTP-e2e: grün, 18,05 s; maximale gestubbte Content-Turn-Latenz 328 ms.
- TDD-Matrix: 82 Tests grün, 4 optionale Tests übersprungen;
  Pflicht-Matrix-Gate: 66/66 (100 %).
- Lint: keine Fehler, eine bestehende Warnung in `domain-free-core.test.js`.
- OpenAPI-Audit: 0 Issues, bestehende 474 Warnungen.
- `check:llm`, `check:domain-free-core`, `build`, Generator-Abgleiche und
  `git diff --check`: grün. Vollständiger Unit-CI-Lauf: Ergebnis folgt.
- Generierte Funktionsmodell-/Signal-Katalog-Dateien ausschließlich über
  `generate:function-model` und `generate:signal-catalog`; `generate:llm` lief,
  ohne Änderung an `llm.txt`.

## GitNexus und Risiko

Impact vor Symboländerungen: `answer` LOW (zwei direkte Aufrufer),
Renderer/Rückfall/Fehlerdiagnostik HIGH, Gemini `generateText` und
`generationOptions` CRITICAL (bis zu elf direkte Aufrufer, neun Prozesse).
Der Test-Stub betrifft neun Testpfade. Auch neue Hilfsfunktionen wurden vor
weiteren Änderungen geprüft; der gemeinsame sichere Texthelfer erhielt
CRITICAL. Die Warnungen wurden vor den jeweiligen weiteren Änderungen berichtet.
Native Schema-Optionen sind opt-in; gewöhnliche Adapteraufrufe behalten ihr
Verhalten. Die breiten Sicherheits-/Adapter-/Workbench-Regressionen sichern dies.

Der aktuelle Worktree wurde separat indiziert. Wegen Invalid-UTF8-Problemen des
FTS-Index wurde der abschließende Graph ohne FTS erstellt; Callgraph-Impact und
`detect_changes` funktionieren, Volltextsuche ist dort deaktiviert.
`detect_changes` vor dem Commit: 20 Dateien / 35 Symbole, CRITICAL / 474
Flüsse. Die Zuordnung der Flüsse geht dort auf den Markdown-Bericht zurück.
Ein zusätzlicher Code-Durchlauf ohne Berichte/generierte Dateien zeigt 12 Dateien /
34 Symbole, LOW / 0 indizierte Flüsse. Die Null ist keine Aussage über fehlende
Laufzeitwirkung: die separaten Symbol-Impacts bleiben HIGH/CRITICAL. Manuell
geprüft wurden die Workbench-Aufrufkette, Gemini-Adapter und die abhängigen Tests;
keine Guards, Gateways oder freigebende Service-Aktionen wurden geändert.
Ein Vergleich mit `origin/main` folgt nach dem Commit.

Operatives Risiko: **MEDIUM**. Strengere Filter können eine Modellpassage oder
unvollständige Entwürfe verwerfen. Der Rückfall bleibt handlungsorientiert und
neutral. Die gekürzte Evidenz kann Details auslassen; der Roh-Trace bleibt
verfügbar. Native strukturierte Ausgabe und das starke Antwortmodell zeigen
schwankende Latenz, einschließlich echter 45-s-Timeouts. Keine neuen Tools,
Außenwirkung oder Freigabewege.
