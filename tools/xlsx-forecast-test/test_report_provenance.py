import json
from pathlib import Path
import tempfile
import unittest

import xlsx_forecast_test as tool


class ReportProvenanceTests(unittest.TestCase):
    def test_exact_archived_inputs_and_hashes(self):
        source = b'#!/usr/bin/python3\n# captured version\n'
        original = b'{ "feature_set" : ["history"] }\n'
        config = {**tool.DEFAULT_CONFIG, **json.loads(original)}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            artifacts = tool.archive_run_inputs(out, source, config, original)
            self.assertEqual((out / 'xlsx_forecast_test.py').read_bytes(), source)
            self.assertEqual((out / 'configuration.input.json').read_bytes(), original)
            self.assertEqual(json.loads((out / 'configuration.json').read_bytes()), config)
            for name, details in artifacts.items():
                self.assertEqual(details['sha256'], tool.sha((out / name).read_bytes()))
            # End-of-run restoration must preserve captured inputs, not changed files.
            (out / 'xlsx_forecast_test.py').write_bytes(b'changed during run')
            self.assertEqual(tool.archive_run_inputs(out, source, config, original), artifacts)
            self.assertEqual((out / 'xlsx_forecast_test.py').read_bytes(), source)

    def test_requested_and_actual_features_are_distinct(self):
        usage = tool.feature_usage({'forecast_values': [
            {'feature_set': ['history', 'calendar'], 'selected_predictors': ['weekday']},
            {'feature_set': ['history', 'weather'], 'selected_predictors': ['temperature']},
            {}]})
        self.assertEqual(usage['feature_interval_counts'], {'calendar': 1, 'history': 2, 'weather': 1})
        self.assertEqual(usage['unknown_intervals'], 1)
        report = {'invoked_at': '2026-09-25T00:00:00Z', 'status': 'completed', 'script_sha256': 'abc',
                  'from': '2024-01-01', 'until': '2024-01-01', 'unit': 'kWh', 'time_basis': 'berlin',
                  'execution': 'live_http', 'base_url': 'http://localhost:3900',
                  'configuration': {**tool.DEFAULT_CONFIG, 'feature_set': ['history', 'calendar', 'weather', 'context']},
                  'weather_region': 'Kempten',
                  'artifacts': {'configuration.json': {'sha256': 'filehash'}},
                  'files': [{'file': 'one.xlsx', 'status': 'completed', 'feature_usage': usage}]}
        rendered = tool.markdown(report)
        self.assertIn('history, calendar, weather, context', rendered)
        self.assertIn('weather 33.3%', rendered)
        self.assertNotIn('context 100.0%', rendered)
        self.assertIn('unbekannt: 1 Intervalle', rendered)
        self.assertIn('"issue_time": "00:00"', rendered)
        self.assertIn('`filehash`', rendered)
        self.assertIn('Kempten', rendered)


if __name__ == '__main__':
    unittest.main()
