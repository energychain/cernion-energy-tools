#!/usr/bin/env python3
"""Portable, versioned XLSX/API forecast benchmark. No forecasting model in this client."""
import argparse
import copy
import csv
import datetime as dt
import gzip
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import jsonschema
from profile_io import read_workbook, dataset_from_records, iso, UTC
from scoring import verify_and_score

HERE = Path(__file__).resolve().parent
VERSION = '1.0.0'
API_PATH = '/api/forecast-sandbox/consumption/evaluation'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + '.partial')
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect rejected; supply the final API base URL')


class Transport:
    def __init__(self, base, out, timeout, replay=None):
        self.out, self.timeout, self.replay, self.calls = out, timeout, replay, []
        self.base = (base or '').rstrip('/')
        if not replay:
            url = urllib.parse.urlsplit(self.base)
            if (url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password
                    or url.query or url.fragment or url.path not in ('', '/')):
                raise ValueError('Supply an HTTP(S) base URL without path, credentials or query')
            if url.scheme == 'http' and url.hostname not in ('localhost', '127.0.0.1', '::1'):
                raise ValueError('Use HTTPS for non-loopback API hosts')
        self.opener = urllib.request.build_opener(NoRedirect())
        self.archive_calls = {}
        if replay:
            self.archive_calls = {r['name']: r for r in json.loads((replay / 'http-calls.json').read_text())}

    def call(self, name, endpoint, payload=None):
        body = json_bytes(payload) if payload is not None else None
        if body and len(body) > 25 * 1024 * 1024:
            raise ValueError('Request exceeds 25 MiB; do not truncate measurements to fit')
        started = time.monotonic()
        if self.replay:
            record = self.archive_calls[name]
            with gzip.open(self.replay / (name + '.json.gz'), 'rb') as handle:
                raw = handle.read()
            if digest(raw) != record['response_sha256'] or record.get('path') != endpoint:
                raise ValueError('Archive response hash/path mismatch')
            status = record.get('status', record.get('http_status'))
        else:
            headers = {'Accept': 'application/json', 'Content-Type': 'application/json'}
            token = os.environ.get('CET_API_TOKEN')
            if token:
                headers['Authorization'] = 'Bearer ' + token
            req = urllib.request.Request(self.base + endpoint, data=body, headers=headers)
            try:
                response = self.opener.open(req, timeout=self.timeout)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw, status = response.read(), response.code
            if body:
                with gzip.open(self.out / (name + '.request.json.gz'), 'wb') as handle:
                    handle.write(body)
        with gzip.open(self.out / (name + '.json.gz'), 'wb') as handle:
            handle.write(raw)
        self.calls.append({'name': name, 'path': endpoint, 'status': status,
                           'elapsed_seconds': round(time.monotonic() - started, 3),
                           'request_sha256': None if self.replay or body is None else digest(body),
                           'response_sha256': digest(raw),
                           'source': 'archive_verified' if self.replay else 'live_http'})
        save_json(self.out / 'http-calls.json', self.calls)
        if status != 200:
            raise ValueError(f'HTTP {status}; inspect {name}.json.gz')
        return json.loads(raw)


def summarize(scores):
    n = sum(s['sample_count'] for s in scores)
    expected = sum(s['expected_intervals'] for s in scores)
    square = sum(s['squared_error_sum'] for s in scores)
    absolute = sum(s['absolute_error_sum'] for s in scores)
    actual = sum(s['actual_absolute_sum'] for s in scores)
    return {'sample_count': n, 'expected_intervals': expected, 'coverage': n / expected if expected else None,
            'mse': square / n if n else None, 'rmse': math.sqrt(square / n) if n else None,
            'mae': absolute / n if n else None, 'wape_percent': 100 * absolute / actual if actual else (0 if n and absolute == 0 else None)}


def audit_result(result, dataset, config, start, until):
    run = result['forecast_run']
    expected = {'series_id': dataset['series_id'], 'timezone': dataset['timezone'],
                'mode': config['mode'], 'relationship_mode': config['relationship_mode'],
                'forecast_period_from': start, 'forecast_period_until': until}
    for key, value in expected.items():
        if run.get(key) != value:
            raise ValueError(f'API returned unexpected {key}: {run.get(key)!r}')
    if config.get('model_family') and run.get('model_family') != config['model_family']:
        raise ValueError('API ignored requested model_family; deploy compatible code before testing')
    for value in result['forecast_values']:
        if value.get('series_id') != dataset['series_id'] or value.get('unit') != dataset['unit']:
            raise ValueError('Per-value series/unit mismatch')
        stamp = dt.datetime.fromisoformat(value['timestamp'].replace('Z', '+00:00'))
        from zoneinfo import ZoneInfo
        if value['forecast_for'] != stamp.astimezone(ZoneInfo(dataset['timezone'])).date().isoformat():
            raise ValueError('forecast_for and local timestamp differ')
    if config['relationship_mode'] == 'auto' and not config.get('model_family'):
        for selection in result['relationship_analysis']['selections']:
            if selection['selection_metric'] != config['selection_metric'].upper() or selection['policy']['recent_window_days'] != config['recent_window_days']:
                raise ValueError('API ignored requested selection policy')
    scores = verify_and_score(result, dataset, dt.date.fromisoformat(start), dt.date.fromisoformat(until))
    values = result['forecast_values']
    pairs = [v for v in values if v['actual_value'] is not None]
    scores['zero_fraction'] = sum(v['actual_value'] == 0 for v in pairs) / len(pairs)
    scores['zero_interval_mae'] = conditional_error(pairs, False)
    scores['active_interval_mae'] = conditional_error(pairs, True)
    return scores


def conditional_error(pairs, active):
    errors = [abs(v['actual_value'] - v['predicted_value']) for v in pairs if (v['actual_value'] > 0) == active]
    return sum(errors) / len(errors) if errors else None


def publish(out, report):
    complete = [s for s in report['series'] if s['status'] == 'completed']
    report['aggregate'] = {mode: summarize([s[mode]['metrics'] for s in complete]) for mode in ('auto', 'baseline')}
    improvements = [s['rmse_skill_percent'] for s in complete if s['rmse_skill_percent'] is not None]
    report['comparison'] = {'complete_profiles': len(complete), 'expected_profiles': report['expected_profiles'],
                            'macro_rmse_skill_percent': sum(improvements) / len(improvements) if improvements else None,
                            'improved_profiles': sum(v > 0 for v in improvements)}
    if report['status'] == 'completed' and len(complete) != report['expected_profiles']:
        raise ValueError('Cannot report completed with missing profiles')
    jsonschema.validate(report, json.loads((HERE / 'report.schema.json').read_text()))
    save_json(out / 'report.json', report)
    columns = ['series_id', 'status', 'mse', 'rmse', 'mae', 'wape_percent', 'mape', 'bias',
               'coverage', 'zero_fraction', 'baseline_rmse', 'rmse_skill_percent', 'quality_rating', 'error']
    with (out / 'summary.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for s in report['series']:
            flat = {**s, **s.get('auto', {}).get('metrics', {}), 'baseline_rmse': s.get('baseline', {}).get('metrics', {}).get('rmse')}
            writer.writerow({key: flat.get(key) for key in columns})
    lines = ['# Standardisierter Forecast-Qualitätsbericht', '',
             f"Suite: `{report['suite_id']}` · Schema `{report['schema_version']}` · Client `{VERSION}`",
             f"Status: **{report['status']}** · Datenquelle: **{report['execution']}** · Umfang: **{report['scope']}**",
             f"Zeitraum: {report['period_from']} – {report['period_until']}; {len(complete)}/{report['expected_profiles']} Profile vollständig.",
             'Technischer Erfolg bedeutet keine gute Prognose. Güte wird separat anhand der Fehler und Baseline beurteilt.', '',
             '| Profil | RMSE | MAE | WAPE % | Baseline RMSE | RMSE-Verbesserung % | Güte | Status |',
             '|---|---:|---:|---:|---:|---:|---|---|']
    for s in report['series']:
        a = s.get('auto', {}).get('metrics', {}); b = s.get('baseline', {}).get('metrics', {})
        nums = [a.get('rmse'), a.get('mae'), a.get('wape_percent'), b.get('rmse'), s.get('rmse_skill_percent')]
        lines.append('| ' + s['series_id'] + ' | ' + ' | '.join('—' if v is None else f'{v:.4f}' for v in nums) + f" | {s.get('quality_rating', '—')} | {s['status']} |")
    a, b = report['aggregate']['auto'], report['aggregate']['baseline']
    lines += ['', '## Gesamtwerte', '', f"Automatisch: {json.dumps(a, ensure_ascii=False)}",
              f"Historienbaseline: {json.dumps(b, ensure_ascii=False)}", '',
              'MSE in (Eingabeeinheit)²; RMSE/MAE/Bias in der Eingabeeinheit je Viertelstunde. Bias = Ist minus Prognose.',
              'Gesamt-RMSE aus gepoolten Fehlerquadraten, kein Mittel der Zähler-RMSE. Große Lasten dominieren absolute Fehler.',
              'WAPE = Summe absoluter Fehler / Summe absoluter Istwerte. MAPE schließt Null-Istwerte aus; Kleinstwerte können es stark erhöhen.',
              'Qualitätsheuristik: WAPE ≤10 % high, ≤30 % medium, sonst low; Abdeckung unter der Suite-Hürde low. Keine Gütegarantie.', '',
              '## Grenzen und Provenienz', '',
              'D−2 wird pro Prognosewert geprüft; API-Trainingsinternes kann der Client nicht allein aus Metadaten beweisen.',
              'Keine historischen Revisions-/Bereitstellungsarchive: Standardverfügbarkeit wird angenommen. Keine Wetterdaten in dieser Suite.',
              'Die bekannten elf Profile wurden bereits zur Entwicklung verwendet. Wiederholte Auswertung ist kein unabhängiger Test auf neuen Daten.',
              'Report, Manifest, Client-Hashes, API-Schema, Modellversionen und HTTP-Hashes liegen im Ergebnisordner. Zugangstokens werden nicht gespeichert.',
              'Ein Replay bestätigt archivierte API-Antworten und unabhängige Fehlerberechnung; es behauptet keinen neuen Serverlauf.']
    if report.get('error'):
        lines += ['', 'Fehler: ' + report['error']]
    (out / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--manifest', type=Path, default=HERE / 'benchmark.json')
    parser.add_argument('--base-url', default=os.environ.get('CET_BASE_URL'))
    parser.add_argument('--replay', type=Path, help='Verify archived API responses instead of making live requests')
    parser.add_argument('--candidate-config', type=Path, help='Explicit optional model policy overrides; recorded in report')
    parser.add_argument('--smoke', action='store_true', help='First profile and first seven days; never a full-suite verdict')
    parser.add_argument('--timeout', type=int, default=900)
    args = parser.parse_args()
    if not args.replay and not args.base_url:
        parser.error('--base-url (or CET_BASE_URL) required for live HTTP')
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest['schema_version'] != '1.0' or len(manifest['files']) != manifest['expected_profiles']:
        parser.error('Unsupported/inconsistent manifest')
    if len({x['series_id'] for x in manifest['files']}) != len(manifest['files']):
        parser.error('Duplicate series IDs in manifest')
    config = copy.deepcopy(manifest['configuration'])
    if args.candidate_config:
        overrides = json.loads(args.candidate_config.read_text())
        if set(overrides) - {'selection_metric', 'recent_window_days', 'model_family', 'extended_features', 'issue_time', 'feature_set', 'weather_dataset_id', 'context_dataset_id'}:
            parser.error('Candidate overrides may not alter dates, input data or feature availability')
        config.update(overrides)
    files = manifest['files'][:1] if args.smoke else manifest['files']
    start = manifest['period_from']
    until = (dt.date.fromisoformat(start) + dt.timedelta(days=6)).isoformat() if args.smoke else manifest['period_until']
    args.out.mkdir(parents=True, exist_ok=False)
    report = {'schema_version': '1.0', 'suite_id': manifest['suite_id'], 'status': 'running',
              'execution': 'archived_api_replay' if args.replay else 'live_http',
              'scope': 'smoke' if args.smoke else 'full', 'expected_profiles': len(files),
              'period_from': start, 'period_until': until, 'unit': manifest['unit'], 'timezone': manifest['timezone'],
              'configuration': config, 'started_at': iso(dt.datetime.now(UTC)), 'series': [],
              'provenance': {'client_version': VERSION, 'python': platform.python_version(),
                             'dependencies': {name: importlib.metadata.version(name) for name in ('openpyxl', 'jsonschema')},
                             'manifest_sha256': digest(manifest_bytes), 'configuration_sha256': digest(json_bytes(config)),
                             'client_files': {f.name: digest(f.read_bytes()) for f in sorted(HERE.glob('*.py'))},
                             'api_url': args.base_url if not args.replay else None,
                             'server_source_revision': 'not_exposed_by_API'}}
    (args.out / 'manifest.json').write_bytes(manifest_bytes)
    publish(args.out, report)
    try:
        transport = Transport(args.base_url, args.out, args.timeout, args.replay)
        spec = transport.call('openapi', '/api/forecast-sandbox/openapi.json')
        for action in ('run', 'validate'):
            if not spec.get('paths', {}).get(API_PATH + '/' + action, {}).get('post'):
                raise ValueError('Evaluation API missing from target server')
        for index, entry in enumerate(files, 1):
            row = {'series_id': entry['series_id'], 'file': entry['file'], 'status': 'running'}
            report['series'].append(row)
            publish(args.out, report)
            print(f"[{index}/{len(files)}] {entry['series_id']}: XLSX/hash verification", flush=True)
            try:
                source = (args.data_dir / entry['file']).resolve()
                if not source.is_relative_to(args.data_dir.resolve()):
                    raise ValueError('Manifest path escapes data directory')
                if digest(source.read_bytes()) != entry['sha256']:
                    raise ValueError('Input SHA-256 differs from benchmark manifest')
                records, audit = read_workbook(source)
                dataset = dataset_from_records(records, audit, manifest['unit'], manifest['time_basis'])
                if dataset['series_id'] != entry['series_id'] or dataset['timezone'] != manifest['timezone']:
                    raise ValueError('Dataset identity/timezone differs from manifest')
                if config.get('weather_dataset_id'):
                    dataset['weather_region'] = 'DE-BY-Kempten-87435'
                row['input'] = audit
                auto = {**config, 'history_from': dataset['period_from'], 'forecast_period_from': start, 'forecast_period_until': until}
                base = {'issue_time': config.get('issue_time', '00:00'), 'mode': 'rolling_day_ahead', 'relationship_mode': 'manual', 'feature_set': ['history'],
                        'history_from': dataset['period_from'], 'forecast_period_from': start, 'forecast_period_until': until}
                payload = {'datasets': [dataset], 'configuration': auto, 'payload_fit_confirmed': False}
                validation = transport.call(entry['series_id'] + '-validation', API_PATH + '/validate', payload)
                row['validation'] = validation
                if validation.get('status') != 'data_validated':
                    raise ValueError('API data validation failed')
                for mode, effective in (('auto', auto), ('baseline', base)):
                    print(f"[{index}/{len(files)}] {entry['series_id']}: {mode}", flush=True)
                    payload.update(configuration=effective, payload_fit_confirmed=True)
                    result = transport.call(entry['series_id'] + '-' + mode, API_PATH + '/run', payload)['results'][0]
                    scores = audit_result(result, dataset, effective, start, until)
                    if scores['coverage'] < manifest['minimum_coverage']:
                        raise ValueError('Insufficient actual coverage; incomplete periods cannot pass this suite')
                    row[mode] = {'metrics': scores, 'model_version': result['forecast_run']['model_version'],
                                 'forecast_run_id': result['forecast_run']['forecast_run_id'],
                                 'warnings': result['readiness_dossier']['warnings']}
                am, bm = row['auto']['metrics'], row['baseline']['metrics']
                row['rmse_skill_percent'] = 100 * (1 - am['rmse'] / bm['rmse']) if bm['rmse'] else None
                wape = am['wape_percent']; thresholds = manifest['quality_thresholds']
                row['quality_rating'] = ('low' if wape is None else 'high' if wape <= thresholds['high_wape_percent']
                                         else 'medium' if wape <= thresholds['medium_wape_percent'] else 'low')
                row['status'] = 'completed'
            except Exception as error:
                row.update(status='failed', error=str(error))
                print(f"FAILED {entry['series_id']}: {error}", file=sys.stderr, flush=True)
            publish(args.out, report)
        versions = {row['auto']['model_version'] for row in report['series'] if row['status'] == 'completed'}
        if len(versions) > 1:
            raise ValueError('Mixed API model versions in a single suite run')
        report['status'] = 'completed' if all(row['status'] == 'completed' for row in report['series']) else 'incomplete'
    except KeyboardInterrupt:
        report.update(status='interrupted', error='Interrupted by operator; partial results only')
    except Exception as error:
        report.update(status='failed', error=str(error))
    report['finished_at'] = iso(dt.datetime.now(UTC))
    publish(args.out, report)
    print(f"{report['status']}: {args.out / 'report.md'}", flush=True)
    return 0 if report['status'] == 'completed' else 1


if __name__ == '__main__':
    sys.exit(main())
