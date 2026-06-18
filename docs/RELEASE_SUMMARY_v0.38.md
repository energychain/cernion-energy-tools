# Release Summary v0.38.x — UI Contract Vollsynchronisation

> **Erstellt:** 2026-05-01
> **Version:** 0.38.1
> **Sprint-Ziel:** Alle seit v0.28 eingeführten Services erhalten UI-Contracts;
> bestehende Contracts werden auf aktuellen Stand gebracht.

---

## UI Contract Status (vollständig)

| # | Contract | Version | Endpoints | Stand | Anmerkung |
|---|----------|---------|-----------|-------|-----------|
| 00 | `00-*.md` | — | — | ✅ | Nicht geändert |
| 01 | `01-*.md` | — | — | ✅ | Nicht geändert |
| 02 | `02-*.md` | — | — | ✅ | Nicht geändert |
| 03 | `03-*.md` | — | — | ✅ | Nicht geändert |
| 04 | `04-*.md` | — | — | ✅ | Nicht geändert |
| 05 | `05-mastr-quality.md` | 0.25.0 | 4 | ✅ aktuell | |
| 06 | `06-grid-connection.md` | — | — | ✅ | Nicht geändert |
| 07 | `07-energy-sharing.md` | — | — | ✅ | §42c-KPIs → Contract 23 |
| 08 | `08-redispatch.md` | 0.38.1 | 4 | ✅ aktualisiert | Settlement-Link + v0.30-Hinweis |
| 09 | `09-*.md` | — | — | ✅ | Nicht geändert |
| 10 | `10-*.md` | — | — | ✅ | Nicht geändert |
| 11 | `11-*.md` | — | — | ✅ | Nicht geändert |
| 12 | `12-auth.md` | 0.38.1 | — | ✅ aktualisiert | tenantId v0.38.0 |
| 13 | `13-*.md` | — | — | ✅ | Nicht geändert |
| 14a | `14a-*.md` | — | — | ✅ | Nicht geändert |
| 14b | `14b-*.md` | — | — | ✅ | Nicht geändert |
| 15 | `15-*.md` | — | — | ✅ | Nicht geändert |
| 16 | `16-*.md` | — | — | ✅ | Nicht geändert |
| 17 | `17-*.md` | — | — | ✅ | Nicht geändert |
| 18 | `18-*.md` | — | — | ✅ | Nicht geändert |
| 20 | `20-cya.md` | 0.38.0 | 15+ | ✅ aktuell | zuletzt in v0.37/v0.38 aktualisiert |
| 21 | `21-mastr-monitor.md` | 0.38.1 | 12 | ✅ aktualisiert | v0.27.3 Chunking dokumentiert |
| 22 | `22-settlement.md` | 0.38.1 | 8 | ✅ **NEU** | v0.30.0 |
| 23 | `23-bilanzkreis.md` | 0.38.1 | 6 | ✅ **NEU** | v0.30.0 + §42c-KPIs v0.38.0 |
| 24 | `24-forecast-engine.md` | 0.38.1 | 8 | ✅ **NEU** | v0.30.1 |
| 25 | `25-flex.md` | 0.38.1 | 8 | ✅ **NEU** | v0.31.0 §14a |
| 26 | `26-edm.md` | 0.38.1 | 25 | ✅ **NEU** | v0.28–v0.29 (edm+messkonzept+validation+virtual+mscons) |
| 27 | `27-slp.md` | 0.38.1 | 5 | ✅ **NEU** | v0.28.0 |

**Gesamt: 28 Contracts, 6 neu, 3 aktualisiert**

---

## Neue Contracts (22–27) — Übersicht

### 22-settlement.md — Settlement Service

Berechnet Redispatch-Entschädigungen (§13a/14 EnWG) und EEG-Vergütungen.
Stellt A96-Export bereit. KRITIS-konform mit internen Fallbacks.

**Key-Endpoints:**
- `POST /api/settlement/redispatch/calculate` — Redispatch-Entschädigung
- `POST /api/settlement/eeg/calculate` — EEG-Vergütung
- `POST /api/settlement/a96/prepare` + `GET .../export/:id` — A96-Export
- `GET /api/settlement/eeg-tariff` — EEG-Tariflookup nach Inbetriebnahmejahr

### 23-bilanzkreis.md — Bilanzkreis Service

Reale und virtuelle Bilanzkreise mit 15-min-Intervall-Bilanzierung.
Neu in v0.38.0: `PARAGRAF_42C_KONFORM` und `A96_FAEHIG` KPIs in `checkReadiness`.

**Key-Endpoints:**
- `POST /api/bilanzkreis/` — Bilanzkreis anlegen (Typen: energy_sharing, mieterstrom, arealnetz, vpp)
- `POST /api/bilanzkreis/:id/calculate` — Bilanzierung berechnen
- `GET /api/bilanzkreis/:id/readiness` — §42c Settlement-Readiness

### 24-forecast-engine.md — Forecast Engine

Lastprognosen (SLP + historische Korrektur), Erzeugungsprognosen (MCP/KRITIS-Fallback),
Day-Ahead-Fahrplan, Speicher-Dispatch-Optimierung, Qualitäts-Tracking.

**Key-Endpoints:**
- `POST /api/forecast-engine/load` — Lastprognose
- `POST /api/forecast-engine/generation` — Erzeugungsprognose
- `POST /api/forecast-engine/schedule/day-ahead` — Day-Ahead-Fahrplan
- `POST /api/forecast-engine/quality` — RMSE/MAE/MAPE-Bewertung

### 25-flex.md — §14a Flexibilitätsmanagement

SVE-Registry (Wallbox, Wärmepumpe, Speicher, Klimaanlage), Dimming-Planung
und -Ausführung via MQTT, Entlastungsnachweis, Netzentgelt-Reduktionsberechnung.

**Key-Endpoints:**
- `POST /api/flex/devices` — SVE registrieren
- `POST /api/flex/events/plan` — Dimming-Event planen
- `POST /api/flex/events/execute` — Dimming-Event ausführen (full-access)
- `GET /api/flex/relief-proof/:period` — Entlastungsnachweis

### 26-edm.md — Energiedatenmanagement (konsolidiert)

Konsolidiert alle 5 EDM-Services: `edm` (Core, 10), `edm-messkonzept` (6),
`edm-validation` (4), `edm-virtual` (2), `mscons-import` (3). 25 Endpoints total.
SQLite-Backend, KRITIS-konform, kein externer Server.

**Key-Endpoints:**
- `POST /api/edm/melos` + Zeitreihen-CRUD — Core MeLo/Timeseries
- `POST /api/edm/messkonzepte` + evaluate — Formel-Engine
- `POST /api/edm/validate` + fill-gaps — Validierung
- `POST /api/mscons/import` — EDIFACT-Import

### 27-slp.md — SLP-Service

BDEW-Standardlastprofile (H0, G0, L0 etc.) + Custom-Profile für individuelle
VNB-Anpassungen. Shared dependency von edm-virtual, forecast-engine, settlement.

---

## Für das UI-Team

Alle neuen Contracts (22–27) folgen dem etablierten Muster:
- Endpoint-Tabellen mit Auth-Anforderungen (Bearer / full-access)
- Request/Response-Shapes mit realistischen Beispieldaten (Solarpark Höheinöd / STROMDAO)
- `Verwandte Services`-Sektion mit Contract-Querverweisen
- Open Points explizit markiert mit `[OFFEN-N]` inkl. Zielversion
- Keine TypeScript-Definitionen (bewusst — bleibt im UI-Team)
- Keine Pilotanwender-Namen in Contracts

### Service-Abhängigkeits-Graph (relevant für Implementierungsreihenfolge)

```
27-slp
  └── 26-edm (edm-virtual)
        └── 24-forecast-engine
              └── 23-bilanzkreis
                    └── 22-settlement
                    └── 25-flex
                          └── 24-forecast-engine (Netzlast-Prognose)
```

EDM + SLP sind die Basis-Layer. Settlement und Flex bauen auf Bilanzkreis und
Forecast auf.

### Auth-Anforderungen (wichtig für RBAC-Implementierung)

| Endpoint-Gruppe | Scope |
|----------------|-------|
| Alle GET-Endpoints | `read-only` oder `full-access` |
| POST/PUT (Berechnung, Erstellung) | `full-access` |
| DELETE | `full-access` |
| `flex.executeDimming` | `full-access` (explizit — Aktionsschutz) |
| `settlement.prepareA96` | `full-access` (explizit — regulatorischer Export) |
| `token-manager.tenant.list` | `full-access` |

### Breaking Changes

**Keine.** Alle Änderungen in v0.30–v0.38 sind additiv.
Bestehende Integrations, die gegen v0.27-Contracts arbeiten, sind vollständig
kompatibel.

---

## Test-Coverage relevanter neuer Services

| Service | Testdatei | Tests |
|---------|----------|-------|
| `settlement` | `tests/settlement.service.test.js` | — |
| `bilanzkreis` + §42c KPIs | `tests/bilanzkreis*.test.js` + `tests/energy-sharing-e2e-abnahme.test.js` | 18 E2E |
| `forecast-engine` | `tests/forecast-engine.service.test.js` | — |
| `flex` | `tests/flex.service.test.js` | — |
| `edm` (core) | `tests/edm*.test.js` | mehrere |
| `mscons-import` | `tests/mscons-import.service.test.js` | — |
| `slp` | integriert in `edm-virtual`-Tests | — |
| `tenant-context` | `tests/tenant-context.test.js` | 31 |
