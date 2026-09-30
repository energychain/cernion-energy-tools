import copy
import datetime as dt
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import contracts
import engine as e
import runtime as r
import persistence as p
from test_engine import data


class ContractTests(unittest.TestCase):
    def test_d3_excludes_poisoned_d2_from_every_feature_and_fallback(self):
        raw=data(); method=contracts.normalize(); day=dt.date(2024,1,5)
        s=e.Series(raw,method); stamp=list(e.slots(day,s.zone))[40]
        x,b=s.features(stamp,1,0,s.day_context(day))
        other=copy.deepcopy(raw)
        cutoff=dt.datetime.combine(day-dt.timedelta(days=2),dt.time(),s.zone).timestamp()*1000
        for row in other['rows']:
            if row[0]>=cutoff: row[1]=99999999
        q=e.Series(other,method);ctx=q.day_context(day)
        np.testing.assert_equal(x,q.features(stamp,1,0,ctx)[0])
        self.assertEqual(b,q.features(stamp,1,0,ctx)[1])
        self.assertEqual(ctx['full'][0],day-dt.timedelta(days=3))
        self.assertEqual(q.day_context(day,'last_day')['full'][0],day-dt.timedelta(days=4))
        self.assertEqual(q.day_context(day,'last_3_days')['full'][0],day-dt.timedelta(days=6))
        names=contracts.feature_names(method)
        self.assertEqual(len(names),len(x))
        self.assertNotIn('lag_2',names)
        ref=s.reference_features(stamp,s.day_context(day))
        self.assertAlmostEqual(ref[5],np.mean([s.lag(day,40,k,e.origin(day,s.zone),'none') for k in [7,8,9]]))
        self.assertAlmostEqual(x[names.index('profile_mean_7_14')],ref[6])

    def test_mae_selects_against_rmse_preference_and_requires_confirmation(self):
        keys=e.BASELINES+e.BOOSTS+e.EXTRA
        metrics={k:dict(mae=10,rmse=10) for k in keys}
        metrics['weekday_median']=dict(mae=5,rmse=12)
        metrics['hgb_mae']=dict(mae=3,rmse=15)
        daily=lambda x:[dict(absolute_error_sum=x*96,sample_count=96) for _ in range(28)]
        d=dict(metrics=metrics,days={k:daily(m['mae']) for k,m in metrics.items()})
        winner,evidence=e.choose(d,d,'mae')
        self.assertEqual(winner,'hgb_mae');self.assertEqual(evidence['baseline'],'weekday_median')
        c=copy.deepcopy(d);c['metrics']['hgb_mae']['mae']=6;c['days']['hgb_mae']=daily(6)
        self.assertEqual(e.choose(d,c,'mae')[0],'weekday_median')
        c=copy.deepcopy(d);c['days']['hgb_mae']=daily(3)[:7];c['days']['weekday_median']=daily(5)[:7]
        self.assertEqual(e.choose(d,c,'mae')[0],'weekday_median')

    def test_contract_rejects_invalid_or_silent_parameters(self):
        for invalid in [dict(latest_measurement_lag=True),dict(latest_measurement_lag=1),dict(selection_objective='wape'),dict(unknown=1)]:
            with self.assertRaises(ValueError):contracts.normalize(invalid)

    def test_real_extended_models_d3_and_safe_roundtrip(self):
        day=dt.date(2024,1,5);method=contracts.normalize()
        series=[e.Series(data(k),method) for k in ['a','b']]
        with patch.dict(e.POLICY,iterations=3), tempfile.TemporaryDirectory() as folder:
            fitted=e.Fit(series,day)
            self.assertEqual(fitted.hgb['a'].get_params()['early_stopping'],False)
            for m in fitted.metadata.values():
                self.assertLess(m['training_until'],'2024-01-02T23:00:00.000Z')
            manifest=r.save_fit(fitted,folder,dict(a='hgb_week_75',b='catboost_mae'),{},dict(a='v1',b='v2'))
            loaded,_=r.load_fit(folder)
            left=fitted.forecasts(series[0],day,day+dt.timedelta(days=1))[1]
            poisoned=[data('a'),data('b')]
            forbidden=dt.datetime.combine(day-dt.timedelta(days=2),dt.time(),series[0].zone).timestamp()*1000
            for item in poisoned:
                for row in item['rows']:
                    if row[0]>=forbidden:row[1]=1e8
            other=e.Fit([e.Series(item,method) for item in poisoned],day)
            alternative=other.forecasts(series[0],day,day+dt.timedelta(days=1))[1]
            for key in left:np.testing.assert_array_equal(left[key],alternative[key])
            right=loaded.forecasts(series[0],day,day+dt.timedelta(days=1))[1]
            self.assertEqual(set(left),set(e.BASELINES+e.BOOSTS+e.EXTRA))
            for key in left: np.testing.assert_array_equal(left[key],right[key])
            result=r.forecast(dict(_artifact_dir=folder,series=[data('a')],model_version='v',forecast_for=str(day),history_versions=dict(a='v1')))
            np.testing.assert_array_equal([v['predicted_value'] for v in result['forecast_values']],left['hgb_week_75'])
            self.assertEqual(result['benchmark_contract'],method)
            entry=next(v for v in manifest['models'].values() if v.get('file','').endswith('.skops'))
            (Path(folder)/entry['file']).write_bytes(b'bad')
            with self.assertRaisesRegex(ValueError,'checksum'):r.load_fit(folder)

    def test_frozen_does_not_refit_and_exports_metric_identity(self):
        raw=[data('a'),data('b')]
        for s in raw:
            for row in s['rows']:row[1]=0
        method=contracts.normalize(dict(training_mode='frozen',candidate_set='existing'))
        with patch.object(e,'Fit',wraps=e.Fit) as fit:
            result=e.evaluate(dict(series=raw,configuration=dict(portfolio_method=method,
                forecast_period_from='2023-12-01',forecast_period_until='2023-12-30',portfolio_stress_test=False)))
            self.assertEqual(fit.call_count,3)
        for item in result['results']:
            self.assertEqual(len(item['relationship_analysis']['selections']),1)
            metric=item['backtest'];self.assertEqual(metric['absolute_error_sum'],metric['mae']*metric['sample_count'])
            self.assertEqual({v['model_fit_origin'] for v in item['forecast_values']},{'2023-11-30T06:00:00.000Z'})
            self.assertEqual(item['forecast_run']['benchmark_contract'],method)


if __name__=='__main__':unittest.main()

class FrozenResumeTests(unittest.TestCase):
    def test_frozen_resume_uses_original_artifacts_without_refitting(self):
        raw=[data('a'),data('b')]
        for item in raw:
            for row in item['rows']:row[1]=0
        with tempfile.TemporaryDirectory() as folder, patch.dict(e.POLICY,training_days=14,minimum_training_days=14):
            payload=dict(_workspace=folder,_identity='frozen-test',series=raw,configuration=dict(
                portfolio_method=dict(training_mode='frozen',candidate_set='existing'),
                forecast_period_from='2023-12-01',forecast_period_until='2023-12-30',portfolio_stress_test=False))
            def interrupt(event):
                if event['phase']=='checkpoint_saved':raise RuntimeError('interrupt')
            with self.assertRaisesRegex(RuntimeError,'interrupt'):r.execute(payload,interrupt)
            self.assertTrue((Path(folder)/'frozen-fit'/'model.json').exists())
            with patch.object(e.Fit,'__init__',side_effect=AssertionError('No frozen refit allowed')):
                result=r.execute(payload,lambda _:None)
            for entry in result['result_manifest']:
                item=p.read(Path(folder)/'results'/entry['file'])
                self.assertEqual(len(item['forecast_values']),30*96)
                self.assertEqual(len(item['relationship_analysis']['selections']),1)
                self.assertEqual(len({v['model_fit_origin'] for v in item['forecast_values']}),1)
            changed=copy.deepcopy(payload)
            changed['configuration']['portfolio_method']['latest_measurement_lag']=2
            with self.assertRaisesRegex(ValueError,'mismatch'):r.execute(changed,lambda _:None)

class AblationTests(unittest.TestCase):
    def test_hgb_stage_excludes_later_loss_and_gate_candidates(self):
        raw=[data('a'),data('b')]
        for item in raw:
            for row in item['rows']:row[1]=0
        method=contracts.normalize(dict(candidate_set='hgb'))
        series=[e.Series(item,method) for item in raw]
        day=dt.date(2024,1,5)
        with patch.dict(e.POLICY,training_days=14,minimum_training_days=14):
            fit=e.Fit(series,day)
            result=fit.forecasts(series[0],day,day+dt.timedelta(days=1))[1]
        self.assertEqual(set(result),set(e.BASELINES+e.BOOSTS+('hgb_local','hgb_week_75')))
