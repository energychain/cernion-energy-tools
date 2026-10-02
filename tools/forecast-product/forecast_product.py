#!/usr/bin/env python3
"""Tenant-bound REST helpers. No implicit retry of writes and no token archives."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import math
import os
import re
import shlex
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = '/api/forecast-sandbox/consumption/portfolio'
UTC = dt.timezone.utc


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with temporary.open('w', encoding='utf-8') as f:
        os.chmod(temporary, 0o600)
        json.dump(value, f, indent=2, ensure_ascii=False, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())
    temporary.replace(path)


def stamp(value):
    t = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if t.tzinfo is None or t.second or t.microsecond or t.minute % 15:
        raise ValueError('Timestamps require an offset and a PT15M grid')
    return t.astimezone(UTC)


def number(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
        raise ValueError('Expected a finite, nonnegative measurement')
    return float(value)


def importer():
    path = Path(__file__).resolve().parent.parent / 'xlsx-forecast-test/xlsx_forecast_test.py'
    spec = importlib.util.spec_from_file_location('cet_xlsx_importer', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_dataset(path, series_id=None, unit=None, basis='berlin'):
    path = Path(path)
    if path.suffix.lower() == '.xlsx':
        if unit is None:
            raise ValueError('XLSX input requires --unit kWh or kW (interval values, not register readings)')
        legacy = importer()
        records, audit = legacy.read_workbook(path)
        dataset = legacy.dataset_from_records(records, audit, unit, basis)
    else:
        dataset = read(path)
        dataset = dataset.get('dataset', dataset)
        audit = {}
        if unit and unit != dataset.get('unit'):
            raise ValueError('Requested unit differs from JSON dataset')
    if series_id:
        dataset['series_id'] = series_id
    if not dataset.get('series_id') or dataset.get('unit') not in ('kWh', 'kW'):
        raise ValueError('Dataset requires series_id and unit kWh/kW')
    zone = ZoneInfo(dataset['timezone'])
    if dataset.get('value_semantics') not in (None, 'interval_energy', 'average_power'):
        raise ValueError('Convert cumulative register readings to interval values before import')
    if not dataset.get('values'):
        raise ValueError('Dataset is empty')
    seen = set()
    for row in dataset['values']:
        t = stamp(row['timestamp'])
        if t in seen:
            raise ValueError('Duplicate actual timestamp')
        seen.add(t)
        number(row['value'])
    audit.update(file=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                 series_id=dataset['series_id'], records=len(seen))
    dataset['period_from'] = min(seen).astimezone(zone).date().isoformat()
    dataset['period_until'] = max(seen).astimezone(zone).date().isoformat()
    return dataset, audit



def environment(args):
    """Read only client keys, without expansion or any Cernion-token fallback."""
    keys = ('CET_API_TOKEN', 'CET_TENANT_OVERRIDE', 'CET_TENANT_ID', 'TENANT_ID')
    explicit = getattr(args, 'env_file', None)
    if explicit:
        source = Path(explicit)
    else:
        cwd = Path.cwd()
        source = next((p/'.env' for p in (cwd, *cwd.parents) if (p/'.env').is_file()),
                      Path(__file__).resolve().parents[2]/'.env')
    values = {}
    if explicit or source.is_file():
        for line in source.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if line.startswith('export '):
                line = line[7:].lstrip()
            key, separator, raw = line.partition('=')
            key = key.strip()
            if not separator or key not in keys:
                continue
            try:
                parts = shlex.split(raw, comments=True, posix=True)
            except ValueError:
                raise ValueError('Invalid .env syntax for ' + key) from None
            if len(parts) > 1:
                raise ValueError('Invalid .env value for ' + key)
            values[key] = parts[0] if parts else ''
    values.update({key: os.environ[key] for key in keys if key in os.environ})
    flag = values.get('CET_TENANT_OVERRIDE', 'false').strip().lower()
    if flag not in ('true', 'false', '1', '0', 'yes', 'no'):
        raise ValueError('CET_TENANT_OVERRIDE must be true or false')
    values['override_enabled'] = flag in ('true', '1', 'yes')
    return values


def model_version(args):
    if args.model_version:
        return args.model_version
    envelope = read(args.model_file)
    if envelope.get('tenant_id') != args.tenant_id:
        raise ValueError('Model file belongs to a different tenant')
    return envelope['result']['model_version']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('HTTP redirect refused; use the final API base URL')


class Client:
    def __init__(self, args):
        self.base = args.base_url.rstrip('/')
        url = urllib.parse.urlsplit(self.base)
        if url.scheme not in ('http', 'https') or not url.netloc or url.username or url.password or url.query or url.fragment:
            raise ValueError('Invalid API base URL; credentials do not belong in the URL')
        if url.scheme == 'http' and url.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Remote API base URLs require HTTPS; HTTP is only allowed on loopback')
        config = getattr(args, '_env_values', None)
        if config is None:
            config = environment(args)
        self.token = (Path(args.token_file).read_text().strip() if args.token_file
                      else config.get('CET_API_TOKEN', '').strip())
        if not re.fullmatch(r'(?:ck_|csess_)[A-Za-z0-9_.-]+', self.token):
            raise ValueError('Provide CET_API_TOKEN in the environment/.env or --token-file; CERNION_TOKEN is never used')
        self.requested_tenant = args.tenant_id or config.get('CET_TENANT_ID') or config.get('TENANT_ID')
        self.override = config['override_enabled']
        self.tenant = None
        self.header_tenant = None
        self.timeout = args.timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, route, payload=None):
        # Exact client API routes only; no authority, query, dot segments or encoded delimiters.
        if not isinstance(route, str) or not re.fullmatch(
                r'/api/(?:tokens/verify|auth/verify|jobs/[A-Za-z0-9_-]{1,160}/status|'
                r'forecast-sandbox/consumption/portfolio/(?:history|train|predict|retrain|'
                r'runs/[a-f0-9]{64}(?:/resume)?))', route):
            raise ValueError('Unexpected forecast API route')
        req = urllib.request.Request(self.base + route,
            data=None if payload is None else json.dumps(payload, allow_nan=False).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.token,
                     **({'X-Tenant-Id': self.header_tenant} if self.header_tenant else {})})
        try:
            with self.opener.open(req, timeout=self.timeout) as response:
                result = json.loads(response.read().decode('utf-8').replace(self.token, '[REDACTED]'))
        except urllib.error.HTTPError as error:
            raise ValueError(f'HTTP {error.code}: ' + error.read().decode(errors='replace').replace(self.token, '[REDACTED]')) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            raise ConnectionError('API transport interrupted; writes are not automatically repeated') from error
        return result

    def verify(self):
        route = '/api/tokens/verify' if self.token.startswith('ck_') else '/api/auth/verify'
        result = self.call(route, {'token': self.token, 'trackUsage': False})
        if result.get('valid') is not True or not isinstance(result.get('tenantId'), str) or not result['tenantId'].strip():
            raise ValueError('Token is invalid or has no bound tenant; no data was submitted')
        self.tenant = result['tenantId']
        self.header_tenant = self.requested_tenant if self.override and self.requested_tenant else self.tenant
        if self.requested_tenant and self.requested_tenant != self.tenant:
            print('Note: configured tenant differs from token tenant; using the verified token tenant for artifacts and access. '
                  + ('Override header is sent; server authorization still applies.' if self.override else 'Tenant override is disabled.'),
                  file=sys.stderr)


def identifier(value):
    if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('Expected a SHA-256 model/run ID')
    return value


def await_result(client, job, args):
    if job.get('status') == 'completed':
        return job
    run_id = identifier(job['run_id'])
    job_id = job.get('jobId')
    if job_id is not None and job_id != '' and (
            not isinstance(job_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', job_id)):
        raise ValueError('Server returned an invalid job ID')
    deadline = time.monotonic() + args.job_timeout
    last_message = None
    while time.monotonic() < deadline:
        try:
            state = client.call(ROOT + '/runs/' + run_id)
            if state.get('status') == 'completed':
                return state['result']
            if job_id:
                status = client.call('/api/jobs/' + job_id + '/status')
                if status.get('status') in ('error', 'failed', 'cancelled', 'recovery_pending'):
                    raise ValueError('Job stopped: ' + str(status.get('error') or status['status']) + '; use resume --restart for an interrupted run')
                message = status.get('progress', {}).get('message') or status.get('status')
                if message != last_message:
                    print(message, flush=True)
                    last_message = message
        except ConnectionError:
            print('API temporarily unavailable; retrying read-only polling', flush=True)
        time.sleep(args.poll_interval)
    raise ValueError('Client wait expired; server job was not cancelled. Continue with resume.')


def finish(client, state, args, out, job):
    state.update(job=job, status='waiting')
    save(out/'run.json', state)
    result = await_result(client, job, args)
    if result.get('status') != 'completed':
        raise ValueError('API did not return a completed result')
    expected = state.get('request', {})
    if state.get('operation') == 'predict':
        for field in ('series_id', 'forecast_for', 'model_version'):
            if result.get(field) != expected[field]:
                raise ValueError('API prediction identity differs from request: ' + field)
    save(out/'result.json', {'tenant_id': client.tenant, 'base_url': client.base, 'result': result})
    state['status'] = 'completed'
    save(out/'run.json', state)
    print('Completed: ' + str(out/'result.json'))


def score(args):
    actual, audit = load_dataset(args.actuals, args.series_id if args.actuals.suffix.lower() == '.xlsx' else None, args.unit, args.time_basis)
    if actual['series_id'] != args.series_id:
        raise ValueError('Actual dataset belongs to another series')
    truth = {stamp(v['timestamp']): number(v['value']) for v in actual['values']}
    predictions = {}
    for file in args.predictions:
        envelope = read(file)
        if envelope.get('tenant_id') != args.tenant_id:
            raise ValueError('Prediction file belongs to another tenant')
        result = envelope['result']
        if result.get('status') != 'completed' or result.get('series_id') != args.series_id:
            raise ValueError('Prediction is not completed or belongs to another series')
        if result.get('unit') != actual['unit'] or result.get('timezone') != actual['timezone']:
            raise ValueError('Prediction/actual unit or timezone mismatch')
        zone = ZoneInfo(result['timezone'])
        day = dt.date.fromisoformat(result['forecast_for'])
        start = dt.datetime.combine(day, dt.time(), zone).astimezone(UTC)
        end = dt.datetime.combine(day+dt.timedelta(days=1), dt.time(), zone).astimezone(UTC)
        expected = {start+dt.timedelta(minutes=15*i) for i in range(int((end-start).total_seconds()/900))}
        rows = result['forecast_values']
        dates = [stamp(v['timestamp']) for v in rows]
        if len(dates) != len(set(dates)) or set(dates) != expected:
            raise ValueError('Forecast must contain the complete local day without duplicate intervals')
        for t, row in zip(dates, rows):
            if t in predictions:
                raise ValueError('Overlapping prediction files; choose one forecast per timestamp')
            predictions[t] = number(row['predicted_value'])
    matching = sorted(predictions.keys() & truth.keys())
    if not matching or (len(matching) != len(predictions) and not args.allow_partial):
        raise ValueError('Missing actual values; use --allow-partial only for an explicitly partial report')
    errors = [predictions[t]-truth[t] for t in matching]
    absolute = math.fsum(abs(v) for v in errors)
    squared = math.fsum(v*v for v in errors)
    total = math.fsum(abs(truth[t]) for t in matching)
    metrics = dict(tenant_id=args.tenant_id, series_id=args.series_id, unit=actual['unit'],
        sample_count=len(matching), expected_intervals=len(predictions), coverage=len(matching)/len(predictions),
        missing_actual_intervals=len(predictions)-len(matching), rmse=math.sqrt(squared/len(matching)),
        mae=absolute/len(matching), wape_percent=100*absolute/total if total else None,
        absolute_error_sum=absolute, squared_error_sum=squared, actual_absolute_sum=total,
        actual_source=audit, forecast_files=[str(p) for p in args.predictions],
        interpretation='Metrics on archived forecasts; not proof of an independent prospective benchmark')
    save(args.out/'metrics.json', metrics)
    wape = 'undefined (zero actual sum)' if total == 0 else f"{metrics['wape_percent']:.4f} %"
    report = f"# Forecast quality — {args.series_id}\n\nTenant: {args.tenant_id}. Unit: {actual['unit']}.\n\n| N | Coverage | RMSE | MAE | WAPE |\n|---:|---:|---:|---:|---:|\n| {len(matching)} | {metrics['coverage']:.2%} | {metrics['rmse']:.6f} | {metrics['mae']:.6f} | {wape} |\n"
    (args.out/'report.md').write_text(report, encoding='utf-8')
    print(report)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest='command', required=True)
    for name in ('seed', 'enroll', 'history', 'train', 'predict', 'retrain', 'resume', 'score'):
        sub = commands.add_parser(name)
        sub.add_argument('--tenant-id', help='Optional tenant hint; REST identity comes from the verified token')
        sub.add_argument('--env-file', type=Path, help='Explicit .env file; otherwise nearest working-directory ancestor or repository .env')
        sub.add_argument('--out', type=Path, required=True, help='New output directory; never overwritten')
        if name != 'score':
            sub.add_argument('--base-url', default='http://localhost:3900')
            sub.add_argument('--token-env', default='CET_API_TOKEN', choices=['CET_API_TOKEN'], help='Only CET_API_TOKEN is supported')
            sub.add_argument('--token-file', type=Path)
            sub.add_argument('--timeout', type=float, default=120)
            sub.add_argument('--poll-interval', type=float, default=5)
            sub.add_argument('--job-timeout', type=float, default=86400)
            sub.add_argument('--dry-run', action='store_true', help='Prepare plan without HTTP requests')
        if name in ('seed', 'enroll', 'train', 'predict', 'retrain'):
            sub.add_argument('--forecast-for', type=dt.date.fromisoformat, required=True)
        if name in ('seed', 'enroll', 'history', 'score'):
            sub.add_argument('--unit', choices=['kWh', 'kW'])
            sub.add_argument('--time-basis', choices=['berlin', 'cet', 'utc'], default='berlin')
        if name == 'seed':
            sub.add_argument('--xlsx', nargs='+', type=Path, required=True)
        if name in ('enroll', 'history'):
            sub.add_argument('--input', type=Path, required=True, help='XLSX or dataset JSON')
            sub.add_argument('--allow-corrections', action='store_true')
        if name == 'history':
            sub.add_argument('--historical-import', action='store_true')
        if name in ('enroll', 'history', 'predict', 'score'):
            sub.add_argument('--series-id', required=True)
        if name == 'train':
            sub.add_argument('--series-ids', nargs='+', required=True)
        if name in ('predict', 'retrain'):
            group = sub.add_mutually_exclusive_group(required=True)
            group.add_argument('--model-version')
            group.add_argument('--model-file', type=Path, help='result.json from train/enroll/seed')
        if name == 'predict':
            sub.add_argument('--history-version')
            sub.add_argument('--allow-stale-model', action='store_true')
        if name == 'resume':
            sub.add_argument('--run-file', type=Path, required=True)
            sub.add_argument('--restart', action='store_true', help='Explicit POST resume after server interruption')
        if name == 'score':
            sub.add_argument('--predictions', nargs='+', type=Path, required=True)
            sub.add_argument('--actuals', type=Path, required=True)
            sub.add_argument('--allow-partial', action='store_true')
    return p


def run(args):
    if args.command == 'score':
        args.tenant_id = args.tenant_id or read(args.predictions[0]).get('tenant_id')
        if not args.tenant_id:
            raise ValueError('Prediction archive has no tenant; supply --tenant-id')
        score(args)
        return
    if min(args.timeout, args.poll_interval, args.job_timeout) <= 0:
        raise ValueError('Timeouts and polling interval must be positive')
    client = None
    if not args.dry_run:
        client = Client(args)
        client.verify()
        args.tenant_id = client.tenant
    else:
        args.tenant_id = args.tenant_id or args._env_values.get('CET_TENANT_ID') or args._env_values.get('TENANT_ID')
        if args.command in ('predict', 'retrain') and not args.tenant_id and args.model_file:
            args.tenant_id = read(args.model_file).get('tenant_id')
        if args.command == 'resume' and not args.tenant_id:
            args.tenant_id = read(args.run_file).get('tenant_id')
    state = dict(tenant_id=args.tenant_id, base_url=args.base_url.rstrip('/'), operation=args.command,
                 status='preparing', uploads=[], created_at=dt.datetime.now(UTC).isoformat())
    datasets = []
    if args.command in ('seed', 'enroll', 'history'):
        files = args.xlsx if args.command == 'seed' else [args.input]
        for file in files:
            print('Read ' + file.name, flush=True)
            datasets.append(load_dataset(file, getattr(args, 'series_id', None), args.unit, args.time_basis))
        ids = [d['series_id'] for d, _ in datasets]
        if len(set(ids)) != len(ids) or (args.command == 'seed' and not 1 <= len(ids) <= 16):
            raise ValueError('Supply 1–16 distinct meters')
        if args.command == 'seed' and len({(d['unit'], d['timezone']) for d, _ in datasets}) != 1:
            raise ValueError('Initial portfolio requires common unit and timezone')
        state['inputs'] = [audit for _, audit in datasets]
    request = {}
    if args.command in ('seed', 'enroll', 'train'):
        request = dict(series_ids=[d['series_id'] for d, _ in datasets] if datasets else args.series_ids,
                       strategy='shared_baseline', forecast_for=str(args.forecast_for))
    elif args.command in ('predict', 'retrain'):
        request = dict(model_version=identifier(model_version(args)), forecast_for=str(args.forecast_for))
        if args.command == 'predict':
            request.update(series_id=args.series_id, allow_stale_model=args.allow_stale_model)
            if args.history_version:
                request['history_version'] = identifier(args.history_version)
    elif args.command == 'resume':
        state = read(args.run_file)
        if state['tenant_id'] != args.tenant_id or state['base_url'] != args.base_url.rstrip('/'):
            raise ValueError('Resume requires the original tenant and base URL')
        if not state.get('job', {}).get('run_id'):
            raise ValueError('No accepted run ID saved. Inspect imports before repeating any write.')
        request = state.get('request', {})
    state['request'] = request
    save(args.out/'run.json', state)
    if args.dry_run:
        print('Plan validated without HTTP: ' + str(args.out/'run.json'))
        return
    for dataset, audit in datasets:
        print('Import ' + dataset['series_id'], flush=True)
        state['status'] = 'upload_submission_pending'
        state['pending_series_id'] = dataset['series_id']
        save(args.out/'run.json', state)
        uploaded = client.call(ROOT+'/history', dict(dataset=dataset,
            historical_import=args.command in ('seed', 'enroll') or getattr(args, 'historical_import', False),
            allow_corrections=getattr(args, 'allow_corrections', False)))
        if uploaded.get('series_id') != dataset['series_id'] or not uploaded.get('history_version'):
            raise ValueError('History response does not match imported series')
        state['uploads'].append(uploaded)
        state.pop('pending_series_id', None)
        save(args.out/'run.json', state)
    if args.command == 'history':
        save(args.out/'result.json', dict(tenant_id=args.tenant_id, result=state['uploads'][0]))
        state['status'] = 'completed'; save(args.out/'run.json', state)
        print('History stored: ' + str(args.out/'result.json'))
        return
    if args.command == 'resume':
        job = state['job']
        if args.restart:
            job = client.call(ROOT+'/runs/'+identifier(job['run_id'])+'/resume', {})
    else:
        route = 'train' if args.command in ('seed', 'enroll') else args.command
        state['status'] = 'job_submission_pending'
        save(args.out/'run.json', state)
        job = client.call(ROOT+'/'+route, request)
    finish(client, state, args, args.out, job)


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        args._env_values = environment(args) if args.command != 'score' else {}
        args.out.mkdir(parents=True, exist_ok=False, mode=0o700)
        run(args)
        return 0
    except (ValueError, KeyError, OSError) as error:
        message = str(error)
        secret = getattr(args, '_env_values', {}).get('CET_API_TOKEN', os.environ.get('CET_API_TOKEN', ''))
        if getattr(args, 'token_file', None):
            try:
                secret = args.token_file.read_text().strip()
            except OSError:
                pass
        if secret:
            message = message.replace(secret, '[REDACTED]')
        print('ERROR: ' + message, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
