# Originaldateien zwischen Open WebUI und CET

Issue #790, Entscheidung F1: erzeugte Dateien werden im Tenant abgelegt, als Fallunterlage
referenziert und mit einem sieben Tage gültigen signierten Download-Link zurückgegeben.
Der Link allein gewährt keinen Zugriff: CET prüft die aktuelle authentifizierte Person,
Tenant-Zuordnung und Vertraulichkeitsfreigabe bei jedem Abruf und schreibt ein Audit.

## Installation

1. CET mit dem bestehenden Object Store und Workbench starten. Keine neue Datenbank anlegen.
2. `CET_FILE_SIGNING_KEY` auf ein zufälliges Geheimnis mit mindestens 32 Bytes setzen;
   auf allen Instanzen denselben Wert verwenden. Rotation widerruft vorhandene Links.
3. Gateway-Token und Zuordnungen wie in [Tenant-Gateway](open-webui-tenant-gateway.md)
   provisionieren; denselben Gateway-Token für Chat und Dateikanal verwenden.
4. In Open WebUI als Administrator unter Workspace → Functions die Datei
   `integrations/open-webui/cet_file_channel.py` importieren und aktivieren.
   Nur beim CET-Assistenten einschalten. Valves setzen: `CET_URL` (serverseitige Adresse),
   `GATEWAY_TOKEN`, `OPENWEBUI_ORG_ID`, `MAX_BYTES`. Benutzer können diese Valves nicht ändern.
   `ENABLE_FORWARD_USER_INFO_HEADERS=true` weiterhin für den Chat aktivieren.
5. Den ersten Chat mit aktiviertem Filter auf jedem Open-WebUI-Prozess starten: er
   registriert die angemeldete Download-Proxyroute `/api/v1/cet-files/{fileId}`.
   Nach Neustart erfolgt die Registrierung erneut. Bei mehreren Workern jeden Worker
   initialisieren; alternativ Open WebUI mit einem Worker betreiben.
6. Synthetisches XLSX mit zwei Blättern anhängen. Der Filter liest den autorisierten
   Originaldatensatz über Open WebUIs File/Storage/Access-Control-APIs, lädt die Bytes hoch,
   entfernt die Anhänge vor RAG und sendet nur `cet_file_refs`. Ohne Filter bleibt der
   vorhandene `<context>`-Textweg unverändert.
7. Für den Ausgabekanal `Exportiere Fallunterlagen als txt` im zugeordneten Chat verwenden.
   Der Filter ersetzt CET-Links durch die gleichnamige angemeldete Open-WebUI-Proxyroute.
   Ein anderer gemappter Nutzer desselben Tenants darf herunterladen, soweit seine
   Vertraulichkeitsfreigabe passt. Fremder Tenant und abgelaufene Links werden abgewiesen.

Die Integration folgt den aktuellen offiziellen
[Filter-Hooks](https://docs.openwebui.com/features/extensibility/plugin/functions/filter/)
und [File-APIs](https://github.com/open-webui/open-webui/blob/main/backend/open_webui/routers/files.py).
Sie benötigt die asynchronen `Files`, `Users` und `utils.access_control.files`-APIs;
vor Versionswechsel mit dem Integrationstest prüfen. `outlet` läuft bei UI-Chats;
bei direkten Open-WebUI-API-Aufrufen zusätzlich `/api/chat/completed` ausführen.

## Endpunkte und Erzeuger

- `POST /v1/files`: JSON `{name, contentBase64, mimeType?, sensitivityLevel?, openWebuiOrgId?}`.
  Identität über Gateway-Token und `X-OpenWebUI-User-Id`; keine Rollen oder Tenant-ID aus
  dem Body. Rückgabe `{fileId,name,mimeType,size,hash,duplicate}`. Hash: SHA-256 der Bytes.
- `GET /v1/files/:fileId/link`: neuer sieben Tage gültiger Link.
- `GET /v1/files/:fileId/content?ticket=…`: signierter Link plus aktuelle Authentifizierung.
- `DELETE /v1/files/:fileId`: physische Entfernung der Originalbytes und Dokumentevidenz;
  bestehende Links werden ungültig. Im Chat: `Lösche Datei <fileId>`.
- Interne Erzeuger rufen `files.publish` mit `name`, `contentBase64`, `caseId` und
  `sensitivityLevel` unter der bestehenden Personenidentität auf. Die Action prüft den
  Fallzugriff, speichert im Object Store und legt eine EvidenceRef am Fall an. Ihr
  `responseText` enthält den fertigen Chat-Link. Kein LLM-Aufruf für Dateiübertragung.

Originale XLSX bleiben bytegenau erhalten (Formeln und Formatierung eingeschlossen).
Die Auswertung liest alle Blätter über die vorhandene SheetJS-Bibliothek und gibt rohe
Zellwerte an #774 weiter. Formeln werden nicht ausgeführt; fehlen gespeicherte Ergebnisse,
ist Neuberechnung in einer Tabellenanwendung nötig. PDF, DOCX und PPTX werden für den
bestehenden Dokument-/Review-Pfad textuell extrahiert, während das Original erhalten bleibt.
Office-Makros, eingebettete Objekte und externe Verknüpfungen werden abgewiesen.

## Konfiguration und Grenzen

| Einstellung | Default | Bedeutung |
| --- | --- | --- |
| `CET_FILE_MAX_BYTES` | 10485760 | Originalgröße, vor Decodierung geprüft |
| `CET_FILE_ALLOWED_TYPES` | pdf,docx,xlsx,csv,pptx,txt,eml,edi,edifact | Teilmenge der implementierten Allowlist |
| `CET_FILE_MAX_EXPANDED_BYTES` | 33554432 | Summe aller Office-ZIP-Einträge |
| `CET_FILE_MAX_SHEET_ROWS` | 50000 | Zeilengrenze je XLSX-Blatt |
| `CET_FILE_RETENTION_DAYS` | 30 | Aufbewahrung; Abruf verweigert nach Ablauf |
| `CET_FILE_SCAN_ACTION` | leer | Moleculer-Action für optionalen Virenscan |
| `CET_FILE_SCAN_TIMEOUT_MS` | 30000 | Scan-Zeitbudget |
| `CET_FILE_PUBLIC_BASE_URL` | leer | Optionale öffentliche CET-Origin für Links |
| `CET_FILE_SIGNING_KEY` | erforderlich für Links | Mindestens 32 Bytes |

Der Scanner erhält `{bytes,mimeType,hash}` und muss `{clean:true}` zurückgeben.
Fehler, Timeout oder fehlende Freigabe verhindern die Ablage. Scan-Hook im Betrieb
aktivieren; der Hook darf Inhalte weder loggen noch an unfreigegebene Dienste senden.
Die bestehenden Dokument-, Dataset- und Quotenlimits gelten zusätzlich.

Base64-JSON benötigt rund 4/3 der Originalgröße. `OPENAI_COMPAT_BODY_LIMIT` und Proxy
`client_max_body_size` müssen diese Größe plus JSON-Overhead erlauben. Open WebUI hat
zusätzlich eigene Uploadlimits; Filter-`MAX_BYTES` höchstens auf die CET-Grenze setzen.
HTTP 413 bedeutet Größen-/Entpacklimit, 422 bedeutet Typ/Kodierung/Dateiname, 403 bedeutet
Mapping, Org, Tenant, Vertraulichkeit oder ungültigen Link; 503 bedeutet Schlüssel/Scanner.
Keine stillen Kürzungen. Downloadantworten tragen `no-store`, `nosniff` und `attachment`.

Retention: einen betrieblichen Scheduler auf die geschützte Action `files.purge` unter
jedem Tenant-Prinzipal konfigurieren; wiederholt aufrufen, bis `removed=0`. Ablauf wird
unabhängig vom Scheduler beim Abruf durchgesetzt. Object-Store- und Evidence-PouchDBs
gehören in die bestehende Backup-/Compaction-Routine, damit entfernte Revisionen nach
Compaction auch aus den lokalen Datenbankdateien verschwinden. Audit bleibt erhalten.
Dataset-Zeilen/Katalog werden über den vorhandenen #774-Löschworkflow separat gelöscht.
Access-Logs an Proxy und Open WebUI dürfen Querystrings (Downloadtickets) nicht enthalten.
