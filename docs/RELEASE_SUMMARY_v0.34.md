# Release Summary v0.34.0

**Datum:** 2026-04-29
**Codename:** Progressive Profiling (Zwiebelmodus)
**Status:** ✅ Vollständige A²MDM-Kernarchitektur implementiert (TRL7 → TRL8 Transition)

---

## Überblick

Release v0.34.0 schließt den **A²MDM-Kernzyklus** (Adaptive Agentic Multi-Domain Model).
Mit v0.32 (Ontologie-Graph), v0.33 (Tool-Router) und v0.34 (Progressive Profiling) ist
die vollständige Lernschleife implementiert:

```
Session → Implizites Lernen → Profil-Anreicherung → Tool-Routing → bessere Analyse
```

Das System lernt aus jeder Analyse, passt Tool-Priorisierung an und aktiviert
persona-spezifisches Gedächtnis — ohne Nutzereingriff.

---

## Implementierte Features v0.32 – v0.34

### v0.32.0 — Central Asset Ontology + Zwiebelmodus Context Manager

**Kernmodul:** `src/cya-ontology-graph.js`
- Graphology-basierter In-Memory Directed Graph aus MaStR-Installationsdaten
- Node-Typen: INSTALLATION, NAP, SUBSTATION, VNB, REGION
- Edge-Typen: VERBUNDEN_MIT, LIEGT_IN, BETRIEBEN_VON, ZUSTAENDIG_FUER
- 9 strukturelle Signal-Regeln (ersetzen Regex-Text-Matching): MISSING_NAP,
  VOLTAGE_HOP_REQUIRED, NOVA_BLOCKED, HIGH_CURTAILMENT, EWK_BELOW_MEDIAN,
  SECTION14A_GAP, ENERGY_SHARING_DEADLINE, GRID_TOPOLOGY_RADIAL, HIGH_RENEWABLE_SHARE
- EU AI Act Art. 12: `evidence: [nodeId]` für jedes Signal

**Kernmodul:** `src/cya-context-manager.js`
- Iterativer Re-Entry in die CYA-Pipeline (`zoomIn`, `zoomOut`, `getFocusedContext`)
- `maxIterations: 3` verhindert Endlos-Loops
- Vollständiges Iteration-Log (Audit-Trail)

**Testabdeckung:** 45 neue Tests (25 Ontologie-Graph + 20 Context-Manager)

---

### v0.33.0 — Dynamic Tool Router / Hyper-Relevance Engine

**Kernmodul:** `src/cya-tool-registry.js`
- Rollenbasierter MCP-Tool-Whitelist (`ROLE_TOOL_WHITELIST`) für 9 Actor-Rollen
- Fokusbereich-Tool-Prioritätskarte (`FOCUS_AREA_TOOL_PRIORITY`) für 11 Bereiche
- 4 Signal-Override-Regeln (`SIGNAL_OVERRIDE_RULES`): automatische Tool-Ergänzung
  bei erkannten Signalen
- EU AI Act Art. 12: `toolSetRationale` String bei jedem Tool Set

**Kernmodul:** `src/cya-data-retriever.js` (erweitert)
- `resolveToolSet` integriert in Retrieval-Pipeline
- `retrieval.mcpDirect`, `retrieval.toolSetRationale`, `retrieval.signalOverrides` neu

**API-Änderung:** Keine neuen Endpoints; `grounding.toolSetRationale` und
`grounding.signalOverrides[]` neu in Generate-Antwort.

**Testabdeckung:** 31 neue Tests (Tool-Registry Unit-Tests)

---

### v0.34.0 — Progressive Profiling (Zwiebelmodus: implizit + explizit)

**Kernmodul:** `src/cya-profile-observer.js` (neu, ~375 Zeilen)

Das Modul implementiert das **Zweischicht-Modell (Zwiebelmodus)** für Profil-Lernen:

| Schicht | Felder | Aktualisiert durch |
|---------|--------|-------------------|
| Außen (implizit) | `implicitStats`, `focusAreaFrequency`, `signalReactions`, `toolUsage`, `preferences.focusAreaWeights/preferredTools`, `averageConfidence` | Automatisch nach jeder Session |
| Innen (explizit) | `constraints`, `explicitPreferences`, `priorityFocusAreas`, `tone`, `strategic_goals` | Nur `PATCH /api/cya/profile/:id` |

**Invariante:** Äußere Schicht überschreibt niemals die innere Schicht.

**Neue Exports:**
- `extractImplicitSignals(session)` — extrahiert focusAreas, signalsSeen, toolsUsed,
  confidence, hadRefinement aus abgeschlossener Session
- `mergeImplicitIntoProfile(existingProfile, signals)` — Außenschicht-Update:
  incrementale Zähler, exponentieller Moving-Average für Konfidenz,
  normalisierte focusAreaWeights (max=1.0), preferredTools nach Nutzungsschwelle
- `mergeExplicitIntoProfile(existingProfile, update)` — Innenschicht-Update:
  verbotene Felder (`implicitStats`, `profileVersion`, `createdAt`, `actor`)
  werden stillschweigend ignoriert
- `deriveToolHints(profile)` → `{boostedFocusAreas, preferredTools, avoidSignals}`
  für Tool-Registry-Integration

**`src/cya-agent-personas.js`** (erweitert):
- `ACTOR_ROLE_PERSONA_NAMESPACE` (Object.freeze): 9 Actor-Rollen → `cya_mem_<role>`
  PouchDB-Namespaces

**`src/cya-tool-registry.js`** (erweitert):
- Optionaler 4. Parameter `profileHints` in `resolveToolSet`:
  boostedFocusAreas erhöhen Tool-Priorität, preferredTools werden nach vorne sortiert,
  avoidSignals unterdrücken Signal-Override-Rules

**`services/cya.service.js`** (erweitert):

*Neuer Endpoint:*

| Methode | Pfad | Action | Beschreibung |
|---------|------|--------|--------------|
| `PATCH` | `/api/cya/profile/:id` | `cya.profile.update` | Explizite Innenschicht-Aktualisierung |

*Neue Service-Methoden:*
- `_observeAndUpdateProfile(profileId, session)` — nicht-blockierender Observer,
  feuert nach `saveSession` in Haupt- und Multi-Agent-Pipeline
- `_writePersonaMemory(actorRole, session, signals)` — schreibt Memory-Doc in
  `cya_mem_<role>` Namespace bei Actor-Role-gesetztem Profil (Erstaktivierung)

---

## API-Änderungen v0.32–v0.34

### Neue Endpoints

| Version | Methode | Pfad | Beschreibung |
|---------|---------|------|--------------|
| v0.34.0 | `PATCH` | `/api/cya/profile/:id` | Explizites Profil-Update (Innenschicht) |

### Erweiterte Response-Felder

| Version | Feld | Typ | Beschreibung |
|---------|------|-----|--------------|
| v0.32.0 | `regulatory_graph.graphBased` | `boolean` | Ontologie-Graph genutzt |
| v0.32.0 | `regulatory_graph.signals[].evidence` | `string[]` | Graph-Node-IDs |
| v0.33.0 | `grounding.toolSetRationale` | `string` | Tool-Routing-Begründung |
| v0.33.0 | `grounding.signalOverrides[]` | `array` | Auto-hinzugefügte Tools |
| v0.34.0 | Profil: `implicitStats` | `object` | Session-Statistiken |
| v0.34.0 | Profil: `preferences` | `object` | Gelernte Tool-/Fokus-Präferenzen |
| v0.34.0 | Profil: `profileVersion` | `number` | Inkrementell bei jedem Update |

### Breaking Changes

Keine. Alle Erweiterungen sind additiv und rückwärtskompatibel.

---

## Testabdeckung (v0.34.0)

| Test-Suite | Tests | Status |
|------------|-------|--------|
| `cya-profile-observer.test.js` (neu) | 44 | ✅ |
| `cya-profile-update.test.js` (neu) | 13 | ✅ |
| `cya-tool-registry.test.js` (v0.33) | 31 | ✅ |
| `cya-ontology-graph.test.js` (v0.32) | 25 | ✅ |
| `cya-context-manager.test.js` (v0.32) | 20 | ✅ |
| `cya-e2e-hoeheinoed.test.js` | 31 | ✅ |
| `e2e-enterprise-hoeheinoed.test.js` | 74 | ✅ |
| `dashboard-api.test.js` | 39 + 39 | ✅ |
| **CYA-Kern gesamt (v0.32–v0.34)** | **~232** | ✅ |
| Gesamtprojekt (alle Suites) | **~1.800+** | ✅ |

---

## Architektur-Übersicht: A²MDM-Komponenten

| Komponente | Modul | TRL | Eingeführt in |
|------------|-------|-----|---------------|
| Ontologie-Graph | `src/cya-ontology-graph.js` | 8 | v0.32.0 |
| Regulatorischer Graph | `src/cya-regulatory-graph.js` | 8 | v0.26.2 / v0.32.0 |
| Zwiebelmodus Context Manager | `src/cya-context-manager.js` | 8 | v0.32.0 |
| Dynamic Tool Router | `src/cya-tool-registry.js` | 8 | v0.33.0 |
| Data Retriever (MCP-Direct) | `src/cya-data-retriever.js` | 8 | v0.33.0 |
| Progressive Profiling | `src/cya-profile-observer.js` | 8 | v0.34.0 |
| Agent Personas | `src/cya-agent-personas.js` | 8 | v0.26.9 / v0.34.0 |
| Grounding Engine | `src/cya-grounding.js` | 8 | v0.26.2 |
| LLM-Synthese | `src/cya-synthesis.js` | 8 | v0.26.2 |
| Multi-Agent-Orchestrator | `services/cya.service.js` | 8 | v0.26.9 |
| Profile Templates | `src/cya-profile-templates.js` | 8 | v0.27.4 |
| Topology-Hop-Detektor | `src/cya-topology-hop.js` | 8 | v0.26.3 |

**Deterministische Agenten (orthogonal zu CYA):**

| Agent | Modul | TRL | Eingeführt in |
|-------|-------|-----|---------------|
| Grid-Connection-Validator | `services/grid-connection.service.js` | 8 | v0.14 |
| Energy-Sharing-Validator | `services/energy-sharing.service.js` | 8 | v0.15 |
| MaStR-Quality-Agent | `services/mastr-quality.service.js` | 8 | v0.17 |
| Redispatch-ExPost-Agent | `services/redispatch-expost.service.js` | 8 | v0.18 |

---

## Offene Punkte / Roadmap

### Technisch offen (TRL6)

| Thema | Beschreibung | Priorität |
|-------|-------------|-----------|
| Agent-to-Agent-Protokoll | `cya-conflict-detector.js` für Multi-Agent-Konsensus | Mittel |
| Persona-Memory-Retrieval | PouchDB-Query in `_observeAndUpdateProfile` für Langzeit-Kontext | Hoch |
| Profil-Merge-Konflikterkennung | Beim Zusammenführen mehrerer Profil-Updates | Niedrig |

### Infrastruktur / Betrieb

| Thema | Beschreibung |
|-------|-------------|
| Health-Check-Endpoint | `GET /api/health` fehlt; aktueller Workaround: `/api/cya/templates` |
| PouchDB-Kompaktierung | Kein automatischer Compaction-Job für große Object-Store-DBs |
| MQTT-TCP-Port | Embedded Aedes hat keinen externen TCP-Port; externe MQTT-Clients nicht möglich |

### Fachlich / Abnahme

| Thema | Status |
|-------|--------|
| Formale TRL8-Abnahme mit Pilotanwendern | Ausstehend — Onboarding-Dokumente bereit (v0.34.0) |
| Frontend-Integration (cernion-ui) | UI-Team: Profil-Update-Panel + Preferences-Visualisierung |
| §14a-Steuerbox-Zertifizierung | Abhängig von SMGW-Gateway-Partner |

---

## Hinweise für das Ops-Team

- **Backup:** Nach v0.34.0 kommen `data/object-store/` (Profile + Persona-Memories) hinzu.
  Das Backup-Skript in `docs/DEPLOYMENT_RUNBOOK.md` Abschnitt 5.2 ist aktuell.
- **Datenbankmigrationen:** Keine. Schema-less PouchDB, additiv.
- **Environment:** Keine neuen Pflicht-Variablen in v0.34.0.
- **Rollback auf v0.33.0:** Jederzeit möglich (Backup einspielen + `git checkout v0.33.0`).

---

*Erstellt für Cernion Energy Tools v0.34.0 | Stand: 2026-04-29*
