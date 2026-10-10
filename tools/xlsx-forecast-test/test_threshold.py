import copy
import io
import unittest
import test_xlsx_forecast_test as fixtures
import xlsx_forecast_test as tool


class ThresholdTests(unittest.TestCase):
    def fixture(self):
        result, dataset, day = fixtures.QualityTests().fixture(actual=0.01, prediction=0)
        result['forecast_run']['prediction_threshold_w'] = 50
        for row in result['forecast_values']:
            row.update(raw_predicted_value=0.01, prediction_zeroed=True)
        count = len(result['forecast_values'])
        result['filter_evaluation'] = {'threshold_w': 50, 'threshold_value': 0.0125,
                                      'unit': 'kWh', 'changed_intervals': count, 'actuals_modified': False,
                                      'raw_backtest': {'mse': 0, 'rmse': 0, 'mae': 0, 'bias': 0, 'cumulative_error': 0}}
        config = {**tool.DEFAULT_CONFIG, 'prediction_threshold_w': 50}
        return result, dataset, day, config

    def test_independent_raw_and_filtered_scoring_keeps_actuals_and_exposes_regression(self):
        result, dataset, day, config = self.fixture()
        before = copy.deepcopy(dataset)
        metrics, _ = tool.score_response({'results': [result]}, dataset, config, day, day)
        self.assertEqual(dataset, before)
        self.assertAlmostEqual(metrics['rmse'], 0.01)
        self.assertAlmostEqual(metrics['wape_percent'], 100)
        comparison = metrics['filter_comparison']
        self.assertEqual(comparison['raw_metrics']['rmse'], 0)
        self.assertEqual(comparison['raw_metrics']['wape_percent'], 0)
        self.assertEqual(comparison['changed_intervals'], 92)  # DST spring day

    def test_reject_ignored_filter_wrong_mapping_tampered_actuals_and_raw_scores(self):
        for mutation in ['ignored', 'mapping', 'actual', 'raw_metrics', 'count']:
            result, dataset, day, config = self.fixture()
            if mutation == 'ignored': del result['forecast_run']['prediction_threshold_w']
            if mutation == 'mapping': result['forecast_values'][0]['raw_predicted_value'] = 0.0125
            if mutation == 'actual': result['forecast_values'][0]['actual_value'] = 0
            if mutation == 'raw_metrics': result['filter_evaluation']['raw_backtest']['rmse'] = 1
            if mutation == 'count': result['filter_evaluation']['changed_intervals'] = 0
            with self.assertRaises(ValueError, msg=mutation):
                tool.score_response({'results': [result]}, dataset, config, day, day)

    def test_markdown_contains_both_sets_of_metrics(self):
        result, dataset, day, config = self.fixture()
        metrics, _ = tool.score_response({'results': [result]}, dataset, config, day, day)
        comparison = metrics.pop('filter_comparison')
        report = {'invoked_at': 'now', 'status': 'completed', 'script_sha256': 'abc', 'from': str(day), 'until': str(day),
                  'unit': 'kWh', 'time_basis': 'berlin', 'execution': 'live_http', 'base_url': 'http://localhost:3900',
                  'configuration': config, 'files': [{'file': 'small.xlsx', 'status': 'completed', 'metrics': metrics, 'filter_comparison': comparison}]}
        rendered = tool.markdown(report)
        self.assertIn('RMSE roh | RMSE gefiltert', rendered)
        self.assertIn('small.xlsx | 50 | 92 | 0.000000 | 0.010000', rendered)
