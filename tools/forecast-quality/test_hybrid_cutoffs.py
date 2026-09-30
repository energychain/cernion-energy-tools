import copy
import unittest
from compare_states import verify_hybrid_cutoffs


class HybridCutoffContract(unittest.TestCase):
    def fixture(self):
        return {
            'forecast_values': [{
                'forecast_for': '2024-01-03',
                'forecast_created_at': '2024-01-02T00:00:00+01:00',
                'training_data_until': '2024-01-01T23:45:00+01:00',
                'state_features': {
                    'model_fitted_at': '2024-01-01T00:00:00+01:00',
                    'known_lag_states': [{'lag_days': 2, 'date': '2024-01-01',
                                          'available_at': '2024-01-02T00:00:00+01:00'}],
                },
            }],
            'relationship_analysis': {'selections': [{'validation': {'folds': [{
                'from': '2023-12-10',
                'state_training_until': '2023-12-08T23:45:00+01:00',
                'reference_fits': [{'forecast_for': '2023-12-10',
                                    'training_data_until': '2023-12-08T23:45:00+01:00'}],
            }]}}]},
        }

    def test_valid_cutoffs(self):
        self.assertEqual(verify_hybrid_cutoffs(self.fixture(), 'Europe/Berlin'),
                         {'outer_forecasts_checked': 1, 'inner_reference_fits_checked': 1})

    def test_late_context_and_inner_leakage_rejected(self):
        original = self.fixture()
        altered = copy.deepcopy(original)
        altered['forecast_values'][0]['state_features']['known_lag_states'][0]['available_at'] = '2024-01-02T00:15:00+01:00'
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            verify_hybrid_cutoffs(altered, 'Europe/Berlin')
        for component in ('state_training_until', 'reference_fits'):
            altered = copy.deepcopy(original)
            fold = altered['relationship_analysis']['selections'][0]['validation']['folds'][0]
            if component == 'state_training_until':
                fold[component] = '2023-12-09T00:00:00+01:00'
            else:
                fold[component][0]['training_data_until'] = '2023-12-09T00:00:00+01:00'
            with self.assertRaisesRegex(ValueError, 'leaks'):
                verify_hybrid_cutoffs(altered, 'Europe/Berlin')

    def test_evening_origin_does_not_relax_meter_cutoff(self):
        result = self.fixture()
        result['forecast_run'] = {'issue_time': '18:00'}
        result['forecast_values'][0]['forecast_created_at'] = '2024-01-02T18:00:00+01:00'
        verify_hybrid_cutoffs(result, 'Europe/Berlin')
        result['forecast_values'][0]['training_data_until'] = '2024-01-02T12:00:00+01:00'
        with self.assertRaisesRegex(ValueError, 'beyond D-2'):
            verify_hybrid_cutoffs(result, 'Europe/Berlin')
