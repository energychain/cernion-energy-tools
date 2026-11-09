'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_POLICY_PATH = path.join(__dirname, '..', 'config', 'outcome-types.json');
const COMPLETED_STATES = new Set(['done', 'completed']);

function loadOutcomePolicy(policyPath = DEFAULT_POLICY_PATH) {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  if (!policy.types || typeof policy.types !== 'object') {
    throw new Error('outcome policy requires types');
  }
  return policy;
}

function taskText(task) {
  return [
    task.title,
    task.body,
    task.result,
    ...(task.comments || []).map((comment) => comment.body),
  ]
    .filter(Boolean)
    .join('\n');
}

function markerValues(text, marker) {
  const expression = new RegExp(`^\\s*${marker}\\s*:\\s*(.+?)\\s*$`, 'gim');
  return Array.from(text.matchAll(expression), (match) => match[1].trim()).filter(Boolean);
}

function parseBoolean(value) {
  return /^(1|true|yes|ja)$/i.test(String(value || '').trim());
}

function normalizeEvidence(value) {
  return String(value || '')
    .trim()
    .replace(/^<(.+)>$/, '$1')
    .replace(/[`\\]+$/g, '')
    .replace(/[),.;]+$/g, '');
}

function extractEvidence(task, text, policy) {
  const candidates = [];
  const explicit = task.outcome?.evidenceRefs || task.outcomeEvidence || [];
  candidates.push(...(Array.isArray(explicit) ? explicit : [explicit]));
  for (const value of markerValues(text, 'OUTCOME_EVIDENCE')) {
    candidates.push(...value.split(/\s*[;,]\s*/));
  }
  candidates.push(...(text.match(/https?:\/\/[^\s<>"'`\\]+/gi) || []));

  const prefixes = (policy.evidencePrefixes || []).map((prefix) =>
    prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  if (prefixes.length) {
    const identifierPattern = new RegExp(
      `\\b(?:${prefixes.join('|')})\\s*[:=]\\s*[^\\s,;<>]+`,
      'gi'
    );
    candidates.push(...(text.match(identifierPattern) || []));
  }

  return Array.from(new Set(candidates.map(normalizeEvidence).filter(isMaterialEvidence))).sort();
}

function isMaterialEvidence(value) {
  const evidence = String(value || '').trim();
  if (!evidence) return false;
  if (/^https?:\/\/\S+$/i.test(evidence)) return true;
  if (/^url\s*[:=]/i.test(evidence)) {
    return /^url\s*[:=]\s*https?:\/\/\S+$/i.test(evidence);
  }
  if (/^(?:kanban|task):/i.test(evidence)) return false;
  return /^[a-z][a-z0-9_-]*-?(?:id)?\s*[:=]\s*.{3,}$/i.test(evidence);
}

function parseOccurredAt(task, text) {
  const explicit = task.outcome?.occurredAt || markerValues(text, 'OUTCOME_OCCURRED_AT')[0];
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const numeric = Number(explicit);
    if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
    const parsed = Date.parse(String(explicit));
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  const fallback = Number(task.completed_at || task.completedAt || 0);
  return Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 0;
}

function inferOutcomeType(text, policy) {
  const matches = [];
  for (const [type, definition] of Object.entries(policy.types)) {
    for (const pattern of definition.patterns || []) {
      if (new RegExp(pattern, 'i').test(text)) {
        matches.push(type);
        break;
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function cleanStatement(task, text) {
  const explicit = task.outcome?.statement || markerValues(text, 'OUTCOME_STATEMENT')[0];
  if (explicit) return String(explicit).trim();
  const result = String(task.result || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^OUTCOME_[A-Z_]+\s*:/i.test(line))
    .join(' ')
    .trim();
  return result || String(task.title || '').trim();
}

function sourceTimestamp(task) {
  return Number(task.completed_at || task.completedAt || task.started_at || task.created_at || 0);
}

function evaluateOutcome(task, options = {}) {
  const policy = options.policy || loadOutcomePolicy(options.policyPath);
  const status = String(task.status || '').toLowerCase();
  if (!COMPLETED_STATES.has(status)) {
    return { accepted: false, reason: 'source_not_completed' };
  }

  const text = taskText(task);
  const resultText = String(task.result || '').trim();
  const explicitType = task.outcome?.type || markerValues(text, 'OUTCOME_TYPE')[0];
  const outcomeType = explicitType || (resultText ? inferOutcomeType(resultText, policy) : null);
  if (!outcomeType || !policy.types[outcomeType]) {
    return { accepted: false, reason: explicitType ? 'unknown_outcome_type' : 'no_outcome_signal' };
  }

  const definition = policy.types[outcomeType];
  if (definition.publish === false || definition.kind === 'internal_precursor') {
    return { accepted: false, reason: 'internal_precursor', outcomeType };
  }

  const statement = cleanStatement(task, text);
  const internalActivity = (policy.internalActivityPatterns || []).some((pattern) =>
    new RegExp(pattern, 'i').test(statement)
  );
  if (!explicitType && internalActivity) {
    return { accepted: false, reason: 'internal_activity_only', outcomeType };
  }

  const evidenceRefs = extractEvidence(task, explicitType ? text : resultText, policy);
  if (!evidenceRefs.length) {
    return { accepted: false, reason: 'material_evidence_missing', outcomeType };
  }

  const occurredAt = parseOccurredAt(task, text);
  if (!occurredAt) {
    return { accepted: false, reason: 'occurred_at_missing', outcomeType };
  }

  const finalMarker = task.outcome?.final ?? markerValues(text, 'OUTCOME_FINAL')[0];
  const impactKind = definition.kind;
  if (!['external', 'final'].includes(impactKind)) {
    return { accepted: false, reason: 'not_external_or_final', outcomeType };
  }
  if (impactKind === 'final' && finalMarker !== undefined && !parseBoolean(finalMarker)) {
    return { accepted: false, reason: 'finality_not_confirmed', outcomeType };
  }

  return {
    accepted: true,
    outcome: {
      source_board: String(task.board || ''),
      source_task_id: String(task.id || ''),
      outcome_type: outcomeType,
      statement,
      evidence_refs_json: JSON.stringify(evidenceRefs),
      occurred_at: occurredAt,
      counterparty:
        task.outcome?.counterparty || markerValues(text, 'OUTCOME_COUNTERPARTY')[0] || null,
      economic_relevance:
        task.outcome?.economicRelevance ||
        markerValues(text, 'OUTCOME_ECONOMIC_RELEVANCE')[0] ||
        null,
      confidence: explicitType ? 1 : 0.9,
      impact_kind: impactKind,
      evidence_key: evidenceRefs[0].toLowerCase(),
      source_timestamp: sourceTimestamp(task),
    },
  };
}

function outcomeId(outcome) {
  const digest = crypto
    .createHash('sha256')
    .update([outcome.outcome_type, outcome.evidence_key].join('\0'))
    .digest('hex')
    .slice(0, 24);
  return `outcome_${digest}`;
}

function projectOutcomes(tasks, options = {}) {
  const acceptedByEvent = new Map();
  const rejected = [];
  const sortedTasks = [...tasks].sort((left, right) => {
    const leftKey = `${left.board || ''}\0${left.id || ''}`;
    const rightKey = `${right.board || ''}\0${right.id || ''}`;
    return leftKey.localeCompare(rightKey);
  });

  for (const task of sortedTasks) {
    const evaluation = evaluateOutcome(task, options);
    if (!evaluation.accepted) {
      rejected.push({ board: task.board, taskId: task.id, reason: evaluation.reason });
      continue;
    }
    const candidate = evaluation.outcome;
    const key = `${candidate.outcome_type}\0${candidate.evidence_key}`;
    const previous = acceptedByEvent.get(key);
    if (
      !previous ||
      candidate.evidence_refs_json.length > previous.evidence_refs_json.length ||
      candidate.statement.length > previous.statement.length
    ) {
      acceptedByEvent.set(key, candidate);
    }
  }

  const outcomes = Array.from(acceptedByEvent.values()).map((candidate) => {
    const row = { ...candidate, outcome_id: outcomeId(candidate) };
    delete row.impact_kind;
    delete row.evidence_key;
    delete row.source_timestamp;
    return row;
  });
  return { outcomes, rejected };
}

module.exports = {
  DEFAULT_POLICY_PATH,
  evaluateOutcome,
  extractEvidence,
  inferOutcomeType,
  loadOutcomePolicy,
  projectOutcomes,
};
