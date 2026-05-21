'use strict';

const SIGNAL_DISTURBANCE_PATTERN = 'DISTURBANCE_PATTERN';
const SIGNAL_REPEATING_FAULT = 'REPEATING_FAULT';

const DEFAULT_MIN_EVENTS = 3;
const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

function toIso(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function toTimestamp(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
}

function daysBetween(fromIso, toIsoValue) {
  const fromTs = toTimestamp(fromIso);
  const toTs = toTimestamp(toIsoValue);
  if (!fromTs || !toTs) return null;
  return Math.max(0, Math.round((toTs - fromTs) / (24 * 60 * 60 * 1000)));
}

function normalizeEvents(events, referenceIso, windowDays) {
  const referenceTs = toTimestamp(referenceIso) || Date.now();
  const cutoffTs = referenceTs - windowDays * 24 * 60 * 60 * 1000;
  return (Array.isArray(events) ? events : [])
    .map((event) => {
      const timestamp = toIso(event.timestamp || event.createdAt || referenceIso);
      const ts = toTimestamp(timestamp);
      return {
        ...event,
        timestamp,
        _ts: ts,
      };
    })
    .filter((event) => event._ts && event._ts >= cutoffTs && event._ts <= referenceTs)
    .sort((a, b) => a._ts - b._ts);
}

function groupEvents(events) {
  const groups = new Map();
  for (const event of events) {
    const key = String(event.groupKey || 'unknown').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return groups;
}

function deriveConfidence(count, severityScore) {
  const countScore = Math.min(1, count / 5);
  const score = 0.55 * countScore + 0.45 * Math.min(1, Math.max(0, severityScore));
  return Math.round(score * 100) / 100;
}

function severityToScore(severity) {
  if (severity === 'error' || severity === 'high') return 1;
  if (severity === 'warning' || severity === 'medium') return 0.75;
  return 0.45;
}

function buildSignalsFromEvents(input = {}) {
  const {
    events = [],
    now = new Date().toISOString(),
    minEvents = DEFAULT_MIN_EVENTS,
    windowDays = DEFAULT_WINDOW_DAYS,
  } = input;

  const normalized = normalizeEvents(events, now, windowDays);
  const groups = groupEvents(normalized);
  const signals = [];

  for (const [groupKey, groupEventsList] of groups.entries()) {
    if (groupEventsList.length < minEvents) continue;

    const first = groupEventsList[0];
    const last = groupEventsList[groupEventsList.length - 1];
    const spanDays = daysBetween(first.timestamp, last.timestamp) || 0;

    const severityScore =
      groupEventsList.reduce((acc, item) => acc + severityToScore(item.severity), 0) /
      groupEventsList.length;
    const confidence = deriveConfidence(groupEventsList.length, severityScore);

    const baseSignal = {
      signalKey: `${groupKey}:${last.timestamp}`,
      groupKey,
      eventCount: groupEventsList.length,
      firstSeenAt: first.timestamp,
      lastSeenAt: last.timestamp,
      spanDays,
      confidence,
      sourceTypes: [...new Set(groupEventsList.map((event) => event.sourceType).filter(Boolean))],
      region: last.region || first.region || null,
      gridOperatorId: last.gridOperatorId || first.gridOperatorId || null,
      context: {
        sampleEvents: groupEventsList.slice(-3).map((event) => ({
          sourceType: event.sourceType || null,
          timestamp: event.timestamp,
          severity: event.severity || null,
          reason: event.reason || null,
        })),
      },
    };

    signals.push({
      ...baseSignal,
      signalType: SIGNAL_DISTURBANCE_PATTERN,
      reason:
        `Detected ${groupEventsList.length} disturbance-related events in ${windowDays}d ` +
        `for group ${groupKey}.`,
    });

    if (spanDays >= 14) {
      signals.push({
        ...baseSignal,
        signalKey: `${groupKey}:repeating:${last.timestamp}`,
        signalType: SIGNAL_REPEATING_FAULT,
        confidence: Math.round(Math.min(1, confidence + 0.05) * 100) / 100,
        reason:
          `Recurring disturbance pattern without stable mitigation over ${spanDays}d ` +
          `for group ${groupKey}.`,
      });
    }
  }

  return signals.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''));
  });
}

function buildInvestmentProposals({
  signals = [],
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
}) {
  return (Array.isArray(signals) ? signals : []).map((signal, index) => {
    const autoProposal = Number(signal.confidence || 0) >= Number(confidenceThreshold || 0);
    const baseCapex = signal.signalType === SIGNAL_REPEATING_FAULT ? 900000 : 550000;
    const capexEstimateEur = Math.round(baseCapex + Math.max(0, signal.eventCount - 3) * 140000);

    return {
      proposalId: `bfr-${index + 1}`,
      signalKey: signal.signalKey,
      kind: 'znp_capex_alternative',
      title:
        signal.signalType === SIGNAL_REPEATING_FAULT
          ? 'Recurring fault mitigation investment'
          : 'Disturbance pattern mitigation investment',
      rationale: signal.reason,
      region: signal.region || null,
      gridOperatorId: signal.gridOperatorId || null,
      confidence: signal.confidence,
      autoProposal,
      status: autoProposal ? 'auto_proposed' : 'manual_review',
      capexEstimateEur,
      expectedAvoidedCostsEur: Math.round(capexEstimateEur * 0.25),
      priority: signal.confidence >= 0.85 ? 'high' : signal.confidence >= 0.7 ? 'medium' : 'low',
      references: {
        signalType: signal.signalType,
        sourceTypes: signal.sourceTypes || [],
      },
    };
  });
}

module.exports = {
  SIGNAL_DISTURBANCE_PATTERN,
  SIGNAL_REPEATING_FAULT,
  DEFAULT_MIN_EVENTS,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_CONFIDENCE_THRESHOLD,
  buildSignalsFromEvents,
  buildInvestmentProposals,
};
