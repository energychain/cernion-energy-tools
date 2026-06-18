# Hotspot Detection Thresholds

**Reference:** `src/domain-config.js` → `HOTSPOT_THRESHOLDS`

Grid operators use two-tier alert systems to detect and prioritize network congestion. Cernion implements standardized thresholds aligned with BNetzA requirements and STROMDAO Netze special cases.

## Thermal Loading (Kabel & Transformatoren)

### Alert Levels

| Threshold | Level | Action | Use Case |
|-----------|-------|--------|----------|
| **≤80%** | Normal | None | Standard operation |
| **80–100%** | Warning | Monitor & plan | Pre-alert; start feasibility studies |
| **>100%** | Hard Alert | Emergency | Network congestion; Redispatch/curtailment triggered |

### Technical Details

- **Unit:** Percent utilization (%)
- **Applies to:** Cables, transformers, interconnections
- **Trigger:** Simulation edge exceeds threshold during load flow analysis
- **Typical Timeline:** Warning alerts trigger 6–12 months before critical overload

### Example

STROMDAO Netze operates 110 kV cable with 95 MW capacity. At 76 MW load:
- Utilization = 76/95 = 80% → Warning issued
- Recommendation: Plan alternative routing or capacity expansion
- Target: Complete work before 95 MW threshold (100% utilization)

## Voltage Band Compliance (Niederspannung / LV)

### Tolerance Band

The legal tolerance band for LV (household voltage) is:

$$V_{min} = V_{nom} - 10\% \quad | \quad V_{max} = V_{nom} + 10\%$$

In per-unit notation:
- **Lower bound:** −0.10 p.u.
- **Upper bound:** +0.10 p.u.

### Alert Criterion

Cernion flags a voltage violation when:
- Grid simulation predicts any node voltage **outside** the tolerance band
- Most common: End of long, PV-heavy stub lines (Stichleitungen) in rural areas
- Typical cause: High PV injection → voltage rise; line reactance compounds effect

### Real-World Pattern

**Scenario:** Rural distribution line with 15 single-family homes (50 kW peak) + 8 rooftop PV systems (6 kWp each = 48 kWp total).

- **Morning @ 11:30 (clear sky):** PV injects 40 kW → voltage +9% at line end (within bounds)
- **Noon (peak PV):** PV injects 48 kW → voltage +12% at line end → **Violation!**
- **Solution:** Install rONT (€5,500) to regulate voltage or upstream reconductor

### Implementation Example

```javascript
// From vnb-monitor service
const voltageMin = nominalVoltage * (1 - 0.10);  // −10%
const voltageMax = nominalVoltage * (1 + 0.10);  // +10%

if (simulatedVoltage < voltageMin || simulatedVoltage > voltageMax) {
  alerts.push({
    type: 'voltage_violation',
    severity: 'warning',
    location: nodeId,
    currentVoltage: simulatedVoltage,
    lowerBound: voltageMin,
    upperBound: voltageMax,
  });
}
```

## STROMDAO Netze N-1 Security Margin

### Special Case: Interconnection Capacity

**Grid Operator:** STROMDAO Netze (Taunuswerke, Mittelspannung/Hochspannung level)

**Hard Threshold:** 81 MVA

**Criterion:** N-1-safe operating margin
→ Network must remain stable if any single major component fails

### Application

- **When:** Evaluating major substation upgrades or new 30+ MW wind projects
- **Decision:** If projected load + new generation ≥ 81 MVA, trigger NEST process
- **NEST Justification:** Must prove no alternative routing or cost-effective optimization exists

### Example: 50 MW Wind Farm Connection

1. Current interconnection flow: 72 MVA
2. Wind farm adds: +8 MVA capacity requirement
3. Total: 72 + 8 = 80 MVA ✓ (below 81 MVA threshold)
4. Decision: **Grant without N-1 review**

If wind had been 10 MVA:
- Total: 72 + 10 = 82 MVA ✗ (exceeds 81 MVA)
- Decision: **Requires NEST justification** (prove expansion vs. alternatives)

## Recipe Usage

### `cybergrid-counter-location-scout`

Uses `HOTSPOT_THRESHOLDS.thermal` to filter substations with active warnings:

```javascript
{
  step: 1,
  service: 'vnb-monitor',
  action: 'vnb-monitor.alerts',
  params: {
    bdewCode: null,
    thermalWarningLevel: 0.80,  // From domain-config
    thermalAlertLevel: 1.00,    // From domain-config
  }
}
```

**Output:** List of stressed substations → Step 2 finds optimal storage co-location sites.

### `section14a-compliance-autopilot`

Correlates voltage & thermal alerts with controllable device inventory to prioritize §14a deployments.

## Regulatory References

- **DIN EN 50160:** Voltage characteristics in public electricity supply networks
- **TAR Strom (ATREG):** German network tariff regulation → voltage tolerance ±10%
- **BNetzA Festlegung BK6-22-300:** Emergency load-shedding criteria

## Monitoring Workflow

1. **Real-Time:** Grid simulation every 15 min; compare to thresholds
2. **Weekly:** Aggregate violations; flag chronic hotspots
3. **Monthly:** Root-cause analysis (renewable forecast, demand surge, etc.)
4. **Quarterly:** CAPEX planning trigger (rONT vs. cable expansion)

---

**See also:** [CAPEX Assumptions](02-CAPEX-ECONOMICS.md) for cost trade-offs
