# Originaldateien zwischen Open WebUI und CET

Issue #790, Entscheidung F1: erzeugte Dateien werden im Tenant abgelegt, als Fallunterlage
referenziert und mit einem sieben Tage gültigen signierten Download-Link zurückgegeben.
Der Link allein gewährt keinen Zugriff: CET prüft die aktuelle authentifizierte Person,
Tenant-Zuordnung und Vertraulichkeitsfreigabe bei jedem Abruf und schreibt ein Audit.

## Installation auf Open WebUI v0.11.3

Getestete Version: **v0.11.3** (lokaler HTTP-Container-Test und Quellcodeprüfung). Der reproduzierbare
Container-Test verwendet genau dieses Image; Umfang und Grenzen stehen unter
[Tests und Upstream-Belege](../integrations/open-webui/FILE_CHANNEL_TESTING.md).

1. CET mit dem bestehenden Object Store und Workbench starten. Keine neue Datenbank anlegen.
2. `CET_FILE_SIGNING_KEY` auf ein zufälliges Geheimnis mit mindestens 32 Bytes setzen;
   auf allen CET-Instanzen denselben Wert verwenden und **CET neu starten**.
   Ohne Schlüssel oder ohne Neustart antwortet CET mit 503 „Dateikanal-Schlüssel fehlt“.
   Rotation widerruft vorhandene Links. Schlüssel ausschließlich in der Betriebsumgebung halten.
3. Einen **eigenen Gateway-Token für den Dateikanal** anlegen:

   ```bash
   npm run workbench:map -- --list
   npm run token:create -- --tenant=<t> --user=svc:open-webui-files --name=OpenWebUI-Dateikanal --gateway --client=open-webui --org=<org>
   ```

   `<org>` muss exakt der `externalOrgId` der Zuordnungen entsprechen. Tenant und Person
   weiterhin nach [Tenant-Gateway](open-webui-tenant-gateway.md) zuordnen; eine reine
   E-Mail-Zuordnung wird unterstützt. Token nicht in Chat, Screenshots oder Repository kopieren.
4. Als Administrator **Administrationsbereich → Funktionen → Erstellen** öffnen.
   Den gesamten Code aus `integrations/open-webui/cet_file_channel.py` einfügen, speichern,
   **Schalter aktivieren**, dann **⋯ → Global** einschalten. Die Modellbearbeitung ist für
   diese Installation nicht nötig. Global ist sicher: beide Hooks wirken ausschließlich
   auf die exakten IDs in `MODEL_IDS`. Der Filter kann seine eigene Inaktivität nicht erkennen.
5. Im Funktionsmenü die **Valves** öffnen. Neue Valves stehen auf **Standard**;
   vor der Eingabe jeweils auf **Benutzerdefiniert** klicken und anschließend speichern:

   | Valve | Wert / Bedeutung |
   | --- | --- |
   | `CET_URL` | Vom Open-WebUI-Server erreichbare CET-Adresse, z. B. `http://cet:3000` |
   | `GATEWAY_TOKEN` | Eigener Dateikanal-Gateway-Token, normales sichtbares Textfeld |
   | `OPENWEBUI_ORG_ID` | Exakte `externalOrgId` aus `workbench:map -- --list` |
   | `MODEL_IDS` | Kommagetrennte exakte IDs; Standard `cernion-governance-assistant` |
   | `MAX_BYTES` | Standard 10485760, höchstens CETs Dateigrenze |
   | `TIMEOUT_SECONDS` | Standard 60 |
   | `priority` | Standard 0; Dateikanal vor Filtern ausführen, die Anhänge verändern |

   Bei einem eigenen Modell-Preset dessen tatsächliche ID in `MODEL_IDS` ergänzen.
   Benutzer können diese Administrator-Valves nicht ändern. Für Chat weiterhin
   `ENABLE_FORWARD_USER_INFO_HEADERS=true` setzen; der Dateikanal sendet selbst
   `X-OpenWebUI-User-Id` und, sofern vorhanden, `X-OpenWebUI-User-Email`.
6. In der Bearbeitung des CET-Modells unter **Fähigkeiten** und unter
   **Eingebaute Werkzeuge** jeweils **Erinnerungen aus** schalten. Eingebaute Werkzeuge,
   Websuche, Code-Interpreter, Terminal und Bildgenerierung ausschalten.
   **Dateiupload, Zitate und Statusaktualisierungen einschalten**.
   CET führt Gedächtnis, Wissen und Werkzeuge selbst; zusätzliche Open-WebUI-Werkzeuge
   würden einen zweiten Verarbeitungspfad öffnen. Kein Open-WebUI-Wissen am CET-Modell
   hinterlegen: Wissenssammlungen sind im Originaldateikanal nicht unterstützt.
7. Einen ersten Chat mit einer ID aus `MODEL_IDS` auf jedem Open-WebUI-Prozess starten.
   Dabei registriert der Filter `/api/v1/cet-files/{file_id}`. Nach Neustart wiederholen;
   für mehrere Worker jeden Worker initialisieren oder mit einem Worker betreiben.
   Die Route bleibt bei Hot Reload bestehen und verwendet die aktuellen Valves.
8. Eine synthetische CSV oder XLSX anhängen. Der Filter liest den autorisierten Original-
   datensatz über Open WebUIs File/Storage/Access-Control-APIs, überträgt die Bytes,
   entfernt die Anhänge vor RAG und sendet `cet_file_refs`. **Erfolgskontrolle:**
   Erscheint unter der Antwort kein **„Quelle abgerufen“**, ist der Dateikanal aktiv.
   Steht dort „Quelle abgerufen“, läuft der Textweg: Aktivierung, Global und `MODEL_IDS`
   prüfen. Dieses UI-Indiz mit einer tatsächlich angehängten Datei und den CET-Dateireferenzen
   prüfen; bei einer Nachricht ohne Datei beweist das Fehlen der Anzeige nichts.
9. Für den Ausgabekanal `Exportiere Fallunterlagen als txt` im zugeordneten Chat verwenden.
   Der Filter ersetzt CET-Links durch die angemeldete Proxyroute. Die Browser-Sitzung
   authentifiziert den Download; der Gateway-Token bleibt serverseitig. Ein anderer
   gemappter Nutzer desselben Tenants darf herunterladen, soweit seine Freigabe passt.
   Fremder Tenant und abgelaufene Links werden abgewiesen.

Ein aktiver Filter bricht fehlgeschlagene Uploads sichtbar ab. v0.11.3 reicht `inlet`-
Exceptions weiter, speichert die Fehlermeldung am Chat und sendet `chat:message:error`;
bei direkten API-Aufrufen ohne Chat-/Nachrichten-ID antwortet es mit HTTP 400.
Der Provider und die nachfolgende RAG-Pipeline werden bei diesem Fehler nicht aufgerufen.
Ist die Funktion inaktiv, nicht global oder die Modell-ID nicht erfasst, wird der Hook
nicht wirksam; dann kann Open WebUI weiterhin den Textweg verwenden.

| Meldung | Ursache / Maßnahme |
| --- | --- |
| „Gateway-Schlüssel und Organisation fehlen“ | Valves nicht gesetzt; auf Benutzerdefiniert umstellen, Werte speichern |
| 401/403 | Token, Org oder Personen-Zuordnung passt nicht; `externalOrgId` vergleichen |
| 503 / „Dateikanal-Schlüssel fehlt“ | Signierschlüssel fehlt oder CET nicht neu gestartet |
| „Quelle abgerufen“ | Filter inaktiv, nicht global oder tatsächliche Modell-ID fehlt in `MODEL_IDS` |
| „Server nicht erreichbar oder Zeitüberschreitung“ | Serverseitige CET-Adresse und Verbindung prüfen |
| 404 auf `/api/v1/cet-files/…` | Worker seit Neustart noch nicht durch einen passenden Chat initialisiert |

`outlet` läuft bei UI-Chats; bei direkten API-Aufrufen zusätzlich `/api/chat/completed`
ausführen. Signaturen, interne APIs und Fehleranzeige sind mit Datei und Zeile des
[Upstream-Tags dokumentiert](../integrations/open-webui/FILE_CHANNEL_TESTING.md).
Vor jedem Versionswechsel die Tests erneut ausführen.

## Endpunkte und Erzeuger

- `POST /v1/files`: JSON `{name, contentBase64, mimeType?, sensitivityLevel?, openWebuiOrgId?}`.
  Identität über Gateway-Token, `X-OpenWebUI-User-Id` und optional
  `X-OpenWebUI-User-Email`; keine Rollen oder Tenant-ID aus
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
