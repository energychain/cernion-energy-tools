# Shepherd Summary

Generated: 2026-10-11T01:32:48.589Z
Run: 20261011T013115Z
Branch: shepherd/runtime-refactor-20261011T013114Z
Fingerprint: bf6f6812134129cf50a04afe789a632ff55bfaa4e01a4ee139837af932d57195

## Current measurable surface

- Files: 1834
- Services: 157
- src JS files: 348
- Tests: 459
- Agentic files: 258
- OpenWebUI/ChatGPT files: 29
- Evidence/HITL files: 74
- Routing/capability files: 88
- Services without obvious direct filename-mapped test: 27

## Artifact state

- Operation capability index: present
- OpenAPI export: present
- llm.txt: present
- verify:agent-shapes script: present
- verify:open-webui script: present

## Top directories

- `tests`: 521 files
- `src`: 410 files
- `docs`: 371 files
- `services`: 193 files
- `tools`: 85 files
- `scripts`: 61 files
- `agentic-architecture`: 53 files
- `integrations`: 27 files
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
- Domain fingerprint: 40e5d70e9edb47e576fb0dcab3ddd00dd35b6a0c60de6bc131e730ada91d4b05
- Candidate files: 1095
- Unclassified services: 0

Cluster counts:

- `casework-and-assistance` — Fallarbeit und Assistenz: 2 services, 25 top files
- `evidence-and-trust` — Evidence, Nachweis und Vertrauen: 23 services, 25 top files
- `mako-and-edm` — MaKo / EDM / Stammdaten: 8 services, 25 top files
- `grid-and-connection` — Netz, Anschluss und Kapazität: 46 services, 25 top files
- `forecast-and-market` — Prognose, Markt und Portfolio: 15 services, 25 top files
- `redispatch-and-controllability` — Redispatch, Steuerbarkeit und Flexibilität: 3 services, 25 top files
- `gas-heat-and-eog` — Gas, Wärme und EOG: 3 services, 25 top files
- `tenant-and-operation` — Tenant, Rollen und Betrieb: 50 services, 25 top files
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
