# Function model lineage — operation action resolution

Baseline: main at `f582216537cab3b96fa78ff3062ed48f5d87ee1d`, including merged #703 and its persistent lineage implementation.

Added IDs: 8; retired IDs: 6; unchanged ID and membership: 105; capability moves: 19.

Grouping logic, catalog and parameters are unchanged from main. The upstream lineage implementation preserves IDs using capability overlap.

Generated transition statistics:

```json
{
  "same": 105,
  "merged": 7,
  "split": 9,
  "retired": 6,
  "new": 8,
  "previousSourceHash": "5f523aa56cfcf570931a1aa6ab87562d206a89e594a67f88a66cbec6f60a257a"
}
```

| Previous function | Successors |
| --- | --- |
| `fn-a2mdm-decision-object-meaning-preservation` | `fn-a2mdm-decision-object-meaning-preservation`, `fn-interconnection-release-file` |
| `fn-automation-requirements-decision-value` | `fn-automation-requirements-decision-value` |
| `fn-budget-waterfall-governance` | `fn-budget-waterfall-governance`, `fn-gas-grid-transformation-asset-cockpit` |
| `fn-cls-digital-twin-compliance-gate` | `fn-budget-waterfall-governance`, `fn-dr-readiness-evidence-gate`, `fn-imsys-taf2-compliance-status` |
| `fn-decision-readiness-matrix` | `fn-decision-readiness-matrix`, `fn-leadership-delta-cockpit` |
| `fn-evidence-freshness-guard` | `fn-evidence-freshness-guard` |
| `fn-gas-transformation-dependency-map` | `fn-gas-transformation-dependency-map`, `fn-znp-portfolio-assessment` |
| `fn-imsys-schedule-value-chain-readiness` | `fn-automation-requirements-decision-value`, `fn-regulatory-change-simulator-readiness` |
| `fn-interconnection-release-file` | `fn-interconnection-release-file` |
| `fn-load-profile-stream-monitor` | `fn-load-profile-stream-monitor` |
| `fn-off-balancing-metering-pruefmatrix` | `fn-budget-waterfall-governance`, `fn-imsys-taf2-compliance-status` |
| `fn-process-sensitization-readiness-map` | `fn-schedule-management-governance-roadmap`, `fn-vdmi-asset-validation-governance` |
| `fn-redispatch-call-data-quality-gate` | `fn-load-profile-stream-monitor` |
| `fn-stadtwerk-mauer-e2e-process-demo` | `fn-stadtwerk-mauer-e2e-process-demo`, `fn-stadtwerk-mauer-sandbox-runtime` |
| `fn-vdmi-asset-validation-governance` | `fn-vdmi-asset-validation-governance` |
| `fn-vnb-delta-signal-classifier` | `fn-evidence-freshness-guard` |

| Capability | Previous function | New function |
| --- | --- | --- |
| `a2mdm_decision_object_meaning_preservation` | `fn-a2mdm-decision-object-meaning-preservation` | `fn-interconnection-release-file` |
| `cls_digital_twin_compliance_gate` | `fn-cls-digital-twin-compliance-gate` | `fn-budget-waterfall-governance` |
| `dr_readiness_evidence_gate` | `fn-cls-digital-twin-compliance-gate` | `fn-dr-readiness-evidence-gate` |
| `gas_grid_transformation_asset_cockpit` | `fn-budget-waterfall-governance` | `fn-gas-grid-transformation-asset-cockpit` |
| `imsys_schedule_value_chain_readiness` | `fn-imsys-schedule-value-chain-readiness` | `fn-automation-requirements-decision-value` |
| `imsys_taf2_compliance_status` | `fn-cls-digital-twin-compliance-gate` | `fn-imsys-taf2-compliance-status` |
| `leadership_delta_cockpit` | `fn-decision-readiness-matrix` | `fn-leadership-delta-cockpit` |
| `no_regret_measure_definition_gate` | `fn-budget-waterfall-governance` | `fn-gas-grid-transformation-asset-cockpit` |
| `off_balancing_metering_pruefmatrix` | `fn-off-balancing-metering-pruefmatrix` | `fn-budget-waterfall-governance` |
| `process_sensitization_readiness_map` | `fn-process-sensitization-readiness-map` | `fn-vdmi-asset-validation-governance` |
| `redispatch_call_data_quality_gate` | `fn-redispatch-call-data-quality-gate` | `fn-load-profile-stream-monitor` |
| `regulatory_change_simulator_readiness` | `fn-imsys-schedule-value-chain-readiness` | `fn-regulatory-change-simulator-readiness` |
| `schedule_management_governance_roadmap` | `fn-process-sensitization-readiness-map` | `fn-schedule-management-governance-roadmap` |
| `stadtwerk_mauer_sandbox_runtime` | `fn-stadtwerk-mauer-e2e-process-demo` | `fn-stadtwerk-mauer-sandbox-runtime` |
| `transformation_financing_scenario_view` | `fn-off-balancing-metering-pruefmatrix` | `fn-budget-waterfall-governance` |
| `vnb_delta_signal_classifier` | `fn-vnb-delta-signal-classifier` | `fn-evidence-freshness-guard` |
| `zaehlpark_finanzierung_szenario_cockpit` | `fn-off-balancing-metering-pruefmatrix` | `fn-imsys-taf2-compliance-status` |
| `znp_portfolio_assessment` | `fn-gas-transformation-dependency-map` | `fn-znp-portfolio-assessment` |
| `znp_production_readiness_evidence_gate` | `fn-gas-transformation-dependency-map` | `fn-znp-portfolio-assessment` |
