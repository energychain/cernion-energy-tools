'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLASSIFIER_LABELS = Object.freeze([
  'AUTO_EXECUTE',
  'SCOPE_COVERED',
  'INFORM_ONLY',
  'DECISION_REQUIRED',
  'INPUT_REQUIRED',
  'RISK_ESCALATION',
  'SCHEDULED',
  'NOISE',
]);
const CLOSED_STATES = new Set([
  'done',
  'completed',
  'closed',
  'resolved',
  'rejected',
  'cancelled',
  'archived',
]);
const FORBIDDEN_TELEMETRY_KEYS = new Set([
  'body',
  'title',
  'question',
  'recommendation',
  'signal',
  'comments',
  'attachments',
  'source_task_id',
  'sourceTaskId',
  'taskId',
]);

const PYTHON_METRICS_READER = String.raw`
import json, sqlite3, sys
request=json.loads(sys.stdin.read())
con=sqlite3.connect('file:'+request['database']+'?mode=ro', uri=True, timeout=10)
con.row_factory=sqlite3.Row
con.execute('PRAGMA query_only=ON')
private_board=request['privateBoard']
private_sensitivities=request['privateSensitivities']

required=['classification_audit','projection_boards','governance_decisions','management_topics','outcomes','wakeups','cockpit_events']
existing={row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
missing=[name for name in required if name not in existing]
if missing: raise RuntimeError('telemetry_schema_incomplete:'+','.join(missing))

private_placeholders=','.join(['?']*len(private_sensitivities))
public_topic="sensitivity NOT IN ("+private_placeholders+") AND source_task_refs_json NOT LIKE ?"
public_params=private_sensitivities+['%\"board\":\"'+private_board+'\"%']

def rows(sql, params=()): return [dict(row) for row in con.execute(sql, params).fetchall()]

labels=rows("""
WITH latest AS (
  SELECT source_board,source_task_id,MAX(projected_at) projected_at
  FROM classification_audit WHERE source_board != ? GROUP BY source_board,source_task_id
)
SELECT a.label,COUNT(*) count
FROM classification_audit a JOIN latest l
  ON l.source_board=a.source_board AND l.source_task_id=a.source_task_id AND l.projected_at=a.projected_at
GROUP BY a.label ORDER BY a.label
""", [private_board])

decision_sql="""
SELECT d.decision_id,d.topic_id,d.decision_class,d.status,d.classifier_label,
       d.first_projected_at,d.updated_at,d.recommendation,d.options_json,
       d.consequences_json,d.non_decision_effect,d.source_refs_json
FROM governance_decisions d LEFT JOIN management_topics t ON t.topic_id=d.topic_id
WHERE d.source_board != ? AND (t.topic_id IS NULL OR ("""+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))"
decisions=rows(decision_sql, [private_board]+public_params)
topics=rows('SELECT topic_id,current_state,source_task_refs_json FROM management_topics WHERE '+public_topic, public_params)
outcomes=rows("""
SELECT o.topic_id,o.occurred_at FROM outcomes o
LEFT JOIN management_topics t ON t.topic_id=o.topic_id
WHERE o.source_board != ? AND (t.topic_id IS NULL OR ("""+public_topic.replace('sensitivity','t.sensitivity').replace('source_task_refs_json','t.source_task_refs_json')+"))", [private_board]+public_params)
wakeups=rows('SELECT status,signal_required,last_signal_at FROM wakeups WHERE source_board != ?', [private_board])
boards=rows('SELECT board,projected_at,source_count FROM projection_boards WHERE board != ?', [private_board])
events=rows('SELECT occurred_at,event_type,object_type,payload_json FROM cockpit_events ORDER BY occurred_at', [])
print(json.dumps({'labels':labels,'decisions':decisions,'topics':topics,'outcomes':outcomes,'wakeups':wakeups,'boards':boards,'events':events}, ensure_ascii=False))
`;

function median(values) {
  const numbers = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

function percentile(values, fraction) {
  const numbers = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (!numbers.length) return null;
  return numbers[Math.min(numbers.length - 1, Math.ceil(numbers.length * fraction) - 1)];
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value || 'null') ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function isOpen(decision) {
  return !CLOSED_STATES.has(String(decision.status || '').toLowerCase());
}

function isMature(decision) {
  return Boolean(
    decision.decision_class !== 'projection_incomplete' &&
    decision.recommendation &&
    safeJson(decision.options_json, []).length &&
    safeJson(decision.consequences_json, []).length &&
    decision.non_decision_effect
  );
}

function isVisible(decision) {
  return (
    isOpen(decision) &&
    (isMature(decision) ||
      decision.decision_class === 'scope_violation' ||
      decision.decision_class === 'risk_escalation' ||
      decision.classifier_label === 'RISK_ESCALATION')
  );
}

function dayBucket(epochSeconds) {
  return new Date(Number(epochSeconds || 0) * 1000).toISOString().slice(0, 10);
}

function countBy(values, key) {
  const counts = {};
  for (const value of values) counts[value[key]] = (counts[value[key]] || 0) + 1;
  return counts;
}

function eventKind(value) {
  const type = String(value || '').toLowerCase();
  if (/(?:choose|approved|decision_selected)/.test(type)) return 'choose';
  if (/(?:reject|denied)/.test(type)) return 'reject';
  if (/(?:question|clarification)/.test(type)) return 'question';
  if (/(?:schedule|snooze|wakeup)/.test(type)) return 'schedule';
  if (/(?:delegate)/.test(type)) return 'delegate';
  if (/(?:scope.*prevent|prevent.*scope)/.test(type)) return 'scope_prevented';
  return 'other';
}

function assertSanitized(value, location = 'snapshot') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_TELEMETRY_KEYS.has(key)) {
      throw new Error(`sensitive_telemetry_key:${location}.${key}`);
    }
    assertSanitized(child, `${location}.${key}`);
  }
}

function readDatabase(database, options = {}) {
  if (!database) throw new Error('management database is required');
  const resolved = path.resolve(database);
  if (!fs.existsSync(resolved)) throw new Error('management_projection_unavailable');
  const result = spawnSync(options.pythonBin || 'python3', ['-c', PYTHON_METRICS_READER], {
    input: JSON.stringify({
      database: resolved,
      privateBoard: 'twl-netze-private',
      privateSensitivities: [
        'twl-private',
        'twl-netze-private',
        'private-quarantine',
        'private',
        'unclear',
        'mixed-sensitive',
      ],
    }),
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'telemetry_read_failed').slice(0, 1500));
  }
  return JSON.parse(result.stdout);
}

function collectTelemetry(options = {}) {
  const now = Number(options.now || Math.floor(Date.now() / 1000));
  const data = readDatabase(options.database, options);
  const classification = Object.fromEntries(CLASSIFIER_LABELS.map((label) => [label, 0]));
  for (const row of data.labels) classification[row.label] = Number(row.count || 0);
  const classificationTotal = Object.values(classification).reduce((sum, count) => sum + count, 0);
  const classificationShares = Object.fromEntries(
    Object.entries(classification).map(([label, count]) => [
      label,
      classificationTotal ? Number((count / classificationTotal).toFixed(6)) : 0,
    ])
  );

  const visible = data.decisions.filter(isVisible);
  const visibleByDay = countBy(
    visible.map((decision) => ({ day: dayBucket(decision.first_projected_at) })),
    'day'
  );
  const decisionsByTopic = new Map();
  for (const decision of data.decisions.filter(isOpen)) {
    if (!decisionsByTopic.has(decision.topic_id)) decisionsByTopic.set(decision.topic_id, []);
    decisionsByTopic.get(decision.topic_id).push(decision);
  }
  const repeatedGroups = Array.from(decisionsByTopic.values()).filter((items) => items.length > 1);
  const consolidatedSourceCounts = data.decisions.map(
    (decision) => safeJson(decision.source_refs_json, []).length
  );

  const outcomesByTopic = new Map();
  for (const outcome of data.outcomes) {
    if (!outcomesByTopic.has(outcome.topic_id)) outcomesByTopic.set(outcome.topic_id, []);
    outcomesByTopic.get(outcome.topic_id).push(Number(outcome.occurred_at || 0));
  }
  const resolvedLatencies = [];
  for (const decision of data.decisions.filter((item) => !isOpen(item))) {
    const resolvedAt = Number(decision.updated_at || 0);
    const candidates = (outcomesByTopic.get(decision.topic_id) || []).filter(
      (occurredAt) => occurredAt > 0 && occurredAt <= resolvedAt
    );
    const matureAt = Math.max(0, ...candidates);
    if (matureAt && resolvedAt >= matureAt) resolvedLatencies.push(resolvedAt - matureAt);
  }

  const autonomousCompleted = data.topics.filter((topic) => {
    const terminal = CLOSED_STATES.has(String(topic.current_state || '').toLowerCase());
    return (
      terminal &&
      (outcomesByTopic.get(topic.topic_id) || []).length > 0 &&
      !(decisionsByTopic.get(topic.topic_id) || []).length
    );
  }).length;
  const sourceCounts = data.topics.map((topic) => safeJson(topic.source_task_refs_json, []).length);

  const actionEvents = data.events.map((event) => ({
    ...event,
    kind: eventKind(event.event_type),
    payload: safeJson(event.payload_json, {}),
  }));
  const relevantActions = actionEvents.filter((event) =>
    ['choose', 'reject', 'question', 'schedule', 'delegate'].includes(event.kind)
  );
  const actionCounts = countBy(relevantActions, 'kind');
  const rejectedEvents = relevantActions.filter((event) => event.kind === 'reject');
  const rejectedNoise = rejectedEvents.filter((event) =>
    ['NOISE', 'INFORM_ONLY'].includes(String(event.payload.classifierLabel || ''))
  ).length;
  const nextStepInteractions = relevantActions.filter((event) => {
    const nextStep = event.payload.nextStep || event.payload.next_action;
    return typeof nextStep === 'string' && nextStep.trim();
  }).length;
  const preventedActions = actionEvents.filter((event) => event.kind === 'scope_prevented').length;

  const projectionAt = Math.max(0, ...data.boards.map((board) => Number(board.projected_at || 0)));
  const sourceCount = data.boards.reduce((sum, board) => sum + Number(board.source_count || 0), 0);
  const legacyItems = Array.isArray(options.legacySource?.items)
    ? options.legacySource.items
    : null;
  const legacyVisibleCount = legacyItems ? legacyItems.length : null;
  const conversationItems = legacyItems || [];
  const activeConversations = conversationItems.filter((item) =>
    ['active', 'waiting_reply', 'follow_up_due'].includes(
      String(item.conversation_status || '').toLowerCase()
    )
  );
  const dueResponses = activeConversations.filter((item) => {
    const dueAt = Number(item.next_reply_at || item.response_due_at || 0);
    return dueAt > 0 && dueAt <= now;
  });

  const snapshot = {
    schemaVersion: 1,
    mode: 'shadow',
    shadowOnly: true,
    operationalEffect: false,
    sourceWritePerformed: false,
    capturedAt: now,
    managementLoad: {
      visibleDecisionCount: visible.length,
      visibleDecisionsByFirstProjectionDay: visibleByDay,
      legacyVisibleCandidateCount: legacyVisibleCount,
      reductionRatio:
        legacyVisibleCount === null || legacyVisibleCount === 0
          ? null
          : Number((1 - visible.length / legacyVisibleCount).toFixed(6)),
      legacyComparisonAvailable: legacyVisibleCount !== null,
    },
    classification: {
      total: classificationTotal,
      counts: classification,
      shares: classificationShares,
    },
    decisionActions: {
      interactionCount: relevantActions.length,
      counts: {
        choose: actionCounts.choose || 0,
        reject: actionCounts.reject || 0,
        askClarification: actionCounts.question || 0,
        schedule: actionCounts.schedule || 0,
        delegate: actionCounts.delegate || 0,
      },
      rates: Object.fromEntries(
        [
          ['choose', 'choose'],
          ['reject', 'reject'],
          ['askClarification', 'question'],
          ['schedule', 'schedule'],
          ['delegate', 'delegate'],
        ].map(([outputName, eventName]) => [
          outputName,
          relevantActions.length
            ? Number(((actionCounts[eventName] || 0) / relevantActions.length).toFixed(6))
            : null,
        ])
      ),
      rejectedNoiseCount: rejectedNoise,
      rejectedNoiseShare: rejectedEvents.length
        ? Number((rejectedNoise / rejectedEvents.length).toFixed(6))
        : null,
      nextStepInteractionCount: nextStepInteractions,
      nextStepInteractionShare: relevantActions.length
        ? Number((nextStepInteractions / relevantActions.length).toFixed(6))
        : null,
      available: relevantActions.length > 0,
    },
    processQuality: {
      medianMatureOutcomeToResolvedDecisionSeconds: median(resolvedLatencies),
      resolvedDecisionLatencySampleSize: resolvedLatencies.length,
      repeatedHitlTopicCount: repeatedGroups.length,
      repeatedHitlExcessCount: repeatedGroups.reduce((sum, items) => sum + items.length - 1, 0),
      consolidatedDecisionSourceCount: consolidatedSourceCounts.filter((count) => count > 1).length,
      autonomousCompletedBundleCount: autonomousCompleted,
      wakeupsAwaitingNewSignal: data.wakeups.filter((wakeup) => wakeup.status === 'awaiting_signal')
        .length,
      repeatedWakeupsWithoutStateChange: data.wakeups.filter(
        (wakeup) => wakeup.status === 'quality_error'
      ).length,
      sourceCardsPerTopic: {
        topicCount: sourceCounts.length,
        average: sourceCounts.length
          ? Number(
              (sourceCounts.reduce((sum, count) => sum + count, 0) / sourceCounts.length).toFixed(3)
            )
          : 0,
        median: median(sourceCounts),
        p95: percentile(sourceCounts, 0.95),
        maximum: sourceCounts.length ? Math.max(...sourceCounts) : 0,
      },
      activeConversationCount: activeConversations.length,
      dueResponseCount: dueResponses.length,
      conversationMetricsAvailable: activeConversations.length > 0,
    },
    scopeSafety: {
      openScopeViolationCount: data.decisions.filter(
        (decision) => isOpen(decision) && decision.decision_class === 'scope_violation'
      ).length,
      openRiskEscalationCount: data.decisions.filter(
        (decision) =>
          isOpen(decision) &&
          (decision.decision_class === 'risk_escalation' ||
            decision.classifier_label === 'RISK_ESCALATION')
      ).length,
      correctlyPreventedActionCount: preventedActions,
      preventionEventMetricsAvailable: preventedActions > 0,
    },
    projectionHealth: {
      boardCount: data.boards.length,
      sourceCount,
      projectedAt: projectionAt || null,
      ageSeconds: projectionAt ? Math.max(0, now - projectionAt) : null,
      incompleteDecisionCount: data.decisions.filter(
        (decision) => decision.decision_class === 'projection_incomplete'
      ).length,
      boardErrorCount:
        Number.isInteger(options.projectionErrorCount) && options.projectionErrorCount >= 0
          ? options.projectionErrorCount
          : null,
      boardErrorMetricsAvailable: Number.isInteger(options.projectionErrorCount),
    },
    privacy: {
      rawBodiesIncluded: false,
      rawTitlesIncluded: false,
      rawQuestionsIncluded: false,
      sourceIdentifiersIncluded: false,
      excludedPrivateBoard: 'twl-netze-private',
    },
  };
  assertSanitized(snapshot);
  return snapshot;
}

function readHistory(historyPath, options = {}) {
  if (!historyPath || !fs.existsSync(historyPath)) return [];
  const minimum = Number(options.minimumCapturedAt || 0);
  return fs
    .readFileSync(historyPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((snapshot) => Number(snapshot.capturedAt || 0) >= minimum);
}

function appendSnapshot(historyPath, snapshot) {
  assertSanitized(snapshot);
  const resolved = path.resolve(historyPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.appendFileSync(resolved, `${JSON.stringify(snapshot)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(resolved, 0o600);
  return resolved;
}

function compareHistory(history, options = {}) {
  const now = Number(options.now || Math.floor(Date.now() / 1000));
  const windowDays = Number(options.windowDays || 14);
  const minimum = now - windowDays * 86400;
  const snapshots = history
    .filter((snapshot) => Number(snapshot.capturedAt || 0) >= minimum)
    .sort((left, right) => left.capturedAt - right.capturedAt);
  const byDay = new Map();
  for (const snapshot of snapshots) byDay.set(dayBucket(snapshot.capturedAt), snapshot);
  const daily = Array.from(byDay.entries()).map(([day, snapshot]) => ({
    day,
    visibleDecisionCount: snapshot.managementLoad.visibleDecisionCount,
    legacyVisibleCandidateCount: snapshot.managementLoad.legacyVisibleCandidateCount,
    repeatedHitlTopicCount: snapshot.processQuality.repeatedHitlTopicCount,
    autonomousCompletedBundleCount: snapshot.processQuality.autonomousCompletedBundleCount,
    noiseShare: snapshot.classification.shares.NOISE,
    projectionAgeSeconds: snapshot.projectionHealth.ageSeconds,
  }));
  const first = daily[0] || null;
  const last = daily[daily.length - 1] || null;
  return {
    windowDays,
    coverageDays: daily.length,
    gateReady: daily.length >= windowDays,
    daily,
    change:
      first && last
        ? {
            visibleDecisionCount: last.visibleDecisionCount - first.visibleDecisionCount,
            repeatedHitlTopicCount: last.repeatedHitlTopicCount - first.repeatedHitlTopicCount,
            autonomousCompletedBundleCount:
              last.autonomousCompletedBundleCount - first.autonomousCompletedBundleCount,
          }
        : null,
  };
}

module.exports = {
  CLASSIFIER_LABELS,
  appendSnapshot,
  assertSanitized,
  collectTelemetry,
  compareHistory,
  isMature,
  isVisible,
  median,
  readHistory,
};
