# Feature Request: Direktvermarkter-Pipeline für den Research Query Builder

**Projekt:** energychain/cernion-energy-tools
**Komponenten:** `agent.service.js`, `grid-operations.service.js`, `assets.service.js`, `forecast.service.js`, MCP-Backend (`cernion_installations` / `cernion_installations_local`)
**Priorität:** Hoch
**Typ:** New Feature (mehrstufig)

> **Status-Update (2026-03-21):** Phase 1 (MCP-Backend/Mongo) umgesetzt.
> Übergabedokument für REST-Integratoren: [REST-HANDOVER-CR-DIREKTVERMARKTUNG-PHASE1.md](REST-HANDOVER-CR-DIREKTVERMARKTUNG-PHASE1.md)

---

## 1. Zusammenfassung

Der Research Query Builder kann heute Fragestellungen nach **Netzbetreibern (VNB)** über eine bewährte 3-Schritt-Pipeline auflösen:

```
grid-operations.marketPartners → grid-operations.vnbLookup → assets.all
```

Diese Pipeline soll um eine gleichwertige **Direktvermarkter-Pipeline** erweitert werden, sodass Fragen wie

> *„Zeige eine Prognose der Erzeugung des Direktvermarkters NextKraftwerke und ermittle jeweils den Wert der Strommenge auf Basis des Spot Preises"*

genauso nahtlos beantwortet werden können wie die heutige VNB-Variante für Stadtwerke Frankenthal.

---

## 2. Ist-Zustand

### 2.1 VNB-Pipeline (funktioniert)

| Schritt | Aktion | Zweck |
|---------|--------|-------|
| 1 | `grid-operations.marketPartners` | Suche nach VNB → BDEW-Code |
| 2 | `grid-operations.vnbLookup` | BDEW → MaStR-ID (SNB...) |
| 3 | `assets.all` | Alle Anlagen des VNB abrufen |
| 4 | `forecast.generationForecast` | Erzeugungsprognose für Netzgebiet |
| 5 | `energy-market.prices` | EPEX Day-Ahead zur Bewertung |

Der Agent erkennt einen VNB-Kontext und generiert diesen 5-Schritt-Plan automatisch.

### 2.2 Direktvermarkter-Anfrage (fehlschlagend)

Bei der Anfrage *„Gebe mir eine Liste der Anlagen in der Direktvermarktung von NextKraftwerke, die 2025 angeschlossen wurden"* erkennt der Agent bereits korrekt:

- NextKraftwerke ist ein **Direktvermarkter (Virtual Power Plant)**, kein VNB
- Die 3-Schritt-VNB-Pipeline greift **nicht**
- Fallback auf `query.askLearned` → liefert **0 Ergebnisse** (kein Template vorhanden, lokale DB hat Filterfeld nicht indiziert)

### 2.3 Lücken in der Tool-Landschaft

1. **`cernion_installations`** hat Filter für `gridOperatorId`, `gridOperatorName`, `gridOperatorBdewCode` — aber **keinen Filter für Direktvermarkter**
2. **`cernion_installations_local`** (MongoDB) hat ebenfalls keinen Direktvermarkter-Index
3. **`grid-operations.marketPartners`** löst nur VNB/Lieferanten auf, nicht explizit die Rolle „Direktvermarkter"
4. Im **Agent-Prompt** (Gemini) fehlt das Wissen über eine Direktvermarkter-Pipeline als Alternative zur VNB-Pipeline
5. **`forecast.generationForecast`** arbeitet heute auf Basis eines zusammenhängenden Netzgebiets — Direktvermarkter-Portfolios sind geografisch über ganz Deutschland verteilt

---

## 3. Ziel-Zustand

### 3.1 Neue Direktvermarkter-Pipeline

| Schritt | Aktion | Zweck |
|---------|--------|-------|
| 1 | `grid-operations.direktvermarkterLookup` **[NEU]** | Suche nach Direktvermarkter im MaStR → Marktakteur-ID |
| 2 | `assets.byDirektvermarkter` **[NEU]** | Alle Anlagen mit diesem Direktvermarkter abrufen |
| 3 | `forecast.generationForecast` | Erzeugungsprognose (mit Multi-Region-Aggregation) |
| 4 | `energy-market.prices` | EPEX Day-Ahead zur Bewertung |

### 3.2 Erwartetes Verhalten im Research Query Builder

**Eingabe:**
> „Zeige eine Prognose der Erzeugung des Direktvermarkters NextKraftwerke und ermittle den Marktwert"

**AI Strategy (Schritt 2):**
> Da NextKraftwerke ein Direktvermarkter ist, wird die Direktvermarkter-Pipeline verwendet. Zunächst wird der Marktakteur im MaStR identifiziert, dann das Portfolio der Anlagen in der Direktvermarktung abgerufen. Die Erzeugungsprognose wird über die regionalen Cluster des Portfolios aggregiert und mit den EPEX Day-Ahead-Preisen bewertet.

---

## 4. Implementierungsvorschlag (3 Phasen)

### Phase 1: Datenanreicherung (MCP-Backend / MongoDB)

**Ziel:** Direktvermarkter-Feld im MaStR-Datenbestand abfragbar machen.

Das MaStR liefert für Einheiten das Feld `ZugeijordneteDirektvermarktung` (bzw. analog für Stromerzeugungseinheiten den zugeordneten Marktakteur für Direktvermarktung). Dieses Feld muss:

1. In der lokalen MongoDB (`cernion_installations_local`) indiziert werden
2. Als neuer Filterparameter in `cernion_installations` exponiert werden:

```javascript
// Neuer Parameter in cernion_installations
{
  // ... bestehende Parameter ...
  direktvermarkterName: string,     // Fuzzy-Match auf Marktakteur-Name
  direktvermarkterMastrId: string,  // Exakte MaStR-ID des Direktvermarkters
}
```

3. Ein neuer MCP-Tool-Parameter oder ein dediziertes Tool `cernion_direktvermarkter_lookup` analog zu `cernion_vnb_lookup`:

```javascript
// Input
{ name: "NextKraftwerke" }

// Output
{
  name: "Next Kraftwerke GmbH",
  mastrId: "ABR...",  // Marktakteur-Registrierungsnummer
  role: "Direktvermarkter",
  portfolioSize: 12453,  // Anzahl Anlagen
  totalCapacityMW: 3240.5
}
```

### Phase 2: Service-Erweiterung (cernion-energy-tools)

#### 2a. Neuer Service-Endpoint `grid-operations.direktvermarkterLookup`

```javascript
// services/grid-operations.service.js — neue Action
direktvermarkterLookup: {
  rest: 'POST /direktvermarkter-lookup',
  params: {
    name: { type: 'string', optional: true },
    mastrId: { type: 'string', optional: true }
  },
  openapi: {
    summary: 'Lookup Direktvermarkter im MaStR',
    description: 'Identifiziert einen Direktvermarkter und gibt Portfolio-Metadaten zurück',
    tags: ['GridOperations']
  },
  async handler(ctx) {
    // MCP-Call: cernion_direktvermarkter_lookup oder
    // cernion_market_partners mit Rollenfilter "Direktvermarkter"
  }
}
```

#### 2b. Neuer Service-Endpoint `assets.byDirektvermarkter`

```javascript
// services/assets.service.js — neue Action
byDirektvermarkter: {
  rest: 'POST /by-direktvermarkter',
  params: {
    direktvermarkterName: { type: 'string', optional: true },
    direktvermarkterMastrId: { type: 'string', optional: true },
    commissioningYear: { type: 'number', optional: true, integer: true },
    installationType: { type: 'string', optional: true },
    limit: { type: 'number', optional: true, default: 1000 }
  },
  openapi: {
    summary: 'Anlagen eines Direktvermarkters abrufen',
    description: 'Gibt alle MaStR-Einheiten zurück, die dem angegebenen Direktvermarkter zugeordnet sind',
    tags: ['Assets']
  },
  async handler(ctx) {
    // MCP-Call: cernion_installations_local mit direktvermarkter-Filter
    // oder cernion_installations mit neuem Parameter
  }
}
```

#### 2c. Erweiterung `forecast.generationForecast` — Multi-Region-Aggregation

Das heutige Forecast-Tool arbeitet auf einem zusammenhängenden Netzgebiet (ein VNB = eine Region). Für Direktvermarkter-Portfolios muss die Prognose über mehrere Standorte aggregiert werden.

**Strategie — Regionale Clusterung:**

```
Portfolio (z.B. 12.000 Anlagen)
  → Clustering nach Bundesland/Landkreis (z.B. 30-50 Cluster)
    → Pro Cluster: eine Wetter-Abfrage + Forecast
      → Summierung aller Cluster-Prognosen
```

Neuer optionaler Parameter:

```javascript
{
  // bestehende Parameter...
  installationList: [  // NEU: Liste von Anlagen mit Standort
    { mastrNr: "SEE...", capacityKW: 9.9, lat: 49.41, lon: 8.69 },
    // ...
  ],
  clusterMethod: 'bundesland' | 'landkreis' | 'plz2',  // Aggregationsebene
}
```

**Achtung — Performance:** Bei großen Portfolios (>10.000 Anlagen, >50 Cluster) ist ein asynchroner Job (`cernion_job_status` / `cernion_job_result`) zwingend erforderlich. Das bestehende Async-Job-Polling-Pattern kann direkt wiederverwendet werden.

### Phase 3: Agent-Integration

#### 3a. Gemini-Prompt-Erweiterung

Im System-Prompt des Agent-Service (Abschnitt zu verfügbaren Pipelines) muss die Direktvermarkter-Pipeline als erkanntes Pattern hinzugefügt werden:

```
PIPELINE: DIREKTVERMARKTER
Trigger: Nutzer fragt nach einem Direktvermarkter (z.B. "NextKraftwerke",
  "Statkraft", "BayWa r.e.", "EnBW Trading", "Direktvermarktung von...")
Schritte:
  1. grid-operations.direktvermarkterLookup — Name → Marktakteur-ID
  2. assets.byDirektvermarkter — Marktakteur-ID → Anlagenliste
  3. [optional] forecast.generationForecast — Portfolio-Prognose
  4. [optional] energy-market.prices — Marktwertberechnung
Hinweis: Nicht die VNB-Pipeline verwenden! Direktvermarkter sind keine
  Netzbetreiber.
```

#### 3b. `normalizePlan()` Erweiterung

Die Plan-Normalisierung muss die neuen Actions (`grid-operations.direktvermarkterLookup`, `assets.byDirektvermarkter`) in die Validierungsliste aufnehmen.

#### 3c. `resolveChainedRef()` Erweiterung

Neue Verkettungsmuster:
- `__step_1.mastrId` → Direktvermarkter-MaStR-ID aus Schritt 1 → Parameter für Schritt 2
- `__step_2.installations` → Anlagenliste aus Schritt 2 → Parameter für Schritt 3 (Forecast)

---

## 5. MaStR-Datenmodell — Relevante Felder

Für die Implementierung relevante Felder in der MaStR-Datenstruktur:

| Feld | Beschreibung | Nutzung |
|------|-------------|---------|
| `DirektvermarktungUnternehmen` | Name des Direktvermarkters | Fuzzy-Search |
| `DirektvermarktungMastrNummer` | MaStR-Nr. des Direktvermarkters | Exakte ID |
| `DirektvermarktungBeginn` | Beginn der Direktvermarktung | Zeitfilter |
| `DirektvermarktungStatus` | Aktiv/Beendet | Nur aktive selektieren |
| `Standort` (Breitengrad/Längengrad) | GPS der Anlage | Clustering für Forecast |
| `InbetriebnahmeDatum` | Anschlussjahr | Filter „2025 angeschlossen" |
| `Nettonennleistung` | Installierte Leistung | Kapazitätsberechnung |

**Hinweis:** Die exakten Feldnamen können je nach MaStR-API-Version und lokalem DB-Schema abweichen. Vor der Implementierung mit `cernion_discover(scope: 'columns', table: 'stromerzeugungseinheiten')` die aktuellen Feldnamen verifizieren.

---

## 6. Zwischenmeilenstein: Einfache Listenfunktion

Als schneller erster Wert kann **ohne Forecast-Erweiterung** allein die Listenfunktion umgesetzt werden:

> „Gebe mir eine Liste der Anlagen in der Direktvermarktung von NextKraftwerke, die 2025 angeschlossen wurden"

Dafür reichen **Phase 1** (Datenindexierung) und **Phase 2a + 2b** (neue Service-Endpoints). Die Agent-Prompt-Erweiterung (Phase 3a) ist ebenfalls schnell umsetzbar, da das Pattern klar definiert ist.

**Erwartetes Ergebnis (Step 4 im Research Query Builder):**

| MaStR-Nr. | Typ | Leistung (kW) | Standort | IBN-Datum | Direktvermarkter |
|-----------|-----|---------------|----------|-----------|-----------------|
| SEE... | Solar | 750 | Mannheim | 15.03.2025 | Next Kraftwerke GmbH |
| SEE... | Wind | 3.400 | Hunsrück | 22.01.2025 | Next Kraftwerke GmbH |
| ... | ... | ... | ... | ... | ... |

---

## 7. Herausforderungen & offene Fragen

### 7.1 Performance der Forecast-Aggregation

Ein großer Direktvermarkter wie NextKraftwerke hat potenziell **10.000+ Anlagen** an **hunderten Standorten**. Die naive Lösung (eine Forecast-Abfrage pro Anlage) ist nicht praktikabel.

**Empfohlener Ansatz:** Clustering auf PLZ-2-Ebene (max. 95 Cluster in Deutschland), pro Cluster eine aggregierte Forecast-Abfrage mit der Summenleistung als Input. Das ergibt max. 95 Wetter-API-Calls statt 10.000+.

**Offene Frage:** Reicht das Visual-Crossing-API-Kontingent (24h-Caching im Forecast-Service) für diese Last? Ggf. muss ein separater Caching-Layer pro Cluster eingeführt werden.

### 7.2 Datenaktualität der Direktvermarkter-Zuordnung

Die MaStR-Zuordnung zu Direktvermarktern wird vom Anlagenbetreiber gemeldet und kann veraltet sein (z.B. nach Wechsel des Direktvermarkters). Ergebnisse sollten einen Hinweis auf den Datenstand enthalten.

### 7.3 Abgrenzung Marktakteur-Rollen

Ein Marktakteur kann gleichzeitig Direktvermarkter, Lieferant und Netzbetreiber sein. Die Suche muss nach der **Rolle** filtern, nicht nur nach dem Namen. Das `cernion_market_partners`-Tool liefert heute bereits Rollenzuordnungen — diese müssen für den Direktvermarkter-Kontext genutzt werden.

### 7.4 Shareable URL / Live CSV

Die bestehende Session-Architektur (`/api/agent/session/:id/csv`) funktioniert ohne Anpassung, da das Plan-Format identisch bleibt — nur die Actions und Parameter ändern sich.

---

## 8. Testfälle

| # | Eingabe | Erwartetes Verhalten |
|---|---------|---------------------|
| T1 | „Liste der Anlagen von NextKraftwerke" | Agent erkennt Direktvermarkter → `direktvermarkterLookup` → `assets.byDirektvermarkter` → Tabelle |
| T2 | „Anlagen von Statkraft, die 2025 in Betrieb gingen" | Wie T1, zusätzlich `commissioningYear: 2025` als Filter |
| T3 | „Prognose der Erzeugung von NextKraftwerke + Marktwert" | Volle Pipeline inkl. Forecast-Aggregation + Preisbewertung |
| T4 | „PV-Anlagen im Netz der Stadtwerke Heidelberg" | Unverändert: VNB-Pipeline, kein Regression |
| T5 | „Vergleiche installierte Leistung von NK vs. Statkraft" | Zwei Direktvermarkter-Lookups parallel |
| T6 | „Direktvermarktung von TWL Netze" | Edge Case: TWL Netze ist primär VNB → Agent sollte klären oder beides anbieten |

---

## 9. Abhängigkeiten

- **MCP-Backend (api.cernion.de):** Neuer Filter auf `cernion_installations` / `cernion_installations_local` für Direktvermarkter-Felder
- **MaStR-Datenimport:** Sicherstellen, dass `DirektvermarktungUnternehmen` und verwandte Felder in der lokalen MongoDB vorhanden und indiziert sind
- **Gemini-Prompt:** Erweiterung des Agent-System-Prompts um Direktvermarkter-Pipeline-Pattern
- **OpenAPI-Spec:** Neue Endpoints dokumentieren (automatisch via Moleculer Auto OpenAPI)

---

## 10. Vorgeschlagene Milestone-Zuordnung

| Phase | Umfang | Release |
|-------|--------|---------|
| Phase 1 (DB-Index + Filter) | MCP-Backend | v0.10.0 oder Hotfix auf v0.9.x |
| Phase 2a+2b (Endpoints) | cernion-energy-tools | v0.10.0 |
| Phase 3a (Agent-Prompt) | cernion-energy-tools | v0.10.0 |
| Phase 2c (Multi-Region Forecast) | cernion-energy-tools + Forecast-Service | v0.10.1 oder v0.11.0 |
