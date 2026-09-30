import csv
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import prepare_training_data as prep
import prepared_training as training
import product


def fixture(path, start, count, dual=True, power_offset=0):
    headers=prep.DUAL if dual else prep.SIMPLE
    registers=[0,0]
    with path.open('w',encoding='cp1252',newline='') as f:
        writer=csv.writer(f);writer.writerow(headers)
        for n in range(count):
            end=start+prep.STEP*(n+1)
            imp=40+4*(n%96//12)+power_offset
            exp=8 if 24<=n%96<72 else 0
            registers[0]+=imp//4;registers[1]+=exp//4
            row=[end.astimezone(prep.BERLIN).strftime('%d.%m.%Y %H:%M'),end.strftime('%d.%m.%Y %H:%M')]
            row+=registers+[imp,exp] if dual else [registers[0],imp]
            writer.writerow(row)


class PreparationTests(unittest.TestCase):
    def test_merge_duplicate_files_channels_and_dst(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'source';source.mkdir()
            start=dt.datetime(2024,10,27,tzinfo=prep.UTC)
            original=source/'Site - Zähler 001.csv'
            fixture(original,start,8)
            lines=original.read_bytes().splitlines(keepends=True)
            # Two overlapping shards with identical rows and one byte-identical duplicate.
            original.write_bytes(b''.join(lines[:6]))
            (source/'Site - Zähler 001 (1).csv').write_bytes(lines[0]+b''.join(lines[4:]))
            (source/'Site - Zähler 001 (2).csv').write_bytes(original.read_bytes())
            result=prep.prepare(source,root/'out')
            self.assertEqual(len(result['series']),2)
            self.assertEqual(sum('duplicate_of' in v for v in result['files']),1)
            for entry in result['series']:
                self.assertEqual(entry['records'],8)
                self.assertEqual(entry['overlaps_removed'],2)
                self.assertEqual(entry['meter_id'],'001')
                self.assertEqual(entry['gaps'],[])
                data=json.loads((root/'out'/entry['file']).read_text())
                self.assertEqual(data['values'][0]['timestamp'],start.isoformat())
                self.assertEqual(data['values'][0]['value'],.01 if entry['target_direction']=='import' else 0)

    def test_conflicts_invalid_local_time_and_counter_mismatch_fail(self):
        for kind in ('conflict','local','counter'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as folder:
                root=Path(folder);file=root/'Site - Zähler 001.csv'
                fixture(file,dt.datetime(2024,1,1,tzinfo=prep.UTC),4,False)
                text=file.read_text(encoding='cp1252')
                rows=list(csv.reader(text.splitlines()))
                if kind=='local':rows[1][0]='01.01.2024 03:15'
                elif kind=='counter':rows[2][2]='999'
                else:
                    (root/'Site - Zähler 001 (1).csv').write_text(text,encoding='cp1252')
                    rows[1][3]='44'
                with file.open('w',encoding='cp1252',newline='') as f:csv.writer(f).writerows(rows)
                with self.assertRaises(ValueError):prep.prepare(root,root/'out')
                self.assertFalse((root/'out/manifest.json').exists())

    def test_missing_year_preserved_and_identity_not_duplicated(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for index,year in enumerate((2023,2025)):
                fixture(root/f'Site - Zähler 001 ({index}).csv',dt.datetime(year,1,1,tzinfo=prep.UTC),4)
            result=prep.prepare(root,root/'out')
            self.assertEqual(len(result['series']),2)
            self.assertEqual(result['series'][0]['records'],8)
            self.assertEqual(len(result['series'][0]['gaps']),1)
            self.assertGreater(result['series'][0]['gaps'][0]['missing_intervals'],70000)

    def test_old_references_and_new_histories_train_separately_by_direction(self):
        with tempfile.TemporaryDirectory() as folder,patch.dict(product.POLICY,iterations=2):
            root=Path(folder);source=root/'source';source.mkdir()
            for meter,year in [('001',2024),('002',2025)]:
                fixture(source/f'Site - Zähler {meter}.csv',dt.datetime(year,7,1,tzinfo=prep.UTC),40*96)
            prepared=root/'prepared';prep.prepare(source,prepared)
            import subprocess
            cli=Path(__file__).with_name('starter_model.js')
            keys=root/'keys'
            subprocess.run(['node',str(cli),'keygen','--out',str(keys)],check=True,capture_output=True)
            day=dt.date(2025,8,12)
            for direction in ('import','export'):
                output=root/direction
                result=training.run(prepared/'manifest.json',direction,day,output,unit='kWh')
                self.assertEqual(result['status'],'trained')
                plan=json.loads((output/'training-plan.json').read_text())
                self.assertEqual((plan['own_meter_count'],plan['reference_meter_count']),(1,1))
                self.assertTrue(all(x['series_id'].endswith('-'+direction) for x in plan['series']))
                model=json.loads((output/'model.json').read_text())
                self.assertEqual(model['reference_meter_count'],1)
                self.assertEqual(model['contributed_meter_count'],1)
                self.assertEqual(json.loads((output/'training-scope.json').read_text())['target_direction'],direction)
                exported=root/(direction+'-public.json')
                publication=subprocess.run(['node',str(cli),'export','--model-dir',str(output),
                    '--release','test','--license','Apache-2.0','--private-key',str(keys/'private.pem'),
                    '--out',str(exported)],capture_output=True)
                self.assertEqual(publication.returncode,0 if direction=='import' else 1,
                                 publication.stderr.decode())
                self.assertEqual(exported.exists(),direction=='import')
            checked=root/'checked'
            self.assertFalse(training.run(prepared/'manifest.json','import',day,checked,True)['trained'])
            self.assertFalse((checked/'model.json').exists())
            # A changed source is refused before it can be used in training.
            manifest=json.loads((prepared/'manifest.json').read_text())
            entry=next(x for x in manifest['series'] if x['target_direction']=='import')
            (prepared/entry['file']).write_text('{}')
            with self.assertRaisesRegex(ValueError,'checksum'):
                training.run(prepared/'manifest.json','import',day,root/'bad',True)


if __name__=='__main__':unittest.main()
