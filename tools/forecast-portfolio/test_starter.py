import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import engine as e
import persistence as p
import product
import starter
from test_product import sample


class StarterTests(unittest.TestCase):
    def test_public_export_install_adaptation_and_private_inference(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(product.POLICY, iterations=3):
            root = Path(temp)
            source = root/'source'; source.mkdir()
            data = sample(sid='private-meter-name')
            data['profile_revisions'] = [dict(label='confidential-profile',available_at=0)]
            task = dict(_workspace=str(source),_identity='seed',_owner='private-tenant',
                        _shared_root=str(root/'shared'),series=[data],forecast_for='2026-08-12',
                        reference_snapshots=[],contribution_keys={'private-meter-name':'ref'},
                        history_versions={'private-meter-name':'hist'},portfolio_method=e.contracts.normalize())
            product.train(task,lambda _:None)
            payload = starter.export_payload(source,'1.0.0','Apache-2.0')
            serialized = json.dumps(payload)
            for secret in ('private-meter-name','private-tenant','confidential-profile','history_versions','identities','rows'):
                self.assertNotIn(secret,serialized)
            installed=root/'installed';installed.mkdir()
            starter.validate_payload(payload,installed)
            clean=product.load_model(installed,p.read(installed/'manifest.json')['model'])
            # CatBoost restores only empty format defaults when loading JSON.
            self.assertEqual(dict(clean.get_metadata()), {'params':'{"flat_params":{}}'})
            ref=dict(directory=str(installed),version='public-version',release='1.0.0',manifest_sha256=p.digest(installed/'manifest.json'))
            new=sample(sid='new',days=100,factor=2)
            own=root/'own';own.mkdir()
            adapted=dict(task,_workspace=str(own),_owner='new-tenant',_identity='new',series=[new],
                         _starter=ref,forecast_for='2026-10-11',contribution_keys={'new':'newref'},history_versions={'new':'newhist'})
            result=product.train(adapted,lambda _:None)
            self.assertEqual(result['model']['evidence']['new']['public_starter_status'],'eligible')
            self.assertIn('public_starter',result['model']['evidence']['new']['mae'])
            self.assertIn('public_starter',result['model']['models'])
            model=result['model'];model['selected']['new']='public_starter';p.atomic(own/'model.json',model)
            forecast=dict(adapted,_artifact_dir=str(own),model_version='new')
            before=product.forecast(forecast)
            import shutil
            shutil.rmtree(installed)
            after=product.forecast(forecast)
            self.assertEqual(before['forecast_values'],after['forecast_values'])
            with self.assertRaisesRegex(ValueError,'tenant'):
                product.forecast(dict(forecast,_owner='foreign'))

    def test_future_model_excluded_and_contracts_fail_closed(self):
        import numpy as np
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            payload=dict(format=starter.FORMAT,schema=1,contract=starter.CONTRACT,release='1',license='Apache-2.0',
                         engine_sha256=e.SOURCE_SHA256,dependencies=dict(catboost=e.CATBOOST_VERSION,numpy=np.__version__),
                         features=product.FEATURES,unit='kWh',timezone='Europe/Berlin',
                         training_information_as_of='2027-01-01T00:00:00Z',model=dict(constant=1.0))
            starter.validate_payload(payload,root)
            ref=dict(directory=temp,manifest_sha256=p.digest(root/'manifest.json'))
            model,reason=starter.candidate(dict(_starter=ref),[product.Meter(sample())],dt.datetime(2026,8,1,tzinfo=e.UTC))
            self.assertIsNone(model);self.assertEqual(reason,'trained_after_validation_origin')
            bad=copy.deepcopy(payload);bad['features']=[]
            with self.assertRaisesRegex(ValueError,'feature mismatch'):
                starter.validate_payload(bad,root)
            p.atomic(root/'manifest.json',dict(payload,timezone='UTC'))
            with self.assertRaisesRegex(ValueError,'Pinned starter changed'):
                starter.candidate(dict(_starter=ref),[product.Meter(sample())],dt.datetime(2028,1,1,tzinfo=e.UTC))


if __name__=='__main__': unittest.main()
