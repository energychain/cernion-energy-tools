#!/usr/bin/env python3
"""Compare two timestamp-aligned CSV[.gz] exports; never silently drop intervals."""
import argparse
import csv
import datetime as dt
import gzip
import json
import math
import random
from collections import defaultdict
from pathlib import Path


def read_rows(path):
    opener=gzip.open if str(path).endswith('.gz') else open
    with opener(path,'rt',newline='') as handle:
        rows={}
        for row in csv.DictReader(handle):
            stamp=dt.datetime.fromisoformat(row['timestamp'].replace('Z','+00:00'))
            if stamp.tzinfo is None:raise ValueError('Timestamps require timezone offsets')
            key=(row['series_id'],stamp.astimezone(dt.timezone.utc).isoformat())
            if key in rows:raise ValueError(f'Duplicate interval: {key}')
            for field in ['actual_value','predicted_value']:
                row[field]=float(row[field])
                if not math.isfinite(row[field]):raise ValueError('Non-finite measurement/prediction')
            rows[key]=row
    if not rows:raise ValueError('Empty forecast export')
    return rows


def compare(left,right,block_days=7):
    if set(left)!=set(right):
        raise ValueError(f'Target intervals differ: left-only={len(set(left)-set(right))}, right-only={len(set(right)-set(left))}')
    by_series=defaultdict(list)
    verified=True
    for key in sorted(left):
        a,b=left[key],right[key]
        if a['actual_value']!=b['actual_value']:raise ValueError(f'Actual values differ at {key}')
        for field in ['unit','forecast_for','forecast_created_at','latest_measurement_lag','training_mode']:
            if not a.get(field) or not b.get(field):verified=False
            elif a[field]!=b[field]:raise ValueError(f'Information contract differs: {field} at {key}')
        by_series[key[0]].append((key,a,b))
    results={}
    for series,rows in by_series.items():
        daily=defaultdict(lambda:[0.,0.,0])
        for key,a,b in rows:
            day=a.get('forecast_for') or key[1][:10]
            daily[day][0]+=abs(a['actual_value']-a['predicted_value'])
            daily[day][1]+=abs(b['actual_value']-b['predicted_value'])
            daily[day][2]+=1
        values=[daily[d] for d in sorted(daily)]
        denominator=math.fsum(abs(a['actual_value']) for _,a,_ in rows)
        totals=[math.fsum(v[i] for v in values) for i in (0,1)]
        interval=None
        dates=[dt.date.fromisoformat(day) for day in sorted(daily)]
        contiguous=all(b-a==dt.timedelta(days=1) for a,b in zip(dates,dates[1:]))
        if len(values)>=2*block_days and contiguous:
            rng=random.Random(73471);boot=[]
            for _ in range(2000):
                indices=[]
                while len(indices)<len(values):
                    first=rng.randrange(len(values)-block_days+1)
                    indices.extend(range(first,first+block_days))
                indices=indices[:len(values)]
                boot.append(sum(values[i][0]-values[i][1] for i in indices)/sum(values[i][2] for i in indices))
            boot.sort();interval=[boot[49],boot[1949]]
        results[series]=dict(N=len(rows),actual_absolute_sum=denominator,
            left_absolute_error_sum=totals[0],right_absolute_error_sum=totals[1],
            left_WAPE=100*totals[0]/denominator if denominator else None,
            right_WAPE=100*totals[1]/denominator if denominator else None,
            left_minus_right_MAE_interval=interval,bootstrap_block_days=block_days)
    return dict(information_fields_match=verified,
        limitation='Training windows, fit origins, validation rules and input revisions require separate manifest review; interval is descriptive, not independent post-selection evidence.',series=results)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--left',required=True,type=Path);parser.add_argument('--right',required=True,type=Path)
    parser.add_argument('--block-days',type=int,default=7);parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args()
    if args.block_days<1:parser.error('block-days must be positive')
    result=compare(read_rows(args.left),read_rows(args.right),args.block_days)
    args.out.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')


if __name__=='__main__':main()
