import copy
import datetime as dt
import gzip
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import xlsx_forecast_test as tool


class QualityTests(unittest.TestCase):
    def fixture(self, day=dt.date(2024, 3, 31), actual=2, prediction=1):
        zone = tool.ZoneInfo('Europe/Berlin')
        cursor = dt.datetime.combine(day, dt.time(), zone).astimezone(tool.UTC)
        stop = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), zone).astimezone(tool.UTC)
        issued = dt.datetime.combine(day - dt.timedelta(days=1), dt.time(), zone)
        trained = issued - tool.STEP
        values, forecasts = [], []
        while cursor < stop:
            stamp = tool.iso(cursor)
            values.append({'timestamp': stamp, 'value': actual})
            forecasts.append({'timestamp': stamp, 'actual_value': actual, 'predicted_value': prediction,
                              'training_data_until': tool.iso(trained), 'forecast_created_at': tool.iso(issued),
                              'forecast_for': day.isoformat(), 'unit': 'kWh', 'series_id': 'meter-1'})
            cursor += tool.STEP
        error = actual - prediction
        result = {'forecast_run': {'series_id': 'meter-1', 'timezone': zone.key,
                                   'mode': 'rolling_day_ahead', 'relationship_mode': 'auto',
                                   'forecast_period_from': day.isoformat(), 'forecast_period_until': day.isoformat(),
                                   'model_family': 'learned_states', 'issue_time': '00:00'},
                  'forecast_values': forecasts,
                  'backtest': {'mse': error**2, 'rmse': abs(error), 'mae': abs(error),
                               'bias': error, 'cumulative_error': error*len(values)}}
        dataset = {'values': values, 'series_id': 'meter-1', 'unit': 'kWh', 'timezone': zone.key}
        return result, dataset, day

    def test_metrics_and_dst_days(self):
        for day, expected in [(dt.date(2024, 3, 31), 92), (dt.date(2024, 10, 27), 100)]:
            result, dataset, day = self.fixture(day)
            scores, _ = tool.score_response({'results': [result]}, dataset, tool.DEFAULT_CONFIG, day, day)
            self.assertEqual(scores['sample_count'], expected)
            self.assertEqual([scores[k] for k in ('rmse', 'mae', 'wape_percent')], [1, 1, 50])

    def test_zero_denominator_is_undefined(self):
        result, dataset, day = self.fixture(actual=0, prediction=0)
        scores, _ = tool.score_response({'results': [result]}, dataset, tool.DEFAULT_CONFIG, day, day)
        self.assertIsNone(scores['wape_percent'])

    def test_reject_future_training_wrong_actual_and_duplicate(self):
        for mutation in ('future', 'actual', 'duplicate', 'metric'):
            result, dataset, day = self.fixture()
            row = result['forecast_values'][0]
            if mutation == 'future':
                row['training_data_until'] = row['forecast_created_at']
            elif mutation == 'actual':
                row['actual_value'] = 999
            elif mutation == 'duplicate':
                result['forecast_values'].append(copy.deepcopy(row))
            else:
                result['backtest']['rmse'] = 0
            with self.assertRaises(ValueError):
                tool.score_response({'results': [result]}, dataset, tool.DEFAULT_CONFIG, day, day)

    def test_reject_missing_actuals(self):
        result, dataset, day = self.fixture()
        dataset['values'].pop()
        result['forecast_values'][-1]['actual_value'] = None
        result['backtest']['cumulative_error'] -= 1
        with self.assertRaisesRegex(ValueError, 'Missing actual'):
            tool.score_response({'results': [result]}, dataset, tool.DEFAULT_CONFIG, day, day)

    def test_globs_deduplicate_and_fail_unmatched(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'arbitrary.xlsx'
            source.touch()
            self.assertEqual(tool.expand_files([str(source), directory+'/*.xlsx']), [source])
            with self.assertRaises(ValueError):
                tool.expand_files([directory+'/missing*.xlsx'])

    def test_replay_checks_request_and_response_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            archive, output = base/'archive', base/'output'
            archive.mkdir(); output.mkdir()
            raw = b'{"ok":true}'
            with gzip.open(archive/'one.response.json.gz', 'wb') as f:
                f.write(raw)
            tool.save(archive/'http-calls.json', [{'name': 'one', 'path': '/test', 'status': 200,
                      'request_sha256': tool.sha(tool.encoded({'a': 1})), 'response_sha256': tool.sha(raw)}])
            client = tool.ApiArchive('http://localhost:3900', output, 30, archive)
            self.assertEqual(client.call('one', '/test', {'a': 1}), {'ok': True})
            with self.assertRaisesRegex(ValueError, 'request differs'):
                client.call('one', '/test', {'a': 2})
            with gzip.open(archive/'one.response.json.gz', 'wb') as f:
                f.write(b'{}')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                client.call('one', '/test', {'a': 1})

    def test_markdown_escapes_filenames_and_lists_failed_rows(self):
        report = {'invoked_at': '2026-09-25T00:00:00Z', 'status': 'incomplete', 'script_sha256': 'abc',
                  'from': '2024-01-01', 'until': '2024-12-31', 'unit': 'kWh', 'time_basis': 'berlin',
                  'execution': 'live_http', 'base_url': 'http://localhost:3900',
                  'files': [{'file': 'bad|name.xlsx', 'status': 'failed', 'error': 'missing'}]}
        rendered = tool.markdown(report)
        self.assertIn('bad&#124;name.xlsx | — | — | — | failed', rendered)
        self.assertIn('Script SHA-256: `abc`', rendered)


if __name__ == '__main__':
    unittest.main()
