import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from compare_context import compare

class ContextComparisonContract(unittest.TestCase):
    def write(self, root, hour, prediction, bad_actual=False):
        root.mkdir()
        report = {'status':'completed', 'scope':'full', 'suite_id':'test', 'period_from':'2024-01-01', 'period_until':'2024-01-28',
            'unit':'kWh', 'timezone':'UTC', 'expected_profiles':1, 'configuration':{'issue_time':hour},
            'provenance':{'manifest_sha256':'same'}, 'series':[{'series_id':'meter-1'}]}
        (root/'report.json').write_text(json.dumps(report))
        values=[]
        for n in range(28):
            date=dt.date(2024,1,1)+dt.timedelta(days=n)
            values.append({'series_id':'meter-1', 'unit':'kWh', 'timestamp':f'{date}T12:00:00Z', 'forecast_for':str(date),
                'forecast_created_at':f'{date-dt.timedelta(days=1)}T{hour}:00Z',
                'training_data_until':f'{date-dt.timedelta(days=2)}T23:45:00Z',
                'actual_value':2 if bad_actual else 1, 'predicted_value':prediction, 'selected_predictors':['day_ahead_price'],
                'state_features':{'model_fitted_at':'2023-12-01T00:00:00Z', 'known_lag_states':[]}})
        result={'forecast_run':{'issue_time':hour,'feature_sources':{}}, 'forecast_values':values,
            'daily_results':[], 'relationship_analysis':{'selections':[]}, 'readiness_dossier':{'warnings':[]}}
        raw=json.dumps({'results':[result]}).encode()
        (root/'meter-1-auto.json.gz').write_bytes(gzip.compress(raw))
        (root/'http-calls.json').write_text(json.dumps([{'name':'meter-1-auto','response_sha256':hashlib.sha256(raw).hexdigest()}]))

    def test_different_external_origins_are_explicit_but_actuals_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.write(root/'candidate','18:00',2)
            self.write(root/'reference','00:00',3)
            report=compare(root/'candidate',root/'reference')
            self.assertEqual(report['macro_rmse_gain_percent'],50)
            self.assertEqual(report['series'][0]['candidate_issue_time'],'18:00')
            self.assertEqual(report['series'][0]['reference_issue_time'],'00:00')
            self.assertEqual(report['series'][0]['feature_used_interval_percent'],{'day_ahead_price':100})
            self.assertIn('policy_change',report['comparison_type'])
            self.write(root/'bad','00:00',3,True)
            with self.assertRaisesRegex(ValueError,'Unpaired'):
                compare(root/'candidate',root/'bad')
