# Management-Cockpit: AP 19–21 Produktionsabnahme v1

Stand: 2026-11-14
Status: produktiv aktiviert und technisch abgenommen
Release: `c8c5922984e8693e77baeeda2166014f84ba27b2`

## Umfang

Diese Abnahme dokumentiert den produktiven Betriebsstand für:

- AP 19: kontinuierliche, atomar aktivierte Managementprojektion;
- AP 20: persistente Reconciliation-Outbox für Kanban-, Matrix- und Ergebnisstufen;
- AP 21: korrelierter Ergebnisrücklauf und evidenzgebundener Fallabschluss;
- die ergänzten JF-Ansichten für Themenabschluss, Entscheidungen, Abteilungsimpulse, Artefakte und Verlauf.

Sie erklärt AP 22–29 nicht für abgeschlossen und erweitert keine Wirkungsgrenzen des produktiven Low-Risk-Vertrags.

## Produktive Runtime

- Cockpit-Prozess: `agentos-hitl-cockpit`, Release-CWD des oben genannten Commits;
- Projektionsprozess: `agentos-hitl-projection-loop`, Start-zu-Start-Intervall 120 Sekunden, Laufzeitbudget 100 Sekunden, Fehler-Backoff 30 Sekunden;
- LAN-Zugang: `agentos-hitl-cockpit-lan-redirect` auf `10.0.0.101:3938`;
- Managementdatenbank: Schema 6, Modus 0600;
- Assistant-Datenbank: Schema 10, Modus 0600;
- Runtime-Vertrag: `management-cockpit-production-v2`, Modus `low_risk`, `aligned=true`.

## Verifizierte Betriebsmerkmale

1. Release-Manifest: 62 Dateien, Commitbindung und sämtliche SHA-256-Prüfsummen stimmen.
2. Last-Known-Good für den Release ist vorhanden; Rollback restauriert keine Kanban-Datenbank.
3. Beide produktiven SQLite-Datenbanken liefern `integrity_check=ok`.
4. Projektion liest 15 von 15 freigegebenen Quellen ohne Fehler; Frische und Quellenabdeckung sind in API und UI sichtbar.
5. Mehrere aufeinanderfolgende Projektionsläufe enden erfolgreich; ein fehlgeschlagener Lauf kann die letzte gültige Datenbank nicht ersetzen.
6. Health meldet denselben Modus und dieselben fünf Aktionsklassen wie Runtime-Policy und maschinenlesbarer Vertrag.
7. Reconciliation- und Ergebnis-APIs sind produktiv erreichbar; der Server verarbeitet fällige Outbox-Einträge und Matrix-Ergebnisse kontinuierlich.
8. Browser-UAT bestätigt Lage, Entscheidungen, Abteilungen, Verlauf, Themenabschluss und Artefaktbereiche auf Desktop und Mobil ohne horizontalen Seitenüberlauf.
9. Cockpit- und Projektions-Errorlogs sind leer; PM2-Prozesse sind online und in der gespeicherten PM2-Prozessliste enthalten.
10. Private/TWL-Quellen bleiben ausgeschlossen; die produktive Projektion meldet keine Privacy-Gate-Verletzung.

## Wirkung und Grenzen

Der produktive Low-Risk-Regelkreis ist aktiv: Anweisung → bestätigbarer Vorschlag → Kanban-Write → Readback → Receipt → Matrix-Handoff → korreliertes Fachagentenergebnis → Operatorentscheidung → terminaler Readback → Projektion.

Geschäftlich bindende Vorgänge, direkte Management-Decision-Writes, vollständige Agentenabdeckung, Mehragenten-Workflows, vollständige Signalverträge, sichere Dateiübergabe und der 30-Tage-Cutover bleiben Gegenstand von AP 22–29. Bis zu deren Abnahme ist das Cockpit die primäre Low-Risk-Führungsoberfläche, aber noch nicht die alleinige Oberfläche für jede Vorgangsklasse.
