import datetime as dt
import unittest

import xlsx_forecast_test as tool


class ReadinessTests(unittest.TestCase):
    def assess(self, mae=.066, rmse=.093, wape=123, mean=None, days=28, unit='kWh'):
        mean = mae / (wape / 100) if mean is None else mean
        metrics = {'sample_count': 2, 'actual_absolute_sum': mean * 2,
                   'mae': mae, 'rmse': rmse, 'wape_percent': wape}
        result = {'forecast_values': [{'actual_value': 0}, {'actual_value': mean*2}]}
        start = dt.date(2024, 1, 1)
        return tool.interpret_readiness(metrics, result, unit, start, start+dt.timedelta(days=days-1))

    def test_low_load_explains_error_without_promoting_signal(self):
        result = self.assess()
        self.assertEqual(result['forecast_signal'], 'weak')
        self.assertIn('Kleine absolute Fehler bei geringer Lastbasis', result['interpretation'])
        self.assertIn('dennoch hoch', result['interpretation'])
        self.assertAlmostEqual(result['readiness_evidence']['mean_absolute_actual'], .05365853658536586)
        self.assertEqual(result['readiness_evidence']['zero_interval_fraction'], .5)
        self.assertIn('Null-/Aktivintervalle', result['recommended_next_step'])

    def test_signal_boundaries_and_short_period_cap(self):
        for wape, expected in [(10, 'strong'), (10.01, 'medium'), (30, 'medium'), (30.01, 'weak')]:
            self.assertEqual(self.assess(wape=wape)['forecast_signal'], expected)
        short = self.assess(wape=5, days=2)
        self.assertEqual(short['forecast_signal'], 'medium')
        self.assertIn('Kurzer Prüfzeitraum', short['interpretation'])

    def test_zero_load_not_strong_even_with_zero_error(self):
        result = self.assess(mae=0, rmse=0, mean=0, wape=None)
        self.assertEqual(result['forecast_signal'], 'weak')
        self.assertIn('nicht beurteilbar', result['interpretation'])

    def test_energy_and_power_equivalence(self):
        energy = self.assess()
        power = self.assess(mae=.066*4, rmse=.093*4, unit='kW')
        for key in ['low_load', 'small_absolute_errors']:
            self.assertEqual(energy['readiness_evidence'][key], power['readiness_evidence'][key])
        self.assertEqual(energy['forecast_signal'], power['forecast_signal'])

    def test_high_load_not_described_as_small(self):
        result = self.assess(mae=66, rmse=93, wape=123)
        self.assertFalse(result['readiness_evidence']['low_load'])
        self.assertNotIn('Kleine absolute Fehler', result['interpretation'])


if __name__ == '__main__':
    unittest.main()
