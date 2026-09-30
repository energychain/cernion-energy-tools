import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from compare_states import metrics, read_run


class StateComparisonContract(unittest.TestCase):
    def test_metrics_use_interval_errors_not_average_profile_rmse(self):
        self.assertEqual(metrics([0, 0], [0, 10])['mse'], 50)

    def test_tampered_response_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'report.json').write_text(json.dumps({'status':'completed','scope':'full','series':[{'series_id':'meter-1'}]}))
            (root/'http-calls.json').write_text(json.dumps([{'name':'meter-1-auto','response_sha256':'wrong'}]))
            (root/'meter-1-auto.json.gz').write_bytes(gzip.compress(b'{}'))
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                read_run(root)

    def test_complete_paired_comparison_and_mismatched_actual_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for mode in ['candidate','reference']:
                folder=root/mode;folder.mkdir()
                report={'status':'completed','scope':'full','suite_id':'test','period_from':'2024-01-01','period_until':'2024-01-28',
                        'unit':'kWh','timezone':'Europe/Berlin','expected_profiles':11,'execution':'live_http',
                        'provenance':{'manifest_sha256':'same'},'series':[{'series_id':f'meter-{i}'} for i in range(1,12)]}
                (folder/'report.json').write_text(json.dumps(report));calls=[]
                for entry in report['series']:
                    vals=[]
                    for day in range(1,29):
                        v={'series_id':entry['series_id'],'timestamp':f'2024-01-{day:02}T12:00:00Z','forecast_for':f'2024-01-{day:02}',
                           'actual_value':1,'unit':'kWh','forecast_created_at':'same-origin','predicted_value':2 if mode=='candidate' else 3}
                        if mode=='candidate':v['state_features']={'probabilities':[1,0,0],'enabled':True,'without_state_prediction':4,'candidate_prediction':2}
                        vals.append(v)
                    raw=json.dumps({'results':[{'forecast_values':vals}]}).encode();name=entry['series_id']+'-auto'
                    (folder/(name+'.json.gz')).write_bytes(gzip.compress(raw));calls.append({'name':name,'response_sha256':hashlib.sha256(raw).hexdigest()})
                (folder/'http-calls.json').write_text(json.dumps(calls))
            cmd=[sys.executable,str(Path(__file__).with_name('compare_states.py')),'--candidate',str(root/'candidate'),'--reference',str(root/'reference'),'--out',str(root/'comparison')]
            run=subprocess.run(cmd,capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            result=json.loads((root/'comparison/comparison.json').read_text())
            self.assertEqual(result['macro_rmse_gain_percent'],50)
            self.assertTrue(result['acceptance_passed'])
            file=root/'reference/meter-1-auto.json.gz'
            altered=json.loads(gzip.decompress(file.read_bytes()));altered['results'][0]['forecast_values'][0]['actual_value']=2
            raw=json.dumps(altered).encode();file.write_bytes(gzip.compress(raw))
            calls=json.loads((root/'reference/http-calls.json').read_text());calls[0]['response_sha256']=hashlib.sha256(raw).hexdigest()
            (root/'reference/http-calls.json').write_text(json.dumps(calls));cmd[-1]=str(root/'bad-comparison')
            run=subprocess.run(cmd,capture_output=True,text=True)
            self.assertNotEqual(run.returncode,0)
            self.assertIn('Unpaired actuals',run.stderr)
