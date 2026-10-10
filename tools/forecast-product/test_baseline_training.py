import copy
import datetime as dt
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import baseline_training as b
import product
import engine as e
import persistence as p


def meter(sid='m',start=dt.date(2023,1,1),days=730,factor=1):
    zone=e.ZoneInfo('Europe/Berlin');rows=[]
    for i in range(days):
        day=start+dt.timedelta(days=i)
        available=dt.datetime.combine(day+dt.timedelta(days=1),dt.time(),zone).timestamp()*1000
        for stamp in e.slots(day,zone):
            value=factor*(1+(stamp.astimezone(zone).hour>=8)+.1*(day.month%3))
            rows.append([stamp.timestamp()*1000,value,available,available])
    return product.Meter(dict(series_id=sid,unit='kWh',timezone=str(zone),validation={},rows=rows))


class BaselineTests(unittest.TestCase):
    def test_equal_meter_season_year_weights_and_old_history_retained(self):
        old=meter();recent=meter('new',dt.date(2024,6,1),180,4)
        with patch.dict(b.POLICY,max_examples_per_meter=1024):
            _,audit,missing=b.panel([old,recent],dt.date(2025,1,3),fit=False,require_all=True)
        self.assertFalse(missing)
        for item in audit.values():
            self.assertAlmostEqual(item['weight_sum'],1)
            self.assertAlmostEqual(item['panel_weight'],.5)
        self.assertTrue(any(k.startswith('2023-') for k in audit['m']['buckets']))
        seasons={name:sum(v['weight'] for k,v in audit['m']['buckets'].items() if k.endswith(name)) for name in b.SEASONS}
        for weight in seasons.values():self.assertAlmostEqual(weight,.25)
        for name in b.SEASONS:
            weights=[v['weight'] for k,v in audit['m']['buckets'].items() if k.endswith(name)]
            self.assertAlmostEqual(min(weights),max(weights))

    def test_future_labels_and_d2_lag_cannot_change_fold_features(self):
        original=meter(days=140);day=dt.date(2023,4,15)
        changed=copy.deepcopy(original.data)
        for row in changed['rows']:
            if dt.datetime.fromtimestamp(row[0]/1000,e.UTC).astimezone(original.s.zone).date()>=day-dt.timedelta(days=2):
                row[1]=999999
        with patch.dict(b.POLICY,max_examples_per_meter=1024):
            first,_=b.samples(original,day)
            other,_=b.samples(product.Meter(changed),day)
        self.assertEqual(first['audit'],other['audit'])
        import numpy as np
        np.testing.assert_allclose(np.asarray(first['x'],dtype=object)[:,1:].astype(float),
                                   np.asarray(other['x'],dtype=object)[:,1:].astype(float),equal_nan=True)
        self.assertEqual(first['y'],other['y'])
        self.assertEqual(first['weights'],other['weights'])

    def test_calendar_schedule_missing_season_and_metrics_identities(self):
        full=meter();short=meter('short',dt.date(2024,11,1),45)
        windows,missing=b.schedule([full,short],dt.date(2025,1,3))
        self.assertEqual(sum(v['series_id']=='m' for group in windows.values() for v in group),4)
        self.assertEqual(sum(v['series_id']=='short' for v in missing),4)
        self.assertTrue(all(start.day==15 for start in windows))
        metrics=b.metrics([0,1,3],[1,2,1])
        self.assertEqual(metrics['sum_abs_error'],4)
        self.assertEqual(metrics['mae'],4/3)
        self.assertEqual(metrics['wape_percent'],100)
        self.assertIsNone(b.metrics([0,0],[0,1])['wape_percent'])

    def test_native_complete_run_checksums_and_public_export(self):
        import subprocess
        with tempfile.TemporaryDirectory() as folder,patch.dict(b.POLICY,max_examples_per_meter=1024),patch.dict(product.POLICY,iterations=2):
            root=Path(folder);m=meter(days=730)
            values=[dict(timestamp=e.iso(dt.datetime.fromtimestamp(r[0]/1000,e.UTC)),value=r[1]) for r in m.data['rows']]
            data=dict(series_id='m',target_direction='import',unit='kWh',timezone='Europe/Berlin',values=values)
            p.atomic(root/'input.json',data)
            p.atomic(root/'manifest.json',dict(format='cet-prepared-training',schema=1,series=[dict(series_id='m',target_direction='import',file='input.json',sha256=p.digest(root/'input.json'),sources=['test'])]))
            output=root/'trained'
            receipt=b.run(root/'manifest.json','import',dt.date(2025,1,3),output)
            self.assertEqual(receipt['status'],'trained')
            report=p.read(output/'quality-report.json')
            self.assertTrue(all(report['validation_summary']['checks'].values()))
            manifest=p.read(output/'model.json')
            self.assertEqual(set(manifest['models']),{'baseline'})
            self.assertEqual(manifest['publisher_training']['quality_report_sha256'],p.digest(output/'quality-report.json'))
            for fold in (output/'folds').glob('*.json'):
                item=p.read(fold)
                for audit in item['training'].values():
                    self.assertLessEqual(audit['latest_training_label'][:10],audit['latest_allowed_measurement_day'])
            tool=Path(__file__).with_name('starter_model.js')
            subprocess.run(['node',str(tool),'keygen','--out',str(root/'keys')],capture_output=True,check=True)
            args=['node',str(tool),'export','--model-dir',str(output),'--release','test','--license','Apache-2.0','--private-key',str(root/'keys/private.pem'),'--out',str(root/'public.json')]
            result=subprocess.run(args,capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            report['validation_summary']['checks']['all_meters_evaluated']=False
            p.atomic(output/'quality-report.json',report)
            args[-1]=str(root/'invalid.json')
            self.assertNotEqual(subprocess.run(args,capture_output=True).returncode,0)
            self.assertFalse((root/'invalid.json').exists())


if __name__=='__main__':unittest.main()
