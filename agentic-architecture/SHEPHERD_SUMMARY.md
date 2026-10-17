# Shepherd Summary

Generated: 2026-10-17T09:13:15.684Z
Run: 20261017T091207Z
Branch: shepherd/runtime-refactor-20261017T091206Z
Fingerprint: 7875f23dbdf24a68df40bb9bee2c74108568ee198d722b9b00e42b0aecc6e6d1

## Current measurable surface

- Files: 2076
- Services: 164
- src JS files: 420
- Tests: 523
- Agentic files: 274
- OpenWebUI/ChatGPT files: 37
- Evidence/HITL files: 78
- Routing/capability files: 114
- Services without obvious direct filename-mapped test: 30

## Artifact state

- Operation capability index: present
- OpenAPI export: present
- llm.txt: present
- verify:agent-shapes script: present
- verify:open-webui script: present

## Top directories

- `tests`: 594 files
- `src`: 488 files
- `docs`: 411 files
- `services`: 200 files
- `scripts`: 89 files
- `tools`: 85 files
- `agentic-architecture`: 61 files
- `integrations`: 35 files
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
- Domain fingerprint: a7b82f57e3a3f2072ad21ce27078785d280cc972375b205b266260cffef8383a
- Candidate files: 1232
- Unclassified services: 0

Cluster counts:

- `casework-and-assistance` — Fallarbeit und Assistenz: 2 services, 25 top files
- `evidence-and-trust` — Evidence, Nachweis und Vertrauen: 23 services, 25 top files
- `mako-and-edm` — MaKo / EDM / Stammdaten: 8 services, 25 top files
- `grid-and-connection` — Netz, Anschluss und Kapazität: 49 services, 25 top files
- `forecast-and-market` — Prognose, Markt und Portfolio: 17 services, 25 top files
- `redispatch-and-controllability` — Redispatch, Steuerbarkeit und Flexibilität: 3 services, 25 top files
- `gas-heat-and-eog` — Gas, Wärme und EOG: 3 services, 25 top files
- `tenant-and-operation` — Tenant, Rollen und Betrieb: 52 services, 25 top files
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
- `services/project-upload.service.js`
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
