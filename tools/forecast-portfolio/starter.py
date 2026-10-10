"""Public core-only model contract. Never exports histories or tenant artifacts."""
import base64
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import tempfile

CONTRACT = 'cet-starter-core-v1'
FORMAT = 'cet-public-forecast-starter'


def check(ok, message):
    if not ok:
        raise ValueError(message)


def export_payload(directory, release, license_id):
    import engine as e
    import product
    import persistence as p
    directory = Path(directory)
    m = p.read(directory / 'model.json')
    check(m.get('strategy') == 'shared_baseline', 'Export requires a product shared_baseline model')
    check(m['engine_sha256'] == e.SOURCE_SHA256, 'Retrain with current engine before public export')
    identities = list(m['identities'].values())
    check(all(v == identities[0] for v in identities), 'Mixed model identity')
    model = product.load_model(directory, m['models']['baseline'])
    if isinstance(model, float):
        artifact = dict(constant=model)
    else:
        # Rebuild from tree representation without CatBoost training metadata.
        # Only the core model is exportable: profile labels/reactive data are excluded.
        with tempfile.TemporaryDirectory() as temp:
            raw = Path(temp) / 'model.json'
            model.save_model(str(raw), format='json')
            trees = json.loads(raw.read_text())
            trees['model_info'] = {}
            raw.write_text(json.dumps(trees))
            from catboost import CatBoostRegressor
            clean = CatBoostRegressor()
            clean.load_model(str(raw), format='json')
            # Synthetic parity check includes the categorical 'unknown' core feature.
            rows = [['unknown'] + [float(i % 3) for i in range(len(product.FEATURES)-1)]
                    for _ in range(2)]
            import numpy as np
            check(np.allclose(model.predict(rows), clean.predict(rows), rtol=1e-12, atol=1e-12), 'Sanitized model changed predictions')
            binary = Path(temp) / 'starter.cbm'
            clean.save_model(str(binary))
            data = binary.read_bytes()
        artifact = dict(sha256=hashlib.sha256(data).hexdigest(), data=base64.b64encode(data).decode())
    normalized = [v['mae']['baseline'] / m['scales'][sid] for sid, v in m['evidence'].items()]
    return dict(format=FORMAT, schema=1, contract=CONTRACT, release=release, license=license_id,
                engine_sha256=e.SOURCE_SHA256, dependencies=m['dependencies'],
                features=product.FEATURES, **identities[0],
                training_information_as_of=m['information_as_of'],
                quality=dict(normalized_validation_mae=float(sum(normalized)/len(normalized)),
                             claim='training_procedure_validation_only_not_external_benchmark'),
                model=artifact)


def validate_payload(payload, directory):
    import engine as e
    import product
    import persistence as p
    import numpy as np
    check(payload['format'] == FORMAT and payload['schema'] == 1 and payload['contract'] == CONTRACT,
          'Unsupported public model format')
    check(payload['engine_sha256'] == e.SOURCE_SHA256, 'Public model engine mismatch')
    check(payload['dependencies'] == dict(catboost=e.CATBOOST_VERSION, numpy=np.__version__), 'Public model dependency mismatch')
    check(payload['features'] == product.FEATURES, 'Public model feature mismatch')
    check(payload['unit'] in ('kWh', 'kW'), 'Invalid public model unit')
    from zoneinfo import ZoneInfo
    ZoneInfo(payload['timezone'])
    origin = dt.datetime.fromisoformat(payload['training_information_as_of'].replace('Z', '+00:00'))
    check(origin.tzinfo is not None, 'Public training origin requires timezone')
    directory = Path(directory)
    entry = payload['model']
    if 'constant' in entry:
        check(isinstance(entry['constant'], (int, float)) and math.isfinite(entry['constant']), 'Invalid constant')
        stored = dict(constant=float(entry['constant']))
    else:
        data = base64.b64decode(entry['data'], validate=True)
        check(hashlib.sha256(data).hexdigest() == entry['sha256'], 'Public model checksum mismatch')
        file = directory / 'starter.cbm'
        file.write_bytes(data)
        file.chmod(0o600)
        stored = dict(file='starter.cbm', sha256=entry['sha256'])
        product.load_model(directory, stored)
    manifest = {**payload, 'model':stored}
    p.atomic(directory / 'manifest.json', manifest)
    return manifest


def candidate(payload, meters, cutoff):
    import product
    import persistence as p
    ref = payload.get('_starter')
    if not ref:
        return None, 'not_installed'
    directory = Path(ref['directory'])
    m = p.read(directory / 'manifest.json')
    check(p.digest(directory / 'manifest.json') == ref['manifest_sha256'], 'Pinned starter changed')
    check(m['contract'] == CONTRACT and m['features'] == product.FEATURES, 'Starter feature mismatch')
    import engine as e
    import numpy as np
    check(m['engine_sha256'] == e.SOURCE_SHA256 and m['dependencies'] == dict(catboost=e.CATBOOST_VERSION,numpy=np.__version__), 'Starter compatibility mismatch')
    if any(m['unit'] != meter.s.unit or m['timezone'] != str(meter.s.zone) for meter in meters):
        return None, 'incompatible_unit_or_timezone'
    origin = dt.datetime.fromisoformat(m['training_information_as_of'].replace('Z', '+00:00'))
    if origin > cutoff:
        return None, 'trained_after_validation_origin'
    return product.load_model(directory, m['model']), 'eligible'


def main():
    import argparse
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    export = sub.add_parser('export')
    export.add_argument('--model-dir', required=True)
    export.add_argument('--release', required=True)
    export.add_argument('--license', required=True)
    validate = sub.add_parser('validate')
    validate.add_argument('--payload', required=True)
    validate.add_argument('--directory', required=True)
    args = parser.parse_args()
    if args.command == 'export':
        print(json.dumps(export_payload(args.model_dir, args.release, args.license), allow_nan=False))
    else:
        validate_payload(json.loads(Path(args.payload).read_text()), args.directory)
        print(json.dumps(dict(status='validated')))


if __name__ == '__main__':
    main()
