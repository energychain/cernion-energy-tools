# #890 — Open-WebUI-Projektakte: Validierung

Stand: 2026-10-24, Branch `feat/890-owui-bundle`.

## Versionsprüfung und Erweiterungstyp

Nur lesende `docker exec`-Quellcodeinspektion von `openwebui-cernion-workbench`.
`/app/package.json` weist **0.12.0** aus; `open_webui/env.py` liest daraus `VERSION`.
Die Python-Distribution ist dort nicht als `open-webui`-Paket registriert; deshalb
wurde die Version aus dem tatsächlich geladenen Paketquellbaum belegt.
Keine Anmeldung, API-Anfrage, Konfigurationsänderung oder Containeränderung.

| Geprüfter Quellpfad unter `/app/backend/open_webui` | Feststellung |
| --- | --- |
| `utils/plugin.py` | Loader unterstützt `Pipe`, `Filter`, `Action` (außerdem `Event`); globale administrative Valves werden geladen. |
| `utils/filter.py` | Signaturbasierte Injection u. a. von Nutzer, Metadata, Chat-ID und Event-Emitter; `file_handler` würde alle Dateien des Turns unterdrücken. |
| `utils/middleware.py` | Inlet vor `chat_completion_files_handler`; Dateien werden aus `metadata.files` für RAG/Volltext verarbeitet. Native `attached_files` enthalten Dateireferenzen. |
| `functions.py` | Pipe erhält `__files__` aus `metadata.files`, außerdem `__user__`, `__metadata__`, `__chat_id__`, `__event_emitter__`. Filter erhält keine separate `__files__`-Injection und liest die Body-/Metadata-Dateien. |
| `utils/actions.py` | Action-Hook mit Nutzer und Event-Emitter; kein automatischer Eingriff vor der Upload-Textverarbeitung. |
| `routers/files.py`, `models/files.py` | Asynchrone `get_file_by_id_and_user_id`; Dateidatensatz enthält `path`, Eigentümer und optional extrahierten Text. Standard-Dateirouten haben teilweise Admin-Bypass; die neue Function verwendet ausschließlich Eigentümerbindung. |
| `storage/provider.py` | `Storage.get_file` liefert den lokalen Originalpfad für `UPLOAD_DIR` bzw. den konfigurierten Provider/Cache. |
| `routers/retrieval.py` | OWUI bildet den Datei-`hash` beim Textprocessing aus `text_content`; er ist kein verlässlicher Originalbytehash. |
| `routers/openai.py` | Internes `metadata` wird vor der Modellweiterleitung entfernt; eigene Top-Level-Felder bleiben erhalten. |
| `socket/main.py` | `status`-Events mit `description`/`done` werden per Socket geliefert und als `statusHistory` im gespeicherten Chat abgelegt. |
| `routers/functions.py`, `routers/chats.py`, `main.py` | Function-Create/Update/Valves/Toggle/Delete und gespeicherte Chats/Chat-Completions entsprechen dem E2E-Treiber. |

Gewählt: **Filter-Inlet**, ohne globales `file_handler`. Dadurch werden ausschließlich
Akten-Dateien vor dem RAG-/Volltextpfad entfernt, während kleine Einzeldateien ohne
Aktenauftrag im bisherigen #774-Modus bleiben. Eine Pipe würde einen weiteren
Modellpfad schaffen; Action/Tool greifen für diese automatische Uploadbehandlung zu spät.

## Datenfluss, Auth und Schutz

OWUI-Datei-ID → Eigentümerprüfung mit `__user__.id` → `Storage.get_file(record.path)`
→ Original-SHA-256 → CET `prepare` → `start` → binäre Chunks mit SHA-256 → `complete`
→ asynchroner bestehender Akten-Ingest/Struktur/Manifest → Status/Manifestabschluss.
Der Originalhash wird schon vor `prepare` gebildet, damit erneutes Anhängen derselben
Bytes mit neuer OWUI-ID dieselbe Akte und denselben Upload fortsetzen kann.

`/v1/project-bundle` ist eine feste Transport-Routenliste nach dem vorhandenen
Dateikanalmuster. Jeder Aufruf verwendet `workbench.resolveTurnPrincipal` und
`metaForMapping`: Token-Organisation, Tenant-/Personenzuordnung, Rollen, Clearance und
Delegationsaudit aus #736. Der Transportprincipal verleiht keine Rollen. Zusätzlich
sind Upload-IDs an Person und Gespräch gebunden. `/api/project-*` wird für Gateway-Tokens
nicht freigeschaltet. Browserseitige Transport-Selektoren werden vom Filter verworfen
und aus der angemeldeten Sitzung neu gesetzt. Fremde OWUI-Originale sind auch für
OWUI-Admins in dieser Function nicht lesbar.

`chat_id` gelangt über `cet_client_context.conversationId` in die OpenAI-Fassade und
in `projectRefs`, auch beim Ergänzen einer vorhandenen Akte. Aufträge werden unabhängig
von der allgemeinen Turn-Klassifikation als strukturiertes Intent mit wörtlicher
Belegstelle erkannt. Nur die äußere Bitte wird klassifiziert; `<context>/<source>`
und native Dateireferenz-Blöcke autorisieren keine Mutation. Opaque Referenzwerte
werden über die bestehende reversible Prompt-Kontext-Hilfe erhalten. Keine Änderung
am Prompt-Scrubber oder an den Schutzpfaden #954/#874, Rollen, Blattwahl und Einheiten.

Zuerst entfernt der Filter die ausgewählten Datei-IDs aus beiden OWUI-Dateilisten.
CET unterdrückt passenden Text zusätzlich nur anhand eines Text-Hash-Belegs, dessen
Originalhash/Upload-ID aktuell als sichtbar und empfangen bestätigt sind. Gleichnamige,
abweichende Texte, fehlgeschlagene/unvollständige Originale und falsche Originalhashes
werden nicht dadurch ausgeblendet. Kein Tenant-Hash. Die bestätigte Aktenlöschung
bereinigt Transportreferenzen über `project-bundle.deleteProject`.

## Tests und AC-Status

| AC | Offline-Nachweis | Echter OWUI-Instanzlauf |
| --- | --- | --- |
| AC-01 | Echter CET-HTTP-Binärpfad, mehrere Originale, Strukturierung und SQL-Summe `11 + 23 = 34`; derselbe E2E-Treiber prüft API und Chat gegen lokale Doubles. | Aufrufende Session: Tabellenfrage gegen OWUI/CET-Branchstand ausführen. |
| AC-02 | Echter HTTP-Verbindungsabbruch mitten im zweiten Chunk; bestätigter erster Chunk bleibt erhalten; neue OWUI-ID derselben Bytes verwendet dieselbe Upload-ID und nur `missing=[1]`. E2E-Unterbrechungsproxy zusätzlich offline geprüft. | Aufrufende Session. |
| AC-03 | Python-Status-Events/Abschluss, Manifest-Fragetypen und benannte nicht unterstützte Objekte; echte CET-Archivablehnung mit benanntem Objekt und verständlichem Hinweis. | Gespeicherte `statusHistory`/Abschluss auf der Testinstanz prüfen. |
| AC-04 | Filter entfernt dieselben Datei-IDs vor Textaufbau; CET-Text-/Original-Hashbindung mit Negativfällen. Lokaler E2E-Mock führt die echte Function aus und prüft leere OWUI-Dateilisten. | E2E prüft zusätzliche Dokumentevidenz im zugeordneten Vorgang. |
| AC-05 | E2E-Treiber gegen lokale OWUI-/CET-HTTP-Doubles grün, einschließlich Abbruch und vollständigem Cleanup. | Bewusst offen: kein Testinstanzlauf und kein Live-LLM in dieser Session. |

- Breite Regression: **42 Suites / 478 Tests grün**; Projektakte, Dateikanal,
  OpenAI-Fassade, Dokumentpfade, Tenant-Evidenz, alle drei Praxis-Replays und
  `workbench-table-quality-live-regression` (mit LLM-Doubles). Keine separaten
  `tests/openwebui*.test.js` vorhanden; die OWUI-Verträge liegen im Dateikanal-/Python-Test.
- Finale berührte Tests nach weiteren Ergänzungen: **3 Suites / 56 Tests grün** (einschließlich vollständiger Parser-/Dokument-Review-Regression).
- Taxonomie-/Manifest-Regression nach der Tag-Ergänzung: **2 Suites / 36 Tests grün**.
- Isoliertes pytest unter `/tmp/890-owui-venv`, ohne Änderung an `.venv-forecast`:
  **14 Tests grün**, einschließlich des lokalen HTTP-E2E-Treibers.
- Shared-Service-CI und Shared-Service-E2E grün; Lint/Build, Praxis-Fixtures,
  Domänenfreiheit und Domänenäquivalenz grün.
- TDD-Matrix: 82 Tests grün, vier bestehende Tests übersprungen;
  Hard Gate für die 66 aktiven `T-*`-IDs: **100 %**. Die bestehende separate
  Blackbox-`MT-*`-Abdeckung bleibt ausdrücklich außerhalb dieses Gates.
- OpenAPI-Audit: **0 Issues**, 480 bestehende Warnungen. Export enthält sechs neue,
  eng begrenzte Transportoperationen; keine neue fachliche Capability.
- `export:openapi`, `generate:operation-capability-index`, `generate:function-model`,
  `generate:signal-catalog` neu erzeugt; `generate:llm` zuletzt nach CHANGELOG/Dokumentation.
  Das Function-Model wurde nach den letzten Codeergänzungen nochmals regeneriert. Die sechs neuen Transportrouten wurden außerdem der vorhandenen Plattform-Taxonomie zugeordnet, damit `llm.txt` vollständig bleibt.
- Finale Artefaktchecks (`check:function-model`, `check:signal-catalog`,
  `check:operation-capability-index`, `check:llm`), Lint und `git diff --check`: grün.
  GitNexus-Änderungsanalyse und ergänzende Aufruf-/Diff-Prüfung durchgeführt.

Nicht ausgeführt: `npm run test:unit:ci`, echte Instanz-E2E, Live-LLM, Git-Push,
schreibende `gh`-Operationen, Containeränderungen oder Auslesen von Credentials/`.env`.

## Blast Radius

GitNexus vor Bearbeitung: `runOpenAiFacadeAction` LOW, drei direkte Aufrufer;
`normalizeMessages` LOW, zwei direkte Aufrufer; API-Datei MEDIUM, sieben direkte
Abhängigkeiten. Statischer OpenAPI-Pfadaufbau LOW, ein direkter Aufrufer und drei
transitive Abhängigkeiten. Neuere Projekt-/Dateikanalsymbole fehlen teilweise im Index;
für sie wurde die Aufrufsuche mit `grep -rn`/`rg` ergänzt. Kein HIGH-/CRITICAL-Ergebnis.

`detect_changes(scope=all, worktree=…)` meldete für die indexierten Änderungen
MEDIUM, drei erfasste Symbole und vier betroffene OpenAI-Fassadenpfade. Die Änderungen
sind auf Bündeltransport, Fassaden-/Gateway-Einbindung, Dokument-Deduplizierung,
Export, die Zuordnung des neuen Transport-Tags zur bestehenden Plattform-Taxonomie, Tests und Dokumentation begrenzt. Der Index deckt neue Dateien noch nicht ab;
die staged Diff-Prüfung ergänzt ihn. Der zusätzliche Vergleich gegen `main` lief nach 300 Sekunden in einen MCP-Timeout;
anschließend war der GitNexus-Transport vorübergehend nicht erreichbar. Die finale staged Analyse war nach Wiederherstellung erfolgreich: **MEDIUM**, 31 Dateien, vier erfasste Symbole und dieselben vier Fassadenpfade. Lokales `main` ist eine
ältere Basis (518 abweichende Dateien einschließlich bereits vorhandener Arbeiten).
`HEAD` vor diesem Task und `origin/main` stimmen dagegen bei `dac72cab` überein.
Für den Commit werden deshalb die begrenzte staged Diff-Prüfung und der direkte
Vergleich zur tatsächlichen Arbeitsbasis ergänzt. Der neue Taxonomie-Eintrag betrifft
nur das neue Tag `Project bundle transport`; bestehende Tags bleiben unverändert.

## Für den späteren Instanzlauf

Die aufrufende Session richtet die OWUI-Modellverbindung auf CET dieses Branches ein,
provisioniert #736-Organisation/Person und setzt nur zur Laufzeit:
`OWUI_URL`, `OWUI_USER`, `OWUI_PASS`, `CET_URL`, `CET_GATEWAY_TOKEN`, `OWUI_ORG_ID`,
`CET_TOKEN`. Der normale CET-Assertion-/Cleanup-Token gehört zum selben Actor/Tenant
und braucht die regulären Lese-/Löschrechte. Details und optionale Proxy-/Chunkgrößen-
Parameter stehen in [`integrations/openwebui/README.md`](../../integrations/openwebui/README.md).

`python3 scripts/e2e-openwebui-project-bundle.py --dry-run` benötigt keinen Server;
`--live` ist der ausdrücklich gestartete echte Test. Der temporäre Unterbrechungsproxy
muss aus dem OWUI-Backend erreichbar sein. Bei 8-MiB-Chunks genügen standardmäßig 9 MiB
synthetische Binärdaten; bei anderer CET-Chunkgröße `E2E_RESUME_BYTES` anpassen.
Der Treiber prüft außerdem Manifest- und Skills-Erreichbarkeit und räumt eigene
Testartefakte auf bzw. stellt eine benannte bestehende Function wieder her.
Ein neuer Embedding-Cache-Eintrag ist mangels neuer Capability nicht erforderlich.

CET unterdrückt identischen Text nur mit zusätzlicher Originalidentität: passender OWUI-Datei-ID (`file_id`/`id`) oder Original-SHA-256 im `hash`-Attribut des `<source>`-Blocks. Reine Zitationsnummern oder identischer Text ohne diese Bindung reichen nicht. Der Filter entfernt Akten-Dateien unabhängig davon bereits vor OWUIs Textaufbau.
