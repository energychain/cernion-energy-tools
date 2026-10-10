#!/usr/bin/env python3
"""Offline publisher training from explicitly supplied XLSX/JSON; output stays private."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo
from forecast_product import load_dataset, stamp
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'forecast-portfolio'))
import engine as e
import product
import persistence as p


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs=parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--input', nargs='+', type=Path)
    inputs.add_argument('--prepared', type=Path, help='manifest.json from prepare_training_data.py')
    parser.add_argument('--direction', choices=['import','export'])
    parser.add_argument('--check-only', action='store_true', help='Prepared data: validate causal coverage without training')
    parser.add_argument('--forecast-for', required=True, type=dt.date.fromisoformat)
    parser.add_argument('--unit', choices=['kWh', 'kW'], required=True)
    parser.add_argument('--time-basis', choices=['berlin', 'cet', 'utc'], default='berlin')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.prepared:
        import prepared_training
        result=prepared_training.run(args.prepared,args.direction,args.forecast_for,args.out,args.check_only,unit=args.unit)
        print(json.dumps(result))
        return
    if args.check_only or args.direction:
        parser.error('--check-only/--direction require --prepared')
    args.out.mkdir(mode=0o700)
    series, audit = [], []
    for file in args.input:
        print('Reading ' + file.name, flush=True)
        dataset, info = load_dataset(file, unit=args.unit, basis=args.time_basis)
        zone = ZoneInfo(dataset['timezone'])
        rows = []
        # Preserve enough warmup for the complete 180-day training/validation procedure.
        for row in dataset['values']:
            when = stamp(row['timestamp'])
            local_day = when.astimezone(zone).date()
            if args.forecast_for - dt.timedelta(days=240) <= local_day < args.forecast_for:
                available = dt.datetime.combine(local_day+dt.timedelta(days=1),dt.time(),zone).timestamp()*1000
                rows.append([when.timestamp()*1000, row['value'], available, available])
        rows.sort()
        series.append(dict(series_id=dataset['series_id'], unit=dataset['unit'], timezone=dataset['timezone'], rows=rows, validation={}))
        audit.append(info)
    if len({s['series_id'] for s in series}) != len(series):
        raise ValueError('Duplicate series IDs')
    if len({(s['unit'], s['timezone']) for s in series}) != 1:
        raise ValueError('Common unit/timezone required')
    identity = product.digest_json(dict(input=audit, forecast_for=str(args.forecast_for), engine=e.SOURCE_SHA256))
    owner = hashlib.sha256(b'offline-starter-publisher').hexdigest()
    task = dict(_workspace=str(args.out.resolve()), _identity=identity, _owner=owner,
                _shared_root=str((args.out/'private-references').resolve()),
                series=series, forecast_for=str(args.forecast_for), reference_snapshots=[],
                contribution_keys={s['series_id']:hashlib.sha256(s['series_id'].encode()).hexdigest() for s in series},
                history_versions={s['series_id']:product.digest_json(s) for s in series},
                portfolio_method=e.contracts.normalize(dict(latest_measurement_lag=3,feature_profile='e2_v1',selection_objective='mae',candidate_set='extended',training_mode='rolling')))
    p.atomic(args.out/'private-input-audit.json', audit)
    result = product.train(task, lambda state: print(state['message'], flush=True))
    p.atomic(args.out/'result.json', result)
    print(json.dumps(dict(status='trained', model_directory=str(args.out), public_package_created=False)))


if __name__ == '__main__':
    main()
