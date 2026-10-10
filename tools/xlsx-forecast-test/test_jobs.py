import io
import unittest
from unittest.mock import patch
import xlsx_forecast_test as tool

JOB = '12345678-1234-4234-8234-123456789abc'
DESC = {'jobId': JOB, 'status': 'queued', 'statusUrl': f'/api/jobs/{JOB}/status',
        'resultUrl': f'/api/jobs/{JOB}/result', 'progressUrl': f'/api/jobs/{JOB}/progress'}


class FakeApi:
    def __init__(self, states, replay=True):
        self.states = iter(states)
        self.replay = replay
        self.calls = []
        self.cancelled = False

    def call(self, name, endpoint, payload=None, accepted_statuses=(200,)):
        if endpoint.endswith('/run'):
            assert 202 in accepted_statuses
            self.calls.append({'status': 202})
            return dict(DESC)
        if endpoint.endswith('/cancel'):
            self.cancelled = True
            return {'status': 'error'}
        if endpoint.endswith('/result'):
            return {'results': ['verified-result']}
        state = next(self.states)
        if isinstance(state, BaseException):
            raise state
        return {'jobId': JOB, 'status': state, 'error': 'worker failed' if state == 'error' else None,
                'progress': {'step': 2, 'totalSteps': 731, 'message': 'Model selection', 'at': '2026-09-25T12:00:00Z'}}


class JobTests(unittest.TestCase):
    def test_poll_real_progress_and_result_and_archive_replay_does_not_sleep(self):
        api = FakeApi(['queued', 'running', 'completed'])
        output = io.StringIO()
        saved = []
        with patch.object(tool.time, 'sleep', side_effect=AssertionError('Replay must not wait')):
            result = tool.run_forecast_job(api, 'test', {}, tool.CliProgress(1, 0, output), saved.append)
        self.assertEqual(result, {'results': ['verified-result']})
        self.assertEqual(saved[0]['jobId'], JOB)
        self.assertIn('2/731 Prognosetage abgeschlossen', output.getvalue())
        self.assertFalse(api.cancelled)

    def test_terminal_failure_is_not_success(self):
        for state in ['error', 'recovery_pending', 'unrecognized']:
            with self.assertRaises(ValueError):
                tool.run_forecast_job(FakeApi([state]), 'test', {}, tool.CliProgress(1, 0, io.StringIO()), lambda _: None)

    def test_interrupt_requests_server_cancellation(self):
        api = FakeApi([KeyboardInterrupt()], replay=False)
        with self.assertRaises(KeyboardInterrupt):
            tool.run_forecast_job(api, 'test', {}, tool.CliProgress(1, 0, io.StringIO()), lambda _: None)
        self.assertTrue(api.cancelled)

    def test_refuse_external_job_urls(self):
        api = FakeApi([])
        original = api.call
        def malicious(*args, **kwargs):
            return {**original(*args, **kwargs), 'statusUrl': 'https://external.example/steal'}
        api.call = malicious
        with self.assertRaisesRegex(ValueError, 'Unexpected job URL'):
            tool.run_forecast_job(api, 'test', {}, tool.CliProgress(1, 0, io.StringIO()), lambda _: None)
