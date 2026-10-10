"""Versioned benchmark contract; identical for backtest, fitting and inference."""
DEFAULT = dict(latest_measurement_lag=3, feature_profile='e2_v1',
               selection_objective='mae', candidate_set='extended', training_mode='rolling')
OPTIONS = dict(latest_measurement_lag=(2, 3), feature_profile=('legacy_v1', 'e2_v1'),
               selection_objective=('rmse', 'mae'), candidate_set=('existing', 'hgb', 'extended', 'regime'),
               training_mode=('rolling', 'frozen'))


def normalize(value=None):
    value = {} if value is None else value
    if not isinstance(value, dict) or set(value) - set(DEFAULT):
        raise ValueError('Unsupported portfolio_method fields')
    result = {**DEFAULT, **value}
    for key, allowed in OPTIONS.items():
        if isinstance(result[key], bool) or result[key] not in allowed:
            raise ValueError(f'Invalid portfolio_method.{key}')
    return result


def lags(contract):
    return (2, 7, 14, 21, 28) if contract['feature_profile'] == 'legacy_v1' else (3, 4, 7, 14, 28)


def feature_names(contract):
    names = ['series_id', 'slot', 'weekday', 'weekend', 'month', 'slot_sin', 'slot_cos', 'season_sin', 'season_cos']
    names += [f'lag_{lag}' for lag in lags(contract)]
    names += [f'lag_{lag}_missing' for lag in lags(contract)]
    names += [f'lag_{lag}_active' for lag in lags(contract)]
    names += ['latest_day_mean', 'latest_day_coverage', 'older_profile', 'older_profile_age_days', 'measurement_age_hours']
    if contract['feature_profile'] == 'e2_v1':
        names += ['profile_mean_7_8_9', 'profile_mean_7_14', 'weekday_sin', 'weekday_cos']
    return names
