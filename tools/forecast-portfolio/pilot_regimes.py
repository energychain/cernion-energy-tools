#!/usr/bin/env python3
"""Development-only seasonal pilot; identical inputs/origins for baseline and challenger."""
import argparse
import datetime as dt
import gzip
import json
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine-root',type=Path,required=True)
    parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--candidates',choices=['extended','regime'],required=True)
    args=parser.parse_args()
    sys.path.insert(0,str(args.engine_root.resolve()))
    import engine as e
    results=[]
    for first in ['2024-01-01','2024-07-01']:
        begin=dt.date.fromisoformat(first);end=begin+dt.timedelta(days=13)
        series=[]
        for meter in [3,8,10,11]:
            dataset=json.load(gzip.open(args.archive/f'{meter:03d}-upload.request.json.gz','rt'))['dataset']
            zone=ZoneInfo(dataset['timezone']);rows=[]
            for value in dataset['values']:
                stamp=dt.datetime.fromisoformat(value['timestamp'].replace('Z','+00:00'))
                day=stamp.astimezone(zone).date()
                if begin-dt.timedelta(days=320)<=day<=end:
                    availability=dt.datetime.combine(day+dt.timedelta(days=1),dt.time(),zone)
                    rows.append([stamp.timestamp()*1000,value['value'],availability.timestamp()*1000])
            series.append(dict(series_id=dataset['series_id'],unit=dataset['unit'],timezone=dataset['timezone'],validation={},rows=rows))
        method=dict(latest_measurement_lag=3,feature_profile='e2_v1',selection_objective='mae',candidate_set=args.candidates,training_mode='rolling')
        started=time.monotonic()
        result=e.evaluate(dict(series=series,configuration=dict(portfolio_method=method,
            forecast_period_from=first,forecast_period_until=str(end),portfolio_stress_test=False)))
        for item in result['results']:
            result_row=dict(first=first,series_id=item['forecast_run']['series_id'],metrics=item['backtest'],
                operational=item['diagnostics'].get('operational'),candidates=item['benchmark_metrics'],
                selections=item['relationship_analysis']['selections'])
            results.append(result_row)
        args.out.write_text(json.dumps(dict(status='running',method=method,source_sha256=e.SOURCE_SHA256,
            note='Four-meter development pilot, not eleven-meter independent quality evidence',results=results),indent=2)+'\n')
        print(first,'completed',round(time.monotonic()-started,1),'s',flush=True)
    summary=json.loads(args.out.read_text());summary['status']='completed';args.out.write_text(json.dumps(summary,indent=2)+'\n')

if __name__=='__main__':main()
