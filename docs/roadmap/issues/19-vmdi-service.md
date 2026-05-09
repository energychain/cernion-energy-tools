# VDMI-Matrizen in Cernion Energy Tools

## Konzept & Architektur

**Stand:** 2026-05-09
**Version:** 1.6.5
**Zertifizierungsrelevanz:** ISO 55000 / ISO 55001 (Asset Management)

---

## 1. Idee und Vision

VDMI ist die im deutschen Energieversorgungsbereich verbreitete Variante der RACI-Methode zur Zuordnung von Verantwortlichkeiten in Prozessen:

| Rolle | Kürzel | RACI-Äquivalent | Bedeutung |
|-------|--------|-----------------|-----------|
| Verantwortlich | **V** | Accountable | Trägt die Gesamtverantwortung; genau eine Instanz je Aufgabe |
| Durchführend | **D** | Responsible | Führt die Aufgabe operativ aus; kann mehrere Akteure umfassen |
| Mitwirkend | **M** | Consulted | Liefert Input, wird konsultiert; bidirektionale Kommunikation |
| Information | **I** | Informed | Wird über Ergebnisse informiert; unidirektionale Kommunikation |

### Die Berater-Analogie

Das VDMI-Konzept in Cernion Energy Tools ist die **systemische Umsetzung dessen, was Unternehmensberater in der Praxis manuell tun** — eingebettet in ein Agentic Framework:

| Klassisches Consulting | VDMI im Agentic Framework |
|------------------------|--------------------------|
| Berater beobachtet Abläufe im Unternehmen | VDMI-Service lauscht passiv auf den Moleculer Event Bus |
| Berater fragt: "Wer entscheidet das hier?" | LLM inferiert V/D/M/I aus Event-Mustern |
| Berater dokumentiert Verantwortlichkeiten | Ad-hoc-Matrix entsteht automatisch als Prozess-Artefakt |
| Berater erkennt Muster über mehrere Projekte | Zählbasierter Schwellenwert löst Nomination aus |
| Berater destilliert Standardprozesse | Standard-VDMI-Matrix nach HITL-Bestätigung |
| Berater empfiehlt Vorgehen | Gereifte Matrix steuert Agenten-Entscheidungen als Guardrail |

Der entscheidende Unterschied: Das System lernt **kontinuierlich im Betrieb**, nicht in einer einmaligen Analysephase. Die entstehenden Matrizen sind keine statischen Dokumente, sondern aktive Artefakte, die das Verhalten von Services und Agenten direkt steuern.

### Vision in drei Sätzen

> VDMI-Matrizen entstehen automatisch im Hintergrund — als abstraktes Artefakt des laufenden Betriebs, nicht als manueller Planungsschritt. Sie dienen Services und Agenten als **Richtschnur für deterministischere Entscheidungen**: Wer führt aus, wer berät, wer entscheidet, wer wird informiert. Gleichzeitig macht VDMI sichtbar, wenn dokumentierte Verantwortungen und real gelebte Ausführung auseinanderlaufen (z. B. offizielle Prozessführung in Kernsystem A, operative Excel-/SharePoint-Schattenausführung in Abteilung B).

### 1.1 VNB-Realität: Fragmentierung, Silo-Politik, Schatten-IT

Klassische VNB arbeiten oft nicht in einem durchgängigen End-to-End-Prozess, sondern in organisatorisch fragmentierten Teilwelten:

- kaufmännische und technische Prozessketten sind getrennt
- führende Systeme (GIS, Asset-DB, Stammdatensysteme) sind abteilungsbezogen abgeschottet
- operative Workarounds entstehen als Schatten-IT (Excel, SharePoint-Listen, Mail-Workflows)
- formale Rollen aus Handbuch/Organigramm weichen von der de-facto-Ausführung ab

Die VDMI-Vision adressiert genau diese Realität: Nicht nur „saubere" Prozessketten werden modelliert, sondern insbesondere Abweichungen zwischen **Soll-Prozess** und **Ist-Ausführung**. Damit wird VDMI zum Governance-Instrument gegen Management-Theater: Verantwortlichkeit wird nicht behauptet, sondern über Ereignisse belegbar gemacht.

---

## 2. Akteurtypen (Actor Types)

```
Actor
├── service        Moleculer-Microservice (z. B. cya, grid-connection, mastr-monitor)
├── agent          KI-Agenten-Persona (z. B. technical, commercial, compliance)
├── user           Menschliche Rolle (z. B. grid_operator, system_admin, asset_manager)
└── external       Externe Stakeholder / Systeme (z. B. BNetzA, TSO, Antragsteller)
```

Jeder Akteur besitzt:
- `actorType` — einer der vier Typen oben
- `actorId` — technischer Bezeichner
- `displayName` — menschenlesbarer Name
- `contactInfo` (optional) — für externe Akteure oder HITL-Eskalation

### 2.2 Synthetic Stakeholder Dialogues (SSD)

Zur Abbildung realer Zielkonflikte bei VNB ergänzt VDMI die Akteurtypen um **personalisierte Abteilungs-Adjutanten** (Agenten-Personas mit klaren Mandaten).

Typischer Konfliktfall:
- **Technische Perspektive:** klassischer Netzausbau, Versorgungssicherheit, CAPEX-getriebene Planung
- **Kaufmännisch-strategische Perspektive:** Flexibilitätsmanagement, TOTEX-Optimierung, flexible Netzanschlussverträge (fNAV)

VDMI modelliert diese Perspektiven als strukturierte Stakeholder-Dialoge:

- `agent:technical` (typisch Rolle `M`) argumentiert aus Netzsicherheits-/Planungssicht
- `agent:commercial` (typisch Rolle `D`) argumentiert aus Wirtschaftlichkeits-/Vertrags- und Portfolio-Sicht
- `user:<verantwortliche_stelle>` (Rolle `V`) entscheidet erst nach vorstrukturierter KI-Vorverhandlung

Damit wird implizite abteilungsinterne Politik in einen expliziten, auditierbaren Dialograum überführt.

---

## 2.1 Grounding im bestehenden Backend (v0.20+)

Dieses Konzept ist explizit auf die vorhandene Architektur von Cernion Energy Tools ausgelegt und **setzt keine Parallelwelt** voraus.

### Bereits vorhandene Bausteine, die VDMI direkt nutzt

| Bestehende Komponente | Konkrete Nutzung im VDMI-Konzept |
|-----------------------|----------------------------------|
| `services/api.service.js` | REST-Exposition der VDMI-Endpunkte inkl. OpenAPI-Tagging |
| `services/hitl.service.js` | Verbindliche HITL-Bestätigung bei Nomination / kritischen Rollenwechseln |
| `src/job-store.js` + Async-Job-Pattern | Langläufer (z. B. Batch-Inferenz, Reifegrad-Rebuild) als 202/`jobId`-Flow |
| PouchDB-Pattern (`data/*`, Prefix-Docs) | Persistenz für Matrix-Instanzen, Template-Versionen, Audit-Trail |
| `src/prompt-scrubber.js` | PII-Reduktion vor LLM-Kontextbildung aus Event-Payloads |
| `src/mcp-client.js` | Standardisierter MCP-Zugriff für LLM-gestützte Inferenz-/Bewertungsschritte |
| Dashboard-Aggregator (`dashboard-api`) | KPI-Ausleitung für Reifegrad, HITL-Last, Qualitätsmetriken |

### Service-Grenzen (wichtig für Wartbarkeit)

- VDMI bleibt ein **eigenständiger Domain-Service** mit klaren Actions und Events.
- Bestehende Fachservices (`grid-connection`, `energy-sharing`, `mastr-quality`, `redispatch-expost`) werden **nicht um VDMI-Logik aufgebläht**.
- Die Integration erfolgt über den bestehenden Event-Strom und optionale, schmale Query-Actions (`getRoleForProcess`, `getMatrixContext`).

### Deployment- und Betriebsmodell

- Multi-Tenant-fähig analog zu bestehenden Services (`tenantId` als primärer Partition-Key).
- Read-Pfade (Guardrail-Abfragen) sind Latenz-kritisch und werden als schnelle lokale Reads aus VDMI-Store gedacht.
- Schreib-/Lernpfade (Inferenz, Nomination, Reifegradbildung) sind entkoppelt und asynchron.

> Ergebnis: Das Konzept passt in die reale Service-Landschaft, statt zusätzliche technische Schulden durch Sonderwege zu erzeugen.

---

## 3. VDMI als Guardrail für Agenten und Services

Dies ist die zentrale operative Funktion einer gereiften VDMI-Matrix. Sie ist kein statisches Dokument, sondern ein aktiver Entscheidungsrahmen:

```
Ohne gereifte Matrix              Mit gereifter Matrix
─────────────────────             ──────────────────────────────────────
Agent entscheidet ad-hoc:  →      Agent prüft Matrix:
  "Soll ich eskalieren?"            D-Rolle → entscheide selbst
  "Bin ich zuständig?"              M-Rolle → konsultiere zuerst
  "Wer muss wissen?"                V-Rolle → Mensch: eskaliere via HITL
                                    I-Rolle → sende Benachrichtigung
```

**Konsequenz für HITL:** Ein Nutzer erhält nicht mehr zufällige Eskalationen, sondern ausschließlich Anfragen in den Aufgaben, in denen er gemäß Matrix die V-Rolle innehat. Die Eingriffspunkte werden vorhersehbar und auditierbar.

**Konsequenz für Agenten:** Wiederkehrende Entscheidungen ("Wer ist hier verantwortlich?") werden durch die Matrix deterministisch beantwortet — das reduziert LLM-Varianz und erhöht die Reproduzierbarkeit über Zeit.

### 3.1 Guardrail-gestützte KI-Verhandlung (A2A) vor V-Eskalation

Bei kritischen Netzanschlüssen orchestriert VDMI eine **Synthetic Stakeholder Dialogue**-Phase vor menschlicher Entscheidung:

1. Fall wird in VDMI-Task zerlegt (z. B. Netzverträglichkeit, Ausbaupfad, Flex-Alternative, Vertragsmodell).
2. `agent:technical` und `agent:commercial` erhalten je Task nur den rollen- und evidenzkonformen Kontext.
3. Beide Agenten verhandeln entlang der Matrixgrenzen (`D/M/I`, zulässige Claims, benötigte Evidenz).
4. Ergebnis wird als konsolidierter Entscheidungsstand mit Dissenspunkten an Rolle `V` übergeben.

**Wichtig:** Agenten entscheiden nicht außerhalb ihrer VDMI-Rolle. Die Matrix definiert, was ein Agent empfehlen darf, was er belegen muss und wann zwingend eskaliert wird.

### 3.2 Rollenlogik im Zielkonflikt Technik vs. Kommerz

Beispielhafte Rollenzuordnung im SSD-Modus:

| Teilaufgabe | `technical` | `commercial` | Mensch (`V`) |
|-------------|-------------|--------------|--------------|
| Netzverträglichkeit bewerten | M (Fachvotum) | I | V bei Grenz-/Risikofall |
| Maßnahmenpfad (Ausbau vs. Flex) | M | D (Wirtschaftlichkeitsvorschlag) | V bei Zielkonflikt |
| Vertrags-/fNAV-Option | I/M | D | V bei regulatorischer Tragweite |
| Finaler Freigabeentscheid | I/M | I/D | V (verbindlich) |

Dadurch wird verhindert, dass eine Abteilung die andere „überschreibt", ohne dass diese Abweichung als Rollenverletzung sichtbar wird.

### 3.3 Endlos-Schleifen-Schutz in A2A-Dialogen

VDMI schützt Synthetic Stakeholder Dialogues durch harte Verfahrensgrenzen:

- **Round Limit:** maximale Anzahl A2A-Runden pro Task/Fall.
- **Convergence Check:** Dialog endet, wenn sich Begründungen nur noch wiederholen.
- **Evidence Gate:** neue Runde nur bei neuer Evidenz oder neuem Constraint.
- **Conflict Timeout:** bei ungelöstem Konflikt bis Frist automatische Eskalation an `V`.
- **Role Boundary Check:** Agent darf keine Rolle/Entscheidungskompetenz übernehmen, die ihm nicht zugewiesen ist.

Bei Regelverletzung erzeugt VDMI ein Governance-Finding und beendet die Verhandlung kontrolliert.

### 3.4 Ergebnisformat für Rolle `V`

Die menschliche Eskalationsrolle erhält kein Rohprotokoll, sondern ein strukturiertes Entscheidungsdossier:

- gemeinsame Faktenbasis (beidseitig akzeptierte Evidenz)
- verbleibende Dissenspunkte (Technik vs. Kommerz)
- Optionen inkl. Risiko-/Kosten-/Zeitwirkung (CAPEX vs. Flex/TOTEX)
- VDMI-konforme Empfehlung je Option

So wird die `V`-Entscheidung schneller, nachvollziehbarer und weniger politisch zufällig.

### 3.5 Mini-Flow: A2A-Verhandlung bis V-Entscheid

```text
Input: Kritischer Netzanschlussfall
  │
  ▼
VDMI Task-Split + Rollenbindung
(`technical`=M, `commercial`=D, Mensch=V)
  │
  ▼
A2A Runde 1: Claim + Evidenzabgleich
  │
  ├─ neue Evidenz vorhanden? ── nein ──► Convergence Check
  │                                   │
  │                                   ├─ konvergiert? ja ─► Dossier an V
  │                                   └─ nein ─► Round +1
  │
  └─ ja ─► A2A Runde n (bis Round Limit)
      │
      ├─ Round Limit erreicht / Timeout?
      │       ├─ ja ─► Konflikt-Eskalation an V
      │       └─ nein ─► nächste Runde
      │
      └─ Rollenverletzung erkannt?
        ├─ ja ─► Governance-Finding + kontrollierter Abbruch
        └─ nein ─► weiter

Output für V:
- gemeinsame Faktenbasis
- Dissenspunkte
- Optionen (CAPEX vs. Flex/TOTEX/fNAV)
- VDMI-konforme Empfehlung
```

---

## 4. Prozesstypen und Reifegradmodell

```
Ad-hoc VDMI-Matrix ──────────────────────────────► Standard-VDMI-Matrix
(automatisch aus Events inferiert)                  (nominiert, dauerhaft,
                                                     wiederverwendbar,
                                                     ISO-55001-konform)
         ▲
         │ Reifetreiber:
         │ • Zählbasierter Schwellenwert (N gleiche Muster)
         │ • Regulatorische Vorgabe (z. B. EnWG, NAV)
         │ • Nomination durch Agent oder Nutzer
```

### 4.1 Ad-hoc VDMI-Matrix

- Entsteht **automatisch im Hintergrund** während einer Aufgabe
- Quelle: Moleculer Event Bus (passives Lauschen, kein Eingriff in bestehende Services)
- Wird dem laufenden Job/Prozess als Artefakt zugeordnet
- Initiale Konfidenz abhängig von der Event-Quelle (siehe Abschnitt 6)

### 4.2 Standard-VDMI-Matrix

- Vordefiniertes, wiederverwendbares Template mit Versioning (SemVer)
- Regulatorische Basis explizit dokumentiert
- Entsteht durch **Nomination** aus einer Ad-hoc-Matrix
- Neue Prozessinstanzen erhalten das Template als Guardrail-Startpunkt

### 4.3 Nomination-Zyklus

Nomination ist der bewusste Übergang von implizitem zu explizitem Prozesswissen — das Äquivalent zum Berater, der sagt: "Das hier ist jetzt ein Standardprozess."

```
Ad-hoc-Matrix (patternMatchCount ≥ Schwellenwert)
         │
         ├── Nomination durch Agent (automatisch, wenn Muster stabil)
         ├── Nomination durch Nutzer (manuell im HITL-Kontext)
         └── Nomination durch Schwellenwert (automatisch)
                   │
                   ▼
         Nomination-Event auf Moleculer Bus
                   │
                   ▼
         HITL-Item: Mensch bestätigt oder lehnt ab
                   │
                   ▼
         Standard-VDMI-Matrix (versioniert, dauerhaft)
```

> **Designprinzip:** Jede Nomination — auch eine automatische durch einen Agenten — durchläuft eine menschliche HITL-Bestätigung bevor sie permanent wird. Dies sichert Qualität und Nachvollziehbarkeit für ISO 55001.

---

## 5. Event-getriebene VDMI-Inferenz via Moleculer

### 5.1 Grundprinzip

Der VDMI-Service ist ein **passiver Event-Subscriber** auf dem Moleculer Message Bus. Er instrumentiert keine bestehenden Services — er lauscht auf das, was ohnehin emittiert wird. Wie ein Berater, der einfach zuhört, bevor er dokumentiert.

### 5.0 Moleculer-native Integrationsprinzipien

Das VDMI-Konzept nutzt Moleculer nicht nur als Transport, sondern als **Betriebs- und Qualitätsrahmen**:

1. **Events für lose Kopplung, Actions für deterministische Abfragen**
  Rollen lernen via Bus, Rollen anwenden via synchroner Guardrail-Action.

2. **Moleculer-Context (`ctx.meta`) als Primärsignal**
  `tenantId`, `jobId`, `requestId`, `userId`, `correlationId` sind Kern des Mapping- und Audit-Modells.

3. **Broker-Features für Robustheit**
  Timeouts, Retry-Policy, Circuit-Breaker und Bulkhead-Mechanismen begrenzen Ausfallkaskaden im Inferenzpfad.

4. **Versionierbare Event-Contracts**
  VDMI konsumiert nur dokumentierte Event-Schemas; Schema-Änderungen werden über Contract-Versionen gesteuert.

5. **Observability by Design**
  Jede Inferenzentscheidung erzeugt strukturierte Logs + Ereignisse zur späteren Ursachenanalyse.

Diese Leitlinien sichern, dass VDMI auch bei steigender Service-Anzahl stabil bleibt.

```
Moleculer Message Bus
│
├── hitl.item.created          → V-Rolle erkannt (Approver)
├── hitl.item.resolved         → V-Akteur bestätigt
├── cya.a2a.consensus.failed   → M-Konflikt, Eskalation
├── cya.analyze.completed      → D-Rolle: cya-Service
├── agent.plan.step.executed   → D-Rolle: ausführender Service
├── webhooks.delivered         → I-Rolle: Empfänger
├── job.completed              → Prozessabschluss
└── ...                        → weitere domänenspezifische Events
```

### 5.2 Event-to-Role-Mapping

| Moleculer Event-Muster | VDMI-Rolle | Konfidenz | Begründung |
|------------------------|-----------|-----------|------------|
| `hitl.item.created` (approver im Payload) | **V** | 1.00 | HITL-Approver = Verantwortlicher per Definition |
| `hitl.item.resolved` (userId) | **V** | 1.00 | Entscheidender Mensch bestätigt |
| `*.action.completed` (serviceId) | **D** | 0.95 | Service hat Aufgabe ausgeführt |
| `agent.persona.evaluated` (personaId) | **M** | 0.90 | Persona berät, entscheidet nicht |
| `webhooks.delivered` (recipient) | **I** | 0.85 | Empfänger wird informiert |
| `ctx.meta.userId` (passiv dabei) | **I** | 0.75 | Nutzer war zugegen, aber nicht aktiv |
| LLM-Inferenz aus Event-Kontext | variabel | 0.60–0.80 | Erschlossen, nicht direkt belegt |

### 5.3 Zweistufige Event-Verarbeitung

**Stufe 1 — Job-korrelierte Events (sofort)**

Jeder Event mit `jobId` / `requestId` in `ctx.meta` wird direkt der aktiven VDMI-Matrix zugeordnet. Niedrige Latenz, hohe Präzision, rauscharmer Pfad.

**Stufe 2 — Unkorrelierte Events (Lernbasis)**

Events ohne Job-Kontext werden in einem **zählbasierten Buffer** gehalten. Das LLM analysiert semantisch, ob eine neue Beobachtung zu einem bekannten Muster gehört — unabhängig von Zeitstempeln. Sobald ein Muster den konfigurierten Zählschwellenwert erreicht, entsteht ein Nomination-Kandidat.

```
Zählbasierter Buffer
├── Muster A: 12 Beobachtungen  ✓ Schwelle (10) erreicht → Nomination
├── Muster B:  3 Beobachtungen  ✗ noch nicht reif
└── Muster C:  7 Beobachtungen  ✗ noch nicht reif
```

### 5.4 LLM-semantische Mustererkennung

Zwei Prozessausführungen werden als "gleicher Typ" erkannt, wenn das LLM ihre Event-Sequenzen semantisch als äquivalent bewertet — nicht durch exakten Struktur-Vergleich. Dies erlaubt Toleranz gegenüber:
- unterschiedlichen Parametern (andere Anlage, anderer Antragsteller)
- leicht abweichenden Event-Reihenfolgen
- fehlenden optionalen Schritten

Der `eventPatternHash` im Datenmodell speichert den LLM-generierten semantischen Fingerprint des Musters als Vergleichsbasis.

### 5.5 Moleculer Contract-Katalog (verbindlich)

Für VDMI-relevante Events gilt ein verbindlicher Contract-Katalog, damit Inferenz und Audit stabil bleiben.

#### Naming-Konvention

`<domain>.<entity>.<action>.v<major>`

Beispiele:
- `hitl.item.created.v1`
- `agent.plan.step.executed.v1`
- `vdmi.nomination.requested.v1`

#### Pflicht-Envelope pro Event

```json
{
  "eventId": "evt_<uuid>",
  "timestamp": "ISO-8601",
  "tenantId": "<tenant>",
  "correlationId": "<corr>",
  "requestId": "<req>",
  "producer": "<service>",
  "schemaVersion": "1.0.0",
  "payload": {}
}
```

#### Versionierungs- und Kompatibilitätsregeln

- **Minor/Patch**: nur additive Änderungen, bestehende Consumer bleiben lauffähig.
- **Major**: Breaking Change ⇒ neuer Event-Name mit neuer `v<major>`-Suffix.
- VDMI konsumiert pro Event-Typ nur freigegebene Contract-Versionen.
- Deprecation-Fenster pro Major-Version wird vorab festgelegt und kommuniziert.

#### Validierungsprinzip

- Producer validiert vor Emit.
- VDMI validiert beim Consume gegen bekannte Schemas.
- Bei Schema-Verstoß: Event nicht für Rolleninferenz verwenden, stattdessen Audit-Finding erzeugen.

### 5.6 Handling von Nasenprozessen (RPA-/Low-Code-Bridge-Events)

Historisch gewachsene VNB-Prozesse ("Nasenprozesse") liefern häufig keine sauberen Fach-Events, sondern Office-/Datei-Ereignisse wie:

- `mail.attachment.extracted`
- `sharepoint.excel.updated`
- `mail.folder.moved`

Diese Events werden typischerweise durch einfache RPA- oder Low-Code-Bridges (z. B. Power Automate) erzeugt.

#### 5.6.1 Fachliche Zuordnung trotz unstrukturierter Trigger

VDMI nutzt für solche Trigger eine mehrstufige Kontextanreicherung, bevor Rollen inferiert werden:

1. **Metadaten-Signale:** Mailbox, Betreffmuster, Dateiname, SharePoint-Pfad, Absendergruppe.
2. **Artefakt-Signale:** Tabellenblattnamen/Spaltenheader (z. B. Inbetriebnahme, Außerbetriebnahme, MaLo, Datum).
3. **Zeit-/Prozesskontext:** Nähe zu bekannten Dispatch-/Stammdatenprozessen, offene Jobs, korrelierende Folgeevents.
4. **LLM-Semantik (Abschnitt 5.4):** Klassifikation des Ereignisbündels als fachlicher Schritt (z. B. Bewegungsdaten-Update für Dispatch).

Erst aus der Kombination entsteht die fachliche Prozesshypothese; ein einzelnes O365-Event reicht dafür nicht aus.

#### 5.6.2 Inferenz der `D`-Rolle bei manuellem Datei-Schieben

Wenn Ausführung de facto durch manuelle Datei-Transitions dominiert ist, wird `D` nicht blind dem Bridge-Service zugeordnet:

- **Primäre `D`-Kandidaten:** Organisationseinheit/Actor, die den fachlichen Schritt faktisch auslöst (z. B. Abteilung über Gruppenpostfach + Dateiinhalt).
- **Sekundäre `D`-Kandidaten:** Automatisierungs-Bridge als technischer Ausführungshelfer.
- **Rollenentscheidung:**
  - Bei klarer fachlicher Evidenz: `D` = fachliche Einheit, Bridge als Ausführungskanal im Trace.
  - Bei nur technischer Evidenz: vorläufig `D` mit niedriger Konfidenz + Pflicht zur Nachkorrelation.

Damit bildet VDMI die gelebte operative Realität ab, ohne technische Transportartefakte mit fachlicher Verantwortlichkeit zu verwechseln.

#### 5.6.3 Qualitäts- und Schutzregeln

- **Confidence-Floor:** Unter Mindestkonfidenz keine Promotion in Standard-Matrix.
- **Dual-Evidence-Regel:** Für kritische Schritte müssen mindestens zwei unabhängige Evidenzklassen vorliegen (z. B. Dateiinhalt + Prozessfolgeevent).
- **Ambiguitäts-Flag:** Unklare Zuordnung erzeugt Finding statt stiller Fehlzuordnung.
- **Auditierbarkeit:** Jede Ableitung dokumentiert Quelle, Klassifikationsbegründung, Konfidenz und offene Unsicherheiten.

#### 5.6.4 Beispiel: Bewegungsdaten für Dispatch

`mail.attachment.extracted` + Dateiheader "Inbetriebnahme/Außerbetriebnahme" + späteres Folgeevent aus Dispatch-Kontext
→ LLM klassifiziert Muster als "Stammdaten-/Bewegungsdaten-Update für Dispatch"
→ `D` wird der fachlich ausführenden Einheit zugeordnet (nicht nur dem Mail-/RPA-Kanal)
→ Bei Konflikt mit Soll-Rolle: Finding gemäß Abschnitt 8.11/8.12 (`VD_SHADOW_*`, `VD_ROLE_*`)

---

## 6. API-Perspektiven (API-First)

Drei Sichten auf VDMI-Matrizen für unterschiedliche Konsumenten:

### 6.1 Tenant-Sicht
```
GET  /api/vdmi                          Alle Matrizen des Tenants
GET  /api/vdmi/templates                Alle Standard-Templates
GET  /api/vdmi/audit                    ISO-55001-Audit-Report
GET  /api/vdmi/nominations              Offene Nominierungs-Anfragen
```

### 6.2 Nutzer-Sicht (HITL-orientiert)
```
GET  /api/vdmi/my-responsibilities      Matrizen wo ich V-Rolle habe
GET  /api/vdmi/my-informed              Matrizen wo ich I-Rolle habe
POST /api/vdmi/{id}/nominate            Nomination einer Ad-hoc-Matrix
POST /api/vdmi/{id}/confirm-nomination  HITL-Bestätigung einer Nomination
```

### 6.3 Agenten-Sicht (Guardrail-Abfrage)
```
GET  /api/vdmi/agent/{agentId}/role?processType=xyz
→ Antwort: { role: "M", constraints: [...] }
   → Agent weiß: "Ich berate, entscheide nicht"

GET  /api/vdmi/context?jobId=xyz
→ Aktive Matrix für laufenden Job als Guardrail

POST /api/vdmi/detect                   LLM-Inferenz aus Event-Sequenz
POST /api/vdmi/{id}/nominate            Agent nominiert Ad-hoc → Standard
```

### 6.4 API-Gateway-/RBAC-Constraints für VDMI

VDMI-Endpunkte folgen denselben Sicherheitsprinzipien wie bestehende produktive APIs.

#### Endpoint-Klassen

1. **Read-only** (`GET /api/vdmi/*`)
  Lesen von Matrizen, Kontexten, KPIs.

2. **Decision** (`POST /api/vdmi/{id}/nominate`, `.../confirm-nomination`)
  Geschäftsrelevante Entscheidungen mit Auditpflicht.

3. **Admin** (z. B. Rebuild/Repair/Contract-Registry)
  Betriebs- und Governance-Eingriffe, eng begrenzt.

#### Mindestanforderungen

- Tenant-Isolation für alle Query- und Write-Pfade.
- Rollenbasierte Autorisierung pro Endpoint-Klasse.
- Vollständiger Audit-Eintrag bei allen Decision/Admin-Operationen.
- Einheitliche Fehler-/Header-Semantik analog Gateway-Standard.

### 6.5 Mensch-Maschine-Interaktion & Governance-APIs

Die folgenden Endpunkte ergänzen den Inferenz-"Happy Path" um kontrollierte menschliche Eingriffe für ein Vue.js-Frontend.

#### 6.5.1 Human Override (Korrektur & Editierung)

```text
PATCH /api/vdmi/{id}
POST  /api/vdmi/{id}/revert
```

Zweck:
- `PATCH`: partielle Rollen-/Task-Korrektur einer inferierten Matrix vor Nomination; Änderung nur mit Pflichtbegründung, die als Audit-Eintrag persistiert wird.
- `revert`: Rückrollen auf eine frühere Matrixversion bei Fehlzuordnung oder Governance-Konflikt.

#### 6.5.2 Spectator Mode für A2A-Dialoge (Transparenz)

```text
GET /api/vdmi/tasks/{taskId}/negotiation-trace
GET /api/vdmi/tasks/{taskId}/dossier
```

Zweck:
- `negotiation-trace`: vollständige, zeitlich geordnete Argumentationsspur der Agenten (Claims, Evidenz, Rollen-Checks, Abbruch-/Eskalationsgründe).
- `dossier`: verdichtetes Entscheidungsdokument für Rolle `V` (Faktenbasis, Dissenspunkte, Optionen, Empfehlung).

#### 6.5.3 Workflow für Governance-Findings (Shadow-IT Resolution)

```text
GET  /api/vdmi/findings?severity=H&status=open
POST /api/vdmi/findings/{findingId}/mitigate
POST /api/vdmi/findings/{findingId}/resolve
```

Zweck:
- `GET /findings`: Frontend-Liste offener Soll-Ist-Abweichungen, filterbar nach Severity/Status/Code.
- `mitigate`: Einreichen eines Maßnahmenplans (Owner, Frist, Maßnahmenpaket) als governance-fähiger Workflow-Schritt.
- `resolve`: manuelles Schließen nach Nachweis der Behebung inkl. Evidenz-Referenz und Abschlussbegründung.

#### 6.5.4 Offline-Realität (Manuelle Evidenz-Injektion)

```text
POST /api/vdmi/{id}/evidence
```

Zweck:
- Einbringung manueller Nachweise (z. B. Aktenvermerk, Telefonentscheid, Sitzungsprotokoll), wenn ein erwartetes System-Event fehlt.
- Aufhebung von State-Machine-Blockern unter Auditpflicht, ohne die Nachvollziehbarkeit der `V`-/`D`-Rollenentscheidung zu verlieren.

#### 6.5.5 Frontend-Nutzen (Vue.js)

- Ermöglicht kontrollierten Human-in-the-Loop statt nur passiver Anzeige.
- Trennt klar zwischen maschineller Inferenz, menschlicher Korrektur und Governance-Abschluss.
- Macht agentische Entscheidungen prüfbar, korrigierbar und revisionssicher bedienbar.

---

## 7. Datenmodell

### 7.1 VDMI-Matrix-Instanz

```javascript
{
  _id: "vdmi:<uuid>",
  id: "<uuid>",
  tenantId: "stadtwerk-a",

  // Prozessreferenz
  processId: "<job-uuid>",
  processType: "adhoc" | "standard",
  standardMatrixId: "grid-connection-approval",
  standardMatrixVersion: "1.2.0",

  // Beschreibung (ISO 55001 Kap. 4.2 / 6.1)
  name: "Netzanschluss-Genehmigung PV-Anlage",
  scope: "VNB-Netzanschluss gemäß §8 NAV",
  assetCategory: "Erzeugungsanlage",
  regulatoryBasis: ["§8 NAV", "VDE-AR-N 4105"],

  // VDMI-Aufgaben (je eine Zeile der Matrix)
  tasks: [
    {
      taskId: "task-01",
      taskName: "Technische Netzprüfung",
      phase: "Prüfung",
      verantwortlich: [{ actorType: "user",    actorId: "grid_operator" }],
      durchfuehrend:  [{ actorType: "service",  actorId: "cya" }],
      mitwirkend:     [{ actorType: "agent",    actorId: "technical" }],
      information:    [{ actorType: "external", actorId: "applicant" }],
      hitlRequired: true,
      hitlItemId: "hi:<uuid>",
      executionTrace: [ /* Event-Einträge vom Message Bus */ ]
    }
  ],

  // Lebenszyklus
  status: "active" | "completed" | "archived",
  createdAt, updatedAt, completedAt,

  // ISO 55001 Audit-Felder
  lastReviewedAt, reviewedBy, nextReviewDue,
  certificationScope: "ISO55001",
  isoClause: "8.1",

  // Inferenz-Metadaten
  autoDetected: true,
  detectionSource: "moleculer-events" | "manual" | "template",
  detectionConfidence: 0.92,

  // Nomination
  nominationStatus: null | "pending" | "confirmed" | "rejected",
  nominatedBy: { actorType: "agent", actorId: "cya" },
  nominatedAt: "ISO8601",
  nominationHitlItemId: "hi:<uuid>",

  // Reifungs-Tracking
  eventPatternHash: "<llm-semantic-fingerprint>",
  patternMatchCount: 7,
  promotionThreshold: 10
}
```

### 7.2 Standard-VDMI-Matrix-Template

```javascript
{
  _id: "vdmi-template:<id>",
  id: "grid-connection-approval",
  version: "1.2.0",
  tenantId: null,                      // null = systemweiter Standard

  name, description, scope, assetCategory,
  regulatoryBasis: ["§8 NAV", "VDE-AR-N 4105"],
  certificationScope: "ISO55001",
  isoClause: "8.1",

  taskTemplates: [ /* gleiche Struktur wie tasks */ ],

  changelog: [
    { version: "1.2.0", date: "2026-03-01", author: "grid_operator",
      changes: "§14a-Regelung ergänzt" }
  ],

  createdAt, updatedAt,
  promotedFromMatrixId: "<uuid>",      // Herkunft aus Ad-hoc-Matrix
  isSystemDefault: false,
  usageCount: 12
}
```

---

## 8. Integration mit bestehenden Komponenten

### 8.0 Integrationsziel in realen VNB-Strukturen

VDMI integriert nicht nur in technisch saubere API-Pfade, sondern explizit in fragmentierte VNB-Landschaften mit konkurrierenden Prozessrealitäten.

**Leitprinzip:** Jeder relevante Arbeitsschritt soll als beobachtbares Ereignis in der Inferenz erscheinen — unabhängig davon, ob er im Kernsystem, in einem Fachservice oder in einer Schatten-IT-Umgebung ausgelöst wurde.

Typische zusätzliche Signalquellen (konzeptionell):
- O365-/SharePoint-Aktivitätsevents (Datei-Upload, List-Update, Freigabe)
- Dokumenten- und Mail-Events in Freigabeprozessen
- Fachbereichsnahe Tooling-Spuren (CSV-Exporte, manuelle Datenrückimporte)

Diese Quellen ergänzen den Moleculer-Bus um de-facto-Ausführungssignale und schließen die Lücke zwischen Prozessdokumentation und operativer Praxis.

| Komponente | Rolle im VDMI-Kontext |
|------------|----------------------|
| **HITL-Service** | Liefert V-Rolle-Ereignisse; empfängt Nomination-Bestätigungen |
| **Moleculer Event Bus** | Primäre Datenquelle für automatische VDMI-Inferenz |
| **Job Store** | `processId` verknüpft Job mit VDMI-Matrix |
| **Agent-Personas** | Immer M-Rolle; nutzen Matrix als Guardrail vor Entscheidungen |
| **Capability Broker** | Plan-Schritte werden 1:1 auf VDMI-Tasks abgebildet |
| **Webhooks** | Empfänger werden automatisch als I-Rolle erfasst |
| **Observability** | Vollständiger Audit-Trail aller Matrix-Ereignisse |

### 8.1 Integrationsmatrix: bestehende Services ↔ VDMI-Rollen

| Bestehender Service | Typischer VDMI-Beitrag | Erwartete Hauptrollen |
|---------------------|------------------------|------------------------|
| `grid-connection` | Technische/regelbasierte Netzanschlussprüfung | D (Service), M (Agent), V (HITL) |
| `energy-sharing` | §42c-Kontextvalidierung inkl. Entscheidungsbadge | D + M, optional V |
| `mastr-quality` | Portfolio-Audit mit Findings (`MQ_*`) | D + M, V bei kritischen Findings |
| `redispatch-expost` | Settlement-Readiness / Risikoanalyse (`RD_*`) | D + M, V bei Risikoeskalation |
| `dashboard-api` | Aggregierte VDMI-Kennzahlen für UI/Steuerung | I (Management-Transparenz) |
| `token-manager` | Zugriffsschutz für VDMI-Routen nach Scope | Querfunktional (Security-Guardrail) |

### 8.2 Integration in bestehende API-/OpenAPI-Konventionen

- Jede VDMI-Action erhält vollständige OpenAPI-Metadaten (wie im Projektstandard erzwungen).
- Das bereits etablierte 202-Async-Muster wird bei langlaufenden VDMI-Operationen beibehalten.
- UI-Contracts unter `docs/ui-contracts/` bleiben die führende Schnittstelle zur Frontend-Integration.

### 8.3 Datenhaltungskonzept (kompatibel zu PouchDB-Konventionen)

- Dokument-Präfixe: `vdmi:` für Instanzen, `vdmi-template:` für Standards, `vdmi-audit:` für Prüfprotokolle.
- Metadaten first: keine unnötige Rohdatenpersistenz aus Fremdquellen.
- Revisions- und Änderungsverlauf analog zum bestehenden Audit-fähigen Service-Stil.

---

## 8.4 LLM/KI-Entscheidungsschicht für VDMI (Qualität vor Autonomie)

Ziel ist nicht „mehr KI", sondern **bessere und reproduzierbare Entscheidungen**. Das Konzept folgt deshalb einer kontrollierten Hybrid-Strategie.

### Entscheidungsprinzip: Deterministisch zuerst, LLM gezielt ergänzend

1. **Regel-/Eventbasierte Evidenz priorisieren**
  Harte Signale (`hitl.item.created`, expliziter Approver, bestätigte Action-Completion) dominieren.

2. **LLM nur bei Ambiguität oder Musterbildung**
  Semantische Ähnlichkeitsbewertung, Rollenauflösung bei unvollständigem Kontext, Reifegrad-Clustering.

3. **Confidence-Gates erzwingen Qualität**
  Unterhalb definierter Schwellen: keine automatische Promotion, sondern HITL oder „I“-Fallback.

4. **Auditierbarkeit jeder KI-Entscheidung**
  Prompt-Hash, Modell-ID, Konfidenz, Begründung, Gegenbeweise und finale Entscheidung werden protokolliert.

### Konkreter KI-Mehrwert im VDMI-Kontext

- **Semantische Prozessnormalisierung:** Unterschiedliche Event-Sequenzen desselben Prozesstyps werden robust zusammengeführt.
- **Rollen-Disambiguierung:** Bei konkurrierenden Kandidaten schlägt die KI eine Rolle inkl. Begründung vor.
- **Qualitätsverbesserung über Feedback-Lernen:** HITL-Entscheidungen werden als Gold-Feedback für spätere Kalibrierung genutzt.
- **Drift-Erkennung:** Sinkende Übereinstimmung zwischen KI-Vorschlag und HITL-Entscheidungen triggert Re-Review.

### Sicherheits- und Governance-Leitplanken

- `src/prompt-scrubber.js` ist verpflichtend vor jedem externen LLM-Aufruf.
- Keine autonomen Standard-Promotions ohne menschliche Freigabe.
- Mandantenkontext darf nie tenant-übergreifend in KI-Prompts vermischt werden.
- Bei Service-Degradation (LLM nicht verfügbar) bleibt VDMI funktionsfähig im deterministischen Kernmodus.

### Qualitätsmetriken (für produktive Steuerung)

| Metrik | Zielbild |
|--------|----------|
| Rollen-Genauigkeit (`V/D/M/I`) vs. HITL-Truth | kontinuierlich steigend |
| Anteil „LLM benötigt" pro Prozessklasse | sinkend mit Reife |
| Nomination-Ablehnungsrate im HITL | sinkend, da bessere Kandidaten |
| Zeit bis bestätigte Standard-Matrix | sinkend ohne Qualitätsverlust |
| Drift-Index (KI vs. Mensch) | stabil unter definierter Warnschwelle |

### 8.5 Async-Betriebsmodell (Lernpfad) auf Basis bestehender Job-Patterns

VDMI unterscheidet explizit zwischen Low-Latency-Guardrail-Reads und entkoppelten Lern-/Reifejobs.

#### Laufzeitpfade

- **Read-Pfad (synchron):** Rollenabfrage für laufenden Prozess, keine Blockade durch KI.
- **Write-/Lernpfad (asynchron):** Musterbildung, Reifegrad-Rebuild, Drift-Analyse als Job-Flow mit `jobId`.

#### Betriebsregeln

- Tenant-faires Scheduling (keine Dominanz eines Tenants).
- Leases/Heartbeats für robuste Worker-Ausführung.
- TTL/GC für veraltete Lernjobs und Zwischenartefakte.
- Backpressure-Strategie: Priorisierung von Guardrail-kritischen Jobs.

#### Degradation-Verhalten

- Bei Queue-Stau bleibt Read-Pfad uneingeschränkt verfügbar.
- Bei Lernstau wird nur Reifegradaktualisierung verzögert, nicht die operative Rollenauflösung.

### 8.6 LLM-Governance (an bestehende LLM-Layer gekoppelt)

Die VDMI-KI-Schicht nutzt die vorhandenen LLM-Betriebsmechanismen (Timeout, Retry, Quota, Structured Output) als Governance-Basis.

#### Decision Gates

1. **Quota Gate**: kein Aufruf über Tenant-Kontingent.
2. **Quality Gate**: Confidence unter Schwellwert ⇒ kein Auto-Promotion.
3. **Policy Gate**: kritische Entscheidungen immer HITL-pflichtig.

#### Auditable AI Record pro Entscheidung

- Modell/Provider/Modus
- Prompt-Hash + Scrubbing-Indikator
- Retry-Anzahl/Timeout-Klasse
- Konfidenz + finale Entscheidungsquelle (`rule`, `llm`, `hitl`)

### 8.7 Prompt-/PII-Sicherheitskette

Für alle VDMI-Inferenzpfade gilt eine verpflichtende Datenkette:

`Event-Ingest → Feldreduktion → PII-Scrubbing → Prompt-Build → LLM-Call → Audit`

#### Leitplanken

- Nur notwendige Eventfelder in den Prompt (Need-to-Know).
- Keine tenant-fremden Kontextdaten im selben Prompt.
- Re-Identifikation nur über expliziten, auditierten Prozess.
- Fehlerhafte/unsichere Payloads führen zu regelbasiertem Fallback statt unkontrollierter KI-Verarbeitung.

### 8.8 KPI-Definitionen für Dashboard-Integration

VDMI-KPIs werden zweistufig geführt: **Business-KPIs für C-Level** und **operative KPIs** für Service-/Prozesssteuerung.

#### 8.8.1 Business-KPIs (Management-Cockpit)

| KPI | Definition (fachlich) | Nutzen für Management |
|-----|------------------------|------------------------|
| `vdmi_shadow_path_resolution_rate` | Anteil identifizierter Schatten-IT-Pfade (`VD_SHADOW_*`, `VD_SILO_*`), die durch VDMI-Standardisierung in auditierbare End-to-End-Prozesse überführt wurden | Messbarer Abbau von Blindflügen und Governance-Risiken |
| `vdmi_n1_escalation_reduction_rate` | Prozentuale Reduktion wiederkehrender Eskalationen in N-1-/Engpass-nahen Entscheidungsfällen (Vorperiode vs. aktuelle Periode) nach Einführung von VDMI-Guardrails | Weniger operative Krisensteuerung, höhere Versorgungssicherheit |
| `vdmi_fnav_time_to_decision_gain_days` | Verkürzung der Entscheidungszeit für flexible Netzanschluss-/fNAV-Fälle (Median vorher vs. nachher) | Schnellere Anschlussentscheidungen, höhere Steuerbarkeit im Netzanschlussportfolio |

#### 8.8.2 Monetäre Ableitungen (EOG/EUG, CAPEX, TOTEX)

Die KPIs werden zusätzlich in finanzielle Wirkung übersetzt:

- **EOG/EUG-Risikoentlastung (Proxy):** weniger nicht-auditierbare Schattenpfade und Eskalationsschleifen reduzieren regulatorische Unsicherheiten in der Erlösobergrenzen-Logik.
- **CAPEX-Vermeidungsbeitrag (Proxy):** schnellere, strukturierte Abwägung von Ausbau vs. Flexibilität (TOTEX-Sicht) senkt den Anteil vorschneller Ausbauentscheidungen.
- **Operative Kostenentlastung:** geringere Eskalationslast und kürzere Entscheidungszyklen reduzieren manuelle Koordinationsaufwände.

> Management-Zielbild: VDMI ist nicht nur Prozess-Transparenz, sondern ein Instrument zur **End-to-End-Bereinigung mit wirtschaftlichem Effekt**.

#### 8.8.3 Operative KPIs (weiterhin relevant)

| KPI | Definition | Ziel/SLO |
|-----|------------|----------|
| `vdmi_nomination_lead_time_hours` | Median von Nomination bis HITL-Entscheid | sinkend |
| `vdmi_hitl_rejection_rate` | Anteil abgelehnter Nominations je Fenster | sinkend |
| `vdmi_role_accuracy` | Übereinstimmung KI/Regel vs. bestätigter HITL-Rolle | steigend |
| `vdmi_drift_index` | Abweichung aktueller Entscheidungen ggü. Referenzfenster | unter Warnschwelle |
| `vdmi_llm_dependency_ratio` | Anteil Prozesse mit notwendigem LLM-Aufruf | sinkend mit Reife |

#### Robustheitsprinzip für KPI-Aggregation

- KPI-Berechnung ist fehlertolerant (partial results statt Hard-Fail).
- Bei Teil-Ausfall einzelner Datenquellen werden degradierte, aber nutzbare Kennzahlen geliefert.

### 8.9 Aufdeckung von Management-Theater und Schatten-Prozessen

VDMI bewertet nicht nur „wer hat etwas getan", sondern den Abgleich von Soll- und Ist-Rollen je Prozessschritt.

#### Soll-Ist-Vergleich pro Task

Für jede Aufgabe werden zwei Sichten parallel geführt:

1. **Soll-Rollen** aus Prozesshandbuch, Template oder organisatorischer Vorgabe
2. **Ist-Rollen** aus beobachteten Events (Kernsystem + Schatten-IT-Signale)

Abweichungen werden als Governance-Findings klassifiziert.

#### Typische Muster

- **V-D-Entkopplung:** `V` liegt formal bei Abteilung A, `D` wird wiederholt von Abteilung B ausgeführt.
- **Schatten-Ausführung:** kritische operative Schritte erscheinen primär in Excel-/SharePoint-Ereignissen statt im vorgesehenen Kernsystem.
- **Silo-Bypass:** Übergaben zwischen kaufmännischem und technischem Bereich erfolgen über manuelle Artefakte statt über definierte Schnittstellen.
- **Pseudo-Unbundling-Argumentation:** organisatorische Trennung wird als Begründung genutzt, führt aber zu nicht auditierbaren Parallelprozessen.

#### Inferenzlogik (konzeptionell)

- Eventsequenzen werden rollenbezogen aggregiert (`V/D/M/I` pro Task und Org-Einheit).
- Wiederkehrende Soll-Ist-Abweichungen erhöhen einen `roleDeviationScore`.
- Überschreitet der Score eine definierte Schwelle, erzeugt VDMI ein HITL-/Audit-Item mit Belegkette.
- Relevante KPIs: Anteil Tasks mit V-D-Entkopplung, Schatten-IT-Quote, Zeit bis Klärung.

#### Wirkung

VDMI wird damit zum systematischen Silo-Aufdeckungswerkzeug:
- operative Verantwortung wird evidenzbasiert sichtbar
- politisch verdeckte Parallelprozesse werden auditierbar
- Management-Entscheidungen basieren auf beobachteter Realität statt auf formaler Selbstdarstellung

### 8.10 Bewertungsmatrix für Soll-Ist-Abweichungen

Damit Findings nicht nur qualitativ beschrieben, sondern operativ priorisiert werden, verwendet VDMI eine einheitliche Schweregrad-Matrix.

#### Bewertungsachsen

- **Rollenabweichung:** Stärke der Abweichung zwischen Soll-`V/D` und Ist-`V/D`
- **Prozesskritikalität:** regulatorische und betriebliche Relevanz des Tasks
- **Persistenz:** Einzelfall vs. wiederkehrendes Muster über mehrere Ausführungen
- **Nachvollziehbarkeit:** auditierbare Evidenzkette vorhanden oder lückenhaft

#### Schweregrade

| Schweregrad | Typisches Muster | Handlung |
|-------------|------------------|----------|
| **L (Low)** | Einmalige Abweichung ohne regulatorischen Bezug, Evidenz vollständig | Beobachten, in Trendanalyse aufnehmen |
| **M (Medium)** | Wiederkehrende V-D-Entkopplung in nicht-kritischem Teilprozess | Task-Owner informieren, Frist zur Korrektur setzen |
| **H (High)** | Schatten-IT-Ausführung in kritischem Prozessschritt oder bereichsübergreifender Silo-Bypass | Pflicht-HITL, Bereichsleitung einbinden, Maßnahmenplan erzwingen |
| **K (Kritisch)** | Systematische Abweichung in regulatorisch relevanten Kernprozessen mit unvollständiger Auditspur | Sofort-Eskalation Management/Compliance, Governance-Review, ggf. Prozessstopp bis Risiko bewertet |

#### Beispielhafte Scoring-Logik (konzeptionell)

`severityScore = roleDeviationScore + criticalityScore + persistenceScore + traceabilityPenalty`

- **L:** 0–24
- **M:** 25–49
- **H:** 50–74
- **K:** 75–100

Die konkrete Gewichtung ist tenant-spezifisch konfigurierbar, muss jedoch revisionssicher versioniert werden.

#### Mindest-Reaktion pro Schweregrad

- **L/M:** dokumentierte Nachverfolgung im Audit-Trail
- **H:** verpflichtendes HITL-Item mit Verantwortlichem und Fälligkeitsdatum
- **K:** zusätzlich Compliance-Flag, Management-Benachrichtigung und priorisierte Behandlung im Dashboard

### 8.11 Finding-Code-Katalog (VDMI)

Für Soll-Ist-Abweichungen nutzt VDMI eine konsistente Code-Familie analog bestehender Finding-Kataloge.

#### Namensschema

`VD_<DOMAENE>_<MUSTER>_<SEVERITY>`

- `DOMAENE`: `SILO`, `SHADOW`, `ROLE`, `GOV`, `UNBUNDLE`
- `SEVERITY`: `L`, `M`, `H`, `K`

Beispiel: `VD_SHADOW_EXCEL_EXEC_H`

#### Kern-Codes (Initialkatalog)

| Finding Code | Bedeutung | Standard-Schweregrad |
|--------------|-----------|----------------------|
| `VD_ROLE_VD_DECOUPLING_M` | Formale `V`-Rolle und de-facto-`D`-Ausführung liegen dauerhaft in unterschiedlichen Organisationseinheiten | M |
| `VD_ROLE_V_OWNER_ABSENT_H` | Wiederholte Task-Ausführung ohne evidenten Eingriff/Entscheid der vorgesehenen `V`-Rolle | H |
| `VD_SHADOW_EXCEL_EXEC_H` | Kritischer Prozessschritt wird primär über Excel-Artefakte ausgeführt statt über vorgesehenes Kernsystem | H |
| `VD_SHADOW_SHAREPOINT_BYPASS_H` | SharePoint/O365-Aktivität ersetzt definierte Systemschnittstelle in kritischem Ablauf | H |
| `VD_SILO_HANDOVER_MANUAL_M` | Bereichsübergabe erfolgt manuell (Datei/Mail) statt über definierten Integrationspfad | M |
| `VD_SILO_KERNSYSTEM_BLOCK_M` | Zugriff auf führendes Kernsystem organisatorisch blockiert, Workaround etabliert | M |
| `VD_UNBUNDLE_PSEUDO_ARG_H` | Unbundling-Argumentation wird zur faktischen Umgehung auditierbarer Standardprozesse genutzt | H |
| `VD_GOV_AUDIT_GAP_K` | Kritische Soll-Ist-Abweichung mit unvollständiger Belegkette / fehlender Auditspur | K |
| `VD_GOV_RECURRENCE_K` | Mehrfach bestätigte Hochrisiko-Abweichung ohne wirksame Gegenmaßnahme über definiertes Zeitfenster | K |

#### Mapping-Regeln

- Jede erkannte Abweichung erhält mindestens einen `VD_*`-Code.
- Schweregrad aus Abschnitt 8.10 kann per Scoring hoch-/herabgestuft werden (`M` → `H` usw.).
- Bei Mehrfachtreffern gilt der höchste Schweregrad als primäre Eskalationsstufe.
- Alle Code-Zuweisungen werden mit Evidenzreferenzen im Audit-Trail gespeichert.

#### KPI-Kopplung

- `vdmi_shadow_it_rate` = Anteil Fälle mit `VD_SHADOW_*`
- `vdmi_role_decoupling_rate` = Anteil Fälle mit `VD_ROLE_VD_DECOUPLING_*`
- `vdmi_critical_governance_findings` = Anzahl `VD_GOV_*_K` im Beobachtungsfenster

### 8.12 Code-Matrix (Default + Auto-Hochstufung)

Die Code-Matrix definiert pro Finding-Code den Start-Schweregrad und klare Regeln für automatische Hochstufung.

| Finding Code | Default | Auto-Hochstufung auf H | Auto-Hochstufung auf K |
|--------------|---------|-------------------------|-------------------------|
| `VD_ROLE_VD_DECOUPLING_M` | M | wenn in ≥3 aufeinanderfolgenden Prozessausführungen bestätigt | wenn zusätzlich kritischer Prozessschritt betroffen + keine Maßnahme im SLA-Fenster |
| `VD_ROLE_V_OWNER_ABSENT_H` | H | n/a (bereits H) | wenn regulatorisch relevanter Task ohne `V`-Entscheid abgeschlossen wurde |
| `VD_SHADOW_EXCEL_EXEC_H` | H | n/a (bereits H) | wenn Excel-Ausführung in Kernprozess wiederholt auftritt und Auditspur unvollständig ist |
| `VD_SHADOW_SHAREPOINT_BYPASS_H` | H | n/a (bereits H) | wenn Bypass kritische Freigabe-/Prüfschritte ersetzt |
| `VD_SILO_HANDOVER_MANUAL_M` | M | wenn manuelle Übergabe zu Verzögerung/Fehlern in kritischem Ablauf führt | wenn trotz bestätigtem Maßnahmenplan keine Stabilisierung erreicht wird |
| `VD_SILO_KERNSYSTEM_BLOCK_M` | M | wenn Blockade zu dauerhaftem Schattenprozess in kritischem Bereich führt | wenn Governance-/Compliance-Risiko durch fehlende Systemspur entsteht |
| `VD_UNBUNDLE_PSEUDO_ARG_H` | H | n/a (bereits H) | wenn Argumentation nachweislich wiederholt zur Umgehung auditierbarer Pflichtprozesse genutzt wird |
| `VD_GOV_AUDIT_GAP_K` | K | n/a | n/a (bleibt K bis Nachweis der Schließung) |
| `VD_GOV_RECURRENCE_K` | K | n/a | n/a (bleibt K bis wirksame Gegenmaßnahme verifiziert) |

#### Globale Eskalationsregeln

- Zwei verschiedene `VD_*_H` in demselben Prozessfenster ⇒ Gesamtfall mindestens `K`.
- Jeder Finding-Code mit `traceabilityPenalty` oberhalb Schwelle aus Abschnitt 8.10 ⇒ eine Stufe höher.
- Wiederholte Verstöße nach geschlossener Maßnahme (Re-Occurrence) ⇒ direkt `K`.

#### Rückstufungsregeln (De-Eskalation)

- Rückstufung erst nach dokumentierter Wirksamkeitsprüfung über definiertes Beobachtungsfenster.
- Keine Rückstufung ohne vollständige Evidenzkette im Audit-Trail.
- `K`-Findings benötigen explizite HITL-/Management-Freigabe zur Rückstufung.

---

## 9. Alignment mit ISO 55000 / ISO 55001

| ISO 55001 Kapitel | Anforderung | VDMI-Umsetzung |
|-------------------|-------------|----------------|
| **5.1** Führung | Managementverantwortung | V-Rolle ist immer genau eine Instanz |
| **5.3** Rollen | Org. Zuweisungen | Gesamtes VDMI-Modell |
| **6.1** Risiken | Risikobewertung | `detectionConfidence`, HITL-Eskalation |
| **8.1** Operation | Prozessdurchführung | Task-Liste mit D-Akteuren + Guardrail |
| **8.2** Change Mgmt | Änderungskontrolle | Template-Versioning, Nomination-Workflow |
| **9.1** Überwachung | KPIs | Event-Trace, HITL-SLA, `patternMatchCount` |
| **9.2** Audit | Auditierbarkeit | Vollständiger Audit-Trail, `lastReviewedAt` |
| **9.3** Mgmt-Review | Review-Zyklus | `nextReviewDue`, `reviewedBy` |
| **10.3** Verbesserung | Optimierung | Nomination-Zyklus, Reifungsgrad |

### Tenant-Zertifizierungsnachweis

Ein Tenant kann gegenüber einem ISO-55001-Auditor nachweisen:
1. Alle kritischen Prozesse haben dokumentierte V/D/M/I-Zuweisungen
2. Eingriffspunkte des Managements (V) sind explizit und auditierbar
3. Prozessänderungen sind versioniert und HITL-bestätigt
4. Review-Zyklen sind konfiguriert und eingehalten

---

## 10. Vorgesehene Standard-Matrizen (systemseitig mitgeliefert)

| Matrix-ID | Prozess | Regulatorische Basis | Typische Konfliktlinie (durch VDMI zu befrieden) |
|-----------|---------|---------------------|---------------------------------------------------|
| `grid-connection-approval` | Netzanschluss-Genehmigung | §8 NAV, VDE-AR-N 4105 | Anschlussdruck vs. Netzsicherheits-/Prüfanforderungen |
| `redispatch-process` | Redispatch-Prozess | §13 EnWG, SOGL | Betriebsstabilität vs. kurzfristige operative Umsetzbarkeit |
| `energy-sharing-validation` | Energy-Sharing-Validierung | §42c EnWG | Lokale Teilhabe-/Vertragslogik vs. Mess-/Abrechnungsgrenzen |
| `mastr-quality-audit` | MaStR-Qualitätsprüfung | MaStR-VO, §5 MaStRV | Datenqualitätspflicht vs. historisch gewachsene Datenlücken |
| `section-14a-control` | §14a-Steuerungskonzept | §14a EnWG, BK6-22-300 | Netzengpass-Management vs. Kundenkomfort/Steuerakzeptanz |
| `asset-condition-review` | Anlagen-Zustandsbewertung | ISO 55001 Kap. 8.1 | Instandhaltungsbedarf vs. Budget-/Priorisierungszwänge |
| `fnav-contract-negotiation` | Abschluss flexibler Netzanschlussvereinbarungen für engpasskritische Großlasten (z. B. Großwärmepumpen, Speicher, Rechenzentren) | §14a EnWG, §8a EEG | Technische Forderung nach Ausbau/CAPEX vs. kaufmännisch-strategische Flex-/Vertragslösung (fNAV/TOTEX) |
| `dispatch-masterdata-update` | Verarbeitung von Bewegungsdaten (Inbetriebnahmen/Außerbetriebnahmen) für Engpassmanagement- und Dispatch-Prozesse | §13 EnWG, SOGL, MaStR-VO | Manuelle Office-365/Excel-Zulieferung vs. Bedarf an revisionssicherer, fristgerechter Stamm- und Bilanzierungsdatenqualität |
| `capex-totex-evaluation` | Strategischer Entscheidungsprozess Ausbau (CAPEX) vs. flexible Steuerung/Vertragsansatz (TOTEX) für Anschlussbegehren | EnWG, ARegV (EOG-/Effizienzrahmen), §14a EnWG | Technische Langfristsicherheit und Ausbaudruck vs. wirtschaftliche Effizienz, Regulierungswirkung und Flexibilitätsstrategie |

---

## 11. Beispiel-Ablauf: Von der ersten Aufgabe zur Standard-Matrix

```
1. Erste Ausführung — Ad-hoc-Matrix entsteht
   ─────────────────────────────────────────
   Nutzer: "Prüfe Netzanschluss PV-Anlage 500kW"
   → Job xyz gestartet
   → Events treffen ein:
       cya.analyze.completed      → D: cya
       agent.technical.evaluated  → M: technical-Agent
       hitl.item.created          → V: grid_operator
       webhooks.delivered         → I: applicant
   → LLM aggregiert → Ad-hoc-Matrix, Konfidenz 0.93
   → eventPatternHash: "abc123", patternMatchCount: 1

2. Wiederholung — Muster reift
   ───────────────────────────
   9 weitere ähnliche Aufgaben → patternMatchCount: 10
   LLM: semantisch gleicher Prozesstyp ✓
   → Schwellenwert erreicht

3. Nomination
   ──────────
   Agent nominiert: "Muster = Netzanschluss-Prüfung"
   → HITL-Item an grid_operator
   → grid_operator bestätigt

4. Standard-Matrix aktiv
   ──────────────────────
   Template "grid-connection-approval" v1.0.0 angelegt
   Nächste Ausführung: Agent fragt Matrix ab → Guardrail aktiv
   → deterministische Rollenverteilung von Beginn an
```

---

## 12. Offene Punkte / Nächste Schritte

- [ ] **UI**: VDMI-Matrix-Visualisierung (Matrixansicht, Reifungsgrad-Anzeige)
- [ ] **Export**: Excel/PDF für ISO-55001-Zertifizierungsunterlagen
- [ ] **Externe QMS-Schnittstelle**: Anbindung an ConSense, Agilium o. ä.
- [ ] **Schwellenwert-Konfiguration**: Tenant-spezifische Einstellung von `promotionThreshold`
- [ ] **Moleculer Contract-Katalog**: Event-Namensschema, Pflicht-Envelope, Kompatibilitäts- und Deprecation-Regeln je Version
- [ ] **LLM-Evaluationsset**: kuratierte Goldfälle aus HITL-Entscheidungen für Regressionsprüfung + Drift-Baseline
- [ ] **Fallback-Policy**: dokumentierter degradierter Kernmodus ohne LLM (inkl. Priorisierung Read-Pfad)
- [ ] **Dashboard-KPIs**: formale KPI-Definitionen + SLOs + fehlertolerante Aggregationsregeln

## 13. Umsetzungplan (Roadmap)

### Zielbild (Definition of Done)

- VDMI-Service mit Endpunkten aus Kapitel 6 inkl. `PATCH`, `revert`, `evidence`, Findings-Workflow, Spectator-Mode.
- Event-Inferenz inkl. Nasenprozess-Handling (Office/RPA-Events).
- A2A-Verhandlungs-Trace + Dossier für Rolle `V`.
- Findings-Codes `VD_*` konsistent integriert.
- Dashboard-KPIs inkl. Business-KPIs aus 8.8.
- Tests, OpenAPI, UI-Contract-Doku vollständig.

---

### Schritt 1 — Service-Grundgerüst + Datenmodell

**Änderungen**
- Neu: services/vdmi.service.js
- Optional Shared-Module: src/vdmi-*.js (Store/Mapper/Scoring)
- API-Route-Registrierung: api.service.js

**Inhalt**
- Actions für Basis-CRUD (`list`, `get`, `create`, `update`, `delete` intern).
- PouchDB-Doc-Präfixe gemäß Konzept: `vdmi:`, `vdmi-template:`, `vdmi-audit:`.
- Versionierung + Audit-Hooks vorbereiten.

**Akzeptanz**
- Service startet ohne Fehler.
- Basis-Endpunkte in OpenAPI sichtbar.

---

### Schritt 2 — Event-Inferenz + Nasenprozess-Mapping

**Änderungen**
- services/vdmi.service.js
- ggf. Mapping/Classifier in src

**Inhalt**
- Event-Subscriber für Moleculer-Events.
- Stufe-1/2-Verarbeitung (job-korreliert / lernbasiert).
- Nasenprozess-Regeln (`mail.attachment.extracted`, `sharepoint.excel.updated`) mit Dual-Evidence + Confidence-Gates.
- Rollenableitung `D/M/V/I` inkl. Konfidenz.

**Akzeptanz**
- Simulierte Event-Sequenzen erzeugen reproduzierbare Ad-hoc-Matrizen.
- Unklare Fälle erzeugen Findings statt stiller Zuordnung.

---

## Schritt 3 — Human-Governance APIs (Kapitel 6.5)

**Änderungen**
- services/vdmi.service.js
- api.service.js

**Inhalt**
- `PATCH /api/vdmi/{id}` mit Pflichtbegründung (`audit`).
- `POST /api/vdmi/{id}/revert`.
- `POST /api/vdmi/{id}/evidence`.
- RBAC + Tenant-Isolation + Audittrail.

**Akzeptanz**
- Patch ohne Begründung wird abgewiesen.
- Revert stellt Vorversion wieder her.
- Evidence hebt Blocker nachvollziehbar auf.

---

## Schritt 4 — A2A Spectator Mode + Guardrails

**Änderungen**
- services/vdmi.service.js

**Inhalt**
- `GET /api/vdmi/tasks/{taskId}/negotiation-trace`
- `GET /api/vdmi/tasks/{taskId}/dossier`
- Loop-Schutz: `roundLimit`, `convergence`, `timeout`, `roleBoundary`.

**Akzeptanz**
- Vollständiger Trace pro Task abrufbar.
- Dossier enthält Faktenbasis, Dissens, Optionen, Empfehlung.
- Endlosschleifen werden hart beendet + Finding erzeugt.

---

## Schritt 5 — Findings-Workflow + KPI-Integration

**Änderungen**
- Findings-Metadaten erweitern: validation-findings.js
- VDMI-Service + Dashboard-Aggregation: dashboard-api.service.js

**Inhalt**
- `GET /api/vdmi/findings`
- `POST /api/vdmi/findings/{findingId}/mitigate`
- `POST /api/vdmi/findings/{findingId}/resolve`
- Business-KPIs aus 8.8 (`shadow_path_resolution`, `n1_escalation_reduction`, `fnav_time_to_decision_gain`).

**Akzeptanz**
- Findings sind filterbar (Severity/Status/Code).
- Mitigate/Resolve schreibt vollständigen Audit-Eintrag.
- KPIs im Dashboard abrufbar.

---

### Schritt 6 — Qualitätssicherung, OpenAPI, Doku, Release-Gate

**Änderungen**
- Tests neu:
  - tests/vdmi.service.test.js
  - tests/vdmi.api.test.js
  - tests/vdmi.inference.test.js
- UI-Contract-Doku:
  - ui-contracts (neue VDMI-Contract-Datei)
- ggf. Update:
  - README.md

**Checks**
- `npm test`
- `npm run audit:openapi`
- `npm run release:check`

**Akzeptanz**
- Tests grün.
- OpenAPI vollständig/valide.
- Doku konsistent mit Endpunkten.

---

## Empfohlene PR-Schnitte

1. PR-A: Schritt 1–2
2. PR-B: Schritt 3–4
3. PR-C: Schritt 5–6

