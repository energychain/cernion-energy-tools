"""Atomic files and exclusive run locks. No pickle or executable model metadata."""
import contextlib
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import uuid


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read(path):
    path = Path(path)
    with (gzip.open(path, 'rt') if path.suffix == '.gz' else path.open()) as f:
        return json.load(f)


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('wb') as raw:
            os.chmod(temp, 0o600)
            if path.suffix == '.gz':
                import io
                with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as gz:
                    with io.TextIOWrapper(gz, encoding='utf-8') as f:
                        json.dump(value, f, allow_nan=False, separators=(',', ':'))
            else:
                raw.write(json.dumps(value, allow_nan=False, separators=(',', ':')).encode())
            raw.flush()
            os.fsync(raw.fileno())
        os.replace(temp, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temp.unlink(missing_ok=True)


@contextlib.contextmanager
def locked(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / '.lock').open('a') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def load_block(directory, day):
    manifest = Path(directory) / 'blocks' / (str(day) + '.json')
    if not manifest.exists():
        return None
    info = read(manifest)
    path = manifest.with_suffix('.json.gz')
    if digest(path) != info['sha256']:
        raise ValueError('Checkpoint checksum mismatch; refusing mixed resume')
    return path


def save_block(directory, day, value):
    manifest = Path(directory) / 'blocks' / (str(day) + '.json')
    path = manifest.with_suffix('.json.gz')
    atomic(path, value)
    atomic(manifest, dict(sha256=digest(path)))
