#!/usr/bin/env python3
"""Paired, independently scored comparison of completed API state/reference runs."""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import statistics
from zoneinfo import ZoneInfo


def read_run(root):
    report = json.loads((root / 'report.json').read_text())
    if report['status'] != 'completed' or report['scope'] != 'full':
        raise ValueError('Only complete full-suite reports may support the hypothesis comparison')
    calls = {r['name']: r for r in json.loads((root / 'http-calls.json').read_text())}
    results = {}
    for row in report['series']:
        name = row['series_id'] + '-auto'
        raw = gzip.decompress((root / (name + '.json.gz')).read_bytes())
        if hashlib.sha256(raw).hexdigest() != calls[name]['response_sha256']:
            raise ValueError('Response hash mismatch')
        results[row['series_id']] = json.loads(raw)['results'][0]
    return report, results


def metrics(actual, predicted):
    errors = [a-p for a, p in zip(actual, predicted)]
    if not errors or not all(math.isfinite(e) for e in errors):
        raise ValueError('Empty or nonfinite comparison')
    return {'n': len(errors), 'mse': statistics.mean(e*e for e in errors),
            'rmse': math.sqrt(statistics.mean(e*e for e in errors)),
            'mae': statistics.mean(abs(e) for e in errors), 'bias': statistics.mean(errors)}


def improvement(reference, candidate):
    return 100*(1-candidate/reference) if reference else None


def verify_hybrid_cutoffs(result, timezone):
    """Independently audit the disclosed outer and inner knowledge cutoffs."""
    zone = ZoneInfo(timezone)
    def midnight(date):
        return dt.datetime.combine(date, dt.time(), zone)
    def instant(value):
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('Naive hybrid knowledge timestamp')
        return parsed
    count = 0
    for value in result['forecast_values']:
        date = dt.date.fromisoformat(value['forecast_for'])
        origin = instant(value['forecast_created_at'])
        issue_time = result.get('forecast_run', {}).get('issue_time', '00:00')
        if issue_time not in ('00:00', '18:00'):
            raise ValueError('Unsupported issue_time')
        if origin != dt.datetime.combine(date-dt.timedelta(days=1), dt.time.fromisoformat(issue_time), zone):
            raise ValueError('Hybrid forecast origin violates D-2')
        if instant(value['training_data_until']) >= midnight(date-dt.timedelta(days=1)):
            raise ValueError('Meter training leaks beyond D-2 cutoff')
        state = value['state_features']
        if instant(state['model_fitted_at']) > origin:
            raise ValueError('State model fitted after forecast origin')
        for known in state['known_lag_states']:
            lag = known['lag_days']
            day = dt.date.fromisoformat(known['date'])
            if lag not in (2, 7) or day != date-dt.timedelta(days=lag):
                raise ValueError('Invalid historical state lag')
            if instant(known['available_at']) > origin or midnight(day+dt.timedelta(days=1)) > origin:
                raise ValueError('State unavailable at forecast origin')
    for selection in result['relationship_analysis']['selections']:
        for fold in selection['validation']['folds']:
            fold_origin = midnight(dt.date.fromisoformat(fold['from'])-dt.timedelta(days=1))
            if instant(fold['state_training_until']) >= fold_origin:
                raise ValueError('State training leaks into inner validation')
            for fitted in fold['reference_fits']:
                origin = midnight(dt.date.fromisoformat(fitted['forecast_for'])-dt.timedelta(days=1))
                if instant(fitted['training_data_until']) >= origin:
                    raise ValueError('Reference training leaks into inner validation')
                count += 1
    return {'outer_forecasts_checked': len(result['forecast_values']), 'inner_reference_fits_checked': count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    cr, candidates = read_run(args.candidate)
    rr, references = read_run(args.reference)
    for key in ('suite_id', 'period_from', 'period_until', 'unit', 'timezone', 'expected_profiles'):
        if cr[key] != rr[key]:
            raise ValueError('Incompatible reports: '+key)
    if cr['provenance']['manifest_sha256'] != rr['provenance']['manifest_sha256'] or set(candidates) != set(references):
        raise ValueError('Different benchmark inputs')
    rows = []; blocks = {}; pooled_actual = []; pooled = {k: [] for k in ('reference', 'selected', 'without_states', 'raw_candidate')}
    start = dt.date.fromisoformat(cr['period_from'])
    causality_checks = {}
    for series, candidate in candidates.items():
        cv = candidate['forecast_values']; rv = references[series]['forecast_values']
        if candidate.get('forecast_run', {}).get('model_version') in ('relationship_state_correction_v2', 'relationship_state_context_v3', 'relationship_state_context_guard_v4'):
            causality_checks[series] = verify_hybrid_cutoffs(candidate, cr['timezone'])
        if len(cv) != len(rv):
            raise ValueError('Unpaired intervals')
        actual = []; values = {k: [] for k in pooled}; enabled = 0; weekly = {}
        for c, r in zip(cv, rv):
            if any(c[k] != r[k] for k in ('timestamp', 'actual_value', 'series_id', 'unit', 'forecast_created_at')):
                raise ValueError('Unpaired actuals/origins')
            if c['actual_value'] is None:
                raise ValueError('Missing actuals')
            state = c['state_features']; a = c['actual_value']
            p = {'reference': r['predicted_value'], 'selected': c['predicted_value'],
                 'without_states': state['without_state_prediction'], 'raw_candidate': state['candidate_prediction']}
            if abs(c['predicted_value'] - (p['raw_candidate'] if state['enabled'] else p['without_states'])) > 1e-10:
                raise ValueError('State gate/output mismatch')
            if abs(sum(state['probabilities'])-1) > 1e-10 or not all(0 <= v <= 1 for v in state['probabilities']):
                raise ValueError('Invalid state probabilities')
            enabled += bool(state['enabled']); actual.append(a)
            for key, value in p.items(): values[key].append(value)
            week = (dt.date.fromisoformat(c['forecast_for'])-start).days//7
            b = weekly.setdefault(week, {'n': 0, 'reference': 0, 'selected': 0, 'without_states': 0})
            b['n'] += 1
            for k in ('reference', 'selected', 'without_states'): b[k] += (a-p[k])**2
        scores = {k: metrics(actual, v) for k, v in values.items()}
        rows.append({'series_id': series, 'metrics': scores, 'state_enabled_fraction': enabled/len(cv),
                     'gain_vs_reference_percent': improvement(scores['reference']['rmse'], scores['selected']['rmse']),
                     'gain_vs_without_states_percent': improvement(scores['without_states']['rmse'], scores['selected']['rmse']),
                     'mae_gain_vs_reference_percent': improvement(scores['reference']['mae'], scores['selected']['mae']),
                     'reference_reproduction_max_abs_difference': max(abs(a-b) for a,b in zip(values['reference'], values['without_states'])),
                     'artifact': candidate.get('state_model_artifact')})
        blocks[series] = weekly; pooled_actual.extend(actual)
        for key in pooled: pooled[key].extend(values[key])
    aggregate = {k: metrics(pooled_actual, v) for k, v in pooled.items()}
    gains = [r['gain_vs_reference_percent'] for r in rows]
    mae_gains = [r['mae_gain_vs_reference_percent'] for r in rows]
    if any(g is None for g in gains+mae_gains):
        raise ValueError('Relative acceptance gates undefined for a perfect reference')
    # Synchronously resample seven-day blocks across meters, preserving same-week co-movement.
    weeks = sorted(set.intersection(*(set(b) for b in blocks.values())))
    rng = random.Random(73471); draws = []; ablation_draws = []
    for _ in range(1000):
        selected = rng.choices(weeks, k=len(weeks)); per_series = []; per_ablation = []
        for b in blocks.values():
            ref = sum(b[w]['reference'] for w in selected); cand = sum(b[w]['selected'] for w in selected)
            if ref: per_series.append(100*(1-math.sqrt(cand/ref)))
            no_state = sum(b[w]['without_states'] for w in selected)
            if no_state: per_ablation.append(100*(1-math.sqrt(cand/no_state)))
        draws.append(statistics.mean(per_series))
        ablation_draws.append(statistics.mean(per_ablation))
    draws.sort(); ablation_draws.sort()
    gates = {'macro_rmse_gain_at_least_2_percent': statistics.mean(gains) >= 2,
             'at_least_6_profile_wins': sum(g>0 for g in gains) >= 6,
             'no_profile_regression_over_10_percent': min(gains) >= -10,
             'macro_mae_regression_at_most_2_percent': statistics.mean(mae_gains) >= -2}
    report = {'schema_version': '1.0', 'candidate': str(args.candidate), 'reference': str(args.reference),
              'candidate_execution': cr['execution'], 'reference_execution': rr['execution'],
              'period_from': cr['period_from'], 'period_until': cr['period_until'], 'series': rows,
              'aggregate': aggregate, 'macro_rmse_gain_percent': statistics.mean(gains),
              'macro_state_ablation_gain_percent': statistics.mean(r['gain_vs_without_states_percent'] for r in rows if r['gain_vs_without_states_percent'] is not None),
              'macro_mae_gain_percent': statistics.mean(mae_gains), 'profile_wins': sum(g>0 for g in gains),
              'paired_week_block_bootstrap_95_interval': [draws[24], draws[974]],
              'state_ablation_bootstrap_95_interval': [ablation_draws[24], ablation_draws[974]],
              'state_ablation_profile_wins': sum((r['gain_vs_without_states_percent'] or 0)>0 for r in rows),
              'bootstrap_limitation': 'Approximate conditional uncertainty on previously inspected profiles; not independent external confirmation.',
              'causality_checks': causality_checks, 'acceptance_gates': gates, 'acceptance_passed': all(gates.values()),
              'evidence_scope': 'development_only_previously_inspected_profiles', 'automatic_default_promotion': False}
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out/'comparison.json').write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    lines = ['# Zustandsmerkmale: gepaarter API-Vergleich', '',
             f"Zeitraum {cr['period_from']} bis {cr['period_until']}; {len(rows)} Profile. Beide Ausführungsarten: {cr['execution']} / {rr['execution']}.", '',
             '| Profil | bisher RMSE | Zustand RMSE | ohne Zustand RMSE | Gewinn ggü. bisher % | Zustände aktiv % |',
             '|---|---:|---:|---:|---:|---:|']
    for r in rows:
        m=r['metrics']; lines.append(f"| {r['series_id']} | {m['reference']['rmse']:.4f} | {m['selected']['rmse']:.4f} | {m['without_states']['rmse']:.4f} | {r['gain_vs_reference_percent']:.2f} | {100*r['state_enabled_fraction']:.1f} |")
    lines += ['', f"Gepoolter RMSE: {aggregate['reference']['rmse']:.6f} → {aggregate['selected']['rmse']:.6f} kWh.",
              f"Mittlere relative RMSE-Verbesserung je Profil: {report['macro_rmse_gain_percent']:.3f} %; {report['profile_wins']}/{len(rows)} Profile besser.",
              f"Isolierter Zustandsnutzen gegenüber eigener Referenz: {report['macro_state_ablation_gain_percent']:.3f} % mittlere relative RMSE-Verbesserung.",
              f"Isolierter Zustandsnutzen: {report['state_ablation_profile_wins']}/{len(rows)} Profile besser; 95%-Wochenbootstrap-Intervall {report['state_ablation_bootstrap_95_interval']} %.",
              f"Mittlere relative MAE-Verbesserung: {report['macro_mae_gain_percent']:.3f} %.",
              f"95%-Intervall der mittleren relativen RMSE-Verbesserung (gepaarte Wochenblöcke): {report['paired_week_block_bootstrap_95_interval']} %.",
              f"Vorab festgelegte Akzeptanzhürden bestanden: {report['acceptance_passed']}.", '',
              'Bekannte Entwicklungsdaten; keine unabhängige externe Bestätigung. Keine automatische Standardumstellung.',
              'Der Vergleich ohne Zustände verwendet die in der Antwort ausgewiesene Basisprognose derselben Modellversion. Rohkandidatenwerte sind diagnostisch und wurden nicht zur nachträglichen Auswahl genutzt.',
              'Bei v1 ist die Basis ein Kalenderprofil; bei relationship_state_correction_v2 ist sie die automatische Saison-/Aktualitätsauswahl.']
    (args.out/'comparison.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(args.out/'comparison.md')


if __name__ == '__main__':
    main()
