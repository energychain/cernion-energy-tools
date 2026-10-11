# Dateikanal: Prüfung auf Open WebUI v0.11.3

## Reproduzierbarer Test

```bash
# Repository-Root; Python-Contracttests werden auch von npm run test:unit:ci gestartet.
python3 tests/helpers/file-channel-filter-check.py
# Linux mit Docker Engine/Compose, Node.js und Python 3; Ports 30839/38390 müssen frei sein.
python3 integrations/open-webui/file-channel-smoke.py
```

Der zweite Befehl startet ausschließlich einen isolierten Compose-Teststack unter dem
Projektnamen `cet-file-channel-839`, importiert den Filter über die reale Funktionen-API,
speichert Valves, aktiviert ihn global und lädt eine synthetische CSV aus
`scripts/generate-dataset-fixtures.js` hoch. Der Stack verwendet **v0.11.3**, einen Worker,
ein eigenes Datenvolume, Cookie-Authentifizierung und zwei lokale HTTP-Testendpunkte für
CET und den Chat-Provider. Beide Ports sind an Loopback gebunden. Der Linux-Hostnetzmodus
vermeidet Container-zu-Host-Firewall-Abhängigkeiten. Kein bestehender CET-/Open-WebUI-Dienst
wird verwendet. Gateway-Werte und Sitzungsdaten werden nur zur Laufzeit erzeugt und nicht
ausgegeben. Am Ende entfernt das Skript seinen Container und sein Testvolume.

Geprüft werden Schema-Sichtbarkeit aller Valves, interne File-/User-/Storage-Aufrufe,
bytegleiche CSV, E-Mail- und ID-Header bei Upload und Download, `cet_file_refs` bis zum
Provider, keine Originalanhänge/RAG-Kontexte beim Provider, 503 als HTTP-400-Abbruch ohne
Provideraufruf, anderes Modell ohne CET-Upload, Outlet über `/api/chat/completed`, reale
Registrierung und Cookie-Authentifizierung der Downloadroute sowie Ablehnung anonymer,
abgelaufener und organisationsfremder Downloads. Die Open-WebUI-ACL wird zusätzlich mit
Mocks für Eigentümer und fremde Person im Python-Test geprüft.

**Prüfgrenzen:** Der Container-Test verwendet CET-/Provider-Doubles. Er beweist keine
realen CET-E-Mail-Zuordnungen, kryptografischen Ablaufprüfungen oder Fallunterlagen-Erzeugung.
Die reine E-Mail-Zuordnung wird zusätzlich für Upload und signierten Download gegen
den echten lokalen CET-Broker in `tests/file-channel.http.test.js` geprüft. Weitere
CET-Pfade decken `tests/file-channel.http.test.js` und
`tests/file-channel-security.test.js` mit synthetischen Identitäten und einem echten lokalen
CET-Broker ab. Eine durchgehende Browserprüfung mit realem CET (einschließlich sichtbarer
Chat-Fehler, UI-Valve-Eingabe, „Quelle abgerufen“ und Exportlink) ist separat durchzuführen.
Die UI-Fehleranzeige ist hier zusätzlich durch den exakten Upstream-Quellcode belegt.

## Manuelle Abnahme mit realem CET

Nach [Installation](../../docs/file-channel-runbook.md) ausschließlich synthetische
Personen/Tenants provisionieren, `externalOrgId` vergleichen und eine Person **nur per
E-Mail** zuordnen. CSV für den Browser erzeugen:

```bash
node -e "process.stdout.write(require('./scripts/generate-dataset-fixtures').generateDatasetFixture('csv'))" > /tmp/cet-synthetic.csv
```

1. Auf v0.11.3 strikt nach Runbook installieren: alle Valves von Standard auf
   Benutzerdefiniert stellen, speichern, nochmals öffnen und Sichtbarkeit/Werte prüfen.
2. CSV im passenden Chat hochladen, CET-Dateireferenz prüfen und Export als txt erzeugen;
   Download in derselben Browser-Sitzung öffnen. Keine „Quelle abgerufen“-Anzeige erwarten.
3. Global eingeschaltet lassen, anderes Modell wählen; keine Dateiübertragung an CET.
4. In einer isolierten CET-Testinstanz Signierschlüssel entfernen und CET neu starten.
   CSV erneut senden: „CET-Dateikanal: Dateikanal-Schlüssel fehlt“ im Chat, keine Antwort
   vom Provider und kein Textweg. Danach Schlüssel wieder setzen und CET neu starten.
5. `Exportiere Fallunterlagen als txt`: Link beginnt mit `/api/v1/cet-files/`, liefert
   Fallunterlagen und enthält keinen Gateway-Token.
6. Link mit fremd gemappter Tenant-Identität sowie mit abgelaufenem Testticket abrufen:
   verweigert. Keine Tickets oder Identitäten in Screenshots/Logs veröffentlichen.

## Quellcodebelege aus genau dem Tag v0.11.3

Geprüfter Tag-Commit: `2a960a59fe1dbbd35282f0556b3666d81102e781`.
Alle Links gehen auf den Tag, nicht auf `main`.
Lokal erfolgreich ausgeführt: Python-Contracttest und Container-Smoke (11.10.2026).
Image-Digest: `sha256:41daa0cf2561a5d4c8d1ff31ee2a98d93ab4d3ac2605cac69366ff6a3374a933`.

| Annahme | Datei / Zeilen im Upstream-Tag | Konsequenz |
| --- | --- | --- |
| Globale aktive Filter werden unabhängig vom Modell-Preset ausgewählt | [utils/filter.py:58–65](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/filter.py#L58-L65) | Global aktivieren, eigene exakte `MODEL_IDS`-Prüfung in beiden Hooks |
| Hook-Argumente werden per Signatur gefiltert, asynchrone Hooks awaited | [utils/filter.py:146–169](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/filter.py#L146-L169) | `inlet(body, __user__, __request__)`, `outlet(body)` sind kompatibel |
| `inlet` bekommt Benutzer-Dict und echten Request | [utils/middleware.py:2517–2527](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/middleware.py#L2517-L2527) | User-ID/E-Mail aus serverseitiger Identität, Route über `request.app` |
| `inlet`-Exceptions werden weitergereicht | [utils/filter.py:199–205](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/filter.py#L199-L205), [utils/middleware.py:2631–2645](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/middleware.py#L2631-L2645) | Fehler nicht abfangen und den Originalbody zurückgeben |
| Payloadfehler verhindern den Provideraufruf; Chatfehler werden gespeichert/emittiert, direkte API erhält 400 | [main.py:1624–1695](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/main.py#L1624-L1695) | Sichtbarer stabiler CET-Fehler ohne Ersatznachricht/zusätzlichen Status-Emitter |
| Browser übernimmt Chatfehler und rendert dessen Inhalt | [Chat.svelte:1269–1270](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/chat/Chat.svelte#L1269-L1270), [ResponseMessage.svelte:891–894](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/chat/Messages/ResponseMessage.svelte#L891-L894) | Fehlermeldung erscheint im Chat; Browser nicht live automatisiert |
| `Files.get_file_by_id(id, db=None)` ist async | [models/files.py:153–166](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/models/files.py#L153-L166) | Await via `resolved` |
| `Users.get_user_by_id(id, db=None)` ist async | [models/users.py:315–323](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/models/users.py#L315-L323) | Await via `resolved` |
| `Storage.get_file(path)` liefert synchron einen lokalen Pfad; Providerinstance heißt `Storage` | [storage/provider.py:69–72](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/storage/provider.py#L69-L72), [storage/provider.py:330–348](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/storage/provider.py#L330-L348) | Zugriff im Thread, Byte-Limit vor Base64 |
| `has_access_to_file(file_id, access_type, user, db=None, user_group_ids=None)` ist async | [utils/access_control/files.py:19–42](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/access_control/files.py#L19-L42) | Eigentümer/Admin oder vorhandene Lesefreigabe |
| `get_verified_user` ist FastAPI-Dependency für verifizierte Rollen | [utils/auth.py:522–528](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/auth.py#L522-L528) | Download immer unter angemeldeter Person |
| Auth akzeptiert das Sitzungscookie; Signin setzt HttpOnly-Cookie | [utils/auth.py:356–366](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/auth.py#L356-L366), [routers/auths.py:195–208](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/routers/auths.py#L195-L208) | Browserlink braucht keinen eingebetteten Bearer-Token |
| Filter laufen vor Entfernen/Übernahme von `files` und RAG | [utils/middleware.py:2635–2645](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/middleware.py#L2635-L2645), [utils/middleware.py:2724](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/middleware.py#L2724), [utils/middleware.py:2825–2839](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/middleware.py#L2825-L2839) | Erfolgreich übertragene Anhänge vor RAG leeren |
| Outletbody enthält `model` und `messages` | [utils/middleware.py:3945–3989](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/middleware.py#L3945-L3989) | Modellprüfung und Linkersetzung funktionieren auch im Outlet |
| Der Funktionslader erbt aufgeschobene Typannotationen | [utils/plugin.py:1](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/plugin.py#L1), [utils/plugin.py:278–291](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/utils/plugin.py#L278-L291) | Lokales `Request` vor FastAPI-Registrierung explizit als Typ setzen; verhindert HTTP 422 |
| Frontend ist ein Root-Catch-all vor dynamischen Funktionen | [main.py:3032–3041](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/main.py#L3032-L3041) | Neue Proxyroute vor dem Root-Mount einfügen; sonst wird die Frontendseite ausgeliefert |
| Direkte Clients können `/api/chat/completed` ausführen | [main.py:2063–2078](https://github.com/open-webui/open-webui/blob/v0.11.3/backend/open_webui/main.py#L2063-L2078) | Container-Test prüft reale Outlet-Dispatchroute |
| Admin-Funktionen bieten Erstellen, Aktivieren und Global | [Functions.svelte:357–363](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/admin/Functions.svelte#L357-L363), [Functions.svelte:699–708](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/admin/Functions.svelte#L699-L708), [FunctionMenu.svelte:49–59](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/admin/Functions/FunctionMenu.svelte#L49-L59) | Installationsweg im Runbook |
| Standard/Benutzerdefiniert schaltet Eingabefelder frei | [common/Valves.svelte:35–70](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/common/Valves.svelte#L35-L70) | Jedes neue Valve explizit umstellen; normales `GATEWAY_TOKEN`-Feld |
| Modellfähigkeiten enthalten Dateiupload, Zitate, Status, Erinnerungen und eingebaute Werkzeuge | [Models/Capabilities.svelte:16–68](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/workspace/Models/Capabilities.svelte#L16-L68), [Models/BuiltinTools.svelte:19–24](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/workspace/Models/BuiltinTools.svelte#L19-L24) | CET betreibt Wissen/Werkzeuge selbst; beide Erinnerungs-Schalter aus |
| „Quelle abgerufen“ ist die deutsche Anzeige des Retrieval-Status | [StatusItem.svelte:103–120](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/components/chat/Messages/ResponseMessage/StatusHistory/StatusItem.svelte#L103-L120), [de-DE/translation.json:2295–2298](https://github.com/open-webui/open-webui/blob/v0.11.3/src/lib/i18n/locales/de-DE/translation.json#L2295-L2298) | Indiz für den Textweg; mit Datei und CET-Referenzen prüfen |

Die zusätzliche `/api/v1/cet-files/{file_id}`-Route stammt aus unserem Filter, nicht aus
Upstream. `mount_downloads` registriert sie über FastAPI beim ersten passenden Inlet;
der Container-Test ruft sie anschließend unter der echten verifizierten Sitzung auf.
