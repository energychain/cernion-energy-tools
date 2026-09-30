import unittest
import xlsx_forecast_test as tool
import test_xlsx_forecast_test as fixtures

class AdaptiveContractTests(unittest.TestCase):
    def test_legacy_api_cannot_silently_ignore_new_policy(self):
        result, dataset, day = fixtures.QualityTests().fixture()
        result['forecast_run']['model_version'] = 'relationship_state_context_guard_v4'
        config = {**tool.DEFAULT_CONFIG, 'selection_policy': 'adaptive_rmse_v1'}
        with self.assertRaisesRegex(ValueError, 'compatible v5'):
            tool.score_response({'results': [result]}, dataset, config, day, day)
        result['forecast_run']['model_version'] = 'relationship_state_adaptive_v5'
        with self.assertRaisesRegex(ValueError, 'incumbent-guard evidence'):
            tool.score_response({'results': [result]}, dataset, config, day, day)
        result['relationship_analysis'] = {'selections': [{'reference_selection': {'adaptive_guard': {'supported': False}}}]}
        scores, _ = tool.score_response({'results': [result]}, dataset, config, day, day)
        self.assertEqual(scores['rmse'], 1)

if __name__ == '__main__': unittest.main()
