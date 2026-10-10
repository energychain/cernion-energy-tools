import copy
import datetime as dt
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import engine as e
import contracts
import regimes
import runtime as r
from test_engine import data

class RegimeTests(unittest.TestCase):
    def test_positive_base_is_never_relabeled_zero(self):
        self.assertEqual(regimes.labels([0,.05,.2,3],.2).tolist(),[0,1,1,2])
        q=regimes.describe([0,.05,3],[0,0,0],[.2]*3)
        self.assertEqual(q['state_metrics']['base']['actual_energy'],.05)
        self.assertEqual(q['mae_skill_vs_zero'],0)
        self.assertIn('no_mae_skill_over_zero_reference',q['warnings'])
        self.assertIn('severe_energy_underprediction',q['warnings'])
        self.assertIsNone(regimes.describe([0],[0],[0])['mae_skill_vs_zero'])

    def test_absent_classes_have_zero_probability(self):
        class Model:
            classes_=np.array([0,2])
            def predict_proba(self,x):return np.array([[.3,.7]]*len(x))
        np.testing.assert_array_equal(regimes.probabilities(Model(),[[1],[2]]),[[.3,0,.7],[.3,0,.7]])
        np.testing.assert_array_equal(regimes.probabilities(2.0,[[1]]),[[0,0,1]])

    def test_new_features_respect_d3_and_delayed_history(self):
        raw=data();method=contracts.normalize(dict(candidate_set='regime'));s=e.Series(raw,method)
        day=dt.date(2024,1,5);stamp=list(e.slots(day,s.zone))[40];ctx=s.day_context(day)
        base=s.features(stamp,1,.2,ctx)[0]
        expected=regimes.features(s,stamp,ctx,1,.2,base)
        changed=copy.deepcopy(raw)
        cutoff=dt.datetime.combine(day-dt.timedelta(days=2),dt.time(),s.zone).timestamp()*1000
        for row in changed['rows']:
            if row[0]>=cutoff:row[1]=1e10
        other=e.Series(changed,method);context=other.day_context(day)
        np.testing.assert_equal(expected,regimes.features(other,stamp,context,1,.2,other.features(stamp,1,.2,context)[0]))
        context=other.day_context(day,'last_3_days')
        self.assertEqual(context['full'][0],day-dt.timedelta(days=6))
        self.assertTrue(np.isfinite(regimes.features(other,stamp,context,1,.2,base,'last_3_days')[-1]))

    def test_real_three_state_models_reload_and_predict_identically(self):
        raw=[data('a'),data('b')]
        for item in raw:
            for row in item['rows']:
                hour=dt.datetime.fromtimestamp(row[0]/1000,e.UTC).hour
                if row[1]==0 and hour in [4,5]:row[1]=.05
        method=contracts.normalize(dict(candidate_set='regime'));series=[e.Series(v,method) for v in raw]
        day=dt.date(2024,1,5)
        with patch.dict(e.POLICY,iterations=4),tempfile.TemporaryDirectory() as folder:
            fit=e.Fit(series,day)
            self.assertTrue(all(v>0 for v in fit.regime_metadata['a']['training_counts'].values()))
            self.assertEqual(len(fit.regime_metadata['a']['input_feature_names']),len(fit.regime_classifiers['a'].feature_names_))
            selected=dict(a='regime_local_hard',b='regime_local_soft')
            r.save_fit(fit,folder,selected,{},dict(a='v',b='v'))
            loaded,_=r.load_fit(folder)
            self.assertEqual(loaded.regime_metadata,fit.regime_metadata)
            stamps,left,_,ctx=fit.forecasts(series[0],day,day+dt.timedelta(days=1))
            _,right,_,other=loaded.forecasts(series[0],day,day+dt.timedelta(days=1))
            for name in left:np.testing.assert_array_equal(left[name],right[name])
            np.testing.assert_array_equal(list(ctx[day]['state_probabilities'].values()),list(other[day]['state_probabilities'].values()))
            for probs in ctx[day]['state_probabilities'].values():self.assertAlmostEqual(sum(probs),1)
            reply=r.forecast(dict(_artifact_dir=folder,series=[raw[0]],forecast_for=str(day),model_version='v',history_versions=dict(a='v')))
            np.testing.assert_array_equal([v['predicted_value'] for v in reply['forecast_values']],left['regime_local_hard'])
            self.assertEqual(reply['forecast_values'][0]['state_probabilities'],ctx[day]['state_probabilities'][e.iso(stamps[0])])

if __name__=='__main__':unittest.main()
