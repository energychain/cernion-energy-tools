'use strict';

const { createHash } = require('crypto');

// Event intent generation is pure; service policy and delivery checks precede persistence.
function evaluateEventTriggers(previous, state, update = {}) {
  const c = state.lastClassification;
  const types = new Map();
  const add = (trigger, eventType, version = update.version || state.caseStateVersion) =>
    types.set(`${trigger}:${eventType}`, { trigger, eventType, version });
  const transitions = {
    reclassify: ['DR-TRANSITION-RECLASSIFY', 'domain.changed'],
    branch: ['DR-TRANSITION-BRANCH', 'branch.created'],
    clarify: ['DR-TRANSITION-CLARIFY', 'clarification.required'],
    handoff: ['DR-HANDOFF', 'handoff.completed'],
  };
  if (!update.kind && transitions[c.transition.type]) add(...transitions[c.transition.type]);
  if (update.kind === 'async_result') add('PA-ASYNC-RESULT', 'async.message.ready', update.version);
  if (['receipt_complete', 'evidence_available'].includes(update.kind))
    add('RCPT-COMPLETE', 'evidence.available', update.version);
  if (['receipt_failed', 'receipt_expired'].includes(update.kind))
    add('RCPT-FAILED-BLOCKING', 'case.escalation.required', update.version);
  if (update.kind === 'related_found')
    add('DISCOVERY-RELATED-FOUND', 'related.session.found', update.version);
  if (update.kind === 'related_reply')
    add('RELATED-REPLY', 'related.session.reply', update.version);
  if (state.knownContext.policyBlocked) add('POLICY-BLOCK', 'case.escalation.required');
  // QDRANT-PROCESS-HIT deliberately has no standalone user event.
  if (
    c.currentStation &&
    !c.missingEvidence.length &&
    !c.roleProjection.ownerGap &&
    state.knownContext.ownerRole
  )
    add('LAUFKARTE-STATION-READY', 'laufkarte.station.ready');
  if (c.controlPoint && (c.missingEvidence.length || c.roleProjection.ownerGap)) {
    add('CONTROL-POINT-BLOCKED', 'control_point.blocked');
    add('CONTROL-POINT-BLOCKED', 'evidence.required');
  }
  if (previous && previous.lastClassification.readinessState !== c.readinessState)
    add('READINESS-CHANGED', 'readiness.changed');
  if (c.roleProjection.ownerGap) add('OWNER-GAP-DETECTED', 'case.escalation.required');
  if (
    [c.primaryDomain, ...c.alternativeDomains.map((d) => d.domain)].includes(
      'm2c_revenue_assurance'
    ) &&
    c.missingEvidence.length
  ) {
    add('M2C-IMPACT-DETECTED', 'evidence.required');
    // A related-found notification requires an actual visible link.
    if (state.relatedCases?.length) add('M2C-IMPACT-DETECTED', 'related.session.found');
  }
  if (c.vendorBlocker) add('VENDOR-BLOCKER-DETECTED', 'handoff.completed');
  return [...types.values()].map((e) => {
    const dedupeKey = [
      state.tenantId,
      state.cetCaseId,
      e.trigger,
      e.eventType,
      update.sourceCaseId || '',
      e.version,
    ].join(':');
    return {
      ...e,
      dedupeKey,
      eventId: createHash('sha256').update(dedupeKey).digest('hex'),
      sourceCaseId: update.sourceCaseId || state.cetCaseId,
      evidenceRef: update.evidenceRef || null,
      payloadRef: update.payloadRef || null,
    };
  });
}
module.exports = { evaluateEventTriggers };
