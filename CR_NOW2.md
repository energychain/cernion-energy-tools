# Übergabedokument – CR Direktvermarktung (Phase 1)

**Projekt:** Cernion MCP Backend
**Stand:** 2026-03-21
**Status:** ✅ Implementiert (Backend/MCP)

---

## 1) Ziel von Phase 1

Phase 1 liefert die Datenbasis für Direktvermarkter-Abfragen:

- Direktvermarkter-Felder werden im lokalen MaStR-Mongo-Modell gespeichert und indiziert.
- `cernion_installations_local` kann jetzt direkt nach Direktvermarkter filtern.
- `cernion_installations` akzeptiert neue Direktvermarkter-Parameter.
- Neues Lookup-Tool für Direktvermarkter ist verfügbar: `cernion_direktvermarkter_lookup`.

Damit sind REST-/MCP-Clients in der Lage, Direktvermarkter-Portfolios bereits in Phase 1 auszulesen (Listenfunktion als Zwischenmeilenstein).

---

## 2) API-/Tool-Änderungen für REST-Integratoren

### 2.1 Neues Tool

### `cernion_direktvermarkter_lookup`

Sucht Direktvermarkter im lokalen MaStR-Bestand und liefert Portfolio-Kennzahlen.

**Input**

- `name?: string` (fuzzy)
- `mastrId?: string` (exakt)
- `onlyActive?: boolean` (default `false`)
- `limit?: number` (default `10`, max `100`)

**Output (typisch)**

- `name`
- `mastrId`
- `role: "Direktvermarkter"`
- `portfolioSize`
- `totalCapacityMW`
- `installationTypes`

---

### 2.2 Erweiterung `cernion_installations_local`

Neue Filterparameter:

- `direktvermarkterName?: string`
- `direktvermarkterMastrId?: string`

Die Parameter können mit bestehenden Filtern kombiniert werden, z. B.:

- `type`
- `commissioning year` (über nachgelagerte Filterung im Client oder Folge-Query)
- `bundesland`, `postleitzahl`, `minCapacity`, `maxCapacity`, etc.

Zusätzlich enthalten Ergebnisdaten jetzt Direktvermarkter-Felder (falls vorhanden):

- `direktvermarkterName`
- `direktvermarkterMastrNummer`
- `direktvermarktungBeginn`
- `direktvermarktungStatus`

---

### 2.3 Erweiterung `cernion_installations`

Neue Parameter (für Kompatibilität/Planbarkeit im Agent- und REST-Flow):

- `direktvermarkterName?: string`
- `direktvermarkterMastrId?: string`

Hinweis: Bei Nutzung dieser beiden Parameter läuft die Anfrage über den generischen Query-Pfad (nicht den Grid-Operator-SQL-Spezialpfad).

---

## 3) Datenmodell-Erweiterung (lokale MongoDB)

Folgende Felder wurden in den Unit-Collections ergänzt:

- `direktvermarkterName` (indexiert)
- `direktvermarkterMastrNummer` (indexiert)
- `direktvermarktungBeginn` (indexiert)
- `direktvermarktungStatus` (indexiert)

Betroffene Collections:

- `mastr_solar_units`
- `mastr_wind_units`
- `mastr_storage_units`
- `mastr_biomass_units`
- `mastr_hydro_units`
- `mastr_combustion_units`
- `mastr_nuclear_units`
- `mastr_geothermie_units`

---

## 4) Beispielaufrufe für REST-Nutzer des MCP-Services

## 4.1 Direktvermarkter auflösen

Tool: `cernion_direktvermarkter_lookup`

Input:

```json
{
  "name": "Next Kraftwerke",
  "limit": 5
}
```

## 4.2 Anlagenliste eines Direktvermarkters (lokal, schnell)

Tool: `cernion_installations_local`

Input:

```json
{
  "direktvermarkterName": "Next Kraftwerke",
  "type": "all",
  "limit": 500,
  "format": "detailed"
}
```

## 4.3 Mit exakter Direktvermarkter-MaStR-ID

Tool: `cernion_installations_local`

Input:

```json
{
  "direktvermarkterMastrId": "ABR123...",
  "type": "solar",
  "bundesland": "Bayern",
  "limit": 200
}
```

---

## 5) Breaking-/Behavior-Hinweise

1. **Keine Breaking Changes** bei bestehenden VNB-Queries.
2. Neue Felder werden nur geliefert, wenn sie im MaStR-Datenbestand vorhanden sind.
3. Für Bestandsdaten kann ein Reimport nötig sein, damit die neuen Direktvermarkter-Felder vollständig befüllt sind.

---

## 6) Betriebs-/Rollout-Hinweise

1. Deploy des MCP-Backends mit den neuen Tool-Definitionen.
2. Optional/empfohlen: MaStR-Import erneut laufen lassen, damit Direktvermarkter-Felder breit gefüllt sind.
3. Monitoring nach Deployment:
   - Tool sichtbar in `ListTools`: `cernion_direktvermarkter_lookup`
   - Beispielquery liefert Treffer > 0 bei bekannten Direktvermarktern

---

## 7) Phase-1 Scope vs. nächste Schritte

**In Phase 1 enthalten:**

- Datenanreicherung + Indizierung
- Filter in Installations-Tools
- Direktvermarkter-Lookup-Tool

**Nicht in Phase 1 (Folgephasen):**

- Service-Endpunkte `grid-operations.direktvermarkterLookup` / `assets.byDirektvermarkter` in cernion-energy-tools
- Multi-Region-Forecast-Aggregation
- Vollständige Agent-Pipeline-Orchestrierung für Direktvermarkter

---

## 8) Ansprechpartner / Übergabe

Bei Rückfragen zur MCP-Seite (Toolverhalten, Payload-Formate, Filterlogik) bitte direkt auf dieses CR-Deliverable referenzieren: **"CR Direktvermarktung – Phase 1"**.
