#!/usr/bin/env python3
"""Compare extended-feature API policy with the frozen no-external-feature policy.

Different issue times are explicit: this measures the complete policy change,
not the isolated causal contribution of weather, price, or one feature.
"""
import argparse
from collections import Counter
import datetime as dt
import json
import math
from pathlib import Path
import random
import statistics
from compare_states import read_run, metrics, improvement, verify_hybrid_cutoffs


def compare(candidate_root, reference_root):
    cr, candidates = read_run(candidate_root)
    rr, references = read_run(reference_root)
    for key in ('suite_id', 'period_from', 'period_until', 'unit', 'timezone', 'expected_profiles'):
        if cr[key] != rr[key]:
            raise ValueError('Incompatible benchmark: '+key)
    if cr['provenance']['manifest_sha256'] != rr['provenance']['manifest_sha256'] or set(candidates) != set(references):
        raise ValueError('Different benchmark inputs')
    rows = []
    pooled_actual, pooled_ref, pooled_candidate = [], [], []
    blocks = {}
    start = dt.date.fromisoformat(cr['period_from'])
    for series, candidate in candidates.items():
        reference = references[series]
        if candidate['forecast_run'].get('issue_time', '00:00') != cr['configuration'].get('issue_time', '00:00') or reference['forecast_run'].get('issue_time', '00:00') != rr['configuration'].get('issue_time', '00:00'):
            raise ValueError('API ignored configured issue_time')
        cv, rv = candidate['forecast_values'], reference['forecast_values']
        if len(cv) != len(rv):
            raise ValueError('Different interval counts')
        checks = verify_hybrid_cutoffs(candidate, cr['timezone'])
        verify_hybrid_cutoffs(reference, rr['timezone'])
        actual, ref, predicted = [], [], []
        features, interpretations = Counter(), Counter()
        weekly = {}
        for c, r in zip(cv, rv):
            if any(c[k] != r[k] for k in ('timestamp', 'series_id', 'unit', 'actual_value')) or c['actual_value'] is None:
                raise ValueError('Unpaired intervals/actuals')
            # Both runs are audited against D-2 independently. Their external
            # information horizons intentionally differ and remain in the report.
            actual.append(c['actual_value']); ref.append(r['predicted_value']); predicted.append(c['predicted_value'])
            features.update(c.get('selected_predictors', []))
            week = (dt.date.fromisoformat(c['forecast_for']) - start).days // 7
            block = weekly.setdefault(week, {'reference': 0.0, 'candidate': 0.0})
            block['reference'] += (c['actual_value'] - r['predicted_value'])**2
            block['candidate'] += (c['actual_value'] - c['predicted_value'])**2
        for day in candidate['daily_results']:
            interpretations.update(h['pattern'] for h in day.get('feature_interpretation', []))
        cm, rm = metrics(actual, predicted), metrics(actual, ref)
        rows.append({'series_id': series, 'candidate': cm, 'reference': rm,
            'rmse_gain_percent': improvement(rm['rmse'], cm['rmse']), 'mae_gain_percent': improvement(rm['mae'], cm['mae']),
            'feature_used_interval_percent': {k: 100*v/len(cv) for k,v in sorted(features.items())},
            'pattern_days': dict(interpretations), 'cutoff_checks': checks,
            'candidate_issue_time': candidate['forecast_run'].get('issue_time', '00:00'),
            'reference_issue_time': reference['forecast_run'].get('issue_time', '00:00'),
            'warnings': candidate['readiness_dossier']['warnings']})
        blocks[series] = weekly
        pooled_actual.extend(actual); pooled_ref.extend(ref); pooled_candidate.extend(predicted)
    gains = [r['rmse_gain_percent'] for r in rows]
    if any(g is None for g in gains):
        raise ValueError('Relative gain undefined for a perfect reference')
    weeks = sorted(set.intersection(*(set(w) for w in blocks.values())))
    rng = random.Random(73471); draws = []
    for _ in range(1000):
        sample = rng.choices(weeks, k=len(weeks))
        draw = []
        for b in blocks.values():
            r = sum(b[w]['reference'] for w in sample); c = sum(b[w]['candidate'] for w in sample)
            if r: draw.append(100*(1-math.sqrt(c/r)))
        draws.append(statistics.mean(draw))
    draws.sort()
    mae_gain = statistics.mean(r['mae_gain_percent'] for r in rows)
    gates = {'macro_rmse_gain_at_least_2_percent': statistics.mean(gains) >= 2,
        'at_least_6_profile_wins': sum(g > 0 for g in gains) >= 6,
        'no_profile_regression_over_10_percent': min(gains) >= -10,
        'macro_mae_regression_at_most_2_percent': mae_gain >= -2}
    return {'schema_version': '1.0', 'comparison_type': 'policy_change_with_explicit_different_external_knowledge_times',
        'candidate_run': str(candidate_root), 'reference_run': str(reference_root),
        'candidate_configuration': cr['configuration'], 'reference_configuration': rr['configuration'],
        'period_from': cr['period_from'], 'period_until': cr['period_until'], 'series': rows,
        'aggregate': {'reference': metrics(pooled_actual, pooled_ref), 'candidate': metrics(pooled_actual, pooled_candidate)},
        'macro_rmse_gain_percent': statistics.mean(gains), 'macro_mae_gain_percent': mae_gain,
        'profile_wins': sum(g > 0 for g in gains), 'paired_week_bootstrap_95_interval': [draws[24], draws[974]],
        'acceptance_gates': gates, 'acceptance_passed': all(gates.values()),
        'feature_sources': next(iter(candidates.values()))['forecast_run']['feature_sources'],
        'limitations': ['Previously inspected development profiles; no external independent confirmation.',
            'Complete policy comparison: issue times and feature candidates differ; no causal attribution to individual features.',
            'External publication times and historical revisions are partly reconstructed assumptions.',
            'Net-meter patterns do not confirm PV, heat pumps, CHP, or an EMS.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    report = compare(args.candidate, args.reference)
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out/'comparison.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    lines = ['# Wetter, Markt und Jahreszeit: API-Qualitätsvergleich', '',
        'Verglichen wird die gesamte erweiterte Prognosepolitik mit dem bisherigen Modell. '
        'Externe Wissensstände unterscheiden sich; Zählerhistorie bleibt in beiden Fällen D−2.', '',
        '| Profil | Referenz RMSE | Erweitert RMSE | RMSE-Gewinn % | MAE-Gewinn % |',
        '|---|---:|---:|---:|---:|']
    for row in report['series']:
        lines.append(f"| {row['series_id']} | {row['reference']['rmse']:.5f} | {row['candidate']['rmse']:.5f} | {row['rmse_gain_percent']:.2f} | {row['mae_gain_percent']:.2f} |")
    lines += ['', f"Mittlerer relativer RMSE-Gewinn: {report['macro_rmse_gain_percent']:.3f} %; {report['profile_wins']}/{len(report['series'])} Profile besser.",
        f"Gepoolter RMSE: {report['aggregate']['reference']['rmse']:.6f} → {report['aggregate']['candidate']['rmse']:.6f} kWh.",
        f"Mittlerer relativer MAE-Gewinn: {report['macro_mae_gain_percent']:.3f} %.",
        f"Vorab definierte Qualitätsgrenzen bestanden: {report['acceptance_passed']}.", '', '## Tatsächlich verwendete Merkmale', '']
    for row in report['series']:
        lines.append(f"- {row['series_id']}: " + ', '.join(f'{k}: {v:.1f} % der Intervalle' for k,v in row['feature_used_interval_percent'].items()))
    lines += ['', '## Grenzen', ''] + ['- '+note for note in report['limitations']]
    (args.out/'comparison.md').write_text('\n'.join(lines)+'\n')
    print(args.out/'comparison.md')

if __name__ == '__main__':
    main()
