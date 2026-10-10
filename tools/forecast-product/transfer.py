#!/usr/bin/env python3
"""Offline, versioned, non-overwriting forecast runtime transfer (trusted operator only)."""
import argparse
import datetime as dt
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import zipfile

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'tools/forecast-portfolio'))
import persistence as p

FORMAT = 'cet-forecast-transfer'
VERSION = 1
HEX = r'[a-f0-9]{64}'
SOURCES = ['engine.py', 'persistence.py', 'runtime.py', 'contracts.py', 'regimes.py', 'product.py', 'starter.py']


def require(ok, message):
    if not ok:
        raise ValueError(message)


def compatibility():
    return dict(engine_sha256=hashlib.sha256(b''.join(
        (REPO / 'tools/forecast-portfolio' / name).read_bytes() for name in SOURCES)).hexdigest(),
        orchestration_sha256=hashlib.sha256(b''.join((REPO / name).read_bytes() for name in (
            'src/forecast-portfolio-runtime.js', 'src/forecast-product.js',
            'src/forecast-portfolio-contract.js', 'src/forecast-starter.js',
            'services/forecast-sandbox.service.js'))).hexdigest(),
        dependencies={name: importlib.metadata.version(name)
                      for name in ('catboost', 'numpy', 'scikit-learn', 'skops')})


def allowed(name):
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in name,
            'Unsafe archive path')
    patterns = [
        rf'{HEX}/history/{HEX}/(?:current.json|{HEX}\.json\.gz)',
        rf'{HEX}/runs/{HEX}/(?:request.json.gz|result.json|model.json|identity.json|[a-zA-Z0-9_-]+\.(?:cbm|skops))',
        rf'_shared-baseline/(?:latest.json|contributors/{HEX}\.json|snapshots/{HEX}\.json\.gz)',
        rf'_shared-baseline/models/{HEX}/(?:manifest.json|[a-zA-Z0-9_-]+\.cbm)',
        rf'_starter-baseline/(?:current.json|versions/{HEX}/(?:bundle.json|trust.pem|manifest.json|starter.cbm))',
    ]
    require(any(re.fullmatch(pattern, name) for pattern in patterns),
            'Unexpected runtime file: ' + name)
    return name


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'Runtime directory required')
    entries = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Symlinks are not supported')
        if path.is_dir():
            continue
        require(path.is_file(), 'Non-regular runtime file')
        if path.name == '.lock':
            # flock files persist when idle; never transport operating-system locks.
            import fcntl
            with path.open('rb') as f:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            continue
        name = allowed(path.relative_to(root).as_posix())
        entries[name] = dict(size=path.stat().st_size, sha256=p.digest(path))
    require(entries, 'Empty runtime')
    return entries


def validate_runtime(root, comp):
    if (root / '_starter-baseline/current.json').exists():
        import subprocess
        subprocess.run(['node', '-e',
                        "require('./src/forecast-starter').candidate()"],
                       cwd=REPO, env={**os.environ, 'FORECAST_PORTFOLIO_RUNTIME_PATH': str(root.resolve())},
                       check=True, capture_output=True, timeout=30)
        public = root / '_starter-baseline'
        directory = public / 'versions' / p.read(public / 'current.json')['version']
        m = p.read(directory / 'manifest.json')
        for name, version in m['dependencies'].items():
            require(comp['dependencies'].get(name) == version, 'Starter dependency mismatch')
        import product
        product.load_model(directory, m['model'])
    models = []
    for request in sorted(root.glob('*/runs/*/request.json.gz')):
        task = p.read(request)
        require((request.parent / 'result.json').is_file(), 'Incomplete run; finish or isolate it before export')
        require(task.get('_source') == comp['engine_sha256'], 'Run code version mismatch')
        require(task.get('_operation') in ('train', 'predict'), 'Unsupported run operation')
        if task.get('_product'):
            require(task.get('_owner') == request.parents[2].name, 'Run tenant mismatch')
        if task['_operation'] == 'train':
            require((request.parent / 'model.json').is_file(), 'Missing trained model')
    for manifest in sorted(root.glob('*/runs/*/model.json')) + sorted(root.glob('_shared-baseline/models/*/manifest.json')):
        m = p.read(manifest)
        require(m.get('schema', 1) == 1, 'Unsupported model schema')
        require(m.get('engine_sha256') == comp['engine_sha256'], 'Model code version mismatch')
        deps = m.get('dependencies') or {k: m[k] for k in ('catboost', 'numpy', 'sklearn', 'skops')}
        for name, version in deps.items():
            require(comp['dependencies'].get('scikit-learn' if name == 'sklearn' else name) == version,
                    'Model dependency mismatch: ' + name)
        for entry in m['models'].values():
            if 'file' in entry:
                require(Path(entry['file']).name == entry['file'], 'Unsafe model path')
                require(p.digest(manifest.parent / entry['file']) == entry['sha256'], 'Native model checksum mismatch')
        if manifest.name == 'model.json':
            require((manifest.parent / 'request.json.gz').is_file(), 'Missing model request')
            if 'owner' in m:
                require(m['owner'] == manifest.parents[2].name, 'Model tenant mismatch')
            models.append(manifest)
        # Load EVERY artifact, including unselected fallback models, before activation.
        if 'dependencies' in m:
            import product
            for entry in m['models'].values():
                product.load_model(manifest.parent, entry)
        else:
            import runtime
            runtime.load_fit(manifest.parent)
    require(models or (root / '_starter-baseline/current.json').exists(), 'No completed models to transfer')
    for current in root.glob('*/history/*/current.json'):
        version = p.read(current)['version']
        require(re.fullmatch(HEX, version), 'Invalid history version')
        require((current.parent / (version + '.json.gz')).is_file(), 'Missing current history')
    for manifest in models:
        m = p.read(manifest)
        for sid, version in m['history_versions'].items():
            require(re.fullmatch(HEX, version), 'Invalid model history version')
            history = manifest.parents[2] / 'history' / hashlib.sha256(sid.encode()).hexdigest() / (version + '.json.gz')
            require(history.is_file(), 'Missing model training history')
            require(p.read(history)['series_id'] == sid, 'History series mismatch')
    shared = root / '_shared-baseline'
    for pointer in shared.glob('contributors/*.json'):
        version = p.read(pointer)['version']
        require(re.fullmatch(HEX, version), 'Invalid reference version')
        require((shared / 'snapshots' / (version + '.json.gz')).is_file(), 'Missing reference history')
    if (shared / 'latest.json').exists():
        version = p.read(shared / 'latest.json')['version']
        require(re.fullmatch(HEX, version), 'Invalid baseline version')
        require((shared / 'models' / version / 'manifest.json').is_file(), 'Missing latest baseline')
    return models


def probes(root, models):
    """One historical inference per meter/model; no training or publication."""
    import product
    import runtime
    result = {}
    for manifest in models:
        model = p.read(manifest)
        task = p.read(manifest.parent / 'request.json.gz')
        for series in task['series']:
            sid = series['series_id']
            payload = dict(task, _artifact_dir=str(manifest.parent), series=[series],
                           model_version=manifest.parent.name, forecast_for=model['first_day'])
            output = (product.forecast if task.get('_product') else runtime.forecast)(payload)
            key = manifest.parent.relative_to(root).as_posix() + '/' + hashlib.sha256(sid.encode()).hexdigest()
            result[key] = output['forecast_values']
    return result


def compare_probes(expected, actual):
    require(expected.keys() == actual.keys(), 'Forecast probe identities mismatch')
    for key, values in expected.items():
        other = actual[key]
        require(len(values) == len(other), 'Forecast probe length mismatch')
        require(all(a['timestamp'] == b['timestamp'] and
                    math.isclose(a['predicted_value'], b['predicted_value'], rel_tol=1e-10, abs_tol=1e-10)
                    for a, b in zip(values, other)), 'Forecast comparison failed: ' + key)


def export_bundle(root, output):
    require(not output.exists(), 'Archive already exists')
    require(root.resolve() not in output.resolve().parents, 'Archive must be outside runtime')
    comp = compatibility()
    before = inventory(root)
    models = validate_runtime(root, comp)
    manifest = dict(format=FORMAT, version=VERSION,
                    created_at=dt.datetime.now(dt.timezone.utc).isoformat(),
                    compatibility=comp, files=before, probes=probes(root, models))
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.forecast-export-', dir=output.parent)
    os.close(fd)
    try:
        with zipfile.ZipFile(temp, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            archive.writestr('manifest.json', json.dumps(manifest, allow_nan=False))
            for name in before:
                archive.write(root / name, 'runtime/' + name)
        require(inventory(root) == before, 'Runtime changed during export; stop writers and retry')
        # Re-read archived bytes too: a mutable source must never produce a false manifest.
        with zipfile.ZipFile(temp) as archive:
            for name, info in before.items():
                with archive.open('runtime/' + name) as stream:
                    require(hashlib.file_digest(stream, 'sha256').hexdigest() == info['sha256'], 'Snapshot changed')
        with open(temp, 'rb') as stream:
            os.fsync(stream.fileno())
        os.link(temp, output)  # exclusive publication; never replace an existing archive
        return dict(status='exported', archive=str(output), sha256=p.digest(output),
                    files=len(before), forecast_probes=len(manifest['probes']))
    finally:
        Path(temp).unlink(missing_ok=True)


def unpack_check(archive_path, expected_sha, stage, max_bytes):
    require(re.fullmatch(HEX, expected_sha or ''), 'Explicit archive SHA-256 required')
    require(p.digest(archive_path) == expected_sha, 'Archive checksum mismatch')
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate archive entries')
        require(archive.getinfo('manifest.json').file_size <= 64 * 1024 * 1024, 'Manifest too large')
        manifest = json.loads(archive.read('manifest.json'))
        require(manifest.get('format') == FORMAT and manifest.get('version') == VERSION, 'Unsupported transfer format/version')
        require(manifest['compatibility'] == compatibility(), 'Target code/dependency version mismatch')
        require(set(names) == {'manifest.json'} | {'runtime/' + allowed(n) for n in manifest['files']}, 'Unexpected/missing archive entries')
        require(sum(v.file_size for v in archive.infolist()) <= max_bytes, 'Archive exceeds uncompressed size limit')
        for name, info in manifest['files'].items():
            member = archive.getinfo('runtime/' + name)
            require(member.file_size == info['size'], 'Archive size mismatch')
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with archive.open(member) as source, target.open('xb') as dest:
                os.chmod(target, 0o600)
                shutil.copyfileobj(source, dest)
                dest.flush()
                os.fsync(dest.fileno())
            require(p.digest(target) == info['sha256'], 'File checksum mismatch')
    models = validate_runtime(stage, manifest['compatibility'])
    compare_probes(manifest['probes'], probes(stage, models))
    return dict(status='verified', format_version=VERSION, files=len(manifest['files']),
                forecast_probes=len(manifest['probes']), sha256=expected_sha)


def publish_directory(stage, target):
    """Linux atomic RENAME_NOREPLACE, including non-cooperating target creators."""
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    require(hasattr(libc, 'renameat2'), 'Atomic import requires Linux renameat2')
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(stage), -100, os.fsencode(target), 1) != 0:
        errno = ctypes.get_errno()
        raise OSError(errno, os.strerror(errno))


def import_bundle(archive, sha, target, max_bytes, verify_only=False):
    require(not target.exists() and not target.is_symlink(), 'Target must not exist; merging/overwriting is unsupported')
    target.parent.mkdir(parents=True, exist_ok=True)
    # A reservation protects simultaneous imports; service must be stopped separately.
    lock = target.with_name(target.name + '.import.lock')
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with tempfile.TemporaryDirectory(prefix='.forecast-import-', dir=target.parent) as temp:
            stage = Path(temp) / 'runtime'
            stage.mkdir(mode=0o700)
            result = unpack_check(archive, sha, stage, max_bytes)
            if not verify_only:
                require(not target.exists(), 'Target appeared during import')
                publish_directory(stage, target)
                fd = os.open(target.parent, os.O_RDONLY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
                result.update(status='imported', runtime=str(target))
            return result
    finally:
        lock.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    export = sub.add_parser('export')
    export.add_argument('--runtime', required=True, type=Path)
    export.add_argument('--archive', required=True, type=Path)
    export.add_argument('--service-stopped', required=True, action='store_true')
    for command in ('verify', 'import'):
        child = sub.add_parser(command)
        child.add_argument('--archive', required=True, type=Path)
        child.add_argument('--sha256', required=True)
        child.add_argument('--runtime', required=True, type=Path, help='New, absent target directory (also for verify staging)')
        child.add_argument('--max-bytes', type=int, default=100 * 1024**3)
        if command == 'import':
            child.add_argument('--service-stopped', required=True, action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.command == 'export':
            result = export_bundle(args.runtime, args.archive)
        else:
            result = import_bundle(args.archive, args.sha256, args.runtime, args.max_bytes, args.command == 'verify')
        print(json.dumps(result, indent=2))
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as exc:
        parser.exit(1, 'Transfer failed: ' + str(exc) + '\n')


if __name__ == '__main__':
    main()
