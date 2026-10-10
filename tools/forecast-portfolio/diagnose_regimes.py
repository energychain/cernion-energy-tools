#!/usr/bin/env python3
"""Read-only error decomposition of archived v2 candidates. Oracle is diagnostic only."""
import argparse
import gzip
import json
from pathlib import Path


def analyze(archive,meters):
    results={}
    for meter in meters:
        source=archive/f'{meter:03d}-series-result-attempt-1.response.json.gz'
        result=json.load(gzip.open(source,'rt'));rows=result['forecast_values'];n=len(rows)
        positive=sum(v['actual_value']>v['low_load_threshold'] for v in rows)
        total=sum(v['actual_value'] for v in rows)
        thresholds=[s['training'][f'meter-{meter}']['low_load_threshold'] for s in result['relationship_analysis']['selections']]
        tp=pp=0; brier=0.;oracle=soft=gate=0.;eligible=0
        errors={k:dict(active=0.,low=0.) for k in rows[0]['candidate_predictions']}
        low_energy=0.
        for value in rows:
            actual=value['actual_value'];active=actual>value['low_load_threshold'];prob=value['candidate_active_probability']
            tp+=int(active and prob>=.5);pp+=int(prob>=.5);brier+=(prob-active)**2
            if not active:low_energy+=actual
            for key,prediction in value['candidate_predictions'].items():errors[key]['active' if active else 'low']+=abs(actual-prediction)
            if 1e-8<prob<1-1e-8:
                mixed=value['candidate_predictions']['catboost_hurdle'];hard=value['candidate_predictions']['hurdle_gate']
                if prob>=.5:hi=hard;lo=(mixed-prob*hi)/(1-prob)
                else:lo=hard;hi=(mixed-(1-prob)*lo)/prob
                oracle+=abs(actual-(hi if active else lo));soft+=abs(actual-mixed);gate+=abs(actual-hard);eligible+=1
        results[str(meter)]=dict(N=n,active_share=positive/n,low_energy_share=low_energy/total if total else None,
            threshold_min=min(thresholds),threshold_max=max(thresholds),precision=tp/pp if pp else None,
            recall=tp/positive if positive else None,brier=brier/n,
            constant_test_prevalence_brier=positive/n*(1-positive/n),
            oracle_count=eligible,oracle_MAE=oracle/eligible if eligible else None,
            soft_MAE_same_subset=soft/eligible if eligible else None,gate_MAE_same_subset=gate/eligible if eligible else None,
            conditional_MAE={k:dict(active=v['active']/positive if positive else None,
                low=v['low']/(n-positive) if n>positive else None) for k,v in errors.items()})
    return dict(archive=str(archive),note='Oracle uses target state; not an eligible forecasting candidate. Test-prevalence Brier is retrospective, not a trained baseline.',results=results)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--meters',type=int,nargs='+',default=[3,8,10,11]);args=parser.parse_args()
    args.out.write_text(json.dumps(analyze(args.archive,args.meters),indent=2)+'\n')


if __name__=='__main__':main()
