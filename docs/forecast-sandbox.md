# Forecast Sandbox API v0.1

**CR-CET-FORECAST-SANDBOX-V0.1** — generic CET sandbox/evaluation path for RLM/iMSys
day-ahead consumption forecasting. Sales-facing: meant to be handed to a B2B lead so they
can self-check whether their consumption data and the CET API model fit together, ahead of
a commercial mini-check or pilot.

**No SLA. No forecast-quality guarantee. No balancing-energy-risk-reduction guarantee.**
Every response carries a `commercialBoundary` object saying so explicitly.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/forecast-sandbox/consumption/validate` | Checks a PT15M consumption series for grid alignment, missing/duplicate intervals, negative values, outliers. |
| `POST` | `/api/forecast-sandbox/consumption/day-ahead` | Deterministic weekday-profile baseline day-ahead forecast (method `baseline_weekday_profile_v0`). |
| `POST` | `/api/forecast-sandbox/consumption/backtest` | Backtests the baseline against historical actuals — MAE/RMSE/MAPE/bias, daily breakdown, readiness verdict. |
| `GET` | `/api/forecast-sandbox/openapi.json` | Standalone OpenAPI 3.x document scoped to only these endpoints. |

All four also appear in the global `GET /api/openapi.json`, tagged `Forecast Sandbox`.

Auth follows the existing CET token mechanism: a bearer token (`ck_...` or session
`csess_...`) with `full-access` scope is required for the three `POST` endpoints, same as
every other write endpoint on the gateway (see `enforceRbacForPath` in
`services/api.service.js`). `GET /openapi.json` is unauthenticated by design, so it can be
linked directly to a lead.

## Method (v0.1)

`baseline_weekday_profile_v0`: for each quarter-hour of the target day, averages historical
values at the same weekday + quarter-hour-of-day (falling back to same-quarter-hour-any-weekday,
then to the overall average, if a bucket has no direct history). Deterministic, explainable,
no ML — see `src/forecast-sandbox-baseline.js`. Backtest metrics reuse
`calculateForecastQuality` from `src/forecast-calculator.js`, the same helper behind
`POST /api/forecast/quality`.

Minimum history: 14 days (1,344 PT15M intervals) for both `day-ahead` and the `backtest`
training window — below that the weekday buckets are too sparse for a meaningful baseline
and the endpoint returns `INSUFFICIENT_HISTORY` instead of a low-confidence guess.

## Statelessness and privacy

This service persists nothing: no PouchDB, no own storage, nothing written to disk across
requests. `seriesId` is expected to be pseudonymous — names, contract numbers, and addresses
are never required and should not be sent. This also means CET-side tenant isolation is
moot for this service specifically (there is no cross-request state to isolate); the
gateway's standard auth/rate-limit/tenant plumbing still applies to the request itself.

## Error handling

Every response is HTTP 200 with a `status` field of `"ok"` or `"error"` — never a crash,
never a 5xx for a data-quality problem. On `status: "error"` the gateway also sets the HTTP
status (400 for a client-side data/period problem, 500 only for `INTERNAL_FORECAST_ERROR`).

Error codes: `INVALID_PAYLOAD`, `INVALID_TIMESTAMP`, `INVALID_GRANULARITY`,
`MISSING_VALUES`, `DUPLICATE_INTERVALS`, `INSUFFICIENT_HISTORY`, `INVALID_BACKTEST_PERIOD`,
`ZERO_VALUES_FOR_MAPE`, `UNSUPPORTED_UNIT`, `INTERNAL_FORECAST_ERROR`.

A daylight-saving transition day (`forecastDate` in `Europe/Berlin`) never crashes the
day-ahead forecast: spring-forward yields 92 intervals with a `DST_SPRING_FORWARD` warning,
fall-back yields 100 with `DST_FALL_BACK`; a normal day yields 96.

## Examples

Pseudonymous synthetic payloads for a curl smoke test:

```bash
curl -s -X POST "https://api.cernion.de/api/forecast-sandbox/consumption/validate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d @examples/forecast-sandbox/validate-series.example.json

curl -s -X POST "https://api.cernion.de/api/forecast-sandbox/consumption/day-ahead" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d @examples/forecast-sandbox/day-ahead.example.json

curl -s -X POST "https://api.cernion.de/api/forecast-sandbox/consumption/backtest" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d @examples/forecast-sandbox/backtest.example.json

curl -s "https://api.cernion.de/api/forecast-sandbox/openapi.json"
```

## Recommended sales framing (§13 of the CR)

> Wir haben auf Basis Ihrer beschriebenen Anforderungen einen ersten Cernion
> Forecast-Sandbox-Pfad vorbereitet. Dieser dient dazu, vor dem Gespräch zu prüfen, ob Ihr
> Datenmodell und unser API-Modell zusammenpassen. Die API kann 15-Minuten-Verbrauchszeitreihen
> validieren, eine Baseline-Day-ahead-Prognose erzeugen und Backtest-Metriken berechnen. Die
> fachliche Bewertung, Prognosegüte und kommerzielle Nutzung wären anschließend Gegenstand
> eines vereinbarten Mini-Checks oder Piloten.

Do not present this as a production forecast commitment or as free customer-specific
development — it is a generic CET sandbox building block.
