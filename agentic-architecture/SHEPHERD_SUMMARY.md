# Shepherd Summary

Generated: 2026-10-10T07:22:50.518Z
Run: 20261010T072152Z
Branch: shepherd/runtime-refactor-20261010T072152Z
Fingerprint: 3ca044bd30acbd0baec9c5690765645037a205e685463973211a789acfc5ca82

## Current measurable surface

- Files: 1309
- Services: 144
- src JS files: 212
- Tests: 330
- Agentic files: 223
- OpenWebUI/ChatGPT files: 25
- Evidence/HITL files: 67
- Routing/capability files: 51
- Services without obvious direct filename-mapped test: 26

## Artifact state

- Operation capability index: present
- OpenAPI export: present
- llm.txt: present
- verify:agent-shapes script: present
- verify:open-webui script: present

## Top directories

- `tests`: 373 files
- `docs`: 298 files
- `src`: 259 files
- `services`: 180 files
- `agentic-architecture`: 46 files
- `.claude`: 26 files
- `integrations`: 26 files
- `scripts`: 23 files
- `.github`: 9 files
- `feedback`: 8 files
- `.vscode`: 5 files
- `examples`: 3 files
- `tools`: 3 files
- `fixtures_parallel`: 2 files
- `fixtures_real`: 2 files
- `reports`: 2 files
- `.copilotignore`: 1 files
- `.editorconfig`: 1 files
- `.env.example`: 1 files
- `.eslintrc.hygiene.json`: 1 files

## Domain abstraction

- Domain abstraction: present
- Domain fingerprint: a1215df76456064bfe9dece399d6ccff4e6286526f3dd9864b43baf8bfd7b0fb
- Candidate files: 841
- Unclassified services: 0

Cluster counts:

- `casework-and-assistance` — Fallarbeit und Assistenz: 1 services, 25 top files
- `evidence-and-trust` — Evidence, Nachweis und Vertrauen: 23 services, 25 top files
- `mako-and-edm` — MaKo / EDM / Stammdaten: 8 services, 25 top files
- `grid-and-connection` — Netz, Anschluss und Kapazität: 47 services, 25 top files
- `forecast-and-market` — Prognose, Markt und Portfolio: 15 services, 25 top files
- `redispatch-and-controllability` — Redispatch, Steuerbarkeit und Flexibilität: 3 services, 25 top files
- `gas-heat-and-eog` — Gas, Wärme und EOG: 3 services, 25 top files
- `tenant-and-operation` — Tenant, Rollen und Betrieb: 37 services, 25 top files
- `openwebui-agentic-routing` — OpenWebUI und agentisches Routing: 7 services, 25 top files

Case types:

- `stammdaten_marktrollen_klaerfall` — Stammdaten-/Marktrollen-Klärfall: 25 signal files, maturity observed
- `messwert_edm_plausibilitaetsfall` — Messwert-/EDM-Plausibilitätsfall: 25 signal files, maturity observed
- `kunden_service_klaerfall` — Kunden-/Service-Klärfall: 25 signal files, maturity draft

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
