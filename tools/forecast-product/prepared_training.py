"""Offline publisher orchestration for mixed history end dates; never relaxes live freshness."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
from zoneinfo import ZoneInfo
from forecast_product import load_dataset, stamp
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'forecast-portfolio'))
import engine as e
import product
import persistence as p


def plan(manifest_path, direction, day, output):
    manifest_path=Path(manifest_path).resolve()
    bundle=json.loads(manifest_path.read_text())
    if bundle.get('format')!='cet-prepared-training' or bundle.get('schema')!=1:
        raise ValueError('Unsupported prepared training manifest')
    entries=[v for v in bundle['series'] if v['target_direction']==direction]
    if not entries:
        raise ValueError('No series for requested direction')
    if len({v['series_id'] for v in entries})!=len(entries):
        raise ValueError('Duplicate series IDs in manifest')
    own,older,info=[],[],[]
    identities=set()
    stop=day-dt.timedelta(days=2)
    for entry in entries:
        file=(manifest_path.parent/entry['file']).resolve()
        if not file.is_relative_to(manifest_path.parent) or p.digest(file)!=entry['sha256']:
            raise ValueError('Prepared dataset path/checksum mismatch')
        dataset,audit=load_dataset(file)
        if dataset['series_id']!=entry['series_id'] or dataset.get('target_direction')!=direction:
            raise ValueError('Dataset identity/direction mismatch')
        identities.add((dataset['unit'],dataset['timezone']))
        zone=ZoneInfo(dataset['timezone']);asof=e.origin(day,zone)
        rows=[]
        for value in dataset['values']:
            when=stamp(value['timestamp']);date=when.astimezone(zone).date()
            available=dt.datetime.combine(date+dt.timedelta(days=1),dt.time(),zone).timestamp()*1000
            if date<stop and available<=asof.timestamp()*1000:
                rows.append([when.timestamp()*1000,value['value'],available,available])
        rows.sort()
        if not rows:
            raise ValueError(dataset['series_id']+': no observations before D-2 cutoff')
        last=dt.datetime.fromtimestamp(rows[-1][0]/1000,zone)
        end=min(stop,last.date()+dt.timedelta(days=1))
        begin=end-dt.timedelta(days=240)
        rows=[r for r in rows if dt.datetime.fromtimestamp(r[0]/1000,zone).date()>=begin]
        item=dict(series_id=dataset['series_id'],unit=dataset['unit'],timezone=dataset['timezone'],rows=rows,validation={})
        count=len({dt.datetime.fromtimestamp(r[0]/1000,zone).date() for r in rows})
        if count<28:
            raise ValueError(dataset['series_id']+': at least 28 observed days required')
        role='own' if (asof-last.astimezone(e.UTC)).total_seconds()<=7*86400 else 'reference'
        (own if role=='own' else older).append(item)
        info.append(dict(series_id=item['series_id'],role=role,history_version=product.digest_json(item),
                         last_observation=last.isoformat(),prepared_records=entry['records'],used_history_rows=len(rows),
                         retained_observed_days=count,gaps=entry.get('gaps',[]),source_audit=audit))
    if len(identities)!=1:
        raise ValueError('Prepared training requires a common unit/timezone')
    if not own:
        raise ValueError('No current meter at requested forecast origin; choose a suitable historical date')
    shared=output/'private-references'
    refs=[]
    for item in older:
        version=product.digest_json(item)
        p.atomic(shared/'snapshots'/(version+'.json.gz'),item)
        refs.append(dict(version=version,unit=item['unit'],timezone=item['timezone']))
    identity=product.digest_json(dict(bundle_sha256=p.digest(manifest_path),direction=direction,
                                     forecast_for=str(day),engine=e.SOURCE_SHA256,
                                     preparation_sha256=p.digest(__file__)))
    task=dict(_workspace=str(output.resolve()),_identity=identity,
              _owner=hashlib.sha256(('offline-starter-publisher:'+direction).encode()).hexdigest(),
              _shared_root=str(shared.resolve()),series=own,forecast_for=str(day),reference_snapshots=refs,
              contribution_keys={s['series_id']:hashlib.sha256(s['series_id'].encode()).hexdigest() for s in own},
              history_versions={s['series_id']:product.digest_json(s) for s in own},
              portfolio_method=e.contracts.normalize(dict(latest_measurement_lag=3,feature_profile='e2_v1',
                                                         selection_objective='mae',candidate_set='extended',training_mode='rolling')))
    return task,dict(format='cet-offline-training-plan',schema=1,target_direction=direction,
                     forecast_for=str(day),prepared_manifest=str(manifest_path),
                     prepared_manifest_sha256=p.digest(manifest_path),series=info,
                     own_meter_count=len(own),reference_meter_count=len(older),
                     total_meter_count=len(own)+len(older),
                     validation_scope='current own meters only; references train shared model without independent quality claim',
                     per_meter_weight='equal total training weight; each meter appears once',
                     notes=['Historical next-local-day availability assumed; no time shifting or imputation.',
                            'Import and export train in distinct private directories; no cross-direction reference mixing.'])


def preflight(task):
    """Mirror causal sample requirements without fitting any estimator."""
    own=[product.Meter(s) for s in task['series']]
    refs=product.reference_meters(task)
    day=dt.date.fromisoformat(task['forecast_for']);stop=day-dt.timedelta(days=2)
    asof=e.origin(day,own[0].s.zone)
    spans=[len({r[0].astimezone(m.s.zone).date() for r in product.available_rows(m,stop,asof)}) for m in own]
    if min(spans)<28:
        raise ValueError('Insufficient current observed history')
    validation_days=28 if min(spans)>=84 else 7
    split=stop-dt.timedelta(days=validation_days);cut=e.origin(split,own[0].s.zone)
    fit_stop=split-dt.timedelta(days=2)
    evidence=[]
    for m in own+refs:
        end=min(fit_stop,m.s.dates[-1]+dt.timedelta(days=1))
        _,y,_=product.fit_data(m,end,cut,False)
        if len(y)<96*7:
            raise ValueError(m.s.id+': insufficient causal training examples before validation')
        end_final=min(stop,m.s.dates[-1]+dt.timedelta(days=1))
        _,fy,_=product.fit_data(m,end_final,asof,False)
        if len(fy)<96*7:
            raise ValueError(m.s.id+': insufficient final training examples')
        count=None
        if m in own:
            count=0
            for stamp,_,_ in e.training(m.s,split,stop,asof):
                try:
                    m.features(stamp,1.0,False)
                    count+=1
                except ValueError:
                    continue
            if count<96*3:
                raise ValueError(m.s.id+': insufficient validation coverage')
        evidence.append(dict(series_id=m.s.id,training_examples=len(y),final_training_examples=len(fy),validation_examples=count))
    return dict(status='ready',validation_from=str(split),validation_until_exclusive=str(stop),
                validation_information_as_of=e.iso(cut),sample_checks=evidence)


def run(manifest, direction, day, output, check_only=False, unit=None):
    if direction not in ('import','export'):
        raise ValueError('--direction import|export required with --prepared')
    output.mkdir(mode=0o700)
    task,report=plan(manifest,direction,day,output)
    if unit is not None and task['series'][0]['unit']!=unit:
        raise ValueError('Requested unit differs from prepared data')
    print(f"Checking {report['own_meter_count']} current and {report['reference_meter_count']} reference meters ({direction})",flush=True)
    report['preflight']=preflight(task)
    p.atomic(output/'training-plan.json',report)
    p.atomic(output/'private-training-task.json.gz',task)
    if check_only:
        return dict(status='ready',trained=False,plan=str(output/'training-plan.json'))
    # Write the direction BEFORE fitting, including interrupted runs.
    scope=dict(target_direction=direction,total_meter_count=report['total_meter_count'],
               validation_scope=report['validation_scope'])
    p.atomic(output/'training-scope.json',scope)
    result=product.train(task,lambda state:print(state['message'],flush=True))
    result['training_scope']=scope
    p.atomic(output/'result.json',result)
    return dict(status='trained',target_direction=direction,model_directory=str(output),public_package_created=False)
