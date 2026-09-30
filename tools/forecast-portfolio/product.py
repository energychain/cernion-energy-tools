"""Tenant-private adaptation over an immutable, shared evidence corpus.

No contributor identifiers, scales, rows or local models are returned to callers.
The common estimator uses normalized profiles, never a meter/tenant ID feature.
"""
import datetime as dt
import hashlib
import math
from pathlib import Path
import shutil

import numpy as np
from catboost import CatBoostRegressor
import engine as e
import persistence as p

VERSION = 'shared_baseline_0700_v1'
POLICY = dict(minimum_history_days=28, lag_warmup_days=7, short_validation_days=7,
              validation_days=28, training_days=180, max_examples_per_meter=4096,
              iterations=90, depth=5, learning_rate=.05, seed=73471)
FEATURES = ['profile_label', 'slot_sin', 'slot_cos', 'weekday', 'year_sin', 'year_cos',
            'lag_3', 'lag_4', 'lag_7', 'lag_14', 'lag_28', 'weekly_median',
            'weekly_zero_fraction', 'recent_mean', 'recent_zero_fraction',
            'reactive_3', 'reactive_7', 'reactive_3_missing', 'reactive_7_missing']


def digest_json(value):
    import json
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class Meter:
    def __init__(self, data):
        self.data = data
        self.s = e.Series(data, dict(latest_measurement_lag=3, feature_profile='e2_v1',
            selection_objective='mae', candidate_set='extended', training_mode='rolling'))
        self.aux = {}
        for ms, value, available, *_ in data.get('auxiliary_rows', []):
            stamp = dt.datetime.fromtimestamp(ms/1000, e.UTC).astimezone(self.s.zone)
            self.aux.setdefault((stamp.date(), stamp.hour*4+stamp.minute//15), []).append((ms, value, available))
        self.contexts = {}

    def features(self, stamp, scale, enhanced):
        s = self.s
        local = stamp.astimezone(s.zone)
        day, slot = local.date(), local.hour*4+local.minute//15
        issue = e.origin(day, s.zone)
        ctx = self.contexts.setdefault(day, {})
        if not ctx:
            ctx.update(s.day_context(day))
            rows = [r for d in s.dates if day-dt.timedelta(days=14) <= d <= day-dt.timedelta(days=3)
                    for r in s.observed(s.days[d], day, issue, 'none')]
            ctx['mean'] = float(np.mean([r[1] for r in rows])) if rows else float('nan')
            ctx['zero'] = float(np.mean([r[1] == 0 for r in rows])) if rows else float('nan')
        lags = [s.lag(day, slot, n, issue, 'none') for n in (3,4,7,14,28)]
        weekly = [s.lag(day, slot, n, issue, 'none') for n in (7,14,21,28)]
        weekly = [v for v in weekly if math.isfinite(v)]
        if weekly:
            base = float(np.median(weekly))
        elif ctx['full']:
            base = s.lag(day, slot, (day-ctx['full'][0]).days, issue, 'none')
        else:
            raise ValueError('No causal reference profile available')
        profile = 'unknown'
        if enhanced:
            for revision in sorted(self.data.get('profile_revisions', []), key=lambda r:r['available_at']):
                if revision['available_at'] <= issue.timestamp()*1000:
                    profile = revision['label']
        q = []
        for lag in (3,7):
            known = [r for r in self.aux.get((day-dt.timedelta(days=lag),slot), [])
                     if r[2] <= issue.timestamp()*1000] if enhanced else []
            latest = max(enumerate(known), key=lambda pair:(pair[1][2],pair[0]))[1] if known else None
            # kvar / kW scale; input energy is per 15-minute interval.
            denom = scale*(4 if s.unit == 'kWh' else 1)
            q.append(latest[1]/denom if latest and latest[1] is not None else float('nan'))
        a, y = 2*math.pi*slot/96, 2*math.pi*(day.timetuple().tm_yday-1)/365.25
        return [profile,math.sin(a),math.cos(a),local.weekday(),math.sin(y),math.cos(y),
                *[v/scale for v in lags],base/scale,
                float(np.mean([v==0 for v in weekly])) if weekly else float('nan'),
                ctx['mean']/scale,ctx['zero'],*q,*[int(not math.isfinite(v)) for v in q]], base


def available_rows(meter, stop, asof):
    start = max(meter.s.dates[0], stop-dt.timedelta(days=POLICY['training_days']+7))
    return e.training(meter.s, start, stop, asof)


def fit_data(meter, stop, asof, enhanced):
    rows = available_rows(meter, stop, asof)
    if not rows:
        return [], [], 1.0
    scale = float(np.mean([r[1] for r in rows])) or 1.0
    eligible = [r for r in rows if r[0].astimezone(meter.s.zone).date() >= meter.s.dates[0]+dt.timedelta(days=7)]
    if len(eligible) > POLICY['max_examples_per_meter']:
        eligible = [eligible[i] for i in np.linspace(0,len(eligible)-1,POLICY['max_examples_per_meter'],dtype=int)]
    x, y = [], []
    for stamp, value, _ in eligible:
        try:
            features, _ = meter.features(stamp,scale,enhanced)
        except ValueError:
            continue
        x.append(features); y.append(value/scale)
    return x,y,scale


def fit_model(x, y, weights):
    if not y:
        raise ValueError('Insufficient causal training examples')
    if min(y)==max(y):
        return float(y[0])
    model = CatBoostRegressor(iterations=POLICY['iterations'],depth=POLICY['depth'],
        learning_rate=POLICY['learning_rate'],random_seed=POLICY['seed'],thread_count=1,
        loss_function='MAE',cat_features=[0],verbose=False,allow_writing_files=False)
    model.fit(x,y,sample_weight=weights)
    return model


def fit_panel(meters, stop, asof, enhanced):
    x,y,w = [],[],[]
    for meter in meters:
        # Older contributors remain useful; each contributes equal total weight.
        end = min(stop,meter.s.dates[-1]+dt.timedelta(days=1))
        mx,my,_ = fit_data(meter,end,asof,enhanced)
        x.extend(mx);y.extend(my);w.extend([1/len(my)]*len(my) if my else [])
    return fit_model(x,y,w)


def estimate(model,x,scale):
    return e.predict(model,x)*scale


def save_model(model,directory,name):
    if isinstance(model,float):
        return dict(constant=model)
    file = name+'.cbm'
    temp=directory/(file+'.tmp')
    model.save_model(str(temp))
    import os
    os.chmod(temp,0o600)
    os.replace(temp,directory/file)
    return dict(file=file,sha256=p.digest(directory/file))


def load_model(directory,entry):
    if 'constant' in entry:
        return float(entry['constant'])
    file=entry['file']
    if Path(file).name!=file or p.digest(directory/file)!=entry['sha256']:
        raise ValueError('Model checksum mismatch')
    model=CatBoostRegressor(); model.load_model(str(directory/file)); return model


def reference_meters(payload):
    meters=[]
    root=Path(payload['_shared_root'])
    for ref in payload.get('reference_snapshots',[]):
        version=ref['version']
        if len(version)!=64 or any(c not in '0123456789abcdef' for c in version):
            raise ValueError('Invalid shared reference')
        item=p.read(root/'snapshots'/(version+'.json.gz'))
        if digest_json(item)!=version:
            raise ValueError('Shared reference checksum mismatch')
        meters.append(Meter(item))
    return meters


def train(payload,progress):
    own=[Meter(s) for s in payload['series']]
    refs=reference_meters(payload)
    day=dt.date.fromisoformat(payload['forecast_for'])
    asof=e.origin(day,own[0].s.zone);stop=day-dt.timedelta(days=2)
    spans=[]
    for m in own:
        rows=available_rows(m,stop,asof)
        dates={r[0].astimezone(m.s.zone).date() for r in rows}
        if len(dates)<28:
            raise ValueError(f'{m.s.id}: at least 28 observed history days required before D-2; missing history is not zero')
        if (asof-max(r[0] for r in rows)).total_seconds()>7*86400:
            raise ValueError(f'{m.s.id}: current measurements required (maximum age 7 days)')
        spans.append(len(dates))
    validation_days=28 if min(spans)>=84 else 7
    split=stop-dt.timedelta(days=validation_days)
    # All own and donor labels are cut off before validation. No target-week labels in the common fit.
    cut_asof=e.origin(split,own[0].s.zone)
    fit_stop=split-dt.timedelta(days=2)
    import starter
    starter_model, starter_status = starter.candidate(payload, own, cut_asof)
    common={}
    for enhanced in (False,True):
        common[enhanced]=fit_panel(refs+own,fit_stop,cut_asof,enhanced)
    selected,evidence,scales,local_models={}, {}, {}, {}
    for idx,m in enumerate(own):
        progress(dict(phase='training',completed_days=idx,total_days=len(own)+1,percent=int(idx*80/len(own)),message='Validating private meter adaptation'))
        tx,ty,scale=fit_data(m,fit_stop,cut_asof,False)
        if len(ty)<96*7:
            raise ValueError(f'{m.s.id}: at least seven days of usable causal training examples required')
        local=fit_model(tx,ty,[1/len(ty)]*len(ty))
        rows=e.training(m.s,split,stop,asof)
        xs,xe,bases,actual=[],[],[],[]
        for stamp,value,_ in rows:
            try:
                x,base=m.features(stamp,scale,False)
                z,_=m.features(stamp,scale,True)
            except ValueError:
                continue
            xs.append(x);xe.append(z);bases.append(base);actual.append(value)
        if len(actual)<96*3:
            raise ValueError(f'{m.s.id}: insufficient validation coverage')
        preds={'weekly_reference':np.asarray(bases), 'local':estimate(local,xs,scale),
               'baseline':estimate(common[False],xs,scale), 'baseline_optional':estimate(common[True],xe,scale)}
        if starter_model is not None:
            preds['public_starter'] = estimate(starter_model,xs,scale)
        maes={k:float(np.mean(np.abs(v-np.asarray(actual)))) for k,v in preds.items()}
        champion=min(('weekly_reference','local','baseline'),key=lambda k:maes[k])
        if 'public_starter' in maes and maes['public_starter'] < maes[champion]*.97:
            champion='public_starter'
        # Optional evidence must beat the existing champion, never displace it on failed confirmation.
        selected[m.s.id]='baseline_optional' if maes['baseline_optional']<maes[champion]*.97 else champion
        evidence[m.s.id]=dict(validation_from=str(split),validation_until_exclusive=str(stop),
            sample_count=len(actual),mae=maes,selected=selected[m.s.id],
            public_starter_status=starter_status,
            provisional=min(spans)<84,quality_claim='chronological_validation_only')
        tx,ty,scale=fit_data(m,stop,asof,False)
        scales[m.s.id]=scale
        local_models[m.s.id]=fit_model(tx,ty,[1/len(ty)]*len(ty))
    progress(dict(phase='training',completed_days=len(own),total_days=len(own)+1,percent=85,message='Fitting shared baseline and private artifacts'))
    directory=Path(payload['_workspace'])
    entries={}
    if starter_model is not None:
        entries['public_starter']=save_model(starter_model,directory,'public_starter')
    for enhanced,name in [(False,'baseline'),(True,'baseline_optional')]:
        entries[name]=save_model(fit_panel(refs+own,stop,asof,enhanced),directory,name)
    for sid,model in local_models.items():
        entries['local:'+sid]=save_model(model,directory,'local-'+hashlib.sha256(sid.encode()).hexdigest())
    baseline_version=digest_json(dict(run=payload['_identity'],models={k:entries[k] for k in ('baseline','baseline_optional')}))
    manifest=dict(schema=1,method=VERSION,engine_sha256=e.SOURCE_SHA256,owner=payload['_owner'],
        strategy='shared_baseline',first_day=str(day),information_as_of=e.iso(asof),
        created_at=e.iso(dt.datetime.now(e.UTC)),next_refit_date=str(day+dt.timedelta(days=28)),
        benchmark_contract=payload['portfolio_method'],baseline_version=baseline_version,
        reference_meter_count=len(refs),contributed_meter_count=len(own),
        public_starter=({k:payload['_starter'][k] for k in ('version','release')}
                        if starter_model is not None else None),
        dependencies=dict(catboost=e.CATBOOST_VERSION,numpy=np.__version__),
        feature_contract=dict(names=FEATURES,optional=['reactive_power_kvar','profile_label'],missing='NaN plus presence flags'),
        identities={m.s.id:dict(unit=m.s.unit,timezone=str(m.s.zone)) for m in own},
        history_versions=payload['history_versions'],scales=scales,selected=selected,evidence=evidence,
        models=entries,policy=POLICY)
    p.atomic(directory/'model.json',manifest)
    publish(payload,manifest,own)
    return dict(status='completed',model_version=payload['_identity'],model=manifest)


def publish(payload,manifest,own):
    root=Path(payload['_shared_root'])
    with p.locked(root):
        base=root/'models'/manifest['baseline_version'];base.mkdir(parents=True,exist_ok=True,mode=0o700)
        for name in ('baseline','baseline_optional'):
            entry=manifest['models'][name]
            if 'file' in entry:
                shutil.copyfile(Path(payload['_workspace'])/entry['file'],base/entry['file'])
                (base/entry['file']).chmod(0o600)
        p.atomic(base/'manifest.json',dict(version=manifest['baseline_version'],method=VERSION,
            engine_sha256=e.SOURCE_SHA256,models={k:manifest['models'][k] for k in ('baseline','baseline_optional')},
            dependencies=manifest['dependencies'],policy=POLICY))
        for meter in own:
            key=payload['contribution_keys'][meter.s.id]
            # Namespaced internal identity; original tenant and series IDs never enter shared snapshots.
            item={**meter.data,'series_id':key,'validation':{}}
            version=digest_json(item)
            p.atomic(root/'snapshots'/(version+'.json.gz'),item)
            ref=dict(version=version,unit=meter.s.unit,timezone=str(meter.s.zone),
                source_received_at=max(
                    [(r[3] if len(r)>3 else r[2]) for r in item['rows']] +
                    [(r[3] if len(r)>3 else r[2]) for r in item.get('auxiliary_rows',[])] +
                    [r['available_at'] for r in item.get('profile_revisions',[])]))
            pointer=root/'contributors'/(key+'.json')
            if not pointer.exists() or p.read(pointer).get('source_received_at',0)<=ref['source_received_at']:
                p.atomic(pointer,ref)
        # Immutable versions are retained. Registry updates merge under a process-safe lock.
        p.atomic(root/'latest.json',dict(version=manifest['baseline_version']))


def forecast(payload):
    directory=Path(payload['_artifact_dir']);manifest=p.read(directory/'model.json')
    if manifest['engine_sha256']!=e.SOURCE_SHA256 or manifest['dependencies']!=dict(catboost=e.CATBOOST_VERSION,numpy=np.__version__):
        raise ValueError('Model code/dependency version mismatch; retrain explicitly')
    if manifest['owner']!=payload['_owner']:
        raise ValueError('Model unavailable for tenant')
    m=Meter(payload['series'][0]);sid=m.s.id
    if manifest['identities'].get(sid)!=dict(unit=m.s.unit,timezone=str(m.s.zone)):
        raise ValueError('Model series identity mismatch')
    day=dt.date.fromisoformat(payload['forecast_for'])
    if str(day)<manifest['first_day']:
        raise ValueError('Model trained after forecast origin')
    stale=str(day)>=manifest['next_refit_date']
    if stale and not payload.get('allow_stale_model'):
        raise ValueError('model_refit_due')
    selected=manifest['selected'][sid];scale=manifest['scales'][sid]
    stamps=list(e.slots(day,m.s.zone));x=[];bases=[]
    for stamp in stamps:
        row,base=m.features(stamp,scale,selected=='baseline_optional');x.append(row);bases.append(base)
    optional_available=any(row[0]!='unknown' or any(math.isfinite(v) for v in row[15:17]) for row in x)
    warnings=['model_refit_due'] if stale else []
    if selected=='baseline_optional' and not optional_available:
        selected='baseline';warnings.append('optional_features_unavailable_using_core_baseline')
    if manifest['evidence'][sid]['provisional']:
        warnings.append('provisional_short_history')
    if selected=='weekly_reference':
        values=bases
    else:
        key='local:'+sid if selected=='local' else selected
        values=estimate(load_model(directory,manifest['models'][key]),x,scale)
    ctx=m.s.day_context(day)
    if ctx['d2_coverage']<1:
        warnings.append('incomplete_latest_day_history_using_causal_fallbacks')
    return dict(status='completed',series_id=sid,model_version=payload['model_version'],
        baseline_version=manifest['baseline_version'],history_version=payload['history_versions'][sid],
        forecast_for=str(day),unit=m.s.unit,timezone=str(m.s.zone),selected_model=selected,
        information_as_of=e.iso(e.origin(day,m.s.zone)),generated_at=e.iso(dt.datetime.now(e.UTC)),
        model_created_at=manifest['created_at'],next_refit_date=manifest['next_refit_date'],
        warnings=warnings,benchmark_contract=manifest['benchmark_contract'],
        daily_energy_kwh=float(sum(values))*(.25 if m.s.unit=='kW' else 1),
        forecast_values=[dict(timestamp=e.iso(t),predicted_value=float(v)) for t,v in zip(stamps,values)])
