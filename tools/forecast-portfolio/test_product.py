import copy
import datetime as dt
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import engine as e
import persistence as p
import product


def sample(sid='same-id', days=40, factor=1):
    start=dt.date(2026,7,1);zone=e.ZoneInfo('Europe/Berlin');rows=[];aux=[]
    for i in range(days):
        day=start+dt.timedelta(days=i)
        for stamp in e.slots(day,zone):
            hour=stamp.astimezone(zone).hour
            value=factor*(1+(hour//6)*.4+(i%7)*.03)
            avail=dt.datetime.combine(day+dt.timedelta(days=1),dt.time(),zone).timestamp()*1000
            rows.append([stamp.timestamp()*1000,value,avail,avail])
            aux.append([stamp.timestamp()*1000,(-1 if hour<12 else 1)*value,avail,avail])
    return dict(series_id=sid,unit='kWh',timezone=str(zone),validation={},rows=rows,auxiliary_rows=aux)


class ProductTests(unittest.TestCase):
    def test_shared_evidence_private_model_short_history_and_restart(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(product.POLICY,iterations=3):
            root=Path(folder)
            manifests=[]
            for owner,factor in [('alice',1),('bob',2)]:
                directory=root/owner;directory.mkdir()
                refs=[p.read(f) for f in (root/'shared'/'contributors').glob('*.json')]
                data=sample(factor=factor)
                payload=dict(_workspace=str(directory),_identity=owner,_owner=owner,
                    _shared_root=str(root/'shared'),series=[data],forecast_for='2026-08-12',
                    contribution_keys={'same-id':owner},reference_snapshots=refs,
                    history_versions={'same-id':owner},portfolio_method=e.contracts.normalize())
                result=product.train(payload,lambda _:None)
                m=result['model'];manifests.append(m)
                self.assertEqual(list(m['identities']),['same-id'])
                self.assertEqual(m['reference_meter_count'],0 if owner=='alice' else 1)
                self.assertTrue(m['evidence']['same-id']['provisional'])
                forecast=dict(_artifact_dir=str(directory),_owner=owner,series=[data],
                    forecast_for='2026-08-12',model_version=owner,history_versions={'same-id':owner})
                out=product.forecast(forecast)
                self.assertEqual(len(out['forecast_values']),96)
                self.assertIn('provisional_short_history',out['warnings'])
                self.assertEqual(out['forecast_values'],product.forecast(forecast)['forecast_values'])
                with self.assertRaisesRegex(ValueError,'tenant'):
                    product.forecast({**forecast,'_owner':'other'})
                with self.assertRaisesRegex(ValueError,'refit_due'):
                    product.forecast({**forecast,'forecast_for':'2026-09-15'})
                # An enriched model falls back safely when no optional values can be known.
                manifest=p.read(directory/'model.json');manifest['selected']['same-id']='baseline_optional'
                p.atomic(directory/'model.json',manifest)
                missing=copy.deepcopy(data);missing.pop('auxiliary_rows')
                out=product.forecast({**forecast,'series':[missing]})
                self.assertEqual(out['selected_model'],'baseline')
                self.assertIn('optional_features_unavailable_using_core_baseline',out['warnings'])
            self.assertNotEqual(manifests[0]['baseline_version'],manifests[1]['baseline_version'])
            self.assertEqual(len(list((root/'shared'/'contributors').glob('*.json'))),2)
            self.assertTrue((root/'shared'/'models'/manifests[0]['baseline_version']/'manifest.json').exists())

    def test_optional_availability_cutoff_and_missing_not_zero(self):
        data=sample();m=product.Meter(data)
        stamp=list(e.slots(dt.date(2026,8,5),m.s.zone))[0]
        x,_=m.features(stamp,1,True)
        self.assertEqual(x[17],0)
        future=copy.deepcopy(data)
        for row in future['auxiliary_rows']:
            row[2]=dt.datetime(2027,1,1,tzinfo=e.UTC).timestamp()*1000
        fx,_=product.Meter(future).features(stamp,1,True)
        self.assertEqual(fx[17:],[1,1])
        import math
        self.assertTrue(math.isnan(fx[15]))
        # D-2 never becomes an auxiliary feature.
        changed=copy.deepcopy(data)
        for row in changed['auxiliary_rows']:
            if dt.datetime.fromtimestamp(row[0]/1000,m.s.zone).date()==dt.date(2026,8,3):row[1]=99999
        cx,_=product.Meter(changed).features(stamp,1,True)
        self.assertEqual(x,cx)

    def test_old_resumed_training_cannot_replace_new_auxiliary_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);data=sample()
            newer=copy.deepcopy(data)
            newer['auxiliary_rows'][-1][1]=42
            newer['auxiliary_rows'][-1][2]+=86400000
            newer['auxiliary_rows'][-1][3]+=86400000
            payload=dict(_shared_root=folder,_workspace=folder,contribution_keys={'same-id':'meter'})
            manifest=dict(baseline_version='version',models={'baseline':{'constant':1.0},
                'baseline_optional':{'constant':1.0}},dependencies={})
            product.publish(payload,manifest,[product.Meter(newer)])
            ref=p.read(root/'contributors/meter.json')
            product.publish(payload,manifest,[product.Meter(data)])
            self.assertEqual(p.read(root/'contributors/meter.json'),ref)
            shared=p.read(root/'snapshots'/(ref['version']+'.json.gz'))
            self.assertEqual(shared['series_id'],'meter')
            self.assertEqual(shared['validation'],{})

    def test_short_history_rejected_before_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            payload=dict(_workspace=folder,_shared_root=folder+'/shared',series=[sample(days=10)],
                reference_snapshots=[],forecast_for='2026-07-13')
            with self.assertRaisesRegex(ValueError,'28 observed'):
                product.train(payload,lambda _:None)
            self.assertFalse((Path(folder)/'shared').exists())


if __name__=='__main__':unittest.main()
