# Synthetic Forecast & Data-Quality Fit Preview

Status: public-safe synthetic example, not customer data.

## Input

Sample file: `sample-load-profile.csv`

Shape:
- timestamp
- consumption value
- optional weather/context columns
- optional holiday marker

## Result summary

Cernion can use this file shape for a first fit review, but this sample is intentionally too short for a real forecast assessment.

## Fit matrix

| Dimension | Result | Caveat |
| --- | --- | --- |
| Business use case | Load-profile forecast/data-quality preview | Synthetic demonstration only |
| Data availability | Partial sample | Real review needs a longer evaluation period |
| Market context | Incomplete | MaLo/meter metadata missing |
| Technical fit | Review required | Column mapping is plausible, context incomplete |
| Commercial fit | Paid review recommended | No productive promise or SLA |
| Recommended next step | Paid fit clarification | Then pilot or API/model access if suitable |

## Sample metrics

These are synthetic preview metrics, not a quality guarantee:

- MAE: 12.4 kWh
- RMSE: 16.8 kWh
- WAPE: 8.9%

## Quality findings

- Evaluation period too short.
- Meter/MaLo metadata missing.
- Holiday context is present, but broader calendar/weather context is incomplete.
- Structural breaks were not assessed.

## Commercial boundary

This preview does not include productive operation, SLA, guaranteed forecast quality, legal/regulatory advice or system integration. Deeper technical or commercial assessment belongs in a paid review/pilot path.
