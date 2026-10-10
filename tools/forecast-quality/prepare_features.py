#!/usr/bin/env python3
"""Prepare immutable Kempten weather and German market features through the API."""
import argparse
from pathlib import Path
from run import Transport, save_json

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--history-from', default='2020-01-01')
    parser.add_argument('--history-until', default='2024-12-31')
    parser.add_argument('--forecast-from', default='2024-01-01')
    parser.add_argument('--forecast-until', default='2024-12-31')
    parser.add_argument('--timeout', type=int, default=7200)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    api = Transport(args.base_url, args.out, args.timeout)
    root = '/api/forecast-sandbox/consumption/features/'
    weather = api.call('prepare-weather', root+'weather/prepare', {'location': 'kempten',
        'history_from': args.history_from, 'history_until': args.history_until,
        'forecast_from': args.forecast_from, 'forecast_until': args.forecast_until})
    context = api.call('prepare-context', root+'context/prepare', {'from': args.history_from, 'until': args.history_until})
    candidate = {'model_family': 'learned_states', 'extended_features': True, 'issue_time': '18:00',
        'feature_set': ['history', 'calendar', 'weather', 'context'],
        'weather_dataset_id': weather['weather_dataset_id'], 'context_dataset_id': context['context_dataset_id']}
    save_json(args.out/'candidate.json', candidate)
    save_json(args.out/'provenance.json', {'weather': weather, 'context': context})
    print(args.out/'candidate.json')

if __name__ == '__main__':
    main()
