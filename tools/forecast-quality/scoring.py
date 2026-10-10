"""Independent API prediction verification and metric reconstruction."""
import datetime as dt
import math
from zoneinfo import ZoneInfo
from profile_io import UTC, STEP, iso

def verify_and_score(result, dataset, start, end):
    """Independently verify API outputs and compute pooled sufficient statistics."""
    zone = ZoneInfo(dataset['timezone'])
    expected = {}
    cursor = dt.datetime.combine(start, dt.time(), zone).astimezone(UTC)
    stop = dt.datetime.combine(end + dt.timedelta(days=1), dt.time(), zone).astimezone(UTC)
    while cursor < stop:
        expected[iso(cursor)] = cursor
        cursor += STEP
    actuals = {r['timestamp']: r['value'] for r in dataset['values']}
    squared = absolute = signed = actual_abs = percentage = 0.0
    count = percentage_count = 0
    observed = set()
    for row in result['forecast_values']:
        stamp = iso(dt.datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00')))
        if stamp not in expected or stamp in observed:
            raise ValueError('API returned an unexpected or duplicate forecast interval')
        observed.add(stamp)
        day = expected[stamp].astimezone(zone).date()
        cutoff = dt.datetime.combine(day - dt.timedelta(days=1), dt.time(), zone).astimezone(UTC)
        trained = dt.datetime.fromisoformat(row['training_data_until'].replace('Z', '+00:00'))
        issued = dt.datetime.fromisoformat(row['forecast_created_at'].replace('Z', '+00:00'))
        issue_time = result.get('forecast_run', {}).get('issue_time', '00:00')
        if issue_time not in ('00:00', '18:00'):
            raise ValueError('Unsupported issue_time')
        expected_issue = dt.datetime.combine(day-dt.timedelta(days=1), dt.time.fromisoformat(issue_time), zone).astimezone(UTC)
        if trained >= cutoff or issued != expected_issue:
            raise ValueError('API violates D-2 training/issuance contract')
        forecast = row['predicted_value']
        if not isinstance(forecast, (int, float)) or not math.isfinite(forecast):
            raise ValueError('API returned a non-finite prediction')
        actual = actuals.get(stamp)
        if row.get('actual_value') != actual:
            raise ValueError('API actual differs from original imported measurement')
        if actual is None:
            continue
        error = actual - forecast
        count += 1
        squared += error * error
        absolute += abs(error)
        signed += error
        actual_abs += abs(actual)
        if actual != 0:
            percentage += abs(error / actual) * 100
            percentage_count += 1
    if len(observed) != len(expected) or not count:
        raise ValueError('Forecast incomplete or no holdout actuals matched')
    scores = {'sample_count': count, 'expected_intervals': len(expected), 'coverage': count / len(expected),
              'mse': squared / count, 'rmse': math.sqrt(squared / count), 'mae': absolute / count,
              'bias': signed / count, 'cumulative_error': signed,
              'mape': percentage / percentage_count if percentage_count else None,
              'wape_percent': 100 * absolute / actual_abs if actual_abs else (0 if not absolute else None),
              'squared_error_sum': squared, 'absolute_error_sum': absolute, 'actual_absolute_sum': actual_abs,
              'mape_sample_count': percentage_count}
    for metric in ('mse', 'rmse', 'mae', 'bias', 'cumulative_error'):
        if not math.isclose(scores[metric], result['backtest'][metric], abs_tol=1e-8, rel_tol=1e-8):
            raise ValueError(f'API metric mismatch: {metric}')
    return scores
