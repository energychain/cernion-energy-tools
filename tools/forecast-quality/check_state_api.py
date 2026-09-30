#!/usr/bin/env python3
"""Verify persistent state-model API using an existing live benchmark's real input."""
import argparse
import gzip
import json
from pathlib import Path
from run import Transport, save_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    transport = Transport(args.base_url, args.out, 900)
    result = json.loads(gzip.decompress((args.run/'meter-1-auto.json.gz').read_bytes()))['results'][0]
    artifact = result['state_model_artifact']
    day = result['forecast_run']['forecast_period_until']
    root = '/api/forecast-sandbox/consumption/state-model/'
    identity = {'series_id': artifact['series_id'], 'artifact_version': artifact['artifact_version']}
    inspection = transport.call('inspect', root+'inspect', identity)
    prediction = transport.call('predict', root+'predict', {**identity, 'forecast_for': day})
    expected = [v for v in result['forecast_values'] if v['forecast_for'] == day]
    if [(v['timestamp'], v['predicted_value']) for v in expected] != [(v['timestamp'], v['predicted_value']) for v in prediction['forecast_values']]:
        raise ValueError('Reloaded artifact does not reproduce final evaluation day')
    payload = json.loads(gzip.decompress((args.run/'meter-1-auto.request.json.gz').read_bytes()))
    trained = transport.call('train', root+'train', {'dataset': payload['datasets'][0], 'forecast_for': '2025-01-02'})
    fresh = transport.call('predict-trained', root+'predict', {'series_id': trained['series_id'], 'artifact_version': trained['artifact_version'], 'forecast_for': '2025-01-02'})
    if len(fresh['forecast_values']) != 96 or not all(v['training_data_until'] < '2025-01-01T00:00:00Z' for v in fresh['forecast_values']):
        raise ValueError('Persistent train/predict interval or D-2 contract failed')
    save_json(args.out/'verification.json', {'status': 'passed', 'transport': 'live_http',
        'checks': ['inspect persisted evaluation artifact', 'exact forecast parity after HTTP model reload', 'explicit train using real XLS input', 'predict frozen trained artifact with D-2 cutoff'],
        'replayed_artifact': artifact, 'trained_artifact_version': trained['artifact_version'],
        'state_features_enabled': inspection['state_features_enabled']})
    print(args.out/'verification.json')


if __name__ == '__main__':
    main()
