# §14a EnWG Policy — Controllable Devices

**Reference:** `src/domain-config.js` → `SECTION_14A_POLICY`

**Regulation:** BK6-22-300 (BNetzA Festlegung; effective Q3 2024)

§14a EnWG mandates emergency load-shedding ("Notfallabregelung") protocols for controllable appliances to protect grid stability. Cernion models these rules deterministically in ZNP capacity planning and `section14a-compliance-autopilot` recipe.

## Core Concept: Guaranteed Minimum Power

### Rule

Every controllable device must be restorable to at least:

$$P_{min} = 4.2 \text{ kW}$$

**Applies to:**
- Wallboxes (EV chargers)
- Heat pumps (including pool heating)
- Home battery storage (grid interaction)
- Industrial load-shifting equipment

**Cannot be reduced below 4.2 kW,** even during emergency grid balancing.

### Rationale

- Households need minimum power for essential heating/cooling/EV charging
- BNetzA safety threshold derived from winter heating demand analysis
- 4.2 kW ≈ typical 6 kW heat pump at 70% modulation floor

## Simultaneity Factor (g-Faktor) — Dynamic Diversity

### Problem

If **n** controllable units are dimmed simultaneously, not all reach their minimum 4.2 kW in reality—some "turn off" or reduce faster than others. **Diversity** reduces the aggregate minimum.

### BK6-22-300 Table

| **n** (units) | **g-factor** | **Total Min Power** |
|---|---|---|
| 1 | 1.00 | 4.2 kW |
| 2 | 0.85 | 4.2 + 1×0.85×4.2 = 7.77 kW |
| 3 | 0.75 | 4.2 + 2×0.75×4.2 = 10.5 kW |
| 4 | 0.70 | 4.2 + 3×0.70×4.2 = 12.96 kW |
| 5 | 0.65 | 4.2 + 4×0.65×4.2 = 15.12 kW |
| 6 | 0.60 | 4.2 + 5×0.60×4.2 = 17.4 kW |
| 9 | 0.45 | 4.2 + 8×0.45×4.2 = 19.32 kW |
| ≥10 | 0.45 | Asymptotic minimum |

### Formula

$$P_{min}(n) = 4.2 + (n-1) \times g(n) \times 4.2$$

**In kW, for n controllable units with diversity g(n).**

### Example: 4 Wallboxes in a Block

**Scenario:** Neighborhood with 4 new EV chargers connected to shared transformer.

**Calculation:**
- n = 4 → g = 0.70
- P_min = 4.2 + (4-1) × 0.70 × 4.2
- P_min = 4.2 + 8.82 = **12.96 kW**

**Interpretation:**
- During emergency demand-reduction, the transformer must **guarantee ≥12.96 kW** for the 4 wallboxes
- If cable capacity is 15 kW, dimming headroom = 15 − 12.96 = 2.04 kW (tight)
- If only 2 wallboxes: g=0.85 → P_min = 7.77 kW (14.23 kW headroom) ✓

## Comparative: Uncontrolled Heat Pumps

For reference, **uncontrolled** (non-§14a) heat pumps show:

| Condition | g-factor |
|-----------|----------|
| Winter (cold day) | 0.75 |
| Spring (mild) | 0.40 |

**Key insight:** §14a **control reduces** peak load compared to uncontrolled, justifying the 4.2 kW minimum. BNetzA uses this difference to evaluate cost-benefit of demand-response infrastructure.

## Exception Rules

### Maximum Continuous Dimming

- **Duration:** 120 minutes maximum
- **Recovery:** Must restore full power within 60 minutes after dimming ends
- **Frequency:** 5–6 events per year under normal grid conditions (emergency only)

**Implication:** §14a is NOT a continuous load-shifting tool (that's §14 or balancing markets); it's an emergency last resort.

## Recipe Integration

### `section14a-compliance-autopilot`

Workflow to detect compliance gaps and exceptions:

```javascript
{
  step: 1,
  service: 'nbp-monitor',
  action: 'nbp-monitor.snapshot',
  params: {
    bdewCode: null,
    lang: 'de',
  },
  description: 'Load NBP process backlog & §14a device inventory'
}

{
  step: 3,
  service: 'mastr-quality',
  action: 'mastr-quality.audit',
  description: 'Detect installations where controllability not yet registered in MaStR'
}
```

**Output:** Finding list with missing §14a device registrations → scheduling follow-up checks.

### `znp-flexible-nav-stresstest`

Uses §14a policy to project worst-case demand profile in ZNP:

```javascript
{
  step: 3,
  action: 'znp.addAssumption',
  params: {
    text: `§14a controllable load scenario: ${SECTION_14A_POLICY.minimumGuaranteedPower} kW
           min power + dynamic g-factor (n=4 → g=${SECTION_14A_POLICY.simultaneityFactorTable[4]}).`
  }
}
```

**Rationale:** Conservative assumption; ZNP layer 2 must accommodate minimum load even during emergency dimming.

## Compliance Checking

### Utility Perspective

1. **Inventory:** Count controllable devices (Wallbox, Heat Pump, Storage) per substation
2. **Capacity:** Verify distribution line/trafo capacity ≥ n × g(n) × 4.2 kW
3. **Control Chain:** Validate communication path (grid operator → device) + latency <2s
4. **Testing:** Annual functional test (demand-response drill @ g-factor) required by BNetzA

### Customer Perspective

- **Guarantee:** Even if §14a triggered, still receives ≥4.2 kW
- **Exception:** Medical life-support devices exempt (written notification required)
- **Tariff:** Grid operator may offer discount (€50–150/year) for demand-response participation
- **Reversion:** Can opt-out; reverts to standard tariff (no discount)

## Regulatory Timeline

| Date | Event |
|------|-------|
| **2024-Q3** | BK6-22-300 effective; grid operators must identify controllable devices |
| **2024–2025** | Phase 1: Wallbox/Storage inventory (mandatory) |
| **2025–2026** | Phase 2: Heat pump communication via SGMW (Steuerbox) deployment |
| **2026-06-01** | §42c Energy Sharing effective; overlaps with §14a compliance window |

## Related Assumptions

### Steuerbox Cost (SMGW + Control Hardware)

- **Device Cost:** €175 per installation
- **Installation:** €200–300 labor
- **Total:** €375–475 per meter
- **Typical ROI:** 4–6 years (via avoided grid expansion costs)

### Deployment Rate Forecast

- **2024:** ~5% controllable device penetration (early adopters)
- **2025:** ~15–20% (post-EEG customers + retrofits)
- **2026:** ~35–40% (mandatory for new connections)
- **2030:** ~60–70% (widespread adoption)

## Example: Planning a New Residential Block

**Development:** 30 single-family homes, each with wallbox + heat pump + PV (6 kWp).

**Baseline (uncontrolled):**
- Peak load = 30 × 4 kW (HP) + 30 × 3.7 kW (Wallbox 1-phase) = 231 kW
- Supply capacity needed: 300 kVA trafo + 2 km cable

**With §14a Control:**
- Effective peak = 30 × min(4.2 + (29×g)×4.2, 7.7) kW ≈ 145 kW (conservative)
- Supply capacity: 160 kVA trafo + 1 km cable (partial deferral)
- **Savings:** €150k cable cost − €175×30 steuerboxes = €150k − €5.25k = **€145k net deferral**

---

## References

- **BK6-22-300:** https://www.bundesnetzagentur.de (BNetzA Festlegung, Oct 2023)
- **§14a EnWG:** Demand-response for grid stability (German Federal Act)
- **Cernion Domain Config:** `src/domain-config.js` SECTION_14A_POLICY

---

**See also:** [CAPEX Economics](02-CAPEX-ECONOMICS.md) | [§42c Heuristics](04-SECTION42C-HEURISTICS.md) | [Hotspot Detection](01-HOTSPOT-DETECTION.md)
