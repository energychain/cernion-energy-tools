#!/usr/bin/env python3
"""Merge publisher CSV/XLSX histories into audited, direction-separated JSON datasets."""
import argparse
import csv
import datetime as dt
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import re
from collections import defaultdict
from zoneinfo import ZoneInfo
from forecast_product import load_dataset, stamp

UTC = dt.timezone.utc
BERLIN = ZoneInfo('Europe/Berlin')
STEP = dt.timedelta(minutes=15)
SIMPLE = ['Zeit', 'Zeit (UTC)', 'Zählerstand (Wh)', 'Leistung (W)']
DUAL = ['Zeit', 'Zeit (UTC)', 'Zählerstand Bezug (Wh)', 'Zählerstand Einspeisung (Wh)',
        'Leistung Bezug (W)', 'Leistung Einspeisung (W)']


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(data, stream, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
        stream.write('\n')


def csv_groups(paths):
    groups = {}
    audit = []
    hashes = {}
    for path in sorted(paths):
        match = re.search(r'Zähler (\d+)(?: \(\d+\))?\.csv$', path.name, re.IGNORECASE)
        if not match:
            raise ValueError(f'{path.name}: explicit meter identifier required in filename')
        meter = match[1]
        checksum = digest(path)
        item = dict(file=path.name, sha256=checksum, meter_id=meter)
        # Deduplicate within an identity; identical bytes for DIFFERENT meters are not silently merged.
        key = (meter, checksum)
        if key in hashes:
            item['duplicate_of'] = hashes[key]
            audit.append(item)
            continue
        hashes[key] = path.name
        raw = path.read_bytes()
        try:
            text = raw.decode('utf-8-sig'); encoding = 'utf-8-sig'
        except UnicodeDecodeError:
            text = raw.decode('cp1252'); encoding = 'cp1252'
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames not in (SIMPLE, DUAL):
            raise ValueError(f'{path.name}: unsupported CSV schema')
        group = groups.setdefault(meter, dict(rows={}, fields=reader.fieldnames, files=[], overlaps=0))
        if group['fields'] != reader.fieldnames:
            raise ValueError(f'{meter}: incompatible channels across files')
        group['files'].append(path.name)
        count = 0
        for line, row in enumerate(reader, 2):
            try:
                end = dt.datetime.strptime(row['Zeit (UTC)'], '%d.%m.%Y %H:%M').replace(tzinfo=UTC)
                local = dt.datetime.strptime(row['Zeit'], '%d.%m.%Y %H:%M')
                if end.minute % 15 or end.astimezone(BERLIN).replace(tzinfo=None) != local:
                    raise ValueError('UTC/local timestamp or PT15M mismatch')
                values = tuple(Decimal(row[k]) for k in reader.fieldnames[2:])
                if any(not v.is_finite() or v < 0 for v in values):
                    raise ValueError('nonfinite/negative value')
                if end in group['rows']:
                    if group['rows'][end] != values:
                        raise ValueError('conflicting values for same meter/timestamp')
                    group['overlaps'] += 1
                else:
                    group['rows'][end] = values
            except Exception as exc:
                raise ValueError(f'{path.name}:{line}: {exc}') from exc
            count += 1
        item.update(encoding=encoding, records=count)
        audit.append(item)
    return groups, audit


def csv_datasets(groups):
    output = []
    for meter, group in sorted(groups.items()):
        names = group['fields'][2:]
        rows = sorted(group['rows'].items())
        if not rows:
            raise ValueError(f'{meter}: empty CSV data')
        dual = group['fields'] == DUAL
        channels = [('import', ' Bezug'), ('export', ' Einspeisung')] if dual else [('import', '')]
        for direction, label in channels:
            register = names.index('Zählerstand'+label+' (Wh)')
            power = names.index('Leistung'+label+' (W)')
            checked = 0
            for (a, av), (b, bv) in zip(rows, rows[1:]):
                if b-a == STEP:
                    if bv[register]-av[register] != bv[power]/4:
                        raise ValueError(f'{meter}/{direction}: register/power inconsistency at {b.isoformat()}')
                    checked += 1
            values = [dict(timestamp=(end-STEP).isoformat(), value=float(v[power]/Decimal(4000))) for end,v in rows]
            output.append((dict(series_id=f'csv-{meter}-{direction}', meter_id=meter,
                                target_direction=direction, unit='kWh', timezone='Europe/Berlin',
                                value_semantics='interval_energy', values=values),
                           dict(sources=group['files'], overlaps_removed=group['overlaps'],
                                counter_intervals_checked=checked, direction_assumed=not dual,
                                nearly_constant=len({v[power] for _,v in rows}) <= 2)))
    return output


def describe(dataset, audit, filename, checksum):
    stamps = sorted(stamp(v['timestamp']) for v in dataset['values'])
    gaps = [dict(after=a.isoformat(), before=b.isoformat(), missing_intervals=int((b-a)/STEP)-1)
            for a,b in zip(stamps, stamps[1:]) if b-a != STEP]
    return dict(file=filename, sha256=checksum, series_id=dataset['series_id'],
                target_direction=dataset['target_direction'], meter_id=dataset.get('meter_id'),
                unit=dataset['unit'], timezone=dataset['timezone'], records=len(stamps),
                first=stamps[0].isoformat(), last=stamps[-1].isoformat(), gaps=gaps, **audit)


def prepare(source, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    paths = sorted(p for p in source.iterdir() if p.is_file() and p.suffix.lower() in ('.csv','.xlsx'))
    if not paths:
        raise ValueError('No CSV/XLSX files found')
    groups, files = csv_groups([p for p in paths if p.suffix.lower()=='.csv'])
    descriptors = []
    seen = set()

    def store(dataset, audit):
        sid = dataset['series_id']
        if sid in seen:
            raise ValueError('Duplicate output series identity: '+sid)
        seen.add(sid)
        # Fixed, safe filenames; identity is retained in the dataset and manifest.
        name = dataset['target_direction']+'/'+hashlib.sha256(sid.encode()).hexdigest()+'.json'
        write(out/name, dataset)
        descriptors.append(describe(dataset,audit,name,digest(out/name)))

    for dataset, audit in csv_datasets(groups):
        store(dataset,audit)
    for path in paths:
        if path.suffix.lower() != '.xlsx':
            continue
        print('Reading '+path.name, flush=True)
        dataset,audit = load_dataset(path,unit='kWh',basis='berlin')
        dataset.update(target_direction='import',value_semantics='interval_energy')
        store(dataset,dict(sources=[path.name],overlaps_removed=0,direction_assumed=True,
                           source_audit=audit))
        files.append(dict(file=path.name,sha256=digest(path)))
    suggestions = {}
    for direction in ('import','export'):
        selected = [r for r in descriptors if r['target_direction']==direction]
        if selected:
            latest=max(stamp(r['last']).astimezone(BERLIN).date() for r in selected)
            suggestions[direction]=str(latest+dt.timedelta(days=3))
    manifest=dict(format='cet-prepared-training',schema=1,source=str(source.resolve()),
                  files=files,series=descriptors,suggested_forecast_for=suggestions,
                  policy=dict(merge='meter_id + UTC + direction',null_gaps='preserved',
                              conversion='W / 4000 -> kWh; UTC end - 15 minutes -> start',
                              shared_direction_pooling=False),
                  warnings=['Generic CSV power and historical XLSX are treated as import/load.',
                            'Aggregation independence and nearly constant profiles require domain review.',
                            'No learned weights or public artifact created by data preparation.'])
    write(out/'manifest.json',manifest)
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args()
    result=prepare(args.source,args.out)
    print(json.dumps(dict(status='prepared',series=len(result['series']),manifest=str(args.out/'manifest.json'))))


if __name__=='__main__':main()
