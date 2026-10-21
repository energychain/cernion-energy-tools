# Projektakte — Datenmodell und Lebenszyklus (#883)

Der domänenfreie Service `project-file` hält Unterlagen eines Vorhabens dauerhaft
zusammen. Er verwendet die **vorhandene Object-Store-PouchDB**. Deren einzige
Lifecycle-Verantwortung bleibt bei `createPouchDbLifecycleMixin`; der Aktenservice
öffnet keine Datenbank und besitzt keinen eigenen DB-Lifecycle. Der additive,
geschützte Adapter `object-store.projectRecord` speichert Dokumente außerhalb des
generisch adressierbaren Namespace-Schemas und verlangt eine interne Symbol-Capability.

## Datenvertrag und Sichtbarkeit

```js
Project {
  projectId, tenantId, title,
  lifecycle: 'ingesting' | 'ready' | 'degraded' | 'archived',
  requiredClearance: [], createdBy, members: [],
  stats: { files, bytes, datasets, nodes, edges },
  projectRefs: [{ caseId?, conversationId? }],
  createdAt, updatedAt,
  deletion?: { status: 'pending' | 'incomplete', failedHandlers: [] }
}
```

Leere Akten starten als `ready`. Archivierte Akten bleiben lesbar und dauerhaft
gespeichert, sind aber bei `list({ routingOnly: true })` ausgeschlossen und nehmen
keine weiteren Bestandteile oder Änderungen an. Eine begonnene oder fehlgeschlagene
Löschung schließt ebenfalls Änderungen und Routing aus, bleibt für berechtigte Nutzer
in `get` und `list` sichtbar und kann mit `delete` wiederholt werden.

Authentifizierung und Tenant stammen aus `domain-router-policy.principal`, nicht
aus Request-Parametern. Die Gateway-RBAC bleibt für REST-Schreibzugriffe maßgeblich;
Archivierung und Löschung verlangen wie alle Schreibzugriffe die reguläre Schreibrolle
(`full-access`), aber **keine zusätzliche** Rolle: Jeder schreibberechtigte Nutzer desselben
Tenants mit aktueller Akten-Sichtbarkeit darf diese beiden Aktionen ausführen.
Feinere Rechte (Verantwortliche, zweistufiges Löschen) folgen in RC4 #898.
Tenant-Sichtbarkeit verwendet `visible`, Clearance verwendet `canViewEvidence` und
`assertSensitivityAllowed`. Fehlende Akten, fremde Tenants, fehlende Clearance und
fehlende Mitgliedschaft liefern bei Einzelzugriff **404**; Listen und Referenzabfragen
lassen unsichtbare Akten weg. Ohne Mitgliederliste ist die Akte tenantweit sichtbar.

`requiredClearance` bildet die gemeinsame Anforderungsgrenze aller registrierten
Bestandteile. Die vorhandene Policy behandelt `restricted` und `highly_sensitive`
als **unabhängige Freigaben**: ein höheres Label darf die Anforderung eines anderen
Bestandteils nicht entfernen. Deshalb werden alle vorkommenden Anforderungen
vereinigt und deterministisch in Stufenreihenfolge gespeichert; `public` und
`tenant_internal` sind nach der vorhandenen Policy ohne besondere Freigabe sichtbar.
Die aus Workbench-Mappings stammende `sensitivityClearance` wird wie im bestehenden
Dataset-Katalog als authentifizierte `sensitivityFlags` übergeben. `domainsAllowed`
wird weiter durch die vorhandenen Routing-/Tool-Grenzen ausgewertet: die Akte selbst
hat keine fachliche Domäne und eröffnet keine zusätzliche Tool-Berechtigung.

## Aktionen

| Aktion | REST unter `/api/project-file` | Inhalt |
| --- | --- | --- |
| `create` | `POST /` | Titel, optional Mitglieder und Referenzen |
| `get` | `GET /:projectId` | sichtbare Akte |
| `list` | `GET /` | sichtbare Akten; optional `routingOnly=true` |
| `forReference` | `GET /refs?caseId=…&conversationId=…` | Akten zu struktureller Herkunft |
| `administrationOverview` | `GET /administration-overview` | read-only Inventar mit beratender Löscheinschätzung (#898) |
| `update` | `PATCH /:projectId` | Titel, Mitglieder und Referenzen ersetzen |
| `archive` | `POST /:projectId/archive` | Daten dauerhaft behalten, Routing beenden |
| `delete` | `DELETE /:projectId` | bestätigtes Aufräumen, Audit, Datensatz entfernen |

`get`, `list` und `forReference` sind `x-agentable` und damit über die vorhandenen
MCP-Meta-Tools `cernion_search`/`cernion_describe`/`cernion_execute_read` lesbar.
`administrationOverview` ist bewusst nicht `x-agentable` (siehe unten).
Interne Aktionen deklarieren `visibility: 'protected'` und keine REST-Route:

- `setLifecycle({ projectId, lifecycle })`: für #884/#885, keine Reaktivierung archivierter Akten.
- `registerComponent({ projectId, componentId, sensitivityLevel, requiredClearance?, stats?, cleanupAction })`:
  idempotente Registrierung/Ersetzung eines Bestandteils; berechnet Clearance und
  Zähler neu und persistiert den verpflichtenden Cleanup-Aktionsnamen.
- `recomputeClearance({ projectId })`: erneute Berechnung aus persistierten Bestandteilen.
- `addFile({ projectId, fileId })`: ordnet eine vorhandene, sichtbare Originaldatei zu,
  registriert deren tatsächliche Sensitivität/Zähler und aktiviert die Retention-Ausnahme.

`projectRefs` liegen in der Akte, um Fall-Persistenz und Workbench-Pfade unverändert
zu lassen. Eine Referenz muss mindestens `caseId` oder `conversationId` enthalten.
Mehrere Akten können dieselbe Referenz haben. Referenzen sind strukturelle IDs,
keine Ähnlichkeitsberechnung und keine zusätzliche Fallzugriffsberechtigung; eine
Validierung existierender Fälle durch spätere Workflow-Integrationen bleibt separat.

## Verwaltungsübersicht (#898, erste Stufe)

`GET /api/project-file/administration-overview` (Sicherheitsklasse
`read_only_governance_projection`) liefert `{ safetyClass, advisory: true, projects: [...] }`.
Grundlage ist exakt der Sichtbarkeitspfad von `list` (Tenant, Mitgliedschaft, unabhängige
Clearance); archivierte und in Löschung befindliche Akten erscheinen unabhängig von
`routingOnly`. Unsichtbare Akten fehlen vollständig; es gibt keine Summen oder Zähler über
den Mandanten, die auf verborgene Akten schließen ließen.

Je Zeile: `projectId`, `title`, `lifecycle`, `updatedAt`, `stats`, `requiredClearance`,
`linkedCaseCount`/`linkedConversationCount` (nur Anzahlen), `deletionState`
(`none`/`pending`/`incomplete`/`unknown`), `failedCleanupCount` (ohne Handlernamen) sowie
`responsibility` mit `projection: 'legacy_responsibility_projection'`,
`grantsAuthority: false`, `createdBy` und `members`. Diese Verantwortlichkeit ist nur eine
Ableitung aus Bestandsfeldern und **keine** Berechtigung; `ROLE_TENANT_ADMIN` wird nicht
ausgewertet.

`deletionEligibility` ist beratend und kennt nur `not_eligible`,
`policy_definition_required`, `blocked_incomplete_cleanup` und `human_review_required`.
Unbekannte Zustände fallen auf `human_review_required`; ein „löschbar“ gibt es nicht.
`blockers` nennt u. a. `cleanup_incomplete`, `ingest_in_progress`,
`archived_retention_policy_missing` sowie immer `responsibility_model_missing` und
`legal_hold_model_missing`. `nextGate` ist stets `human_policy_design_review`.

Der Lesezugriff schreibt nichts: keine Persistenz, kein Audit-/Ereignisbucheintrag, kein
Event, kein Cleanup-Handler, keine Lifecycle-Änderung, keine externen Aufrufe. Die Aktion ist
nicht `x-agentable`; der generierte Operation-Capability-Index führt sie wie jede GET-Route
als `data_read` mit Konsequenzstufe `none`, die Prinzipal-Filter bleiben dabei maßgeblich.

Weiterhin offen (#898): Verantwortlichen-Modell, Löschantrag/Papierkorb/Wiederherstellung,
Legal Hold, Aufbewahrungsfristen, Ereignisbuch-/Evidenzeinträge, Migration bestehender Akten
und die eigene Verwaltungsoberfläche. RC3-Verhalten von `archive`/`delete` bleibt unverändert.

## Events und Löschkaskade

- `project.lifecycle.v1 { tenantId, projectId, lifecycle }`: nach Erstellung und jeder
  tatsächlichen Lebenszyklusänderung, nach erfolgreicher Persistenz.
- `project.deleting.v1 { version: 1, tenantId, projectId }`: nach dauerhafter
  Löschmarkierung und vor dem Aufräumen; dient der Benachrichtigung.

Die verbindliche Kaskade besteht aus den persistent registrierten
`cleanupAction`-Namen sowie konfigurierten zusätzlichen Aktionen. Jeder Handler erhält
`{ version: 1, tenantId, projectId }` und muss nach Abschluss `{ deleted: true }`
zurückgeben. Event-Abonnenten allein gelten nicht als bestätigtes Aufräumen.
Handler müssen idempotent sein und alle Objekte ihres Speichers zu dieser Akte entfernen;
fehlende/unbestätigte/fehlgeschlagene Handler blockieren die endgültige Löschung.
Der Status `deletion.incomplete` und die fehlerhaften Handler werden dauerhaft gespeichert.
Bei Wiederholung werden alle Handler erneut geprüft, auch nach einem Neustart.

Der vorhandene `DecisionEvidenceAuditTrail` speichert in derselben DB
`project.delete.requested`, `project.delete.cleaned` und bei Fehlern
`project.delete.incomplete` mit Tenant, Actor, Handlernamen und Abschlusszählern.
Auditfehler blockieren die Entfernung; das Audit bleibt nach der Löschung erhalten.
`cleaned` bestätigt das erfolgreiche Aufräumen unmittelbar **vor** der endgültigen
Entfernung des Akten-Datensatzes. Die Tests zählen Originale, Tabellen, Knoten,
Kanten, Manifest und Skills mit Stub-Speichern vor/nach der Kaskade.

## Retention und Konfiguration

Der File-Channel setzt die Retention durch `files.purge` und zusätzlich bei der
Autorisierung abgelaufener Dateien durch. Ein eigener automatischer Purge-Timer
ist im File-Service nicht vorhanden. Normale Chat-Dateien behalten
`CET_FILE_RETENTION_DAYS` (Standard: 30 Tage) unverändert.

Projektzuordnung entfernt `expiresAt`; für vorhandene Datensätze mit `projectId`
oder `projectIds` ignorieren Autorisierung und Purge auch einen alten Ablaufwert.
`removeFile` prüft vor Retention-Löschung die aktuelle Zuordnung erneut. Zuordnung,
Purge und Löschung nutzen dieselbe bestehende Tenant-Upload-Queue, sodass eine
gleichzeitige Retention keine gerade zugeordnete Datei entfernt.
Geschützte File-Aktionen verlangen eine interne Capability, die nicht per REST/JSON
gefälscht werden kann. Gleicher Dateiinhalt kann zu mehreren Akten gehören;
die Löschung einer Akte behält das Original für die verbleibenden Akten.
Nach Löschung der letzten Akte entfernt `files.deleteProject` das Original und dessen
bestehende Dokument-/Evidenzableitungen. Das Original bleibt bis zum erfolgreichen
Aufräumen dieser Ableitungen erhalten, damit Fehler wiederholbar bleiben.

- `OBJECT_STORE_DB_PATH`: bereits bestehender DB-Pfad, keine neue Akten-Datenbank.
- `CET_PROJECT_CLEANUP_ACTIONS`: optional kommaseparierte zusätzliche interne
  Cleanup-Aktionen. Aktionsnamen werden bei Erstellung in der Akte gespeichert,
  damit spätere Konfigurationsänderungen keinen registrierten Speicher vergessen.

## Erweiterungspunkte #884–#889 (Grundlage bis #891)

Ingest verbindet Originale über `addFile` und setzt `ingesting`/`degraded` intern.
Tabellen, Graph, Manifest und Skills registrieren stabile Komponenten-IDs,
tatsächliche Sensitivität, ihre jeweiligen Zähler und einen idempotenten Cleanup-Handler.
Die Registrierung verlangt aktuelle Clearance und darf erst erfolgen, wenn der
aufrufende Workflow die Bestandteile korrekt autorisiert hat. Neue Workflow-Schritte
sollen über dieselbe Akten-Mutationsgrenze serialisieren. Speicherung über mehrere
Systeme ist keine verteilte Transaktion; nach fehlgeschlagener Originalzuordnung kann
eine konservative Komponentenregistrierung bestehen bleiben. Wiederholung mit derselben
ID vervollständigt die Zuordnung ohne doppelte Zählung.

Die bestehende v0.52-Personal-Agent-TDD-Matrix hat keine Projektakte-Zeilen und wird
deshalb nicht fachfremd erweitert. Die #883-Abdeckung liegt in
`tests/project-file-policy.test.js`, `tests/project-file.service.test.js` und
`tests/project-file-retention.test.js` und `tests/project-file.http.test.js`;
die vorhandene Matrix bleibt separat geprüft.

## Ingest bis 2 GiB (#884)

`project-upload` ergänzt die vorhandene Akte um Originale und Bündel. Der Chat-Pfad
`files.upload` behält 10-MB-Standardlimit, Base64-Vertrag und 30-Tage-Retention.
Aktenobjekte enthalten **kein** `contentBase64`; jede Datei eines Mehrfachuploads
verwendet ein eigenes Upload-Protokoll mit derselben `projectId`. ZIP-Einträge werden
ebenfalls eigene Objekte, einschließlich Herkunft aus dem Bündel.

```js
ProjectObject {
  objectId, projectId, tenantId, name, mimeType, size, hash,
  chunks: [{ hash, size }],
  status: 'receiving' | 'received' | 'failed',
  sensitivityLevel, requiredClearance,
  provenance: { actorId, uploadId, parentObjectId? },
  receivedAt?, bundlePath?,
  extraction: { status: 'pending' },
  ingestState?: 'queued' | 'processing' | 'complete' | 'failed'
}
```

Während des Empfangs sind fehlende Chunkplätze intern `null`; die Statusantwort
liefert stattdessen vorhandene Chunks mit `index` und eine Liste `missing`.
`hash` und Chunk-Hashes sind SHA-256 über **Dateiinhalte**, hexadezimal/kleingeschrieben.
Tenant-Identitäten werden niemals gehasht. Bei Hashfehlern bleibt das Objekt dauerhaft
als `failed` sichtbar, bis die Upload-Ablaufbereinigung oder Aktenlöschung es entfernt.
Bei Teilfehlern bleiben bereits erfolgreich empfangene Bündeleinträge erhalten.
`extracted` und eigentliche Inhaltsanalyse setzt erst #885; `extraction.status` ist
der Erweiterungspunkt, keine vorgezogene Strukturierung.

### Upload-Protokoll

Alle Aktionen sind tenantbezogen und prüfen die aktuelle Akten-Sichtbarkeit sowie
`assertSensitivityAllowed`. `start` registriert schon vor dem ersten Chunk eine
Komponente mit Sensitivität und Cleanup-Handler (Datei-/Bytezähler zunächst null).
Nach Empfang wird dieselbe Komponenten-ID mit tatsächlichen Zählern ersetzt.

| Broker-Aktion | REST unter `/api/project-upload` | Vertrag |
| --- | --- | --- |
| `start` | `POST /start` | JSON `{ projectId, name, size, hash, mimeType?, sensitivityLevel?, requiredClearance?, chunks? }` → `{ uploadId, objectId, chunkSize, chunks, missing }` |
| `chunk` | `PUT /uploads/:uploadId/chunks/:index?hash=…` | `application/octet-stream`; direkt im Broker alternativ `{ uploadId, index, hash, bytes: Buffer }` |
| `complete` | `POST /uploads/:uploadId/complete` | prüft Vollständigkeit, liefert HTTP 202 und Job-URLs; Gesamthash/Scan/ZIP laufen im Job |
| `status` | `GET /uploads/:uploadId` | empfangene/fehlende Chunks, Objektstatus, Ingeststatus und Job-Deskriptor |
| `objects` | `GET /:projectId/objects` | Metadaten aller sichtbaren Aktenobjekte |

`status` und `objects` sind über die bestehenden MCP-Meta-Tools lesbar (`x-agentable`).
Der Jobstatus wird über die bestehenden `/api/jobs/:jobId/status`-/`result`-Endpunkte
abgefragt; der in Upload-Metadaten gespeicherte Job-Deskriptor enthält die ursprüngliche
Queue-Antwort. `status.ingestState` ist der dauerhafte Verarbeitungsstand der Akte.

Der `stream`-Autoalias von Moleculer-Web übergibt den HTTP-Body als `ctx.stream`.
Die Gateway-JSON-/URL-Parser haben weiterhin 25 MB Limit und parsen keine Octet-Streams.
Die Chunkgröße wird beim Start festgehalten und bei jedem Chunk exakt geprüft; der
letzte Chunk darf kürzer sein. Unbekannte Indizes und widersprüchliche Wiederholungen
werden abgelehnt. Wiederholte Chunks werden erneut serverseitig geprüft.
Netzwerkabbrüche hinterlassen keine halben Chunkdateien und erfordern nur die erneute
Übertragung des fehlenden Chunks. Ein Neustart verliert keine bestätigten Chunks.

Erneutes `start` mit identischem Namen, Größe, Gesamthash und Sensitivitätsvertrag
setzt denselben Upload fort. Optional enthält `chunks` bereits die bekannte geordnete
Hash-/Größenliste: vorhandene, aktuell autorisierte Chunks desselben Tenants werden
dann verknüpft und erscheinen nicht in `missing`. Ohne diese Liste ist Deduplizierung
beim Empfang möglich; der Server kann einzelne Chunk-Hashes aus dem Gesamthash nicht
vorhersagen. Der Gesamtinhalt wird vor erfolgreichem Empfang erneut vollständig gehasht.

### Verzeichnis und Referenzzählung

```text
CET_PROJECT_DATA_PATH/
  id-<encodeURIComponent(tenantId)>/
    id-<encodeURIComponent(projectId)>/
      chunks/
        <sha256>                  # unveränderliche Chunkdatei
        pending-<uuid>            # kurzlebiger Schreib-/Archivspool
      project.sqlite              # akteneigene Tabellen und Kandidaten (#885)
```

Für produktive Instanzen ist `CET_PROJECT_DATA_PATH` auf ein lokales Verzeichnis
**außerhalb des Repositories** zu setzen, beispielsweise ein eigenes Datenvolume.
Der Entwicklungs-Fallback `./data/project-objects` liegt wie die PouchDB-Pfade unter
dem bereits durch `.gitignore` ausgeschlossenen `data/`. Tenant-/Projektwerte werden
kodiert und mit `id-` präfixiert, auch `.`/`..` werden dadurch keine Pfadoperationen.
Steuerzeichen, zu lange Segmente und Symlinks in sämtlichen Pfadkomponenten werden
verworfen. Verzeichnisse entstehen mit Modus 0700, Dateien mit 0600.

Metadaten liegen ausschließlich im vorhandenen Object Store hinter dem geschützten
Adapter `projectObjectRecord`, Präfix `project-object:<encoded-tenant>:<encoded-project>:`.
Das Präfix ist durch generische Namespace-Aktionen nicht adressierbar; der Adapter
verlangt eine nicht per JSON fälschbare Symbol-Capability. Kein eigener PouchDB-Handle.

Die Referenzzahl eines Chunks entspricht der Zahl seiner Verweise in dauerhaften
Objekt-/Uploadmetadaten. Die Bereinigung errechnet diese Zahlen unter derselben
Tenant-Schreibqueue und entfernt nur nicht mehr referenzierte Chunks. Zwischen Akten
desselben Tenants wird die Datei über Hardlinks geteilt; deren Linkzahl bildet die
physische Aktenreferenzzahl ab. Ein anderer Tenant erhält stets eigene Dateien/Inodes.
Auch bei bekanntem Hash werden fremde oder unsichtbare Quellakten nicht verwendet.
Fehlt eine gemeinsame Hardlink-fähige Ablage, muss das Datenvolume entsprechend
bereitgestellt werden; andere Dateisystemfehler werden gemeldet und nicht verschluckt.

Aktenmutationen verwenden `project-file.ingestMutation` mit interner Capability und
derselben Queue wie `archive`, `delete`, `setLifecycle` und `registerComponent`.
Ein laufender Job hält diese Grenze bis zum Ende; Archivieren/Löschen wartet darauf.
Zusätzlich serialisiert eine Tenant-Queue Deduplizierung, Reservierungen und Freigaben
über mehrere Akten. Die Implementierung setzt die vorhandene einzelne Broker-Instanz
voraus; für mehrere Prozesse mit gemeinsamem Datenvolume wären verteilte Locks nötig.

`project-upload.deleteProject` bestätigt `{ deleted: true }` erst nach Entfernung
aller eigenen Metadaten, unvollständigen Uploads und `chunks/`. Es entfernt das
Aktenverzeichnis nur, wenn dieses leer ist. SQLite und andere künftige Bestandteile
behalten ihre eigenen Cleanup-Handler aus #883. Fehler lassen sich idempotent wiederholen.

### Limits, Plattenprüfung und Ablauf

| Konfiguration | Standard | Bedeutung |
| --- | --- | --- |
| `CET_PROJECT_MAX_BYTES` | 2147483648 | Gesamtbudget je Akte, höchstens 2 GiB |
| `CET_PROJECT_MAX_FILES` | 10000 | Objekte einschließlich Originalarchive und Uploadreservierungen |
| `CET_PROJECT_MAX_FILE_BYTES` | 2147483648 | Größe je Objekt, höchstens Gesamtbudget |
| `CET_PROJECT_CHUNK_BYTES` | 8388608 | Chunkgröße, effektiv 64 KiB bis 64 MiB |
| `CET_PROJECT_UPLOAD_TTL_HOURS` | 24 | Ablauf unvollständiger/fehlgeschlagener Uploads; verlängert bei Chunkempfang |
| `CET_PROJECT_MIN_FREE_BYTES` | 67108864 | freie Plattenreserve zusätzlich zum nächsten Schreiben |
| `CET_PROJECT_ZIP_MAX_ENTRIES` | 10000 | Einträge pro Archiv; zusätzlich Gesamtdateibudget der Akte |
| `CET_PROJECT_ZIP_MAX_RATIO` | 200 | maximale Expansionsrate je Eintrag |
| `CET_PROJECT_ZIP_MAX_DEPTH` | 4 | rekursive ZIP-Ebenen |
| `CET_PROJECT_ZIP_PATH_DEPTH` | 32 | Pfadsegmente eines Archiveintrags |

`tenant-quota.setQuotas` kann die vier Limits je Tenant über `project_max_bytes`,
`project_max_files`, `project_max_file_bytes`, `project_chunk_bytes` überschreiben;
0 erbt den Env-Standard. Auch unvollständige Uploads reservieren ihre angekündigte
Größe und Datei-Anzahl. Original-ZIP und entpackte Einträge zählen beide zum Budget,
einschließlich verschachtelter Archive. Das begrenzt die tatsächlich gehaltenen Originale
und die Expansion **je Akte**. Job-Anzahl und Ausführung verwenden unverändert die
vorhandene Tenant-Quote `max_async_jobs_per_day` des Job-Runners.

Vor dem Uploadstart, jedem Chunk und Archivspool wird `fs.statfs` geprüft; Entpacken
reserviert für den jeweiligen Eintrag zusätzlich temporäre Datei und Chunkkopie.
Fehlender Platz liefert 507, überschrittene Größen-/Dateibudgets 413. Temporäre Dateien
werden bei Fehlern entfernt. Freiplatzprüfung ist keine Betriebssystemreservierung;
externe Schreiber können weiter ENOSPC verursachen, das als Job-/Schreibfehler sichtbar
wird. Der Prozess hält Streams und höchstens einen Chunkpuffer, kein ganzes Archiv.

Es gibt bewusst keinen neuen Produktions-Timer. Die geschützte interne Aktion
`project-upload.purge({ projectId })` und jeder Uploadstart räumen abgelaufene,
nicht aktive Uploads sowie verwaiste temporäre Dateien auf. Das folgt dem bestehenden
`files.purge`-Muster. Betreiber können `purge` über ihre vorhandene Wartung anstoßen;
inaktiven Akten ohne Wartungsaufruf werden die Daten erst beim nächsten Start oder
bei Aktenlöschung freigegeben. Erfolgreiche Aktenoriginale haben keine Retention.
Verwaiste `receiving`-Komponenten können bis zur Aktenlöschung konservative
Clearanceanforderungen behalten (Zähler bleiben null), analog zur #883-Registrierung.

### Archivschutz, Scanner und Events

ZIP und ZIP64 werden ohne neue Abhängigkeit gelesen: zentrale Verzeichnisse über
positionsbasierte `fs.read`-Aufrufe, Inhalte über `createInflateRaw` und Streams.
ZIP64 wird auch für kleine Archive unterstützt, wenn der Writer ZIP64-Felder erzwingt.
Mehrplattenarchive sind ausgeschlossen. Gemeinsame Regeln aus `archive-entry-policy`
schützen sowohl Office- als auch Projektarchive: kein Traversal, absolute Laufwerks-/
Unixpfade, Backslashes, Steuerzeichen oder verschlüsselte Einträge. ZIPs verwerfen
zusätzlich Symlinks, doppelte Namen, ungültige lokale Header, CRC32-/Größenfehler,
überlange Namen und überschrittene Anzahl-, Kompressions-, Pfad- und Rekursionsgrenzen.
Expansion wird bereits vor der Allokation anhand der Metadaten geprüft und während
des Entpackens erneut auf die deklarierte Größe begrenzt. Office-Inhalte selbst werden
erst im späteren Verarbeitungsschritt analysiert; dessen zusätzliche Formatregeln
bleiben im bestehenden Office-Helfer erhalten.

Der optionale `CET_FILE_SCAN_ACTION` wird über denselben `scanOriginal`-Helfer wie beim
Chat-Dateipfad aufgerufen. Für Akten erhält der Scanner `{ mimeType, hash, size }`
und `ctx.stream` statt eines großen `bytes`-Buffers. Ein kompatibler Scanner muss
den Stream konsumieren und explizit `{ clean: true }` liefern. Timeout/Nichterreichbarkeit
oder negatives Ergebnis verhindern `received` und den erfolgreichen Objekt-Handoff.
Die Byte-/Scan-Schnittstelle des Chat-Dateikanals bleibt unverändert.

- `project.ingest.progress.v1 { tenantId, projectId, objectId, phase, done, total }`:
  `receiving`, `verifying`, optional `scanning`, für Archive `unpacking`, danach
  `received` oder `failed`. Bytes sind die Einheit außer bei `unpacking` (Einträge).
- `project.object.received.v1 { version: 1, tenantId, projectId, objectId }`:
  nach erfolgreicher Registrierung und persistiertem Empfang jedes Objekts.
  #885 kann darüber strukturieren; Verbraucher müssen anhand `objectId` idempotent sein.
- Bestehendes `project.lifecycle.v1`: `ingesting` beim Einreihen, `ready` nach Erfolg,
  `degraded` bei Fehlern, ohne archivierte/gelöschte Akten wiederzubeleben.

#885 kann Originaldaten intern über die autorisierten Metadaten und `objectBytes`
streamen und SQLite im gleichen Aktenverzeichnis halten. #890 kann darauf einen
separat autorisierten Download-/Range-Transport und UI-Fortsetzung aufbauen.
Öffentlicher Originaldownload, Inhaltsanalyse und automatische Wiederholung von
teilweise fehlgeschlagenen Strukturierungsjobs sind hier nicht vorgezogen.

### Reproduzierbare Speicherprüfung

```bash
# CI-Variante: 16 MiB, keine externen Tokens/Server erforderlich
NODE_OPTIONS=--experimental-vm-modules npx jest --coverage=false tests/project-ingest.integration.test.js
# Lokale große Variante: generiertes ZIP selbst >= 1 GiB, drei Formate
CET_PROJECT_LARGE_BYTES=1073741824 node scripts/test-project-ingest-large.js
```

Alle Testdateien entstehen unter `/tmp` und werden entfernt. Der große Test schreibt
die Eingabe inkrementell, durchläuft Chunkupload, Gesamthash, ZIP-Expansion und Cleanup.
Die Messung erfasst RSS/HeapUsed alle 20 ms sowie an Chunkgrenzen; feste Obergrenzen:
**+256 MiB RSS und +128 MiB HeapUsed** gegenüber dem Startwert, unabhängig von Dateigröße.
Messung vom 15.10.2026 (Node 24.18.0): Archiv 1.073.743.248 Bytes, insgesamt
2.147.482.072 Bytes in vier Objekten, Chunkgröße 8 MiB, Laufzeit 26.110 ms.
RSS 72.843.264 → Spitze 243.339.264 Bytes (+170.496.000), HeapUsed
13.718.672 → Spitze 58.408.392 Bytes (+44.689.720). Die Messwerte beschreiben
diesen Lauf; das Prüfkriterium bleibt der feste Speicherzuwachs.

## Strukturierung im Datenstrom (#885)

`project-structure` ergänzt den bestehenden Objektvertrag, Object Store und
Akten-Mutationslock. Der Ingest ruft nach dem **persistierten** Empfang und
`project.object.received.v1` die geschützte Aktion
`project-structure.run({ projectId, objectId })` mit Symbol-Capability auf.
Dieser interne Handoff läuft noch unter demselben Aktenlock. Es gibt keine neue
REST-Schreibroute oder Gateway-Rollenausnahme. Ein fehlender optionaler Strukturierer
belässt Originale wie in #884 auf `pending`.

Beim Dienststart liest ein capabilitygeschützter, paginierter Object-Store-Adapter
dauerhafte `received`-Objekte und verarbeitet fehlende, unterbrochene, fehlgeschlagene
oder veraltete Ableitungen erneut. Der interne Worker verwendet die persistierte
Actor-/Tenant-Herkunft; Akten-Mitgliedschaft, Archivierung und Löschmarkierung werden
erneut an der Akten-Mutationsgrenze geprüft. Nicht mehr sichtbare/änderbare Akten
werden übersprungen, niemals reaktiviert. Dafür werden keine Zugangsdaten persistiert.
Die interne Worker-Rolle dient nur dem vorhandenen Principal-Vertrag, nicht REST-RBAC.

```js
ProjectObject {
  // unveränderter Empfangsvertrag aus #884
  extraction: {
    status: 'pending' | 'processing' | 'extracted' | 'failed',
    reason?, cleanupReason?, at?
  },
  derivation: {
    version: '1', hash, type,
    datasets: ['ds_…'], documents: ['doc-…-v1'],
    obsoleteDatasets: []
  }
}
```

Der Abschluss ist idempotent je `objectId`, Inhaltshash und `derivation.version`.
Deterministische Dataset-IDs enthalten Inhaltshash, Objekt-ID, Blatt und Parser-Version;
Tenant-IDs werden dafür nicht gehasht. Tabellen-IDs werden **vor** dem ersten Batch
persistiert. Bei Wiederholung werden vorherige Ableitungen und verwaiste Tabellen
dieses Objekts aufgeräumt; ein persistiertes `obsoleteDatasets` schützt auch das
Absturzfenster beim Versionswechsel. Ein Parser-Update erhöht `VERSION` in
`src/project-structure-policy.js`, danach verarbeitet der nächste Dienststart neu.
Ein interner erneuter `run` kann fehlgeschlagene Objekte ohne Neustart wiederholen.

Unbekannte Dateitypen behalten ausschließlich ihr Original und erhalten
`extracted` mit Grund `Unsupported object type; original retained`. Erkannte, aber
beschädigte/zu große Dateien erhalten `failed` mit Grund. Fehler eines Objekts
entfernen dessen unvollständige Ableitungen und setzen die Akte auf `degraded`;
andere Originale und fertige Datensätze werden weiter verarbeitet. Fortschritt nutzt
`project.ingest.progress.v1`, Phase `structure`: `done` zählt verarbeitete Zeilen
bzw. Dokumentabschnitte; `total: 0` bedeutet unbekannten Umfang, `1/1` Abschluss,
`0/1` Fehlschlag. Der dauerhafte Objektstatus ist für Wiederaufnahme maßgeblich.

### Akteneigene SQLite und Query-Adapter

```text
CET_PROJECT_DATA_PATH/id-<encodeURIComponent(tenantId)>/
  id-<encodeURIComponent(projectId)>/project.sqlite
```

`ProjectDatasetPool extends DatasetSqlitePool` bindet einen Pool fest an genau einen
Tenant und eine Akte. Verzeichnisprüfung und kodierte Segmente kommen aus
`project-file-disk`; SQLite-Datei und etwaige WAL-/SHM-Dateien dürfen keine Symlinks
sein. Neue Dateien entstehen mit 0600, Verzeichnisse mit 0700. Die geerbten
Tabellen-/Query-Helfer und der vorhandene SQLite-Backend-Lifecycle werden wiederverwendet;
`dataset.query` wählt den Adapter anhand autorisierter `provenance.projectId`.
Gesundheits- und Zeitqualitätsprüfungen verwenden für Akten `COUNT(*)` und geordnete
SQLite-Iteratoren, keine Materialisierung aller Rohzeilen. Chat-Datensätze bleiben
im unveränderten tenantweiten Pool.

Schema-Konventionen:

- `ds_<32 hex>`: bestehendes Dataset-Schema mit `row_number INTEGER PRIMARY KEY`,
  `utc TEXT`, `local_time TEXT`, `c0 … cn` (`REAL` oder `TEXT`). Die Zuordnung zu
  Originalspalten bleibt im vorhandenen Dataset-Katalog der Datapoint-PouchDB.
- Indizes auf `utc`, erkannten Zeitspalten und Schlüssel-/Kennungsspalten.
- `project_candidates`: Kandidaten für #886, siehe unten. Keine Tabellen anderer Akten.

Nach dem Schreiben werden Indizes erstellt und WAL gecheckpointet; geschlossene
Writer hinterlassen eine mit `better-sqlite3({ readonly: true })` lesbare Datei.
#888 muss genau diesen Pfad autorisieren und read-only öffnen. Tabellen anderer
Akten sind physisch unerreichbar. Tabellen-/Spaltenreferenzen aus Skills bleiben
gegen den autorisierten Katalog zu prüfen; eine beliebige Pfadangabe ist kein
Zugriffsvertrag. Bei parallelen zukünftigen Interpretern gilt der bestehende
SQLite-Snapshot-/WAL-Vertrag; der aktuelle Broker ist weiterhin ein einzelner Prozess.

### Streaming und vorhandene Parser

CSV/TSV liest `objectBytes` zeilenweise über Chunkgrenzen, einschließlich Quotes,
mehrzeiliger Zellen und CRLF. `csv.connector` liefert Trennzeichenerkennung,
Encoding-Normalisierung und den gemeinsamen `csv-text`-Feldparser. BOMs erkennen
UTF-16; UTF-8 wird validiert, bei nicht gültigem UTF-8 im Anfangsblock wird
Windows-1252 gewählt. Ein späterer Kodierungsfehler wird abgelehnt. Es gibt kein
stilles Abschneiden. Zeilen-/Spaltengrenzen sind von #774 getrennt.

XLSX verwendet `project-file-zip` für ZIP/ZIP64, Archivschutz und CRC32. Jeweils
ein XML-Eintrag wird auf Platte gespult und mit dem SAX-Parser verarbeitet;
der Arbeitsspeicher enthält höchstens eine Zeile sowie begrenzte Shared Strings
und Metadaten. Es gibt kein `XLSX.read` und keine Gesamtentpackung im Speicher.
Blattnamen und Beziehungen kommen aus Workbook-XML; jedes Blatt wird ein Dataset
mit `provenance.sheet`. Shared Strings/Inline Strings, sparse Zellen, Datumstypen
über das vorhandene `XLSX.SSF`, 1904-Kalender und gecachte Formelergebnisse werden
unterstützt. Fehlende Formelergebnisse, Fehlerzellen, externe Beziehungen,
Makros und XML-Entitätsdeklarationen werden abgelehnt.

Profilierung verwendet `tabular-intelligence.profileRows` auf einer begrenzten
Stichprobe. Nullzahlen und numerische Min/Max/Mittelwerte werden während der
Batch-Verarbeitung fortgeschrieben; Distinktheitswerte bleiben Schätzungen aus der
Stichprobe (`sampledRowCount`). Semantik und Query-Planung verwenden unverändert
`dataset-semantics`; Prompts enthalten Profile/Statistik/Schema, niemals Rohzeilen
oder Zellbeispiele. `dataset-time` normalisiert Batches mit fortgeführtem Zeitstatus,
auch über die doppelte Ortszeit bei Zeitumstellungen hinweg. Transaktionen,
Zeilen- und Bytebudgets begrenzen jeden Schreibbatch; Freiplatz wird erneut geprüft.

Strukturierte Nachrichten verwenden den vorhandenen Adapterkatalog
`structured-message-adapters.json` einschließlich des bestehenden
EDIFACT-/MSCONS-Parsers, der Referenzauflösung und `queryStructured`. Diese vorhandenen
Parser sind nicht streamingfähig und werden deshalb durch ein eigenes Bytebudget
begrenzt; es gibt keinen zweiten Nachrichtenparser.

### Dokumentwissen und Prompts

PDF nutzt dieselbe `createPdfParser`-Factory wie der File-Channel, dateibasiert und
seitenweise. DOCX/PPTX nutzt denselben Archivschutz und den SAX-Reader für
Absätze/Folien; DOCX-Heading-Stile erhalten den Kapiteltitel. TXT/EML werden als
Textabschnitte verarbeitet. `documentSections`, `knowledge-rag-chunker`,
`tenant-document-knowledge` und `workbench-document-knowledge` bleiben zuständig für
Passagen, Fundstellen, RAG und Teamgedächtnis. Beim Ingest wird die Duplikatprüfung
für Akten auf den jeweiligen Originalabschnitt begrenzt; die Passagensuche arbeitet
paginiert mit begrenzter Treffermenge.

Jeder Abschnitt erhält `provenance.projectId`, `provenance.objectId` und
`sourceLocation { page?, slide?, chapter? }`, auch in Such-/RAG-Herkunft.
Die Rohdaten-Grenze gilt für Tabellen: Generierungs-Prompts erhalten Profile,
Statistik und Schema, keine Rohzeilen oder Zellwerte. Dokumenttext wird dagegen
wie bei Chat-Dokumenten als untrusted `document` abschnittsweise im bestehenden
Extraktions-Prompt übergeben. Aussagen durchlaufen `memory.start` mit deferred
Verarbeitung und regulärer Schema-/Zitat-/Anker- und Wechselwirkungsprüfung.
`documentSource.projectId` und `objectId` bleiben als Herkunft erhalten.

Die Gedächtnisextraktion ist standardmäßig auf 50 Abschnitte je Original und 500
je Akte begrenzt (je tatsächlichem Extraktions-Prompt, auch bei weiteren Unterteilungen).
Der Originaldatensatz speichert `memory: { attemptedSections, extractedSections,
skippedSections }`: Versuche werden unter dem vorhandenen Aktenlock **vor** dem
LLM-Aufruf reserviert; auch fehlgeschlagene Versuche verbrauchen das Budget.
`attemptedSections` bleibt bei Wiederaufnahme/Neuverarbeitung erhalten, während
`extractedSections` und `skippedSections` den letzten Verarbeitungslauf beschreiben.
Die Aktengrenze summiert die dauerhaften Versuchszähler aller Originale derselben
Akte. Für Altobjekte ohne Zähler beginnt die Zählung mit dieser Implementierung.
Die Limits sind positive ganze Zahlen; eine Anhebung erlaubt zusätzliche Versuche
bei einer expliziten Neuverarbeitung. Erfolgreich strukturierte Objekte werden
nicht allein wegen geänderter Limits erneut verarbeitet.

Abschnitte über dem Budget bleiben vollständig im Dokumentwissen und RAG suchbar;
nur die Gedächtnisextraktion wird ausgelassen. `extractedSections` zählt abgeschlossene
Extraktionsaufrufe, auch ohne Aussagen; der Prüfstatus einzelner Aussagen bleibt
im normalen Gedächtnis gespeichert und kann weiterhin `pending` sein. Alle
LLM-Aufrufe einschließlich Embeddings und Aussagenprüfung laufen über `llm-client`
mit dessen regulären Quoten. Leere Scan-PDFs scheitern mit OCR-Grund; OCR gehört
nicht zu #885.

### Entitäts-Kandidaten für #886

Kandidaten liegen bewusst in derselben Akten-SQLite: begrenzte lokale Werte,
gemeinsame Löschung und kein zweiter Metadatenspeicher. Es handelt sich um Rohmaterial,
keine bestätigten Entitäten oder Relationen.

```js
// Tabelle project_candidates (Primärschlüssel über die ersten fünf Felder)
{
  object_id, version, kind, value,
  location: JSON.stringify({ sheet?, row?, column?, page?, slide?, chapter?, line?, field?, offset? }),
  catalog_field: null | 'catalog.field'
}
```

`kind` ist `identifier`, `label`, `location`, `period` oder eine vorhandene semantische
Rolle. Erkennung verwendet Spaltenprofile, `semantic-domains.fieldProfiles`,
`workbench-identifier-kinds` und konfigurierte Muster aus `workbench-code-catalog`.
Dokumente liefern Abschnittstitel, beschriftete Felder und katalogbasierte
Kennungsmuster. Werte werden auf 1000 Zeichen und insgesamt auf das Kandidatenbudget
je Original begrenzt. #886 muss diese Stichprobenherkunft und mögliche Begrenzung
berücksichtigen; hier werden keine Beziehungen hergestellt.

### Scope, Sensitivität und Löschung

Dataset-Katalog und Dokumentwissen prüfen bei Abrufen die **aktuelle** Aktenliste:
unsichtbare, archivierte oder in Löschung befindliche Akten liefern keine Inhalte.
Der Katalog ergänzt aktuelle `projectRefs`; `workbench-data-scope.scopedDatasets`
bindet Aktendatensätze ausschließlich über passende Gesprächs-/Fallreferenzen oder
explizit übergebene strukturelle `projectIds`. Ein gleichlautender Dateiname allein
eröffnet keinen Scope. Referenzänderungen wirken ohne erneutes Strukturieren.
Bestehende Chat-Bindungen bleiben unverändert.

Jedes Objekt registriert vor der ersten Ableitung die stabile Dokumentbestand-/Cleanup-
Komponente `structure:<objectId>`; jeder fertige Datensatz registriert zusätzlich seine
stabile Dataset-ID mit `stats.datasets: 1`. Alle Komponenten verwenden die tatsächliche
Originalsensitivität, erforderliche Clearance und `project-structure.deleteProject`.
Dokumentabschnitte werden in `derivation.documents` gezählt; der Original-Dateizähler
wird nicht durch abgeleitete Passagen erhöht. Wiederholungen setzen veraltete
Dataset-Komponenten auf null, ihre konservative Clearance bleibt bis zur Löschung bestehen. Die interne Löschbestätigung verlangt wie #883
`{ version: 1, tenantId, projectId } → { deleted: true }`. Der Handler entfernt
Dataset-Katalogeinträge, Dokumentpassagen/Vektoren und abgeleitete Gedächtniswerte,
schließt gecachte Query-Pools und entfernt SQLite samt WAL/SHM und Kandidaten.
Er funktioniert auch, wenn der Original-Cleanup die Objektmetadaten bereits entfernt
hat. Bestehende Audit-/Dokumenttombstones enthalten keine Dokumentkörper mehr.
Aktenlöschungen erzeugen keine Chat-Replay-Sperren. Wiederholte Aufrufe sind idempotent;
fehlgeschlagene Handler blockieren weiterhin die endgültige Aktenlöschung.

### Getrennte Strukturierungslimits

| Variable unter `CET_PROJECT_` | Standard | Bedeutung |
| --- | --- | --- |
| `DATASET_MAX_ROWS` | 5000000 | je Blatt/Tabelle |
| `DATASET_MAX_COLUMNS` | 512 | je Blatt/Tabelle |
| `DATASET_BATCH_ROWS` / `DATASET_BATCH_BYTES` | 1000 / 4194304 | Schreibbatch; höchstens ein zusätzlicher begrenzter Datensatz |
| `DATASET_SAMPLE_ROWS` / `DATASET_SAMPLE_BYTES` | 256 / 1048576 | Profilstichprobe |
| `DATASET_MAX_RECORD_CHARS` | 1048576 | einzelne CSV-Zeile/XML-Einheit |
| `XLSX_SHARED_STRING_BYTES` / `XLSX_SHARED_STRING_COUNT` | 16777216 / 100000 | Shared-String-XML und Einträge |
| `OFFICE_MAX_EXPANDED_BYTES` | 2147483648 | gesamtes Office-Archiv; zusätzlich ZIP-Ratio aus #884 |
| `DOCUMENT_SECTION_CHARS` | 12000 | Dokumentabschnitt, mindestens 256 |
| `MEMORY_MAX_SECTIONS_PER_OBJECT` / `MEMORY_MAX_SECTIONS_PER_PROJECT` | 50 / 500 | dauerhafte Gedächtnis-Extraktionsversuche je Original/Akte |
| `MESSAGE_MAX_BYTES` | 16777216 | vorhandene nicht streamende Nachrichtenparser |
| `ENTITY_CANDIDATE_LIMIT` | 10000 | Kandidaten je Original |

`WORKBENCH_DATASET_*` und `CET_FILE_*` bleiben für Chatdaten maßgeblich.

### Reproduzierbare Strukturierungsprüfung

```bash
# Unit-/CI-Variante: generierte CSV, reduzierte Zeilenzahl
npx jest --coverage=false tests/project-structure.test.js tests/project-structure-large.test.js
# Voller Offline-Lauf über Chunkupload, Strukturierung, dataset.query und Cleanup
node scripts/test-project-structure-large.js
# Anpassbare Größe, ohne eingecheckte Großfixtures
CET_PROJECT_LARGE_ROWS=1000000 node scripts/test-project-structure-large.js
```

Alle Eingaben und Datenbanken entstehen unter `/tmp`. Der Großtest misst alle 20 ms
und an Schreibbatchgrenzen RSS/HeapUsed, prüft feste Budgets von +256/+128 MiB und
die bekannte Summe `N*(N+1)/2`. Der Test enthält ein Zeitfeld, damit auch der
große Zeitqualitäts-/Abfragepfad geprüft wird. Messwerte und Checks stehen in
`docs/validation/885-projektakte-struktur.md`.

## Relationsgraph (#886)

`project-graph` speichert Graphdokumente in **derselben** Object-Store-Datenbank.
Es gibt keinen zusätzlichen PouchDB-Handle und keine Graphdatenbank. Die logische
Akte bleibt `tenant:<t>:project_<id>`; die physische Ablage verwendet wie die
vorangehenden geschützten Aktenadapter das nicht generisch adressierbare Präfix
`project-graph:<encodeURIComponent(tenantId)>:<encodeURIComponent(projectId)>:`.
Tenant-IDs werden nicht gehasht. `object-store.projectGraphRecord` ist geschützt,
verlangt eine interne Symbol-Capability und erzwingt Tenant, Akte und `_id`-Bereich
in **jeder** Mango-Abfrage. Zulässige Filter sind ausschließlich skalare Gleichheiten
auf `kind`, `from`, `to`, `relation` und `recordType`; freie Mango-Selektoren werden
nicht angenommen. Compound-Mango-Indizes bestehen auf Tenant/Akte plus jeweils
`from`, `to`, `relation`, `kind`. Änderungen erfolgen über `bulkDocs` mit geprüftem
Batch-Ergebnis. Generische Object-Store-Aktionen können den Präfix nicht adressieren.

### Datenvertrag

```js
ProjectNode {
  nodeId, projectId,
  kind: 'object' | 'dataset' | 'section' | 'entity' | 'skill' | 'external',
  ref, labels: [], attributes: {},
  provenance: { objectId?, hash?, location? },
  derivation: { version: '2' }
}
ProjectEdge {
  edgeId, projectId, from, to,
  relation: 'contains' | 'derivedFrom' | 'describes' | 'sameEntity' |
            'joinsOn' | 'timeAligned' | 'references' | 'answeredBy',
  weight, evidence: [], origin: 'derived' | 'observed' | 'corrected',
  derivation: { version: '2' },
  correctionId?, correctionRefs?, correction?: { kind, actorId, at, ... }
}
```

Interne Dokumente tragen außerdem `tenantId`, `recordType` und PouchDB-Metadaten;
diese Felder entfernt die Lese-API. IDs sind deterministisch aus Inhalts-/Referenz-
und Relationsidentität, unabhängig von einer Tenant-Hashbildung. Datensatzknoten
enthalten Schemaattribute, Zeitraum und Intervall; Entitätsknoten sind weiterhin
belegte **Kandidaten**, keine nachträglich erfundenen Stammsätze. Ihre Referenz und
Herkunft halten Objekt, Wert und Fundstelle einschließlich Blatt/Zeile/Spalte fest.
Wiederholte Werte derselben Objekt-/Spalten- bzw. Abschnittsidentität bilden einen
Entitätsknoten mit `occurrences` und höchstens 16 `sampleLocations`
(gezählt innerhalb des Kandidatenbudgets, keine vollständige Tabellenhäufigkeit); eine wiederholte
Messung erzeugt keine quadratische Menge gleichartiger Entitätskanten. Zeitkandidaten
werden bereits in der SQL-Auswahl ausgelassen, da Zeitrelationen auf Datensatzsemantik beruhen.
`skill` und `answeredBy` sind als Vertrag für spätere Ausbaustufen reserviert.
Externe Knoten verwenden `references` und `origin: observed` an der Kante;
`external` ist ein Knotentyp, keine zusätzliche fachliche Relation.

### Ableitungsregeln und Gewichtung

- `contains` vom Original zu Datensatz, Abschnitt und Kandidat sowie `derivedFrom`
  in Gegenrichtung beruhen auf tatsächlicher Strukturierungsherkunft (Gewicht 1).
- `joinsOn` verbindet unterschiedliche Datensätze anhand normalisierter Spaltenwerte,
  gleicher Typen und Kardinalität. `tenant-memory-store.normalizeAnchor` normalisiert
  auch diese Werte. Die SQL-Abfragen führen `COUNT(DISTINCT …)`, Gruppierung und
  deterministische Bottom-k-Selektion nach SHA-256 **von Werten** in der
  akteneigenen SQLite aus. Maximal 128 verschiedene Werte je Spalte gelangen als
  Sketch in den Prozess; nicht alle Tabellenzeilen. Externe Stichproben behalten
  zusätzlich den zugehörigen Originalwert. Herkunft nennt Spalten, Stichprobengrößen,
  gemeinsame Anzahl, Kardinalitäten und ob die Stichprobe begrenzt wurde.
- `timeAligned` verlangt einen tatsächlichen gemeinsamen Zeitraum und positive,
  kompatible Intervalle: größeres/kleineres Intervall ist eine ganze Zahl ≤ 24.
  Zeitüberdeckung zählt relativ zum kürzeren Zeitraum; Zeitspalten allein liefern
  keine Join-Evidenz.
- `describes` verbindet einen Abschnitt mit einem Datensatz nur bei übereinstimmendem
  normalisiertem Kandidaten-/Sketchwert, passender Abschnittsfundstelle und
  tatsächlichem Vorkommen des Ankers im separat autorisierten Abschnittstext.
  `sameEntity` verbindet wertgleiche Kandidaten, wenn mindestens einer durch eine
  tatsächliche Datensatzspalte belegt ist. Veraltete Kandidatenversionen werden ignoriert.

Überlappung zählt höchstens 0,65, Typgleichheit 0,15, Kardinalitätskompatibilität
0,15, Anker 0,9, Zeitüberdeckung 0,7, Intervall 0,2, Herkunft 1, Katalogmetadaten
0,35 und beobachteter externer Treffer 0,6. Je Evidenzart zählt nur der stärkste
Beitrag; wiederholte gleiche Evidenz kann das Gewicht nicht erhöhen. Summe ≤ 1.
Die Schwelle ist standardmäßig **0,6**. Seltene gemeinsame Werte werden nach
`log(1 + Spaltenzahl/Häufigkeit)` gewichtet, auf seltene paarweise Übereinstimmung
normalisiert und auf 1 gedeckelt. Ab zehn Spalten liefern Werte in mindestens
25 % der Spalten keine Überlappungsevidenz. Sind beide verglichenen Spalten
zu höchstens 10 % verschieden (Distinktheit/Zeilenanzahl), wird die Überlappung
zusätzlich mit 0,1 multipliziert; reine wiederholte Kategorien bleiben so unter
der Schwelle, während der Join zu einem eindeutigen Verzeichnis möglich bleibt.
Ankerbeiträge aus einer solchen wiederholten Spalte werden ebenfalls mit 0,1
abgewertet, damit sie nicht über `sameEntity`/`describes` den Hubschutz umgehen. Das entspricht dem Prinzip aus dem
Funktionsmodell (inverse Häufigkeit, Hub-Abwertung, Evidenzdeckel), nicht dessen
fachlich unabhängigen absoluten Gewichten. Numerische und erkannte Zeitspalten
sowie rein numerische oder sehr kurze Werte liefern keine Join-/Ankerkanten.
Damit bleiben laufende Nummern und generische Zeit-/Statusspalten unter der Schwelle.

Diese bewusste konservative Regel kann kurze oder rein numerische echte Schlüssel
übersehen. Bottom-k und das Kandidatenbudget begrenzen ebenfalls Recall bei großen
Akten. Das Sketch-Verfahren liefert deterministische Stichprobenevidenz, keinen
Beweis einer vollständigen Fremdschlüsselbeziehung. Die Validierungswerte unten
beziehen sich auf die eingecheckten kleinen Sollgraphen; keine universelle Qualitätszusage.

Der Graph ruft **kein LLM** auf. Dadurch kann auch ein LLM-Ergebnis mit frei
erfundenen Kanten keine Relation belegen. Die vorhandene Kandidatenbenennung darf
weiter nur über `llm-client` mit Schema-/Profilmetadaten erfolgen. Graphstichproben
und Zellwerte werden niemals in Prompts übergeben.

### Katalogquellen und externe Stichproben

`evidence-endpoint-catalog` stellt neben dem bestehenden Evidenzkatalog den additiven
Metadatenkatalog `PROJECT_GRAPH_ENDPOINTS` aus `project-graph-endpoints.json` bereit.
Vorhandene Evidenzeinträge ohne expliziten `graphLink` lösen keinen Aufruf aus.
Die neutral arbeitende Verarbeitung kombiniert diese Daten mit `semantic-domains`
und dem generierten Operation-Capability-Index. Ein Katalogeintrag kann angeben:

```js
{
  id, action,
  graphLink: {
    catalogField?, // verweist auf semantic-domains.<domain>.fieldProfiles.<field>
    keyFields: [], formats?: [], pattern?, oeoClasses?: [],
    parameter, defaults?: {}, resultPath, resultField
  }
}
```

Feldaliase/Schlüsselfeldname, Format, katalogdefiniertes Muster oder eine gemeinsame
OEO-Klasse der Spalte müssen passen. OEMetadata-/OEO-Klassifikationen können über
`format` und `oeoClasses` an Spalten sowie `formats`/`oeoClasses` an Katalogeinträgen
angegeben werden; der Kern kennt keine fachlichen Klassen, Muster oder Quellennamen.
Die vorhandenen Katalogmetadaten enthalten noch nicht für jede Quelle solche Angaben.
Neue Quellen brauchen geeignete Metadaten, keine Änderung der Ableitungslogik.
Der initiale produktive Metadateneintrag verweist auf `assets.effective` und den
vorhandenen semantischen Schlüsselprofilvertrag; zwei voneinander unabhängige
Fixture-Endpunkte prüfen denselben generischen Pfad mit anderen Parametern/Antwortformen.

Vor **jedem** Aufruf muss die Operation im Index `consequenceLevel: 'none'`,
`sideEffects: []` und `writesTo: []` deklarieren. Ein HTTP-GET allein genügt nicht.
Aufrufe prüfen zusätzlich die vorhandene `assertReadObservation`-Policy (Scopes,
Rollen und katalogbasierte Governance) sowie vorgegebene `domainsAllowed`. Sie führen
den authentifizierten Principal weiter, entfernen interne
Symbol-Capabilities und setzen `tenantId` abschließend auf den autorisierten Tenant.
Je Lauf sind höchstens 12 Aufrufe mit höchstens drei unterschiedlichen Sketchwerten
je Spalten-/Quellenpaar erlaubt, jeweils 1500 ms Timeout. Nur eine Antwort mit
exakt normalisiert passendem `resultField` in höchstens 100 geprüften Antwortzeilen
zählt als Treffer. Fehler, fehlende Berechtigung, Timeout, leere oder fachfremde
Antworten erzeugen keine Kante. Weder ein Trefferzähler noch LLM-Ausgaben genügen.
Das Budget zählt auch fehlgeschlagene Versuche. Eine externe Kante hat beide
Evidenzarten (Metadaten + beobachteter Treffer). Fehlende Quellenberechtigung wird
nicht durch eine interne Worker-Rolle erweitert.

### Auslöser, Wiederaufnahme und Korrekturen

Nach Abschluss von Ingest/Strukturierung prüft `project-upload.settleLifecycle`
alle Aktenobjekte. Solange ein Objekt noch empfangen wird, queued/processing ist
oder seine Strukturierung pending/processing ist, wird keine Ableitung angefordert.
Das gilt auch für den noch laufenden ZIP-Elternjob. Erst das letzte abgeschlossene
Objekt fordert einen Lauf ohne `force` an. Reservierte Mehrfachuploads sollten vor
dem Abschluss des ersten Uploads angelegt werden; später neu begonnene, unabhängige
Uploads bilden einen neuen Abschluss. Die Strukturierung ruft den Graph nicht pro
Objekt auf. Graphfehler beschädigen keine Originale oder erfolgreichen Strukturierungen.

`project-graph.request` quittiert nur das Einreihen; Uploadjobs warten nicht auf die
Graphberechnung. Je Tenant/Akte gibt es höchstens einen laufenden Auftrag und eine
Dirty-Markierung für einen Folgelauf. Beliebig viele Anforderungen während eines
Laufs belegen damit keinen weiteren Warteschlangenplatz. Ein unveränderter Checkpoint
überspringt die vollständige Berechnung. Es gibt keinen zusätzlichen Timer.

Die Akten-Mutationsgrenze schützt zwei Phasen: Zuerst werden Metadaten und begrenzte
SQL-Sketches/Kandidaten konsistent übernommen, Cleanup registriert und ein dauerhafter
Pending-Checkpoint geschrieben. Der read-only SQLite-Handle wird anschließend
geschlossen. Dokumenttexte werden **nacheinander außerhalb der Mutationsgrenze**
autorisiert gelesen; nur beobachtete, zur Fundstelle und Quellversion passende
Kandidatenanker bleiben erhalten. Volltext und normalisierte Textkopie werden nach
jedem Dokument verworfen. Ankerzahl und Summe ihrer normalisierten Zeichen sind pro
Dokument/Abschnitt und pro Lauf begrenzt. Überschüssige Anker werden ausgelassen;
Herkunftsrelationen und Originaltexte im Dokumentwissen bleiben erhalten.

Gewichtung und externe Beobachtungen laufen ebenfalls außerhalb der Mutationsgrenze.
Vor dem Schreiben werden unter einer neuen Grenze Sichtbarkeit, Mitgliedschaft,
Clearance, Archivierung/Löschung und die vollständige Quell-/Konfigurationsversion
erneut geprüft. Ein inzwischen veränderter Snapshot wird verworfen und koalesziert
neu berechnet; bei noch laufenden Quellen wartet die Ableitung auf deren Abschluss.
Eine inzwischen gelöschte Akte kann nicht wiederangelegt werden. Aktuelle
Kantenkorrekturen werden erst in dieser Schreibphase übernommen. Dadurch blockieren
Dokumentzugriffe und externe Timeouts keine Uploads; nur der konsistente SQL-Snapshot
und die atomar serialisierte Veröffentlichung benötigen die Aktenqueue. Synchrone
SQLite-Scans bleiben Arbeit des einzelnen Brokerprozesses, ohne Thread-Auslagerung.

Die Strukturierungs-Wiederaufnahme wartet nicht auf den noch startenden Graphdienst;
dessen eigener Startup-Scan übernimmt anschließend die fertigen Quellen.
Beim Dienststart scannt `projectGraphSources` dauerhafte abgeschlossene Originale,
übernimmt Actor-/Tenant-Herkunft und aktuelle Clearance und prüft die Berechtigung
erneut. Der Worker besitzt keine persistierten Credentials. Die flüchtige Dirty-Queue
muss nicht persistiert werden: Quellen und Pending-Checkpoint liegen dauerhaft vor.
Der Checkpoint vergleicht Quellenstatus, Hashes/-versionen, Ableitungsversion, Budgets
und Katalog-/Operationsmetadaten. Ein interner `run({ projectId, force: true })`
kann externe Beobachtungen ausdrücklich wiederholen; der Ingest setzt dieses Flag nie.

Ein vollständiger Checkpoint entsteht erst nach allen Graphbatches und aktualisierten
Aktenstatistiken. `bulkDocs` ist keine verteilte Transaktion; teilweise geschriebene
Batches können bis zur Wiederholung existieren. Die Lese-API liefert während Pending
503 statt Teiltreffern. `project.graph.changed.v1` meldet nach Erfolg
`{ tenantId, projectId, nodes, edges, version: '2' }` mit Bestandszählern.
Der abgeschlossene State und das interne Laufergebnis enthalten `anchors` mit
`documents`, `retained`, `chars`, `skipped`, `truncatedDocuments`, `truncated`.
`skipped` zählt tatsächlich beobachtete, wegen Budgets ausgelassene Anker je Dokument;
Mehrfachnennungen desselben normalisierten Werts im Dokument zählen einmal.

Die bestehende Lernschleife akzeptiert `target: 'projectEdge'`:

```js
ctx.call('shared-service-learning.apply', {
  target: 'projectEdge',
  correction: { projectId, edgeId, kind: 'confirm' | 'reject' | 'weight', weight? }
})
```

Der tatsächliche Brokername ist `shared-service-learning.apply`; dessen bestehende
Adminprüfung und reguläre Gateway-Schreibrolle bleiben unverändert. `confirm`
setzt Gewicht 1, `reject` Gewicht 0, `weight` einen Wert im Bereich 0…1. Die bestätigte
Änderung wird im vorhandenen Korrekturaudit und auf der Kante mit `origin: corrected`
persistiert; danach folgt `shared-service.correction.v1`. Die geschützte Graphaktion
prüft Tenant, Actor und aktuelle Aktenmutierbarkeit. Direkte Eventzustellung ist
idempotent; ältere Zeitstempel und die letzten 64 Korrektur-IDs schützen vor Replay.
Neuberechnung erhält korrigierte Kanten samt referenzierten Knoten, auch verworfene
Kanten als dauerhafte Sperre. Diese konservativ erhaltenen Referenzen sind kein
Nachweis, dass eine alte Quelle noch für aktuelle Tabellenabfragen geeignet ist.
Eine weitere explizite Korrektur kann die Entscheidung ändern. Undo verlangt für
Graphkanten eine neue Korrektur; die vorhandene Funktions-Undo-Logik wird nicht verwendet.
Das Funktionsjournal ignoriert den neuen Zieltyp; dessen Audit bleibt in der Lernschleife.

### Lese-API und Löschung

| Aktion | REST unter `/api/project-graph` | Filter/Ergebnis |
| --- | --- | --- |
| `nodes` | `GET /:projectId/nodes` | `kind?`, `label?` (normalisierte Teilzeichenfolge), `limit?` |
| `neighbors` | `GET /:projectId/neighbors` | `nodeId`, `relation?`, `depth?` ≤ 3, `limit?` |
| `resolve` | `GET /:projectId/resolve` | `nodeId`, `depth?` ≤ 3, `limit?`; nur `sameEntity`/`joinsOn` |

Alle liefern `{ nodes, edges, truncated }`, Standardlimit 100, maximal 1000.
Traversierung behandelt Kanten in beiden Richtungen, behält die ursprüngliche
Kantenrichtung im Ergebnis und besucht Knoten höchstens einmal. Verworfene bzw.
unter der aktuellen Schwelle liegende Kanten werden nicht traversiert. `resolve`
liefert belegte Schema-/Kandidatenattribute und Join-Evidenz; es führt keine Tabellen-
abfrage aus. #887/#888 können daraus geprüfte Referenzen übernehmen und müssen
Objekt-/Datasetversion sowie Tabelle/Spalte vor jeder SQLite-Abfrage erneut autorisieren.

Die drei Aktionen sind `x-agentable` und über die regulären MCP-Meta-Lesewerkzeuge
erreichbar. Alle Mutationen und Speicheraktionen bleiben geschützt, ohne REST-Alias.
Es gibt **keine** Ausnahme in `api.service.js` für Schreibrollen. Jede Leseaktion
prüft aktuelle Mitgliedschaft, Tenant und vereinigte Clearance. Archivierte Akten
und Akten mit Löschmarkierung liefern **keine Graph-Lesetreffer** und keine Ableitung;
die generelle Aktenmetadaten-API aus #883 bleibt davon unabhängig.

Die Komponente `graph` registriert konservativ die aktuelle Akten-Clearance sowie
`stats { nodes, edges }` und `project-graph.deleteProject`. Der bestätigte Handler
akzeptiert `{ version: 1, tenantId, projectId }`, entfernt alle Dokumente des
Graphpräfixes in Batches und bestätigt `{ deleted: true }`. Er benötigt weder
Originalmetadaten noch SQLite, funktioniert unabhängig von der Handlerreihenfolge
und bleibt auch bei Wiederholung sowie nach nachträglich gesenkten Limits vollständig.

### Graphlimits

Alle Ganzzahllimits sind positiv; Schwelle ist > 0 und ≤ 1. Die Überschreitung
von Graph-/SQL-Volumenlimits bricht die Ableitung mit wiederholbarem Fehler ab.
Ankerbudgets begrenzen dagegen die Evidenzmenge und werden im abgeschlossenen
State/Laufergebnis ausdrücklich als Kürzung ausgewiesen. Ein Lauf rekonstruiert die Akte und hält deshalb
dieselben Standardbudgets wie der gesamte Graph. Laufbudgets können niedriger sein;
entsprechend größere Akten benötigen eine bewusste Anhebung für Neuberechnung.

| Variable unter `CET_PROJECT_GRAPH_` | Standard | Bedeutung |
| --- | --- | --- |
| `MAX_NODES` / `MAX_EDGES` | 10000 / 30000 | persistierter Bestand je Akte einschließlich Korrekturen |
| `RUN_MAX_NODES` / `RUN_MAX_EDGES` | 10000 / 30000 | maximale Ausgabe einer Neuberechnung |
| `THRESHOLD` | 0.6 | Mindestgewicht automatisch gespeicherter/traversierter Kanten |
| `SKETCH_VALUES` | 128 | verschiedene Werte je Spalte, SQLite Bottom-k |
| `MAX_COLUMNS` | 512 | gesamte geprüfte Spalten je Akte/Lauf |
| `MAX_PAIRS` | 20000 | Spalten-, Zeit-, Anker-/Kandidatenvergleiche |
| `MAX_CANDIDATES` | 10000 | gelesene Kandidaten je Akte/Lauf |
| `DOCUMENT_MAX_ANCHORS` / `RUN_MAX_ANCHORS` | 256 / 10000 | gespeicherte Anker je Dokument bzw. insgesamt im Lauf |
| `DOCUMENT_MAX_ANCHOR_CHARS` / `RUN_MAX_ANCHOR_CHARS` | 16000 / 640000 | Summe normalisierter Ankerzeichen je Dokument bzw. Lauf |
| `EXTERNAL_CALLS` / `EXTERNAL_SAMPLES` | 12 / 3 | Aufrufbudget je Lauf / Werte je Paar |
| `EXTERNAL_TIMEOUT_MS` | 1500 | Timeout je beobachtendem Aufruf |
| `BATCH_DOCS` | 500 | Dokumente pro Object-Store-Batch |

Die SQL-Arbeit ist hinsichtlich geladener Zeilen begrenzt, kann bei großen Tabellen
aber Scans und temporäre SQLite-Sortierung erfordern. Ein einzelner Brokerprozess
serialisiert Snapshot und Veröffentlichung mit Aktenmutationen; die übrige Ableitung
läuft außerhalb dieser Grenze. Multi-Prozess-Locks folgen nicht hier.
Qualitäts- und Sicherheitsprüfungen stehen in `docs/validation/886-projektakte-graph.md`.

## Manifest als dynamischer Evidenzendpunkt (#887)

`project-manifest` erzeugt aus dem abgeschlossenen Graphen eine zusätzliche,
versionierte Beschreibung der beantwortbaren Fragen. Das Manifest ist ein
**Routingkandidat, niemals ein Beleg für Antwortzahlen**. Ein Manifest enthält:

```js
{
  projectId, version, generatedAt,
  summary: { text, sources: [nodeId] },
  entities: [{ name, kind, sources: [nodeId] }],
  timeRanges: [{ from, to, sources: [nodeId] }],
  questionTypes: [{ id, description, inputs: [], skillRefs: [], sources: [nodeId] }],
  externalLinks: [{ endpointId, joinKeys: [], confidence, sources: [nodeId] }]
}
```

Auch die Zusammenfassung und jede Entitäts-/Zeitaussage besitzen mindestens eine
gültige Graphreferenz. Ajv prüft die vollständige Struktur; anschließend werden alle
Knotenreferenzen gegen den Snapshot geprüft. `skillRefs` bleiben bis #889 leer.
Externe Verknüpfungen werden ausschließlich aus vorhandenen, ausreichend gewichteten
`references`-Kanten zu bekannten Katalogoperationen übernommen. Das Modell darf sie
nicht selbst erzeugen. Korrigierte Graphkanten wirken auch auf die Manifestversion.

### Erzeugung, Persistenz und Kosten

`project.graph.changed.v1` führt die authentifizierten Metadaten des Graphlaufs weiter.
Der Manifestdienst fasst Anforderungen je Tenant/Akte zu einem laufenden Auftrag und
einer Dirty-Markierung zusammen. Ein Inhaltscheckpoint aus abgeschlossener
Graphquellversion und Kantenkorrekturen verhindert weitere Modellaufrufe für einen
unveränderten Stand. Startup-Recovery verwendet den vorhandenen paginierten
Graphquellscan und prüft wiederum Sichtbarkeit und aktuelle Clearance.

Der Prompt verwendet eine explizite Feldprojektion: Akten-/Datei-/Abschnittstitel,
Spaltennamen und -typen, Einheiten, Zeitraum sowie Knoten-/Kantenstruktur. Entitätswerte,
Tabellenzeilen, Zellbeispiele, SQL-Sketches, Passagevolltexte und beliebige zusätzliche
Profilattribute sind ausgeschlossen. Die Metadaten sind auf 128000 Bytes begrenzt;
Überschreitungen führen ohne Modellaufruf zum unten beschriebenen Minimal-Manifest.
Alle Modellaufrufe gehen durch `src/llm-client.js`, ohne zusätzliche Provideranbindung.
Je neuem Graphstand erfolgt normalerweise ein Erzeugungsaufruf, mit zehn Sekunden
Timeout und ohne automatische Providerwiederholungen. Ungültige `sources` werden
entfernt; Aussagen ohne verbleibende gültige Quelle werden verworfen. Eine verworfene
Zusammenfassung wird durch den quellengebundenen Aktentitel ersetzt. Ajv und die
strikte Knotenprüfung validieren auch das bereinigte Ergebnis vollständig.

Bleibt kein gültiger Fragetyp, wird **genau einmal** mit einer kurzen Korrektur und
den erlaubten Knoten aus `nodes` neu erzeugt; bis 128 Knoten werden deren IDs
zusätzlich ausdrücklich aufgelistet. Auch nicht parsebare strukturierte Ausgaben
erhalten höchstens diesen einen zweiten Versuch. Bei Provider-/Kontingentfehlern
entsteht kein weiterer Modellaufruf. Scheitert die Erzeugung erneut, entsteht ein
deterministisches Minimal-Manifest aus Titel, aktuellen Datensatznamen, Spalten,
Einheiten, Zeiträumen, Dokumentabschnittstiteln und beobachteten Graphentitäten.
Alle Aussagen behalten gültige Quellen; es werden keine Ergebniswerte ergänzt.
Maximal zwei Erzeugungsaufrufe pro neuem Graphstand, weiterhin koalesziert und
versioniert. Recovery erzeugt auch ein bereits gespeichertes Minimal-Manifest
für denselben Stand nicht nochmals.

Der persistierte Manifest-State `generation` an jedem Versionsdatensatz enthält
`status: ready | degraded`, `attempts`, `discardedReferences`, `discardedClaims`,
`fallback` und einen festen `reason`-Code. Bereinigung, Wiederholung und Minimal-
Rückfall werden als `degraded` protokolliert. Erzeugungsfehler erreichen den Aufrufer
nicht; Rechte-, Archivierungs- und Speichergrenzen bleiben wirksam.
`project-manifest.get` behält den reinen Manifestvertrag. Die sichtbaren Kandidaten
enthalten `generation` separat; die Diagnose der besten Akte übernimmt diesen State.
Auch ein degradiertes Manifest bleibt nach den unveränderten Auswahlregeln wählbar.

Snapshot und Veröffentlichung verwenden die vorhandene Akten-Mutationsgrenze;
der Modellaufruf läuft außerhalb dieser Grenze. Vor der Veröffentlichung werden
Graphversion und Berechtigung erneut geprüft. Archivierung/Löschung während eines
Aufrufs verhindert die Veröffentlichung. Ein Manifest zum alten Graphstand wird
bei verändertem oder pending Graph nicht mehr als Kandidat geliefert.

Versionen und akteursbezogene Korrekturen liegen im vorhandenen Object Store unter
`project-manifest:<kodierter Tenant>:<kodierte Akte>:`. Tenantidentitäten werden nicht
gehasht. Die registrierte Komponente `manifest` verwendet
`project-manifest.deleteProject` als bestätigten, idempotenten Cleanup-Handler.
Erfolgreiche Veröffentlichung emittiert
`project.manifest.changed.v1 { tenantId, projectId, version }`.
Es gibt weder neue Umgebungsvariablen noch einen zusätzlichen Datenbank-Lifecycle.

### Sichtbarkeit, Auswahl und Antwort

`GET /api/project-manifest/` (`project-manifest.candidates`) liefert ausschließlich
aktuelle Manifeste sichtbarer Akten in `ready` oder `degraded`.
`GET /api/project-manifest/:projectId` liefert das aktuelle Manifest einzeln.
Tenant, Mitgliedschaft und sämtliche Clearanceanforderungen werden über
`project-file` vor jedem Zugriff geprüft. Leere Akten ohne abgeschlossenen Graph,
`ingesting`, archivierte Akten und jede Löschmarkierung liefern keine Kandidaten.
Die beiden APIs sind lesend und `x-agentable`; Mutationen bleiben geschützt.

Der additive Kandidatenanbieter hängt am bestehenden Evidenzendpunktkatalog;
`dataset-routing.selectProjectCandidates` bewertet die gespeicherten Beschreibungen.
Der Workbench-Pfad prüft passende Akten nach Dateibefehlen/Hintergrundaufgaben und
dem Laden des Gesprächsstands, vor generischen Gedächtnis-/Dataset-/Rückfragepfaden.
Explizite Dokument-/Tabelleneingaben und Anhänge behalten ihren bisherigen Vorrang;
sie werden vor der Prüfung erkannt. Ohne passende Akte läuft die bisherige
Reihenfolge weiter. Der Answer-Dossier-Pfad verwendet denselben
Kandidaten-/Lesepfad und gibt Auswahlhinweise an beide Dossierformate weiter.
Die statischen Katalogeinträge und `workbench-data-scope` bleiben unverändert.

Die Kandidaten enthalten zusätzlich `routingSources`: aktuelle Originaldateinamen,
Datensatztitel, Spaltennamen/-typen, Einheiten aus der Datensatzsemantik, Zeiträume
und Graphanker aus den Entitäts-Kandidaten. Der bestehende aktuelle Graph wird
wiederverwendet; der tenant-/rechtegeprüfte Dataset-Katalog wird höchstens einmal
je Kandidatenliste gelesen. Keine Rohzeilen oder Zellbeispiele in dieser Projektion.
Diese Metadaten bleiben Kandidaten und werden nicht zu Antwortbelegen.

Ohne ausdrückliche Aktennennung braucht die Auswahl einen Bezugsanker mit mindestens
zwei relevanten Wörtern und passenden Inhalt **in derselben Quelle**. Identität aus
Datei A und eine passende Spalte aus Datei B reichen nicht. Kleinschreibung,
Umlaut-/ASCII-Varianten, einfache Wortformen und der vorhandene korpusbasierte
Teilwort-Tokenizer erlauben abweichende Manifestformulierungen. Bei Tabellen muss
ein von Identität und Einheit unabhängiger Spaltenbezug passen; bei Passagen können
Abschnittstitel und quellgebundene Fragetypbeschreibungen beitragen. Nur an diese
Quelle gebundene, nicht verworfene Fragetypen sind zulässig. Verweist ein Fragetyp
auf Original-/Entitätsknoten, wird seine Lesebindung um die zugehörige passende
Tabelle/Passage ergänzt; das gespeicherte Manifest bleibt unverändert.

Standardschwellen in `project-manifest.settings.routing` (ohne neue Env-Variablen):

```js
{ minScore: 0.75, minMargin: 0.15, minSubjectCoverage: 1, minContentCoverage: 0.5 }
```

Der Score gewichtet Bezugsdeckung mit 0,45, Inhaltsdeckung mit 0,45 und einen
belegten passenden Zeitraum mit 0,10. Ein fehlender Zeitraum verbietet die Aktenwahl
nicht: der anschließende echte Lesezugriff liefert dafür eine konkrete Lücke.
Jahreszahlen/Einheiten allein und bekannte leere Quellenprojektionen reichen nie.
Mindestens 0,15 Abstand ist auch zu plausiblen Alternativen knapp unter der
Scoregrenze erforderlich. Sonst bleibt die Auswahl offen. Ein ausdrücklich genannter
Aktentitel erlaubt weiterhin eine konkrete Lückenantwort. Persönliche Akten-/Fragetyp-
Korrekturen gelten auch bei Metadatenübereinstimmung. Die Auswahl braucht keine
Modellaufrufe, Embeddings oder externen Suchen pro Turn.

`metadata.projectRouting` ergänzt die Turn-Diagnose: Kandidatenzahl, beste Akten-ID,
Score, Abstand, Deckungen, Zeitraumtreffer, Schwellen und fester Grundcode, etwa
`no_subject`, `no_content`, `no_question_type`, `below_threshold`, `ambiguous` oder `corrected`. Frage,
Aktentitel, Dateiname, Person und Tenant-ID werden nicht in die Diagnose übernommen.
Bei gewählten Akten wird sie zusätzlich im gespeicherten Retrieval-Trace abgelegt.
Der Praxisbericht übernimmt sie bei Akten-Szenarien in JSON und zeigt sie bei roten
Turns in Markdown; ein fehlender Diagnosepfad wird ausdrücklich `not_evaluated`.

Jede gewählte Akte wird sichtbar gemacht:
**„Ich habe dafür die Projektakte ‚…‘ herangezogen.“**
Tabellenwerte stammen anschließend ausschließlich aus `dataset.query` auf der
akteneigenen SQLite. Vorher werden Originalhash, Objekt-/Datasetzuordnung,
Ableitungsversion und Spaltenschema erneut geprüft. Dokumentbelege werden über
`knowledge-rag.documentGet` mit aktueller Original-/Abschnittszuordnung gelesen.
Die Antwort erhält getrennte Herkunft mit Dateiname, Fundstelle und Originalhash.
Fehlende Spalten, Zeiträume, Originalversionen oder Leserechte werden konkret als
Datenlücke genannt; es gibt keine Manifestzahl oder geschätzte Ersatzgröße.

Im Workbench-Turn wird eine belegte Aktenantwort anschließend durch genau einen
`llm-client.generateStructured`-Aufruf mit dem Schema `{ answer }` in deutsche Sätze
ausformuliert („hilfreicher Kollege“). Frage, Aktentitel, abgefragte Werte mit
Herkunft und Lücken bilden den Kontext. Evidenz und Lücken sind ausdrücklich
**untrusted Daten**, niemals Anweisungen; Ergänzungen, Schätzungen und Berechnungen
sind untersagt. Die vorhandenen Helfer `opaqueContext`/`restoreContext` und
`llmOptions` schützen Referenzen und verwenden die Antwortmodell-Einstellungen.
Der Aktenwahlsatz wird immer deterministisch vorangestellt. Strukturierte
`evidence`/`sources` bleiben unverändert, Lücken werden zusätzlich deterministisch
gesichert. Akte und angefragte Katalogquellen müssen getrennt genannt werden.

Jede Zahl des Modelltexts muss nach Normalisierung exakt in den belegten Werten
vorkommen: deutsche/englische Tausender- und Dezimaltrennzeichen, geschützte
Leerzeichen, Apostrophe, Vorzeichen und Exponentialschreibweise werden unterstützt.
Einheitensuffixe beeinflussen den Zahlenvergleich nicht; Einheiten dürfen laut
Prompt nicht geändert werden. Es gibt keine Umrechnung, Rundung oder Toleranz;
auch große Ganzzahlen werden ohne Gleitkomma-Präzisionsverlust verglichen.
Ein einzelner Punkt mit drei Nachkommastellen gilt wie bei der Praxisbewertung
als Tausendertrennung, ein einzelnes Komma als Dezimaltrennung. Zahlen aus der
Frage allein werden nicht als Belege freigegeben.

Unbelegte Zahlen, Schemafehler, Code-/JSON-Ausgaben und Modellfehler führen zum
bisherigen deterministischen Antwortformat; Fehler werden mit `logLlmError`
protokolliert. `LLM_QUOTA_EXCEEDED` zeigt stattdessen die gemeinsame `quotaMessage`
mit Rücksetzmetadaten und sichtbarer Aktenwahl. Kosten: **ein zusätzlicher
Modellaufruf je beantworteter Aktenfrage**, ohne Modellretries, Recovery oder
strukturierten Ersatzaufruf. Ohne gewählte Akte und bei reinen Lückenantworten
entsteht kein Ausformulierungsaufruf. Personal Agent und Answer Dossier nutzen
weiter ihre vorhandene Antwortgenerierung; dort gibt es keine zweite Ausformulierung.

Eine ausdrücklich angefragte Katalogquelle kann über `externalLinks` einen eigenen
Antwortteil liefern. Die aktuelle Graphkante muss weiterhin lesbar sein. Der
Join-Schlüssel wird durch eine zusätzliche, begrenzte `dataset.query`-Aggregation
aus der aktuellen Tabelle gelesen; mehrdeutige Schlüssel ergeben eine Lücke.
Nur Operationen mit `consequenceLevel: none`, leeren `sideEffects`/`writesTo` und
bestandener `assertReadObservation`-Prüfung werden aufgerufen. Tenant, Scopes, Rollen
und `domainsAllowed` bleiben erhalten; interne Symbol-Capabilities werden entfernt.
Die Antwort muss den abgefragten Schlüssel bestätigen. Fremde Tenants und geschützte
Ergebnisfelder werden mit dem bestehenden Workbench-Ergebnisfilter behandelt.
Je Antwort sind höchstens acht Aktenlesequellen und vier externe Leseaufrufe mit
je drei Sekunden Timeout vorgesehen; Katalogantworten sind auf 32000 Bytes begrenzt.
Herkunft bleibt sichtbar getrennt: **„Aus Projektakte …“ / „Aus Katalogquelle …“**.

### Korrekturen und Folgearbeiten

Die vorhandene Lernschleife verarbeitet `target: 'projectManifest'`:

```js
ctx.call('shared-service-learning.apply', {
  target: 'projectManifest',
  correction: {
    projectId,
    kind: 'reject' | 'confirm' | 'entity',
    questionTypeId?, // reject/confirm nur für diesen Fragetyp
    nodeId?, name?  // entity: korrigierte Bezeichnung des referenzierten Knotens
  }
})
```

Korrekturen gelten nur für den authentifizierten Akteur und Tenant; aktuelle
Mitgliedschaft/Clearance und Aktenmutierbarkeit bleiben Pflicht. Dafür ist keine
zusätzliche Adminrolle erforderlich, weil keine gemeinsame Routingentscheidung
anderer Personen verändert wird. Andere Korrekturziele behalten ihre Adminprüfung;
es gibt keine Gateway-Rollenausnahme. Audit, Replay-Prüfung und
`shared-service.correction.v1` bleiben Teil des vorhandenen Ablaufs. Undo verlangt
eine neue bestätigende Korrektur. Die Workbench erkennt **„falsche Akte“** und
**„Fragetyp falsch“** nach einer sichtbaren Aktenwahl; der nächste Turn beachtet die
persistierte Ablehnung. Entitätskorrekturen ändern Auswahlmetadaten, keine Evidenzwerte.

#888 ergänzt weitere begrenzte Auswertungen und komplexere/mengenwertige Joins;
gegenwärtig bleibt ein nicht eindeutiger Join eine explizite Lücke. #889 befüllt
`skillRefs` und erzeugt ausführbare Skills. Beides wird hier nicht vorweggenommen.
Stub-Validierung und der vorbereitete, noch nicht ausgeführte Live-Praxislauf sind
in `docs/validation/887-projektakte-manifest.md` beschrieben.


### Praxisdiagnose bei degradierter Erzeugung

Die Praxisvorbereitung verwendet ausschließlich das Manifest des Produktdienstes.
Ein degradiertes Manifest bricht die Szenarienfolge nicht ab: Der Bericht protokolliert
Status, Grundcode, Anzahl verworfener Verweise und Minimal-Rückfall; der deterministische
Prüfpunkt `project-manifest-generation` wird rot. Antwort- und Herkunftsprüfungen laufen
weiter. Bei einem echten Abbruch enthält JSON/Markdown zusätzlich `abortMessage`.
Bekannte feste Betriebsfehlermeldungen werden erhalten; beliebige Providertexte
werden über die gemeinsame sichere LLM-Fehlerdiagnose ersetzt, damit keine Prompts,
Tabellenzeilen oder Geheimnisse im Bericht landen.
