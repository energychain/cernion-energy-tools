'use strict';

// Closed, scalar ToolRun inspector projection (#660). Persisted ToolRun
// documents carry input/output summaries, nested evidence/receipt objects and
// PouchDB metadata; this presenter is the only shape the inspector view may
// return. Nested EvidenceRefs are re-evaluated through safeEvidenceRef with the
// reading principal's tenant and clearance before they are reduced to IDs.

const { safeEvidenceRef } = require('./workbench-evidence');

const INSPECTOR_VIEW = 'inspector';
const INSPECTOR_SCHEMA_VERSION = 'workbench-toolrun-inspector.v1';
const MAX_INSPECTOR_ROWS = 25;
const MAX_REF_IDS = 10;

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,120}$/u;
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;

const STATES = {
  completed: {
    governanceOutcome: 'allowed',
    failureLabel: null,
    failureSummary: null,
    nextSafeGate: 'evidence_readiness_review',
  },
  failed: {
    governanceOutcome: 'allowed',
    failureLabel: 'tool_run_failed',
    failureSummary: 'Tool run failed before producing evidence; no result was attached.',
    nextSafeGate: 'operator_failure_review',
  },
  blocked: {
    governanceOutcome: 'policy_blocked',
    failureLabel: 'policy_blocked',
    failureSummary: 'Tool run was blocked by CET governance and did not execute.',
    nextSafeGate: 'governance_review_required',
  },
  unknown: {
    governanceOutcome: 'unknown',
    failureLabel: 'status_unknown',
    failureSummary: 'Tool run status is not recognised by the inspector.',
    nextSafeGate: 'refresh_case_projection',
  },
};

function safeCode(value) {
  return typeof value === 'string' && SAFE_CODE.test(value) ? value : null;
}

function safeTimestamp(value) {
  return typeof value === 'string' && SAFE_TIMESTAMP.test(value) ? value : null;
}

function inspectorLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return MAX_INSPECTOR_ROWS;
  return Math.min(n, MAX_INSPECTOR_ROWS);
}

function receiptId(ref) {
  if (typeof ref === 'string') return safeCode(ref);
  if (!ref || typeof ref !== 'object') return null;
  return safeCode(ref.receiptId) || safeCode(ref.receiptRef) || safeCode(ref.id);
}

function evidenceRefs(run, { tenantId, clearance, evidenceById }) {
  const refs = Array.isArray(run.evidenceRefs) ? run.evidenceRefs : [];
  return refs
    .filter((ref) => ref && typeof ref === 'object' && safeCode(ref.evidenceId))
    .map((ref) => {
      // Prefer the live tenant-scoped EvidenceRef; fall back to the snapshot
      // stored on the ToolRun, bound to the ToolRun's own tenant.
      const source = evidenceById.get(ref.evidenceId) || { ...ref, tenantId: run.tenantId };
      return safeEvidenceRef(source, { clearance, tenantId });
    });
}

function presentToolRunInspector(run, { tenantId, clearance = [], evidenceById = new Map() } = {}) {
  const status = ['completed', 'failed', 'blocked'].includes(run.status) ? run.status : 'unknown';
  const state = STATES[status];
  const evidence = evidenceRefs(run, { tenantId, clearance, evidenceById });
  const receiptIds = (Array.isArray(run.receiptRefs) ? run.receiptRefs : [])
    .map(receiptId)
    .filter(Boolean);
  const blockedReason = status === 'blocked' ? safeCode(run.blockedReason) : null;
  return {
    toolRunId: safeCode(run.toolRunId),
    caseId: safeCode(run.caseId),
    toolId: safeCode(run.toolId) || 'unknown',
    toolClass: safeCode(run.toolClass) || 'unknown',
    sideEffectClass: safeCode(run.sideEffectClass) || 'unknown',
    status,
    governanceOutcome: state.governanceOutcome,
    failureLabel: blockedReason || state.failureLabel,
    failureSummary: state.failureSummary,
    startedAt: safeTimestamp(run.startedAt),
    finishedAt: safeTimestamp(run.finishedAt),
    evidenceRefIds: evidence.slice(0, MAX_REF_IDS).map((ref) => ref.evidenceId),
    evidenceRefCount: evidence.length,
    restrictedEvidenceRefCount: evidence.filter((ref) => ref.redacted).length,
    receiptRefIds: receiptIds.slice(0, MAX_REF_IDS),
    receiptRefCount: receiptIds.length,
    auditRef: safeCode(run.auditRef),
    nextSafeGate: state.nextSafeGate,
  };
}

function newestFirst(a, b) {
  return (
    String(b.startedAt || '').localeCompare(String(a.startedAt || '')) ||
    String(b.toolRunId || '').localeCompare(String(a.toolRunId || ''))
  );
}

function presentToolRunInspectorList(runs, { caseId, limit, ...options } = {}) {
  const bound = inspectorLimit(limit);
  const ordered = [...runs].sort(newestFirst);
  const items = ordered.slice(0, bound).map((run) => presentToolRunInspector(run, options));
  return {
    view: INSPECTOR_VIEW,
    schemaVersion: INSPECTOR_SCHEMA_VERSION,
    caseId,
    limit: bound,
    totalCount: ordered.length,
    returnedCount: items.length,
    truncated: ordered.length > items.length,
    items,
  };
}

function evidenceIndex(evidenceDocs = []) {
  return new Map(evidenceDocs.map((doc) => [doc.evidenceId, doc]));
}

module.exports = {
  INSPECTOR_VIEW,
  INSPECTOR_SCHEMA_VERSION,
  MAX_INSPECTOR_ROWS,
  evidenceIndex,
  inspectorLimit,
  presentToolRunInspector,
  presentToolRunInspectorList,
  safeCode,
  safeTimestamp,
};
