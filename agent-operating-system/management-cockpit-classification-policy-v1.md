# Management-Cockpit Classification Policy v1

## Zweck

Der Classifier arbeitet deterministisch im Shadow Mode. Er verändert keine Kanban-Karte. Ergebnisse werden ausschließlich als `classification_audit` in der getrennten Management-Projektion gespeichert. Rohkontext aus TWL-private oder Quellen mit unklarer Sensitivität wird weder projiziert noch auditiert.

## Verbindliche Regelreihenfolge

1. TWL-private, private, gemischt-sensitive und unklare Sensitivität ausschließen.
2. Aktive, explizite Scope-Abdeckung als `SCOPE_COVERED` erkennen.
3. Newsletter, Monitoring, Digests und Duplikate als `NOISE` klassifizieren, sofern keine materielle Abweichung vorliegt.
4. `SCHEDULED` nur bei vollständigem Wakeup-Vertrag zulassen: Zeitpunkt, Anlass und Folgeaktion.
5. Externe Bindung, Preis, Angebot, Vertrag, Zahlung, rechtliche Position, produktiver irreversibler Eingriff und Sicherheitsgrenzen als `DECISION_REQUIRED` (echte Optionen) oder `RISK_ESCALATION` klassifizieren.
6. Konkret fehlende persönliche Information oder Datei als `INPUT_REQUIRED` klassifizieren.
7. Abgeschlossene und belegte Ergebnisse als `INFORM_ONLY` klassifizieren.
8. Reversible interne Arbeit als `AUTO_EXECUTE` klassifizieren.
9. Unzureichend strukturierte Fälle als `projection_incomplete` an Rhajaina routen und nicht als Governance-Entscheidung anzeigen.

Frühere Regeln haben grundsätzlich Vorrang. Harte Sicherheits-, Datenschutz-/TWL-, Rechts-, Betrags-, Aktions- und Gültigkeitsgrenzen sind jedoch nicht durch einen allgemeinen Scope übersteuerbar. Ebenso überschreibt eine materielle Abweichung die Noise-Einstufung: Sicherheitsvorfall, Produktionsausfall, Kundenbeeinträchtigung, Fristverletzung oder finanzielle Wirkung bleiben Risiko-Eskalationen.

## Scoped-Approval-Ledger (AP 3)

Die Managementprojektion bindet das bestehende Scoped-Approval-Ledger ausschließlich lesend an. Der Reader öffnet die Datei im Lesemodus, validiert Root-Schema, Scope-Typ, Status, Ablaufzeit und Terms und liefert je Quellkarte eine begründete Entscheidung `covered`, `not_covered` oder `unclear`.

Nur `covered` setzt das flüchtige Klassifikationsmerkmal `scopeCovered`; eine dadurch gedeckte blockierte Folgeaufgabe erzeugt keine Governance Decision. `unclear` gilt ausdrücklich nicht als Freigabe und wird bei einem konkreten Scope-Kandidaten als `RISK_ESCALATION` der Klasse `scope_violation` sichtbar. Abgelaufene, konsumierte oder widerrufene Scopes decken keine Aufgabe. Smoke-/Test-Scopes und bereits terminale Aufgaben werden nicht als gedeckt klassifiziert. Ein Domain-Treffer allein reicht nicht: boardübergreifend sind Source-Referenz, Scope-ID, ein hinreichend spezifischer Pfad oder exakter Tag erforderlich; im gleichen Board ist zusätzlich starker materieller Kontext zulässig. Mögliche Scope-Überschreitungen werden als `unclear` ausgewiesen.

Der Reader erzeugt, ändert, konsumiert, verlängert oder widerruft keine Scopes. Er entblockt keine Kanban-Karte und führt keine externe Aktion aus. Ein fehlendes oder ungültiges Ledger führt zu `unclear`, niemals zu einer impliziten Freigabe.

## Datenschutz- und Schreibgrenzen

- Keine Kanban-Datenbank wird durch Classifier oder Projektor beschrieben.
- Shadow Mode schreibt nur in `classification_audit` der Management-Datenbank.
- Für ausgeschlossene Quellen entsteht kein Audit-Datensatz, weil bereits Metadaten oder Gründe Rohkontext verraten könnten.
- Kommentare und Bodies werden nicht in der Management-Datenbank persistiert.
- `projection_incomplete` ist ein interner Rücklaufstatus, keine Management-Eskalation.

## Qualität

Die handgelabelte Fixture-Suite umfasst mindestens Newsletter, Monitoring-Mail, Rechnungseingang, Preisentscheidung, Angebotsfreigabe, Deployment innerhalb und außerhalb eines Scopes, fehlende Datei, normale Recherche, erledigten Release, echte Wiedervorlage, historisches `scheduled`, Duplikatcluster und TWL-private. Ziel ist mindestens 95 Prozent exakte Übereinstimmung; private Fälle müssen zu 100 Prozent ausgeschlossen sein.
