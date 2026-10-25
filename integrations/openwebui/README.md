# Projektakte in Open WebUI 0.12.0 (#890)

Die versionierte Function liegt in [`functions/cet_project_bundle.py`](functions/cet_project_bundle.py).
Sie wird als **Filter** vor der Dateiverarbeitung ausgeführt. Eine Pipe wäre ein eigener
Modellpfad; Action und Tool bieten hier keinen verlässlichen Eingriff vor dem Textkontext.
`file_handler` wird bewusst nicht gesetzt: Es würde auch kleine Einzeldateien global
aus der Standardverarbeitung entfernen. Der Filter entfernt nur die IDs seines Bündels
sowohl aus `body.files` als auch aus `body.metadata.files`.

## Installation

1. Den CET-Stand dieses Branches starten; die OWUI-Modellverbindung für den Test auf
   diese CET-Instanz (`/v1`, Modell `cernion-governance-assistant`) einstellen.
2. Unter Administration → Functions den Python-Inhalt importieren/einfügen und als
   `cet_project_bundle` speichern. Aktivieren und global schalten. `MODEL_IDS` begrenzt
   den Filter auf die genannten Modell-IDs.
3. Die administrativen Valves setzen:

| Valve | Bedeutung |
| --- | --- |
| `CET_URL` | Vom OWUI-Backend erreichbare CET-Basisadresse ohne `/v1` |
| `GATEWAY_TOKEN` | Bestehendes #736-Gateway-Token für `open-webui`; nur serverseitig |
| `OPENWEBUI_ORG_ID` | Externe Organisation des Tokens und der CET-Zuordnung |
| `MODEL_IDS` | Kommagetrennte, exakt übereinstimmende Modell-IDs |
| `MAX_BYTES` | Original-Dateigrenze, höchstens 2 GiB; CET prüft zusätzlich seine Quoten |
| `TIMEOUT_SECONDS` | HTTP-Zeitlimit und begrenztes Warten auf eine Ratenlimit-Erholung |
| `POLL_SECONDS`, `WAIT_SECONDS` | Statusintervall und Wartebudget für Struktur/Manifest |
| `priority` | Standard `-20`, vor dem optionalen bisherigen Original-Dateikanal |

4. Organisation und Personen über die vorhandenen lokalen Provisionierungswerkzeuge
   aus #736 zuordnen. Jede Person benötigt eigene CET-Rollen und Freigaben. Ein
   OWUI-Adminstatus gewährt über diese Function weder fremde Originale noch CET-Rechte.
   Es gibt keine User-Valve für Token, Serveradresse oder Identitätsauswahl.
5. Für dauerhafte Wiederaufnahme `data/project-bundle` zusammen mit den bestehenden
   Akten-, Object-Store- und Upload-Daten persistent halten. Alle zusammen sichern.

Die bisherigen Dateien unter [`../open-webui`](../open-webui) bleiben gültig.
Falls dessen Dateikanal zusätzlich aktiv ist, läuft dieser erst nach dem neuen Filter.
Kleine Einzeldateien ohne Aktenauftrag durchlaufen weiterhin den bisherigen Modus.

## Ablauf und Grenzen

`__user__.id` stammt aus der angemeldeten OWUI-Sitzung. Nur
`Files.get_file_by_id_and_user_id` liefert einen Originalpfad. Pfade und Größen aus
Chat-Anhängen werden ignoriert. `Storage.get_file(record.path)` unterstützt den lokalen
`UPLOAD_DIR` ebenso wie die in OWUI konfigurierten Storage-Provider. Die Function öffnet
keine eigene Storage-Konfiguration und vertraut OWUIs möglicherweise textbasiertem
`File.hash` nicht als Originalhash. SHA-256 wird über die tatsächlich gelesenen Bytes
gebildet; pro Chunk wird erneut gehasht. Speicherbedarf pro Übertragung: ein Chunk.

Die Function übermittelt Dateimetadaten und die äußere Bitte an
`POST /v1/project-bundle/prepare`. CET lässt den Aktenauftrag strukturiert erkennen
(`create`, `append`, `accept`, `decline`, `none`, jeweils mit wörtlicher Belegstelle),
ausschließlich über `src/llm-client.js`. Dateiinhalt wird dieser Erkennung nicht
übergeben. Die allgemeine Turn-Klassifikation entscheidet nicht über die Ablage.
Ohne ausdrücklichen Wunsch fragt CET bei mehreren Dateien oder einer Datei über
10 MiB einmal pro Gespräch: „Soll ich das als Projektakte anlegen?“ Eine Zustimmung
kann ohne erneutes Anhängen erfolgen; CET hält nur Metadaten/OWUI-IDs vor. Bei Ablehnung
wird keine Akte angelegt. Beim nächsten gewöhnlichen Turn bleibt der Standardpfad aktiv.

`start`, binäre `PUT uploads/:uploadId/chunks/:index?hash=…`, `complete` und `status`
unter `/v1/project-bundle` delegieren nach erneuter #736-Personenzuordnung an die
unveränderten `project-upload`-Aktionen. Die feste Transport-Routenliste eröffnet
keinen allgemeinen Zugriff auf `/api` oder MCP. Tokens erhalten keine Rollen.
`project-file`-Mitgliedschaft, Tenant und Clearance werden in CET weiterhin geprüft;
Upload-ID und Gespräch müssen zusätzlich zur selben zugeordneten Person gehören.

Beim erneuten Senden werden dasselbe Projekt und derselbe Upload verwendet;
`missing` bestimmt, welche Chunks noch fehlen. Das gilt innerhalb der CET-Aufbewahrung
(standardmäßig 24 Stunden für unvollständige Uploads). Bestätigte Chunks überleben
OWUI-/CET-Neustarts. Veränderte Originale erhalten bei `start` eine andere Hashidentität.
Unbekannte Typen bleiben als Original erhalten und erscheinen als nicht verarbeitet.
Abgewiesene Archive, Grenzen und Verbindungsabbrüche erhalten verständliche Meldungen.
Fehler stoppen den Turn, sodass kein stiller Text-Fallback stattfindet.

Fortschritt erscheint über `__event_emitter__` als `status` mit `description` und
`done`. Die Function pollt den bestehenden Upload-/Objektstand, bis die Verarbeitung
und das Manifest vorliegen oder das Wartebudget endet. Bei einem Zeitlimit wird der
fehlende Manifeststand ausdrücklich benannt; erneutes Senden zeigt den weiteren Stand.
`GET /v1/project-bundle/result` liefert die Zusammenfassung aus dem sichtbaren Manifest,
Fragetypen und Objekten. Die OpenAI-Fassade übernimmt sie ohne zusätzlichen Antwort-LLM
als Chatabschluss. Die originale `chat_id` wird über `cet_client_context.conversationId`
transportiert: OWUI entfernt sein internes `metadata` vor der OpenAI-Weiterleitung.
Anlegen und Ergänzen binden die Akte über `projectRefs` an genau dieses Gespräch.

Doppelweg-Schutz: Zunächst entfallen die Akten-Datei-IDs vor OWUIs RAG-Extraktion.
Zusätzlich bindet CET den Hash des extrahierten Texts (äußere Leerzeichen entfernt)
an den SHA-256 des Originals und dessen Upload-ID. Die Dokumentvorbereitung entfernt
passenden `<context>/<source>`-Text nur nach Sichtbarkeitsprüfung und erfolgreichem
Originalempfang. Gleiche Dateinamen allein reichen niemals. Ohne extrahierten Text
(z. B. OWUI-Upload mit `process=false`) greift der Filter-Schutz; es wird kein
Text-Hash erfunden. Die Aktenlöschung entfernt auch zugehörige Gesprächsbelege des
Transports über den vorhandenen bestätigten Cleanup-Vertrag.

## E2E für die aufrufende Session

Standardmäßig führt das Skript **keine Netzwerkaufrufe** aus:

```bash
python3 scripts/e2e-openwebui-project-bundle.py --dry-run
```

Für den späteren ausdrücklich gestarteten Lauf sind `OWUI_URL`, `OWUI_USER`,
`OWUI_PASS`, `CET_URL`, `CET_TOKEN`, `CET_GATEWAY_TOKEN`, `OWUI_ORG_ID` erforderlich.
`OWUI_USER` ist für die Function-Installation ein OWUI-Admin, dessen CET-Zuordnung
trotzdem normale Personenrechte nutzt. `CET_TOKEN` ist ein separater normaler
API-/Session-Token **derselben CET-Person und desselben Tenants**, mit den regulär
benötigten Lese- und Löschrechten für Assertions und Aufräumen. Keine Zugangswerte
in Dateien oder Kommandoargumente schreiben.

Optionen: `OWUI_MODEL`, `OWUI_FUNCTION_ID`, `E2E_PROXY_BIND` (Standard `127.0.0.1`), `E2E_PROXY_PORT`,
`E2E_PROXY_PUBLIC_URL`, `E2E_RESUME_BYTES`. Der temporäre Proxy muss aus dem
OWUI-Container erreichbar sein. Beim geprüften Host-Network-Betrieb auf demselben
Host funktioniert die lokale Standardadresse; bei Remote-Ausführung ist eine
explizite erreichbare Adresse/Portkombination nötig. `E2E_RESUME_BYTES` muss größer
als CETs Chunkgröße sein (Standard 9 MiB bei 8-MiB-Chunks). Der Proxy verwirft einmal
den zweiten Chunk; anschließend muss erneutes Senden nur fehlende Chunks übertragen.

```bash
python3 scripts/e2e-openwebui-project-bundle.py --live
```

Das Skript installiert eine temporäre Function (oder aktualisiert eine ausdrücklich
benannte und stellt sie wieder her), lädt CSV/Text/Binärdatei hoch, erzwingt den
Abbruch, sendet erneut, prüft gespeicherte Chatstatus/Abschluss, Originalhash,
CSV-Summe 34 über API **und Chat** sowie fehlende zusätzliche Dokumentevidenz. Im
`finally` löscht es die synthetische Akte, den Chat und OWUI-Dateien und entfernt die
Function bzw. stellt Inhalt, Valves und Aktivierungsflags wieder her. Fehler beim
Aufräumen führen zu einem fehlgeschlagenen Lauf. Es ändert keine Modellverbindung.
Nur ein Bündel-Filter sollte für dieses Modell aktiv sein; einen schon produktiv
aktivierten Filter über `OWUI_FUNCTION_ID` für den isolierten Test wiederverwenden.

Offline: `tests/python/test_project_bundle_e2e.py` führt denselben Treiber gegen
lokale OWUI-/CET-HTTP-Doubles aus; der OWUI-Double führt die echte Function aus.
`tests/project-bundle.http.test.js` prüft separat den echten CET-HTTP-Stream,
Nutzerzuordnung, dauerhafte Wiederaufnahme und SQL-Werte. Kein Live-LLM ist beteiligt.

Die Python-Verträge lassen sich in einer separaten temporären Umgebung ausführen
(`pytest`, `httpx` und `pydantic` erforderlich):

```bash
python -m pytest -q tests/python
```

Die vorhandene `.venv-forecast` wird dafür nicht verändert.

CET unterdrückt identischen Text nur mit zusätzlicher Originalidentität: passender OWUI-Datei-ID (`file_id`/`id`) oder Original-SHA-256 im `hash`-Attribut des `<source>`-Blocks. Reine Zitationsnummern oder identischer Text ohne diese Bindung reichen nicht. Der Filter entfernt Akten-Dateien unabhängig davon bereits vor OWUIs Textaufbau.
