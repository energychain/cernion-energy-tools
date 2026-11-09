'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_LEDGER = path.join(os.homedir(), '.hermes', 'agent-os-scoped-approval-ledger.json');
const SUPPORTED_TYPES = new Set([
  'PUBLISH_SCOPE',
  'CONTENT_SCOPE',
  'SOCIAL_SCOPE',
  'MAIL_BATCH_SCOPE',
  'DNS_SCOPE',
  'DEPLOYMENT_SCOPE',
]);
const KNOWN_STATUSES = new Set(['active', 'consumed', 'expired', 'revoked']);
const TERMINAL_TASK_STATUSES = new Set(['archived', 'cancelled', 'completed', 'done', 'rejected']);
const ACTION_TERMS = {
  PUBLISH_SCOPE:
    /\b(publish|publikation|veröffentlichen|veroeffentlichen|live\s*schalten|build|deploy|staging|source|seite|web|cta|content|landingpage|smoke)\b/i,
  CONTENT_SCOPE:
    /\b(content|text|artikel|seite|web|landingpage|cta|publish|veröffentlichen|veroeffentlichen)\b/i,
  SOCIAL_SCOPE: /\b(social|linkedin|post|posting|publizieren|kommentar|community)\b/i,
  MAIL_BATCH_SCOPE: /\b(mail|email|e-mail|senden|versand|outreach|kontakt|follow-up|followup)\b/i,
  DNS_SCOPE: /\b(dns|cloudflare|record|cname|a-record|www|ssl|tls)\b/i,
  DEPLOYMENT_SCOPE:
    /\b(deploy|deployment|pm2|restart|build|server|prod|produktion|staging|smoke)\b/i,
};
const ESCAPE_TERMS =
  /\b(neue\s+claims?|new\s+claims?|anderer\s+kanal|other\s+channel|preis|price|angebot|offer|vertrag|contract|zahlung|payment|budget|kundendaten|customer\s+data|twl-roh|github\s*write|produktive\s+codeänderung|productive\s+code\s+change|deployment\s+außerhalb|deployment\s+outside|restart\s+außerhalb|restart\s+outside)\b/i;

function taskText(task) {
  return [
    task.id,
    task.title,
    task.body,
    task.result,
    task.block_reason,
    task.latest_summary,
    task.project_id,
    ...(task.comments || []).map((comment) => comment.body || comment.text),
  ]
    .filter(Boolean)
    .join('\n');
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [];
}

function validateScope(scope, index) {
  const errors = [];
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return { valid: false, errors: [`scopes[${index}] is not an object`] };
  }
  for (const field of ['id', 'type', 'status', 'source_board', 'source_task_id']) {
    if (typeof scope[field] !== 'string' || !scope[field].trim()) errors.push(`missing ${field}`);
  }
  if (!Number.isFinite(Number(scope.expires_at))) errors.push('invalid expires_at');
  if (!scope.terms || typeof scope.terms !== 'object' || Array.isArray(scope.terms)) {
    errors.push('invalid terms');
  } else {
    for (const field of ['domains', 'paths', 'tags', 'words']) {
      if (
        scope.terms[field] !== undefined &&
        (!Array.isArray(scope.terms[field]) ||
          scope.terms[field].some((item) => typeof item !== 'string'))
      ) {
        errors.push(`invalid terms.${field}`);
      }
    }
  }
  if (!SUPPORTED_TYPES.has(String(scope.type || '').toUpperCase())) errors.push('unsupported type');
  if (!KNOWN_STATUSES.has(String(scope.status || '').toLowerCase())) errors.push('unknown status');
  return { valid: errors.length === 0, errors };
}

function normalizeScope(scope) {
  const terms = scope.terms || {};
  return {
    id: scope.id,
    type: String(scope.type).toUpperCase(),
    status: String(scope.status).toLowerCase(),
    sourceBoard: scope.source_board,
    sourceTaskId: scope.source_task_id,
    sourceTitle: String(scope.source_title || ''),
    expiresAt: Number(scope.expires_at),
    allowedSummary: String(scope.allowed_summary || ''),
    forbiddenSummary: String(scope.forbidden_summary || ''),
    terms: {
      domains: stringList(terms.domains).map((item) => item.toLowerCase()),
      paths: stringList(terms.paths).map((item) => item.toLowerCase()),
      tags: stringList(terms.tags).map((item) => item.toLowerCase()),
      words: stringList(terms.words).map((item) => item.toLowerCase()),
    },
  };
}

function effectiveStatus(scope, now) {
  if (scope.status === 'active' && scope.expiresAt < now) return 'expired';
  return scope.status;
}

function materialOverlap(scope, lowered) {
  let score = 0;
  for (const domain of scope.terms.domains) if (lowered.includes(domain)) score += 4;
  for (const itemPath of scope.terms.paths) if (lowered.includes(itemPath)) score += 4;
  for (const tag of scope.terms.tags) if (lowered.includes(tag)) score += 3;
  for (const word of scope.terms.words.slice(0, 80)) {
    if (word.length >= 6 && lowered.includes(word)) score += 1;
  }
  return score;
}

function isStrongPath(value) {
  const segments = String(value || '')
    .split('/')
    .filter(Boolean);
  return segments.length >= 2 || /\.[a-z0-9]{2,8}$/i.test(String(value || ''));
}

function evaluateScope(scope, task, now) {
  if (TERMINAL_TASK_STATUSES.has(String(task.status || '').toLowerCase())) {
    return { state: 'not_covered', reason: 'terminal_task_status' };
  }
  const status = effectiveStatus(scope, now);
  if (status !== 'active') return { state: 'not_covered', reason: `scope_${status}` };
  if (scope.sourceTitle.toLowerCase().startsWith('[smoke]')) {
    return { state: 'not_covered', reason: 'smoke_scope_cannot_cover_work' };
  }
  if (
    task.board === 'twl-netze-bridge' &&
    !['CONTENT_SCOPE', 'PUBLISH_SCOPE'].includes(scope.type)
  ) {
    return { state: 'not_covered', reason: 'twl_bridge_scope_type_not_allowed' };
  }

  const text = taskText(task);
  const lowered = text.toLowerCase();
  const sourceReference = lowered.includes(scope.sourceTaskId.toLowerCase());
  const scopeReference = lowered.includes(scope.id.toLowerCase());
  const actionPattern = ACTION_TERMS[scope.type];
  const actionMatches = Boolean(actionPattern && actionPattern.test(text));
  const exactPath = scope.terms.paths.some((item) => isStrongPath(item) && lowered.includes(item));
  const exactTag = scope.terms.tags.some((item) => lowered.includes(item));
  const domainMatch = scope.terms.domains.some((item) => lowered.includes(item));
  const score = materialOverlap(scope, lowered);

  if ((sourceReference || scopeReference) && ESCAPE_TERMS.test(text)) {
    return { state: 'unclear', reason: 'explicit_reference_with_possible_scope_escape' };
  }
  if (!actionMatches) return { state: 'not_covered', reason: 'action_type_mismatch' };
  if (sourceReference) return { state: 'covered', reason: 'source_task_reference' };
  if (scopeReference) return { state: 'covered', reason: 'scope_id_reference' };
  if (task.board !== scope.sourceBoard) {
    return exactPath || exactTag
      ? { state: 'covered', reason: exactPath ? 'cross_board_exact_path' : 'cross_board_exact_tag' }
      : { state: 'not_covered', reason: 'cross_board_requires_exact_path_or_tag' };
  }
  if (exactPath || exactTag) {
    return {
      state: 'covered',
      reason: exactPath ? 'same_board_exact_path' : 'same_board_exact_tag',
    };
  }
  if (domainMatch && score >= 7) {
    return { state: 'covered', reason: 'same_board_domain_and_material_overlap' };
  }
  if (domainMatch) return { state: 'unclear', reason: 'domain_only_match_is_too_broad' };
  return { state: 'not_covered', reason: 'insufficient_material_overlap' };
}

class ScopedApprovalReader {
  constructor(options = {}) {
    this.ledgerPath = path.resolve(
      options.ledgerPath || process.env.AGENTOS_SCOPE_LEDGER || DEFAULT_LEDGER
    );
    this.now = Number(options.now || Math.floor(Date.now() / 1000));
    this.scopes = [];
    this.diagnostics = { available: false, validScopes: 0, invalidScopes: 0, statuses: {} };
  }

  load() {
    let raw;
    try {
      const descriptor = fs.openSync(this.ledgerPath, 'r');
      try {
        raw = fs.readFileSync(descriptor, 'utf8');
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error) {
      this.diagnostics = {
        ...this.diagnostics,
        error: `ledger_unavailable:${error.code || 'read_error'}`,
      };
      return this;
    }

    let ledger;
    try {
      ledger = JSON.parse(raw);
    } catch (_error) {
      this.diagnostics = { ...this.diagnostics, error: 'ledger_invalid_json' };
      return this;
    }
    if (!ledger || typeof ledger !== 'object' || !Array.isArray(ledger.scopes)) {
      this.diagnostics = { ...this.diagnostics, error: 'ledger_invalid_root_schema' };
      return this;
    }

    const errors = [];
    this.scopes = ledger.scopes.flatMap((scope, index) => {
      const result = validateScope(scope, index);
      if (!result.valid) {
        errors.push({ index, errors: result.errors });
        return [];
      }
      return [normalizeScope(scope)];
    });
    const statuses = {};
    for (const scope of this.scopes) {
      const status = effectiveStatus(scope, this.now);
      statuses[status] = (statuses[status] || 0) + 1;
    }
    this.diagnostics = {
      available: true,
      validScopes: this.scopes.length,
      invalidScopes: errors.length,
      statuses,
      schemaVersion: ledger.version ?? null,
      errors,
    };
    return this;
  }

  evaluate(task) {
    if (!this.diagnostics.available) {
      return {
        state: 'unclear',
        reason: this.diagnostics.error || 'ledger_unavailable',
        matches: [],
      };
    }
    const matches = this.scopes.map((scope) => ({
      scopeId: scope.id,
      scopeType: scope.type,
      sourceBoard: scope.sourceBoard,
      sourceTaskId: scope.sourceTaskId,
      expiresAt: scope.expiresAt,
      allowedSummary: scope.allowedSummary,
      forbiddenSummary: scope.forbiddenSummary,
      ...evaluateScope(scope, task, this.now),
    }));
    const covered = matches.filter((match) => match.state === 'covered');
    const unclear = matches.filter((match) => match.state === 'unclear');
    if (covered.length)
      return { state: 'covered', reason: 'matching_active_scope', matches: covered };
    if (unclear.length)
      return { state: 'unclear', reason: 'possible_scope_match_requires_review', matches: unclear };
    return { state: 'not_covered', reason: 'no_active_scope_matches', matches: [] };
  }

  enrichSource(source) {
    const decisionCounts = { covered: 0, not_covered: 0, unclear: 0 };
    const boards = source.boards.map((board) => ({
      ...board,
      items: board.items.map((task) => {
        const scopeDecision = this.evaluate(task);
        decisionCounts[scopeDecision.state] += 1;
        return { ...task, scopeCovered: scopeDecision.state === 'covered', scopeDecision };
      }),
    }));
    return {
      ...source,
      boards,
      scopeLedger: { ...this.diagnostics, decisionCounts, path: this.ledgerPath },
    };
  }
}

module.exports = {
  DEFAULT_LEDGER,
  ScopedApprovalReader,
  effectiveStatus,
  evaluateScope,
  taskText,
  validateScope,
};
