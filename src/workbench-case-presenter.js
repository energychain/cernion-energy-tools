'use strict';

function text(value, fallback = '') {
  return String(value == null || value === '' ? fallback : value);
}

function titleFromCase(state) {
  const domain = state.currentDomain || state.lastClassification?.primaryDomain || 'CET Case';
  const request =
    state.knownContext?.userRequest || state.lastClassification?.responseGuidance || '';
  return request ? `${domain}: ${text(request).slice(0, 80)}` : `${domain} Case ${state.cetCaseId}`;
}

function presentCase(state, { evidenceRefs = [], eventSummary = null } = {}) {
  const c = state.lastClassification || {};
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
    evidenceRefs: evidenceRefs.map((e) => ({
      evidenceId: e.evidenceId,
      type: e.evidenceType,
      label: e.label,
      status: e.status,
      hash: e.hash,
      createdAt: e.createdAt,
    })),
    noRawEvidencePayloads: true,
    createdAt: state.createdAt || state.updatedAt,
    updatedAt: state.updatedAt,
  };
}

function presentCaseListItem(state, eventSummary = { pending: 0, attention: 0 }) {
  const c = state.lastClassification || {};
  return {
    caseId: state.cetCaseId,
    title: titleFromCase(state),
    primaryDomain: c.primaryDomain || state.currentDomain || 'unknown',
    readinessState: c.readinessState || 'unknown',
    status: c.readinessState === 'evidence_required' ? 'waiting' : 'active',
    pendingEvents: eventSummary.pending || 0,
    severity: eventSummary.attention ? 'attention' : 'info',
    updatedAt: state.updatedAt,
  };
}

module.exports = { presentCase, presentCaseListItem };
