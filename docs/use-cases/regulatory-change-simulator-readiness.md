# Regulatory Change Simulator Readiness

Issue #193 is implemented as a read-only readiness/evidence gate, not as a regulatory simulation engine. The first slice answers whether an upcoming regulatory billing, EEG, or refinancing mechanism has enough data, process, market-communication, and audit evidence to be simulated safely.

The dossier-safe action is `dashboard-api.regulatoryChangeReadinessStatus`, exposed through `GET /api/dashboard/regulatory-change-readiness`. It accepts a contract around `changeId`, `effectiveDate`, `mechanismType`, affected systems, dictionary version, source datapoints, interval coverage, master-data status, substitute-value policy, MaKo cases, operator declaration, billing-rule reference, audit trail, and test-case-pack status.

## Source Actions

The slice references existing platform sources only:

- `datasource-registry.get` for dictionary and field semantics
- `datapoint.health` / `datapoint.validateSnapshot` for source datapoints
- `mastr-quality.audit` for master-data quality
- `edm-validation.validate` / `mscons-import.import` for interval profile and EDM/MSCONS readiness
- `dashboard-api.marketCommunicationEvidenceChainStatus` for MaKo evidence context
- `settlement.readiness` as a read-only billing-rule reference
- `vdmi.dossier` and `presentation.generate` for evidence ownership and test-case presentation

## Non-Goals

This slice does not implement legal interpretation, a new regulatory rule engine, settlement or billing release, MaKo dispatch, HITL task creation, external connectors, production data pulls, Personal Agent hardcoding, or broad cockpit UI.

## Example

```bash
curl -s 'http://localhost:3900/api/dashboard/regulatory-change-readiness?changeId=reg-change:eeg-2027&effectiveDate=2027-01-01&mechanismType=EEG&dictionaryVersion=dd-v1&sourceDatapoints=dp-1,dp-2&intervalCoverage=complete&masterDataStatus=usable&substituteValuePolicy=approved&makoCases=utilmd-special,billing-edge&operatorDeclarationStatus=available&billingRuleReference=eeg-rule-v1&auditTrailStatus=auditable&testCasePackStatus=generated'
```

The response returns a deterministic readiness status, missing evidence, positive follow-ups, generated test-case requirements, source evidence, and explicit `notCalled` guards for settlement, billing, MaKo dispatch, HITL, external connectors, and Personal Agent shortcuts.
