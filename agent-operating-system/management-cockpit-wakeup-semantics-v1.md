# Management-Cockpit Wiedervorlage-Semantik v1

## Zweck

AP 7 modelliert `scheduled` als begründete Wiedervorlage. Der Stand bleibt vollständig lesend: Weder Kanban-Karten noch Status, Kommentare, Scopes oder Signale werden durch den Wakeup-Prozessor verändert.

## Wakeup-Vertrag

Eine neue Wiedervorlage ist nur vollständig, wenn sie folgende Felder besitzt:

- `wake_at`: Unix-Zeitpunkt oder parsebarer ISO-Zeitpunkt;
- `why_scheduled`: fachlicher Anlass;
- `next_action_on_wake`: konkrete nächste Handlung;
- `owner`: verantwortlicher Agent;
- optional `signal_required`: erwartetes neues Signal;
- optional `auto_close_after`: Zeitpunkt, ab dem ein automatisches Schließen fachlich geprüft werden darf.

`auto_close_after` darf nicht vor `wake_at` liegen. Der aktuelle Shadow-Endpunkt für `schedule` validiert dieselben Felder, speichert sie aber nicht.

## Zustände

- `scheduled`: Vertrag vollständig, Termin noch nicht erreicht; in der Lage und in Decisions verborgen.
- `awaiting_signal`: Termin erreicht, das ausdrücklich verlangte neue Signal fehlt; weiterhin verborgen.
- `due`: Termin erreicht und entweder terminbasiert oder das verlangte Signal ist neu; Grund, Signal, Owner und nächster Schritt werden ausgegeben.
- `quality_error`: erneutes Aufwecken ohne Lageänderung; nur als Qualitätsbefund, nie als automatische Statusaktion.
- `invalid_contract`: historische `scheduled`-Karte ohne vollständigen Vertrag; ausschließlich Migrationsreport.

## Historische Karten

Historische `scheduled`-Karten werden ausschließlich mit SQLite `mode=ro` gelesen. Karten ohne Vertrag werden weder ergänzt, entblockt, reaktiviert, archiviert noch geschlossen. Der einmalige Migrationsreport enthält nur Board, Task-ID und fehlende Vertragsfelder.

Beispiel:

```bash
node hitl-cockpit/bin/process-wakeups.js \
  --hermes-home /home/clawd/.hermes \
  --migration-report /tmp/agentos-wakeup-migration.json
```

Der Report wird mit Modus `0600` atomar angelegt. Eine vorhandene Datei wird ohne `--force` nicht überschrieben.

## Signal- und Qualitätsregeln

Ein signalgebundener Vorgang wird erst fällig, wenn `last_signal_at` neuer als `last_woken_at` ist. Ist kein Signal gefordert, ist der Termin selbst der Anlass. Ein erneuter Aufweckversuch mit unverändertem Quellen-Fingerprint beziehungsweise ohne Quelländerung nach `last_woken_at` wird als `repeated_wakeup_without_state_change` markiert.

`auto_close_after` führt in AP 7 nur zu `autoCloseCandidate: true`. Eine Schließung wird nicht ausgeführt.

## Sicherheits- und Rollbackvertrag

- Der Prozessor verwendet den bestehenden read-only Kanban-Reader.
- `sourceMutationCount` bleibt stets `0`.
- Es gibt keinen Hermes-CLI-Aufruf und keine SQLite-Schreibverbindung auf Board-Datenbanken.
- Die produktiven Runtime-Skripte, insbesondere `agent_os_hitl_budget_manager.py`, bleiben unverändert.
- Die Legacy-HITL-Liste bleibt Rückfallansicht.
- Rollback bedeutet, die AP-7-Dateien im isolierten Worktree zu verwerfen; produktiv ist nichts zurückzurollen.
