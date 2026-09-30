import copy
import datetime as dt
import math
import unittest
from unittest.mock import patch
import engine as e


def data(identity='a', zone='Europe/Berlin'):
    tz = e.ZoneInfo(zone)
    rows = []
    start = dt.date(2023, 6, 1)
    for offset in range(221):
        day = start + dt.timedelta(days=offset)
        for stamp in e.slots(day, tz):
            local = stamp.astimezone(tz)
            value = (2 + local.hour / 24) if 8 <= local.hour < 18 and local.weekday() < 5 else 0
            available = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), tz)
            rows.append([stamp.timestamp()*1000, value, available.timestamp()*1000])
    return dict(series_id=identity, unit='kWh', timezone=zone, validation={}, rows=rows)


class MethodTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = data()
        cls.series = e.Series(cls.raw)
        cls.day = dt.date(2024, 1, 5)

    def test_dst_and_origin(self):
        tz = e.ZoneInfo('Europe/Berlin')
        self.assertEqual(len(list(e.slots(dt.date(2024, 3, 31), tz))), 92)
        self.assertEqual(len(list(e.slots(dt.date(2024, 10, 27), tz))), 100)
        self.assertEqual(e.iso(e.origin(self.day, tz)), '2024-01-04T06:00:00.000Z')

    def test_unavailable_and_previous_day_never_enter_features(self):
        s = self.series
        stamp = list(e.slots(self.day, s.zone))[40]
        context = s.day_context(self.day)
        expected = s.features(stamp, 1, 0, context)[0]
        changed = copy.deepcopy(self.raw)
        cutoff = dt.datetime.combine(self.day-dt.timedelta(days=1), dt.time(), s.zone).timestamp()*1000
        for row in changed['rows']:
            if row[0] >= cutoff:
                row[1] = 9999999
        other = e.Series(changed)
        self.assertEqual(expected, other.features(stamp, 1, 0, other.day_context(self.day))[0])
        delayed = copy.deepcopy(self.raw)
        for row in delayed['rows']:
            if cutoff-86400000 <= row[0] < cutoff:
                row[2] = cutoff+86400000
        other = e.Series(delayed)
        ctx = other.day_context(self.day)
        features, _ = other.features(stamp, 1, 0, ctx)
        self.assertTrue(math.isnan(features[9]))
        self.assertEqual(features[14], 1)
        self.assertEqual(ctx['d2_coverage'], 0)
        self.assertEqual(ctx['full'][0], self.day-dt.timedelta(days=3))

    def test_zero_remains_observed_and_outage_has_causal_fallback(self):
        s = self.series
        stamp = list(e.slots(self.day, s.zone))[0]
        x, _ = s.features(stamp, 1, 0, s.day_context(self.day))
        self.assertEqual(x[9], 0)
        self.assertEqual(x[14], 0)
        for scenario in e.SCENARIOS:
            ctx = s.day_context(self.day, scenario)
            _, bases = s.features(stamp, 1, 0, ctx, scenario)
            self.assertTrue(all(math.isfinite(v) for v in bases))
            self.assertLess(ctx['latest'].astimezone(s.zone).date(), self.day-dt.timedelta(days=1))
        self.assertEqual(s.day_context(self.day, 'last_3_days')['full'][0], self.day-dt.timedelta(days=5))

    def test_labels_and_empty_activity_metrics(self):
        self.assertLess(e.label_transform([0]*80+[10]*20), 1.01)
        self.assertEqual(e.label_transform([0]*100), 0)
        self.assertIsNone(e.scores([0, 0], [1, 1])['wape_percent'])
        self.assertEqual(e.predict(0.0, [[1], [2]]).tolist(), [0, 0])

    def test_guard_rejects_rmse_gain_with_mae_regression(self):
        metrics = {k: dict(rmse=10, mae=5) for k in e.BASELINES+e.BOOSTS}
        weeks = {k: [10]*4 for k in metrics}
        discovery = dict(metrics=copy.deepcopy(metrics), weeks=copy.deepcopy(weeks))
        confirmation = copy.deepcopy(discovery)
        confirmation['metrics']['catboost_global'] = dict(rmse=8, mae=6)
        confirmation['weeks']['catboost_global'] = [8]*4
        self.assertEqual(e.choose(discovery, confirmation)[0], 'previous_week')
        confirmation['metrics']['catboost_global']['mae'] = 4
        self.assertEqual(e.choose(discovery, confirmation)[0], 'catboost_global')
        self.assertEqual(e.choose(None, confirmation)[0], 'weekday_median')

    def test_zero_portfolio_crosses_refit_boundary_and_keeps_undefined_wape(self):
        a, b = copy.deepcopy(self.raw), copy.deepcopy(self.raw)
        b['series_id'] = 'b'
        for item in [a, b]:
            for row in item['rows']:
                row[1] = 0
        result = e.evaluate(dict(series=[a, b], configuration=dict(
            forecast_period_from='2023-12-01', forecast_period_until='2023-12-30',
            portfolio_stress_test=True)))
        for item in result['results']:
            self.assertEqual(item['backtest']['sample_count'], 30*96)
            self.assertEqual(item['backtest']['rmse'], 0)
            self.assertIsNone(item['backtest']['wape_percent'])
            self.assertEqual(len(item['relationship_analysis']['selections']), 2)
            self.assertEqual(set(item['stress_metrics']), set(e.SCENARIOS))
            self.assertEqual(item['hurdle_diagnostics']['activity']['brier_score'], 0)
            for v in item['forecast_values']:
                self.assertEqual(v['predicted_value'], 0)
                self.assertLess(v['training_data_until'], v['forecast_created_at'])

    def test_joint_fit_never_uses_any_series_future_and_runs_real_catboost(self):
        a, b = copy.deepcopy(self.raw), copy.deepcopy(self.raw)
        b['series_id'] = 'b'
        cutoff = dt.datetime.combine(self.day-dt.timedelta(days=1), dt.time(), self.series.zone).timestamp()*1000
        with patch.dict(e.POLICY, iterations=3):
            first = e.Fit([e.Series(a), e.Series(b)], self.day)
            for row in b['rows']:
                if row[0] >= cutoff:
                    row[1] = 1e8
            second = e.Fit([e.Series(a), e.Series(b)], self.day)
            for name in e.BASELINES+e.BOOSTS:
                p = first.forecasts(e.Series(a), self.day, self.day+dt.timedelta(days=1))[1][name]
                q = second.forecasts(e.Series(a), self.day, self.day+dt.timedelta(days=1))[1][name]
                self.assertEqual(p.tolist(), q.tolist())
            self.assertEqual(first.metadata, second.metadata)


if __name__ == '__main__':
    unittest.main()
