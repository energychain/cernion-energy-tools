# Management-Cockpit: Agent Briefs und asynchroner Abteilungsleiter-Jour-fixe v1

## Zweck

AP 10 verdichtet die Managementprojektion für Rhajaina, Felix, Anja, Viki, Cori, DevOps und Infrastructure zu evidenzbasierten Abteilungsberichten. Die Briefs sind eine read-only Projektion. Sie ändern weder Kanban-Karten noch Profile, Scopes, Matrix-Nachrichten oder produktive Automationen.

## Datenvertrag

Jeder konfigurierte Agent erhält bei einem vollständigen Projektionslauf genau einen Brief mit:

- Berichtszeitraum;
- aktuellem Mandats- oder explizitem Geschäftsziel;
- höchstens fünf relevanten aktiven Management-Topics;
- belegten Outcomes im Berichtszeitraum;
- strukturierten nächsten Schritten;
- explizit markierten Abhängigkeiten und Risiken;
- zugeordneten Governance Decisions;
- Zeitpunkt des letzten belegten substantiellen Fortschritts;
- materiellen Evidenzreferenzen;
- Briefstatus und erklärtem Leerzustand.

Die Briefstatus sind:

- `current`: Im Berichtszeitraum liegt belegter fachlicher oder wirtschaftlicher Fortschritt vor.
- `active_without_substantive_progress`: Es gibt aktive Themen, aber keinen belegten substantiellen Fortschritt.
- `empty`: Es gibt weder aktive Managementthemen noch belegte Ergebnisse oder Governancefragen.

Ein inkrementeller Projektionslauf ersetzt Agent Briefs nicht, weil er keinen vollständigen Quellbestand besitzt. Agent Briefs werden nur im vollständigen, deterministischen Rebuild neu materialisiert.

## Fortschrittsregel

Fortschritt wird ausschließlich aus den in AP 8 belegten Outcomes abgeleitet. Kartenalter, Statusbewegungen, Erstellungszeitpunkte und technische Ausführungsaktivität setzen `last_substantive_progress_at` nicht.

Insbesondere gelten allein nicht als Fortschritt:

- Deployment oder Release ohne belegte Gegenpartei oder wirtschaftliche Wirkung;
- Cron-, Scheduler- oder Queue-Arbeit;
- PM2-/Server-Neustarts und Healthchecks;
- Monitoring und Betriebsstatus;
- Refactoring, Builds, Lint und Tests;
- Commits, Branches oder Pull Requests;
- Datenbank- oder Schema-Migrationen;
- interne technische Wartung.

Solche Topics bleiben als `technical_enabler_only` sichtbar. Sie werden im Jour-fixe ausdrücklich als technischer Enabler und nicht als fachlicher Fortschritt ausgewiesen.

Ein `release_live`-Outcome qualifiziert nur dann als substantieller Fortschritt, wenn zusätzlich eine Gegenpartei oder eine konkrete wirtschaftliche Relevanz belegt ist. Ein belegter fallabschließender Vorgang, etwa ein gelöster Kundenfall oder eine behobene Störung, bleibt ein substantielles Ergebnis.

## Strukturierte Quellsignale

Die Projektion übernimmt ausschließlich explizite Marker und bereits materialisierte Managementobjekte:

- `BUSINESS_GOAL:` oder `GESCHÄFTSZIEL:`
- `NEXT_ACTION:`, `NEXT_STEP:` oder `NÄCHSTER_SCHRITT:`
- `DEPENDENCY:` oder `ABHÄNGIGKEIT:`
- `RISK:` oder `RISIKO:`

Fehlende Angaben werden nicht durch ein LLM ergänzt. Ein Leerstand oder fehlender Fortschrittsnachweis bleibt sichtbar.

## Rollen

Die Rollen und Aliaszuordnungen stehen in `hitl-cockpit/config/agents.json`:

- Rhajaina – Geschäftsleitungsassistenz und Gesamtkoordination
- Felix – B2B, CRM, Vertrieb und Partnerschaften
- Anja – Finanzen und kaufmännische Vorgänge
- Viki – Markt, Strategie und Geschäftschancen
- Cori – B2C und Corrently
- DevOps – Softwareentwicklung und Produktqualität
- Infrastructure – Systeme und Betrieb

Weitere operative Assignees werden nicht stillschweigend einem Abteilungsbrief zugeschlagen. Eine Zuordnung erfordert einen expliziten Alias in der Konfiguration. Bei aggregierten Topics ist der explizite Topic-Owner für den Brief zuständig; bloße Beteiligung erzeugt keinen zweiten Abteilungsbericht.

Newsletter-/Noise-Topics sowie unvollständige `projection_incomplete`-Entscheidungen werden nicht als relevante Themen oder Governancebedarf in Agent Briefs übernommen. Echte Governancefragen erfüllen dieselbe Mindestqualität wie die Entscheidungssicht.

## API und UX

`GET /api/management/departments` liefert die sieben Briefs in stabiler Reihenfolge. `GET /api/management/departments/:agentId` liefert einen einzelnen Brief. Beide Endpunkte lesen die Managementdatenbank mit SQLite `mode=ro` und `query_only=ON`.

Die Abteilungssicht zeigt Ziel, relevante Topics, Outcomes, nächste Schritte, Abhängigkeiten, Risiken, Governancebedarf und den letzten belegten Fortschritt. Technische Enabler und operative Ergebnisse ohne fachliche Wirkung sind ausdrücklich gekennzeichnet.

Die Legacy-HITL-Liste und alle Legacy-Endpunkte bleiben unverändert.

## Datenschutz und Isolation

TWL-private Boards werden bereits vor der Projektion ausgeschlossen. Agent Briefs entstehen nur aus den öffentlich für die allgemeine Managementprojektion zulässigen Topics, Outcomes und Decisions. Es werden keine sensitiven Bodies in die Brief-Konfiguration geschrieben.

## Rollback

AP 10 ist ausschließlich im isolierten Worktree implementiert. Ohne Deployment gibt es keinen produktiven Zustand zurückzurollen. Im späteren Parallelbetrieb kann die Managementsicht deaktiviert werden; die Legacy-HITL-Liste bleibt davon unabhängig erreichbar.
