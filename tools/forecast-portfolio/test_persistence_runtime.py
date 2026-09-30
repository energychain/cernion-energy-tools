import copy
import datetime as dt
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import engine as e
import persistence as p
import runtime as r
from test_engine import data


class PersistenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.a, cls.b = data('a'), data('b')
        for item in [cls.a,cls.b]:
            for row in item['rows']:
                row[1] = 0

    def payload(self, directory):
        return dict(series=[self.a,self.b],configuration=dict(forecast_period_from='2023-12-01',forecast_period_until='2023-12-30',portfolio_stress_test=True),_workspace=directory,_identity='test')

    def test_interruption_resume_skips_checkpoint_and_matches_uninterrupted(self):
        with tempfile.TemporaryDirectory() as interrupted, tempfile.TemporaryDirectory() as reference:
            payload=self.payload(interrupted)
            def stop(progress):
                if progress['phase']=='checkpoint_saved':
                    raise RuntimeError('simulated process death')
            with self.assertRaisesRegex(RuntimeError,'process death'):
                r.execute(payload,stop)
            self.assertTrue(p.load_block(interrupted,dt.date(2023,12,1)))
            events=[]
            resumed=r.execute(payload,events.append)
            self.assertEqual(sum(v['phase']=='checkpoint_reused' for v in events),1)
            expected=r.execute(self.payload(reference),lambda v:None)
            for a,b in zip(resumed['result_manifest'],expected['result_manifest']):
                self.assertEqual(p.read(Path(interrupted)/'results'/a['file']),p.read(Path(reference)/'results'/b['file']))
            # Crash after result commit but before Node job completion: no fitting.
            with patch.object(e,'Fit',side_effect=AssertionError('must not fit')):
                self.assertEqual(r.execute(payload,lambda v:None),resumed)
            identity=p.read(Path(interrupted)/'identity.json');identity['engine_sha256']='changed'
            p.atomic(Path(interrupted)/'identity.json',identity)
            with self.assertRaisesRegex(ValueError,'mismatch'):
                r.execute(payload,lambda v:None)

    def test_native_models_round_trip_matches_every_candidate(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(e.POLICY,iterations=3):
            series=[e.Series(data('a')),e.Series(data('b'))]
            day=dt.date(2024,1,5)
            fit=e.Fit(series,day)
            r.save_fit(fit,folder,{'a':'catboost_hurdle','b':'catboost_local'},{},{})
            loaded,manifest=r.load_fit(folder)
            for s in series:
                left=fit.forecasts(s,day,day+dt.timedelta(days=1))[1]
                right=loaded.forecasts(s,day,day+dt.timedelta(days=1))[1]
                for key in left:
                    self.assertEqual(left[key].tolist(),right[key].tolist())
            out=r.forecast(dict(_artifact_dir=folder,series=[data('a')],model_version='v',forecast_for=str(day),history_versions={'a':'snapshot'}))
            self.assertEqual(out['forecast_values'][0]['predicted_value'],fit.forecasts(series[0],day,day+dt.timedelta(days=1))[1]['catboost_hurdle'][0])
            with self.assertRaisesRegex(ValueError,'refit_due'):
                r.forecast(dict(_artifact_dir=folder,series=[data('a')],model_version='v',forecast_for='2024-03-01',history_versions={'a':'snapshot'}))
            entry=next(v for v in manifest['models'].values() if 'file' in v)
            (Path(folder)/entry['file']).write_bytes(b'broken')
            with self.assertRaisesRegex(ValueError,'checksum'):
                r.load_fit(folder)

    def test_revision_is_visible_only_after_its_availability(self):
        d=copy.deepcopy(self.a)
        day=dt.date(2024,1,5)
        stamp=list(e.slots(day-dt.timedelta(days=2),e.ZoneInfo('Europe/Berlin')))[0]
        d['rows'].append([stamp.timestamp()*1000,999,e.origin(day+dt.timedelta(days=1),e.ZoneInfo('Europe/Berlin')).timestamp()*1000])
        s=e.Series(d)
        self.assertEqual(s.lag(day,0,2,e.origin(day,s.zone),'none'),0)
        self.assertEqual(s.lag(day+dt.timedelta(days=1),0,3,e.origin(day+dt.timedelta(days=1),s.zone),'none'),999)

    def test_checkpoint_corruption_is_not_silently_retrained(self):
        with tempfile.TemporaryDirectory() as folder:
            p.save_block(folder,'2024-01-01',{'data':[1,2]})
            target=p.load_block(folder,'2024-01-01')
            target.write_bytes(b'broken')
            with self.assertRaisesRegex(ValueError,'checksum'):
                p.load_block(folder,'2024-01-01')


if __name__=='__main__':unittest.main()
