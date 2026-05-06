# Issue 16 — Capability Broker v2 (extern + Versionierung + Multi-Tenant)

**Bereich:** Architektur · **Priorität:** Hoch · **Ziel-Release:** v0.48

## Problem

v0.46.0 liefert Capability Broker v1, aber explizit als **internal-only** mit der Begründung „no API gateway route in v1". Damit:

- UI/Power-Automate können den Broker nicht nutzen, um geeignete Aktionen zu finden (Stadtwerk-Self-Service blockiert).
- Externe Integratoren müssen weiterhin den vollständigen Service-Katalog parsen.
- Capability-Versionsstrategie ist nur dokumentiert (`schemaVersion: cernion.capabilityRecommendation.v1`), aber keine Migration auf v2 nachgewiesen.
- Tenant-Awareness im Broker ist im Changelog nicht dokumentiert; vermutlich nutzt er globalen Catalog ohne Tenant-Filter.

## Vorschlag

1. **Externer API-Surface** in `services/capability-broker.service.js`:
   - `POST /api/capability-broker/recommend` (Full-Access)
   - `GET /api/capability-broker/catalog` (read-only, alle Token)
   - `GET /api/capability-broker/catalog/:domain` (Detail)
2. **Versionierung:**
   - `schemaVersion`-Header pflicht in Request (`Accept-Version: cernion.capabilityRecommendation.v2`).
   - Coexistenz v1 + v2 mit `Sunset`-Header für v1.
   - Version-Diff-Tabelle in `docs/CAPABILITY_BROKER_VERSIONS.md`.
3. **Tenant-Awareness:**
   - `tenant:{id}:capability_overrides`-Namespace für Tenant-spezifische Whitelists/Blacklists.
   - `doNotUse` und `preferred`/`fallback` pro Tenant überschreibbar.
   - Telemetrie: welche Aktionen wurden tatsächlich aus den Empfehlungen aufgerufen → adaptive Lernschleife.
4. **OpenAPI-Tag** `Capability Broker`.
5. **UI-Contract** `docs/ui-contracts/41-capability-broker.md`.
6. **Webhook-Event** `capability-broker.recommendation.delivered` für Monitoring.

## Akzeptanzkriterien

- E2E-Test: Externer API-Aufruf liefert deterministische Empfehlung; v1-Aufruf bleibt bis Sunset-Datum funktionsfähig.
- Tenant A's `doNotUse`-Liste blockt Aktion, die für Tenant B erlaubt ist.
- ≥30 Tests inkl. Versionierungs-Edge-Cases.
- Lasttest: 1000 `recommend`-Calls/min ohne Latenz-Spike.

## Bezug

- v0.46.0 — Capability Broker v1
- v0.46.1, v0.46.2 — Aufrufer-Integrationen (Finance, ZNP, CYA)
- `src/capability-catalog.js`
