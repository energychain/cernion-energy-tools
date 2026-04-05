# RES-CR-0002: Unternehmens-Entity für ganzheitliche Stadtwerk-Betrachtung

**Referenz:** `cernion-ui/feedback/CR-0002-company-entity.md`
**Bearbeitet:** 2026-04-04
**Status:** resolved (Phase 1+2)
**Fix-Version:** 0.20.3
**UI-Contract-Update:** Ja — `docs/ui-contracts/14-company.md` (neu)

---

## Analyse

Stadtwerke und Konzernverbünde halten typischerweise 2–4 BDEW-Codes über mehrere
Marktrollenträger hinweg (VNB, Lieferant, MSB, ggf. BKV oder Direktvermarkter).
Das Backend hatte bisher keine Möglichkeit, diese Codes als zusammengehörige
wirtschaftliche Einheit zu verknüpfen. Jede Abfrage (z. B. `market-partners`,
`operatorAnalysis`) lieferte isolierte Einzeleinträge ohne Gruppierungskontext.

---

## Lösung

### Phase 1 — Shared Market-Role Classifier

Neues Modul `src/market-role-classifier.js` extrahiert die bislang inline in
`utility-report.service.js` enthaltene Klassifizierungslogik in einen zentralen,
wiederverwendbaren Baustein:

- `classifyPartner({ roles, bdewCode })` — bestimmt die Marktrolle eines Eintrags.
  Primärsignal: explizites `roles[]`-Array. Fallback: BDEW-Präfix-Heuristik
  (990x→VNB, 991x→Lieferant, 992x→MSB, 993x→BKV, 994x→Direktvermarkter).
- `normalizeMarketPartner(raw)` — normalisiert alle bekannten MCP-Response-Feldvarianten
  (`bdewCode`/`bdew`, `name`/`companyName`, `roles`/`marketRoles`, usw.).
- `extractCandidates(mcpResponse)` — extrahiert das Resultate-Array aus allen
  bekannten MCP-Response-Wrapper-Varianten.
- `MARKET_ROLE_ENUM` und `ROLE_RULES` als exportierte Konstanten.

### Phase 2 — Company Entity CRUD Service

Neuer Moleculer-Service `services/company.service.js`:

- **Persistenz:** PouchDB unter `data/companies/`, Dokument-Prefix `co:`
- **In-memory BDEW-Index:** `Map<bdewCode, companyId>` — wird beim Start und nach
  jeder Mutation neu aufgebaut (O(1)-Lookup für `enrichResults`)
- **Eindeutigkeit:** `_assertNoDuplicateBdew()` verhindert, dass derselbe BDEW-Code
  mehreren aktiven Companies zugeordnet wird (HTTP 409 `BDEW_ALREADY_ASSIGNED`)
- **Weiches Löschen:** `DELETE` setzt `status: "archived"` und gibt alle BDEW-Codes frei

**Neue REST-Endpoints unter `/api/companies`:**

| Method | Path | Auth | Beschreibung |
|--------|------|------|--------------|
| `POST`   | `/api/companies`            | full-access | Anlegen — manuell oder per autoDiscover |
| `PUT`    | `/api/companies/:id/confirm`| full-access | Draft → active (mit optionalem Member-Override) |
| `GET`    | `/api/companies/:id`        | read-only   | Abruf per UUID |
| `GET`    | `/api/companies`            | read-only   | Suche/Liste (query, limit, status) |
| `PUT`    | `/api/companies/:id`        | full-access | Felder und Members aktualisieren |
| `DELETE` | `/api/companies/:id`        | full-access | Soft-Delete (archivieren) |

**autoDiscover Draft-Confirm-Flow:**

```
POST /api/companies { autoDiscover: true, query: "Heidelberg", autoConfirm: false }
  → status: "draft", suggestedRoles: [...] (aus cernion_market_partners)

PUT /api/companies/:id/confirm { members: [...bereinigt...] }
  → status: "active", BDEW-Index aktualisiert
```

Dies erlaubt dem UI, die MCP-Vorschläge vor der Aktivierung zu prüfen und
ungewünschte Einträge zu entfernen (z. B. nicht zugehörige Firmen mit ähnlichem Name).

### Phase 2 — market-partners Enrichment

`GET /api/grid-operations/market-partners` fügt zwei additive Felder pro Ergebnis hinzu:

```json
{
  "companyId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "marketRole": "VNB"
}
```

- `companyId` — UUID der zugehörigen Company (oder `null` wenn nicht verknüpft)
- `marketRole` — immer befüllt; aus `roles[]` oder BDEW-Präfix-Heuristik

Das Enrichment ist **non-breaking**: beide Felder sind additiv. Ist der Company
Service nicht erreichbar, degradiert die Antwort graceful (Felder weggelassen,
Originalergebnisse zurückgegeben, WARN-Log im Backend).

---

## Betroffene Dateien

### Neu
- `src/market-role-classifier.js` — geteiltes Klassifizierungsmodul
- `services/company.service.js` — CRUD + autoDiscover + enrichResults
- `docs/ui-contracts/14-company.md` — vollständiger UI-Contract
- `tests/company.service.test.js` — 23 Tests (CRUD, autoDiscover, enrichResults)

### Geändert
- `services/utility-report.service.js` — importiert jetzt aus `market-role-classifier`
- `services/grid-operations.service.js` — `marketPartners`-Handler ruft `company.enrichResults`
- `services/api.service.js` — 6 neue Route-Aliases, `Companies`-OpenAPI-Tag, `requiresFullAccess`
- `services/agent.service.js` — `'company'` in beiden `skipServices`-Sets
- `tests/grid-operations.service.test.js` — 3 neue Tests für Enrichment-Integration

---

## Abgrenzung — Was in dieser Version NICHT enthalten ist

| Feature | Status | Geplant für |
|---------|--------|-------------|
| **Phase 3:** `GET /api/companies/:id/overview` — aggregierter Stadtwerk-Überblick (Anlagen, KPIs, Redispatch) | deferred | CR-0003 / v0.21 |
| **Phase 4:** `resolveCompanyBdew`-Middleware — BDEW-zu-companyId-Auflösung in ~10 bestehenden Actions | deferred | v0.20.4 |

---

## Verifizierung für das Frontend

### 1. Smoke-Test: Company anlegen

```http
POST /api/companies
Authorization: Bearer <full-access-token>
Content-Type: application/json

{
  "displayName": "Stadtwerke Teststadt",
  "members": [
    { "bdewCode": "9900277000000", "role": "VNB" },
    { "bdewCode": "9910277000001" }
  ]
}
```

Erwartete Antwort: `status: "active"`, `companyId` als UUID, zweiter Member mit
`role: "Lieferant"` (automatisch per BDEW-Präfix).

### 2. Smoke-Test: autoDiscover

```http
POST /api/companies
{ "displayName": "Stadtwerke Heidelberg", "autoDiscover": true, "query": "Heidelberg" }
```

Erwartete Antwort: `status: "draft"`, `suggestedRoles` mit MCP-Kandidaten, `message`
mit Confirm-URL.

```http
PUT /api/companies/<id>/confirm
```

Erwartete Antwort: `status: "active"`.

### 3. Smoke-Test: Enriched market-partners

```http
GET /api/grid-operations/market-partners?query=Heidelberg
```

Falls eine Company mit dem BDEW-Code aus dem Ergebnis existiert:
→ `companyId` ist die UUID der Company.

Falls nicht: `companyId: null`. `marketRole` ist in jedem Fall befüllt.

### 4. Duplikat-Schutz

Zweites `POST /api/companies` mit demselben `bdewCode` →
HTTP 409, `type: "BDEW_ALREADY_ASSIGNED"`.

---

## Vollständiger UI-Contract

→ `docs/ui-contracts/14-company.md`
