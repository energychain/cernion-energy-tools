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
