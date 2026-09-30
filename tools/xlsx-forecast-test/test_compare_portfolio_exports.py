import copy
import unittest
from compare_portfolio_exports import compare

class CompareTests(unittest.TestCase):
    def test_alignment_actuals_contract_and_paired_direction(self):
        left={('a',f'2024-01-{i:02d}T00:00:00+00:00'):dict(actual_value=2,predicted_value=0,
            forecast_for=f'2024-01-{i:02d}',forecast_created_at=f'2023-12-31T07:00:00Z',
            unit='kWh',latest_measurement_lag='3',training_mode='frozen') for i in range(1,29)}
        right=copy.deepcopy(left)
        for row in right.values():row['predicted_value']=1
        result=compare(left,right)['series']['a']
        self.assertEqual(result['left_minus_right_MAE_interval'],[1,1])
        self.assertEqual(result['left_WAPE'],100)
        bad=copy.deepcopy(right);bad.pop(next(iter(bad)))
        with self.assertRaisesRegex(ValueError,'intervals differ'):compare(left,bad)
        bad=copy.deepcopy(right);next(iter(bad.values()))['actual_value']=1
        with self.assertRaisesRegex(ValueError,'Actual values'):compare(left,bad)
        bad=copy.deepcopy(right);next(iter(bad.values()))['latest_measurement_lag']='2'
        with self.assertRaisesRegex(ValueError,'contract'):compare(left,bad)
