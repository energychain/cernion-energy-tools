"""Past-only local states: observed zero, positive base load, active load.

States are trained per meter/fold. They are neither future labels used as features
nor hard-coded meter-specific operating schedules.
"""
import math
import numpy as np
from catboost import CatBoostClassifier

NAMES = ('zero', 'base', 'active')
FEATURE_NAMES = ['week7_neighborhood_median', 'week7_neighborhood_active_fraction',
    'week14_neighborhood_median', 'week14_neighborhood_active_fraction',
    'four_week_zero_fraction', 'four_week_active_fraction', 'four_week_std',
    'last_profile_zero_fraction', 'last_profile_active_fraction',
    'last_profile_q10', 'last_profile_q50', 'last_profile_q90']


def labels(values, threshold):
    a = np.asarray(values)
    return np.where(a == 0, 0, np.where(a <= threshold, 1, 2))


def features(series, stamp, context, scale, threshold, base, scenario='none'):
    local = stamp.astimezone(series.zone)
    slot = local.hour*4 + local.minute//15
    lag = lambda days, quarter: series.lag(local.date(), quarter, days, context['issue'], scenario)
    same_slot = [lag(days,slot) for days in (7,14,21,28)]
    known = [v for v in same_slot if math.isfinite(v)]
    result = list(base)
    for days in (7,14):
        neighborhood = [lag(days,q) for q in range(max(0,slot-4),min(96,slot+5))]
        values = [v for v in neighborhood if math.isfinite(v)]
        result += [float(np.median(values))/scale if values else float('nan'),
                   float(np.mean(np.asarray(values)>threshold)) if values else float('nan')]
    result += [float(np.mean(np.asarray(known)==0)) if known else float('nan'),
               float(np.mean(np.asarray(known)>threshold)) if known else float('nan'),
               float(np.std(known))/scale if known else float('nan')]
    # The complete profile has already passed Series.known and revision filtering.
    if 'regime_profile' not in context:
        history = [r[1] for r in context['full'][1]] if context['full'] else []
        context['regime_profile'] = ([float(np.mean(np.asarray(history)==0)),
            float(np.mean(np.asarray(history)>threshold)),
            *[float(v)/scale for v in np.quantile(history,[.1,.5,.9])]] if history else [float('nan')]*5)
    return result + context['regime_profile']


def fit(x, values, threshold, policy, fit_amount):
    states = labels(values,threshold)
    unique = np.unique(states)
    if len(unique)==1:
        classifier = float(unique[0])
    else:
        classifier = CatBoostClassifier(loss_function='MultiClass',iterations=policy['iterations'],
            depth=policy['depth'],learning_rate=policy['learning_rate'],random_seed=policy['random_seed'],
            thread_count=1,verbose=False,allow_writing_files=False,has_time=True,
            cat_features=[0],one_hot_max_size=32)
        classifier.fit(x,states)
    amounts = {0:0.0}
    for state in (1,2):
        indices = np.flatnonzero(states==state)
        amounts[state] = fit_amount([x[i] for i in indices],[values[i] for i in indices],
                                   [1.0]*len(indices),loss='MAE')
    count = len(values)
    metadata = dict(states=list(NAMES),threshold=float(threshold),
        training_counts={name:int(np.sum(states==i)) for i,name in enumerate(NAMES)},
        training_probabilities=[float(np.sum(states==i))/count for i in range(3)])
    return classifier,amounts,metadata


def probabilities(model, x):
    result = np.zeros((len(x),3))
    if isinstance(model,float):
        result[:,int(model)]=1
    else:
        raw = model.predict_proba(x)
        for column,state in enumerate(model.classes_):result[:,int(state)]=raw[:,column]
    return result


def describe(actual, predicted, thresholds, probabilities=None, training_prior=None):
    actual,predicted=np.asarray(actual),np.asarray(predicted)
    thresholds=np.asarray(thresholds)
    truth=labels(actual,thresholds)
    inferred=labels(predicted,thresholds)
    absolute=np.abs(actual-predicted)
    total=float(np.abs(actual).sum())
    zero_error=total
    error=float(absolute.sum())
    result=dict(zero_reference_mae=zero_error/len(actual),
        mae_skill_vs_zero=1-error/zero_error if zero_error else None,
        predicted_energy_ratio=float(predicted.sum())/total if total else None,
        state_metrics={name:dict(count=int(np.sum(truth==i)),
            mae=float(absolute[truth==i].mean()) if np.any(truth==i) else None,
            actual_energy=float(actual[truth==i].sum()),predicted_energy=float(predicted[truth==i].sum()))
            for i,name in enumerate(NAMES)},
        forecast_state_confusion=[[int(np.sum((truth==i)&(inferred==j))) for j in range(3)] for i in range(3)])
    # Report the classifier independently of the chosen quantity expert.
    if probabilities is not None:
        probs=np.asarray(probabilities); decisions=probs.argmax(axis=1)
        result['classifier_confusion']=[[int(np.sum((truth==i)&(decisions==j))) for j in range(3)] for i in range(3)]
        one_hot=np.eye(3)[truth]
        result['classifier_brier']=float(np.mean(np.sum((probs-one_hot)**2,axis=1)))
        if training_prior is not None:
            result['training_prior_brier']=float(np.mean(np.sum((np.asarray(training_prior)-one_hot)**2,axis=1)))
    result['warnings']=[]
    if total and result['predicted_energy_ratio']<.1:
        result['warnings'].append('severe_energy_underprediction')
    if total and result['mae_skill_vs_zero']<=0:
        result['warnings'].append('no_mae_skill_over_zero_reference')
    return result
