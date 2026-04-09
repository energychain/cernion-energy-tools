# Domain Assumptions & Constants Reference

This directory documents all domain-specific operational assumptions, regulatory policies, and economic parameters used by Cernion energy market services.

**Implementation:** `src/domain-config.js` (code-managed, git-tracked)

---

## Quick Navigation

### 1. [Hotspot Detection Thresholds](01-HOTSPOT-DETECTION.md)
Grid congestion alerts and emergency protocols.

- **Thermal loading:** 80% warning, 100% hard alert
- **Voltage band:** ±10% tolerance (LV)
- **N-1 security:** TWL Netze 81 MVA case study

**Used by:** `vnb-monitor`, `cybergrid-counter-location-scout`, `mastr-quality`

### 2. [CAPEX Economics & Investment Assumptions](02-CAPEX-ECONOMICS.md)
Grid expansion alternatives and cost-benefit framework.

- **rONT (Regelbare Ortsnetztrafo):** €5,500 incremental, 2.0–4.0× voltage capacity
- **Cable (Tiefbau):** €100–300/m (€100k–300k/km)
- **Trafo upgrades:** €13k–18k (400→630 kVA); €50k–120k (new ONS)
- **Staged scenarios:** NPV modeling for NOVA trilogy

**Used by:** `znp`, `nova-capex-defender`, CFO decision templates

### 3. [§14a EnWG Policy](03-SECTION14A-POLICY.md)
Controllable load regulation and emergency dimming rules.

- **Minimum guaranteed power:** 4.2 kW
- **Dynamic g-factor:** Table for n=1..∞ devices
- **Formula:** $P_{min}(n) = 4.2 + (n-1) \times g(n) \times 4.2$ kW
- **Compliance:** Max 120 min dimming, recovery within 60 min

**Used by:** `section14a-compliance-autopilot`, `znp-flexible-nav-stresstest`, NBP/VNB monitoring

### 4. [§42c EnWG — Energy Sharing Heuristics](04-SECTION42C-HEURISTICS.md)
Community renewable generation screening and regulatory eligibility.

- **Spatial clustering:** 500 m radius, ≥30 kWp generator
- **Diversity factor:** −15–20% peak for mixed residential+commercial
- **Regulatory:** Direktvermarktung mandatory, EEG incompatible, §20 service provider required
- **Effective date:** 2026-06-01

**Used by:** `energy-sharing-42c-radar`, `energy-sharing.validate`, community planning

---

## Integration with Services & Recipes

### Service-Level Usage

```javascript
// Anywhere in Cernion:
const { HOTSPOT_THRESHOLDS, CAPEX_ASSUMPTIONS, SECTION_14A_POLICY, SECTION_42C_HEURISTICS }
  = require('./domain-config');

// Example: Check voltage compliance
if (voltage < nominalVoltage * (1 - HOTSPOT_THRESHOLDS.voltage.toleranceBand.min)) {
  alert('Voltage violation: below lower bound');
}

// Example: Calculate §14a minimum power
const nUnits = 4;
const pMin = SECTION_14A_POLICY.minimumGuaranteedPower +
             (nUnits - 1) * SECTION_14A_POLICY.simultaneityFactorTable[nUnits] *
             SECTION_14A_POLICY.minimumGuaranteedPower;

// Example: Check §42c feasibility
const pvCapacity = installation.capacity;
if (pvCapacity < SECTION_42C_HEURISTICS.spatialClustering.pvCandidate.minCapacity_kWp) {
  status = 'Too small for energy sharing; consider direct marketing instead';
}
```

### Recipe-Level Usage

Each of the 7 new cookbook recipes references domain constants in their process parameters:

| Recipe | Constants Used |
|--------|-----------------|
| `znp-flexible-nav-stresstest` | `SECTION_14A_POLICY.simultaneityFactorTable`, `SECTION_14A_POLICY.minimumGuaranteedPower` |
| `energy-sharing-42c-radar` | `SECTION_42C_HEURISTICS.spatialClustering.pvCandidate.minCapacity_kWp`, `SECTION_42C_HEURISTICS.spatialClustering.geometry.distanceThreshold_m` |
| `cybergrid-counter-location-scout` | `HOTSPOT_THRESHOLDS.thermal.warningLevel`, `.thermalAlertLevel` |
| `nova-capex-defender` | `CAPEX_ASSUMPTIONS.rONT.incrementalCost`, `CAPEX_ASSUMPTIONS.cable.costPerKilometer.typical` |
| `section14a-compliance-autopilot` | (implicit: §14a monitoring logic) |
| `redispatch-forensic-audit` | (implicit: redispatch thresholds) |
| `self-healing-data-crowdsourcing-trigger` | (implicit: data quality standards) |

---

## Domain Assumption Versioning

All constants are **maintained in `src/domain-config.js`** and **documented in this directory.**

### Update Workflow

1. **Regulatory Change:** BNetzA issues new Festlegung or EnWG amendment
2. **Update `src/domain-config.js`:** Modify relevant constant(s) with inline comments citing legal reference
3. **Update Docs:** Refresh corresponding `.md` guide (e.g., `03-SECTION14A-POLICY.md`)
4. **Test Impact:** Run `npm test` to ensure recipes using the constant still pass
5. **Release Notes:** Document in `CHANGELOG.md` with version bump (e.g., v0.20.7)

### Example: rONT Price Drop

**Scenario:** Supplier announces €4,500 (was €5,500) as new market standard.

```diff
// src/domain-config.js
const CAPEX_ASSUMPTIONS = {
  rONT: {
-   incrementalCost: 5500,
+   incrementalCost: 4500,  // Updated 2026-04 per supplier survey
    ...
```

**Impact:** `nova-capex-defender` and CFO templates automatically use new price in next run.

---

## Data Governance

### Source of Truth

| Constant Set | Primary Source | Authority |
|--|--|--|
| **Hotspot Thresholds** | DIN EN 50160, TAR Strom (ATREG) | BNetzA |
| **CAPEX Assumptions** | Cernion cost analysis (quarterly update) | Market surveys + operator feedback |
| **§14a Policy** | BK6-22-300 (Oct 2023) | BNetzA |
| **§42c Heuristics** | §42c EnWG + BDEW guidance | Federal Law |

### Accuracy & Maintenance Cadence

- **Hotspot Thresholds:** Static (regulatory); review annually
- **CAPEX Assumptions:** Dynamic; update quarterly (supplier quotes)
- **§14a Policy:** Static until next BNetzA Festlegung (2–3 year cycle)
- **§42c Heuristics:** Evolving post-2026 launch; update semi-annually based on market data

---

## Key Metrics & KPIs

Each domain assumption supports specific Cernion KPIs:

| KPI | Domain | Formula | Target |
|---|---|---|---|
| **Grid Relief Potential (GRP)** | §14a + Hotspots | Controllable capacity × g-factor / alert threshold | >10% of hotspot load |
| **CAPEX Deferral (NOVA)** | CAPEX + ZNP | rONT cost / cable cost × 1.5x-2x timeline | Positive NPV ≥2 years |
| **Energy Sharing Penetration** | §42c | Eligible clusters / Total renewable portfolio | >15% by 2030 |
| **Compliance Readiness** | §14a + Hotspots | (Registered devices / Estimated total) × Status checks | >85% by 2026-06 |

---

## Troubleshooting & Common Questions

### Q: Why is rONT cheaper than I expected?

**A:** CAPEX_ASSUMPTIONS reflects **incremental cost** (premium over standard 400 kVA trafo), not total hardware cost. Standard trafo ≈€1,500; rONT ≈€7,000 total, but incremental is €5,500.

### Q: Can I override these constants for a specific customer?

**A:** No—constants are global and versioned. For customer-specific scenarios, use recipe parameters (e.g., `znp.addAssumption` text field) to inject custom assumptions, which get tracked separately.

### Q: What happens if a regulation changes mid-year?

**A:** Create a new version of `src/domain-config.js` with updated constants. Recipes automatically use the new values on next execution. Track old values in git history for auditability (required by EU AI Act Art. 12).

### Q: How do I know if my local rules differ from Cernion defaults?

**A:** Most constants reflect **German national standards** (BNetzA, TAR Strom). For regional grid operators (e.g., regional TSO-specific N-1 rules), contact your VNB/grid operator and request local adjustments via pull request.

---

## References & Further Reading

- **DIN EN 50160:** Voltage characteristics in public electricity supply networks
- **EnWG (German Energy Act):** §14a, §14g, §20, §42c
- **BNetzA Festlegung BK6-22-300:** Demand-response emergency regulation
- **ATREG (Anreizregulierungsverordnung):** Network tariff regulation
- **BDEW:** Industry standards and best practices
- **Cernion Implementation:** `src/domain-config.js`, `src/cookbook-recipes.js`

---

**Version:** 0.20.6
**Last Updated:** 2026-04-08
**Maintainer:** Cernion Energy Tools Team
