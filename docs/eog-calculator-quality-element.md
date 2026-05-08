# EOG-Calculator: Quality Element (eog.quality_element) Integration

## Overview

The `eog.quality_element` field represents regulatory quality adjustments in the EOG (Erlösobergrenzen) revenue cap calculation. It is an **optional but regulatorily relevant** field that impacts the computed EOG directly as a +/− cost adjustment.

## Field Definition

```javascript
quality_element: {
  key: 'eog.quality_element',
  type: 'number',
  unit: 'EUR',
  requiredForActual: false,
  blocker: 'Ohne Qualitätselement fehlen Zu-/Abschläge aus der Qualitätsregulierung.',
}
```

- **Type:** Number (EUR)
- **Required:** No (optional for partial calculations)
- **Importance:** Detail reproduction (flagged in `inputStatus.optionalButRelevant`)
- **Impact:** Direct arithmetic addition/subtraction in approved revenue cap formula

## Calculation Formula

The `quality_element` is added directly to the revenue cap computation:

$$\text{EOG} = \text{BaseCost} - \text{EfficiencyReduction} + \text{NonControllableCosts} + \boxed{\text{QualityElement}} + \ldots$$

**Examples:**
- Positive Q-element (+50 EUR): Adds bonus to EOG → increases revenue cap
- Negative Q-element (−30 EUR): Applies malus to EOG → decreases revenue cap
- Absent/Zero Q-element: Treated as 0 EUR → no impact

## API Usage

### 1. Input Status (Discovery)

Check if quality_element is available for a VNB:

```bash
POST /api/eog-calculator/input-status
{
  "tenantId": "tenant-123",
  "vnbId": "SNB456",
  "periodYear": 2026,
  "sector": "strom"
}
```

**Response** includes `optionalButRelevant` array:

```json
{
  "success": true,
  "required": [
    "eog.efficiency_value",
    "eog.base_cost_level",
    "eog.controllable_costs",
    "eog.permanently_non_controllable_costs",
    "eog.temporarily_non_controllable_costs"
  ],
  "missing": [],
  "optionalButRelevant": [
    {
      "key": "eog.quality_element",
      "available": false,
      "description": "Ohne Qualitätselement fehlen Zu-/Abschläge aus der Qualitätsregulierung.",
      "importance": "detail_reproduction"
    },
    {
      "key": "eog.regulatory_account_balance",
      "available": false,
      "description": "Ohne Regulierungskonto-Saldo fehlen periodenübergreifende Korrektionen.",
      "importance": "detail_reproduction"
    },
    {
      "key": "eog.volatile_costs",
      "available": false,
      "description": "Volatile Kosten sind für Detailreproduktion erforderlich.",
      "importance": "detail_reproduction"
    },
    {
      "key": "eog.capex_adjustment_addition",
      "available": false,
      "description": "Ohne Kapitalkostenaufschlag sind Investitionsanpassungen unvollständig.",
      "importance": "detail_reproduction"
    },
    {
      "key": "eog.capex_adjustment_deduction",
      "available": false,
      "description": "Ohne Kapitalkostenabzug sind Investitionsanpassungen unvollständig.",
      "importance": "detail_reproduction"
    }
  ],
  "anchors": [
    {
      "key": "eog.approved_revenue_cap",
      "available": false,
      "description": "Beschiedene EOG-Werte dienen als Kalibrieranker zur Modellvalidierung."
    }
  ]
}
```

### 2. Validate Datapoints (Including Quality Element)

Submit quality_element along with required fields:

```bash
POST /api/eog-calculator/datapoints/validate
{
  "tenantId": "tenant-123",
  "vnbId": "SNB456",
  "datapoints": [
    {
      "key": "eog.efficiency_value",
      "value": 95,
      "unit": "%",
      "periodYear": 2026,
      "sector": "strom",
      "source": "tenant_uploaded",
      "confidence": "confirmed"
    },
    {
      "key": "eog.base_cost_level",
      "value": 1000,
      "unit": "EUR",
      "periodYear": 2026,
      "sector": "strom",
      "source": "tenant_uploaded",
      "confidence": "confirmed"
    },
    {
      "key": "eog.controllable_costs",
      "value": 200,
      "unit": "EUR",
      "periodYear": 2026,
      "sector": "strom",
      "source": "tenant_uploaded",
      "confidence": "confirmed"
    },
    {
      "key": "eog.permanently_non_controllable_costs",
      "value": 300,
      "unit": "EUR",
      "periodYear": 2026,
      "sector": "strom",
      "source": "tenant_uploaded",
      "confidence": "confirmed"
    },
    {
      "key": "eog.temporarily_non_controllable_costs",
      "value": 100,
      "unit": "EUR",
      "periodYear": 2026,
      "sector": "strom",
      "source": "tenant_uploaded",
      "confidence": "confirmed"
    },
    {
      "key": "eog.quality_element",
      "value": 50,
      "unit": "EUR",
      "periodYear": 2026,
      "sector": "strom",
      "source": "bnetza_regulated",
      "confidence": "confirmed",
      "status": "final",
      "provenance": {
        "source": "BNetzA Erlösobergrenzen 2026",
        "date": "2025-11-15",
        "reference": "Bescheid_SNB456_2026"
      }
    }
  ]
}
```

**Response:**

```json
{
  "success": true,
  "validationId": "val-uuid-12345",
  "dataStatus": "complete",
  "errors": [],
  "warnings": [],
  "normalizedDatapoints": 6
}
```

### 3. Commit Datapoints

Persist validated datapoints (including quality_element):

```bash
POST /api/eog-calculator/datapoints/commit
{
  "validationId": "val-uuid-12345"
}
```

**Response:**

```json
{
  "success": true,
  "committed": true,
  "tenantId": "tenant-123",
  "vnbId": "SNB456",
  "persistedCount": 6,
  "datapoints": [
    {
      "key": "eog.efficiency_value",
      "value": 95,
      ...
    },
    ...
    {
      "key": "eog.quality_element",
      "value": 50,
      "confidence": "confirmed"
    }
  ]
}
```

### 4. Calculate EOG (With Quality Element Impact)

Compute the revenue cap with quality_element included:

```bash
POST /api/eog-calculator/calculate
{
  "tenantId": "tenant-123",
  "vnbId": "SNB456",
  "periodYear": 2026,
  "sector": "strom"
}
```

**Response (with Quality Element = +50 EUR):**

```json
{
  "success": true,
  "dataStatus": "complete",
  "calculationMode": "actual",
  "results": {
    "calculatedApprovedRevenueCap": 1440,
    "calculatedAdjustedRevenueCap": 1440
  },
  "calibration": {
    "approvedRevenueCap": {
      "status": "match",
      "anchor": 1440,
      "computed": 1440,
      "delta": 0,
      "relativeDelta": 0
    }
  },
  "steps": [
    {
      "step": "efficiency_reduction",
      "details": {
        "efficiency_factor": 0.95,
        "controllable_costs": 200,
        "result": 10
      }
    },
    {
      "step": "approved_revenue_cap_calculation",
      "formula": "1000 - 10 + 300 + 100 + 50 = 1440"
    },
    {
      "step": "calibration_comparison",
      "delta": 0,
      "relativeDelta": 0,
      "isMatch": true
    }
  ]
}
```

**Response (with Quality Element = −30 EUR):**

```json
{
  "results": {
    "calculatedApprovedRevenueCap": 1360
  },
  "steps": [
    {
      "step": "approved_revenue_cap_calculation",
      "formula": "1000 - 10 + 300 + 100 - 30 = 1360"
    }
  ]
}
```

### 5. Get Model (Inspect Stored Quality Element)

Retrieve persisted datapoints including quality_element:

```bash
GET /api/eog-calculator/tenant-123/SNB456
```

**Response:**

```json
{
  "tenantId": "tenant-123",
  "vnbId": "SNB456",
  "datapoints": [
    {
      "key": "eog.efficiency_value",
      "value": 95,
      "confidence": "confirmed",
      "calculatedApprovedRevenueCap": 1440
    },
    ...
    {
      "key": "eog.quality_element",
      "value": 50,
      "confidence": "confirmed",
      "unit": "EUR",
      "source": "bnetza_regulated",
      "provenance": {
        "source": "BNetzA Erlösobergrenzen 2026",
        "reference": "Bescheid_SNB456_2026"
      }
    }
  ],
  "decisionEvents": []
}
```

## Detail Reproduction Classification

The `inputStatus` endpoint now classifies optional-but-important fields as `optionalButRelevant` with `importance: 'detail_reproduction'`. This category includes:

1. **eog.quality_element** — Regulatory quality adjustments
2. **eog.regulatory_account_balance** — Periodic corrections
3. **eog.capex_adjustment_addition** — Positive capex adjustments
4. **eog.capex_adjustment_deduction** — Negative capex adjustments
5. **eog.volatile_costs** — Market-dependent costs

**Why "detail reproduction"?**
- These fields are not required for partial EOG estimates
- They are essential for **calibration comparison** to match BNetzA-approved revenue caps
- Missing these fields increases the likelihood of calibration deviations (delta > tolerance)
- Including them enables **forensic audit trails** and **regulatory compliance verification**

## Test Examples

### Test 1: Positive Quality Element Impact

```javascript
it('applies quality_element correctly: positive adds to EOG', async () => {
  const datapoints = [
    { key: 'eog.efficiency_value', value: 95, ... },
    { key: 'eog.base_cost_level', value: 1000, ... },
    { key: 'eog.controllable_costs', value: 200, ... },
    { key: 'eog.permanently_non_controllable_costs', value: 300, ... },
    { key: 'eog.temporarily_non_controllable_costs', value: 100, ... },
    { key: 'eog.quality_element', value: 50, ... },  // +50 EUR bonus
  ];

  const calc = await broker.call('eog-calculator.calculate', { ... });

  // 1000 - 10 + 300 + 100 + 50 = 1440
  expect(calc.results.calculatedApprovedRevenueCap).toBe(1440);
});
```

### Test 2: Negative Quality Element Impact

```javascript
it('applies quality_element correctly: negative subtracts from EOG', async () => {
  const datapoints = [
    { key: 'eog.efficiency_value', value: 95, ... },
    { key: 'eog.base_cost_level', value: 1000, ... },
    { key: 'eog.controllable_costs', value: 200, ... },
    { key: 'eog.permanently_non_controllable_costs', value: 300, ... },
    { key: 'eog.temporarily_non_controllable_costs', value: 100, ... },
    { key: 'eog.quality_element', value: -30, ... },  // -30 EUR malus
  ];

  const calc = await broker.call('eog-calculator.calculate', { ... });

  // 1000 - 10 + 300 + 100 - 30 = 1360
  expect(calc.results.calculatedApprovedRevenueCap).toBe(1360);
});
```

### Test 3: Absent Quality Element (Default)

```javascript
it('handles absent quality_element as zero', async () => {
  const datapoints = [
    { key: 'eog.efficiency_value', value: 95, ... },
    { key: 'eog.base_cost_level', value: 1000, ... },
    { key: 'eog.controllable_costs', value: 200, ... },
    { key: 'eog.permanently_non_controllable_costs', value: 300, ... },
    { key: 'eog.temporarily_non_controllable_costs', value: 100, ... },
    // No quality_element submitted
  ];

  const calc = await broker.call('eog-calculator.calculate', { ... });

  // 1000 - 10 + 300 + 100 + 0 = 1390
  expect(calc.results.calculatedApprovedRevenueCap).toBe(1390);
});
```

## Regulatory Context (ARegV)

The quality element implements regulatory adjustments per **ARegV (Anreizregulierungsverordnung)** § 7–10:

- **Positive adjustments:** Incentive bonuses for service quality, innovation, or network modernization
- **Negative adjustments:** Penalties for service failures, non-compliance, or inefficiency
- **Purpose:** Tie revenue cap to measurable quality/performance metrics

Quality elements are determined by:
1. BNetzA determination in the formal decision (Bescheid)
2. Annual performance reviews
3. Regulatory account reconciliation

## Related Fields

- `eog.regulatory_account_balance` — Cumulative carry-forward adjustments from prior periods
- `eog.capex_adjustment_addition/deduction` — Capital expenditure adjustments for network investments
- `eog.volatile_costs` — Market-indexed cost components (fuel, CO₂, etc.)
- `eog.approved_revenue_cap` — Calibration anchor (BNetzA-approved EOG)

## Error Handling

If quality_element cannot be provided due to missing regulatory decision:

```bash
POST /api/eog-calculator/request-input
{
  "tenantId": "tenant-123",
  "vnbId": "SNB456",
  "periodYear": 2026,
  "missingKeys": ["eog.quality_element"]
}
```

**Response:**

```json
{
  "created": 1,
  "items": [
    {
      "key": "eog.quality_element",
      "hitlItemId": "hitl-uuid-789",
      "explanation": "Ohne Qualitätselement fehlen Zu-/Abschläge aus der Qualitätsregulierung.",
      "expectedUnit": "EUR",
      "userChoices": [
        { "option": "manual_confirm", "description": "Manually confirm the value from BNetzA decision" },
        { "option": "document_upload", "description": "Upload regulatory decision (PDF/Excel)" },
        { "option": "scenario_assumption", "description": "Proceed with scenario (quality_element = 0)" },
        { "option": "abort", "description": "Stop EOG calculation pending clarification" }
      ],
      "validationQuestions": [
        "Ist der Qualitätselement-Wert im BNetzA-Bescheid für diesen Zeitraum enthalten?",
        "Sollten zukünftige Qualitätsregelungen berücksichtigt werden?",
        "Gibt es Zweitentscheidungen oder Ergänzungsanträge?"
      ]
    }
  ]
}
```

## Scenario Analysis (Transient)

Test quality_element variations without persisting:

```bash
POST /api/eog-calculator/scenario
{
  "tenantId": "tenant-123",
  "vnbId": "SNB456",
  "overrides": [
    {
      "key": "eog.quality_element",
      "value": 100  // Test with +100 EUR bonus
    }
  ]
}
```

**Response** (not persisted):

```json
{
  "calculationMode": "scenario",
  "persisted": false,
  "results": {
    "calculatedApprovedRevenueCap": 1490  // 1000 - 10 + 300 + 100 + 100
  },
  "note": "Scenario result is transient and not saved to datapoint service"
}
```

## Version History

- **v0.48.0** (2026-05-08): Initial quality_element support; added to `optionalButRelevant` classification; test coverage for +50 EUR, −30 EUR, and zero scenarios
