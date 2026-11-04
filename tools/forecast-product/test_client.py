import contextlib
import datetime as dt
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from zoneinfo import ZoneInfo
import forecast_product as cli

SAMPLE_MSCONS = ''.join([
    "UNH+1+MSCONS:D:04B:UN:2.3e'",
    "BGM+7+DOC20260401001+9'",
    "DTM+137:20260401:102'",
    "NAD+MS+9900992720003::293'",
    "NAD+MR+9907015000008::293'",
    "LOC+172+DE0003966698900000000000052335107'",
    "DTM+163:202604010000:303'",
    "DTM+164:202604012359:303'",
    "CCI+11++Z06'",
    "QTY+220:12.4:KWH'",
    "DTM+163:202604010000:303'",
    "DTM+164:202604010015:303'",
    "STS+7++67'",
    "QTY+220:11.8:KWH'",
    "DTM+163:202604010015:303'",
    "DTM+164:202604010030:303'",
    "STS+7++79'",
    "UNT+18+1'",
])


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def fixture(self, day='2024-10-27', value=2, predicted=3):
        zone=ZoneInfo('Europe/Berlin');d=dt.date.fromisoformat(day)
        t=dt.datetime.combine(d,dt.time(),zone).astimezone(cli.UTC)
        stop=dt.datetime.combine(d+dt.timedelta(days=1),dt.time(),zone).astimezone(cli.UTC)
        values=[]
        while t<stop:
            values.append({'timestamp':t.isoformat(),'value':value});t+=dt.timedelta(minutes=15)
        actual={'series_id':'meter','unit':'kWh','timezone':str(zone),'values':values}
        result={'tenant_id':'a','result':{'status':'completed','series_id':'meter','forecast_for':day,
                'unit':'kWh','timezone':str(zone),'forecast_values':[{'timestamp':v['timestamp'],'predicted_value':predicted} for v in values]}}
        cli.save(self.root/'actual.json',actual);cli.save(self.root/'prediction.json',result)
        return actual,result

    def score(self, *extra):
        return cli.main(['score','--tenant-id','a','--series-id','meter','--actuals',str(self.root/'actual.json'),
            '--predictions',str(self.root/'prediction.json'),'--out',str(self.root/'out'),*extra])

    def test_exact_metrics_and_dst(self):
        for day,n in [('2024-10-27',100),('2024-03-31',92)]:
            with self.subTest(day=day):
                self.fixture(day)
                out=self.root/'out'
                if out.exists():
                    import shutil;shutil.rmtree(out)
                self.assertEqual(self.score(),0)
                m=cli.read(out/'metrics.json')
                self.assertEqual((m['sample_count'],m['rmse'],m['mae'],m['wape_percent']),(n,1,1,50))

    def test_zero_actual_sum_is_undefined(self):
        self.fixture(value=0,predicted=0)
        self.assertEqual(self.score(),0)
        self.assertIsNone(cli.read(self.root/'out/metrics.json')['wape_percent'])

    def test_partial_is_explicit(self):
        actual,_=self.fixture();actual['values'].pop();cli.save(self.root/'actual.json',actual)
        self.assertEqual(self.score(),1)
        import shutil;shutil.rmtree(self.root/'out')
        self.assertEqual(self.score('--allow-partial'),0)
        self.assertEqual(cli.read(self.root/'out/metrics.json')['coverage'],.99)

    def test_wrong_tenant_and_wrong_series_rejected(self):
        actual,result=self.fixture();result['tenant_id']='b';cli.save(self.root/'prediction.json',result)
        self.assertEqual(self.score(),1)
        import shutil;shutil.rmtree(self.root/'out')
        result['tenant_id']='a';actual['series_id']='other';cli.save(self.root/'prediction.json',result);cli.save(self.root/'actual.json',actual)
        self.assertEqual(self.score(),1)

    def test_duplicate_and_missing_forecast_intervals_rejected(self):
        _,result=self.fixture();result['result']['forecast_values'].pop();cli.save(self.root/'prediction.json',result)
        self.assertEqual(self.score(),1)

    def test_xlsx_conversion_and_seed_dry_run(self):
        from openpyxl import Workbook
        book=Workbook();sheet=book.active
        sheet.append(['Meldepunkt','OBIS','Datum von','Datum bis','Wert'])
        t=dt.datetime(2024,1,1)
        for i in range(4):sheet.append(['42','1-1:1.29.0',t+dt.timedelta(minutes=15*i),t+dt.timedelta(minutes=15*(i+1)),i])
        file=self.root/'meter.xlsx';book.save(file)
        self.assertEqual(cli.main(['seed','--tenant-id','a','--xlsx',str(file),'--unit','kWh',
            '--forecast-for','2024-02-01','--dry-run','--out',str(self.root/'plan')]),0)
        plan=cli.read(self.root/'plan/run.json')
        self.assertEqual(plan['request']['series_ids'],['meter-42'])
        self.assertEqual(plan['inputs'][0]['records'],4)

    def mscons_fixture(self, count=96, melo='DE0003966698900000000000052335107'):
        parts=["UNH+1+MSCONS:D:04B:UN:2.3e'","BGM+7+DOC20261006001+9'","DTM+137:20261007:102'",
            "NAD+MS+9900992720003::293'","NAD+MR+9907015000008::293'",f"LOC+172+{melo}'","CCI+11++Z06'"]
        start=dt.datetime(2026,10,6,tzinfo=cli.UTC)
        for index in range(count):
            a=start+dt.timedelta(minutes=15*index);b=a+dt.timedelta(minutes=15)
            parts.extend([f"QTY+220:{1+index/100:.2f}:KWH'",f"DTM+163:{a:%Y%m%d%H%M}:303'",
                f"DTM+164:{b:%Y%m%d%H%M}:303'","STS+7++67'"])
        parts.append(f"UNT+{len(parts)+1}+1'")
        return ''.join(parts)

    def test_mscons_history_input_maps_daily_values_and_envelope(self):
        file=self.root/'daily.mscons';file.write_text(self.mscons_fixture(),encoding='utf-8')
        dataset,audit=cli.load_dataset(file,series_id='kunde-zaehler-42')
        self.assertEqual(dataset['series_id'],'kunde-zaehler-42')
        self.assertEqual(dataset['unit'],'kWh')
        self.assertEqual(dataset['timezone'],'Europe/Berlin')
        self.assertEqual(len(dataset['values']),96)
        self.assertEqual(dataset['values'][0]['timestamp'],'2026-10-06T00:00:00+00:00')
        self.assertEqual(dataset['values'][0]['quality'],'measured')
        self.assertEqual(dataset['source']['format'],'mscons')
        self.assertEqual(dataset['source']['documentNumber'],'DOC20261006001')
        self.assertEqual(dataset['source']['sender']['id'],'9900992720003')
        self.assertEqual(dataset['source']['receiver']['id'],'9907015000008')
        self.assertEqual(dataset['source']['meloId'],'DE0003966698900000000000052335107')
        self.assertEqual(dataset['source']['obisEquivalent'],'1-0:1.8.0')
        self.assertEqual(audit['format'],'mscons')
        self.assertEqual(audit['records'],96)

    def test_mscons_dataset_preserves_envelope_provenance(self):
        file=self.root/'meter.mscons';file.write_text(SAMPLE_MSCONS)
        dataset,audit=cli.load_dataset(file)
        self.assertEqual(dataset['series_id'],'DE0003966698900000000000052335107')
        self.assertEqual(dataset['unit'],'kWh')
        self.assertEqual(dataset['value_semantics'],'interval_energy')
        self.assertEqual([v['value'] for v in dataset['values']],[12.4,11.8])
        self.assertEqual(dataset['values'][0]['quality'],'measured')
        self.assertEqual(dataset['values'][1]['quality'],'estimated')
        self.assertEqual(dataset['source_envelope']['format'],'MSCONS')
        self.assertEqual(dataset['source_envelope']['document_number'],'DOC20260401001')
        self.assertEqual(dataset['source_envelope']['sender']['id'],'9900992720003')
        self.assertEqual(dataset['source_envelope']['receiver']['id'],'9907015000008')
        self.assertEqual(dataset['source_envelope']['location']['melo_id'],dataset['series_id'])
        self.assertEqual(dataset['source_envelope']['obis'],'1-0:1.8.0')
        self.assertEqual(audit['source_format'],'MSCONS')
        self.assertEqual(audit['document_number'],'DOC20260401001')

    def test_mscons_rejects_ambiguous_or_invalid_measurements(self):
        cases = {
            'multiple_messages': SAMPLE_MSCONS + SAMPLE_MSCONS,
            'multiple_locations': SAMPLE_MSCONS.replace("UNT+18+1'", "LOC+172+OTHER'UNT+18+1'"),
            'multiple_channels': SAMPLE_MSCONS.replace("UNT+18+1'", "CCI+11++Z07'UNT+18+1'"),
            'wrong_location': SAMPLE_MSCONS.replace('LOC+172+', 'LOC+999+'),
            'mixed_units': SAMPLE_MSCONS.replace('11.8:KWH', '11.8:KW'),
            'unsupported_unit': SAMPLE_MSCONS.replace(':KWH', ':MWH'),
            'non_numeric': SAMPLE_MSCONS.replace('12.4:KWH', 'unknown:KWH'),
            'empty_quantity': SAMPLE_MSCONS.replace('12.4:KWH', ':KWH'),
            'negative_quantity': SAMPLE_MSCONS.replace('12.4:KWH', '-12.4:KWH'),
            'register_reading': SAMPLE_MSCONS.replace('202604010015:303', '202604010100:303', 1),
            'duplicate': SAMPLE_MSCONS.replace('DTM+163:202604010015:303', 'DTM+163:202604010000:303')
                .replace('202604010030:303', '202604010015:303'),
        }
        for name, raw in cases.items():
            with self.subTest(name=name):
                file = self.root / (name + '.mscons')
                file.write_text(raw)
                with self.assertRaises(ValueError):
                    cli.load_dataset(file)

    def test_mscons_power_units_zero_values_and_identity_are_preserved(self):
        file = self.root / 'power.edifact'
        file.write_text(SAMPLE_MSCONS.replace(':KWH', ':KW').replace('12.4:KW', '0:KW'))
        dataset, _ = cli.load_dataset(file)
        self.assertEqual(dataset['value_semantics'], 'average_power')
        self.assertEqual(dataset['unit'], 'kW')
        self.assertEqual(dataset['values'][0]['value'], 0)
        self.assertEqual(dataset['source_envelope']['location']['loc_qualifier'], '172')
        with self.assertRaisesRegex(ValueError, 'do not pass --unit'):
            cli.load_dataset(file, unit='kWh')

    def test_mscons_paths_are_confined_after_symlink_resolution(self):
        with self.assertRaisesRegex(ValueError, 'working directory or system temp'):
            cli.load_mscons_dataset('/etc/hosts')
        link = self.root / 'outside.mscons'
        link.symlink_to('/etc/hosts')
        with self.assertRaisesRegex(ValueError, 'working directory or system temp'):
            cli.load_mscons_dataset(link)

    def test_mscons_identifiers_are_data_not_process_arguments(self):
        file = self.root / '--eval.mscons'
        file.write_text(SAMPLE_MSCONS)
        identity = '--eval=throw new Error("must never execute")'
        dataset, _ = cli.load_dataset(file, series_id=identity)
        self.assertEqual(dataset['series_id'], identity)

    def test_mscons_history_dry_run_keeps_input_provenance(self):
        file=self.root/'meter.edi';file.write_text(SAMPLE_MSCONS)
        self.assertEqual(cli.main(['history','--tenant-id','a','--series-id','DE0003966698900000000000052335107',
            '--input',str(file),'--dry-run','--out',str(self.root/'mscons-plan')]),0)
        plan=cli.read(self.root/'mscons-plan/run.json')
        self.assertEqual(plan['inputs'][0]['source_format'],'MSCONS')
        self.assertEqual(plan['input_provenance'][0]['document_number'],'DOC20260401001')
        self.assertEqual(plan['input_provenance'][0]['obis'],'1-0:1.8.0')

    def test_predict_copies_model_input_provenance_into_result(self):
        day='2024-01-01';_,_=self.fixture(day=day)
        model='a'*64;run='b'*64;secret='ck_test_secret'
        model_file=self.root/'model.json'
        cli.save(model_file,{'tenant_id':'a','result':{'model_version':model},
            'input_provenance':[{'source_format':'MSCONS','document_number':'DOC20260401001','melo_id':'meter','obis':'1-0:1.8.0'}]})
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def answer(self):
                _=self.rfile.read(int(self.headers.get('Content-Length',0)))
                if self.path=='/api/tokens/verify': data={'valid':True,'tenantId':'a'}
                elif self.path.endswith('/predict'): data={'jobId':'job','run_id':run}
                elif self.path.endswith('/runs/'+run):
                    pred=cli.read(Path(model_file).parent/'prediction.json')['result']
                    data={'status':'completed','result':{**pred,'model_version':model}}
                else: data={'status':'running'}
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode())
            do_POST=answer;do_GET=answer
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        with patch.dict(os.environ,CET_API_TOKEN=secret):
            self.assertEqual(cli.main(['predict','--tenant-id','a','--series-id','meter','--model-file',str(model_file),
                '--forecast-for',day,'--base-url','http://127.0.0.1:'+str(server.server_port),'--out',str(self.root/'predict')]),0)
        result=cli.read(self.root/'predict/result.json')
        self.assertEqual(result['result']['input_provenance'][0]['source_format'],'MSCONS')
        self.assertEqual(result['result']['input_provenance'][0]['document_number'],'DOC20260401001')

    def test_local_provenance_does_not_replace_api_provenance(self):
        from types import SimpleNamespace
        server_source = {'input_format': 'verified-server-history'}
        server_inputs = [{'document_number': 'SERVER'}]
        local_inputs = [{'source_format': 'MSCONS', 'document_number': 'LOCAL'}]
        result = {'status': 'completed', 'source_provenance': server_source,
                  'input_provenance': server_inputs}
        client = SimpleNamespace(tenant='a', base='https://cet.example.test')
        state = {'operation': 'train', 'input_provenance': local_inputs}
        with patch.object(cli, 'await_result', return_value=result):
            cli.finish(client, state, SimpleNamespace(), self.root, {})
        saved = cli.read(self.root / 'result.json')
        self.assertEqual(saved['result']['source_provenance'], server_source)
        self.assertEqual(saved['result']['input_provenance'], server_inputs)
        self.assertEqual(saved['input_provenance'], local_inputs)

    def test_mscons_enroll_and_predict_preserve_source_provenance(self):
        file=self.root/'daily.mscons';file.write_text(self.mscons_fixture(),encoding='utf-8')
        calls=[];secret='ck_test_secret';model='a'*64
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def answer(self):
                payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'null')
                calls.append((self.path,payload))
                if self.path=='/api/tokens/verify': data={'valid':True,'tenantId':'a'}
                elif self.path.endswith('/history'):data={'series_id':'kunde-zaehler-42','history_version':'b'*64}
                elif self.path.endswith('/train'):data={'jobId':'job','run_id':model}
                elif self.path.endswith('/predict'):data={'jobId':'job','run_id':model}
                else:data={'status':'completed','result':{'status':'completed','series_id':'kunde-zaehler-42',
                    'forecast_for':'2026-10-07','model_version':model,'forecast_values':[]}}
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode())
            do_POST=answer
            do_GET=answer
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        base='http://127.0.0.1:'+str(server.server_port)
        with patch.dict(os.environ,CET_API_TOKEN=secret):
            self.assertEqual(cli.main(['enroll','--series-id','kunde-zaehler-42','--input',str(file),
                '--forecast-for','2026-10-07','--base-url',base,'--out',str(self.root/'enroll')]),0)
        history_payload=calls[1][1]
        self.assertEqual(history_payload['dataset']['source']['format'],'mscons')
        self.assertEqual(history_payload['dataset']['source']['documentNumber'],'DOC20261006001')
        enrolled=cli.read(self.root/'enroll/result.json')
        self.assertEqual(enrolled['result']['source_provenance']['input_format'],'mscons')
        self.assertEqual(enrolled['result']['source_provenance']['last_history_message']['documentNumber'],'DOC20261006001')
        calls.clear()
        with patch.dict(os.environ,CET_API_TOKEN=secret):
            self.assertEqual(cli.main(['predict','--series-id','kunde-zaehler-42','--model-file',str(self.root/'enroll/result.json'),
                '--forecast-for','2026-10-07','--base-url',base,'--out',str(self.root/'predict')]),0)
        predicted=cli.read(self.root/'predict/result.json')
        self.assertEqual(predicted['result']['source_provenance']['last_history_message']['meloId'],
            'DE0003966698900000000000052335107')

    def test_http_contract_and_token_scrubbing(self):
        actual,_=self.fixture(day='2024-01-01')
        calls=[];secret='ck_test_secret';model='a'*64
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def answer(self):
                payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'null')
                calls.append((self.path,payload,self.headers.get('Authorization'),self.headers.get('X-Tenant-Id')))
                if self.path=='/api/tokens/verify': data={'valid':True,'tenantId':'a'}
                elif self.path.endswith('/history'):data={'series_id':'meter','history_version':'b'*64}
                elif self.path.endswith('/train'):data={'jobId':'job','run_id':model}
                else:data={'status':'completed','result':{'status':'completed','model_version':model,'test_echo':secret}}
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode())
            do_POST=answer
            do_GET=answer
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        args=['enroll','--tenant-id','a','--input',str(self.root/'actual.json'),'--series-id','meter',
            '--forecast-for','2024-02-01','--base-url','http://127.0.0.1:'+str(server.server_port),'--out',str(self.root/'api')]
        with patch.dict(os.environ,CET_API_TOKEN=secret):self.assertEqual(cli.main(args),0)
        self.assertEqual(calls[0][2:], ('Bearer '+secret, None))
        self.assertTrue(all(c[2:] == ('Bearer '+secret,'a') for c in calls[1:]))
        self.assertEqual(calls[0][0],'/api/tokens/verify')
        self.assertEqual(calls[1][1]['historical_import'],True)
        self.assertEqual(calls[2][1]['strategy'],'shared_baseline')
        self.assertNotIn(secret,''.join(p.read_text() for p in (self.root/'api').glob('*.json')))
        # A mismatched hint no longer blocks; archives remain bound to the token tenant.
        calls.clear();args[2]='b';args[-1]=str(self.root/'wrong')
        with patch.dict(os.environ,CET_API_TOKEN=secret):self.assertEqual(cli.main(args),0)
        self.assertGreater(len(calls),1)
        self.assertEqual(cli.read(self.root/'wrong/result.json')['tenant_id'],'a')

    def test_dotenv_token_precedence_and_no_cernion_fallback(self):
        env=self.root/'.env'
        env.write_text('CET_API_TOKEN="ck_dotenv" # comment\nCERNION_TOKEN=ck_wrong\nTENANT_ID=other\n')
        args=cli.parser().parse_args(['train','--env-file',str(env),'--series-ids','meter',
            '--forecast-for','2024-01-01','--out',str(self.root/'out')])
        with patch.dict(os.environ,{},clear=True):
            self.assertEqual(cli.Client(args).token,'ck_dotenv')
            with patch.object(cli.Client,'call',return_value={'valid':True,'tenantId':'actual'}):
                client=cli.Client(args);client.verify()
                self.assertEqual((client.tenant,client.header_tenant),('actual','actual'))
            with patch.dict(os.environ,CET_API_TOKEN='ck_shell'):
                self.assertEqual(cli.Client(args).token,'ck_shell')
            env.write_text('CERNION_TOKEN=ck_wrong\nCK_LOCAL_TOKEN=ck_also_wrong\n')
            with self.assertRaisesRegex(ValueError,'CET_API_TOKEN'):
                cli.Client(args)

    def test_dotenv_discovery_and_explicit_tenant_override_header(self):
        env=self.root/'.env';env.write_text('CET_API_TOKEN=ck_env\nCET_TENANT_OVERRIDE=true\nTENANT_ID=header-tenant\n')
        nested=self.root/'nested';nested.mkdir()
        args=cli.parser().parse_args(['train','--series-ids','meter','--forecast-for','2024-01-01',
            '--out',str(self.root/'out')])
        with patch.dict(os.environ,{},clear=True),patch.object(Path,'cwd',return_value=nested):
            with patch.object(cli.Client,'call',return_value={'valid':True,'tenantId':'actual'}):
                client=cli.Client(args);client.verify()
                self.assertEqual(client.token,'ck_env')
                self.assertEqual(client.tenant,'actual')
                self.assertEqual(client.header_tenant,'header-tenant')
                args.tenant_id='cli-tenant'
                client=cli.Client(args);client.verify()
                self.assertEqual(client.header_tenant,'cli-tenant')

    def test_invalid_token_still_stops_and_offline_score_needs_no_tenant_argument(self):
        args=cli.parser().parse_args(['train','--series-ids','meter','--forecast-for','2024-01-01',
            '--out',str(self.root/'out')])
        with patch.dict(os.environ,CET_API_TOKEN='ck_secret'),patch.object(cli.Client,'call',return_value={'valid':False}):
            with self.assertRaisesRegex(ValueError,'invalid'):
                cli.Client(args).verify()
        self.fixture()
        self.assertEqual(cli.main(['score','--series-id','meter','--actuals',str(self.root/'actual.json'),
            '--predictions',str(self.root/'prediction.json'),'--out',str(self.root/'score')]),0)

    def test_writes_are_never_retried(self):
        args=cli.parser().parse_args(['train','--tenant-id','a','--series-ids','meter','--forecast-for','2024-01-01','--out',str(self.root/'out')])
        with patch.dict(os.environ,CET_API_TOKEN='ck_secret'),patch.object(cli.urllib.request.OpenerDirector,'open',side_effect=TimeoutError) as opener:
            client=cli.Client(args)
            with self.assertRaises(ConnectionError):client.call(cli.ROOT+'/train',{})
            self.assertEqual(opener.call_count,1)


    def test_remote_transport_requires_tls_before_token_submission(self):
        args=cli.parser().parse_args(['train','--series-ids','meter','--forecast-for','2024-01-01',
            '--out',str(self.root/'out')])
        with patch.dict(os.environ,CET_API_TOKEN='ck_secret'):
            for base in ('http://10.0.0.8:3900', 'http://localhost.attacker.test'):
                args.base_url=base
                with self.assertRaisesRegex(ValueError,'HTTPS'):
                    cli.Client(args)
            for base in ('http://127.0.0.1:3900','http://[::1]:3900','https://cet.example.test'):
                args.base_url=base
                self.assertEqual(cli.Client(args).base,base)

    def test_api_route_validation_blocks_origin_and_path_injection(self):
        args=cli.parser().parse_args(['train','--series-ids','meter','--forecast-for','2024-01-01',
            '--out',str(self.root/'out')])
        with patch.dict(os.environ,CET_API_TOKEN='ck_secret'):
            client=cli.Client(args)
        with patch.object(client.opener,'open') as opener:
            for route in ('https://attacker.test', '//attacker.test', '/api/jobs/../status',
                          '/api/jobs/%2e%2e/status', '/api/jobs/id%2fadmin/status',
                          '/api/jobs/id/status?token=secret', '/api/admin',
                          cli.ROOT+'/runs/'+('a'*63), None):
                with self.assertRaisesRegex(ValueError,'route'):
                    client.call(route)
            opener.assert_not_called()

    def test_server_job_ids_are_checked_before_polling(self):
        from unittest.mock import Mock
        args=cli.parser().parse_args(['train','--series-ids','meter','--forecast-for','2024-01-01',
            '--out',str(self.root/'out')])
        client=Mock()
        for job_id in ('..','../admin','id%2fadmin','https://attacker.test','x'*161,5):
            with self.assertRaisesRegex(ValueError,'job ID'):
                cli.await_result(client,{'run_id':'a'*64,'jobId':job_id},args)
        client.call.assert_not_called()
        client.call.side_effect=[{'status':'running'},{'status':'failed','error':'controlled failure'}]
        with self.assertRaisesRegex(ValueError,'Job stopped'):
            cli.await_result(client,{'run_id':'a'*64,'jobId':'job-valid_001'},args)
        self.assertEqual(client.call.call_args_list[-1].args[0],'/api/jobs/job-valid_001/status')


if __name__=='__main__':unittest.main()
