"""Real native-model transfer round trip and failure atomicity."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import transfer as t
import product
import persistence as p
from test_product import sample


class TransferTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / 'source'
        owner = hashlib.sha256(b'alice').hexdigest()
        cls.owner = owner
        identity = hashlib.sha256(b'model').hexdigest()
        directory = cls.source / owner / 'runs' / identity
        directory.mkdir(parents=True)
        data = sample()
        version = product.digest_json(data)
        history = cls.source / owner / 'history' / hashlib.sha256(b'same-id').hexdigest()
        p.atomic(history / (version + '.json.gz'), data)
        p.atomic(history / 'current.json', dict(version=version))
        task = dict(_operation='train', _product=True, _source=t.compatibility()['engine_sha256'],
                    _workspace=str(directory), _identity=identity, _owner=owner,
                    _shared_root=str(cls.source / '_shared-baseline'), series=[data],
                    forecast_for='2026-08-12', contribution_keys={'same-id':hashlib.sha256(b'key').hexdigest()},
                    reference_snapshots=[], history_versions={'same-id':version},
                    portfolio_method=product.e.contracts.normalize())
        with patch.dict(product.POLICY, iterations=3):
            result = product.train(task, lambda _: None)
        p.atomic(directory / 'request.json.gz', task)
        p.atomic(directory / 'result.json', result)
        cls.archive = cls.root / 'bundle.zip'
        cls.receipt = t.export_bundle(cls.source, cls.archive)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_round_trip_and_future_shared_training(self):
        target = self.root / 'imported'
        result = t.import_bundle(self.archive, self.receipt['sha256'], target, 10**8)
        self.assertEqual(result['forecast_probes'], 1)
        with zipfile.ZipFile(self.archive) as archive:
            self.assertEqual(json.loads(archive.read('manifest.json'))['files'], t.inventory(target))
        self.assertFalse((target / '_shared-baseline/.lock').exists())
        # A fresh tenant can train using the transferred corpus at its new path.
        directory = self.root / 'next-model'
        directory.mkdir()
        task = dict(_workspace=str(directory), _identity='next', _owner='bob',
                    _shared_root=str(target / '_shared-baseline'), series=[sample(sid='new')],
                    forecast_for='2026-08-12', contribution_keys={'new':'new'},
                    reference_snapshots=[p.read(f) for f in (target/'_shared-baseline/contributors').glob('*.json')],
                    history_versions={'new':'new'}, portfolio_method=product.e.contracts.normalize())
        with patch.dict(product.POLICY, iterations=3):
            model = product.train(task, lambda _: None)['model']
        self.assertEqual(model['reference_meter_count'], 1)
        self.assertEqual(model['contributed_meter_count'], 1)

    def test_atomic_publication_does_not_replace_racing_target(self):
        stage = self.root / 'race-stage'
        target = self.root / 'race-target'
        stage.mkdir()
        target.mkdir()
        with self.assertRaises(FileExistsError):
            t.publish_directory(stage, target)
        self.assertTrue(stage.exists())
        self.assertTrue(target.exists())

    def test_verify_is_read_only_and_existing_target_protected(self):
        target = self.root / 'verify-target'
        self.assertEqual(t.import_bundle(self.archive, self.receipt['sha256'], target, 10**8, True)['status'], 'verified')
        self.assertFalse(target.exists())
        target.mkdir()
        (target/'sentinel').write_text('keep')
        with self.assertRaisesRegex(ValueError, 'Target must not exist'):
            t.import_bundle(self.archive, self.receipt['sha256'], target, 10**8)
        self.assertEqual((target/'sentinel').read_text(), 'keep')

    def altered(self, name, mutate):
        path = self.root / name
        with zipfile.ZipFile(self.archive) as source:
            data = {n:source.read(n) for n in source.namelist()}
        mutate(data)
        with zipfile.ZipFile(path, 'w') as archive:
            for n, content in data.items():
                archive.writestr(n, content)
        return path

    def rejected(self, archive, message, sha=None, limit=10**8):
        target = self.root / ('rejected-' + archive.stem)
        with self.assertRaisesRegex(ValueError, message):
            t.import_bundle(archive, sha or p.digest(archive), target, limit)
        self.assertFalse(target.exists())
        self.assertFalse(target.with_name(target.name+'.import.lock').exists())

    def test_corruption_checksum_and_missing_file(self):
        self.rejected(self.archive, 'Archive checksum', '0'*64)
        def corrupt(data):
            name = next(n for n in data if n.endswith('.cbm'))
            data[name] = b'x' * len(data[name])
        self.rejected(self.altered('corrupt.zip', corrupt), 'File checksum')
        def missing(data):
            del data[next(n for n in data if n.endswith('.cbm'))]
        self.rejected(self.altered('missing.zip', missing), 'Unexpected/missing')

    def test_version_dependency_and_forecast_mismatch(self):
        for field, value, error in [
            ('version', 999, 'Unsupported transfer'),
            ('compatibility', {}, 'version mismatch'),
            ('probes', {}, 'probe identities'),
        ]:
            def mutate(data):
                manifest = json.loads(data['manifest.json'])
                manifest[field] = value
                data['manifest.json'] = json.dumps(manifest).encode()
            self.rejected(self.altered(field+'.zip', mutate), error)

    def test_path_traversal_limits_and_symlinks(self):
        self.rejected(self.altered('traversal.zip', lambda data: data.update({'runtime/../../escaped': b'bad'})), 'Unexpected/missing')
        self.rejected(self.archive, 'size limit', limit=1)
        link = self.source / '.env'
        link.symlink_to(self.archive)
        try:
            with self.assertRaisesRegex(ValueError, 'Symlinks'):
                t.inventory(self.source)
        finally:
            link.unlink()

    def test_incomplete_run_and_private_owner_rejected(self):
        request = next(self.source.glob('*/runs/*/request.json.gz'))
        task = p.read(request)
        result = request.parent / 'result.json'
        saved = result.read_bytes()
        result.unlink()
        try:
            with self.assertRaisesRegex(ValueError, 'Incomplete run'):
                t.validate_runtime(self.source, t.compatibility())
        finally:
            result.write_bytes(saved)
        p.atomic(request, dict(task, _owner='wrong'))
        try:
            with self.assertRaisesRegex(ValueError, 'tenant mismatch'):
                t.validate_runtime(self.source, t.compatibility())
        finally:
            p.atomic(request, task)


if __name__ == '__main__':
    unittest.main()
