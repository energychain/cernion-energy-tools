# Management-Cockpit Decision Actions – Shadow-Vertrag v1

## Zweck

AP 6 bildet fachliche Governance-Aktionen mit expliziter Semantik ab. Diese Version läuft ausschließlich im Shadow-/No-write-Modus. Eine Aktion validiert die ausgewählte Decision und den Payload und liefert einen Ausführungsplan zurück. Sie verändert weder Kanban noch Managementprojektion, Scope-Ledger, Wiedervorlagen, Matrix oder andere externe Systeme.

## Sicherheitsvertrag

- `MANAGEMENT_COCKPIT_WRITE_ENABLED=false`
- `MANAGEMENT_COCKPIT_SHADOW_ONLY=true`
- Erfolgreiche Simulationen antworten mit HTTP `202`.
- Jede Antwort weist `mode: "shadow"`, `writePerformed: false` und `persisted: false` aus.
- Der Dienst besitzt in AP 6 keinen Writer und ruft weder Hermes CLI noch Scope-Prozessor noch Matrix auf.
- Wird eine Write-Konfiguration aktiviert, bricht die Implementierung mit HTTP `501 decision_writes_not_implemented` ab. Sie fällt nicht stillschweigend in einen Schreibpfad.
- Decisions werden vor jeder Simulation aus der read-only Projektion neu gelesen.
- Geschlossene, gelöste oder abgelehnte Decisions sind nicht simulierbar.
- TWL-private Decisions gelangen aufgrund der Projektions- und Reader-Filter nicht in diesen Pfad.
- Es wird in AP 6 absichtlich kein Audit-Event persistiert; auch das wäre ein Write.

## Endpunkte

```text
POST /api/management/decisions/:id/choose
POST /api/management/decisions/:id/delegate
POST /api/management/decisions/:id/question
POST /api/management/decisions/:id/schedule
POST /api/management/decisions/:id/reject
POST /api/management/decisions/:id/return-to-rhajaina
```

Andere POST-, PUT-, PATCH- und DELETE-Aufrufe auf `/api/management/` bleiben abgewiesen. Die Legacy-Endpunkte bleiben unverändert.

## Fachliche Payloads

### Option wählen

```json
{ "option": "B", "note": "Pilot auf zehn Fälle begrenzen" }
```

Die Option muss exakt in den projizierten Optionen vorkommen.

### Delegieren

```json
{
  "assignee": "Felix",
  "scopeType": "PUBLISH_SCOPE",
  "validForHours": 48,
  "constraints": ["nur freigegebene Seite"]
}
```

`assignee` ist erforderlich. Ein Scope wird nur als geplante Wirkung ausgewiesen und nicht registriert. `validForHours` ist auf 1 bis 720 Stunden begrenzt.

### Rückfrage

```json
{ "question": "Welche Evidenz trägt die Empfehlung?" }
```

### Wiedervorlage

```json
{
  "wakeAt": "2026-12-01T09:00:00+01:00",
  "reason": "Budgetlage erneut prüfen",
  "nextAction": "Budgetlage und Entscheidungsvorlage aktualisieren",
  "owner": "Anja"
}
```

Der Zeitpunkt muss parsebar und in der Zukunft liegen. `nextAction` und `owner` sind erforderlich. Optional sind `signalRequired`, `autoCloseAfter` und `note`. Es wird keine Wiedervorlage angelegt.

### Ablehnen

```json
{ "reason": "Das Risiko ist noch nicht ausreichend begrenzt." }
```

### An Rhajaina zurückgeben

```json
{ "reason": "Optionen und Konsequenzen vervollständigen." }
```

## Antwortvertrag

```json
{
  "ok": true,
  "mode": "shadow",
  "shadowOnly": true,
  "writePerformed": false,
  "persisted": false,
  "action": "choose",
  "decisionId": "decision_public",
  "source": { "board": "fixture", "taskId": "t_public01" },
  "normalizedPayload": { "option": "B", "note": null },
  "plannedEffects": [
    "source_task_read_back:fixture/t_public01",
    "kanban_comment:decision=decision_public;action=choose",
    "execute_option:B",
    "close_decision_after_read_back"
  ]
}
```

`plannedEffects` beschreibt ausschließlich die spätere Schreibreihenfolge. Kein Eintrag belegt eine erfolgte Aktion.

## UI

Reife Decisions zeigen die sechs Aktionen unter „Entscheidung erproben“. Die Oberfläche benennt den Shadow-Modus ausdrücklich. Nach einer Simulation meldet sie „Nur simuliert“ und prüft zusätzlich, dass der Server keine Persistierung oder Ausführung behauptet.

Die Legacy-HITL-Liste bleibt über alle drei Rückfalllinks erreichbar.

## Aktivierung echter Writes

Echte Writes sind nicht Teil dieses Arbeitspakets. Vor einer begrenzten Aktivierung sind mindestens erforderlich:

1. Gate C mit 14 Tagen Shadow-Daten erfüllen.
2. Write-Adapter mit Versionsprüfung des Source Tasks implementieren.
3. Audit-Event vorsehen.
4. Kanban-Kommentar und Statusänderung idempotent ausführen.
5. Scopes ausschließlich über den bestehenden Scope-Prozessor registrieren.
6. Exakten Source Task zurücklesen.
7. Decision erst nach erfolgreichem Read-back schließen.
8. Allowlist je Decision-Klasse und Aktion einführen.
9. Rollback und Doppelentscheidungs-Reconciliation nachweisen.
