'use strict';

const ATTENTION_EVENT_MAP = {
  'evidence.required': 'evidence_required',
  'evidence.available': 'readiness_review_required',
  'clarification.required': 'clarification_required',
  'handoff.required': 'handoff_required',
  'handoff.completed': 'handoff_required',
  'domain.changed': 'domain_changed',
  'related.session.reply': 'related_session_reply',
  'policy.blocked': 'policy_blocked',
  'case.escalation.required': 'owner_gap_detected',
};

function attentionStateForEvent(event = {}) {
  if (ATTENTION_EVENT_MAP[event.eventType]) return ATTENTION_EVENT_MAP[event.eventType];
  if (event.requiresUserAttention) return 'clarification_required';
  return 'readiness_review_required';
}

function ownerRoleForTask(event = {}, fallbackDomain = null) {
  const type = event.eventType || '';
  if (type.includes('evidence')) return 'ROLE_GRID_OPERATOR';
  if (type.includes('clarification')) return 'ROLE_GRID_OPERATOR';
  if (type.includes('handoff')) return 'ROLE_TENANT_ADMIN';
  if (fallbackDomain === 'market_communication') return 'ROLE_MARKET_COMMUNICATION';
  if (fallbackDomain === 'edm') return 'ROLE_EDM';
  if (fallbackDomain === 'grid_connection') return 'ROLE_GRID_PLANNING';
  return 'ROLE_GRID_OPERATOR';
}

function nextSafeActionForTask(task = {}) {
  switch (task.attentionState) {
    case 'evidence_required':
      return 'Fehlende Evidenz als EvidenceRef beifügen oder ausdrücklich klären, warum sie nicht verfügbar ist.';
    case 'clarification_required':
      return 'Rückfrage beantworten und CET Case über Workbench Chat fortführen.';
    case 'handoff_required':
      return 'Fachliche Übergabe prüfen und zuständige Rolle/Domain bestätigen.';
    case 'readiness_review_required':
      return 'Neue Evidenz prüfen; readinessState nicht automatisch auf ready setzen.';
    case 'domain_changed':
      return 'Domain-Wechsel prüfen und Fallkontext bestätigen.';
    case 'owner_gap_detected':
      return 'Zuständige Rolle oder Owner festlegen.';
    case 'related_session_reply':
      return 'Antwort aus verwandter Session prüfen und bei Bedarf in den Case übernehmen.';
    case 'policy_blocked':
      return 'Blockierte Aktion gegen No-Call-Guards/RBAC prüfen; keine externe Wirkung auslösen.';
    default:
      return 'Case Event prüfen und nächsten sicheren internen Schritt festlegen.';
  }
}

function taskIdForEvent(event = {}) {
  return `task_${event.eventId || `${event.cetCaseId || event.caseId}:${event.eventType}:${event.createdAt}`}`;
}

function taskFromEvent(event, { domain = null, existing = null } = {}) {
  const attentionState = attentionStateForEvent(event);
  const base = existing || {};
  const task = {
    ...base,
    taskId: base.taskId || taskIdForEvent(event),
    caseId: event.cetCaseId || event.caseId,
    cetCaseId: event.cetCaseId || event.caseId,
    eventIds: [...new Set([...(base.eventIds || []), event.eventId].filter(Boolean))],
    attentionState,
    severity: event.severity || base.severity || 'info',
    ownerRole: base.ownerRole || ownerRoleForTask(event, domain),
    assignedTo: base.assignedTo || null,
    blockingReason: base.blockingReason || event.eventType || attentionState,
    status: base.status || 'open',
    createdAt: base.createdAt || event.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resolvedAt: base.resolvedAt || null,
  };
  task.nextSafeAction = base.nextSafeAction || nextSafeActionForTask(task);
  return task;
}

function safeTask(task = {}) {
  return {
    taskId: task.taskId,
    caseId: task.caseId || task.cetCaseId,
    cetCaseId: task.cetCaseId || task.caseId,
    eventIds: task.eventIds || [],
    attentionState: task.attentionState,
    severity: task.severity,
    ownerRole: task.ownerRole,
    assignedTo: task.assignedTo || null,
    blockingReason: task.blockingReason || null,
    nextSafeAction: task.nextSafeAction || nextSafeActionForTask(task),
    dueAt: task.dueAt || null,
    status: task.status || 'open',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    resolvedAt: task.resolvedAt || null,
  };
}

module.exports = { taskFromEvent, safeTask, attentionStateForEvent, nextSafeActionForTask };
