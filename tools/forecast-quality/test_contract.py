import copy
import datetime as dt
import gzip
import json
from pathlib import Path
import tempfile
import unittest

import jsonschema
import profile_io as p
import run as client
from scoring import verify_and_score


class ContractTests(unittest.TestCase):
    def test_dst_spring_and_autumn_preserve_physical_quarters(self):
        zone = p.ZoneInfo('Europe/Berlin')
        for start, count in [(dt.datetime(2024, 3, 31, 0, 45, tzinfo=p.UTC), 2),
                             (dt.datetime(2024, 10, 27, 0, tzinfo=p.UTC), 8)]:
            instants = [start + i * p.STEP for i in range(count)]
            records = [(t.astimezone(zone).replace(tzinfo=None),
                        (t + p.STEP).astimezone(zone).replace(tzinfo=None), 0, i + 2)
                       for i, t in enumerate(instants)]
            result = p.dataset_from_records(records, {'meter': 'test'}, 'kWh', 'berlin')
            self.assertEqual([v['timestamp'] for v in result['values']], [p.iso(t) for t in instants])

    def test_unresolvable_times_are_not_guessed(self):
        for start in (dt.datetime(2024, 3, 31, 2), dt.datetime(2024, 10, 27, 2)):
            with self.assertRaises(ValueError):
                p.dataset_from_records([(start, start + p.STEP, 1, 2)], {'meter': 'test'}, 'kWh', 'berlin')

    def test_zero_is_valid_but_blank_value_is_not(self):
        from openpyxl import Workbook
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'x.xlsx'
            book = Workbook(); sheet = book.active
            sheet.append(['Meldepunkt', 'OBIS', 'Datum von', 'Datum bis', 'Wert'])
            sheet.append([1, 'obis', dt.datetime(2024, 1, 1), dt.datetime(2024, 1, 1, 0, 15), 0])
            book.save(file)
            self.assertEqual(p.read_workbook(file)[0][0][2], 0)
            sheet['E2'] = None; book.save(file)
            with self.assertRaises(ValueError):
                p.read_workbook(file)

    def test_pooled_rmse_uses_sums_not_average_profile_rmse(self):
        scores = [{'sample_count': n, 'expected_intervals': n, 'squared_error_sum': square,
                   'absolute_error_sum': 0, 'actual_absolute_sum': 1}
                  for n, square in [(1, 1), (3, 27)]]
        self.assertAlmostEqual(client.summarize(scores)['rmse'], 7 ** 0.5)

    def test_all_zero_series_has_defined_zero_wape(self):
        result = client.summarize([{'sample_count': 96, 'expected_intervals': 96,
                                   'squared_error_sum': 0, 'absolute_error_sum': 0, 'actual_absolute_sum': 0}])
        self.assertEqual(result['wape_percent'], 0)

    def test_metric_reconstruction_rejects_leakage(self):
        dataset = {'timezone': 'UTC', 'values': [{'timestamp': '2024-01-01T00:00:00Z', 'value': 1}]}
        result = {'forecast_values': [{'timestamp': '2024-01-01T00:00:00.000Z',
                                      'training_data_until': '2024-01-01T00:00:00Z',
                                      'forecast_created_at': '2023-12-31T00:00:00Z'}]}
        with self.assertRaisesRegex(ValueError, 'D-2'):
            verify_and_score(result, dataset, dt.date(2024, 1, 1), dt.date(2024, 1, 1))

    def test_archive_tampering_fails_before_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); archive = root / 'archive'; archive.mkdir(); out = root / 'out'; out.mkdir()
            original = b'{"status":"completed"}'
            (archive / 'http-calls.json').write_text(json.dumps([{'name': 'x', 'path': '/test',
                                                               'status': 200, 'response_sha256': client.digest(original)}]))
            with gzip.open(archive / 'x.json.gz', 'wb') as f:
                f.write(b'{"status":"changed"}')
            transport = client.Transport(None, out, 1, archive)
            with self.assertRaisesRegex(ValueError, 'hash/path'):
                transport.call('x', '/test')

    def test_remote_hosts_require_https_and_credentials_are_not_url_arguments(self):
        for url in ('http://example.com', 'https://user:secret@example.com', 'https://example.com/?token=secret'):
            with self.assertRaises(ValueError):
                client.Transport(url, Path('/tmp'), 1)

    def test_schema_rejects_completed_row_without_metrics(self):
        schema = json.loads((client.HERE / 'report.schema.json').read_text())['properties']['series']['items']
        with self.assertRaises(jsonschema.ValidationError):
            jsonschema.validate({'series_id': 'x', 'file': 'x.xlsx', 'status': 'completed'}, schema)


if __name__ == '__main__':
    unittest.main()
