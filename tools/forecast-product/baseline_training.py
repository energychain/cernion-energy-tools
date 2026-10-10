"""Season-balanced publisher core training and direct chronological baseline validation.

No local estimators, winner selection, or external benchmark. Live feature semantics stay D-3/07:00.
"""
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import random
import sys
from collections import defaultdict
from zoneinfo import ZoneInfo
import numpy as np
from forecast_product import load_dataset, stamp
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'forecast-portfolio'))
import engine as e
import product
import persistence as p

VERSION='season_balanced_publisher_v1'
SEASONS=('winter','spring','summer','autumn')
POLICY=dict(max_examples_per_meter=4096,minimum_observed_days=28,minimum_examples=672,
            validation_days=14,validation_min_coverage=.95,seed=73471,
            weighting='equal meter / available season / available year within season',
            training_history='all available years before cutoff',
            validation='latest eligible fixed Jan/Apr/Jul/Oct 15 window per meter; global chronological cutoff',
            local_models=False,model_selection=False)


def season(day):
    return SEASONS[(day.month%12)//3]


def load(manifest_path,direction,day):
    path=Path(manifest_path).resolve();manifest=p.read(path)
    if manifest.get('format')!='cet-prepared-training' or manifest.get('schema')!=1:
        raise ValueError('Unsupported prepared manifest')
    entries=[x for x in manifest['series'] if x['target_direction']==direction]
    if not entries or len({x['series_id'] for x in entries})!=len(entries):
        raise ValueError('Missing or duplicate meter identities')
    meters=[];audit=[];identities=set();signatures=defaultdict(list)
    for entry in entries:
        file=(path.parent/entry['file']).resolve()
        if not file.is_relative_to(path.parent) or p.digest(file)!=entry['sha256']:
            raise ValueError('Prepared dataset path/checksum mismatch')
        dataset,_=load_dataset(file)
        if dataset['series_id']!=entry['series_id'] or dataset.get('target_direction')!=direction:
            raise ValueError('Prepared identity/direction mismatch')
        zone=ZoneInfo(dataset['timezone']);asof=e.origin(day,zone);stop=day-dt.timedelta(days=2)
        rows=[];coverage=defaultdict(int);zero=0;values=set()
        for point in dataset['values']:
            when=stamp(point['timestamp']);local_day=when.astimezone(zone).date()
            available=dt.datetime.combine(local_day+dt.timedelta(days=1),dt.time(),zone).timestamp()*1000
            if local_day<stop and available<=asof.timestamp()*1000:
                rows.append([when.timestamp()*1000,point['value'],available,available])
                coverage[f'{local_day.year}-{season(local_day)}']+=1
                zero+=point['value']==0;values.add(point['value'])
        rows.sort()
        if not rows:raise ValueError(dataset['series_id']+': no history before final cutoff')
        item=dict(series_id=dataset['series_id'],unit=dataset['unit'],timezone=dataset['timezone'],rows=rows,validation={})
        meters.append(product.Meter(item));identities.add((dataset['unit'],dataset['timezone']))
        signatures[product.digest_json(dict(unit=dataset['unit'],timezone=dataset['timezone'],rows=rows))].append(dataset['series_id'])
        flags=[]
        if len(values)<=2:flags.append('nearly_constant_verify_measurement_provenance')
        if zero/len(rows)>.5:flags.append('majority_zero_observations')
        if entry.get('gaps'):flags.append('gaps_preserved')
        if any('aggregation' in name.lower() for name in entry.get('sources',[])):
            flags.append('aggregation_membership_unconfirmed')
        if entry.get('direction_assumed'):flags.append('direction_assumed_from_source_contract')
        audit.append(dict(series_id=dataset['series_id'],source_sha256=entry['sha256'],source_files=entry.get('sources',[]),
                          available_rows=len(rows),first=e.iso(dt.datetime.fromtimestamp(rows[0][0]/1000,e.UTC)),
                          last=e.iso(dt.datetime.fromtimestamp(rows[-1][0]/1000,e.UTC)),
                          year_season_rows=dict(sorted(coverage.items())),zero_fraction=zero/len(rows),
                          gaps=entry.get('gaps',[]),flags=flags))
    if len(identities)!=1:raise ValueError('Common unit/timezone required')
    duplicates=[ids for ids in signatures.values() if len(ids)>1]
    return meters,dict(meters=audit,identical_histories_under_different_ids=duplicates,
                      availability_assumption='historical measurement available next local midnight',
                      manifest_sha256=p.digest(path))


def samples(meter,day):
    """Only labels known at this global fold origin; bounded, reproducible seasonal sample."""
    asof=e.origin(day,meter.s.zone);stop=day-dt.timedelta(days=2)
    rows=e.training(meter.s,meter.s.dates[0],stop,asof)
    observed_days={r[0].astimezone(meter.s.zone).date() for r in rows}
    if len(observed_days)<POLICY['minimum_observed_days']:
        return None,'fewer_than_28_observed_training_days'
    scale=float(np.mean([r[1] for r in rows])) or 1.0
    buckets=defaultdict(list)
    for row in rows:
        local=row[0].astimezone(meter.s.zone)
        if local.date()>=meter.s.dates[0]+dt.timedelta(days=7):
            buckets[(season(local.date()),local.year)].append(row)
    seasons=sorted({s for s,_ in buckets})
    records={};available={}
    for s in seasons:
        years=sorted(year for name,year in buckets if name==s)
        quota=max(1,POLICY['max_examples_per_meter']//len(seasons)//len(years))
        for year in years:
            pool=buckets[s,year];available[f'{year}-{s}']=len(pool)
            seed=int.from_bytes(hashlib.sha256(f'{POLICY["seed"]}:{meter.s.id}:{s}:{year}'.encode()).digest()[:8],'big')
            picked=sorted(random.Random(seed).sample(range(len(pool)),min(quota,len(pool))))
            usable=[]
            for index in picked:
                t,value,known=pool[index]
                try:x,_=meter.features(t,scale,False)
                except ValueError:continue
                usable.append((x,value/scale,t,known))
            if usable:records[s,year]=usable
    n=sum(map(len,records.values()))
    if n<POLICY['minimum_examples']:return None,'insufficient_causal_feature_examples'
    seasons=sorted({s for s,_ in records});x=[];y=[];weights=[];buckets_audit={};selected=[]
    for (s,year),data in sorted(records.items()):
        years=sum(name==s for name,_ in records)
        weight=1/len(seasons)/years/len(data)
        buckets_audit[f'{year}-{s}']=dict(available=available[f'{year}-{s}'],selected=len(data),weight=weight*len(data))
        for features,value,t,known in data:
            x.append(features);y.append(value);weights.append(weight);selected.append(t.isoformat())
    return dict(x=x,y=y,weights=weights,scale=scale,
                audit=dict(series_id=meter.s.id,available_training_rows=len(rows),observed_days=len(observed_days),
                           examples=len(y),scale=scale,weight_sum=float(sum(weights)),buckets=buckets_audit,
                           latest_training_label=e.iso(rows[-1][0]),latest_label_available_at=e.iso(max(r[2] for r in rows)),
                           information_as_of=e.iso(asof),latest_allowed_measurement_day=str(day-dt.timedelta(days=3)),
                           sampled_timestamps_sha256=product.digest_json(selected))),None


def panel(meters,day,fit=True,require_all=False):
    x=[];y=[];w=[];by_id={};skipped={}
    for meter in meters:
        sample,reason=samples(meter,day)
        if sample is None:
            skipped[meter.s.id]=reason
            continue
        by_id[meter.s.id]=sample['audit']
        x.extend(sample['x']);y.extend(sample['y']);w.extend(sample['weights'])
    if not by_id or (require_all and skipped):
        raise ValueError('Insufficient training contribution: '+json.dumps(skipped))
    weight_total=sum(w)
    for audit in by_id.values():audit['panel_weight']=audit['weight_sum']/weight_total
    return (product.fit_model(x,y,w) if fit else None),by_id,skipped


def schedule(meters,final_day):
    windows=defaultdict(list);unavailable=[]
    for meter in meters:
        for name,month in zip(SEASONS,(1,4,7,10)):
            chosen=None
            for year in range(meter.s.dates[-1].year,meter.s.dates[0].year-1,-1):
                start=dt.date(year,month,15);end=start+dt.timedelta(days=POLICY['validation_days'])
                if end>min(final_day-dt.timedelta(days=2),meter.s.dates[-1]+dt.timedelta(days=1)):continue
                history_days=sum(d<start-dt.timedelta(days=2) for d in meter.s.dates)
                if history_days<POLICY['minimum_observed_days']:continue
                expected=sum(len(list(e.slots(start+dt.timedelta(days=i),meter.s.zone))) for i in range(POLICY['validation_days']))
                actual=sum(len(meter.s.days.get(start+dt.timedelta(days=i),[])) for i in range(POLICY['validation_days']))
                if actual/expected>=POLICY['validation_min_coverage']:
                    chosen=dict(series_id=meter.s.id,season=name,start=str(start),end_exclusive=str(end),expected=expected)
                    windows[start].append(chosen);break
            if chosen is None:unavailable.append(dict(series_id=meter.s.id,season=name,reason='no_fixed_window_with_sufficient_past_and_coverage'))
    return dict(sorted(windows.items())),unavailable


def metrics(actual,predicted):
    a=np.asarray(actual,dtype=float);v=np.asarray(predicted,dtype=float)
    error=v-a;n=len(a)
    total=float(np.abs(a).sum());ae=float(np.abs(error).sum());se=float(np.square(error).sum())
    return dict(n=n,sum_abs_actual=total,sum_abs_error=ae,sum_squared_error=se,
                mae=ae/n if n else None,rmse=math.sqrt(se/n) if n else None,
                wape_percent=100*ae/total if total else None,bias=float(error.mean()) if n else None)


def evaluate(model,meter,window,train_audit):
    start=dt.date.fromisoformat(window['start']);end=dt.date.fromisoformat(window['end_exclusive'])
    labels=e.training(meter.s,start,end,e.origin(end+dt.timedelta(days=3),meter.s.zone))
    x=[];actual=[];times=[];missing=0
    scale=train_audit['scale']
    for t,value,_ in labels:
        try:features,_=meter.features(t,scale,False)
        except ValueError:missing+=1;continue
        x.append(features);actual.append(value);times.append(e.iso(t))
    pred=product.estimate(model,x,scale) if x else []
    out=metrics(actual,pred)
    zero=[i for i,v in enumerate(actual) if v==0];active=[i for i,v in enumerate(actual) if v>0]
    # Peak threshold is fitted on history BEFORE this fold, not on holdout values.
    history=e.training(meter.s,meter.s.dates[0],start-dt.timedelta(days=2),e.origin(start,meter.s.zone))
    threshold=float(np.quantile([r[1] for r in history],.95))
    peak=[i for i,v in enumerate(actual) if v>threshold]
    diagnostic={name:metrics([actual[i] for i in indices],[pred[i] for i in indices])
                for name,indices in [('zero',zero),('active',active),('peak',peak)]}
    return dict(**window,metrics=out,normalized_mae=out['mae']/scale if out['mae'] is not None else None,
                normalization_scale=scale,coverage=out['n']/window['expected'],feature_failures=missing,
                peak_threshold_from_training=threshold,regimes=diagnostic,
                prediction_digest=product.digest_json([times,list(map(float,pred))])),[
                    dict(timestamp=t,actual_value=a,predicted_value=float(v)) for t,a,v in zip(times,actual,pred)]


def summarize(records,meters,missing,audit):
    by_id={}
    for meter in meters:
        rows=[v for v in records if v['series_id']==meter.s.id]
        n=sum(r['metrics']['n'] for r in rows);ae=sum(r['metrics']['sum_abs_error'] for r in rows)
        actual=sum(r['metrics']['sum_abs_actual'] for r in rows);se=sum(r['metrics']['sum_squared_error'] for r in rows)
        by_id[meter.s.id]=dict(seasons=[r['season'] for r in rows],n=n,
            mae=ae/n if n else None,rmse=math.sqrt(se/n) if n else None,
            wape_percent=100*ae/actual if actual else None,
            normalized_mae=float(np.mean([r['normalized_mae'] for r in rows if r['normalized_mae'] is not None])) if n else None)
    checks=dict(all_meters_evaluated=all(v['n']>0 for v in by_id.values()),
                four_seasons_per_meter=all(len(v['seasons'])==4 for v in by_id.values()),
                all_window_coverage_sufficient=all(v['coverage']>=POLICY['validation_min_coverage'] for v in records),
                no_duplicate_histories=not audit['identical_histories_under_different_ids'])
    return dict(by_meter=by_id,checks=checks,
                normalized_validation_mae=float(np.mean([v['normalized_mae'] for v in by_id.values() if v['normalized_mae'] is not None])) if records else None,
                review_required=True,missing_windows=missing,
                interpretation='Direct common-model chronological validation; final weights refit afterward. No unseen-meter generalization claim.')


def markdown(report):
    lines=['# Basismodell: Trainingszusammensetzung und direkte Validierung','',
           f"Richtung: {report['direction']}; Stand: {report['status']}; Verfahren: {VERSION}.",'',
           'Alle Messreihen werden über ihre verfügbaren Jahre einbezogen. Gleiches Gesamtgewicht pro Zähler; innerhalb eines Zählers gleiche Gewichte für vorhandene Jahreszeiten und Jahre. Keine lokalen Modelle und keine Modellauswahl in diesen Kennzahlen.','',
           '| Serie | Saisons | Intervalle | MAE | WAPE % |','|---|---:|---:|---:|---:|']
    summary=report.get('validation_summary',{})
    for sid,row in summary.get('by_meter',{}).items():
        mae='—' if row['mae'] is None else f"{row['mae']:.6f}"
        wape='—' if row['wape_percent'] is None else f"{row['wape_percent']:.2f}"
        lines.append(f"| {sid} | {len(row['seasons'])}/4 | {row['n']} | {mae} | {wape} |")
    lines+=['','## Abdeckung und Auffälligkeiten','']
    for row in report['data_audit']['meters']:
        flags=', '.join(row['flags']) or 'keine automatischen Auffälligkeiten'
        lines.append(f"- {row['series_id']}: {len(row['year_season_rows'])} Jahr-/Saisonabschnitte, {row['zero_fraction']:.1%} Nullwerte; {flags}.")
    lines+=['','Jedes Validierungsmodell wurde ausschließlich mit Daten vor seinem jeweiligen Prüfzeitraum trainiert. Während der Prüfung dürfen gemessene Lag-Werte gemäß D−3/07:00 fortlaufend einfließen; die Gewichte bleiben eingefroren. Das finale Modell wird danach mit allen am finalen Stichtag zulässigen Daten trainiert.','',
            'Diese Prüfung ist kein externer Benchmark und keine Freigabe zur Veröffentlichung. Auffällige konstante Reihen, Aggregationsabhängigkeiten und unbekannte Messwert-Herkunft brauchen weiterhin fachliche Einordnung. Fehlende Jahreszeiten und unzureichende Prüfdeckung stehen in quality-report.json.','']
    return '\n'.join(lines)


def run(manifest,direction,day,output,check_only=False):
    output.mkdir(mode=0o700)
    print(f'Loading full histories ({direction})',flush=True)
    meters,audit=load(manifest,direction,day)
    windows,missing=schedule(meters,day)
    report=dict(schema=1,method=VERSION,status='checking',direction=direction,final_day=str(day),
                publisher_sha256=p.digest(__file__),engine_sha256=e.SOURCE_SHA256,policy=POLICY,
                data_audit=audit,scheduled_windows={str(k):v for k,v in windows.items()},missing_windows=missing)
    p.atomic(output/'training-scope.json',dict(target_direction=direction,mode='baseline',total_meter_count=len(meters)))
    p.atomic(output/'quality-report.json',report)
    if check_only:
        _,contributions,_=panel(meters,day,fit=False,require_all=True)
        report.update(status='ready',final_training_contributions=contributions)
        p.atomic(output/'quality-report.json',report)
        (output/'report.md').write_text(markdown(report))
        return dict(status='ready',trained=False,report=str(output/'report.md'))
    records=[];index={m.s.id:m for m in meters}
    for day_index,(start,targets) in enumerate(windows.items(),1):
        print(f'Common-model validation {day_index}/{len(windows)}: {start}, {len(targets)} meters',flush=True)
        model,contributions,skipped=panel(meters,start)
        fold=dict(start=str(start),training=contributions,excluded=skipped,results=[])
        for target in targets:
            sid=target['series_id']
            if sid not in contributions:
                missing.append(dict(**target,reason=skipped[sid]));continue
            result,values=evaluate(model,index[sid],target,contributions[sid])
            fold['results'].append(result);records.append(result)
            key=hashlib.sha256(sid.encode()).hexdigest()
            p.atomic(output/'validation-predictions'/f'{start}-{key}.json.gz',values)
        p.atomic(output/'folds'/f'{start}.json',fold)
        report.update(completed_folds=day_index,validation_summary=summarize(records,meters,missing,audit))
        p.atomic(output/'quality-report.json',report)
        del model
    print(f'Final season-balanced common fit: {len(meters)} meters ({direction})',flush=True)
    model,contributions,_=panel(meters,day,require_all=True)
    entry=product.save_model(model,output,'baseline')
    summary=summarize(records,meters,missing,audit)
    report.update(status='trained',final_training_contributions=contributions,validation_summary=summary)
    p.atomic(output/'quality-report.json',report)
    (output/'report.md').write_text(markdown(report))
    scales={sid:v['scale'] for sid,v in contributions.items()}
    evidence={sid:dict(mae={'baseline':v['mae']},provisional=len(v['seasons'])<4,
                       sample_count=v['n'],quality_claim='direct_common_model_seasonal_chronological_validation')
              for sid,v in summary['by_meter'].items()}
    version=product.digest_json(dict(engine=e.SOURCE_SHA256,publisher=p.digest(__file__),
                                    prepared=audit['manifest_sha256'],day=str(day),direction=direction,model=entry))
    manifest_out=dict(schema=1,strategy='shared_baseline',method=VERSION,engine_sha256=e.SOURCE_SHA256,
        owner=hashlib.sha256(('offline-balanced-baseline:'+direction).encode()).hexdigest(),
        first_day=str(day),information_as_of=e.iso(e.origin(day,meters[0].s.zone)),
        created_at=e.iso(dt.datetime.now(e.UTC)),next_refit_date=str(day+dt.timedelta(days=28)),
        identities={m.s.id:dict(unit=m.s.unit,timezone=str(m.s.zone)) for m in meters},
        history_versions={m.s.id:product.digest_json(m.data) for m in meters},
        scales=scales,selected={m.s.id:'baseline' for m in meters},evidence=evidence,
        dependencies=dict(catboost=e.CATBOOST_VERSION,numpy=np.__version__),
        models={'baseline':entry},baseline_version=version,reference_meter_count=0,
        contributed_meter_count=len(meters),benchmark_contract=meters[0].s.contract,
        policy=POLICY,feature_contract=dict(names=product.FEATURES),
        publisher_training=dict(version=VERSION,source_sha256=p.digest(__file__),
                                quality_report_sha256=p.digest(output/'quality-report.json')))
    p.atomic(output/'model.json',manifest_out)
    result=dict(status='trained',model_version=version,model=manifest_out,
                quality_report=str(output/'quality-report.json'),public_package_created=False)
    p.atomic(output/'result.json',result)
    return dict(status='trained',target_direction=direction,model_directory=str(output),
                quality_report=str(output/'quality-report.json'),public_package_created=False)
