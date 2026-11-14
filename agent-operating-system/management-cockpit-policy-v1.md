# AgentOS Management-Cockpit Policy v1

Stand: 2026-11-11
Status: fachliche Policy; aktueller Betriebsvertrag ist `management-cockpit-production-contract-v2.md`

## 1. Zweck und Geltung

Das Management-Cockpit ist die verdichtete Geschäftsführungs- und Governance-Sicht des AgentOS. Es zeigt Unternehmenslage, fachlich relevante Themen, belegte Ergebnisse, Risiken, Wiedervorlagen und entscheidungsreife Governance-Fragen. Es ersetzt weder Hermes Kanban als operatives System of Record noch Matrix als Gesprächs- und Arbeitsoberfläche.

Diese Policy beschreibt die bleibenden fachlichen und sicherheitsbezogenen Grenzen. Der einzige verbindliche aktuelle Runtime-Vertrag ist `management-cockpit-production-contract-v2.md`; ältere AP-Dokumente bleiben zeitgebundene Implementierungsnachweise.

## 2. Verbindlicher Systemzustand

- Hermes Kanban bleibt die einzige operative Aufgabenwahrheit.
- Die Managementdatenbank ist abgeleitet, getrennt und vollständig neu aufbaubar.
- Die Legacy-HITL-Liste unter `/` bleibt Rückfallansicht.
- Die Managementsicht unter `/management` ist produktiv als primäre interne Geschäftsführeroberfläche aktiviert.
- Der Rhajaina Assistant Channel läuft im Modus `low_risk` mit bestätigungspflichtigen Low-Risk-Writes und Matrix-Handoff nach erfolgreichem Kanban-Readback.
- Die Management-Decision-API bleibt separat im Shadow-Modus und führt keine direkten Decision-Writes aus.
- Historische `scheduled`-Karten werden ausschließlich gelesen und berichtet.
- Telemetrie läuft ausschließlich im Shadow-Modus und besitzt keine operative Wirkung.
- Der produktive Betriebsnachweis belegt genau einen bestätigten Write→Readback→Matrix-Ablauf einschließlich Idempotenz über einen Prozessneustart.
- Deployments direkt aus einem uncommitteten Worktree bleiben untersagt; Releases werden commitbasiert gebaut und geprüft.

## 3. Verantwortlichkeiten

| Verantwortung                                 | Primär                           | Mitwirkung / Freigabe                       |
| --------------------------------------------- | -------------------------------- | ------------------------------------------- |
| Fachmodell und Governance-Grenzen             | Rhajaina / Geschäftsführung      | Fachagenten                                 |
| Cockpit-Code und Tests                        | DevOps                           | Infrastructure                              |
| Deployment, Backup, Health und Rollback       | Infrastructure                   | DevOps                                      |
| Projektions-Rebuild und Datenqualitätsprüfung | Infrastructure                   | Rhajaina                                    |
| Shadow-Telemetrie sammeln                     | Infrastructure                   | ohne operative Auswertung                   |
| Telemetrie fachlich bewerten                  | Rhajaina                         | Geschäftsführung                            |
| Scope-Freigaben                               | bestehender Scope-Prozess        | Geschäftsführung bei nicht gedeckter Grenze |
| Tokenrotation und Proxy-Loghygiene            | Infrastructure                   | Geschäftsführung bei Zugangsunterbrechung   |
| TWL-/Datenschutz-Incident                     | Infrastructure als Incident Lead | Rhajaina und Geschäftsführung               |
| Erweiterung der Write-Aktionsklassen          | DevOps und Infrastructure        | ausdrückliche Geschäftsführungsentscheidung |

Ein reiner, durch den Rollback-Vertrag gedeckter Cockpit-Rückfall darf durch DevOps oder Infrastructure ohne zusätzliche Einzel-HITL ausgeführt werden. Er muss nachträglich auditiert werden. Kanban-Restore, Tokenrotation, DNS-/Cloudflare-Änderungen und Änderungen an fremden Diensten sind davon nicht gedeckt.

## 4. Datenfluss und Vertrauensgrenzen

```text
Hermes Kanban-Boards (lesen; bestätigte Low-Risk-Writes über Assistant Executor)
Scoped-Approval-Ledger (read-only)
Artifact Registry (read-only)
Matrix Room Registry (read-only)
        |
        v
Source Guard und TWL-Firewall
        |
        v
Classifier / Digest / Topics / Outcomes / Wakeups / Agent Briefs
        |
        v
Management SQLite, Schema v6 (abgeleitet, neu aufbaubar)
        |
        +--> Read API --> Management-UI
        |
        +--> sanitierte Shadow-Telemetrie JSONL
```

Außerhalb der bestätigten Assistant-Low-Risk-Lane sind Quellschreibvorgänge unzulässig. Zusätzlich zulässige lokale Writes sind:

1. Aufbau oder Ersatz der abgeleiteten Management-SQLite;
2. optionales Anhängen eines sanitisierten Shadow-Messpunkts;
3. optionales Erzeugen eines Modus-0600-Migrationsreports zu historischen Wiedervorlagen;
4. Testartefakte in temporären Verzeichnissen.

Projektions-, Telemetrie- und Testwrites haben keine operative Wirkung und dürfen nicht als Routing-, Freigabe- oder Priorisierungssignal verwendet werden. Assistant-Writes benötigen dagegen die im produktiven Betriebsvertrag festgelegten Quell-, Bestätigungs-, Readback- und Receipt-Nachweise.

## 4.1 Rhajaina Assistant Channel

- Ein Klick auf „Mit Rhajaina besprechen“ bindet das ausgewählte Managementobjekt sichtbar als Attachment an einen eigenen Objektthread.
- Der Browser überträgt nur `objectType` und `objectId`; Titel, Scope, Quelltext und Sensitivität werden serverseitig aufgelöst.
- Ein Klick auf eine andere Karte wechselt den Thread sofort und zeigt „Thema gewechselt“. „Globales Gespräch“ entfernt das Objekt-Attachment ohne Texteingabe.
- `read_only` beantwortet nur; `shadow` persistiert nicht ausgeführte Vorschläge; `low_risk`, `scoped` und `productive` benötigen zusätzlich Writes, eine exakte Aktions-Allowlist, Source-Fingerprint und Readback.
- Produktive Auto-Ausführung ist nur bei serverseitig nachgewiesenem Scope möglich. Chattext kann keinen Scope erzeugen oder erweitern.
- Preise, Verträge, Zahlungen, Veröffentlichungen, externer Versand, Deployments, destruktive Aktionen sowie private/TWL-/unklare Kontexte bleiben ausgeschlossen.
- Matrix-Handoffs benötigen ein separates Flag, eine sichere serverseitige Raumreferenz, Loop-Schutz und Readback. Ohne verifizierten Sender bleiben sie `pending`.

## 5. Klassifikation und Sichtbarkeit

Jeder zulässige Quellkandidat erhält genau ein Hauptlabel:

| Label                   | Bedeutung                                                                              | Managementsicht                                          |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `AUTO_EXECUTE`          | reversible interne Arbeit innerhalb Policy                                             | keine Governance-Decision                                |
| `SCOPE_COVERED`         | gültiger Scope deckt die konkrete Folgehandlung                                        | keine neue Mikro-HITL                                    |
| `INFORM_ONLY`           | belegter Abschluss ohne Entscheidung                                                   | Verlauf/Outcome, nicht Governance                        |
| `DECISION_REQUIRED`     | echte fachliche Alternativen erfordern Geschäftsführung                                | nur bei vollständiger Entscheidungsqualität              |
| `INPUT_REQUIRED`        | konkrete persönliche Information oder Datei fehlt                                      | Aufmerksamkeit, keine allgemeine Freigabe                |
| `RISK_ESCALATION`       | rechtliche, finanzielle, externe, irreversible oder Sicherheitsgrenze                  | Risiko-/Governance-Lane                                  |
| `SCHEDULED`             | vollständige Wiedervorlage                                                             | bis Fälligkeit verborgen                                 |
| `NOISE`                 | Routine-Newsletter, bekannte Statusmeldung, Duplikat oder technische Intake-Unterkarte | Digest/Quellenreferenz                                   |
| `projection_incomplete` | notwendige Struktur fehlt                                                              | Rücklauf an Owner/Rhajaina, keine Managemententscheidung |

Materielle Abweichungen haben Vorrang vor Noise. Produktionsausfälle, Sicherheitsvorfälle, Kundenbeeinträchtigung, Fristverletzung und finanzielle Wirkung dürfen nicht als Routine-Noise unterdrückt werden.

Eine sichtbare gewöhnliche Governance-Decision benötigt konkrete Frage, Grund der menschlichen Zuständigkeit, Agentenempfehlung, ausführbare Optionen, Konsequenzen, Nichtentscheidungsfolge, Folgeaktion, Owner und Evidenz. Risiko- und Scope-Eskalationen bleiben als Risiko sichtbar, auch wenn die Optionen noch vervollständigt werden müssen.

## 6. Scope-Nutzung

Das Scoped-Approval-Ledger wird ausschließlich lesend angebunden. Ein Match ist nur `covered`, wenn Status, Gültigkeit, Aktion, Source-Bezug und konkrete Begrenzung konservativ zusammenpassen. Domain-only, generische Pfade, fremde Boards und Smoke-/Test-Scopes genügen nicht.

Abgelaufene, konsumierte oder widerrufene Scopes decken keine Handlung. Fehlendes oder ungültiges Ledger sowie unklare Matches fallen auf `unclear` zurück und autorisieren nichts.

Folgende Grenzen sind durch einen allgemeinen Scope nicht übersteuerbar:

- TWL-/private Datenfreigabe und unsanitizierter Export;
- Secret-, Token- oder Credential-Offenlegung;
- Handlung außerhalb des ausdrücklich erlaubten Aktionstyps;
- produktiv irreversible oder destruktive Aktion außerhalb enger Terms;
- rechtlich oder finanziell bindende Handlung außerhalb des Betrags-/Vertragsrahmens;
- fremdes Board, fremde Gegenpartei oder abgelaufene Gültigkeit;
- Sicherheits- oder Datenschutzvorfall.

Shadow-Delegation plant einen Scope nur als mögliche Folge. Sie registriert, verlängert, konsumiert oder widerruft keinen Scope.

## 7. Wiedervorlagen

Eine vollständige Wiedervorlage enthält:

- `wake_at`;
- `why_scheduled`;
- `next_action_on_wake`;
- `owner`;
- optional `signal_required`;
- optional `auto_close_after`.

Vor `wake_at` bleibt sie aus Aufmerksamkeit und Decisions verborgen. Bei `signal_required` wird sie erst mit einem Signal fällig, das neuer als der letzte Aufweckzeitpunkt ist. Wiederholtes Aufwecken ohne Zustandsänderung wird als Qualitätsfehler markiert. `auto_close_after` ist nur ein Prüfkandidat und führt zu keiner automatischen Schließung.

Historische `scheduled`-Karten ohne vollständigen Vertrag werden nicht ergänzt, reaktiviert, entblockt, archiviert oder geschlossen.

## 8. Topics, Outcomes, Agent Briefs und Digest

Unsichere Topic-Zuordnungen werden nicht automatisch zusammengeführt. Explizite Topic-, Parent-, Artifact-, Scope-Source- oder CRM-Referenzen haben Vorrang. Wortähnlichkeit und generische Begriffe genügen nicht.

Outcomes zählen nur bei terminaler Quelle, zulässiger Outcome-Klasse, materiellem Nachweis und Ereigniszeitpunkt. Interne Recherche, Bericht, Entwurf, Kartenbewegung, Test, Commit, Deployment oder Release ohne belegte fachliche beziehungsweise wirtschaftliche Wirkung sind kein Outcome.

Agent Briefs zeigen für Rhajaina, Felix, Anja, Viki, Cori, DevOps und Infrastructure entweder belegten substanziellen Fortschritt oder einen erklärten Leer-/Zwischenzustand. Technische Aktivität bleibt als Enabler sichtbar und darf keinen Fortschritt vortäuschen.

Noise bleibt mit Board, Task-ID, Topic, Kategorie, Zeitpunkt und Klassifikationsgrund als Digest- oder Quellenreferenz auffindbar. Auto-Close ist in v1 nur eine Empfehlung.

## 9. Kanalidentität und Doppelentscheidungen

Kanalübergreifende Decisions verwenden `DECISION_ID: decision_<id>`. Mehrere Quellen mit derselben gültigen ID werden als ein Decision-Datensatz mit `source_refs` projiziert. Ohne Marker wird nur bei starker exakter Identität zusammengeführt. Ähnliche oder kurze Fragen bleiben getrennt.

Sobald eine explizit verknüpfte Quelle terminal ist, wird die gemeinsame Decision als `resolved` projiziert und verschwindet aus offenen Listen. Die Auditansicht bleibt lesbar.

## 10. TWL- und Sensitivitätsgrenze

Vor jeder Topic-, Decision-, Outcome-, Brief-, Link-, Digest-, Audit- und Telemetrieprojektion werden ausgeschlossen:

- Board `twl-netze-private`;
- rohe Karten aus `twl-netze-bridge`;
- Sensitivitäten `twl-private`, `twl-netze-private`, `private-quarantine`, `private`, `unclear`, `mixed-sensitive`, `secret` und `restricted`;
- TWL-Domänen, -Pfade, -Raumreferenzen und -Artefakte.

Aus der Bridge sind nur ausdrücklich sanitizierte `STEERING_SIGNAL`, `SANITIZED_EXPORT`, `SANITIZED_BRIDGE` oder `sanitizedForBridge=true` zulässig. Auch dann dürfen keine TWL-Raum-ID, Rohdatei, Rohmail, Rohtranskript oder rückführbare Artefaktmetadaten in das allgemeine Cockpit gelangen.

Ein vermuteter Leak ist Severity 1: öffentlichen Managementzugang begrenzen, Projektion und Telemetrie quarantänisieren, keine Daten löschen, Evidenz sichern, Quelle identifizieren, Legacy-Verfügbarkeit erhalten und Geschäftsführung informieren.

## 11. Authentifizierung und Tokenhygiene

Der produktive Zielvertrag verwendet den vorhandenen statischen Token nur für `GET /` oder `GET /management` als Session-Bootstrap. Nach erfolgreichem zeitkonstantem Vergleich setzt der Server ein kurzlebiges `__Host-agentos_hitl_session`-Cookie und entfernt den Token per HTTP 303 aus der URL.

APIs akzeptieren keine Query-Token. Statischer Bearer-Zugriff ist standardmäßig deaktiviert und nur als ausdrücklich befristete Übergangsoption über `HITL_COCKPIT_ALLOW_LEGACY_BEARER=true` zulässig. Der Browser lädt keine Drittressourcen. CSP, HSTS, `Referrer-Policy: no-referrer`, `HttpOnly`, `Secure` und `SameSite=Strict` sind Pflicht.

Im produktiven Betrieb werden Reverse-Proxy-Access-Logs auf Query-Redaction und kurze Aufbewahrung geprüft. Tokenwerte dürfen nicht in Git, Dokumentation, Berichte, Fixtures, Screenshots, Telemetrie, Prozessausgaben oder Shell-History gelangen. Eine Tokenrotation ist ein separates, freizugebendes Arbeitspaket.

## 12. Runtime-Modi und sichere Defaults

```text
MANAGEMENT_COCKPIT_ENABLED=true
MANAGEMENT_COCKPIT_WRITE_ENABLED=false
MANAGEMENT_COCKPIT_SHADOW_ONLY=true
MANAGEMENT_COCKPIT_DEFAULT_VIEW=management
ASSISTANT mode=low_risk
ASSISTANT writesEnabled=true
ASSISTANT matrixHandoffEnabled=true
```

`/` bleibt unabhängig vom Default-View die Legacy-Sicht. Die Managementsicht wird über `/management` geöffnet. Direkte Management-Decision-Writes sind nicht implementiert; aktiv ist ausschließlich die getrennte, bestätigungspflichtige Assistant-Low-Risk-Lane. Inkonsistente Flag-Kombinationen und nicht allowlistete Aktionen brechen fail-closed ab. Die maschinenlesbare Betriebswahrheit steht in `../hitl-cockpit/config/production-contract.json` und wird über `/api/health` mit der tatsächlichen Runtime verglichen.

## 13. Aktivierungsgates

### Gate A – Versionierbarkeit und Baseline

- kontrolliertes, reproduzierbares Release-Artefakt;
- vollständige Sicherung mit Prüfsummen;
- Legacy-Vertragstests grün;
- kein Secret im Artefakt;
- AP-0-Last-Known-Good verfügbar.

### Gate B – Read-only Parallelbetrieb

- vollständiger Rebuild auf temporäres Ziel;
- Schema v6 und Integritätsprüfung bestanden;
- keine Quellmutation;
- keine TWL-Leakage;
- Legacy- und Management-Read-API-Smokes grün;
- Projektion innerhalb der 5-Minuten-SLO und Integritätsprüfung bestanden;
- Rollback-Drill bestanden.

### Gate C – Shadow-Qualität

- mindestens 14 unterschiedliche tägliche Shadow-Messpunkte;
- alle sichtbaren gewöhnlichen Decisions erfüllen Mindestqualität;
- Newsletter und normale Statusmails erscheinen nicht als Governance;
- keine doppelten offenen Decision-IDs;
- fachliches Review eines repräsentativen Real-Samples;
- Risiko-Lane und Scope-Verletzungen sind fachlich geschärft.

### Gate D – Begrenzte Writes

Für die aktuell aktivierte Low-Risk-Lane sind folgende Voraussetzungen erfüllt und dauerhaft einzuhalten:

- Writer mit Versionsprüfung und Idempotenz;
- Action-Allowlist je Decision-Klasse;
- Audit-Event;
- exakter Source-Task-Readback;
- Reconciliation für Doppel- oder Teilfehler;
- nachgewiesener Rollback;
- ausdrückliche Geschäftsführungsentscheidung.

Der Produktions-Smoke `rhajaina-assistant-channel-production-smoke-v1.md` belegt Write, Readback, Receipt, Matrix-Readback und Idempotenz. Das Gate gilt ausschließlich für die vier allowlisteten Low-Risk-Aktionsklassen.

## 14. Telemetrie

Shadow-Telemetrie enthält ausschließlich aggregierte Werte und Zeitpunkte. Titel, Bodies, Fragen, Empfehlungen, Task-IDs, Gegenparteien, Evidenz-URLs, Anhänge und TWL-Kontext sind verboten. Die JSONL-Datei erhält Modus 0600.

Cadence im später freigegebenen Betrieb: höchstens ein maßgeblicher Messpunkt pro Tag; technische Wiederholungen dürfen die Tagesabdeckung nicht künstlich erhöhen. Rhajaina bewertet die Daten nach 14 unterschiedlichen Tagen. Bis Grenzwerte ausdrücklich beschlossen sind, steuert keine Metrik Routing, Priorität, Freigabe oder Benachrichtigung.

## 15. Incident-Klassen

| Severity | Beispiel                                                                 | Sofortmaßnahme                                                                                    |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| S1       | TWL-/Privacy-Leak, Token-Leak, unautorisierter Quellwrite                | Zugang begrenzen, Writes/Jobs stoppen, Evidenz sichern, Legacy erhalten, Incident Lead aktivieren |
| S2       | doppelte Aktion, falsches Board, Projektion schreibt Quelle, Auth-Bypass | Management deaktivieren, betroffene Quelle exakt zurücklesen, Reconciliation und Rollback         |
| S3       | stale/korruptes Projection-DB, Management-API 5xx, falsche Aggregation   | letzte gültige Projektion behalten, Management deaktivieren oder Rebuild, Legacy weiterführen     |
| S4       | einzelner UI-/Darstellungsfehler ohne Datenwirkung                       | Managementsicht deaktivieren oder Fehler im nächsten Release beheben                              |

Jeder Incident dokumentiert Zeitpunkt, Erkennung, Umfang, betroffene Objekte, Quellintegrität, Containment, Rollback/Rebuild, Readback, offene Reconciliation, Verantwortliche und Abschluss.

## 16. Rollbackgrundsatz

Der erste Rückfall ist immer der Feature-Flag-Rollback auf Legacy. Die Managementprojektion darf quarantänisiert und neu aufgebaut werden; Kanban-Datenbanken werden für einen Cockpit-Fehler nie global zurückgesetzt. Nutzerentscheidungen, Kommentare und Auditdaten bleiben erhalten.

Der vollständige Runtime-Restore folgt `management-cockpit-operations-v1.md`. Vor jedem neuen produktiven Release wird das Backup-Manifest um alle aktuellen `lib/`, `config/`, `bin/`, Management-UI-, Auth- und Schema-Dateien erweitert und ein neuer Last-Known-Good-Stand erzeugt.

## 17. Betriebsübergabe

Der operative Einstieg steht in `hitl-cockpit/README.md`. Implementierungsdetails bleiben in den AP-Dokumenten. Änderungen am aktiven Modus oder an den Aktionsklassen richten sich ausschließlich nach `management-cockpit-production-contract-v2.md`.
