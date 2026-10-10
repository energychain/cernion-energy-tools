#!/usr/bin/env python3
"""Upload all XLSX as one portfolio, submit one 07:00 job, independently verify each series."""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import socket
import collections
import csv
import gzip
import math
import http.client
from pathlib import Path
import xlsx_forecast_test as legacy

ROOT = '/api/forecast-sandbox/consumption/portfolio'
VERSION = 'portfolio_regime_0700_v3'
METHOD_DEFAULTS = dict(latest_measurement_lag=3, feature_profile='e2_v1', selection_objective='mae', candidate_set='extended', training_mode='rolling')


def verify_portfolio(response, datasets, config, start, until, portfolio_ids=None):
    results = response.get('results', [])
    expected = {d['series_id'] for d in datasets}
    if len(results) != len(expected) or {r['forecast_run']['series_id'] for r in results} != expected:
        raise ValueError('Portfolio result IDs/count differ from all submitted files')
    expected = portfolio_ids or expected
    by_id = {r['forecast_run']['series_id']: r for r in results}
    checked = []
    for dataset in datasets:
        result = by_id[dataset['series_id']]
        run = result['forecast_run']
        if run.get('model_version') not in (VERSION, 'portfolio_mae_0700_v2', 'portfolio_catboost_0700_v1') or set(run.get('portfolio_series_ids', [])) != expected:
            raise ValueError('Server did not execute the requested joint portfolio version')
        method = {**METHOD_DEFAULTS, **config.get('portfolio_method', {})}
        modern = run.get('model_version') in (VERSION, 'portfolio_mae_0700_v2')
        if modern and run.get('benchmark_contract') != method:
            raise ValueError('Server benchmark contract differs from request')
        if not modern and config.get('portfolio_method'):
            raise ValueError('Server does not support the requested method')
        lag = method['latest_measurement_lag'] if modern else 2
        for value in result['forecast_values']:
            day = dt.date.fromisoformat(value['forecast_for'])
            zone = legacy.ZoneInfo(dataset['timezone'])
            cutoff = dt.datetime.combine(day-dt.timedelta(days=lag-1), dt.time(), zone)
            if dt.datetime.fromisoformat(value['training_data_until'].replace('Z','+00:00')) >= cutoff:
                raise ValueError('Forecast violates measurement cutoff')
        for selection in result['relationship_analysis']['selections']:
            if set(selection['training']) != expected:
                raise ValueError('Missing common training provenance')
            first = dt.date.fromisoformat(selection['forecast_from'])
            zone = legacy.ZoneInfo(dataset['timezone'])
            cutoff = dt.datetime.combine(first-dt.timedelta(days=1), dt.time(), zone)
            origin = dt.datetime.combine(first-dt.timedelta(days=1), dt.time(7), zone)
            if dt.datetime.fromisoformat(selection['as_of'].replace('Z', '+00:00')) != origin:
                raise ValueError('Wrong portfolio selection origin')
            if not (selection['discovery_from'] < selection['confirmation_from'] < selection['forecast_from']):
                raise ValueError('Invalid chronological split')
            for key, first_day in [('training', selection['forecast_from']),
                                   ('discovery_training', selection['discovery_from']),
                                   ('confirmation_training', selection['confirmation_from'])]:
                if set(selection[key]) != expected:
                    raise ValueError('Missing portfolio fold provenance')
                previous_day = dt.date.fromisoformat(first_day)-dt.timedelta(days=1)
                cutoff = dt.datetime.combine(dt.date.fromisoformat(first_day)-dt.timedelta(days=lag-1), dt.time(), zone)
                fold_origin = dt.datetime.combine(previous_day, dt.time(7), zone)
                for evidence in selection[key].values():
                    if dt.datetime.fromisoformat(evidence['training_until'].replace('Z', '+00:00')) >= cutoff or dt.datetime.fromisoformat(evidence['maximum_label_available_at'].replace('Z', '+00:00')) > fold_origin:
                        raise ValueError('A portfolio member used unavailable training labels')
        if modern and method['training_mode']=='frozen' and len(result['relationship_analysis']['selections'])!=1:
            raise ValueError('Frozen run refitted during evaluation')
        metric, _ = legacy.score_response({'results': [result]}, dataset, config, start, until)
        checked.append((metric, result))
    return checked


def atomic_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w') as f:
        json.dump(value, f, ensure_ascii=False, allow_nan=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)


class ResilientArchive(legacy.ApiArchive):
    """Retry read-only calls. Never repeat a training POST implicitly."""
    retry_seconds = 300

    def call(self, name, endpoint, payload=None, accepted_statuses=(200,)):
        if payload is not None:
            return super().call(name, endpoint, payload, accepted_statuses)
        started, attempt = time.monotonic(), 0
        while True:
            attempt += 1
            request_name = f'{name}-attempt-{attempt}'
            if self.replay:
                candidates = [int(k.rsplit('-',1)[1]) for k in self.archived if k.startswith(name+'-attempt-')]
                available = [n for n in candidates if n >= attempt]
                if available:
                    attempt = min(available)
                    request_name = f'{name}-attempt-{attempt}'
            before = len(self.calls)
            try:
                return super().call(request_name, endpoint, payload, accepted_statuses)
            except (urllib.error.URLError, socket.timeout, ConnectionError, TimeoutError, http.client.IncompleteRead):
                pass
            except ValueError:
                if len(self.calls) == before or self.calls[-1]['status'] not in (502,503,504):
                    raise
            if time.monotonic()-started >= self.retry_seconds:
                raise TimeoutError(f'GET unavailable after {self.retry_seconds}s; use --resume')
            if not self.replay:
                print(f'API temporarily unavailable; retrying GET {endpoint}', file=sys.stderr)
                time.sleep(min(5, self.retry_seconds))


def run_durable(api, payload, saved_job, progress, on_job, poll_interval, timeout):
    run_id = (saved_job or {}).get('run_id')
    if saved_job and not run_id:
        raise ValueError('Old run has no durable run_id/checkpoints; cannot resume that calculation')
    if run_id:
        state = api.call('resume-state', ROOT+f'/runs/{run_id}')
        response = state['result'] if state['status']=='completed' else api.call('resume', ROOT+f'/runs/{run_id}/resume', {}, accepted_statuses=(200,202))
    else:
        response = api.call('portfolio', ROOT+'/run', payload, accepted_statuses=(200,202))
    if response.get('status') == 'completed':
        on_job({'run_id':response['run_id'], 'status':'completed'})
        return response
    run_id = response.get('run_id')
    if not run_id or not response.get('jobId'):
        raise ValueError('Server lacks durable portfolio protocol; update server before a full run')
    on_job(response)
    started, count = time.monotonic(), 0
    # Interrupting this client intentionally detaches. Durable work stays resumable.
    while time.monotonic()-started < timeout:
        count += 1
        state = api.call(f'run-state-{count:05d}', ROOT+f'/runs/{run_id}')
        if state['status'] == 'completed':
            return state['result']
        job = api.call(f'job-state-{count:05d}', '/api/jobs/'+response['jobId']+'/status', accepted_statuses=(200,404))
        progress.emit(f"Job {job.get('status', 'unavailable')}: {state['completed_blocks']} durable blocks; {job.get('phase', '')}")
        if job.get('status') in ('recovery_pending','error','failed','cancelled') or not job.get('jobId'):
            # Explicit resume is idempotent and reads the exact saved request. A
            # terminal model/data error is not retried indefinitely.
            if job.get('cancelRequested') or (job.get('status') in ('error','failed','cancelled') and job.get('error') != 'forecast_cancelled'):
                raise ValueError(f"Job failed: {job.get('error')}; checkpoints retained")
            response = api.call(f'recover-{count:05d}', ROOT+f'/runs/{run_id}/resume', {}, accepted_statuses=(200,202))
            if response.get('status')=='completed':
                return response
            on_job(response)
        if not api.replay:
            time.sleep(poll_interval)
    raise TimeoutError('Client wait limit reached; server checkpoints retained; use --resume')


def summarize(result):
    selected = collections.Counter()
    for row in result['forecast_values']:
        selected[row['selected_model']] += 1
    baseline = result['benchmark_metrics']['previous_week']['rmse']
    return dict(selected_interval_counts=dict(selected),
                rmse_gain_vs_previous_week_percent=100*(baseline-result['backtest']['rmse'])/baseline if baseline else None)


def export_comparison(directory, index, report_row, result):
    """Portable paired-comparison contract, one row per physical UTC interval."""
    fields = ['series_id','timestamp','forecast_for','forecast_created_at','actual_value',
              'predicted_value','selected_model','training_data_until','model_training_until',
              'feature_measurement_until','model_fit_origin','method_version','data_version','unit','low_load_threshold','candidate_active_probability','state_probabilities','state_training_prior']
    rows = result['forecast_values']
    path = directory/f'{index:03d}-predictions.csv.gz'
    with gzip.open(path, 'wt', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields+['dataset_id','source_sha256','latest_measurement_lag','training_mode'])
        writer.writeheader()
        for value in rows:
            writer.writerow({**{key:value.get(key) for key in fields},
                'dataset_id':report_row.get('dataset_id'),
                **{k:result['forecast_run'].get('benchmark_contract',{}).get(k) for k in ['latest_measurement_lag','training_mode']},
                'source_sha256':result['forecast_run'].get('source_sha256')})
    metrics = []
    for name in ['selected']+list(rows[0]['candidate_predictions']):
        errors = [v['actual_value']-(v['predicted_value'] if name=='selected' else v['candidate_predictions'][name]) for v in rows]
        absolute = math.fsum(abs(x) for x in errors)
        actual = math.fsum(abs(v['actual_value']) for v in rows)
        squared = math.fsum(x*x for x in errors)
        metrics.append(dict(model=name,N=len(rows),actual_absolute_sum=actual,absolute_error_sum=absolute,
            squared_error_sum=squared,MAE=absolute/len(rows),RMSE=math.sqrt(squared/len(rows)),
            WAPE=100*absolute/actual if actual else None))
    with (directory/f'{index:03d}-metrics.csv').open('w',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=metrics[0]);writer.writeheader();writer.writerows(metrics)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xlsx', nargs='+', required=True)
    parser.add_argument('--from', dest='start', type=dt.date.fromisoformat, default=dt.date(2023, 1, 1))
    parser.add_argument('--until', type=dt.date.fromisoformat, default=dt.date(2024, 12, 31))
    parser.add_argument('--base-url', default=None)
    parser.add_argument('--unit', choices=['kWh', 'kW'], default='kWh')
    parser.add_argument('--time-basis', choices=['berlin', 'cet', 'utc'], default='berlin')
    parser.add_argument('--config', type=Path, default=Path(__file__).with_name('portfolio-0700.json' if Path(__file__).with_name('portfolio-0700.json').exists() else 'configuration.json'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=120)
    parser.add_argument('--poll-interval', type=int, default=5)
    parser.add_argument('--job-timeout', type=int, default=86400)
    parser.add_argument('--replay', type=Path)
    parser.add_argument('--resume', type=Path, help='Resume a prior durable run into a NEW output directory')
    args = parser.parse_args(argv)
    files = legacy.expand_files(args.xlsx)
    if not 2 <= len(files) <= 16 or args.until < args.start:
        parser.error('Supply 2–16 files and an ordered test period')
    if min(args.timeout, args.poll_interval, args.job_timeout) <= 0:
        parser.error('Timeouts and polling interval must be positive')
    if args.replay and args.resume:
        parser.error('Use either --replay or --resume')
    source = args.replay or args.resume
    config = json.loads(args.config.read_text()) if not source else None
    original = None
    if source:
        original = json.loads((source/'report.json').read_text())
        if (args.replay and original['status'] != 'completed') or [legacy.sha(f.read_bytes()) for f in files] != [r['sha256'] for r in original['files']]:
            parser.error('Resume/replay requires identical files/order; replay requires a completed report')
        config = original['configuration']
        args.start, args.until = dt.date.fromisoformat(original['from']), dt.date.fromisoformat(original['until'])
        args.unit, args.time_basis = original['unit'], original['time_basis']
        args.base_url = args.base_url or original['base_url']
    args.base_url = args.base_url or os.environ.get('CET_BASE_URL', 'http://localhost:3900')
    if config.get('model_family') != 'portfolio_catboost' or config.get('issue_time') != '07:00':
        parser.error('Use portfolio-0700.json; this client runs the joint 07:00 policy')
    args.out.mkdir(parents=True, exist_ok=False)
    for name in ['portfolio_forecast_test.py', 'xlsx_forecast_test.py', 'compare_portfolio_exports.py', 'requirements.txt']:
        (args.out/name).write_bytes(Path(__file__).with_name(name).read_bytes())
    legacy.write_json(args.out/'configuration.json', config)
    report = dict(version=VERSION, status='running', invoked_at=legacy.iso(dt.datetime.now(legacy.UTC)),
                  execution='archived_api_replay' if args.replay else 'resumed_http' if args.resume else 'live_http', base_url=args.base_url,
                  configuration=config, unit=args.unit, time_basis=args.time_basis,
                  configuration_sha256=legacy.sha(legacy.encoded(config)),
                  script_sha256=legacy.sha(Path(__file__).read_bytes()),
                  importer_sha256=legacy.sha(Path(legacy.__file__).read_bytes()),
                  **{'from': str(args.start), 'until': str(args.until)},
                  files=[dict(file=f.name, sha256=legacy.sha(f.read_bytes()), status='pending') for f in files])
    progress = legacy.CliProgress(len(files))
    api = ResilientArchive(args.base_url, args.out, args.timeout, args.replay)
    resuming = bool(args.resume or (args.replay and original.get('resumed_from')))
    initial_job = original.get('job') if args.resume else original.get('initial_job') if resuming else None
    if resuming and not initial_job:
        raise ValueError('No acknowledged run_id in source report; cannot safely resume an unknown submission')
    if resuming:
        report['resumed_from'] = str(args.resume or original['resumed_from'])
        report['initial_job'] = initial_job
        report['job'] = initial_job
    def publish():
        completed = [r['metrics'] for r in report['files'] if r.get('metrics')]
        defined = [m['wape_percent'] for m in completed if m.get('wape_percent') is not None]
        denominator = sum(m['actual_absolute_sum'] for m in completed)
        report['aggregation'] = dict(macro_wape_percent=sum(defined)/len(defined) if defined else None,
            defined_wape_series=len(defined), completed_series=len(completed),
            pooled_wape_percent=100*sum(m['absolute_error_sum'] for m in completed)/denominator if denominator else None)
        atomic_json(args.out/'report.json', report)
        lines = ['# Portfolio-Backtest 07:00', '', f"Status: {report['status']}; Zeitraum: {args.start} bis {args.until}; Einheit: {args.unit}.",
                 f"Vertrag: {config.get('portfolio_method', 'legacy D-2')}; Modellwahl nur auf vorgelagerten Fenstern.", '',
                 '| XLSX | RMSE | MAE | WAPE % | Signal | Laufstatus |', '|---|---:|---:|---:|---|---|']
        for row in report['files']:
            m = row.get('metrics', {})
            def fmt(key):
                return f'{m[key]:.6f}' if m.get(key) is not None else '—'
            lines.append(f"| {legacy.cell(row['file'])} | {fmt('rmse')} | {fmt('mae')} | {fmt('wape_percent')} | {row.get('forecast_signal', '—')} | {row['status']} |")
        lines += ['', f"Aggregation: {report['aggregation']}", '', 'Referenzfehler, Tagesenergie, saisonale Fehler, Peaks, Aktivitätsgüte und Ausfalltests: report.json.',
                  'Technischer Abschluss ist kein Nachweis einer Verbesserung gegenüber E2.']
        operational_rows = [r for r in report['files'] if r.get('operational_diagnostics')]
        if operational_rows:
            lines += ['', '**Nullreferenz und Mengenabdeckung**', '',
                      '| XLSX | MAE-Gewinn gegen Null % | Prognose-/Ist-Menge % | Hinweise |',
                      '|---|---:|---:|---|']
            for item in operational_rows:
                d = item['operational_diagnostics']
                skill = d.get('mae_skill_vs_zero')
                ratio = d.get('predicted_energy_ratio')
                values = [('—' if v is None else f'{100*v:.2f}') for v in (skill,ratio)]
                lines.append(f"| {legacy.cell(item['file'])} | {values[0]} | {values[1]} | {legacy.cell(', '.join(d['warnings'])) or '—'} |")
        if report.get('error'):
            lines += ['', 'Fehler: ' + legacy.cell(report['error'])]
        (args.out/'report.md').write_text('\n'.join(lines)+'\n')
    publish()
    try:
        spec = api.call('openapi', '/api/forecast-sandbox/openapi.json')
        if any(not spec.get('paths', {}).get(ROOT+'/'+action, {}).get('post') for action in ('datasets', 'run')):
            raise ValueError('Portfolio endpoints missing; update/restart the API server first')
        datasets, ids = [], []
        for i, (file, row) in enumerate(zip(files, report['files']), 1):
            progress.index, progress.file = i, file.name
            records, audit = progress.run('XLSX einlesen', legacy.read_workbook, file)
            if audit['sha256'] != row['sha256']:
                raise ValueError('Input changed during import')
            dataset = legacy.dataset_from_records(records, audit, args.unit, args.time_basis)
            if dataset['series_id'] in {d['series_id'] for d in datasets}:
                raise ValueError('Each workbook must identify a different series')
            datasets.append(dataset)
            uploaded = ({'status':'data_validated','series_id':dataset['series_id'],
                         'dataset_id':original['files'][i-1]['dataset_id'], 'validation':original['files'][i-1]['validation']}
                        if resuming and original['files'][i-1].get('dataset_id') else
                        api.call(f'{i:03d}-upload', ROOT+'/datasets', {'dataset': dataset}))
            if uploaded.get('status') != 'data_validated' or uploaded.get('series_id') != dataset['series_id']:
                raise ValueError('Upload validation failed')
            ids.append(uploaded['dataset_id'])
            row.update(status='uploaded', input=audit, dataset_id=ids[-1], validation=uploaded['validation'])
            publish()
        effective = {**config, 'forecast_period_from': str(args.start), 'forecast_period_until': str(args.until)}
        report['effective_configuration'] = effective
        payload = dict(dataset_ids=ids, configuration=effective, payload_fit_confirmed=True)
        def on_job(job):
            report['job'] = job
            publish()
        response = run_durable(api, payload, initial_job, progress, on_job, args.poll_interval, args.job_timeout)
        manifest = response.get('result_manifest')
        if not manifest or {m['series_id'] for m in manifest} != {d['series_id'] for d in datasets}:
            raise ValueError('Missing or inconsistent durable result manifest')
        by_id = {m['series_id']: m for m in manifest}
        for index, (row, dataset) in enumerate(zip(report['files'], datasets), 1):
            entry = by_id[dataset['series_id']]
            expected_url = ROOT+'/runs/'+response['run_id']+'/series/'+legacy.sha(dataset['series_id'].encode())
            if entry['url'] != expected_url:
                raise ValueError('Untrusted result URL')
            result = api.call(f'{index:03d}-series-result', expected_url)
            metric = verify_portfolio({'results':[result]}, [dataset], config, args.start, args.until, portfolio_ids={d['series_id'] for d in datasets})[0][0]
            row.update(status='completed', metrics=metric, forecast_run=result['forecast_run'],
                       benchmark_metrics=result['benchmark_metrics'], diagnostics=result['diagnostics'],
                       hurdle_diagnostics=result['hurdle_diagnostics'],
                       stress_metrics=result['stress_metrics'],
                       selections=result['relationship_analysis']['selections'])
            row.update(legacy.interpret_readiness(metric, result, dataset['unit'], args.start, args.until))
            row['readiness_evidence']['baseline_comparison_available'] = True
            row['comparison_summary'] = summarize(result)
            row['operational_diagnostics'] = result['diagnostics'].get('operational')
            export_comparison(args.out, index, row, result)
            progress.completed += 1
            progress.index, progress.file = index, row['file']
            progress.emit('Ergebnis geladen und unabhängig geprüft')
            publish()
            del result
        report['run_id'] = response['run_id']
        report['status'] = 'completed'
    except KeyboardInterrupt:
        report.update(status='interrupted', error='Interrupted')
    except Exception as error:
        report.update(status='failed', error=str(error))
    report['finished_at'] = legacy.iso(dt.datetime.now(legacy.UTC))
    publish()
    print((args.out/'report.md').read_text())
    return 0 if report['status'] == 'completed' else 1


if __name__ == '__main__':
    sys.exit(main())
