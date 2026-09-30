"""Versioned, past-only panel backtest. JSONL process protocol for the CET job lane."""
import bisect
import datetime as dt
import hashlib
import json
import math
import random
import sys
from collections import defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo
import persistence
import contracts
import regimes
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn import __version__ as SKLEARN_VERSION
from threadpoolctl import threadpool_limits

import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor, __version__ as CATBOOST_VERSION

VERSION = 'portfolio_regime_0700_v3'
SOURCE_SHA256 = hashlib.sha256(b''.join((Path(__file__).parent / name).read_bytes() for name in ['engine.py', 'persistence.py', 'runtime.py', 'contracts.py', 'regimes.py', 'product.py', 'starter.py'] if (Path(__file__).parent / name).exists())).hexdigest()
UTC = dt.timezone.utc
STEP = dt.timedelta(minutes=15)
POLICY = dict(training_days=180, minimum_training_days=84, discovery_days=28,
              confirmation_days=28, refit_days=28, iterations=120, depth=5,
              learning_rate=0.05, random_seed=73471, minimum_rmse_gain=0.03,
              minimum_mae_gain=0.03, bootstrap_block_days=7,
              maximum_mae_regression=0.0, minimum_winning_weeks=3,
              scaling='training_mean_per_series', equal_series_weight=True)
BASELINES = ('previous_week', 'weekday_mean', 'weekday_median', 'two_week_mean')
BOOSTS = ('catboost_global', 'catboost_local', 'catboost_hurdle')
REGIME_CANDIDATES = ('regime_local_soft', 'regime_local_hard', 'regime_week_75')
EXTRA = ('hgb_local', 'hgb_week_75', 'hgb_mae', 'catboost_mae', 'hurdle_gate')
SCENARIOS = ('points_5pct', 'last_day', 'last_3_days')


def iso(value):
    return value.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def emit(message):
    print(json.dumps(message, allow_nan=False, separators=(',', ':')), flush=True)


def origin(day, zone):
    return dt.datetime.combine(day - dt.timedelta(days=1), dt.time(7), zone).astimezone(UTC)


def slots(day, zone):
    cursor = dt.datetime.combine(day, dt.time(), zone).astimezone(UTC)
    end = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), zone).astimezone(UTC)
    while cursor < end:
        yield cursor
        cursor += STEP


def label_transform(values):
    # Same conservative near-zero definition as learned_low_load_v1, fitted here
    # independently for EVERY training fold and series (never on validation y).
    a = np.asarray(values, dtype=float)
    q90 = float(np.quantile(a, .9, method='lower'))
    scale = q90 or float(a.max()) or 1.0
    x = np.log1p(a / scale)
    low, high = float(x.min()), float(np.quantile(x, .95, method='lower'))
    for _ in range(20):
        mask = x <= (low + high) / 2
        if mask.all() or not mask.any():
            break
        low, high = float(x[mask].mean()), float(x[~mask].mean())
    threshold = min(scale * math.expm1((low + high) / 2), .1 * q90)
    low_values, active = a[a <= threshold], a[a > threshold]
    if len(low_values) and len(active) and low_values.mean() > .1 * active.mean():
        threshold = 0.0
    return threshold


class Series:
    def __init__(self, data, contract=None):
        self.contract = contracts.normalize(contract) if contract is not None else contracts.normalize(dict(latest_measurement_lag=2, feature_profile="legacy_v1", candidate_set="existing"))
        self.id, self.unit = data['series_id'], data['unit']
        self.zone = ZoneInfo(data['timezone'])
        self.validation = data['validation']
        self.days = defaultdict(list)
        self.by_slot = defaultdict(list)
        self.actual = {}
        for raw in data['rows']:
            ms, value, available = raw[:3]
            stamp = dt.datetime.fromtimestamp(ms / 1000, UTC)
            local = stamp.astimezone(self.zone)
            row = (stamp, float(value), dt.datetime.fromtimestamp(available / 1000, UTC))
            self.days[local.date()].append(row)
            self.by_slot[(local.date(), local.hour * 4 + local.minute // 15)].append(row)
            self.actual[stamp] = float(value)
        self.dates = sorted(self.days)

    def known(self, row, day, issue, scenario):
        stamp, _, available = row
        local_day = stamp.astimezone(self.zone).date()
        lag = self.contract['latest_measurement_lag']
        if local_day > day - dt.timedelta(days=lag) or available > issue:
            return False
        if scenario == 'last_day' and local_day == day - dt.timedelta(days=lag):
            return False
        if scenario == 'last_3_days' and day - dt.timedelta(days=lag+2) <= local_day:
            return False
        if scenario == 'points_5pct':
            # Deterministic sensor outage, independent of target value.
            key = f'{self.id}:{stamp.timestamp()}'.encode()
            if int.from_bytes(hashlib.sha256(key).digest()[:4], 'big') % 20 == 0:
                return False
        return True

    def observed(self, rows, day, issue, scenario):
        latest = {}
        for r in rows:
            if self.known(r, day, issue, scenario) and (r[0] not in latest or r[2] >= latest[r[0]][2]):
                latest[r[0]] = r
        return list(latest.values())

    def lag(self, day, slot, lag, issue, scenario):
        rows = self.by_slot.get((day - dt.timedelta(days=lag), slot), [])
        values = [r[1] for r in self.observed(rows, day, issue, scenario)]
        return float(np.mean(values)) if values else float('nan')

    def day_context(self, day, scenario='none'):
        issue = origin(day, self.zone)
        full, latest = None, None
        for old in reversed(self.dates[:bisect.bisect_left(self.dates, day - dt.timedelta(days=self.contract['latest_measurement_lag']-1))]):
            if (day - old).days > 180:
                break
            known = self.observed(self.days[old], day, issue, scenario)
            if known and latest is None:
                latest = max(r[0] for r in known)
            if len(known) == len(list(slots(old, self.zone))):
                full = (old, known)
                break
        lag = self.contract['latest_measurement_lag']
        d2 = self.days.get(day - dt.timedelta(days=lag), [])
        observed = self.observed(d2, day, issue, scenario)
        return dict(issue=issue, full=full, latest=latest,
                    d2_mean=float(np.mean([r[1] for r in observed])) if observed else float('nan'),
                    d2_coverage=len(observed) / len(list(slots(day - dt.timedelta(days=lag), self.zone))),
                    latest_measurement_lag=lag)

    def features(self, stamp, scale, threshold, context, scenario='none'):
        local = stamp.astimezone(self.zone)
        day, slot = local.date(), local.hour * 4 + local.minute // 15
        lags = [self.lag(day, slot, lag, context['issue'], scenario) for lag in contracts.lags(self.contract)]
        weekly = [self.lag(day, slot, lag, context['issue'], scenario) for lag in (7,14,21,28)]
        comparable = [v for v in weekly if math.isfinite(v)]
        # An older complete day is a feature/fallback, never relabeled as D-2.
        full = context['full']
        older = self.lag(day, slot, (day - full[0]).days, context['issue'], scenario) if full else float('nan')
        if not comparable and not math.isfinite(older):
            # Last resort: older comparable weekdays/slots up to the fixed window.
            comparable = [self.lag(day, slot, lag, context['issue'], scenario) for lag in range(35, 181, 7)]
            comparable = [v for v in comparable if math.isfinite(v)]
        if not comparable and not math.isfinite(older):
            raise ValueError(f'No causal fallback profile for {self.id} at {iso(stamp)}')
        fallback = float(np.median(comparable)) if comparable else older
        bases = [weekly[0] if math.isfinite(weekly[0]) else (older if math.isfinite(older) else fallback),
                 float(np.mean(comparable)) if comparable else fallback, fallback,
                 float(np.mean([v for v in weekly[:2] if math.isfinite(v)])) if any(math.isfinite(v) for v in weekly[:2]) else fallback]
        angle = 2 * math.pi * slot / 96
        season = 2 * math.pi * (day.timetuple().tm_yday - 1) / 365.25
        x = [self.id, slot, local.weekday(), int(local.weekday() >= 5), local.month,
             math.sin(angle), math.cos(angle), math.sin(season), math.cos(season)]
        x += [v / scale for v in lags]
        x += [int(not math.isfinite(v)) for v in lags]
        x += [float(v > threshold) if math.isfinite(v) else float('nan') for v in lags]
        x += [context['d2_mean'] / scale, context['d2_coverage'], older / scale,
              (day - full[0]).days if full else 181,
              (context['issue'] - context['latest']).total_seconds() / 3600 if context['latest'] else 4321]
        if self.contract['feature_profile'] == 'e2_v1':
            reference = self.reference_features(stamp, context, scenario)
            x += [reference[5]/scale, reference[6]/scale, reference[9], reference[10]]
        return x, bases

    def reference_features(self, stamp, context, scenario='none'):
        local = stamp.astimezone(self.zone)
        day, slot = local.date(), local.hour*4 + local.minute//15
        cache = context.setdefault('reference_features', {})
        if (slot, scenario) in cache:
            return cache[(slot, scenario)]
        lag = lambda n: self.lag(day, slot, n, context['issue'], scenario)
        mean = lambda ns: float(np.mean([lag(n) for n in ns]))
        a, w, y = 2*math.pi*slot/96, 2*math.pi*local.weekday()/7, 2*math.pi*(day.timetuple().tm_yday-1)/365.25
        result = [lag(n) for n in (3,4,7,14,28)] + [mean((7,8,9)), mean((7,14)),
            math.sin(a), math.cos(a), math.sin(w), math.cos(w), math.sin(y), math.cos(y), int(local.weekday()>=5)]
        cache[(slot, scenario)] = result
        return result


def training(series, start, stop, available_by):
    latest = {}
    for d in series.dates:
        if start <= d < stop:
            for r in series.days[d]:
                if r[2] <= available_by and (r[0] not in latest or r[2] >= latest[r[0]][2]):
                    latest[r[0]] = r
    return sorted(latest.values())


def fit_estimator(x, y, weights, classification=False, loss="RMSE"):
    if not len(y):
        return 0.0
    if min(y) == max(y):
        return float(y[0])
    common = dict(iterations=POLICY['iterations'], depth=POLICY['depth'], learning_rate=POLICY['learning_rate'],
                  random_seed=POLICY['random_seed'], thread_count=1, verbose=False,
                  allow_writing_files=False, has_time=True, one_hot_max_size=32, cat_features=[0])
    model = CatBoostClassifier(loss_function='Logloss', **common) if classification else CatBoostRegressor(loss_function=loss, **common)
    model.fit(x, y, sample_weight=weights)
    return model


def predict(model, x, classification=False):
    if isinstance(model, float):
        return np.full(len(x), model)
    return model.predict_proba(x)[:, 1] if classification else np.maximum(0, model.predict(x))


class Fit:
    def __init__(self, series, first_day):
        self.contract = series[0].contract
        if any(s.contract != self.contract for s in series):
            raise ValueError('Portfolio contracts differ')
        self.hgb, self.hgb_mae = {}, {}
        self.regime_classifiers, self.regime_amounts, self.regime_metadata = {}, {}, {}
        self.series = series
        self.first_day = first_day
        self.issue = origin(first_day, series[0].zone)
        stop = first_day - dt.timedelta(days=self.contract['latest_measurement_lag']-1)
        start = stop - dt.timedelta(days=POLICY['training_days'])
        self.scales, self.thresholds, self.peaks, self.local, self.metadata = {}, {}, {}, {}, {}
        all_x, all_y, all_weights, all_labels, all_times = [], [], [], [], []
        for s in series:
            rows = training(s, start, stop, self.issue)
            # Remove startup examples lacking any causal weekly/older profile.
            rows = [r for r in rows if r[0].astimezone(s.zone).date() >= s.dates[0] + dt.timedelta(days=35)]
            if len({r[0].astimezone(s.zone).date() for r in rows}) < POLICY['minimum_training_days']:
                raise ValueError(f'{s.id}: at least 84 training days plus 35 lag-history days required before discovery')
            values = [r[1] for r in rows]
            scale = float(np.mean(values)) or 1.0
            threshold = label_transform(values)
            self.scales[s.id], self.thresholds[s.id] = scale, threshold
            self.peaks[s.id] = float(np.quantile(values, .9, method='lower'))
            x, y, contexts, timestamps, hx, rx = [], [], {}, [], [], []
            for stamp, value, _ in rows:
                day = stamp.astimezone(s.zone).date()
                if day not in contexts:
                    contexts[day] = s.day_context(day)
                try:
                    features, _ = s.features(stamp, scale, threshold, contexts[day])
                except ValueError:
                    continue
                hx.append(s.reference_features(stamp, contexts[day])) if self.contract['candidate_set']!='existing' else None
                if self.contract['candidate_set']=='regime':
                    rx.append(regimes.features(s,stamp,contexts[day],scale,threshold,features))
                x.append(features)
                y.append(value / scale)
                timestamps.append(stamp)
            if len(y) < 1344:
                raise ValueError(f'{s.id}: insufficient causal training examples')
            weights = [1 / len(y)] * len(y)
            self.local[s.id] = fit_estimator(x, y, weights)
            if self.contract['candidate_set'] != 'existing':
                estimators = [('squared_error', self.hgb)]
                if self.contract['candidate_set'] in ('extended', 'regime'):
                    estimators.append(('absolute_error', self.hgb_mae))
                for loss, dest in estimators:
                    if min(y) == max(y):
                        dest[s.id] = float(y[0]*scale)
                    else:
                        model = HistGradientBoostingRegressor(loss=loss, max_iter=90, learning_rate=.07,
                            max_leaf_nodes=19, min_samples_leaf=90, l2_regularization=8, max_bins=64,
                            early_stopping=False, random_state=POLICY['random_seed'])
                        with threadpool_limits(limits=1):
                            model.fit(hx, np.asarray(y)*scale)
                        dest[s.id] = model
            if self.contract['candidate_set']=='regime':
                classifier,amounts,state_metadata = regimes.fit(rx,y,threshold/scale,POLICY,fit_estimator)
                self.regime_classifiers[s.id],self.regime_amounts[s.id] = classifier,amounts
                self.regime_metadata[s.id] = {**state_metadata, 'threshold':threshold,
                    'input_feature_names':contracts.feature_names(self.contract)+regimes.FEATURE_NAMES}
            all_x.extend(x); all_y.extend(y); all_weights.extend(weights)
            all_times.extend(timestamps)
            all_labels.extend([int(v * scale > threshold) for v in y])
            self.metadata[s.id] = dict(scale=scale, low_load_threshold=threshold, peak_threshold=self.peaks[s.id],
                                       samples=len(y), training_until=iso(max(r[0] for r in rows)),
                                       maximum_label_available_at=iso(max(r[2] for r in rows)))
        # Sort across ALL series by historical target timestamp, not by series ID.
        # one_hot_max_size avoids target encoding for the <=16 meter IDs.
        # Features contain no future rows; CatBoost fits on the common past only.
        order = sorted(range(len(all_times)), key=lambda i: (all_times[i], all_x[i][0]))
        all_x, all_y, all_weights, all_labels = [[a[i] for i in order] for a in (all_x, all_y, all_weights, all_labels)]
        self.global_model = fit_estimator(all_x, all_y, all_weights)
        self.mae_model = fit_estimator(all_x, all_y, all_weights, loss='MAE') if self.contract['candidate_set'] in ('extended', 'regime') else None
        self.classifier = fit_estimator(all_x, all_labels, all_weights, True)
        active = [i for i, y in enumerate(all_labels) if y]
        low = [i for i, y in enumerate(all_labels) if not y]
        self.active_model = fit_estimator([all_x[i] for i in active], [all_y[i] for i in active], [all_weights[i] for i in active])
        self.low_model = fit_estimator([all_x[i] for i in low], [all_y[i] for i in low], [all_weights[i] for i in low])

    def forecasts(self, s, start, end, scenario='none'):
        stamps, x, baselines, contexts, hx, rx = [], [], [], {}, [], []
        day = start
        while day < end:
            contexts[day] = s.day_context(day, scenario)
            for stamp in slots(day, s.zone):
                features, bases = s.features(stamp, self.scales[s.id], self.thresholds[s.id], contexts[day], scenario)
                hx.append(s.reference_features(stamp, contexts[day], scenario)) if self.contract['candidate_set']!='existing' else None
                if self.contract['candidate_set']=='regime':
                    rx.append(regimes.features(s,stamp,contexts[day],self.scales[s.id],self.thresholds[s.id],features,scenario))
                stamps.append(stamp); x.append(features); baselines.append(bases)
            day += dt.timedelta(days=1)
        probability = predict(self.classifier, x, True)
        active = predict(self.active_model, x)
        low = predict(self.low_model, x)
        predictions = dict(zip(BASELINES, np.asarray(baselines).T))
        scale = self.scales[s.id]
        predictions.update(catboost_global=predict(self.global_model, x) * scale,
                           catboost_local=predict(self.local[s.id], x) * scale,
                           catboost_hurdle=((1-probability)*low + probability*active) * scale)
        if self.contract['candidate_set'] != 'existing':
            with threadpool_limits(limits=1):
                hgb = predict(self.hgb[s.id], hx)
            predictions.update(hgb_local=hgb, hgb_week_75=.75*hgb+.25*predictions['previous_week'])
        if self.contract['candidate_set'] in ('extended', 'regime'):
            with threadpool_limits(limits=1):
                hgb_mae = predict(self.hgb_mae[s.id], hx)
            predictions.update(hgb_mae=hgb_mae, catboost_mae=predict(self.mae_model, x)*scale,
                hurdle_gate=np.where(probability >= .5, active, low)*scale)
        if self.contract['candidate_set']=='regime':
            state_probs=regimes.probabilities(self.regime_classifiers[s.id],rx)
            amounts=np.column_stack([predict(self.regime_amounts[s.id][state],rx) for state in range(3)])*scale
            soft=np.sum(state_probs*amounts,axis=1)
            hard=amounts[np.arange(len(rx)),state_probs.argmax(axis=1)]
            predictions.update(regime_local_soft=soft,regime_local_hard=hard,
                               regime_week_75=.75*soft+.25*predictions['previous_week'])
            for stamp,probs in zip(stamps,state_probs):
                contexts[stamp.astimezone(s.zone).date()].setdefault('state_probabilities',{})[iso(stamp)]=probs.tolist()
        return stamps, predictions, probability, contexts


def scores(actual, predicted):
    if not len(actual):
        return None
    a, p = np.asarray(actual), np.asarray(predicted)
    error = a - p
    absolute = float(np.abs(error).sum())
    denominator = float(np.abs(a).sum())
    return dict(sample_count=len(a), rmse=float(np.sqrt(np.mean(error**2))), mae=absolute/len(a),
                wape_percent=100*absolute/denominator if denominator else None,
                bias=float(error.mean()), mse=float(np.mean(error**2)),
                absolute_error_sum=absolute, actual_absolute_sum=denominator,
                squared_error_sum=float(np.sum(error**2)), cumulative_error=float(error.sum()))


def comparison(fit, s, start, end, asof):
    stamps, forecasts, _, _ = fit.forecasts(s, start, end)
    # Later actual revisions / delayed deliveries cannot select today's model.
    eligible = {r[0] for d in s.dates if start <= d < end for r in s.days[d] if r[2] <= asof}
    idx = [i for i, stamp in enumerate(stamps) if stamp in eligible]
    if len(idx) != len(stamps):
        return None
    actual_by_stamp = {r[0]: r[1] for r in training(s, start, end, asof)}
    actual = [actual_by_stamp[t] for t in stamps]
    return dict(metrics={k: scores(actual, v) for k, v in forecasts.items()},
                operational_diagnostics={k:regimes.describe(actual,v,[fit.thresholds[s.id]]*len(actual)) for k,v in forecasts.items()},
                days={k: [scores([a for t,a in zip(stamps,actual) if t.astimezone(s.zone).date()==d],
                                 [p for t,p in zip(stamps,v) if t.astimezone(s.zone).date()==d])
                          for d in sorted({t.astimezone(s.zone).date() for t in stamps})] for k,v in forecasts.items()},
                weeks={k: [scores([a for t, a in zip(stamps, actual) if start + dt.timedelta(days=7*w) <= t.astimezone(s.zone).date() < start + dt.timedelta(days=7*(w+1))],
                                 [p for t, p in zip(stamps, v) if start + dt.timedelta(days=7*w) <= t.astimezone(s.zone).date() < start + dt.timedelta(days=7*(w+1))])['rmse'] for w in range(4)]
                       for k, v in forecasts.items()})


def choose_mae(discovery, confirmation):
    if discovery is None or confirmation is None:
        return 'weekday_median', dict(reason='validation_actuals_not_available', supported=False)
    baseline = min(BASELINES, key=lambda k: discovery['metrics'][k]['mae'])
    challengers = [k for k in discovery['metrics'] if k not in BASELINES]
    candidate = min(challengers, key=lambda k: discovery['metrics'][k]['mae'])
    b, c = confirmation['metrics'][baseline], confirmation['metrics'][candidate]
    bd, cd = confirmation['days'][baseline], confirmation['days'][candidate]
    differences = [x['absolute_error_sum']-y['absolute_error_sum'] for x,y in zip(bd,cd)]
    counts = [x['sample_count'] for x in bd]
    # Paired moving blocks of seven contiguous local days; DST counts retained.
    rng = random.Random(POLICY['random_seed'])
    boot = []
    for _ in range(1000):
        indices = []
        while len(indices) < len(differences):
            start = rng.randrange(max(1,len(differences)-6))
            indices.extend(range(start,min(start+7,len(differences))))
        indices = indices[:len(differences)]
        boot.append(sum(differences[i] for i in indices)/sum(counts[i] for i in indices))
    boot.sort()
    supported = len(bd)>=28 and b['mae']>0 and c['mae']<=b['mae']*.97 and boot[24]>0
    return candidate if supported else baseline, dict(supported=bool(supported), baseline=baseline,
        discovery_winner=candidate, confirmation_baseline=b, confirmation_candidate=c,
        objective='mae', minimum_relative_gain=.03, bootstrap_block_days=7,
        selected_operational_diagnostics=confirmation.get('operational_diagnostics',{}).get(candidate if supported else baseline),
        mae_daily_block_reduction_interval=[float(boot[24]),float(boot[975])],
        reason='confirmed_mae_gain' if supported else 'baseline_preserved')


def choose(discovery, confirmation, objective="rmse"):
    if objective == "mae":
        return choose_mae(discovery, confirmation)
    if discovery is None or confirmation is None:
        return 'weekday_median', dict(reason='validation_actuals_not_available', supported=False)
    baseline = min(BASELINES, key=lambda k: discovery['metrics'][k]['rmse'])
    candidate = min(BOOSTS, key=lambda k: discovery['metrics'][k]['rmse'])
    b, c = confirmation['metrics'][baseline], confirmation['metrics'][candidate]
    diffs = np.asarray(confirmation['weeks'][baseline]) - np.asarray(confirmation['weeks'][candidate])
    rng = random.Random(POLICY['random_seed'])
    boot = sorted(sum(rng.choices(list(diffs), k=4))/4 for _ in range(1000))
    supported = (b['rmse'] > 0 and c['rmse'] <= b['rmse'] * .97 and c['mae'] <= b['mae']
                 and int(np.sum(diffs > 0)) >= 3 and boot[24] > 0)
    return candidate if supported else baseline, dict(supported=bool(supported), baseline=baseline,
           discovery_winner=candidate, confirmation_baseline=b, confirmation_candidate=c,
           rmse_weekly_reduction_interval=[float(boot[24]), float(boot[975])],
           reason='confirmed_rmse_gain_and_mae_guard' if supported else 'baseline_preserved')


def diagnostics(values, unit):
    actual = [v['actual_value'] for v in values]
    predicted = [v['predicted_value'] for v in values]
    daily = defaultdict(lambda: [0, 0])
    seasons = defaultdict(list)
    for v in values:
        daily[v['forecast_for']][0] += v['actual_value']
        daily[v['forecast_for']][1] += v['predicted_value']
        month = int(v['forecast_for'][5:7])
        seasons['winter' if month in (12, 1, 2) else 'spring' if month < 6 else 'summer' if month < 9 else 'autumn'].append(v)
    factor = .25 if unit == 'kW' else 1
    energy_errors = [(p-a)*factor for a, p in daily.values()]
    def subset(predicate):
        items = [v for v in values if predicate(v)]
        return scores([v['actual_value'] for v in items], [v['predicted_value'] for v in items])
    q95 = float(np.quantile(actual,.95))
    ramps = [abs(actual[i]-actual[i-1]) for i in range(1,len(actual))]
    ramp_limit = float(np.quantile(ramps,.95)) if ramps else 0
    ramp_stamps = {values[i]['timestamp'] for i in range(1,len(values)) if abs(actual[i]-actual[i-1])>ramp_limit}
    transitions = {values[i]['timestamp'] for i in range(1,len(values)) if actual[i-1]==0 and actual[i]>0}
    labeled = [v for v in values if v['selected_model'] in ('catboost_hurdle','hurdle_gate')]
    tp = sum(v['active_probability'] >= .5 and v['actual_value'] > v['low_load_threshold'] for v in labeled)
    positives = sum(v['actual_value'] > v['low_load_threshold'] for v in labeled)
    predicted_positives = sum(v['active_probability'] >= .5 for v in labeled)
    state_probabilities=[v.get('state_probabilities') for v in values]
    training_prior=[v.get('state_training_prior') for v in values]
    return dict(operational=regimes.describe(actual,predicted,[v['low_load_threshold'] for v in values],
                    state_probabilities if all(v is not None for v in state_probabilities) else None,
                    training_prior if all(v is not None for v in training_prior) else None),
                overall=scores(actual, predicted), daily_energy_mae_kwh=float(np.mean(np.abs(energy_errors))),
                daily_energy_bias_kwh=float(np.mean(energy_errors)),
                zero_intervals=subset(lambda v: v['actual_value'] == 0),
                active_intervals=subset(lambda v: v['actual_value'] > v['low_load_threshold']),
                peaks=subset(lambda v: v['actual_value'] > v['peak_threshold']),
                retrospective_top_5_percent=subset(lambda v:v['actual_value']>q95),
                retrospective_large_ramps=subset(lambda v:v['timestamp'] in ramp_stamps),
                zero_to_positive=subset(lambda v:v['timestamp'] in transitions),
                activity=dict(interval_count=len(labeled), precision=tp/predicted_positives if predicted_positives else None,
                              recall=tp/positives if positives else None,
                              brier_score=float(np.mean([(v['active_probability']-int(v['actual_value'] > v['low_load_threshold']))**2 for v in labeled])) if labeled else None),
                seasons={k: scores([v['actual_value'] for v in vs], [v['predicted_value'] for v in vs]) for k, vs in seasons.items()})


def evaluate(payload, progress=lambda p: None):
    config = payload['configuration']
    workspace = payload.get('_workspace')
    blocks = []
    contract = contracts.normalize(config.get('portfolio_method'))
    series = [Series(s, contract) for s in payload['series']]
    start = dt.date.fromisoformat(config['forecast_period_from'])
    end = dt.date.fromisoformat(config['forecast_period_until']) + dt.timedelta(days=1)
    outputs = {s.id: [] for s in series}
    selections = {s.id: [] for s in series}
    stress = {s.id: {name: [] for name in SCENARIOS} for s in series}
    current = start
    frozen_bundle = None
    while current < end:
        stop = min(end, current + dt.timedelta(days=28))
        if workspace:
            cached = persistence.load_block(workspace, current)
            if cached:
                blocks.append(cached)
                progress(dict(phase='checkpoint_reused', completed_days=(stop-start).days*len(series), total_days=(end-start).days*len(series), percent=98*(stop-start).days/(end-start).days, message=f'Reused durable block {current}'))
                current = stop
                continue
        frozen = contract['training_mode'] == 'frozen'
        fit_day = start if frozen else current
        confirmation_end = fit_day - dt.timedelta(days=contract['latest_measurement_lag']-1)
        confirmation_start = confirmation_end - dt.timedelta(days=28)
        discovery_start = confirmation_start - dt.timedelta(days=28)
        asof = origin(fit_day, series[0].zone)
        artifact = Path(workspace)/'frozen-fit' if workspace and frozen else None
        if frozen_bundle is None and artifact and (artifact/'model.json').exists():
            from runtime import load_fit
            fitted, manifest = load_fit(artifact)
            fitted.series = series
            frozen_bundle = (fitted, manifest['evidence'])
        if frozen and frozen_bundle:
            fitted, bundle = frozen_bundle
            discovery, confirmation = bundle['discovery'], bundle['confirmation']
            discovery_training, confirmation_training = bundle['discovery_training'], bundle['confirmation_training']
            selected = bundle['selected']
        else:
            progress(dict(phase='portfolio_training', completed_days=(current-start).days * len(series),
                          total_days=(end-start).days * len(series), percent=98*(current-start).days/(end-start).days,
                          message=f'Fitting common discovery/confirmation/final models for {fit_day}'))
            discovery_fit = Fit(series, discovery_start)
            discovery = {s.id: comparison(discovery_fit, s, discovery_start, confirmation_start, asof) for s in series}
            discovery_training = discovery_fit.metadata
            del discovery_fit
            confirmation_fit = Fit(series, confirmation_start)
            confirmation = {s.id: comparison(confirmation_fit, s, confirmation_start, confirmation_end, asof) for s in series}
            confirmation_training = confirmation_fit.metadata
            del confirmation_fit
            selected = {s.id: choose(discovery[s.id], confirmation[s.id], contract['selection_objective']) for s in series}
            fitted = Fit(series, fit_day)
            if frozen:
                bundle = dict(discovery=discovery, confirmation=confirmation, selected=selected,
                              discovery_training=discovery_training, confirmation_training=confirmation_training)
                frozen_bundle = (fitted,bundle)
                if artifact:
                    from runtime import save_fit
                    save_fit(fitted,artifact,{k:v[0] for k,v in selected.items()},bundle,{})
        for index, s in enumerate(series):
            name, evidence = selected[s.id]
            if not frozen or current == start:
                selections[s.id].append(dict(as_of=iso(asof), forecast_from=str(current), forecast_until_exclusive=str(end if frozen else stop), selected_model=name,
                                             discovery_from=str(discovery_start), confirmation_from=str(confirmation_start),
                                             discovery=discovery[s.id], confirmation=confirmation[s.id], evidence=evidence,
                                             training=fitted.metadata, discovery_training=discovery_training,
                                             confirmation_training=confirmation_training, policy=POLICY))
            stamps, candidates, probability, contexts = fitted.forecasts(s, current, stop)
            for i, stamp in enumerate(stamps):
                day = stamp.astimezone(s.zone).date()
                ctx = contexts[day]
                # Include later eligible feature history in the provenance ceiling.
                used_until = max(dt.datetime.fromisoformat(m['training_until'].replace('Z', '+00:00')) for m in fitted.metadata.values())
                if ctx['latest'] is not None:
                    used_until = max(used_until, ctx['latest'])
                outputs[s.id].append(dict(series_id=s.id, timestamp=iso(stamp), forecast_for=str(day),
                    forecast_created_at=iso(ctx['issue']), training_data_until=iso(used_until), unit=s.unit,
                    model_training_until=max(m['training_until'] for m in fitted.metadata.values()),
                    feature_measurement_until=iso(ctx['latest']) if ctx['latest'] else None,
                    method_version=VERSION, data_version=payload.get('_identity', SOURCE_SHA256),
                    model_fit_origin=iso(fitted.issue), benchmark_contract=contract,
                    actual_value=s.actual[stamp], predicted_value=float(candidates[name][i]), selected_model=name,
                    active_probability=float(probability[i]) if name in ('catboost_hurdle','hurdle_gate') else None,
                    candidate_active_probability=float(probability[i]),
                    state_probabilities=ctx.get('state_probabilities',{}).get(iso(stamp)),
                    state_training_prior=fitted.regime_metadata.get(s.id,{}).get('training_probabilities'),
                    low_load_threshold=fitted.thresholds[s.id], peak_threshold=fitted.peaks[s.id],
                    feature_set=['history', 'calendar'], predictors=['weekday', 'month'],
                    input_availability=dict(last_complete_day=str(ctx['full'][0]) if ctx['full'] else None, latest_day_coverage=ctx['d2_coverage'], latest_measurement_lag=contract['latest_measurement_lag']),
                    candidate_predictions={k: float(v[i]) for k, v in candidates.items()}))
            if config.get('portfolio_stress_test', True):
                for scenario in SCENARIOS:
                    _, alternatives, _, _ = fitted.forecasts(s, current, stop, scenario)
                    stress[s.id][scenario].extend(float(v) for v in alternatives[name])
            progress(dict(phase='portfolio_block_completed', completed_days=(current-start).days*len(series)+(stop-current).days*(index+1),
                          total_days=(end-start).days*len(series), percent=98*((current-start).days*len(series)+(stop-current).days*(index+1))/((end-start).days*len(series)), message=f'{s.id}: completed through {stop-dt.timedelta(days=1)}'))
        del fitted
        if workspace:
            persistence.save_block(workspace, current, dict(outputs=outputs, selections=selections, stress=stress))
            blocks.append(persistence.load_block(workspace, current))
            outputs = {s.id: [] for s in series}
            selections = {s.id: [] for s in series}
            stress = {s.id: {name: [] for name in SCENARIOS} for s in series}
            progress(dict(phase='checkpoint_saved', completed_days=(stop-start).days*len(series), total_days=(end-start).days*len(series), percent=98*(stop-start).days/(end-start).days, message=f'Durable block through {stop-dt.timedelta(days=1)}'))
        current = stop
    results = []
    for s in series:
        progress(dict(phase='aggregating_series', completed_days=(end-start).days*len(series), total_days=(end-start).days*len(series), percent=98, message=f'Aggregating and saving {s.id}'))
        if workspace:
            outputs[s.id], selections[s.id] = [], []
            for block in blocks:
                data = persistence.read(block)
                outputs[s.id].extend(data['outputs'][s.id])
                selections[s.id].extend(data['selections'][s.id])
                for name in SCENARIOS:
                    stress[s.id][name].extend(data['stress'][s.id][name])
                del data
        values = outputs[s.id]
        metric = diagnostics(values, s.unit)
        backtest = metric['overall']
        backtest.update(coverage=1.0, expected_intervals=len(values))
        actual = [v['actual_value'] for v in values]
        run = dict(series_id=s.id, model_version=VERSION, benchmark_contract=contract, model_family='portfolio_catboost',
                   mode='rolling_day_ahead', relationship_mode='auto', issue_time='07:00', timezone=str(s.zone),
                   forecast_period_from=str(start), forecast_period_until=str(end-dt.timedelta(days=1)),
                   status='completed', prediction_threshold_w=0, requested_feature_set=['history', 'calendar'],
                   availability_policy=f'D-{contract["latest_measurement_lag"]} inclusive AND available_at <= D-1 07:00 local; common portfolio training origin',
                   portfolio_series_ids=[item.id for item in series], policy=POLICY,
                   dependencies=dict(catboost=CATBOOST_VERSION, numpy=np.__version__, sklearn=SKLEARN_VERSION),
                   source_sha256=SOURCE_SHA256)
        hurdle_values = [{**v, 'predicted_value': v['candidate_predictions']['catboost_hurdle'],
                          'selected_model': 'catboost_hurdle', 'active_probability': v['candidate_active_probability']} for v in values]
        item = dict(forecast_run=run, validation=s.validation, forecast_values=values,
                            hurdle_diagnostics=diagnostics(hurdle_values, s.unit),
                            backtest=backtest, diagnostics=metric,
                            benchmark_metrics={k: scores(actual, [v['candidate_predictions'][k] for v in values]) for k in values[0]['candidate_predictions']},
                            stress_metrics={k: scores(actual, v) for k, v in stress[s.id].items() if v},
                            relationship_analysis=dict(version=VERSION, selections=selections[s.id]),
                            readiness_dossier=dict(warnings=['development_evidence_not_independent_validation',
                                                            'historical_availability_assumed_next_midnight_unless_supplied'], testcaseBoundary=payload.get('testcaseBoundary', {})))
        if workspace:
            filename = hashlib.sha256(s.id.encode()).hexdigest() + '.json.gz'
            target = Path(workspace) / 'results' / filename
            persistence.atomic(target, item)
            results.append(dict(series_id=s.id, file=filename, sha256=persistence.digest(target), backtest=backtest))
            outputs[s.id], selections[s.id], stress[s.id] = [], [], {}
            del item, values, hurdle_values
        else:
            results.append(item)
    return dict(status='completed', **({'result_manifest': results} if workspace else {'results': results}), testcaseBoundary=payload.get('testcaseBoundary', {}))


if __name__ == '__main__':
    from runtime import main
    main()
