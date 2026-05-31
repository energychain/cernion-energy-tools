# Audit Report - Tranche D: Die kognitiven Agenten-Cores (Layer 3)

**Zielschicht:** Layer 3
**Generiert am:** 2026-05-31T10:03:13.077Z (UTC)

## Zusammenfassung der Tranche

- **Geprüfte Services:** 4
- 🔴 **Rot (Schwere Mängel):** 0
- 🟡 **Gelb (Handlungsbedarf):** 4
- 🟢 **Grün (Schichtenrein):** 0

--- 

## Detailbewertung der Services

### personal-agent.service.js (295.5 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["crypto","moleculer","../src/job-store","../src/tenant-context","../src/personal-agent-context","../src/personal-agent-state-machine","../src/personal-agent-execution-state-graph","../src/personal-agent-turn-graph","../src/consultation-execution-bridge","../src/consultation-input-extractor"]`
- **Abgehende Service-Calls (ctx.call):** `["llm.generate"]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.
- [ ] HARDCODING: Hardcoded DSO/VNB concepts in Layer 3 dialogue.
- [ ] FILE_SIZE: Large file (295.5 KB) indicating potential bloat.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'personal-agent' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### agent.service.js (141.0 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["crypto","fs","path","../src/period-normaliser","../src/vnb-identity","../src/prompt-scrubber","../src/llm-client","../src/agent-planning-utils"]`
- **Abgehende Service-Calls (ctx.call):** `["capability-broker.recommend","datasource-discovery.list","cookbook.search","datasource-registry.list","agent.execute"]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.
- [ ] HARDCODING: Hardcoded DSO/VNB concepts in Layer 3 dialogue.
- [ ] FILE_SIZE: Large file (141.0 KB) indicating potential bloat.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'agent' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### finance-agent.service.js (111.5 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["crypto","pouchdb","pouchdb-find","moleculer","../src/pagination","../src/validation-findings","../src/cya-a2a-protocol","../src/llm-client","../src/netzfahrplan-schema","../src/validation-findings"]`
- **Abgehende Service-Calls (ctx.call):** `["datapoint.get","object-store.put","object-store.get","object-store.query","datapoint.list","datapoint.create","ewk-monitoring.benchmarkVnb","grid-operations.marketPartners","assets.all"]`
- **Datenbank-Kopplung:** `["PouchDB","Direct DB reference"]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded German cities found in code.
- [ ] HARDCODING: Hardcoded DSO/VNB concepts in Layer 3 dialogue.
- [ ] FILE_SIZE: Large file (111.5 KB) indicating potential bloat.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'finance-agent' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

### customer-service.service.js (18.7 KB)
- **Status-Ampel:** 🟡 GELB
- **Imports (Auszug):** `["../src/mcp-client"]`
- **Abgehende Service-Calls (ctx.call):** `[]`

#### Befunde & Auffälligkeiten:
- [ ] HARDCODING: Hardcoded DSO/VNB concepts in Layer 3 dialogue.

#### GitNexus Symbol-Kontext (Abhängigkeiten & Prozesse):
```text
{
  "error": "Symbol 'customer-service' not found"
}

```

#### Konkrete Aufräum-Empfehlung:
*   **Empfehlung:** Extrahiere hartcodierte Heuristiken, Grenzwerte oder reguläre Ausdrücke in eine externe Konfiguration.
*   Falls die Dateigröße hoch ist, spalte Hilfsklassen in passive Module ab, um die Schicht sauber zu halten.

--- 

