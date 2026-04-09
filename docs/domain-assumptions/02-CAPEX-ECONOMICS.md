# CAPEX Economics & Investment Assumptions

**Reference:** `src/domain-config.js` → `CAPEX_ASSUMPTIONS`

Network operators face a "NOVA trilogy" investment decision at every hotspot: **Optimize → Reinforce → Expand**.

Cernion's CFO Module provides standardized cost templates and impact factors to quantify trade-offs in 10–20 year DCF models.

## Regelbare Ortsnetztrafo (rONT) — Smart Voltage Regulator

### Cost & Impact

| Parameter | Value | Unit |
|-----------|-------|------|
| **Incremental Cost** | €5,500 | EUR per device |
| **Voltage Capacity Factor** | 2.0–4.0× | (conservative: 2.0×) |
| **Thermal Capacity Factor** | 1.0× | (no thermal benefit) |
| **Typical ROI** | 2–3 years | In PV-dense NS areas |

### What rONT Does

- **Solves:** Voltage band violations (±10% compliance)
- **How:** Tap-changer automatically raises/lowers secondary winding voltage under PV injection
- **Does NOT solve:** Thermal overload (cable must still handle peak current)

### Real-World Economics

**Scenario:** Rural distribution line, 50 kW household peak + 48 kWp PV → voltage violations.

**Option A: Cable Reconductor (Thermal + Voltage Fix)**
- Cost: €150k/km × 2 km = €300,000
- Timeline: 3–6 months design + 2–3 months construction
- ROI: 15–20 years
- Benefit: Permanent capacity increase; future-proof for additional PV/EV

**Option B: rONT (Voltage Fix Only)**
- Cost: €5,500 (+ €500 install labor)
- Timeline: 1 week procurement + 1 day install
- ROI: 2–3 years (breakeven via avoided reinforcement costs)
- Benefit: Immediate relief; cheap to defer cable work

**Decision Matrix:**
- **If only voltage violation:** rONT ✓ (high ROIC)
- **If thermal OR voltage:** Cable ✓ (systemic relief)
- **If both + growth forecast:** rONT now + cable in 5 years (staged CAPEX)

### Implementation in ZNP

```javascript
// From nova-capex-defender recipe
params: {
  text: `rONT deployment (€${CAPEX_ASSUMPTIONS.rONT.incrementalCost},
         ${CAPEX_ASSUMPTIONS.rONT.spannungCapacityFactor}x voltage capacity)
         vs. cable expansion (€${CAPEX_ASSUMPTIONS.cable.costPerKilometer.typical}/km).`
}
```

## Cable (Tiefbau) — Underground Network Expansion

### Cost Range

| Scenario | Unit Cost | Total (1 km) |
|----------|-----------|--------------|
| **Simple rural trench** | €100/m | €100,000 |
| **Urban mixed (standard)** | €150/m | €150,000 |
| **Complex (protected areas)** | €300/m | €300,000 |

### Inclusions

- Cable material (VPE-insulated, appropriate voltage class)
- Trenching / boring
- Joint terminations
- Backfilling & surface restoration
- Testing & commissioning

### NOT Included

- New substations (separate cost)
- Transformer upgrades
- Control system modifications
- Environmental permits (quoted separately)

### Impact Assessment

| Impact | Thermal | Voltage |
|--------|---------|---------|
| Larger conductor | +30–50% capacity | Minimal (-1–2%) |
| Parallel run | +50–100% | Minimal |
| Voltage benefit | — | +5–10% (lower impedance) |

**Typical Use:** Thermal bottleneck is primary driver; voltage improvement is secondary benefit.

### Timeline & Constraints

- **Design:** 1–2 months (environmental permits, routing)
- **Construction:** 2–4 months (crew size, seasonal factors)
- **Testing:** 2–4 weeks
- **Total:** 5–8 months (expedited to 3–4 months possible with premium scheduling)

## Transformer Upgrades

### Capacity Increases

#### 400 → 630 kVA

| Parameter | Range | Typical |
|-----------|-------|---------|
| Cost | €13k–18k | €15,500 |
| Impact | +58% capacity | Linear scaling |
| Install time | 3–5 days | (requires brief de-energization) |

**Use:** Intermediate step when cable expansion not yet justified; allows +50% headroom.

#### New Ortsnetzstation (ONS)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Cost | €50k–120k | Includes civil, electrical, controls |
| Timeline | 3–6 months | Design + permitting + construction |
| Capacity | 400–630 kVA standard | Configurable |

**Use:** Area growth (e.g., new housing development) exceeds single-trafo headroom; distributed supply preferred.

## Combined Scenarios (CFO Module)

### Scenario 1: rONT Only

- **Total Cost:** €5,500
- **Timeline:** 2–3 months
- **Outcome:** Voltage violations eliminated; thermal capacity unchanged
- **Best For:** PV-rich rural lines without thermal issues

### Scenario 2: 1 km Cable Expansion

- **Total Cost:** €150,000
- **Timeline:** 5–8 months (design + construction + testing)
- **Outcome:** +40% thermal capacity; +5% voltage benefit; systemic relief
- **Best For:** Thermal + voltage bottleneck; area growth

### Scenario 3: Trafo 400→630 kVA

- **Total Cost:** €15,500
- **Timeline:** 1–2 months (expedited if transformer in stock)
- **Outcome:** +58% thermal capacity; ~+3% voltage improvement
- **Best For:** Interim growth relief (≤3 years); defer cable expansion

### Scenario 4: Staged (rONT + Cable Deferred)

- **Year 0:** rONT €5,500 → voltage relief
- **Year 5:** Cable €150k (re-evaluated growth scenarios at that time)
- **Total Net:** ~€155.5k over 10 years (net present value ~€142k @ 3% discount)
- **Best For:** Uncertain growth; maximize flexibility

## NPV & Payback Illustration

### Example: 50 kW Peak Household + 30 kWp PV, Voltage Violation

```
Scenario A (Do Nothing):
  - Year 1–2: Voltage violations; customer complaints
  - Year 3: Forced cable expansion (emergency premium +20%)
  - Cost: €180k (emergency markup) + 3 months outage risk
  - NPV: ~€160k

Scenario B (rONT Immediate):
  - Year 0: €5.5k rONT install
  - Year 5–10: Growth exceeds capacity → cable still needed
  - Year 6: €150k cable (planned, no premium)
  - Cost: €5.5k + €150k = €155.5k
  - NPV: ~€142k (saves ~€18k + avoids emergency risk)
  - Payback: Positive in 2–3 years (avoided expansion cost deferral)
```

## Recipe Usage

### `nova-capex-defender`

Compares before/after g-factor with rONT assumption to quantify deferral:

```javascript
{
  step: 2,
  action: 'znp.addAssumption',
  params: {
    text: `rONT deployment (€${CAPEX_ASSUMPTIONS.rONT.incrementalCost},
            ${CAPEX_ASSUMPTIONS.rONT.spannungCapacityFactor}x voltage capacity)
            to defer cable expansion (€${CAPEX_ASSUMPTIONS.cable.costPerKilometer.typical}/km).`
  }
}
```

**Output:** ZNP layer simulation with & without rONT → CFO compares NPV of both paths.

### `znp-flexible-nav-stresstest`

Uses cable cost as baseline assumption for comparison with §14a demand flexibility scenario.

## Regulatory & Market Context

### BNetzA Cost Allocation (§110 EnWG)

Network operators may recover reasonable CAPEX through tariff regulation (ATREG model). Key constraints:

1. **Efficiency Requirement:** Choice between alternatives must be cost-minimizing
2. **Cost Scrutiny:** BNetzA audits major projects; must justify cable expansion vs. rONT/storage
3. **Lead Time:** Tariff impacts realized 2–3 years after project completion

### Market Evolution

- **rONT prices:** Declining (€5–6k → €4–5k expected in 2027)
- **Cable costs:** Flat to +2% annually (wage/material inflation)
- **Inverter flexibility:** Storage + §14a demand-side offers competing alternative to rONT

---

## References

- **Cernion CFO Module:** `src/domain-config.js` CAPEX_ASSUMPTIONS
- **BNetzA ATREG:** https://www.bundesnetzagentur.de (tariff regulation base)
- **IEEE 1547:** DG Interconnection Standard (voltage/thermal bounds)

---

**See also:** [Hotspot Detection](01-HOTSPOT-DETECTION.md) | [§14a Policy](03-SECTION14A-POLICY.md) | [§42c Heuristics](04-SECTION42C-HEURISTICS.md)
