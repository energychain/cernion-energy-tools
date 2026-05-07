# Issue 21 — Flex §14a SMGW-Connector (BSI-Schnittstelle)

**Bereich:** Domäne · **Priorität:** Mittel · **Ziel-Release:** v0.49

## Problem

`flex.service.js` ist TRL 5: §14a-Constraints (4.2 kW min, 2h max Dimming, 2h Cooldown) sind im Code, MQTT-Broker (`mqtt-broker.service.js`) ist eingebettet. Aber: **Echte Real-Steuerung** über BSI-zertifizierte Smart-Meter-Gateways (SMGW) fehlt. Damit ist der Service nur für Pilot-Tests mit eigener Hardware nutzbar, nicht für reguläre Stadtwerk-Kunden mit Gateway-Pflicht (§14a-Verordnung verlangt SMGW-Pfad).

Außerdem fehlen:
- **NES2-Tarif-Mapping** (dynamische Module 1/2/3-Tarife)
- **EEBUS-Profile** für Wärmepumpen / Wallbox-Hersteller
- **TAF-7-Integration** (steuerbarer Geräte-Kommunikationspfad)

## Vorschlag

1. **Neuer Connector** `services/smgw-connector.service.js`:
   - `POST /api/smgw/devices/register` — Pairing eines SMGW mit Cernion-Tenant (Pre-Shared-Key oder PKI)
   - `POST /api/smgw/devices/:gwId/control` — Sendet Steuerbefehl via TAF-7-konformer Nachricht
   - `GET /api/smgw/devices/:gwId/state` — letzter bekannter Zustand inkl. Quittungsstatus
   - `POST /api/smgw/billing-relevant-data/import` — viertelstundenscharfer Import (TAF-1/-2/-7)
2. **SMGW-Adapter-Plug-in-Modell:**
   - `src/smgw/adapters/openmuc.js` (Open-Source-Referenz)
   - `src/smgw/adapters/voltaris.js` (kommerzielle Test-Implementierung)
   - `src/smgw/adapters/mock.js` (Test-Fixture)
   - Konfig: `SMGW_ADAPTER=mock|openmuc|voltaris`, `SMGW_BASE_URL`, `SMGW_AUTH_*`.
3. **NES2-Tarif-Engine** in `src/flex/nes2-tariff-engine.js`:
   - Modul 1 (pauschale Reduktion), Modul 2 (zeitvariable), Modul 3 (dynamische)
   - Tarif-Lookup pro Gateway × Tenant × Vertragsmodul
4. **EEBUS-Bridge** `services/flex-eebus.service.js`:
   - Standard-EEBUS-Use-Cases: `LimitationOfPowerProduction`, `IncentiveTable`, `OverloadProtection`
   - Wallbox/Wärmepumpe als Smart-Premise via EEBUS-Stack
5. **HITL-Verschaltung:** kritische Steuerungs-Profile (z. B. Massenabschaltung) erzeugen HITL-Items.
6. **§14a-Compliance-Ausschuss-Track:**
   - Continuous-Compliance-Test gegen jedes BNetzA-Update (`flex.compliance.test.js`)
   - Audit-Report mit `agent_interventions` für jede Dimm-Aktion.

## Akzeptanzkriterien

- E2E-Test gegen `mock`-Adapter: Dimm-Plan → SMGW-Befehl → Quittung → Entlastungsnachweis korrekt.
- Tenant-Isolation: Tenant A's SMGW-Gateways unsichtbar für Tenant B.
- ≥45 Tests inkl. NES2-Modul-1/2/3, EEBUS-Use-Cases, Adapter-Stub.
- TRL-Update auf 6 in `ARCHITECTURE.md` (Issue 15).
- `docs/FLEX_SMGW_INTEGRATION.md` + `docs/FLEX_NES2_TARIFFS.md`.

## Bezug

- v0.31.0 — Flex §14a Service-Einführung
- v0.32.0 — MQTT-Broker (heutiger Steuerpfad ohne SMGW)
- §14a EnWG, BSI TR-03109, BSI TR-03116
- Hängt an Issue 17 (Tenant-RBAC für Geräte-Pairing) + Issue 18 (Quotas, kritisch bei Steuerlast)
