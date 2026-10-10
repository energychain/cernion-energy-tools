import io
import threading
import unittest

import xlsx_forecast_test as tool


class ProgressTests(unittest.TestCase):
    def test_heartbeat_while_call_is_blocked_and_cleanup(self):
        seen = threading.Event()
        class Stream(io.StringIO):
            def write(self, text):
                result = super().write(text)
                if 'Serverfortschritt unbekannt' in text:
                    seen.set()
                return result
        output = Stream()
        progress = tool.CliProgress(11, 0.01, output)
        progress.index, progress.file = 1, 'one.xlsx'
        def call():
            self.assertTrue(seen.wait(2), 'No heartbeat during blocked API call')
            return 42
        self.assertEqual(progress.run('Forecast', call, api_wait=True), 42)
        self.assertIn('[1/11] one.xlsx', output.getvalue())
        self.assertIn('Forecast: fertig', output.getvalue())
        self.assertFalse(any(t.name == 'xlsx-cli-progress' for t in threading.enumerate()))

    def test_errors_and_interrupts_stop_thread_and_propagate(self):
        for error in [ValueError('failure'), KeyboardInterrupt()]:
            output = io.StringIO()
            progress = tool.CliProgress(1, 0.01, output)
            def fail():
                raise error
            with self.assertRaises(type(error)):
                progress.run('Stage', fail)
            self.assertIn('abgebrochen/fehlgeschlagen', output.getvalue())
            self.assertFalse(any(t.name == 'xlsx-cli-progress' for t in threading.enumerate()))

    def test_disabled_heartbeat_still_shows_stages_on_stderr_stream(self):
        output = io.StringIO()
        progress = tool.CliProgress(2, 0, output)
        self.assertEqual(progress.run('Read', lambda: 'ok'), 'ok')
        self.assertEqual(len(output.getvalue().splitlines()), 2)
        self.assertEqual(tool.CliProgress.duration(2401), '00:40:01')
