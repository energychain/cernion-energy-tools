#!/usr/bin/env python3
"""Run both isolated publisher training directions from a verified prepared manifest."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import prepared_training
import persistence as p


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--check-only',action='store_true')
    parser.add_argument('--mode',choices=['baseline','adaptation'],default='baseline',
                        help='baseline: full-history seasonal common-model validation; adaptation: previous recent-window product fit')
    parser.add_argument('--forecast-for',type=dt.date.fromisoformat,help='Optional common historical origin; default: per-direction suggestion')
    args=parser.parse_args()
    os.umask(0o077)
    manifest=json.loads(args.prepared.read_text())
    if manifest.get('format')!='cet-prepared-training' or manifest.get('schema')!=1:
        parser.error('Unsupported prepared manifest')
    args.out.mkdir(mode=0o700)
    receipts={}
    for direction in ('import','export'):
        if not any(x['target_direction']==direction for x in manifest['series']):
            continue
        day=args.forecast_for or dt.date.fromisoformat(manifest['suggested_forecast_for'][direction])
        if args.mode=='baseline':
            import baseline_training
            receipts[direction]=baseline_training.run(args.prepared,direction,day,args.out/direction,args.check_only)
        else:
            receipts[direction]=prepared_training.run(args.prepared,direction,day,args.out/direction,args.check_only)
        p.atomic(args.out/'run.json',dict(status='running',directions=receipts))
    result=dict(status='ready' if args.check_only else 'trained',directions=receipts,
                public_package_created=False)
    p.atomic(args.out/'run.json',result)
    print(json.dumps(result))


if __name__=='__main__':main()
