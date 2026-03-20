# CR-MCP-2026-0XX: Neues MCP-Tool `vnb_lookup_codes` für kanonische VNB-Identität und vollständige Codeliste

## Metadaten
- **Typ:** Feature / Reliability / Data Quality
- **Priorität:** High
- **Status:** Implemented (MCP) / Handover Ready
- **Datum:** 2026-03-20
- **Anforderer:** VNB Monitor Team

---

## 1) Problem / Hintergrund

Im VNB-Monitor entstehen Fehltreffer bei EWK-Fallbacks, wenn `market_partners` veraltete oder inkonsistente Zuordnungen enthält (Beispiel: falscher BDEW-Code wird einem VNB-Namen zugeordnet).

Dadurch entstehen:
- unnötige MCP-Calls,
- erhöhte Latenz,
- instabile Fallback-Ketten.

Aktuell gibt es kein dediziertes MCP-Tool, das eine **kanonische VNB-Identität inklusive aller validierten Alias-Codes** in einem Schritt bereitstellt.

---

## 2) Ziel

Bereitstellung eines MCP-Tools `vnb_lookup_codes`, das für einen VNB alle bekannten Codes konsolidiert, Konflikte transparent markiert und eine belastbare Primäridentität für nachgelagerte Toolaufrufe liefert.

---

## 3) Scope

### In Scope
- Neues MCP-Tool: `vnb_lookup_codes`
- Input-Normalisierung für BDEW/BNR
- Multi-Source-Abgleich über bestehende MCP-Datenquellen
- Konsolidierte Antwortstruktur mit `canonical`, `aliases`, `codes`, `conflictFlags`, `sourceConfidence`
- Unit-/Integrationstests
- Dokumentation in MCP/OpenAPI

### Out of Scope
- Vollständige Bereinigung aller historischen Stammdaten im selben Sprint
- Breaking Changes an bestehenden Tools
- UI-Änderungen außerhalb MCP

---

## 4) API-Vertrag (Vorschlag)

### Request

```json
{
  "bdewCode": "9907473000008",
  "bnr": "99074730",
  "vnbName": "TWL Netze GmbH",
  "mastrId": "SNB...",
  "includeAliases": true,
  "includeTrace": false,
  "limitCandidates": 5
}
```

### Request-Regeln
- Mindestens eines von `bdewCode`, `bnr`, `vnbName`, `mastrId` ist erforderlich.
- `bdewCode`/`bnr` werden normalisiert (Länge/Format tolerant).
- Keine Exception bei widersprüchlichen Inputs; stattdessen `conflictFlags`.

### Response

```json
{
  "success": true,
  "canonical": {
    "name": "TWL Netze GmbH",
    "bdewCodePrimary": "9907473000008",
    "bnr": "99074730",
    "mastrId": "SNB...",
    "eic": null
  },
  "aliases": [
    {
      "code": "9907473000008",
      "type": "bdew",
      "role": "primary",
      "source": "market_partners",
      "confidence": "high"
    },
    {
      "code": "99074730",
      "type": "bnr",
      "role": "derived",
      "source": "normalization",
      "confidence": "medium"
    }
  ],
  "codes": [
    "9907473000008",
    "99074730"
  ],
  "candidates": [],
  "conflictFlags": [],
  "sourceConfidence": "high",
  "lastUpdated": "2026-03-20T12:00:00.000Z",
  "sourceTrace": []
}
```

---

## 5) Matching-/Konsolidierungslogik

1. **Input-Normalisierung**
   - `bdewCode`: numerisch, 8/13-stellig akzeptieren
   - `bnr`: 8-stellig
   - `vnbName`: normalisiert (Rechtsformen, Interpunktion, Whitespace)

2. **Kandidatensammlung**
   - Suche über relevante interne Quellen
   - Zusammenführen über Code-Beziehungen und Name-Match

3. **Scoring**
   - Exakte Code-Übereinstimmung > Name-Match > abgeleitete Relationen
   - Quellengewichtung nach Verlässlichkeit

4. **Konfliktbehandlung**
   - Mehrere starke Kandidaten => `candidates[]` + `conflictFlags`
   - Widersprüche markieren, nicht hart abbrechen

5. **Kanonisierung**
   - `canonical` nur bei eindeutiger/hoher Sicherheit
   - sonst best-ranked Kandidat + reduzierte Confidence + Flags

---

## 6) Fehler- und Edge-Case-Verhalten

- **Keine Treffer:** `success=true`, `canonical=null`, `aliases=[]`, `sourceConfidence=low`
- **Ambiguität:** `candidates[]` gefüllt, `conflictFlags` gesetzt
- **Ungültige Inputs:** strukturierte 4xx-Fehler mit Feldbezug
- **Upstream-Ausfall:** strukturierte 5xx-Fehler mit sanitisierten Details

---

## 7) Akzeptanzkriterien

1. Für bekannte Problemfälle (u. a. TWL/Freiberger) werden Konflikte sichtbar markiert.
2. `canonical.bdewCodePrimary` ist bei eindeutigen Fällen deterministisch.
3. `aliases[]` enthält deduplizierte Codes inkl. `type`, `role`, `source`, `confidence`.
4. Bei Ambiguität wird `candidates[]` geliefert.
5. Ziel-Latenz p95 < 500 ms bei warmem Cache.
6. Tests decken Normalfall, Ambiguität, Konflikt, Kein-Treffer ab.
7. MCP/OpenAPI-Dokumentation vollständig.

---

## 8) Testplan (Minimum)

### Unit
- Normalisierung (`bdewCode`, `bnr`, `vnbName`)
- Deduplizierung und Scoring
- Konfliktflag-Generierung

### Integration
- Eindeutiger VNB-Fall
- Ambiguer VNB-Name (`candidates[]`)
- Stale-Mapping-Fall (TWL/Freiberger)

### Non-Functional
- Lasttest für p95
- Cache-Hit/Miss-Verhalten

---

## 9) Rollout-Plan

1. Implementieren + intern testen
2. Shadow-Mode (Compare-Only gegen bisherigen Flow)
3. Aktivierung für Downstream-Services
4. Optional: Deprecation-Hinweis für clientseitige Heuristik-Fallbacks

---

## 10) Downstream-Integration (Hinweis)

Nach Bereitstellung kann `vnb-monitor`:
1. `vnb_lookup_codes` aufrufen,
2. Query-Reihenfolge aus `canonical` + verifizierten Alias-Codes aufbauen,
3. nur Codes mit ausreichender `sourceConfidence` für EWK-Fallback nutzen.

Damit wird Issue #3 strukturell adressiert statt nur symptomatisch.

---

## 11) Definition of Done

- [x] MCP-Tool `vnb_lookup_codes` implementiert
- [x] OpenAPI/MCP-Doku ergänzt
- [x] Tests inkl. TWL/Freiberger-Fall grün
- [ ] p95-Ziel erreicht (oder Abweichung dokumentiert)
- [ ] Changelog im MCP-Repo aktualisiert

---

## 12) Umsetzungsnachweis (Handover)

### Implementiert
- Tool-Logik: `src/mcp-server/tools/vnb-lookup-codes.ts`
- MCP-Registrierung: `src/mcp-server/index.ts`, `src/mcp-server/http-server.ts`
- Discovery-Eintrag: `src/mcp-server/tools/discover.ts`
- Referenz-Hinweis im Partner-Flow: `src/mcp-server/tools/market-partners.ts`
- Tests: `src/mcp-server/tools/__tests__/vnb-lookup-codes.test.ts`

### Umgesetztes Verhalten
- Input: mindestens eins aus `bdewCode|bnr|vnbName|mastrId`
- Normalisierung: BDEW 8/13-stellig tolerant, BNR 8-stellig, Name normalisiert
- Multi-Source-Abgleich: `BdewMappingService.lookup()` + Market-Partner-API
- Konsolidierung: `canonical`, `aliases`, `codes`, `candidates`
- Konfliktmodell: `conflictFlags` statt Hard-Fail bei Widersprüchen/Ambiguität
- Confidence: `sourceConfidence` als `high|medium|low`
- Debug: `sourceTrace` nur bei `includeTrace=true`

### Teststatus
- Unit-Test-Suite für `vnb_lookup_codes`: grün
- Abgedeckt: eindeutiger Treffer, Ambiguität, Konfliktfall, Kein-Treffer

### Offene Punkte
- p95-Nachweis (<500ms) noch nicht im CR dokumentiert
- Changelog-Eintrag für `vnb_lookup_codes` noch offen

### Integrationsleitfaden (empfohlen)
1. `vnb_lookup_codes` zuerst aufrufen
2. Bei `canonical` + `sourceConfidence=high|medium`: Primärcode aus `canonical` nutzen
3. `aliases` als Fallback-Reihenfolge nutzen
4. Bei `conflictFlags`/`candidates`: konservativen Fallback aktivieren
5. Bei `canonical=null`: manuellen oder sekundären Lookup triggern
