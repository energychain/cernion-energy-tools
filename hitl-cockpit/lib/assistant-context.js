'use strict';

const crypto = require('node:crypto');

const OPERATIONS = {
  topic: 'topic',
  decision: 'decision',
  department: 'departments',
  outcome: 'outcome',
  risk: 'risk',
  wakeup: 'wakeup',
};
const ALLOWLISTS = {
  topic: [
    'topic_id',
    'title',
    'business_goal',
    'owner_agent',
    'participating_agents',
    'current_state',
    'next_step',
    'expected_progress_at',
    'impact_statement',
    'last_substantive_progress_at',
    'updated_at',
  ],
  decision: [
    'decision_id',
    'decision_class',
    'question',
    'reason_human_required',
    'recommendation',
    'options',
    'consequences',
    'deadline',
    'non_decision_effect',
    'execution_scope',
    'excluded_scope',
    'status',
    'classifier_label',
    'confidence',
    'updated_at',
  ],
  department: [
    'agent_id',
    'reporting_period_start',
    'reporting_period_end',
    'current_goal',
    'active_topic_refs',
    'outcomes',
    'next_actions',
    'dependencies',
    'risks',
    'needs_management',
    'last_substantive_progress_at',
    'brief_status',
    'empty_state_reason',
    'updated_at',
  ],
  outcome: [
    'outcome_id',
    'topic_id',
    'outcome_type',
    'statement',
    'occurred_at',
    'economic_relevance',
    'confidence',
  ],
  risk: [
    'decision_id',
    'topic_id',
    'decision_class',
    'question',
    'reason_human_required',
    'recommendation',
    'options',
    'consequences',
    'deadline',
    'non_decision_effect',
    'status',
    'classifier_label',
    'confidence',
    'updated_at',
  ],
  wakeup: [
    'wakeup_id',
    'wake_at',
    'why_scheduled',
    'next_action_on_wake',
    'signal_required',
    'auto_close_after',
    'owner_agent',
    'status',
    'last_signal_at',
  ],
};

class AssistantContextError extends Error {
  constructor() {
    super('assistant_context_not_available');
    this.code = 'assistant_context_not_available';
    this.status = 404;
  }
}
function unavailable() {
  throw new AssistantContextError();
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])])
  );
}
function camel(key) {
  return key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}
function normalizedText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase();
}
function forbiddenText(value) {
  const text = normalizedText(value);
  const collapsed = text.replace(/[^a-z0-9äöüß]+/g, '');
  return (
    /(?:^|[^a-z])(?:private|secret|restricted)(?:[^a-z]|$)/u.test(text) ||
    /mixed[\W_]*sensitive|raw[\W_]*bridge|private[\W_]*(?:board|lane|room|quarantine|metadata|id)/u.test(
      text
    ) ||
    collapsed.includes('twlnetze') ||
    collapsed.includes('unclear') ||
    /(?:^|[^a-z])t\W*w\W*l(?:[^a-z]|$)/u.test(text) ||
    /\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|bearer|password|cookie|session[_-]?(?:id|token))\b\s*[:=/]/u.test(
      text
    )
  );
}
function containsSensitiveMarker(value, key = '') {
  if (forbiddenText(key)) return true;
  if (Array.isArray(value)) return value.some((item) => containsSensitiveMarker(item, key));
  if (value && typeof value === 'object')
    return Object.entries(value).some(([childKey, child]) =>
      containsSensitiveMarker(child, childKey)
    );
  return typeof value === 'string' && forbiddenText(value);
}
function allowlist(type, row) {
  const output = {};
  for (const key of ALLOWLISTS[type]) {
    if (row[key] !== undefined && row[key] !== null) output[camel(key)] = row[key];
  }
  return output;
}
function safeTaskRefs(row) {
  const raw = [];
  if (Array.isArray(row.source_task_refs)) raw.push(...row.source_task_refs);
  if (row.source_board && row.source_task_id)
    raw.push({ board: row.source_board, taskId: row.source_task_id });
  return raw
    .map((ref) => ({
      board: String(ref.board || ''),
      taskId: String(ref.taskId || ref.task_id || ''),
    }))
    .filter(
      (ref) =>
        /^[a-z0-9][a-z0-9_.-]{0,80}$/.test(ref.board) &&
        /^t_[a-z0-9]{6,64}$/.test(ref.taskId) &&
        !forbiddenText(ref.board)
    );
}
function safeMatrixRef(row) {
  const value = String(row.matrix_room_ref || '');
  return /^![^\s:]{6,}:[a-z0-9.-]+$/i.test(value) && !forbiddenText(value)
    ? { roomRef: value }
    : null;
}
function labels(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) =>
      typeof item === 'string'
        ? item
        : (item && item.title) || (item && item.label) || (item && item.type)
    )
    .filter((item) => typeof item === 'string' && item.length <= 160 && !forbiddenText(item))
    .map((label) => ({ label }));
}
function sanitizedReferences(row) {
  const result = {};
  const tasks = safeTaskRefs(row);
  if (tasks.length) result.sourceTasks = tasks;
  const matrix = safeMatrixRef(row);
  if (matrix) result.matrixRoom = matrix;
  const artifacts = labels(row.artifact_refs || row.topic_artifact_refs);
  if (artifacts.length) result.artifacts = artifacts;
  const evidence = labels(row.evidence_refs);
  if (evidence.length) result.evidence = evidence;
  return result;
}

function createAssistantContextResolver(options = {}) {
  if (!options.reader || typeof options.reader.read !== 'function')
    throw new Error('ManagementReader is required');
  const reader = options.reader;
  const maxBytes = options.maxBytes || 12000;
  return {
    resolve(input = {}) {
      const objectType = input.objectType === null ? 'global' : input.objectType;
      const objectId = input.objectId === undefined ? null : input.objectId;
      let payload;
      try {
        if (objectType === 'global' || objectType === undefined) {
          if (objectId !== null) unavailable();
          const overview = reader.read('overview');
          if (containsSensitiveMarker(overview && overview.counts)) unavailable();
          payload = stable({ counts: overview && overview.counts ? overview.counts : {} });
        } else {
          const operation = OPERATIONS[objectType];
          if (!operation || typeof objectId !== 'string' || !objectId || forbiddenText(objectId))
            unavailable();
          const result = reader.read(operation, { id: objectId });
          const row = result && result.item;
          if (!row || containsSensitiveMarker(row)) unavailable();
          payload = stable({ ...allowlist(objectType, row), references: sanitizedReferences(row) });
          if (Object.keys(payload).length === 0) unavailable();
        }
      } catch (error) {
        if (error instanceof AssistantContextError) throw error;
        unavailable();
      }
      if (containsSensitiveMarker(payload)) unavailable();
      const canonical = JSON.stringify(
        stable({ objectType: objectType || 'global', objectId, payload })
      );
      if (Buffer.byteLength(canonical, 'utf8') > maxBytes) unavailable();
      return {
        objectType: objectType || 'global',
        objectId,
        payload,
        fingerprint: crypto.createHash('sha256').update(canonical).digest('hex'),
      };
    },
  };
}
module.exports = {
  AssistantContextError,
  createAssistantContextResolver,
  stable,
  containsSensitiveMarker,
};
