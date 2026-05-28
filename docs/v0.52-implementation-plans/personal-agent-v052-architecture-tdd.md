# Cernion Personal Agent v0.52 — Architektur & TDD-Spezifikation

**Status:** Entwurf (Implementierungs-Vertrag)
**Version:** 0.1.0
**Scope:** Kein produktiver Code — Spezifikation & Test-Matrix als Vertrag fuer Entwickler/Copilot.

---

## 1. Executive Summary

Cernion v0.52 fuehrt einen **Personal Agent** als primaere Chat-Schnittstelle ein. Der Agent orchestriert existierende Moleculer-Microservices (A²MDM), uebersetzt natuerlichsprachliche Nutzer-Prompts in deterministische Service-Calls und managet Long-Running-Prozesse ueber Session-Grenzen hinweg.

**Dieses Dokument definiert:**
1. Die konzeptionelle Architektur (Zwiebelmodus, Tooling, Durable Execution, Traeumen).
2. Die **Tooling Coverage TDD-Matrix** — eine umfassende, prompt-zentrierte Test-Spezifikation, die 100% Routing-Treffsicherheit gegen den existierenden Backend-Katalog garantieren soll.
3. Die **Watchdog-Spezifikation** — ein Dead-Man's-Switch-Modell zur Vermeidung von Silent Failures bei geplanten Wake-Ups.

---

## 2. Architektur-Blaupause

### 2.1 Systemkontext

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NUTZER (UI)                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                       │
│  │ Chat-Widget  │  │ Task-Log     │  │ Profile-View │                       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                       │
└─────────┼─────────────────┼─────────────────┼─────────────────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PERSONAL AGENT SERVICE                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     ZWIEBEL CONTEXT MANAGER                          │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────────────┐ │   │
│  │  │Layer 0 │ │Layer 1 │ │Layer 2 │ │Layer 3 │ │Layer 4 (Tools)     │ │   │
│  │  │System  │ │Tenant  │ │User    │ │Session │ │Dynamic Injection   │ │   │
│  │  │Prompt  │ │Archive │ │Profile │ │History │ │& Summarization     │ │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     CAPABILITY BROKER / ROUTER                        │   │
│  │  LLM-gesteuerte Intent-Erkennung → capability-catalog.json → Actions  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     DURABLE EXECUTION KERNEL                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │   │
│  │  │ Wake-Up      │  │ Watchdog     │  │ Async Dreamer            │ │   │
│  │  │ Scheduler    │  │ (Dead-Man)   │  │ (Post-Session Processor) │ │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EXISTIERENDES CERNION BACKEND                       │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │ EDM │ │ ZNP │ │VDMI │ │Grid │ │Red. │ │Fin. │ │Flex │ │Fore.│ ...       │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Der Zwiebelmodus (Context Management)

Der LLM-Kontext wird nicht monolithisch gefuellt, sondern als stack-artige Schicht verwaltet. Bei jeder Nutzer-Nachricht wird der Kontext von unten (Layer 0) nach oben (Layer 4) aufgebaut und gegen Token-Limits geprueft.

| Layer | Inhalt | Persistenz | Aktualisierung |
|-------|--------|------------|----------------|
| **L0** | System-Prompt, Cernion-Grundregeln, Safety-Instructions | Static | Deployment |
| **L1** | Tenant-Wissen: extrahierte Fakten aus allen Tenant-Sessions, CYA-Ergebnisse, VDMI-Findings, aggregierte MeLo-Metriken | QDrant / Tenant-DB | Async nach jeder Session (Traeumen) |
| **L2** | User-Profile: Praeferenzen, hauefige Anfragemuster, individuelle MeLo-Filter, bevorzugte Darstellungsformen (Tabelle vs. Chart), Projektzuordnungen | User-DB (object-store oder dedizierte Collection) | Progressive Profiling + Traeumen |
| **L3** | Session-History: Chronologischer Chat-Verlauf der aktuellen Session | Redis / Session-Store | Echtzeit pro Turn |
| **L4** | Dynamische Tool-Contexte: OpenAPI-Fragmente, Action-Schemata, Ergebnis-JSONs von gerade aufgerufenen Services | Ephemeral (im Prompt) | On-Demand per Tool-Call |

**Layer 4 Verhalten (kritisch):**
- Wenn der Agent einen Microservice aufrufen muss, wird das **minimal noetige OpenAPI-Fragment** (Pfad + Request/Response-Schema) in L4 injiziert.
- Nach Erhalt des Ergebnisses wird der Response-Body durch einen **Compression-Step** zusammengefasst (z.B. "3 MeLos gefunden, Gesamtleistung 12.4 MW") und das volle JSON aus L4 entfernt.
- L4 darf niemals mehr als ein aktives Tool plus das zugehoerige Ergebnis halten, um Context-Overflow zu verhindern.

**Token-Budget-Regel:**
- Max Context Window: 128k Tokens (konfigurierbar).
- Reservierung: L0 = 2k, L1 = 8k, L2 = 4k, L3 = 10k, L4 = variabel (max 20k).
- Wenn L3 die Budget-Grenze erreicht, wird eine Zusammenfassung (Summary) erstellt und aeltere Turns durch die Summary ersetzt (Sliding Window mit Kompression).

### 2.3 Tool-Orchestrierung & Routing

Der Agent nutzt den existierenden `capability-catalog` (vgl. `src/capability-catalog.js` und `services/capability-broker.service.js`).

**Orchestrierungs-Fluss:**

1. **Intent-Erkennung:** LLM klassifiziert den Nutzer-Prompt in eine Capability-Domain (z.B. `investment-planning`, `znp-analysis`, `vdmi-governance`, `edm-query`).
2. **Capability-Mapping:** Der Capability-Broker loest die Domain in eine geordnete Liste von Service-Actions auf.
3. **Parameter-Extraktion:** LLM extrahiert aus dem Prompt und dem User-Profile (L2) die noetigen Pfad-Parameter und Query-Argumente.
4. **Deterministische Ausfuehrung:** Jeder Service-Call wird mit `ctx.call()` durchgefuehrt. Responses werden schemavalidiert (`additionalProperties: false` fuer interne Services).
5. **Ergebnis-Synthese:** LLM formuliert die Service-Ergebnisse in natuerliche Sprache, referenziert dabei Layer 1 (Tenant-Wissen) fuer Kontext.

**Wichtig:** Der Agent ist **Orchestrator**, nicht Rechner. Energiewirtschaftliche Logik (z.B. Bilanzkreis-Berechnung, ZNP-Spannungsfall) bleibt in den existierenden Services. Der Agent ruft sie auf und erklaert die Ergebnisse.

**Fehlerfall-Handling:**
- Wenn ein Service-Call fehlschlaegt (404, 422, 500), wird der Fehler **nicht** dem Nutzer direkt angezeigt. Stattdessen wird er an den Capability-Broker zurueckgemeldet, der einen Fallback-Pfad aus dem Katalog waehlt (z.B. Demo-Daten, abgeschwaechte Antwort, oder HITL-Eskalation).
- HITL-Trigger: Wenn `confidence < threshold` oder ein `hard`-Guardrail greift, wird ein `hitl.items.create`-Eintrag erzeugt.

### 2.4 Durable Execution & Wake-Up-Mechanismus

Der Agent muss Prozesse ueber Tage/Wochen ueberwachen koennen (z.B. "Benachrichtige mich, wenn sich mein MaStR-Eintrag aendert").

**Komponenten:**

| Komponente | Service/Mechanismus | Funktion |
|-----------|---------------------|----------|
| **Wake-Up Scheduler** | Nutzt existierenden Cron/Job-Mechanismus (vgl. `moleculer-cron` oder externer Scheduler, der via API `POST /api/agent/rerun` aufruft) | Traegt Wake-Up-Events in eine persistente Queue ein |
| **Session-Reanimation** | `GET /api/agent/session/:id` + `POST /api/agent/rerun` | Lädt eine vorherige Session mit allen Layern und setzt sie fort |
| **Promise Registry** | Interner Zustand im Agent Service (tenant-isoliert) | Merkt sich offene "Versprechen" an den Nutzer mit ETA |

**Ablauf:**
1. Nutzer: "Warn mich, wenn die Anschlusskapazitaet in Troisdorf unter 10% faellt."
2. Agent erstellt ein **Promise-Objekt**:
   ```json
   {
     "promiseId": "p-uuid",
     "type": "threshold",
     "service": "grid-connection",
     "action": "validations.list",
     "filter": { "location": "Troisdorf", "capacityRemainingPct": { "$lt": 10 } },
     "wakeUpAt": null,
     "checkInterval": "24h",
     "nextCheck": "2026-05-15T08:00:00Z",
     "sessionId": "s-uuid",
     "status": "active"
   }
   ```
3. Der Wake-Up Scheduler prueft alle 5 Minuten (oder via moleculer-cron) die `nextCheck`-Zeitstempel.
4. Wenn `nextCheck` erreicht ist, ruft der Scheduler `POST /api/agent/rerun` mit `sessionId` und `promiseId` auf.
5. Der Agent laedt die Session, fuehrt den Service-Call aus, prueft die Bedingung.
6. Bei Trigger: Benachrichtigung an den Nutzer (Push, Email, Chat-Message). Bei keinem Trigger: `nextCheck += interval`.

### 2.5 Asynchrones Träumen (Post-Session)

Nach Session-Ende (Timeout oder expliziter "Auf Wiedersehen") laeuft ein asynchroner Prozess:

**Phase A: User-Profile-Anreicherung (Layer 2)**
- LLM-Summary der Session wird erstellt (max 500 Tokens).
- Extrahierte Praeferenzen (z.B. "Nutzer bevorzugt Tabellen ueber Charts", "Nutzer fragt oft nach ZNP-Projekt X") werden in das User-Profile geschrieben.
- Konflikte: Wenn eine neue Praeferenz einer alten widerspricht, wird die neuere mit hoeherem Confidence-Score ueberschreiben.

**Phase B: Tenant-Archiv-Anreicherung (Layer 1)**
- Fakten, die fuer den gesamten Tenant relevant sind (z.B. "In Troisdorf gibt es 3 PV-Freiflaechen-Projekte im ZNP"), werden in die QDrant-Tenant-Collection geschrieben.
- Deduplizierung via semantischer Suche: Vor dem Schreiben wird geprueft, ob ein aehnliches Faktum bereits existiert (Cosine-Similarity > 0.95). Bei Duplikat: Counter erhoehen, Timestamp aktualisieren.

**Phase C: VDMI-/CYA-Aktualisierung**
- Wenn die Session regulatorisch relevante Entscheidungen enthielt, werden VDMI-Tasks oder CYA-Profile aktualisiert.

### 2.6 Interaktionsdiagramm (UI → Agent → Kernel)

```
Nutzer-Prompt
    │
    ▼
┌─────────────┐
│  UI (Chat)  │─── WebSocket/SSE ───▶
└─────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │  Personal Agent Service  │
              │  1. L0+L1+L2+L3 stacken │
              │  2. Intent-Erkennung     │
              │  3. Capability-Broker    │
              └──────────┬───────────────┘
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  EDM     │ │  ZNP     │ │  VDMI    │ ...
    └──────────┘ └──────────┘ └──────────┘
           │             │             │
           └─────────────┴─────────────┘
                         │
                         ▼
              ┌────────────────────────┐
              │  L4: Ergebnis injizieren │
              │  LLM-Synthese           │
              └──────────┬───────────────┘
                         │
                         ▼
              ┌────────────────────────┐
              │  Kernel: Promise/Wake   │
              │  HITL? → Queue         │
              └──────────┬───────────────┘
                         │
                         ▼
              ┌────────────────────────┐
              │  Antwort an Nutzer       │
              └────────────────────────┘
```

---

## 3. Tooling Coverage TDD-Matrix

### 3.1 Struktur

Jeder Testfall (TF) definiert:
- **ID:** Eindeutige Kennung
- **Nutzer-Prompt:** Natuerlichsprachliche Anfrage
- **Erwartete Intent-Klasse:** Capability-Domain
- **Service-Calls (sequentiell):** Exakte Actions in Aufrufreihenfolge
- **Erwartetes End-User-Ergebnis:** Was muss der Agent dem Nutzer sagen?
- **Layer-4 Verhalten:** Welche OpenAPI-Fragmente muessen injiziert werden?

### 3.2 Prompt-Katalog & Service-Mapping

#### Domain: Investitionsplanung

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-INV-01 | "Plane eine neue PV-Freiflaechenanlage mit 5 MW in Troisdorf." | `investment-planning.create` | 1. `POST /api/investment-planning/plans` (Payload: capacityKw=5000, location="Troisdorf", type="pv-open-field") | Bestaetigung mit Plan-ID, Hinweis auf Grid-Connection-Pruefung |
| T-INV-02 | "Zeig mir den Status meiner Investitionsplaene." | `investment-planning.list` | 1. `GET /api/investment-planning/plans` | Liste aller Plaene mit Status (offen/in Pruefung/genehmigt) |
| T-INV-03 | "Wie wirtschaftlich ist mein Plan mit ID plan-xyz?" | `investment-planning.economics` | 1. `GET /api/investment-planning/plans/:id` → extract metadata 2. `POST /api/finance-agent/fnav/economics` (Payload: aus Plan extrahierte Parameter) | fNAV-Bewertung: Kapitalwert, Amortisationsdauer, Rendite |

#### Domain: Zielnetzplanung (ZNP)

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-ZNP-01 | "Erstelle ein neues ZNP-Projekt fuer Troisdorf." | `znp.project.create` | 1. `POST /api/znp/projects` (Payload: name, region) | Projekt-ID, Bestaetigung, Hinweis auf Layer-0-Befuellung |
| T-ZNP-02 | "Fuehre Layer-0 fuer Projekt znp-123 durch." | `znp.layer0.run` | 1. `POST /api/znp/projects/:projectId/layer0` | Status 202, Job-ID fuer async Verarbeitung |
| T-ZNP-03 | "Was ist der G-Faktor meines ZNP-Projekts?" | `znp.analysis.gfactor` | 1. `GET /api/znp/projects/:projectId/g-factor` | Numerischer G-Faktor + Einordnung (gut/kritisch) |
| T-ZNP-04 | "Korreliere Stoerungen in meinem ZNP-Projekt." | `znp.analysis.disturbance` | 1. `POST /api/znp/projects/:projectId/correlate-disturbance` | Korrelations-Heatmap oder Top-3-Stoerungsursachen |
| T-ZNP-05 | "Zeig mir die strategischen Empfehlungen fuer Projekt znp-123." | `znp.analysis.strategy` | 1. `GET /api/znp/projects/:projectId/strategic-prompts` | Priorisierte Handlungsempfehlungen |

#### Domain: fNAV & Grid-Connection

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-NAV-01 | "Pruefe die Netzanschlusskapazitaet fuer Troisdorf." | `grid-connection.validate` | 1. `POST /api/grid-connection/validate` (Payload: location, capacityRequest) → liefert 202 + jobId 2. Poll `GET /api/jobs/:jobId/status` bis `completed` 3. `GET /api/jobs/:jobId/result` | GO_DIRECT / GO_CONDITIONAL / NO_GO mit Begruendung |
| T-NAV-02 | "Zeig mir alle offenen Grid-Validierungen." | `grid-connection.list` | 1. `GET /api/grid-connection/validations` | Tabelle mit Standort, Kapazitaet, Entscheidung, Datum |
| T-NAV-03 | "Wie ist die fNAV-Wirtschaftlichkeit meiner Anlage?" | `grid-connection.fnav` | 1. `POST /api/grid-connection/fnav/validate` | fNAV-Score, Kosten/Nutzen-Verhaeltnis |

#### Domain: VDMI & Regulatorik

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-VDM-01 | "Erstelle eine neue VDMI-Matrix fuer die Jahrespruefung." | `vdmi.create` | 1. `POST /api/vdmi` (Header: X-Agent-Role: V) | Matrix-ID, Status, Hinweis auf Nominierung |
| T-VDM-02 | "Nominiere mich als Verantwortlicher fuer VDMI vdm-456." | `vdmi.nominate` | 1. `POST /api/vdmi/:id/nominate` | Bestaetigung oder Fehler (bereits nominiert) |
| T-VDM-03 | "Zeig mir meine VDMI-Aufgaben." | `vdmi.responsibilities` | 1. `GET /api/vdmi/my-responsibilities` 2. `GET /api/vdmi/my-informed` | Liste offener D/V/M/I-Aufgaben mit Faelligkeiten |
| T-VDM-04 | "Was sind die aktuellen VDMI-Findings?" | `vdmi.findings` | 1. `GET /api/vdmi/findings` | Priorisierte Finding-Liste mit Severity |
| T-VDM-05 | "Zeig mir den Audit-Trail der VDMI vdm-789." | `vdmi.audit` | 1. `GET /api/vdmi/audit` (ggf. query param filter) | Chronologische Aenderungen, Actor, Zeitstempel |
| T-VDM-06 | "Welche VDMI-Templates stehen zur Verfuegung?" | `vdmi.templates` | 1. `GET /api/vdmi/templates` | Liste der verfuegbaren Templates mit Beschreibung |

#### Domain: Energy Data Management (EDM)

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-EDM-01 | "Liste alle meine MeLos." | `edm.melos.list` | 1. `GET /api/edm/melos` | Tabelle: meloId, Name, Typ, Kapazitaet, Standort |
| T-EDM-02 | "Zeig mir die Zeitreihe von MeLo melo-abc." | `edm.timeseries.get` | 1. `GET /api/edm/timeseries/:meloId` | Chart-Metadaten oder Tabelle (je nach User-Profile L2) |
| T-EDM-03 | "Importiere eine Zeitreihe fuer melo-abc." | `edm.timeseries.import` | 1. `POST /api/edm/timeseries/import` (Payload: meloId, obis, format, data) | Import-Status, Anzahl importierter Werte |
| T-EDM-04 | "Wie ist die Qualitaet meiner MeLo-Daten?" | `edm.validation.check` | 1. `POST /api/edm-validation/validate` (Payload: meloId) | Qualitaets-Score, Luecken, Ausreisser |
| T-EDM-05 | "Erstelle ein Messkonzept fuer melo-xyz." | `edm.messkonzept.create` | 1. `POST /api/edm/messkonzepte` (Payload: meloId, Anforderungen) 2. `POST /api/edm/messkonzepte/:id/evaluate` | Messkonzept-ID, Bewertung (BSI-konform etc.) |
| T-EDM-06 | "Fuelle die SLP-Daten fuer meinen virtuellen Zaehler." | `edm.virtual.slp` | 1. `POST /api/edm-virtual/virtual/populate-slp` | Bestaetigung, Anzahl generierter Zeitschritte |

#### Domain: Redispatch & Bilanzkreis

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-RED-01 | "Starte einen Redispatch-Audit-Lauf." | `redispatch.audit.run` | 1. `POST /api/redispatch/audit` | Audit-ID, Status 202 |
| T-RED-02 | "Zeig mir die letzten Redispatch-Audits." | `redispatch.audit.list` | 1. `GET /api/redispatch/audits` | Tabelle mit Datum, Status, Anzahl Findings |
| T-RED-03 | "Berechne die Redispatch-Abrechnung fuer Q1." | `settlement.redispatch` | 1. `POST /api/settlement/redispatch/calculate` (Payload: period) 2. `GET /api/settlement/redispatch/report/:settlementId` | Abrechnungsbericht mit Kosten/Nutzen |
| T-BIL-01 | "Erstelle einen neuen Bilanzkreis." | `bilanzkreis.create` | 1. `POST /api/bilanzkreis` | Bilanzkreis-ID, Status |
| T-BIL-02 | "Berechne die Bilanzkreis-Readiness." | `bilanzkreis.readiness` | 1. `GET /api/bilanzkreis/:id/readiness` | Readiness-Score, fehlende Datenpunkte |

#### Domain: Forecast & Flexibilitaet

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-FOR-01 | "Erstelle eine Erzeugungsprognose fuer morgen." | `forecast.generation` | 1. `POST /api/forecast/generation` oder `POST /api/forecast-engine/generation` | Prognose-JSON, 96 Viertelstundenwerte |
| T-FOR-02 | "Wie sieht der Day-Ahead-Schedule aus?" | `forecast.schedule.dayahead` | 1. `POST /api/forecast/schedule/day-ahead` | Schedule-ID, Fahrplanuebersicht |
| T-FOR-03 | "Erstelle einen Residuallast-Plot." | `forecast.residual` | 1. `POST /api/forecast/residual` | Residuallast-Kurve, Max/Min/Integral |
| T-FLE-01 | "Liste meine flexiblen Geraete." | `flex.devices.list` | 1. `GET /api/flex/devices` | Tabelle: deviceId, Typ, Status, Regelenergie-Potenzial |
| T-FLE-02 | "Plane ein Flexibilitaetsereignis fuer morgen." | `flex.event.plan` | 1. `POST /api/flex/events/plan` (Payload: deviceIds, period, targetReduction) | Event-ID, erwartete Reduktion, Konfidenz |
| T-FLE-03 | "Fuehre das geplante Flex-Event aus." | `flex.event.execute` | 1. `POST /api/flex/events/execute` (Payload: eventId) | Ausfuehrungs-Status, tatsaechliche Reduktion |
| T-FLE-04 | "Zeig mir den Relief-Proof fuer letzten Monat." | `flex.reliefproof` | 1. `GET /api/flex/relief-proof/:period` | Nachweis-Dokument, Compliance-Status |

#### Domain: Marktdaten & Settlement

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-MKT-01 | "Hole die aktuellen Day-Ahead-Preise." | `market.prices.dayahead` | 1. `POST /api/entsoe/day-ahead-prices` oder `POST /api/energy-market/prices` | Preiskurve, Durchschnitt, Min/Max |
| T-MKT-02 | "Wie hoch ist die aktuelle CO2-Intensitaet?" | `market.co2` | 1. `POST /api/energy-market/co2-intensity` | gCO2/kWh, Trend (steigend/fallend) |
| T-SET-01 | "Berechne die EEG-Verguetung fuer meine Anlage." | `settlement.eeg` | 1. `POST /api/settlement/eeg/calculate` 2. `GET /api/settlement/eeg/report/:settlementId` | Verguetungsbericht mit kWh und Cent/kWh |
| T-SET-02 | "Bereite die §96-Ausgleichsbetrags-Abrechnung vor." | `settlement.a96` | 1. `POST /api/settlement/a96/prepare` 2. `GET /api/settlement/a96/export/:settlementId` | Export-Datei, Status |

#### Domain: MaStR-Monitoring & Qualitaet

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-MAS-01 | "Ueberwache den MaStR-Eintrag meiner Anlage xyz." | `mastr.watch.create` | 1. `POST /api/mastr-monitor/watches` (Payload: anlageReferenz, filter) | Watch-ID, Bestaetigung, Hinweis auf Benachrichtigung |
| T-MAS-02 | "Was hat sich seit letzter Woche im MaStR geaendert?" | `mastr.watch.delta` | 1. `GET /api/mastr-monitor/watches/:watchId/deltas` | Delta-Liste: hinzugefuegt, geaendert, entfernt |
| T-MAS-03 | "Starte einen MaStR-Qualitaetsaudit." | `mastr.quality.audit` | 1. `POST /api/mastr-quality/audit` | Audit-ID, Anzahl gepruefter Eintraege |
| T-MAS-04 | "Zeig mir die MaStR-Qualitaets-Findings." | `mastr.quality.findings` | 1. `GET /api/mastr-quality/audits` 2. `GET /api/mastr-quality/audits/:id/findings/:findingId/details` | Finding-Liste mit Schweregrad und Korrekturvorschlag |

#### Domain: Finance Agent

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-FIN-01 | "Analysiere die Wirtschaftlichkeit meines Portfolios." | `finance.analyze` | 1. `POST /api/finance-agent/analyze` (Payload: scope="portfolio") | Finanzanalyse, Kennzahlen, Risiken |
| T-FIN-02 | "Vergleiche meine Kosten mit dem Branchen-Durchschnitt." | `finance.benchmark` | 1. `POST /api/finance-agent/benchmark-comparison` | Benchmark-Chart, Percentile-Ranking |
| T-FIN-03 | "Zeig mir die letzten Finance-Analysen." | `finance.history` | 1. `GET /api/finance-agent/analyses` | Historische Analysen mit Zeitstempel |

#### Domain: Blindflug-Radar

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-BFR-01 | "Scan mein Portfolio auf regulatorische Luecken." | `blindflug.scan` | 1. `POST /api/blindflug-radar/scan` (Payload: scope, filters) | Scan-ID, Zusammenfassung der Luecken |
| T-BFR-02 | "Welche Empfehlungen gibt der Blindflug-Radar?" | `blindflug.recommend` | 1. `POST /api/blindflug-radar/recommendations` (Payload: scanId) | Priorisierte Empfehlungen mit Aufwand/Kosten |
| T-BFR-03 | "Zeig mir die letzten Scans." | `blindflug.history` | 1. `GET /api/blindflug-radar/scans` | Scan-Historie, Trend (mehr/weniger Luecken) |

#### Domain: HITL & Mensch-in-der-Schleife

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-HIT-01 | "Zeig mir offene HITL-Aufgaben." | `hitl.list` | 1. `GET /api/hitl/items` | Liste offener Genehmigungen mit SLA-Restzeit |
| T-HIT-02 | "Genehmige HITL-Item hit-123." | `hitl.approve` | 1. `POST /api/hitl/items/:id/approve` | Bestaetigung, Statuswechsel auf approved |
| T-HIT-03 | "Wie ist die HITL-SLA-Heatmap?" | `hitl.sla` | 1. `GET /api/hitl/sla-heatmap` | Heatmap: Ueberfaellige Items pro Kategorie |

#### Domain: Energy-Sharing (§42c)

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-ESH-01 | "Pruefe, ob mein Mieterstrom-Projekt §42c-konform ist." | `energy-sharing.validate` | 1. `POST /api/energy-sharing/validate` | Validierungsbericht, Go/No-Go |
| T-ESH-02 | "Berechne die Energie-Sharing-Allokation." | `energy-sharing.allocate` | 1. `POST /api/energy-sharing-allocation/allocate` | Allokationsplan mit Anteilen |

#### Domain: Allgemeine Abfragen & Intelligence

| ID | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|---------------|---------------|-----------------------------|---------------------|
| T-QUE-01 | "Wie viele PV-Anlagen hat mein Tenant?" | `query.intelligent` | 1. `POST /api/query/ask` oder `POST /api/query/ask-learned` | Aggregierte Antwort aus L1 + L2 |
| T-QUE-02 | "Suche nach Dokumenten zu Netzanschluss in Troisdorf." | `knowledge.rag` | 1. `POST /api/knowledge-rag/query` oder `POST /api/knowledge-rag/semantic` | Semantic-Search-Ergebnisse mit Score |
| T-QUE-03 | "Was sind die aktuellen Marktpreise?" | `market.snapshot` | 1. `GET /api/dashboard/market-snapshot` | Kompakte Marktuebersicht |
| T-QUE-04 | "Zeig mir die System-Health." | `observability.health` | 1. `GET /api/observability/summary` 2. `GET /api/system/status` | Health-Status aller Services |

### 3.3 Routing-Fallback-Matrix

Fuer faelle, in denen der Nutzer-Prompt **mehrere Domains** beruehrt, definiert die Matrix die erlaubte Sequenz:

| Kombination | Primaer-Intent | Sekundaere Calls | Reihenfolge |
|-------------|----------------|------------------|-------------|
| "Investition in Troisdorf" | `investment-planning.create` | `grid-connection.validate` | Investition zuerst erstellen, dann Grid-Check |
| "Mieterstrom mit ZNP" | `energy-sharing.validate` | `znp.projects.get` | Sharing zuerst, dann ZNP-Referenz zur Standortpruefung |
| "Redispatch + Settlement" | `redispatch.audit.run` | `settlement.redispatch.calculate` | Audit zuerst, Settlement basiert auf Audit-Ergebnis |
| "fNAV + Finance" | `grid-connection.fnav` | `finance-agent.analyze` | fNAV zuerst, dann wirtschaftliche Einordnung |
| "Forecast + Flex" | `forecast.generation` | `flex.event.plan` | Prognose zuerst, Flex-Event basiert auf Erzeugungsluecke |

### 3.4 Multi-Turn Domain Scenarios

Die Single-Turn-Matrix oben bleibt die fachliche Vollabdeckung fuer einzelne Intent-Aufloesungen. Fuer Personal-Agent-Dialoge mit Session-Kontext definieren wir zusaetzlich **Multi-Turn-Szenarien**, die ueber mehrere aufeinanderfolgende `personal-agent.chat`-Aufrufe laufen und dieselbe `sessionId` wiederverwenden muessen.

> Hinweis zur Coverage: Die `MT-*`-Szenarien sind explizite Blackbox-Multi-Turn-Abdeckung und werden nur als harte Release-Gate-Coverage geprueft, wenn `RUN_PERSONAL_AGENT_TDD_MATRIX_BLACKBOX=true` gesetzt ist. In normaler CI bleibt fuer das harte Gate die 100%-Abdeckung der `T-*`-Matrix aktiv.

#### Scenario: Journalist / CYA-artige Einordnung

| ID | Turn | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis | Session-State |
|----|------|---------------|---------------|-----------------------------|---------------------|---------------|
| MT-JOU-01 | 1 | "Ich recherchiere zur Versorgungssicherheit. Was ist der aktuelle Stand?" | `cya.generate` | 1. `POST /api/personal-agent/chat` | Vorsichtige Einordnung zum Status, kein interner Fehlercode | `sessionId` erzeugt, L3-Historie startet |
| MT-JOU-02 | 2 | "Bitte nur belastbare Aussagen und kennzeichne Unsicherheiten klar." | `cya.generate` | 1. `POST /api/personal-agent/chat` | Unsicherheiten und Annahmen werden transparent gemacht | Gleiche `sessionId`, L3 erweitert |
| MT-JOU-03 | 3 | "Fasse die Kernaussagen in drei Punkten zusammen." | `cya.generate` | 1. `POST /api/personal-agent/chat` | Verdichtete journalistische Zusammenfassung in drei Punkten | Gleiche `sessionId`, L3 verdichtet Vorwissen |
| MT-JOU-04 | 4 | "Gib ein journalistisches Fazit ohne Spekulationen." | `cya.generate` | 1. `POST /api/personal-agent/chat` | Schlussfazit ohne ueberschiessende Sicherheitssprache | Gleiche `sessionId`, L3 enthaelt gesamte CYA-Kette |

#### Scenario: Investor / Benchmark-Vergleich

| ID | Turn | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis | Session-State |
|----|------|---------------|---------------|-----------------------------|---------------------|---------------|
| MT-INV-01 | 1 | "Vergleiche bitte zwei Netzbetreiber hinsichtlich Anschlussgeschwindigkeit." | `finance.benchmark` | 1. `POST /api/personal-agent/chat` | Vergleichsmodus fuer zwei VNBs wird aufgebaut | `sessionId` erzeugt, L3-Historie startet |
| MT-INV-02 | 2 | "Ergaenze Digitalisierung und Umsetzungsquote im Vergleich." | `finance.benchmark` | 1. `POST /api/personal-agent/chat` | Vergleich wird um weitere KPI-Dimensionen erweitert | Gleiche `sessionId`, L3 erweitert |
| MT-INV-03 | 3 | "Gewichte Anschlussgeschwindigkeit hoechst und fasse das Ergebnis zusammen." | `finance.benchmark` | 1. `POST /api/personal-agent/chat` | Vorherige Vergleichsdimensionen werden synthetisiert | Gleiche `sessionId`, L3 konsolidiert Gewichtung |
| MT-INV-04 | 4 | "Erstelle eine Rangliste mit kurzer Begruendung." | `finance.benchmark` | 1. `POST /api/personal-agent/chat` | Rangfolge mit knapper Begruendung aus den vorherigen Turns | Gleiche `sessionId`, L3 enthaelt Benchmark-Synthese |

#### Scenario: Vorstand / Rechenzentrum / N-1 / fNAV

| ID | Turn | Nutzer-Prompt | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis | Session-State |
|----|------|---------------|---------------|-----------------------------|---------------------|---------------|
| MT-VOR-01 | 1 | "Bitte fNAV und Finance fuer unser Rechenzentrum in Frankfurt bewerten." | `grid-connection.fnav` | 1. `POST /api/personal-agent/chat` | Vorstandstauglicher Start fuer Rechenzentrum / fNAV / Finance | `sessionId` erzeugt, L3-Historie startet |
| MT-VOR-02 | 2 | "Was bedeutet das fuer unsere N-1 Reserve?" | `grid-connection.fnav` | 1. `POST /api/personal-agent/chat` | N-1-Bezug wird auf dem bestehenden Rechenzentrums-Kontext erklaert | Gleiche `sessionId`, L3 erweitert |
| MT-VOR-03 | 3 | "Projiziere den fNAV fuer die naechsten 5 Jahre." | `grid-connection.fnav` | 1. `POST /api/personal-agent/chat` | fNAV-Projektion wird aus dem laufenden Kontext angefragt | Gleiche `sessionId`, L3 erweitert Fachkontext |
| MT-VOR-04 | 4 | "Wir verlagern das Projekt nach Muenchen. Aktualisiere die Pruefung." | `grid-connection.fnav` | 1. `POST /api/personal-agent/chat` | Antwort bezieht sich auf Muenchen und ersetzt Frankfurt als Arbeitsort | Gleiche `sessionId`, L3 aktualisiert Standortkontext |

---

#### Domain: Agent Receipts — Governed Learning Loop (v0.54.5)

| ID | Nutzer-Prompt / Szenario | Intent-Klasse | Service-Calls (sequentiell) | Erwartetes Ergebnis |
|----|--------------------------|---------------|-----------------------------|---------------------|
| T-AR-01 | "Schlage ein neues Draft-Receipt vor (chat-Pfad)." | `agent-receipts.proposeDraft` | 1. `POST /agent-receipts/propose` | `success: true`, `status: draft`, `pendingReview: true`, Audit-Felder gesetzt, `activatedAt: null`. |
| T-AR-02 | "proposeDraft lehnt status: active im Payload ab." | `agent-receipts.proposeDraft` | 1. `POST /agent-receipts/propose` | Fehler 422 `AGENT_RECEIPT_PROPOSE_STATUS_REJECTED` — kein Bypass des Draft-Gates moeglich. |
| T-AR-03 | "Promoviere Draft-Receipt zu active mit promotedBy-Identitaet." | `agent-receipts.promote` | 1. `POST /agent-receipts/:id/promote` | `success: true`, `status: active`, `promotedAt`, `promotedBy`, `promotedFromDraftId` gesetzt. |
| T-AR-04 | "promote blockiert bei blocking validation errors." | `agent-receipts.promote` | 1. `POST /agent-receipts/:id/promote` | Fehler 409 `AGENT_RECEIPT_BLOCKING_VALIDATION` — invalide Drafts koennen nicht promoviert werden. |
| T-AR-05 | "promote lehnt ab wenn Receipt bereits active ist." | `agent-receipts.promote` | 1. `POST /agent-receipts/:id/promote` | Fehler 409 `AGENT_RECEIPT_PROMOTE_NOT_DRAFT` — aktive Receipts koennen nicht erneut promoviert werden. |
| T-AR-06 | "promote mit veraltetem _rev schlaegt durch CAS-Guard fehl." | `agent-receipts.promote` | 1. `POST /agent-receipts/:id/promote` | Fehler 409 `AGENT_RECEIPT_CONFLICT` — Concurrent-Promotion-Race wird verhindert. |
| T-AR-07 | "promote auto-depreciert supersediertes aktives Receipt mit vollstaendigen Audit-Feldern." | `agent-receipts.promote` | 1. `POST /agent-receipts/:id/promote` | `superseded: { receiptId, status: deprecated }`, `deprecatedBy`, `supersededByReceiptId` in Metadata. |
| T-AR-08 | "proposeDraft mit creatorSource: chat gibt glasklare Draft-Antwort ohne Aktivierungs-Sprache." | `agent-receipts.proposeDraft` | 1. `POST /agent-receipts/propose` | `status: draft`, `pendingReview: true`; `activatedAt`, `promotedAt`, `promotedBy` sind null. |

---

## 4. Watchdog-Spezifikation

### 4.1 Dead-Man's-Switch Modell

**Ziel:** Wenn der Agent einen Wake-Up fuer einen Promise einplant, aber der Wake-Up ausfaellt (Server-Crash, Cron-Failure, Message-Queue-Verlust), muss das Backend erkennen, dass der Agent "tot" ist, und eskalieren.

**Konzept:** Jedes Promise-Objekt enthaelt ein **Lease**-Feld. Der Agent muss das Lease vor Ablauf erneuern. Wenn das Lease ablaeuft, geht der Kernel davon aus, dass der Agent ausgefallen ist.

**Promise-Zustandsautomat:**

```
┌─────────┐   create   ┌─────────┐   wakeUp   ┌─────────┐
│  NONE   │ ─────────▶ │ ACTIVE  │ ─────────▶ │ CHECK   │
└─────────┘            └─────────┘            └────┬────┘
     ▲                                           │
     │           renew lease                     │ check condition
     │◄──────────────────────────────────────────┘
     │
     │   lease expired / max retries exceeded
     ▼
┌─────────┐   manual resolve   ┌─────────┐
│ ALARM   │ ◀────────────────── │ TIMEOUT │
└─────────┘                    └─────────┘
```

### 4.2 Technische Modellierung

**Promise-Schema (erweitert):**

```json
{
  "promiseId": "p-uuid",
  "sessionId": "s-uuid",
  "tenantId": "tenant-slug",
  "userId": "user-sub",
  "type": "threshold|deadline|recurring|one-shot",
  "status": "active|checking|timeout|alarm|resolved",
  "createdAt": "2026-05-14T08:00:00Z",
  "nextCheck": "2026-05-15T08:00:00Z",
  "leaseExpiry": "2026-05-15T08:05:00Z",
  "leaseIntervalSec": 300,
  "maxMissedLeases": 3,
  "missedLeases": 0,
  "checkSpec": {
    "service": "grid-connection",
    "action": "validations.list",
    "params": { "location": "Troisdorf" },
    "condition": { "capacityRemainingPct": { "$lt": 10 } }
  },
  "wakeUpRoute": "POST /api/agent/rerun",
  "escalationRoute": "POST /api/hitl/items"
}
```

**Lease-Erneuerungs-Protokoll:**

1. Der Agent (bzw. der Kernel-Worker, der den Agent-Wake-Up ausfuehrt) muss nach jedem erfolgreichen Check `leaseExpiry = now + leaseIntervalSec` setzen.
2. Der Watchdog-Service (ein separater Moleculer-Service oder ein Cron-Job) prueft alle 60 Sekunden alle Promises mit `status IN (active, checking)`.
3. Wenn `now > leaseExpiry`:
   - `missedLeases += 1`
   - Wenn `missedLeases < maxMissedLeases`: Sofortiger Retry-Wake-Up (sofort, nicht zum naechsten geplanten Zeitpunkt).
   - Wenn `missedLeases >= maxMissedLeases`: Status = `alarm`, HITL-Eintrag wird erstellt.

### 4.3 Alarm-Pfade

| Stufe | Bedingung | Aktion | Empfaenger |
|-------|-----------|--------|------------|
| **Stille 1** | Lease ueberfaellig (1x) | Sofortiger Retry + Log-Eintrag | Observability-Log |
| **Stille 2** | Lease ueberfaellig (2x) | Retry + erhoehte Log-Priority + Metric-Alert | Prometheus/Grafana |
| **Stille 3** | Lease ueberfaellig (3x) | Status = `alarm`, `POST /api/hitl/items` | Mensch (HITL-Queue) |
| **Kernel-Panic** | Watchdog-Service selbst nicht erreichbar | Externer Monitor (z.B. System-Health-Check) eskaliert an Ops | On-Call |

**HITL-Eskalation bei Promise-Alarm:**
- `POST /api/hitl/items` mit `category: "agent-promise-failure"`, `severity: "high"`, `context: { promiseId, sessionId, lastCheck, missedLeases }`.
- Der HITL-Operator kann dann manuell den Status auf `resolved` setzen oder den Promise neu aktivieren.

### 4.4 Recovery-Protokoll

**Szenario: Agent-Service wurde neu deployt und hat Promises verloren.**

1. **Startup-Recovery:** Beim Start des Agent-Services wird eine `GET` auf den Promise-Store ausgefuehrt: Lade alle Promises mit `status = active` und `leaseExpiry < now`.
2. **Rehydration:** Fuer jeden ueberfaelligen Promise wird sofort ein Wake-Up ausgeloest (nicht gewartet bis zum naechsten Cron-Tick).
3. **Lease-Reset:** Nach erfolgreichem Check wird `missedLeases = 0` und `leaseExpiry = now + leaseIntervalSec`.
4. **Idempotenz:** Jeder Wake-Up ist idempotent durch `promiseId + sessionId`-Kombination. Doppelte Wake-Ups durch Recovery duerfen keine doppelten Benachrichtigungen erzeugen.

**Szenario: Promise-Store ist corrupted/verloren.**
- Dies ist ein **kritischer Fehler** (Architektur-Luecke). Der Watchdog muss erkennen, dass der Promise-Store nicht erreichbar ist, und sofort in `alarm` gehen.
- Empfohlene Persistenz: Redis (mit AOF) oder Datenbank-Table (nicht In-Memory im MVP, falls Long-Running-Prozesse >24h gewuenscht sind).

---

## 5. Anhang: Integrationstest-Strategie

### 5.1 Automatisierter TDD-Testlauf

Die TDD-Matrix wird als automatisierter Integrationstest implementiert:

1. **Test-Engine:** Liest die Markdown-Tabelle und extrahiert Prompts + Service-Calls.
2. **Mock-Backend:** Fuer jeden Testfall werden die Service-Responses gemockt (basierend auf realen Response-Schemata aus der OpenAPI-Spec).
3. **Agent-Loop:** Der Agent-Service wird mit dem Prompt gefuettert. Es wird geprueft:
   - Wurde der korrekte **Intent** erkannt?
   - Wurden die **Service-Calls in der definierten Reihenfolge** ausgefuehrt?
   - Wurden die **korrekten Pfad-Parameter** extrahiert?
   - Ist die **Nutzer-Antwort** fachlich korrekt (basierend auf Mock-Daten)?
4. **Coverage-Report:** Prozentuale Abdeckung der Matrix. Ziel: 100% der definierten Prompts muessen passieren.

### 5.2 Fehlerklassifikation (analog VDMI-Blackbox)

| Klasse | Bedeutung | Fix-Zustaendigkeit |
|--------|-----------|-------------------|
| `ROUTING_FAILURE` | Intent falsch erkannt oder falscher Service gewaehlt | Agent-Service / Capability-Broker |
| `SEQUENCE_FAILURE` | Reihenfolge der Calls falsch | Agent-Service / Orchestrator |
| `PARAMETER_FAILURE` | Pfad/Query-Parameter fehlen oder falsch | Agent-Service / Parameter-Extraktion |
| `SCHEMA_FAILURE` | Response passt nicht zum erwarteten Schema | Backend-Service (nicht Agent) |
| `TIMEOUT_FAILURE` | Wake-Up nicht rechtzeitig ausgefuehrt | Watchdog / Scheduler |
| `HALLUCINATION` | Agent erfindet Fakten, die nicht im Response stehen | Agent-Service / Prompt-Engineering |

### 5.3 Deliverables fuer Implementierer

Fuer jeden definierten Testfall muss spaeter gelten:
- [ ] Unit-Test: Intent-Klassifikation mit Mock-LLM
- [ ] Integrationstest: Service-Call-Sequenz gegen moleculer-runner
- [ ] E2E-Test: Vollstaendiger Chat-Turn via `POST /api/agent/analyze`
- [ ] Schema-Striktheit: `additionalProperties: false` auf allen internen Actions
- [ ] Tenant-Isolation: Cross-Tenant-Prompts duerfen keine fremden Daten liefern

---

*Ende der Spezifikation.*
