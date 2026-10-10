import copy
import datetime as dt
import unittest
from unittest.mock import patch
import portfolio_forecast_test as client


class PortfolioClientTests(unittest.TestCase):
    def fixture(self):
        rows = []
        for identity in ['a', 'b']:
            selection = dict(as_of='2024-01-04T06:00:00Z', forecast_from='2024-01-05',
                             discovery_from='2023-11-09', confirmation_from='2023-12-07')
            for key, day in [('training', '2024-01-02'), ('discovery_training', '2023-11-06'), ('confirmation_training', '2023-12-04')]:
                selection[key] = {name:dict(training_until=day+'T22:45:00Z', maximum_label_available_at=day+'T23:00:00Z') for name in ['a','b']}
            rows.append(dict(forecast_run=dict(series_id=identity, model_version=client.VERSION,
                                               portfolio_series_ids=['a','b'], benchmark_contract=client.METHOD_DEFAULTS), forecast_values=[],
                             relationship_analysis=dict(selections=[selection])))
        datasets = [dict(series_id=k, timezone='Europe/Berlin') for k in ['a', 'b']]
        return dict(results=rows), datasets

    def verify(self, response, datasets):
        with patch.object(client.legacy, 'score_response', return_value=({}, {})):
            return client.verify_portfolio(response, datasets, {}, dt.date(2024,1,5), dt.date(2024,1,5))

    def test_checks_all_folds_and_every_series(self):
        response, datasets = self.fixture()
        self.assertEqual(len(self.verify(response,datasets)), 2)
        for fold in ['training','discovery_training','confirmation_training']:
            modified = copy.deepcopy(response)
            modified['results'][0]['relationship_analysis']['selections'][0][fold]['b']['maximum_label_available_at']='2024-01-05T00:00:00Z'
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                self.verify(modified, datasets)

    def test_rejects_wrong_version_missing_member_and_wrong_origin(self):
        response, datasets = self.fixture()
        response['results'][0]['forecast_run']['model_version']='old'
        with self.assertRaisesRegex(ValueError, 'version'):
            self.verify(response,datasets)
        response, datasets = self.fixture()
        response['results'].pop()
        with self.assertRaisesRegex(ValueError, 'IDs/count'):
            self.verify(response,datasets)
        response, datasets = self.fixture()
        response['results'][0]['relationship_analysis']['selections'][0]['as_of']='2024-01-04T07:00:00Z'
        with self.assertRaisesRegex(ValueError, 'origin'):
            self.verify(response,datasets)


if __name__ == '__main__':
    unittest.main()

class DurableClientTests(unittest.TestCase):
    def test_get_disconnect_retries_but_post_does_not(self):
        import tempfile
        import urllib.error
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            api=client.ResilientArchive('http://localhost:3900',Path(folder),1,None)
            with patch.object(client.legacy.ApiArchive,'call',side_effect=[urllib.error.URLError('offline'),{'status':'ok'}]) as call, patch.object(client.time,'sleep'):
                self.assertEqual(api.call('status','/status'),{'status':'ok'})
                self.assertEqual(call.call_count,2)
            with patch.object(client.legacy.ApiArchive,'call',side_effect=urllib.error.URLError('offline')) as call:
                with self.assertRaises(urllib.error.URLError):api.call('run','/run',{})
                self.assertEqual(call.call_count,1)

    def test_existing_run_recovery_uses_resume_and_never_new_training_post(self):
        from unittest.mock import Mock
        api=Mock();api.replay=True
        api.call.side_effect=[{'status':'resumable'}, {'run_id':'r','jobId':'j'},
                              {'status':'resumable','completed_blocks':1}, {'jobId':'j','status':'recovery_pending'},
                              {'run_id':'r','jobId':'k'}, {'status':'completed','result':{'status':'completed','result_manifest':[]}}]
        result=client.run_durable(api,{}, {'run_id':'r','jobId':'old'},Mock(),Mock(),1,10)
        self.assertEqual(result['status'],'completed')
        self.assertTrue(all(c.args[1]!=client.ROOT+'/run' for c in api.call.call_args_list))
        self.assertEqual(sum(c.args[1].endswith('/resume') for c in api.call.call_args_list),2)

    def test_old_run_without_checkpoints_cannot_claim_resume(self):
        from unittest.mock import Mock
        with self.assertRaisesRegex(ValueError,'no durable'):
            client.run_durable(Mock(),{}, {'jobId':'old'},Mock(),Mock(),1,10)

class ComparisonExportTests(unittest.TestCase):
    def test_strict_contract_rejects_d2_feature_provenance(self):
        fixture=PortfolioClientTests()
        response,datasets=fixture.fixture()
        response['results'][0]['forecast_values']=[dict(forecast_for='2024-01-05',training_data_until='2024-01-03T00:00:00Z')]
        with self.assertRaisesRegex(ValueError,'cutoff'):fixture.verify(response,datasets)

    def test_export_recomputes_sums_and_retains_dst_distinct_instants(self):
        import csv,gzip,tempfile
        from pathlib import Path
        rows=[dict(series_id='a',timestamp=t,actual_value=a,predicted_value=p,candidate_predictions=dict(previous_week=0))
              for t,a,p in [('2024-10-27T00:00:00Z',0,1),('2024-10-27T01:00:00Z',2,1)]]
        with tempfile.TemporaryDirectory() as folder:
            client.export_comparison(Path(folder),1,dict(dataset_id='d'),dict(forecast_values=rows,forecast_run={}))
            with gzip.open(Path(folder)/'001-predictions.csv.gz','rt') as h:values=list(csv.DictReader(h))
            self.assertEqual(len({r['timestamp'] for r in values}),2)
            with (Path(folder)/'001-metrics.csv').open() as h:metrics=list(csv.DictReader(h))
            self.assertEqual(float(metrics[0]['absolute_error_sum']),2)
            self.assertEqual(float(metrics[0]['WAPE']),100)
