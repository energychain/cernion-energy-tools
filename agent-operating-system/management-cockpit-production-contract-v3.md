# Management-Cockpit: Produktiver Betriebsvertrag v3

Stand: 2026-11-17
Status: verbindlicher aktueller Betriebsvertrag, ersetzt `management-cockpit-production-contract-v2.md` ausdrücklich
Maschinenlesbare Fassung: `../hitl-cockpit/config/production-contract.json`

## 0. Was sich gegenüber v2 ändert

v2 hat die Management-Decision-API (`choose`, `delegate`, `question`, `schedule`, `reject`,
`return-to-rhajaina`) dauerhaft auf Shadow beschränkt und echte Schreibzugriffe ausschließlich
über den separaten Rhajaina Assistant Channel erlaubt. Dieser Vertrag erweitert, nach ausdrücklicher
Geschäftsführungsentscheidung (Auftrag vom 2026-11-17: „Ändere zuerst den Betriebsvertrag, bevor Code
geschrieben wird. Dann fange aber damit an, den Code zu schreiben“), die Decision-API um einen
**eigenen, separaten Execute-Pfad** für genau diese sechs Aktionsklassen. Der bestehende
Shadow-Pfad (`POST /api/management/decisions/:id/:action`) bleibt unverändert Shadow — er bricht bei
`writeEnabled=true` weiterhin mit `decision_writes_not_implemented` ab, weil Clients ihn so kennen und
Tests ihn so prüfen. Der neue Pfad (`POST /api/management/decisions/:id/:action/execute`) ist additiv
und per Default deaktiviert.

Dieser Vertrag erlaubt damit die **Entwicklung und den deaktivierten Einbau** des Execute-Pfads sofort.
Die **produktive Aktivierung** (Runtime-Flag `decisionExecuteEnabled=true`) bleibt an Abschnitt 12
Punkt 4 gebunden: ein konkreter End-to-End-Produktionsnachweis mit Readback und Reconciliation muss
vorliegen, bevor das Flag im nicht versionierten Runtime-Policy-Dokument (Abschnitt 5) auf `true`
gesetzt werden darf. Bis dieser Nachweis existiert, ist der Execute-Pfad Code, aber nicht Betrieb.

## 1. Geltung und Betriebswahrheit

Dieser Vertrag ist die einzige verbindliche Beschreibung des aktuellen produktiven Betriebszustands
des Geschäftsführer-Cockpits. Historische AP-, Baseline-, Shadow- und UAT-Dokumente bleiben Nachweise
ihres jeweiligen Zeitpunkts. Bei einem Widerspruch gilt dieser Vertrag zusammen mit der
maschinenlesbaren Fassung.

Das Cockpit ist unter `https://hitl.stromdao.de/management` als primäre interne
Geschäftsführeroberfläche aktiv. Hermes Kanban bleibt die operative Aufgabenwahrheit, Matrix der
interne Arbeits- und Übergabekanal und die Management-SQLite eine abgeleitete Projektion. Die
Legacy-HITL-Sicht unter `/` bleibt Rückfalloberfläche.

## 2. Aktiver Modus

Die aktuelle UI-Bezeichnung lautet „Assistenz · begrenzte Aktionen“. Der technische Assistant-Modus
ist `low_risk`.

Aktive Runtime-Eigenschaften:

| Bereich                            | Verbindlicher Wert                              |
| ----------------------------------- | ------------------------------------------------ |
| Managementsicht                     | aktiviert                                        |
| Management-Decision-Shadow-API      | Shadow, keine direkten Decision-Writes           |
| Management-Decision-Execute-Pfad    | im Code vorhanden, produktiv standardmäßig `false` |
| Default-View                        | `management`                                     |
| Rhajaina Assistant Channel          | aktiviert                                        |
| Assistant-Modus                     | `low_risk`                                       |
| bestätigte Low-Risk-Writes          | aktiviert                                        |
| Matrix-Handoff nach Readback        | aktiviert                                        |
| produktive Auto-Ausführung          | deaktiviert                                      |
| Assistant-Profil                    | `rhajaina`                                       |
| Matrix-Sender                       | `@hermes-stromdao:matrix.stromdao.de`            |

Die Shadow-API (`MANAGEMENT_COCKPIT_WRITE_ENABLED` / `MANAGEMENT_COCKPIT_SHADOW_ONLY`) und der neue
Execute-Pfad (`MANAGEMENT_COCKPIT_DECISION_EXECUTE_ENABLED`) sind getrennte Flags mit getrennter
Bedeutung. Das Setzen der Shadow-Flags ändert den Execute-Pfad nicht und umgekehrt.

## 3. Erlaubte produktive Aktionsklassen

### 3a. Assistant Channel (unverändert aus v2)

Nach expliziter Bestätigung durch den authentifizierten Operator sind genau folgende internen
Aktionsklassen über den Rhajaina Assistant Channel erlaubt: `ask_question`, `archive_intake_noise`,
`delegate_followup`, `schedule_wakeup`, `return_for_completion`. Anforderungen wie in v2 Abschnitt 3.

### 3b. Management-Decision-Execute-Pfad (neu in v3)

Nach expliziter Bestätigung durch den authentifizierten Operator sind genau folgende sechs
Aktionsklassen über den neuen Execute-Pfad erlaubt: `choose`, `delegate`, `question`, `schedule`,
`reject`, `return-to-rhajaina`.

Jede Ausführung benötigt zwingend, ohne Ausnahme:

- einen serverseitig aufgelösten, autorisierten Quellvorgang (`source_board`/`source_task_id` der
  Entscheidung);
- Ablehnung von Quellen auf ausgeschlossenen Boards (`twl-netze-private`) oder mit TWL-/privaten/
  vertraulichen Markern — fail-closed, keine Ausnahme;
- eine im Request explizit gesetzte Bestätigung (`confirm: true`); ein Chattext oder ein impliziter
  Default kann diese Bestätigung nicht erzeugen oder ersetzen;
- einen stabilen, vom Aufrufer gesetzten Idempotency-Key;
- einen vom Aufrufer übermittelten Source-Fingerprint, der serverseitig gegen den aktuellen
  Quellzustand geprüft wird (`source_fingerprint_mismatch` bei Abweichung);
- einen Kanban-Readback vor und nach der Ausführung;
- ein persistentes Receipt mit Vorzustand, Aktion, Payload, Idempotency-Key und Nachzustand;
- append-only Audit-Protokollierung (wer/was/wann/Quelle/Ergebnis).

Ein Timeout während der Ausführung liefert `status: "ambiguous"` mit Readback-Versuch statt einer
Verdopplung der Nebenwirkung. Derselbe Idempotency-Key liefert bei unverändertem Payload dasselbe
Ergebnis erneut (`deduplicated: true`) statt einer zweiten Ausführung.

## 4. Weiterhin gesperrte Wirkungen

Weder der Low-Risk-Assistant-Vertrag noch der neue Decision-Execute-Pfad erlauben:

- externe Kommunikation oder Veröffentlichung;
- Preis-, Angebots-, Vertrags-, Zahlungs- oder Budgetbindung;
- Deployment, Infrastrukturänderung oder destruktive Aktion;
- Secret-, Credential- oder Tokenverarbeitung;
- Datenschutzentscheidung oder Freigabe sensitiver Daten;
- TWL-private, Uslar-Rohkontext, Quarantäne oder gemischt-sensitive Inhalte;
- automatisch erfundene Zuständige;
- Owner- oder Prioritätsänderungen ohne einen späteren typisierten Scope-Vertrag;
- produktive Auto-Ausführung ohne Operatorbestätigung — weder im Assistant Channel noch im
  Decision-Execute-Pfad.

Mehrdeutigkeit, fehlende Quelle, fehlender Assignee, Scope-Lücke, Readback-Abweichung,
Fingerprint-Abweichung oder unsicherer Matrix-Raum führen fail-closed zu keiner weiteren
Nebenwirkung.

## 5. Identitäten und Datenhaltung

Unverändert aus v2. Produktive Pfade:

| Zustand              | Pfad / Rolle                                                                         |
| --------------------- | -------------------------------------------------------------------------------------- |
| Managementprojektion  | `/home/clawd/.hermes/management-cockpit/management.db`, abgeleitet und neu aufbaubar   |
| Assistant-Audit       | `/home/clawd/.hermes/management-cockpit/assistant-channel.db`, persistent              |
| Decision-Execute-Audit| dieselbe Audit-Infrastruktur wie Assistant-Audit, eigener Aktions-Namespace            |
| Kanban                | `/home/clawd/.hermes/kanban/boards`, System of Record                                  |
| Runtime-Policy        | `/home/clawd/.hermes/runtime/agentos-hitl-cockpit/assistant-policy.json`                |

Die Runtime-Policy enthält keine Matrix-Zugangsdaten. Das Aktivierungsflag für den Decision-Execute-
Pfad lebt ausschließlich in dieser nicht versionierten Runtime-Policy, niemals im committeten
Baseline-Config (`config/release-runtime.example.json`), das per Vertrag und Release-Gate dauerhaft
deaktiviert bleibt.

## 6. Maschinenlesbarer Status und Health

Unverändert aus v2, ergänzt um `operatingStatus.decisionExecuteEnabled` und die aktiven
Decision-Execute-Aktionsklassen. `aligned=false` bleibt ein Betriebsfehler.

## 7. Persistente Reconciliation und Ergebnisrücklauf

Der Decision-Execute-Pfad nutzt dieselbe Reconciliation-Logik wie der Assistant Channel (v2
Abschnitt 7): Outbox-Eintrag vor jeder Nebenwirkung, autoritativer Readback vor Wiederholung,
Teilfehler sichtbar in der Lane „Störungen“, Eskalation nach 24 Stunden ohne Wiederholungsspam.

## 8. Produktiver Nachweis

Für den Assistant Channel gilt unverändert `rhajaina-assistant-channel-production-smoke-v1.md`.

Für den Decision-Execute-Pfad **existiert dieser Nachweis noch nicht**. Bevor
`decisionExecuteEnabled` im Runtime-Policy-Dokument auf `true` gesetzt wird, muss ein neuer
Betriebsnachweis `management-decision-execute-production-smoke-v1.md` denselben Ablauf wie in v2
Abschnitt 8 für mindestens eine der sechs Aktionsklassen an einem realen, nicht-TWL Fall belegen,
inklusive Idempotenz nach einem echten PM2-Neustart. Bis dahin ist der Code vorhanden und getestet,
aber produktiv inaktiv (`decisionExecuteEnabled=false`).

## 9. Betrieb und Verantwortlichkeiten

Unverändert aus v2.

## 10. Rollback

Unverändert aus v2, ergänzt: Der schnellste Rückfall für den Decision-Execute-Pfad setzt
`decisionExecuteEnabled=false` in der Runtime-Policy. Das deaktiviert ausschließlich den neuen
Execute-Pfad; die Shadow-API, der Assistant Channel und deren jeweilige Flags bleiben unberührt.

## 11. Incident- und Stop-Kriterien

Unverändert aus v2, gilt zusätzlich für den Decision-Execute-Pfad. Jede der dort genannten
Bedingungen deaktiviert sofort auch `decisionExecuteEnabled`.

## 12. Änderungen an diesem Vertrag

Unverändert aus v2:

1. versionierte Änderung der maschinenlesbaren und menschenlesbaren Fassung;
2. Tests gegen Runtime, UI und Health;
3. Sicherheits- und Impact-Prüfung;
4. konkreter End-to-End-Nachweis mit Readback und Reconciliation;
5. ausdrückliche Geschäftsführungsentscheidung.

Die ausdrückliche Geschäftsführungsentscheidung für diesen Vertrag (v3) liegt vor und erlaubt Punkt 1
bis 3 sofort. Punkt 4 ist für den Decision-Execute-Pfad noch offen und ist Vorbedingung für die
produktive Aktivierung (Abschnitt 8). Historische Dokumente werden nicht umgedeutet. Ein neuer
aktueller Vertrag ersetzt diesen Vertrag ausdrücklich und verweist auf den zugehörigen
Produktionsnachweis.
