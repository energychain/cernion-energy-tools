'use strict';

const { safeEvidenceRef } = require('./workbench-evidence');
const { safeTurnMemory, turnMemorySummary } = require('./workbench-turn-memory');

function text(value, fallback = '') {
  return String(value == null || value === '' ? fallback : value);
}

function titleFromCase(state) {
  const domain = state.currentDomain || state.lastClassification?.primaryDomain || 'CET Case';
  const request =
    state.knownContext?.userRequest || state.lastClassification?.responseGuidance || '';
  return request ? `${domain}: ${text(request).slice(0, 80)}` : `${domain} Case ${state.cetCaseId}`;
}

function presentCase(state, { evidenceRefs = [], eventSummary = null, clearance = [] } = {}) {
  const c = state.lastClassification || {};
  const safeRefs = evidenceRefs.map((e) => safeEvidenceRef(e, { clearance }));
  return {
    caseId: state.cetCaseId,
    cetCaseId: state.cetCaseId,
    caseStateVersion: state.caseStateVersion,
    tenantId: state.tenantId,
    title: titleFromCase(state),
    primaryDomain: c.primaryDomain || state.currentDomain || 'unknown',
    alternativeDomains: c.alternativeDomains || [],
    readinessState: c.readinessState || 'unknown',
    status: c.readinessState === 'evidence_required' ? 'waiting' : 'active',
    allowedActions: c.allowedActions || [],
    blockedActions: c.blockedActions || [],
    requiredClarifications: c.requiredClarifications || state.openClarifications || [],
    missingEvidence: (c.missingEvidence || c.evidenceRequirements || []).map((item) =>
      typeof item === 'string' ? { type: item, label: item, required: true } : item
    ),
    noCallGuards: c.noCallGuards || [],
    selectedCapabilities: c.selectedCapabilities || [],
    selectedReceipts: c.selectedReceipts || [],
    lastResponseText: c.responseText || c.responseGuidance || '',
    eventSummary: eventSummary || { pending: 0, attention: 0 },
    evidenceSummary: {
      total: evidenceRefs.length,
      redacted: safeRefs.filter((e) => e.redacted).length,
      readinessReviewRequired: safeRefs.some((e) => e.readinessReviewRequired),
    },
    readinessReviewRequired: safeRefs.some((e) => e.readinessReviewRequired),
    redactedEvidenceCount: safeRefs.filter((e) => e.redacted).length,
    evidenceRefs: safeRefs,
    turnMemory: safeTurnMemory(state.turnMemory),
    turnMemorySummary: turnMemorySummary(state.turnMemory),
    workingAssumptions: safeTurnMemory(state.turnMemory)?.workingAssumptions || [],
    openQuestions: safeTurnMemory(state.turnMemory)?.openQuestions || [],
    activeRoleProjection: safeTurnMemory(state.turnMemory)?.activeRole || null,
    noRawEvidencePayloads: true,
    createdAt: state.createdAt || state.updatedAt,
    updatedAt: state.updatedAt,
  };
}

function presentCaseListItem(
  state,
  eventSummary = { pending: 0, attention: 0 },
  taskSummary = null
) {
  const c = state.lastClassification || {};
  return {
    caseId: state.cetCaseId,
    title: titleFromCase(state),
    primaryDomain: c.primaryDomain || state.currentDomain || 'unknown',
    readinessState: c.readinessState || 'unknown',
    status: c.readinessState === 'evidence_required' ? 'waiting' : 'active',
    pendingEvents: eventSummary.unacknowledged || eventSummary.pending || 0,
    severity: taskSummary?.attention ? 'attention' : eventSummary.attention ? 'attention' : 'info',
    taskSummary: taskSummary || { open: 0, attention: 0 },
    updatedAt: state.updatedAt,
  };
}

module.exports = { presentCase, presentCaseListItem };
