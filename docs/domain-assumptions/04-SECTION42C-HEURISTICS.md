# §42c EnWG — Energy Sharing Community Heuristics

**Reference:** `src/domain-config.js` → `SECTION_42C_HEURISTICS`

**Regulation:** §42c EnWG (Energy Sharing); **effective 2026-06-01**

Energy Sharing enables aggregated renewable generation to supply nearby consumers without grid tariffs, if structured as a legal "Energiegemeinschaft." Cernion screens for spatial & regulatory feasibility via deterministic heuristics in `energy-sharing-42c-radar` recipe.

## Regulatory Framework (§42c EnWG)

### What is Energy Sharing?

A community where:
1. **Generator(s):** Rooftop PV ≥30 kWp on multi-family house (MFH) or commercial building
2. **Consumer(s):** Tenants, adjacent residents, or businesses ≤500m away
3. **Legal Structure:** Registered Energiegemeinschaft (e.g., eG, GmbH-Modell)
4. **Marketing:** Must use **Direktvermarktung** (direct marketing) ← not EEG fixed tariff
5. **Service Provider:** §20 EnWG requires professional network usage & balancing contract

### Key Constraint: EEG Incompatibility

**§21 Abs. 2 EEG (Federal Renewable Energy Act):**

> _An installation cannot simultaneously receive fixed EEG feed-in tariff AND participate in energy sharing._

**Implication:**
- Existing EEG installations (20-year contract) cannot join energy sharing
- Must wait for tariff expiration OR voluntarily exit early
- New installations (post-2044) have no EEG eligibility → energy sharing is default choice

## Spatial Clustering Heuristics (Layer 1)

### Building Typology: Rooftop PV Candidate

**Minimum Size:**
- PV capacity ≥ 30 kWp

**Preferred Building Type:**
- Multi-family house (MFH) or apartment complex
- Rationale: Multiple tenants → diversified consumption profile → better matching

**Rooftop Requirement:**
- Unshaded southern exposure
- Engineering: Feasibility check via OSM building footprints + slope analysis

### Geometric Clustering

**Distance Threshold:** 500 m (straight-line distance via OSM routing)

**Method:**
1. Start with PV candidate (30+ kWp)
2. Search nearby buildings within 500 m radius
3. Identify tenants/businesses (consume electricity daily)
4. Group into candidate clusters

**Example:**
- MFH A: 40 kWp, 12 apartments → generator
- Residential block B: 30 units, ≤300m away → consumers
- Small bakery C: 5 kW load, ≤400m away → consumer
- **Cluster feasibility:** ✓ (within distance, mixed profile)

### Profile Diversity Impact (Landuse Mixing)

**Observation:** Residential (H0) + Commercial (G0) load profiles are **asynchronous:**
- H0 peaks: Evening (cooking, heating); Night (standby); Winter seasonal
- G0 peaks: Noon–afternoon (HVAC, process); Summer seasonal

**Cernion Heuristic:**
- **Pure residential cluster:** Peak load ≈ 100% simultaneous
- **Mixed residential + commercial:** Peak load ≈ 80–85% simultaneous
  - **Reduction factor:** −15 to −20%

**Translation to Energy Sharing:**
- MFH (30 apartments, 3 kW avg) + bakery (5 kW) + office (8 kW)
- Combined peak (no diversity): 30×3 + 5 + 8 = 103 kW
- With mixing factor: 103 × 0.85 = 87.55 kW (saves ~15 kW dimensioning)
- **Benefit:** Smaller inverter/contract size → lower costs

## Regulatory Constraint Checks

### Direktvermarktung (Direct Marketing) Requirement

**§42c Mandate:**
> _Energy sharing installations must use Direktvermarktung; EEG fixed tariff not permitted._

**Check in Recipe:**

```javascript
params: {
  require_direktvermarktung: true,
  description: 'Validate Direktvermarkter availability in community area'
}
```

**Operational Impact:**
- **Revenue Model:** Spot price + local margin (not fixed EEG tariff)
- **Partner:** Community contracts with Direktvermarkter (e.g., Next Kraftwerke, Sunrun, Sonnen)
- **Cost:** 3–5% of energy volume to Direktvermarkter

### §20 EnWG Service Provider (Network Usage Agreement)

**Requirement:**
> _Community must contract a Netznutzungsdienstleister (network service provider) to handle:_
> - Metering data aggregation
> - Balancing group management
> - Settlement with TSO

**Check in Recipe:**

```javascript
params: {
  require_service_provider: true,
  description: 'Verify §20 service contract availability'
}
```

**Typical Cost:** €200–500/month for small community (<100 kWp).

### EEG Incompatibility Flagging

**Status Labels (from domain-config):**

```javascript
status_sharing_capable: 'Anlage in Direktvermarktung + §20 service provider available'
status_sharing_incapable: 'Still in EEG fixed tariff; can join after tariff expires'
```

**Recipe Logic:**

```javascript
// Check installation's EEG status from MaStR
const eegEndDate = installation.eegTariffEndDate; // e.g., "2033-12-31"
const today = new Date();

if (today < eegEndDate) {
  status = 'EEG_ACTIVE → Cannot join energy sharing until ' + eegEndDate;
  recommendation = 'Schedule review in ' + (eegEndDate.year - today.year) + ' years';
} else {
  status = 'EEG_EXPIRED → Eligible for energy sharing (switch to Direktvermarktung)';
}
```

## Integration with Recipe Workflow

### `energy-sharing-42c-radar` — Three Steps

```javascript
// Step 1: Find generator candidates
energy-market.installations({
  minCapacityKW: 30,  // From SECTION_42C_HEURISTICS
  installationType: 'solar'
})
// Result: List of MFH with large rooftop PV

// Step 2: Check clustering plausibility
osm-geo.infrastructureNearby({
  radiusMeters: 500,  // From SECTION_42C_HEURISTICS
  land_use_filtering: true
})
// Result: Nearby buildings, land-use type (residential, commercial, industrial)
// Computes diversity factor & storage potential

// Step 3: Validate regulatory eligibility
energy-sharing.validate({
  require_direktvermarktung: true,
  require_service_provider: true,
  flag_eeg_incumbent: true
})
// Result: Eligibility decision + timeline for each cluster
```

## Conflict Flags & Exclusions

### Flag 1: No Suitable Consumers

**Scenario:** Found PV generator (50 kWp) but <2 consuming units within 500m.

```javascript
{
  flag: 'no_suitable_consumers',
  description: 'Cluster has 1 generator but 0 nearby consumers',
  recommendation: 'Not viable as energy sharing; consider direct marketing or EEG instead'
}
```

### Flag 2: No Direktvermarkter Available

**Scenario:** Bundesland lacks local Direktvermarkter infrastructure.

```javascript
{
  flag: 'no_direktvermarkter',
  description: 'No Direktvermarkter registered within 50km',
  recommendation: 'Community must contract partner from distant region (higher fees)'
}
```

### Flag 3: EEG Incumbent Model

**Scenario:** 70% of candidate installations still under EEG (expires 2035–2040).

```javascript
{
  flag: 'eeg_incumbent_model',
  description: 'Too many units in fixed EEG tariff (avg 10 more years)',
  recommendation: 'Revisit in 2035 when first cohort expires; deferral to 2027+ realistic'
}
```

## Viability Scorecard

### Scoring Dimensions

| Dimension | Weight | Rationale |
|-----------|--------|-----------|
| **PV Availability** | 25% | Generator capacity vs. consumer base |
| **Proximity** | 20% | Distance to nearest consumers |
| **Diversity** | 15% | Asynchronous load profile (residential+commercial) |
| **Direktvermarkter** | 20% | Service provider availability & cost |
| **EEG Status** | 20% | % of units not yet EEG-expired |

### Example: Rural Village Cluster

**Data:**
- 1 MFH with 50 kWp PV (EEG expired 2024 ✓)
- 8 tenants + 2 adjacent homes (10 units, 3 kW avg = 30 kW peak)
- Nearest Direktvermarkter: 30 km away
- Land-use: 80% residential, 20% agricultural

**Scorecard:**
- PV Availability: 4/5 (50 kWp / 30 kW peak = 1.67x cushion)
- Proximity: 5/5 (all <200m away)
- Diversity: 3/5 (mostly residential; +10% commercial missing)
- DV Service: 3/5 (available but 30 km → +10% cost)
- EEG Status: 5/5 (main unit expired; others in 20 yr window)

**Weighted Score:** 0.25×4 + 0.20×5 + 0.15×3 + 0.20×3 + 0.20×5 = **4.0/5**
**Decision:** ✓ **Recommended** (viable for pilot phase 2026)

## Timeline & Regulatory Outlook

| Date | Milestone | Impact on Energy Sharing |
|------|-----------|------------------------|
| **2026-06-01** | §42c effective date | Communities can legally form; registrations accelerate |
| **2026–2027** | First 20-year EEG contracts expire | 2004 PV cohort becomes available (40+ kWp systems common) |
| **2028–2032** | Wave of EEG expirations | Massive inventory unlocked (~100 GWp cumulative) |
| **2035–2044** | Second EEG cohort expiration | Energy sharing becomes dominant model for renewables |

## Alternative Models (Decision Tree)

```
├─ Eligible for Energy Sharing (§42c)?
│  ├─ YES → Direktvermarktung + Service Provider
│  │  └─ Economics: Higher customer acquisition (community appeal) but 3–5% fee
│  │
│  └─ NO (EEG Still Active)
│     ├─ Exit EEG early? (penalty ~20%)
│     │  └─ NPV break-even if community price premium ≥25%
│     │
│     └─ Wait for EEG expiration
│        └─ Recommended if <5 years remaining
```

## Related Services & Recipes

- **`znp-flexible-nav-stresstest`:** Models §14a demand-response as alternative to energy sharing for grid relief
- **`section14a-compliance-autopilot`:** Detects controllable device inventory (potential energy-sharing participants)
- **`self-healing-data-crowdsourcing-trigger`:** Targets customers in energy-sharing-eligible postcode areas for clarification

---

## References

- **§42c EnWG:** https://www.gesetze-im-internet.de (German Federal Law)
- **§20 EnWG:** Network usage agreement framework
- **§21 Abs. 2 EEG:** EEG incompatibility clause
- **BDEW Energiegemeinschaften:** https://www.bdew.de/energiewende (industry guidance)
- **Cernion Domain Config:** `src/domain-config.js` SECTION_42C_HEURISTICS

---

**See also:** [CAPEX Economics](02-CAPEX-ECONOMICS.md) | [§14a Policy](03-SECTION14A-POLICY.md) | [Hotspot Detection](01-HOTSPOT-DETECTION.md)
