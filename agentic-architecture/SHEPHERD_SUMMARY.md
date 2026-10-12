# Shepherd Summary

Generated: 2026-10-12T13:55:46.275Z
Run: 20261012T135402Z
Branch: shepherd/runtime-refactor-20261012T135401Z
Fingerprint: 0512530d9a7132483b1c7b8385a28283c9c2a2222c9876f251b496960a22d9ba

## Current measurable surface

- Files: 1906
- Services: 159
- src JS files: 363
- Tests: 475
- Agentic files: 270
- OpenWebUI/ChatGPT files: 33
- Evidence/HITL files: 74
- Routing/capability files: 92
- Services without obvious direct filename-mapped test: 29

## Artifact state

- Operation capability index: present
- OpenAPI export: present
- llm.txt: present
- verify:agent-shapes script: present
- verify:open-webui script: present

## Top directories

- `tests`: 541 files
- `src`: 429 files
- `docs`: 381 files
- `services`: 195 files
- `tools`: 85 files
- `scripts`: 70 files
- `agentic-architecture`: 61 files
- `integrations`: 31 files
- `.claude`: 26 files
- `.github`: 11 files
- `feedback`: 8 files
- `.vscode`: 5 files
- `examples`: 3 files
- `fixtures_parallel`: 2 files
- `fixtures_real`: 2 files
- `reports`: 2 files
- `.copilotignore`: 1 files
- `.editorconfig`: 1 files
- `.env.example`: 1 files
- `.eslintrc.hygiene.json`: 1 files

## Domain abstraction

- Domain abstraction: present
- Domain fingerprint: 81b3f1c9ac993fc731f80d17faa6ec7fde30be0772bc3085a3c0e3119e6b0e2f
- Candidate files: 1136
- Unclassified services: 0

Cluster counts:

- `casework-and-assistance` — Fallarbeit und Assistenz: 2 services, 25 top files
- `evidence-and-trust` — Evidence, Nachweis und Vertrauen: 23 services, 25 top files
- `mako-and-edm` — MaKo / EDM / Stammdaten: 8 services, 25 top files
- `grid-and-connection` — Netz, Anschluss und Kapazität: 46 services, 25 top files
- `forecast-and-market` — Prognose, Markt und Portfolio: 16 services, 25 top files
- `redispatch-and-controllability` — Redispatch, Steuerbarkeit und Flexibilität: 3 services, 25 top files
- `gas-heat-and-eog` — Gas, Wärme und EOG: 3 services, 25 top files
- `tenant-and-operation` — Tenant, Rollen und Betrieb: 51 services, 25 top files
- `openwebui-agentic-routing` — OpenWebUI und agentisches Routing: 7 services, 25 top files

Case types:

- `stammdaten_marktrollen_klaerfall` — Stammdaten-/Marktrollen-Klärfall: 25 signal files, maturity observed
- `messwert_edm_plausibilitaetsfall` — Messwert-/EDM-Plausibilitätsfall: 25 signal files, maturity observed
- `kunden_service_klaerfall` — Kunden-/Service-Klärfall: 25 signal files, maturity routable
- `netzanschluss_kapazitaets_klaerfall` — Netzanschluss-/Kapazitäts-Klärfall: 25 signal files, maturity observed
- `prognose_abweichungsfall` — Prognose-/Abweichungsfall: 25 signal files, maturity observed
- `redispatch_steuerbarkeits_readiness` — Redispatch-/Steuerbarkeits-Readiness: 25 signal files, maturity observed
- `waerme_gas_eog_szenariofall` — Wärme-/Gas-/EOG-Szenariofall: 25 signal files, maturity observed

## Coverage review candidates

- `services/agnes-bottleneck.service.js`
- `services/altdaten-assessment.service.js`
- `services/automatisierungsradar.service.js`
- `services/backup-orchestrator.service.js`
- `services/bess-screening.service.js`
- `services/capex-prioritization.service.js`
- `services/connection-rejection-evidence.service.js`
- `services/e2e-connection-check.service.js`
- `services/files.service.js`
- `services/flexibilitaetskosten-raster.service.js`
- `services/fnav-commercial-hedging.service.js`
- `services/gasnetz-waermeplanung.service.js`
- `services/ghost-asset-alert.service.js`
- `services/netzkoppelvertrag-workflow.service.js`
- `services/nkp-reporting.service.js`
- `services/rcs-rule-catalog.service.js`
- `services/regulatorische-entgeltlogik.service.js`
- `services/reinvest-signal.service.js`
- `services/reporting-governance.service.js`
- `services/shared-service-agents.service.js`
- `services/tenant-memory-policy.service.js`
- `services/tenant-quota.service.js`
- `services/vdmi-evidence.service.js`
- `services/vdmi-findings.service.js`
- `services/vdmi-governance-templates.service.js`
- `services/vdmi-human-override.service.js`
- `services/vdmi-portfolio-gatekeeping.service.js`
- `services/vdmi-spectator.service.js`
- `services/vnb-100-tage-assessment.service.js`

## Next Shepherd action

Use this summary as the current architecture directive input. Runtime refactors must be implemented in small branches after GitNexus impact analysis; domain abstraction artifacts are a working model and must not be treated as final regulatory truth.
