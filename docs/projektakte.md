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
aus Request-Parametern. Die bestehende Gateway-RBAC bleibt maßgeblich für REST-Schreibzugriffe.
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
| `update` | `PATCH /:projectId` | Titel, Mitglieder und Referenzen ersetzen |
| `archive` | `POST /:projectId/archive` | Daten dauerhaft behalten, Routing beenden |
| `delete` | `DELETE /:projectId` | bestätigtes Aufräumen, Audit, Datensatz entfernen |

`get`, `list` und `forReference` sind `x-agentable` und damit über die vorhandenen
MCP-Meta-Tools `cernion_search`/`cernion_describe`/`cernion_execute_read` lesbar.
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
