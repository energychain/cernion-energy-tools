'use strict';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getByPath(source, path) {
  if (!isPlainObject(source) || typeof path !== 'string' || !path.trim()) {
    return undefined;
  }

  const segments = path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

  let cursor = source;
  for (const segment of segments) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) return undefined;
    cursor = cursor[segment];
    if (cursor === undefined || cursor === null) return cursor;
  }

  return cursor;
}

function hasUsableValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function toTerms(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function evaluateReceiptMatch(receipt, context = {}) {
  const matching = isPlainObject(receipt?.matching) ? receipt.matching : {};
  const reasons = [];
  const missingEntities = [];
  const textTerms = new Set(toTerms(context.question || context.message || ''));
  const domain = String(context.domain || '')
    .trim()
    .toLowerCase();
  const workflowType = String(context.workflowType || '')
    .trim()
    .toLowerCase();

  let score = 0;

  const domains = Array.isArray(matching.domains) ? matching.domains : [];
  if (domains.length > 0) {
    if (domain && domains.map((entry) => String(entry).toLowerCase()).includes(domain)) {
      score += 35;
      reasons.push(`domain:${domain}`);
    } else if (domain) {
      score -= 10;
      reasons.push(`domain-mismatch:${domain}`);
    }
  }

  const triggerTerms = Array.isArray(matching.triggerTerms) ? matching.triggerTerms : [];
  let triggerHits = 0;
  for (const term of triggerTerms) {
    const token = String(term || '')
      .trim()
      .toLowerCase();
    if (!token) continue;
    if (textTerms.has(token)) {
      triggerHits += 1;
      reasons.push(`trigger:${token}`);
    }
  }
  if (triggerHits > 0) {
    score += Math.min(30, triggerHits * 8);
  }

  const workflowTypes = Array.isArray(matching.workflowTypes) ? matching.workflowTypes : [];
  if (workflowTypes.length > 0 && workflowType) {
    if (workflowTypes.map((entry) => String(entry).toLowerCase()).includes(workflowType)) {
      score += 15;
      reasons.push(`workflow:${workflowType}`);
    } else {
      score -= 5;
      reasons.push(`workflow-mismatch:${workflowType}`);
    }
  }

  const requiredEntities = Array.isArray(matching.requiredEntities)
    ? matching.requiredEntities
    : [];
  for (const entity of requiredEntities) {
    const key = String(entity || '').trim();
    if (!key) continue;
    const value = getByPath(context, key);
    if (hasUsableValue(value)) {
      score += 5;
      reasons.push(`entity:${key}`);
    } else {
      score -= 8;
      missingEntities.push(key);
    }
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    matched: score >= 30,
    reasons,
    missingEntities,
  };
}

module.exports = {
  evaluateReceiptMatch,
  getByPath,
  hasUsableValue,
};
