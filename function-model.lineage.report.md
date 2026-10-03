# Function model lineage — operation action resolution

Baseline: `e9962d1` (PR #703); target: the regenerated `function-model.json` in this PR.

Method: exact intersections of unchanged capability IDs. Every previous function maps to all new functions containing any of its capabilities. Equal IDs may have changed membership; IDs alone do not establish equivalent scope.

Before: 121 functions. After: 123. Added IDs: 9; retired IDs: 7; unchanged ID and membership: 105.

Catalog, grouping parameters and projection logic are unchanged. Resolved operations and more complete static declarations change the evidence supplied to the existing algorithm.

## Added IDs

- `fn-coordination-meaning-preservation-profile`
- `fn-dr-readiness-evidence-gate`
- `fn-gas-grid-transformation-asset-cockpit`
- `fn-imsys-taf2-compliance-status`
- `fn-leadership-delta-cockpit`
- `fn-regulatory-change-simulator-readiness`
- `fn-schedule-management-governance-roadmap`
- `fn-stadtwerk-mauer-sandbox-runtime`
- `fn-znp-portfolio-assessment`

## Retired IDs

- `fn-cls-digital-twin-compliance-gate`
- `fn-imsys-schedule-value-chain-readiness`
- `fn-interconnection-release-file`
- `fn-off-balancing-metering-pruefmatrix`
- `fn-redispatch-call-data-quality-gate`
- `fn-vdmi-asset-validation-governance`
- `fn-vnb-delta-signal-classifier`

## Changed membership / successors

| Previous function | Successors |
| --- | --- |
| `fn-a2mdm-decision-object-meaning-preservation` | `fn-a2mdm-decision-object-meaning-preservation`, `fn-coordination-meaning-preservation-profile` |
| `fn-automation-requirements-decision-value` | `fn-automation-requirements-decision-value` |
| `fn-budget-waterfall-governance` | `fn-budget-waterfall-governance`, `fn-gas-grid-transformation-asset-cockpit` |
| `fn-cls-digital-twin-compliance-gate` | `fn-budget-waterfall-governance`, `fn-dr-readiness-evidence-gate`, `fn-imsys-taf2-compliance-status` |
| `fn-decision-readiness-matrix` | `fn-decision-readiness-matrix`, `fn-leadership-delta-cockpit` |
| `fn-evidence-freshness-guard` | `fn-evidence-freshness-guard` |
| `fn-gas-transformation-dependency-map` | `fn-gas-transformation-dependency-map`, `fn-znp-portfolio-assessment` |
| `fn-imsys-schedule-value-chain-readiness` | `fn-automation-requirements-decision-value`, `fn-regulatory-change-simulator-readiness` |
| `fn-interconnection-release-file` | `fn-a2mdm-decision-object-meaning-preservation` |
| `fn-load-profile-stream-monitor` | `fn-load-profile-stream-monitor` |
| `fn-off-balancing-metering-pruefmatrix` | `fn-budget-waterfall-governance`, `fn-imsys-taf2-compliance-status` |
| `fn-process-sensitization-readiness-map` | `fn-process-sensitization-readiness-map`, `fn-schedule-management-governance-roadmap` |
| `fn-redispatch-call-data-quality-gate` | `fn-load-profile-stream-monitor` |
| `fn-stadtwerk-mauer-e2e-process-demo` | `fn-stadtwerk-mauer-e2e-process-demo`, `fn-stadtwerk-mauer-sandbox-runtime` |
| `fn-vdmi-asset-validation-governance` | `fn-process-sensitization-readiness-map` |
| `fn-vnb-delta-signal-classifier` | `fn-evidence-freshness-guard` |

## Capability moves

| Capability | Previous function | New function |
| --- | --- | --- |
| `cls_digital_twin_compliance_gate` | `fn-cls-digital-twin-compliance-gate` | `fn-budget-waterfall-governance` |
| `coordination_meaning_preservation_profile` | `fn-a2mdm-decision-object-meaning-preservation` | `fn-coordination-meaning-preservation-profile` |
| `dr_readiness_evidence_gate` | `fn-cls-digital-twin-compliance-gate` | `fn-dr-readiness-evidence-gate` |
| `gas_grid_transformation_asset_cockpit` | `fn-budget-waterfall-governance` | `fn-gas-grid-transformation-asset-cockpit` |
| `imsys_schedule_value_chain_readiness` | `fn-imsys-schedule-value-chain-readiness` | `fn-automation-requirements-decision-value` |
| `imsys_taf2_compliance_status` | `fn-cls-digital-twin-compliance-gate` | `fn-imsys-taf2-compliance-status` |
| `interconnection_release_file` | `fn-interconnection-release-file` | `fn-a2mdm-decision-object-meaning-preservation` |
| `leadership_delta_cockpit` | `fn-decision-readiness-matrix` | `fn-leadership-delta-cockpit` |
| `no_regret_measure_definition_gate` | `fn-budget-waterfall-governance` | `fn-gas-grid-transformation-asset-cockpit` |
| `off_balancing_metering_pruefmatrix` | `fn-off-balancing-metering-pruefmatrix` | `fn-budget-waterfall-governance` |
| `redispatch_call_data_quality_gate` | `fn-redispatch-call-data-quality-gate` | `fn-load-profile-stream-monitor` |
| `redispatch_rcs_special_case_governance` | `fn-a2mdm-decision-object-meaning-preservation` | `fn-coordination-meaning-preservation-profile` |
| `regulatory_change_simulator_readiness` | `fn-imsys-schedule-value-chain-readiness` | `fn-regulatory-change-simulator-readiness` |
| `schedule_management_governance_roadmap` | `fn-process-sensitization-readiness-map` | `fn-schedule-management-governance-roadmap` |
| `stadtwerk_mauer_sandbox_runtime` | `fn-stadtwerk-mauer-e2e-process-demo` | `fn-stadtwerk-mauer-sandbox-runtime` |
| `transformation_financing_scenario_view` | `fn-off-balancing-metering-pruefmatrix` | `fn-budget-waterfall-governance` |
| `vdmi_asset_validation_governance` | `fn-vdmi-asset-validation-governance` | `fn-process-sensitization-readiness-map` |
| `vdmi_grid_connection_decision_governance` | `fn-vdmi-asset-validation-governance` | `fn-process-sensitization-readiness-map` |
| `vdmi_role_boundary_governance` | `fn-vdmi-asset-validation-governance` | `fn-process-sensitization-readiness-map` |
| `vnb_delta_signal_classifier` | `fn-vnb-delta-signal-classifier` | `fn-evidence-freshness-guard` |
| `zaehlpark_finanzierung_szenario_cockpit` | `fn-off-balancing-metering-pruefmatrix` | `fn-imsys-taf2-compliance-status` |
| `znp_portfolio_assessment` | `fn-gas-transformation-dependency-map` | `fn-znp-portfolio-assessment` |
| `znp_production_readiness_evidence_gate` | `fn-gas-transformation-dependency-map` | `fn-znp-portfolio-assessment` |

Total capability moves: 23; missing or new capability IDs: 0.
