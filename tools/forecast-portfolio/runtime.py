"""Durable backtest execution and native CatBoost artifacts shared by REST inference."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys
import numpy as np
from catboost import CatBoostClassifier, CatBoostRegressor
import skops.io as sio
import skops
import contracts
import engine as e
import persistence as p


def models(fit):
    return {'global': fit.global_model, 'classifier': fit.classifier,
            'active': fit.active_model, 'low': fit.low_model,
            **({'mae': fit.mae_model} if fit.mae_model is not None else {}),
            **{'hgb:' + k: v for k,v in fit.hgb.items()},
            **{'hgb_mae:' + k: v for k,v in fit.hgb_mae.items()},
            **{'regime_classifier:' + k:v for k,v in fit.regime_classifiers.items()},
            **{f'regime_amount:{k}:{state}':v for k,states in fit.regime_amounts.items() for state,v in states.items()},
            **{'local:' + k: v for k, v in fit.local.items()}}


def save_fit(fit, directory, selected, evidence, history_versions):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    entries = {}
    for key, model in models(fit).items():
        if isinstance(model, float):
            entries[key] = dict(constant=model)
        else:
            hgb = key.startswith(('hgb:', 'hgb_mae:'))
            name = hashlib.sha256(key.encode()).hexdigest() + ('.skops' if hgb else '.cbm')
            temp = directory / (name + '.tmp')
            if hgb:
                sio.dump(model, temp)
            else:
                model.save_model(str(temp))
            os.chmod(temp, 0o600)
            with temp.open('rb') as f:
                os.fsync(f.fileno())
            os.replace(temp, directory / name)
            entries[key] = dict(file=name, sha256=p.digest(directory / name))
    manifest = dict(schema=1, method=e.VERSION, engine_sha256=e.SOURCE_SHA256,
        catboost=e.CATBOOST_VERSION, numpy=np.__version__, sklearn=e.SKLEARN_VERSION, skops=skops.__version__,
        benchmark_contract=fit.contract, first_day=str(fit.first_day),
        information_as_of=e.iso(fit.issue), created_at=e.iso(dt.datetime.now(e.UTC)),
        next_refit_date=str(fit.first_day + dt.timedelta(days=28)),
        scales=fit.scales, thresholds=fit.thresholds, peaks=fit.peaks,
        metadata=fit.metadata, regime_metadata=fit.regime_metadata, selected=selected, evidence=evidence,
        history_versions=history_versions, models=entries, policy=e.POLICY,
        feature_contract=dict(issue_time='07:00', latest_measurement_day=f'D-{fit.contract["latest_measurement_lag"]}',
            scaling='training_mean_per_series; HGB uses raw kWh/kW', missing_values='NaN, never observed zero',
            names=contracts.feature_names(fit.contract)),
        identities={s.id: dict(timezone=str(s.zone), unit=s.unit) for s in fit.series})
    p.atomic(directory / 'model.json', manifest)
    return manifest


def load_fit(directory):
    directory = Path(directory)
    m = p.read(directory / 'model.json')
    if m['engine_sha256'] != e.SOURCE_SHA256 or m['catboost'] != e.CATBOOST_VERSION or m['numpy'] != np.__version__ or m.get('sklearn') != e.SKLEARN_VERSION or m.get('skops') != skops.__version__:
        raise ValueError('Model code/dependency version mismatch; retrain explicitly')
    fit = e.Fit.__new__(e.Fit)
    fit.contract = contracts.normalize(m['benchmark_contract'])
    fit.first_day = dt.date.fromisoformat(m['first_day'])
    fit.issue = dt.datetime.fromisoformat(m['information_as_of'].replace('Z','+00:00'))
    fit.scales, fit.thresholds, fit.peaks, fit.metadata = m['scales'], m['thresholds'], m['peaks'], m['metadata']
    loaded = {}
    for key, entry in m['models'].items():
        if 'constant' in entry:
            loaded[key] = float(entry['constant'])
        else:
            name = entry['file']
            if Path(name).name != name or p.digest(directory / name) != entry['sha256']:
                raise ValueError('Model checksum mismatch')
            if key.startswith(('hgb:', 'hgb_mae:')):
                # Pinned HGB types are supported by skops defaults; never trust archive-provided types.
                if sio.get_untrusted_types(file=directory/name):
                    raise ValueError('Untrusted model types')
                model = sio.load(directory/name, trusted=[])
            else:
                model = CatBoostClassifier() if key == 'classifier' or key.startswith('regime_classifier:') else CatBoostRegressor()
                model.load_model(str(directory / name))
            loaded[key] = model
    fit.global_model, fit.classifier = loaded['global'], loaded['classifier']
    fit.active_model, fit.low_model = loaded['active'], loaded['low']
    fit.regime_metadata=m.get('regime_metadata',{})
    fit.regime_classifiers={k[len('regime_classifier:'):]:v for k,v in loaded.items() if k.startswith('regime_classifier:')}
    fit.regime_amounts={}
    for k,v in loaded.items():
        if k.startswith('regime_amount:'):
            identity,state=k[len('regime_amount:'):].rsplit(':',1)
            fit.regime_amounts.setdefault(identity,{})[int(state)]=v
    fit.mae_model = loaded.get('mae')
    fit.hgb = {k[4:]:v for k,v in loaded.items() if k.startswith('hgb:')}
    fit.hgb_mae = {k[8:]:v for k,v in loaded.items() if k.startswith('hgb_mae:')}
    fit.local = {k[6:]: v for k, v in loaded.items() if k.startswith('local:')}
    return fit, m


def train(payload, progress):
    contract = contracts.normalize(payload.get('portfolio_method'))
    series = [e.Series(s, contract) for s in payload['series']]
    day = dt.date.fromisoformat(payload['forecast_for'])
    asof = e.origin(day, series[0].zone)
    confirmation_end = day-dt.timedelta(days=contract['latest_measurement_lag']-1)
    confirmation_start = confirmation_end-dt.timedelta(days=28)
    discovery_start = confirmation_start-dt.timedelta(days=28)
    evidence, selected = {}, {}
    progress(dict(phase='training', completed_days=0, total_days=3, percent=0, message='Discovery fit'))
    fit = e.Fit(series, discovery_start)
    discovery = {s.id: e.comparison(fit,s,discovery_start,confirmation_start,asof) for s in series}
    discovery_training = fit.metadata
    del fit
    progress(dict(phase='training', completed_days=1, total_days=3, percent=30, message='Confirmation fit'))
    fit = e.Fit(series, confirmation_start)
    confirmation = {s.id: e.comparison(fit,s,confirmation_start,confirmation_end,asof) for s in series}
    confirmation_training = fit.metadata
    del fit
    for s in series:
        selected[s.id], guard = e.choose(discovery[s.id], confirmation[s.id], contract["selection_objective"])
        evidence[s.id] = dict(discovery=discovery[s.id], confirmation=confirmation[s.id], guard=guard,
            discovery_training=discovery_training, confirmation_training=confirmation_training)
    progress(dict(phase='training', completed_days=2, total_days=3, percent=65, message='Deployment fit'))
    fit = e.Fit(series, day)
    for s in series:
        last = dt.datetime.fromisoformat(fit.metadata[s.id]['training_until'].replace('Z','+00:00'))
        if (asof-last).total_seconds() > 7*86400:
            raise ValueError(f'{s.id}: current training measurements required (maximum age 7 days)')
    manifest = save_fit(fit, payload['_workspace'], selected, evidence, payload['history_versions'])
    return dict(status='completed', model_version=payload['_identity'], model=manifest)


def forecast(payload):
    fitted, manifest = load_fit(payload['_artifact_dir'])
    s = e.Series(payload['series'][0], manifest['benchmark_contract'])
    if s.id not in manifest['identities'] or manifest['identities'][s.id] != dict(timezone=str(s.zone),unit=s.unit):
        raise ValueError('Model series identity mismatch')
    day = dt.date.fromisoformat(payload['forecast_for'])
    if day < dt.date.fromisoformat(manifest['first_day']):
        raise ValueError('Model trained after requested forecast origin')
    stale = str(day) >= manifest['next_refit_date']
    if stale and not payload.get('allow_stale_model', False):
        raise ValueError('model_refit_due: train a new version or explicitly allow stale model')
    stamps, candidates, probability, contexts = fitted.forecasts(s,day,day+dt.timedelta(days=1))
    name = manifest['selected'][s.id]
    ctx = contexts[day]
    warnings = ['model_refit_due'] if stale else []
    if ctx['d2_coverage'] < 1:
        warnings.append('incomplete_latest_day_history_using_causal_fallbacks')
    quality=manifest.get('evidence',{}).get(s.id,{}).get('guard',{}).get('selected_operational_diagnostics')
    if quality:
        warnings.extend('validation_'+w for w in quality.get('warnings',[]))
    values = [dict(timestamp=e.iso(t), predicted_value=float(candidates[name][i]),
        active_probability=float(probability[i]) if name in ('catboost_hurdle','hurdle_gate') else None,
        state_probabilities=ctx.get('state_probabilities',{}).get(e.iso(t))) for i,t in enumerate(stamps)]
    return dict(status='completed', series_id=s.id, model_version=payload['model_version'],
        history_version=payload['history_versions'][s.id], selected_model=name, unit=s.unit,
        timezone=str(s.zone), forecast_for=str(day), information_as_of=e.iso(ctx['issue']),
        generated_at=e.iso(dt.datetime.now(e.UTC)), model_created_at=manifest['created_at'],
        model_training=manifest['metadata'], next_refit_date=manifest['next_refit_date'],
        last_measurement_used=e.iso(ctx['latest']) if ctx['latest'] else None,
        last_complete_day=str(ctx['full'][0]) if ctx['full'] else None,
        latest_day_coverage=ctx['d2_coverage'], benchmark_contract=fitted.contract, low_load_threshold=fitted.thresholds[s.id],
        daily_energy_kwh=sum(v['predicted_value'] for v in values)*(.25 if s.unit=='kW' else 1),
        warnings=warnings, forecast_values=values)


def execute(payload, progress):
    workspace = payload.get('_workspace')
    if not workspace:
        return e.evaluate(payload, progress)
    with p.locked(workspace):
        marker = Path(workspace) / 'identity.json'
        expected = dict(identity=payload['_identity'], engine_sha256=e.SOURCE_SHA256,
                        catboost=e.CATBOOST_VERSION, numpy=np.__version__, sklearn=e.SKLEARN_VERSION, skops=skops.__version__,
                        contract=contracts.normalize(payload.get('portfolio_method',payload.get('configuration',{}).get('portfolio_method'))))
        if marker.exists() and p.read(marker) != expected:
            raise ValueError('Resume identity/code/dependency mismatch')
        p.atomic(marker, expected)
        complete = Path(workspace) / 'result.json'
        if complete.exists():
            return p.read(complete)
        operation = payload.get('_operation', 'backtest')
        if payload.get('_product'):
            import product
            result = product.train(payload, progress) if operation == 'train' else product.forecast(payload)
        elif operation == 'train':
            result = train(payload, progress)
        elif operation == 'predict':
            result = forecast(payload)
        else:
            result = e.evaluate(payload, progress)
        result['run_id'] = payload['_identity']
        p.atomic(complete, result)
        return result


def main():
    # Linux worker must not outlive a killed/reloaded broker, including SIGKILL.
    if sys.platform.startswith('linux') and os.environ.get('FORECAST_PARENT_PID'):
        import ctypes
        import signal
        if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
            raise OSError('Cannot establish parent-death signal')
        if os.getppid() != int(os.environ['FORECAST_PARENT_PID']):
            sys.exit(1)
    try:
        payload = json.load(sys.stdin)
        result = execute(payload, lambda value: e.emit(dict(type='progress',progress=value)))
        e.emit(dict(type='result',result=result))
    except Exception as error:
        e.emit(dict(type='error',message=f'{type(error).__name__}: {error}'))
        sys.exit(1)
