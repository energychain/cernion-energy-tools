'use strict';

const { safeEvidenceRef } = require('./workbench-evidence');
const { safeTurnMemory, turnMemorySummary } = require('./workbench-turn-memory');
const { INSPECTOR_VIEW, safeCode, safeTimestamp } = require('./workbench-toolrun-presenter');

const CASE_INSPECTOR_SCHEMA_VERSION = 'workbench-case-inspector.v1';
const DEFAULT_EVIDENCE_ROWS = 25;
const MAX_EVIDENCE_ROWS = 50;
const MAX_GUIDANCE_ROWS = 25;
const MAX_TEXT = 160;

function text(value, fallback = '') {
  return String(value == null || value === '' ? fallback : value);
}

function titleFromCase(state) {
  return text(require('./case-linking').caseDescription(state), 'Vorgang');
}

function presentCase(state, { evidenceRefs = [], eventSummary = null, clearance = [] } = {}) {
  const c = state.lastClassification || {};
  const safeRefs = evidenceRefs.map((e) =>
    safeEvidenceRef(e, { clearance, tenantId: state.tenantId })
  );
  return {
    caseId: state.cetCaseId,
    cetCaseId: state.cetCaseId,
    caseStateVersion: state.caseStateVersion,
    tenantId: state.tenantId,
    title: titleFromCase(state),
    situation: state.knownContext?.situation || null,
    primaryDomain: c.primaryDomain || state.currentDomain || 'unknown',
    alternativeDomains: c.alternativeDomains || [],
    readinessState: c.readinessState || 'unknown',
    status:
      state.disposition === 'discarded'
        ? 'discarded'
        : c.readinessState === 'evidence_required'
          ? 'waiting'
          : 'active',
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
    appliedPlaybooks: safeTurnMemory(state.turnMemory)?.appliedPlaybooks || [],
    noRawEvidencePayloads: true,
    createdAt: state.createdAt || state.updatedAt,
    updatedAt: state.updatedAt,
  };
}

function presentCaseListItem(state, eventSummary = null, taskSummary = null) {
  const c = state.lastClassification || {};
  const events = eventSummary || {};
  const tasks = taskSummary || { open: 0, attention: 0 };
  const severity = tasks.attention || events.attention ? 'attention' : 'info';
  return {
    caseId: state.cetCaseId,
    title: titleFromCase(state),
    primaryDomain: c.primaryDomain || state.currentDomain || 'unknown',
    readinessState: c.readinessState || 'unknown',
    status:
      state.disposition === 'discarded'
        ? 'discarded'
        : c.readinessState === 'evidence_required'
          ? 'waiting'
          : 'active',
    pendingEvents: events.unacknowledged || events.pending || 0,
    severity,
    taskSummary: tasks,
    updatedAt: state.updatedAt,
  };
}

// Closed, scalar selected-case inspector projection (#660). It is derived from
// presentCase(...) so EvidenceRefs keep the caller's safeEvidenceRef clearance
// reduction; only allowlisted scalar cells leave this function.
function evidenceLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_EVIDENCE_ROWS;
  return Math.min(n, MAX_EVIDENCE_ROWS);
}

function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[url]';
  }
}

function boundedText(value) {
  if (typeof value !== 'string') return null;
  const clean = value
    .replace(/\bhttps?:\/\/\S+/giu, safeUrl)
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .trim();
  return clean ? clean.slice(0, MAX_TEXT) : null;
}

function newestEvidenceFirst(a, b) {
  return (
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
    String(b.evidenceId || '').localeCompare(String(a.evidenceId || ''))
  );
}

function presentEvidenceInspectorRow(ref) {
  const restricted = !!ref.redacted;
  const provenance = restricted ? null : ref.provenance || {};
  const provenanceLabel = provenance
    ? [safeCode(provenance.system), safeCode(provenance.retrievalMode)].filter(Boolean).join('/')
    : '';
  return {
    evidenceId: safeCode(ref.evidenceId),
    caseId: safeCode(ref.caseId),
    evidenceType: safeCode(ref.evidenceType) || 'unknown',
    label: restricted ? 'Restricted evidence' : boundedText(ref.label),
    status: safeCode(ref.status) || 'unknown',
    sourceType: restricted ? null : safeCode(ref.sourceType),
    sensitivityLevel: safeCode(ref.sensitivityLevel) || 'unknown',
    redacted: restricted,
    sourceFingerprintStatus: restricted
      ? 'restricted'
      : ref.sourceFingerprint
        ? 'present'
        : 'missing',
    fileHashStatus: restricted
      ? 'restricted'
      : safeCode(ref.hashStatus) || (ref.fileHash ? 'provided' : 'unavailable'),
    provenanceLabel: provenanceLabel || null,
    evidenceRole: restricted ? null : safeCode(ref.evidenceRole),
    claimStrength: restricted ? null : safeCode(ref.claimStrength),
    readinessReviewRequired: !restricted && !!ref.readinessReviewRequired,
    createdAt: safeTimestamp(ref.createdAt),
  };
}

function guidanceRows(items) {
  return items.slice(0, MAX_GUIDANCE_ROWS).map((item, index) => {
    const code = typeof item === 'string' ? item : item?.type || item?.code;
    const label = [item, item?.label, item?.question, code].find((v) => typeof v === 'string');
    return { position: index + 1, code: safeCode(code), label: boundedText(label) };
  });
}

const NEXT_GATES = {
  case_discarded: 'Case is discarded; refresh only.',
  evidence_required: 'Attach or reference the missing evidence through the governed Workbench.',
  clarification_required: 'Answer the open clarification questions.',
  evidence_readiness_review: 'Review attached evidence before relying on it.',
  refresh_case_projection: 'Refresh the selected-case projection.',
};

function nextSafeGate(summary, counts) {
  if (summary.status === 'discarded') return 'case_discarded';
  if (counts.missingEvidenceCount) return 'evidence_required';
  if (counts.requiredClarificationCount) return 'clarification_required';
  if (summary.readinessReviewRequired) return 'evidence_readiness_review';
  return 'refresh_case_projection';
}

function presentCaseInspector(
  state,
  { evidenceRefs = [], eventSummary = null, clearance = [], limit } = {}
) {
  const summary = presentCase(state, { evidenceRefs, eventSummary, clearance });
  const caseId = safeCode(summary.caseId);
  const bound = evidenceLimit(limit);
  const ordered = [...summary.evidenceRefs].sort(newestEvidenceFirst);
  const evidenceItems = ordered.slice(0, bound).map(presentEvidenceInspectorRow);
  const missing = Array.isArray(summary.missingEvidence) ? summary.missingEvidence : [];
  const clarifications = Array.isArray(summary.requiredClarifications)
    ? summary.requiredClarifications
    : [];
  const noCall = Array.isArray(summary.noCallGuards) ? summary.noCallGuards : [];
  const counts = {
    missingEvidenceCount: missing.length,
    requiredClarificationCount: clarifications.length,
    noCallGuardCount: noCall.length,
  };
  const gate = nextSafeGate(summary, counts);
  const events = summary.eventSummary || {};
  return {
    view: INSPECTOR_VIEW,
    schemaVersion: CASE_INSPECTOR_SCHEMA_VERSION,
    caseId,
    evidenceLimit: bound,
    evidenceTotalCount: ordered.length,
    evidenceReturnedCount: evidenceItems.length,
    evidenceTruncated: ordered.length > evidenceItems.length,
    toolRunInspectorPath: caseId
      ? `/api/workbench/cases/${encodeURIComponent(caseId)}/tool-runs?view=${INSPECTOR_VIEW}`
      : null,
    case: {
      caseId,
      title: boundedText(summary.title),
      primaryDomain: safeCode(summary.primaryDomain) || 'unknown',
      readinessState: safeCode(summary.readinessState) || 'unknown',
      status: safeCode(summary.status) || 'unknown',
      updatedAt: safeTimestamp(summary.updatedAt),
      evidenceCount: ordered.length,
      redactedEvidenceCount: summary.redactedEvidenceCount,
      ...counts,
      pendingEventCount: Number(events.pending) || 0,
      attentionEventCount: Number(events.attention) || 0,
      nextSafeGate: gate,
      nextSafeGateLabel: NEXT_GATES[gate],
      refreshAllowed: true,
      mutationAllowed: false,
    },
    evidenceItems,
    missingEvidenceItems: guidanceRows(missing),
    clarificationItems: guidanceRows(clarifications),
    noCallItems: guidanceRows(noCall),
  };
}

module.exports = {
  CASE_INSPECTOR_SCHEMA_VERSION,
  MAX_EVIDENCE_ROWS,
  presentCase,
  presentCaseInspector,
  presentCaseListItem,
};
