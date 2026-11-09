'use strict';

const policy = require('../config/classifier-policy.json');
const { isPrivateTask } = require('./context-links');
const { validateWakeupContract } = require('./wakeup-service');

function textOf(task) {
  return [task.title, task.body, task.result, ...(task.comments || []).map((item) => item.body)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function includesPattern(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
}

function hasCompleteWakeup(task) {
  return validateWakeupContract(task).valid;
}

function classifyTask(task, options = {}) {
  const activePolicy = options.policy || policy;
  const board = String(task.board || '');
  const sensitivity = String(task.sensitivity || '').toLowerCase();
  const text = textOf(task);

  if (
    activePolicy.privateBoards.includes(board) ||
    activePolicy.sensitiveValues.includes(sensitivity) ||
    task.sensitivityUnclear === true ||
    isPrivateTask(task)
  ) {
    return {
      excluded: true,
      label: null,
      reasons: ['sensitive_or_private_source'],
      confidence: 1,
      classifierVersion: activePolicy.version,
    };
  }

  if (task.scopeCovered === true) {
    const reasons = ['active_scope_covers_action'];
    const matchReasons = (task.scopeDecision?.matches || [])
      .map((match) => match.reason)
      .filter(Boolean);
    return result('SCOPE_COVERED', [...new Set([...reasons, ...matchReasons])], 1, activePolicy);
  }

  if (task.scopeDecision?.state === 'unclear' && task.scopeDecision.matches?.length) {
    return result(
      'RISK_ESCALATION',
      ['possible_scope_violation', ...task.scopeDecision.matches.map((match) => match.reason)],
      1,
      activePolicy
    );
  }

  if (
    task.duplicateOf ||
    task.isDigest === true ||
    task.isNoise === true ||
    includesPattern(text, activePolicy.noisePatterns)
  ) {
    return result(
      'NOISE',
      [task.duplicateOf ? 'duplicate' : 'noise_or_digest'],
      0.99,
      activePolicy
    );
  }

  if (String(task.status).toLowerCase() === 'scheduled') {
    if (hasCompleteWakeup(task)) {
      return result('SCHEDULED', ['complete_wakeup_contract'], 1, activePolicy);
    }
    return incomplete('scheduled_without_complete_wakeup_contract', activePolicy);
  }

  if (task.riskBoundary === true || includesPattern(text, activePolicy.riskPatterns)) {
    if (task.hasDecisionOptions === true || task.decisionQuestion) {
      return result(
        'DECISION_REQUIRED',
        ['business_decision_with_material_risk'],
        0.98,
        activePolicy
      );
    }
    return result(
      'RISK_ESCALATION',
      ['binding_financial_legal_or_operational_boundary'],
      0.98,
      activePolicy
    );
  }

  if (task.inputRequired === true || includesPattern(text, activePolicy.inputPatterns)) {
    return result('INPUT_REQUIRED', ['specific_personal_input_missing'], 0.98, activePolicy);
  }

  if (
    activePolicy.completionStatuses.includes(String(task.status).toLowerCase()) &&
    (String(task.result || '').trim() || task.evidenceRefs?.length)
  ) {
    return result('INFORM_ONLY', ['completed_with_evidence'], 0.99, activePolicy);
  }

  if (task.reversibleInternal === true) {
    return result('AUTO_EXECUTE', ['reversible_internal_work'], 0.98, activePolicy);
  }

  return incomplete('insufficient_structured_classification_evidence', activePolicy);
}

function result(label, reasons, confidence, activePolicy) {
  return {
    excluded: false,
    projectionIncomplete: false,
    label,
    reasons,
    confidence,
    classifierVersion: activePolicy.version,
  };
}

function incomplete(reason, activePolicy) {
  return {
    excluded: false,
    projectionIncomplete: true,
    routeTo: 'Rhajaina',
    label: 'projection_incomplete',
    reasons: [reason],
    confidence: 1,
    classifierVersion: activePolicy.version,
  };
}

module.exports = { classifyTask, hasCompleteWakeup, policy };
