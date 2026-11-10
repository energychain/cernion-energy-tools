# Rhajaina Assistant Channel – Transport-Spike v1

## Zweck und Ergebnis

AP 16.0 prüft ausschließlich den lokalen Hermes-CLI-Transport zum bestehenden Profil
`rhajaina`. Matrix, Kanban, CRM, Nextcloud, Gateway-Konfiguration und produktive Räume waren
nicht Teil des Tests.

**Ergebnis:** Der robusteste lokal verifizierte Transport ist `hermes -p rhajaina chat` mit

- expliziter Profilbindung über `-p rhajaina`,
- einer benannten Session über `--continue <name> --create-if-missing`,
- Promptübergabe über `--query-file -` statt Shell-Interpolation,
- endlichem Lauf über `--oneshot -Q`,
- engem Agentenlimit über `--max-turns`,
- internem Laufbudget über `--run-budget` und
- einem zusätzlichen, vom aufrufenden Prozess erzwungenen Timeout.

Die Zwei-Turn-Fortsetzung funktionierte und verwendete in beiden Aufrufen dieselbe Session-ID.
Der Agent rief kein Tool auf. Der Test erzeugte nur die technisch unvermeidliche lokale
Hermes-Sessionhistorie im Profil `rhajaina`; er erzeugte keine fachliche oder externe Wirkung.

## Verifizierte Umgebung

- Repository-HEAD: `3765b0bb1b377b85c8b8ea734efa34112c831080`
- Hermes: `v0.21.2 (2026.9.11)`, upstream `5eb99eb2`
- Hermes-Launcher: `/home/clawd/.local/bin/hermes`
- Profilpfad: `/home/clawd/.hermes/profiles/rhajaina`
- Profilmodell: `gpt-5.6-sol` über `openai-codex`
- Gatewayzustand während des Spikes: `stopped`
- Profilbindung wurde zusätzlich über `hermes -p rhajaina config path` geprüft; der Befehl gab
  `/home/clawd/.hermes/profiles/rhajaina/config.yaml` zurück.

Die offizielle Dokumentation bestätigt, dass `-p/--profile` die Sticky-Default-Auswahl für den
jeweiligen Aufruf überschreibt und dass jedes Profil eigene Konfiguration, Sessions und
`state.db` besitzt. Ein Profil ist dabei keine Dateisystem-Sandbox.

## Reproduzierbarer Befehlsvertrag

### Erster Turn: benannte Session kontrolliert anlegen

```bash
SESSION_NAME='ap16-transport-spike-readonly-3765b0b'
RUN_BUDGET_SECONDS=90
CALLER_TIMEOUT_SECONDS=120

printf '%s' "$PROMPT_TURN_1" |
  timeout --signal=TERM --kill-after=5s "${CALLER_TIMEOUT_SECONDS}s" \
  hermes -p rhajaina chat \
    --continue "$SESSION_NAME" \
    --create-if-missing \
    --query-file - \
    --oneshot \
    -Q \
    --max-turns 1 \
    --run-budget "$RUN_BUDGET_SECONDS" \
    --source tool
```

### Folgeturn: vorhandene benannte Session fortsetzen

```bash
printf '%s' "$PROMPT_TURN_2" |
  timeout --signal=TERM --kill-after=5s "${CALLER_TIMEOUT_SECONDS}s" \
  hermes -p rhajaina chat \
    --continue "$SESSION_NAME" \
    --query-file - \
    --oneshot \
    -Q \
    --max-turns 1 \
    --run-budget "$RUN_BUDGET_SECONDS" \
    --source tool
```

`--create-if-missing` gehört nur in den ersten Aufruf. Ein Folgeturn soll bei einem verlorenen
oder falsch geschriebenen Namen fehlschlagen, statt unbemerkt eine neue Konversation zu
beginnen. Noch strenger kann der Aufrufer die nach Turn 1 auf `stderr` ausgegebene Session-ID
speichern und Folgeturns mit `--resume <session-id>` adressieren.

Für programmatische Aufrufer ist `--query-file -` wichtig: Der Prompt kommt über `stdin` an und
wird weder als Shellcode noch als Hermes-Slash-Command interpretiert. Der Aufrufer muss `stdout`,
`stderr`, Exitcode und Laufzeit getrennt erfassen. Erfolg darf nur bei Exitcode `0` angenommen
werden.

## Promptvertrag für den Read-only-Smoke

Turn 1 verwendete folgenden Sicherheitskern:

```text
READ-ONLY TRANSPORT SMOKE, TURN 1 OF 2. Do not invoke any tool. Do not execute
shell commands. Do not create, modify, or delete files, sessions other than
this required chat transcript, configuration, memory, skills, Kanban data,
CRM data, Nextcloud data, or any external state. Do not access or send to
Matrix or any messaging platform. Do not delegate. Remember only for this
existing session the nonce <NONCE>. Reply exactly and only with:
READONLY-TURN1-ACK
```

Turn 2 wiederholte die Verbote ausdrücklich und forderte ausschließlich die Rückgabe des Nonce:

```text
READ-ONLY TRANSPORT SMOKE, TURN 2 OF 2. Continue to obey the prior prohibition:
no tools, no shell, no file/config/memory/skill/Kanban/CRM/Nextcloud writes,
no Matrix or messaging access, no delegation, no external action. Return the
nonce from turn 1. Reply exactly and only in the format
READONLY-TURN2-NONCE:<nonce>
```

Ein produktiver Assistant-Channel-Aufruf muss dieselben Verbote tragen, solange AP 16 nur
read-only freigegeben ist. Eine Persona- oder SOUL-Anweisung allein ist keine technische
Sandbox und ersetzt diesen Vertrag nicht.

## Zwei-Turn-Smoke: Befunde

Benannte Session: `ap16-transport-spike-readonly-3765b0b`

| Prüfung           | Beobachtung                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| Turn 1            | Exit `0`, 12.047 s, Antwort `READONLY-TURN1-ACK`                                 |
| Turn 2            | Exit `0`, 11.126 s, Antwort `READONLY-TURN2-NONCE:AP16-3765B0B-RHAJAINA`         |
| Session-ID Turn 1 | `20261109_182510_c5a695`                                                         |
| Session-ID Turn 2 | `20261109_182510_c5a695`                                                         |
| Resume-Befund     | Turn 2 meldete die Fortsetzung derselben Session mit einem vorhandenen User-Turn |
| Profilbindung     | Read-only-Abfrage in `rhajaina/state.db`: `profile_name='rhajaina'`              |
| Modellbindung     | Read-only-Abfrage: `model='gpt-5.6-sol'`                                         |
| Toolfreiheit      | `tool_call_count=0`; in der Session existieren `0` Nachrichten mit Rolle `tool`  |
| Transcript        | 4 Nachrichten, entsprechend zwei User-/Assistant-Turns                           |
| Ende              | `end_reason='cli_close'`                                                         |

Damit sind Sessionfortsetzung, Kontextübernahme und die Profilzuordnung für den getesteten
CLI-Pfad belegt.

## Fehler- und Timeoutverhalten

### Nicht vorhandene Session ohne Erlaubnis zur Neuanlage

Ein Aufruf mit `--continue ap16-definitely-missing-no-create-3765b0b`, aber ohne
`--create-if-missing`, endete nach 2.332 s mit Exitcode `1` und:

```text
No session found matching 'ap16-definitely-missing-no-create-3765b0b'.
Use 'hermes sessions list' to see available sessions, or pass
--create-if-missing to start a new session with that title.
```

Das ist das gewünschte Fail-closed-Verhalten für Folgeturns.

### Internes Laufbudget

`--run-budget 1` wurde real geprüft. Der Turn antwortete erfolgreich mit Exitcode `0`, benötigte
aber 9.331 s Prozesslaufzeit. Das lokale `--run-budget` ist daher **kein verifizierter harter
End-to-End-Prozesstimeout**. Laut lokaler Hilfe setzt es ein Budget für den Conversation-Run,
warnt intern bei 80 Prozent und begrenzt implizite Provider-Stale-Timeouts; Start-/Transportzeit
kann außerhalb der praktisch beobachteten Ein-Sekunden-Grenze liegen.

Folge: Der Integrator muss zusätzlich einen eigenen Wall-Clock-Timeout erzwingen und darf sich
nicht allein auf `--run-budget` verlassen.

### Aufrufer-Timeout

Der identische Transport wurde mit GNU `timeout` nach einer Sekunde abgebrochen:

- Exitcode: `124`
- Laufzeit: 1 s
- `stdout`: 0 Byte
- `stderr`: 0 Byte
- eine Sekunde später: kein zum Testnamen passender Kindprozess mehr vorhanden

Exit `124` muss als `transport_timeout` behandelt werden, nicht als leere Agentenantwort. Ein
Retry darf dieselbe Session nur nach einer Read-back-Prüfung fortsetzen, weil bei einem Timeout
nicht grundsätzlich beweisbar ist, ob der Provider oder die Sessionpersistierung bereits einen
Teil des Turns verarbeitet hat.

## Abweichungen und Blocker

1. **`--source tool` wird lokal nicht wie dokumentiert persistiert.** Obwohl beide erfolgreichen
   Aufrufe `--source tool` setzten, enthält `rhajaina/state.db` für die Sessions `source='cli'`
   und `hidden=0`. `hermes -p rhajaina sessions list --source tool` fand deshalb keine Session.
   Die Integration darf auf dieser installierten Version nicht davon ausgehen, dass
   Assistant-Channel-Smokes aus den normalen Sessionlisten ausgeblendet sind.
2. **Warnung auf `stdout`.** Vor der eigentlichen Agentenantwort erschien bei erfolgreichen
   Aufrufen `Warning: Unknown toolsets: messaging`. `-Q` garantiert in dieser lokalen
   Profilrealität daher keinen ausschließlich aus Antworttext bestehenden `stdout`-Stream.
   Ein Aufrufer muss die bekannte Diagnose getrennt behandeln und bei jeder unbekannten
   Zusatzzeile fail closed reagieren. Die Profilkonfiguration wurde im Spike nicht geändert.
3. **Version drift zur aktuellen Doku.** Die aktuelle offizielle CLI-Doku beschreibt unter
   anderem strukturiertes `--format stream-json`; `hermes chat --help` der installierten
   Version bietet dieses Flag nicht an. AP 16 verwendet deshalb nur lokal vorhandene Flags.
4. **Sessionpersistierung ist unvermeidlich.** Eine verifizierbare Mehrturn-Fortsetzung schreibt
   die lokale Sessionhistorie in `/home/clawd/.hermes/profiles/rhajaina/state.db`. Ein vollständig
   zustandsloser Read-only-Aufruf kann keine Sessionfortsetzung beweisen. Fachliche Quellen und
   externe Systeme blieben unberührt.
5. **Keine produktive Aktivierung.** Wegen der Source-/Visibility-Abweichung und der
   `stdout`-Warnung ist dieser Vertrag für einen kontrollierten lokalen Adapter geeignet, aber
   noch nicht als unbeaufsichtigter produktiver Assistant-Channel freigegeben.

## No-write-Nachweis und Scope

- Kein Matrix-Aufruf und keine Nachricht an einen produktiven Raum.
- Kein Kanban-, CRM- oder Nextcloud-Aufruf.
- Keine Gateway-Konfigurationsänderung, kein Start und kein Neustart eines Gateways.
- Keine Toolaufrufe durch die zwei Smoke-Turns.
- Keine Änderung an produktiven Repository-Symbolen.
- Lokale, erwartete Nebenwirkung: Hermes-Sessiontranskripte im Profil `rhajaina`.
- Repository-Nebenwirkung: ausschließlich diese Dokumentation.

## Quellen

- Offizielle Profile-Doku: <https://hermes-agent.nousresearch.com/docs/user-guide/profiles>
- Offizielle Sessions-Doku: <https://hermes-agent.nousresearch.com/docs/user-guide/sessions>
- Offizielle CLI-Referenz: <https://hermes-agent.nousresearch.com/docs/reference/cli-commands>
- Offizielle Profilbefehle: <https://hermes-agent.nousresearch.com/docs/reference/profile-commands>
- Lokale Realität: `hermes --version`, `hermes chat --help`, `hermes profile list`,
  `hermes profile show rhajaina`, `hermes sessions list --help` und read-only SQLite-Abfragen
  gegen das profilgebundene `state.db`.
