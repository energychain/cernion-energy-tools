# Management-Cockpit: Matrix Result Listener — Persistenz-Fix (AP 23 Befund)

Stand: 2026-11-15

## Ausgangslage

Im Gespräch wurde zunächst behauptet, es existiere **kein** automatisierter
Prozess, der Matrix-Räume auf strukturierte Fachagenten-Ergebnisse überwacht.
Diese Aussage war falsch und wurde durch direkte Inspektion des laufenden
Systems widerlegt:

- `server.js` konstruiert bei aktivierter Konfiguration (`matrixHandoffEnabled`,
  mindestens ein Eintrag in `ASSISTANT_RESULT_ALLOWED_SENDERS`) bereits
  `createMatrixResultSync(...)` und ruft dessen `poll()` innerhalb einer
  rekursiven `setTimeout`-Schleife (`reconcileLoop`) mit 5–60s Backoff auf.
- Diese Schleife läuft **in-process** im bereits produktiv laufenden
  `agentos-hitl-cockpit`-Prozess (PM2-PID zum Prüfzeitpunkt `867621`,
  Laufzeit 16h), nicht als separater Dienst.
- Live-Konfiguration zum Prüfzeitpunkt (`/home/clawd/.hermes/runtime/agentos-hitl-cockpit/assistant-policy.json`):
  `enabled: true`, `mode: low_risk`, `matrixHandoffEnabled: true`,
  8 konfigurierte `ASSISTANT_RESULT_ALLOWED_SENDERS`.
- Ein direkter Matrix-Readback des referenzierten Handoff-Events
  (`!UnQWIDIWEYIdVwufAm:matrix.stromdao.de`,
  `$97sk2tG6Mz0DAMy__xg54ceRA0uN-7D9_2fywGoVB3U`) war über das
  `rhajaina`-Profil erfolgreich erreichbar.

**Realer Befund statt der ursprünglichen Fehlannahme:** `assistant_results`
enthielt zum Prüfzeitpunkt 0 Zeilen. Die Infrastruktur zum Empfangen und
Verifizieren eines strukturierten Ergebnisses existiert und ist erreichbar;
es wurde aber bislang von keinem Agenten tatsächlich eine Nachricht mit dem
Format `---BEGIN AGENT RESULT---` als Antwort auf ein Handoff-Event in den
überwachten Raum gepostet.

## Tatsächlich gefundener und behobener Defekt

`createMatrixResultSync` hielt den Matrix-Sync-Token (`next_batch`)
ausschließlich im Prozessspeicher (`let token = options.initialToken || null`).
`server.js` übergab nie einen `initialToken`. Das bedeutet konkret:

Bei jedem Neustart von `agentos-hitl-cockpit` — und dieser Prozess wurde im
Rahmen der AP-17–22-Arbeiten mehrfach kontrolliert neu gestartet — verlor der
Sync-Token seinen Stand und der nächste `poll()` begann wieder mit
`since: null`. Laut Matrix-Sync-Vertrag bedeutet das: Wiederaufnahme ab der
aktuellen Serverposition, **nicht** Nachholen der seit dem letzten
erfolgreichen Poll vor dem Neustart verpassten Nachrichten.

Praktisch heißt das: Jede strukturierte Agentenantwort, die exakt im
Zeitfenster zwischen letztem Poll vor einem Neustart und dem ersten Poll
danach eintrifft, wäre unwiederbringlich übersprungen worden — ohne Fehler,
ohne Log-Eintrag, ohne Reconciliation-Fall.

## Fix

- Neu: `lib/matrix-listener-cursor.js` — atomare, dateibasierte Persistenz
  des Sync-Tokens (temp-write + rename, Modus 0600, korrupte/fehlende Datei
  führt zu sicherem Neustart bei `since: null`, nicht zum Absturz).
- `lib/assistant-matrix-result-sync.js` — optionaler `cursor`-Dependency:
  Token wird beim Start aus dem Cursor gelesen (falls kein `initialToken`
  gesetzt ist) und **nur dann** auf Platte geschrieben, wenn der gesamte
  Batch ohne Fehler durchlief. Diese Reihenfolge erhält exakt das bestehende
  At-Least-Once-Retry-Verhalten: ein fehlgeschlagener Batch darf den
  persistierten Stand nicht überspringen.
- Ohne übergebenen `cursor` ist das Verhalten unverändert (reiner
  In-Memory-Token wie zuvor) — vollständig rückwärtskompatibel.
- `server.js` übergibt jetzt `cursor: createMatrixListenerCursor({ file: ... })`,
  Pfad konfigurierbar über `ASSISTANT_MATRIX_RESULT_CURSOR_FILE`,
  Default `<HERMES_HOME>/agent-os/matrix-result-listener-cursor.json`.

## Verifikation

- Neue Tests: `test/matrix-listener-cursor.test.js` (6 Fälle: leer, Rundtrip,
  korrupt, atomar, Reset, ungültiger Wert) und drei ergänzte Fälle in
  `test/assistant-matrix-result-sync.test.js` (Persistenz nur nach
  vollständigem Batch, Wiederaufnahme vom persistierten Stand nach Neustart,
  Rückwärtskompatibilität ohne Cursor).
- Vollständige bestehende Suite nach Fix: alle Fälle bestehen, keine
  Regression; die bereits vor diesem Fix vorhandene Atomaritäts-/Retry-Logik
  bleibt unverändert und getestet grün.
- `npm run check` (Syntaxprüfung aller `lib/`- und `bin/`-Dateien inklusive
  der neuen Datei): bestanden.
- GitNexus `impact` auf `createMatrixResultSync` und
  `createMatrixListenerCursor` (gezielt, nicht der kumulierte Branch-Diff):
  Risiko **LOW**, jeweils genau ein direkter Aufrufer (`server.js`), 0
  betroffene Prozesse/Module.
- GitNexus `detect_changes --scope compare --base-ref origin/main` zeigt
  **high** Risiko über 144 Dateien — das ist der kumulierte Stand der
  gesamten AP-17–22-Branch-Historie, nicht dieser gezielten Änderung. Dieser
  Befund ist hier bewusst getrennt ausgewiesen, um ihn nicht fälschlich als
  Risiko dieses Fixes darzustellen.

## Ausdrücklich nicht behoben durch diesen Fix

- Dieser Fix stellt **keinen** Nachweis dar, dass jemals ein echtes
  Fachagentenergebnis produktiv empfangen und verarbeitet wurde.
  `assistant_results` bleibt bis zu einem realen End-to-End-Test leer.
- Es wurde kein neuer, separater Prozess/PM2-Eintrag eingeführt. Der
  Result-Sync bleibt bewusst in-process im Cockpit-Server, wie im
  bestehenden Design vorgesehen — nicht als eigenständiger Listener-Daemon,
  wie in einem früheren (falschen) Zwischenstand dieses Gesprächs
  vorgeschlagen.
- Ob irgendein Agent tatsächlich in der Lage und instruiert ist, eine
  `---BEGIN AGENT RESULT---`-Antwort auf ein Handoff-Event zu posten, ist
  durch diesen Fix nicht geprüft oder verändert worden. Das bleibt eine
  getrennte, noch offene Voraussetzung für einen realen AP-21/22-Abschluss.
