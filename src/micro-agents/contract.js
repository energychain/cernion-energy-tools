'use strict';

/**
 * Contract of the micro-agent tier (Phase 0). Domain-free: the kinds of objects and every
 * subject-matter term come from the registered packs, never from this core.
 *
 * - An object is something the person or an attachment mentions (an identifier, a message, a
 *   period, a concern) with its provenance.
 * - A finding is what one pack established about one object: facts with basis and provenance,
 *   relations, expectations, negative results with their scope, open questions.
 *
 * Safety rules that hold regardless of the pack:
 * - a fact without a source is dropped;
 * - a deadline or control date is accepted only with basis rule, source, person or case, never
 *   from the model (REG-01: invented control dates);
 * - a negative result always carries what was searched and where (its scope).
 */

const BASES = ['parsed', 'source', 'rule', 'case', 'person', 'model'];
const ROLES = [
  'identifier',
  'reference',
  'period',
  'deadline',
  'date',
  'monetary',
  'quantity',
  'status',
  'classification',
  'explanation',
  'other',
];
const RELATIONS = ['answers', 'refers_to', 'belongs_to', 'expects', 'supersedes', 'affects'];
const ORIGINS = ['message', 'attachment', 'conversation', 'case', 'finding'];
const DATED_ROLES = new Set(['deadline']);
const DATED_BASES = new Set(['rule', 'source', 'person', 'case']);
// The person's concern itself: every pack may expand it, so a question without a recognizable
// object still reaches the responsible packs.
const CONCERN_KIND = 'concern';

const LIMITS = {
  facts: 24,
  relations: 12,
  expectations: 8,
  negatives: 8,
  openQuestions: 4,
  text: 600,
  quote: 300,
};

const text = (value, max = LIMITS.text) => String(value ?? '').slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

function normalizeObject(raw = {}, index = 0) {
  return {
    objectId: text(raw.objectId || `O${index + 1}`, 40),
    kind: text(raw.kind, 80),
    value: text(raw.value, 300),
    label: text(raw.label, 120),
    provenance: {
      origin: oneOf(raw.provenance?.origin, ORIGINS, 'message'),
      ref: text(raw.provenance?.ref, 200),
      quote: text(raw.provenance?.quote, LIMITS.quote),
    },
    confidence: Math.min(1, Math.max(0, Number(raw.confidence ?? 1) || 0)),
  };
}

/**
 * Validates and sanitizes one finding. Returns the cleaned finding and the reasons of every
 * dropped part, so the trace shows what a pack delivered that the contract refused.
 */
function normalizeFinding(raw = {}, { pack, objectId } = {}) {
  const dropped = [];
  const facts = [];
  for (const [index, fact] of list(raw.facts).slice(0, LIMITS.facts).entries()) {
    const basis = oneOf(fact?.basis, BASES, 'model');
    const role = oneOf(fact?.role, ROLES, 'other');
    const source = text(fact?.provenance?.source, 200);
    if (!text(fact?.statement).trim()) {
      dropped.push({ index, reason: 'empty_statement' });
      continue;
    }
    if (!source && basis !== 'model') {
      dropped.push({ index, reason: 'missing_source' });
      continue;
    }
    if (DATED_ROLES.has(role) && !DATED_BASES.has(basis)) {
      dropped.push({ index, reason: 'deadline_without_rule' });
      continue;
    }
    facts.push({
      factId: text(fact.factId || `${pack || 'P'}-${objectId || 'O'}-F${facts.length + 1}`, 80),
      statement: text(fact.statement),
      value: text(fact.value, 300),
      unit: text(fact.unit, 40),
      role,
      basis,
      validFrom: text(fact.validFrom, 40),
      validTo: text(fact.validTo, 40),
      provenance: {
        source: source || 'model',
        ref: text(fact.provenance?.ref, 200),
        quote: text(fact.provenance?.quote, LIMITS.quote),
      },
    });
  }
  const negatives = [];
  for (const [index, negative] of list(raw.negatives).slice(0, LIMITS.negatives).entries()) {
    const searched = text(negative?.searched, 300);
    const scope = text(negative?.scope, 300);
    if (!searched || !scope) {
      dropped.push({ index, reason: 'negative_without_scope' });
      continue;
    }
    negatives.push({ searched, scope, result: text(negative.result || 'no_hit', 80) });
  }
  return {
    finding: {
      pack: text(pack || raw.pack, 80),
      objectId: text(objectId || raw.objectId, 40),
      facts,
      relations: list(raw.relations)
        .slice(0, LIMITS.relations)
        .map((row) => ({
          from: text(row?.from, 80),
          rel: oneOf(row?.rel, RELATIONS, 'refers_to'),
          to: text(row?.to, 300),
        }))
        .filter((row) => row.from && row.to),
      expectations: list(raw.expectations)
        .slice(0, LIMITS.expectations)
        .map((row) => ({
          what: text(row?.what),
          dueFactId: text(row?.dueFactId, 80),
          basis: oneOf(row?.basis, BASES, 'model'),
        }))
        // A due date is only a reference to an accepted fact, never a free value.
        .map((row) =>
          row.dueFactId && !facts.some((fact) => fact.factId === row.dueFactId)
            ? { ...row, dueFactId: '' }
            : row
        )
        .filter((row) => row.what),
      negatives,
      openQuestions: list(raw.openQuestions)
        .slice(0, LIMITS.openQuestions)
        .map((row) => ({ question: text(row?.question, 300), resolves: text(row?.resolves, 300) }))
        .filter((row) => row.question),
      confidence: Math.min(1, Math.max(0, Number(raw.confidence ?? 0.5) || 0)),
      elapsedMs: Math.max(0, Math.round(Number(raw.elapsedMs) || 0)),
    },
    dropped,
  };
}

// A finding as answer evidence: one hit per finding, its facts with provenance as text the answer
// can cite, the structured facts in metadata for the provenance check.
function findingEvidence(findings, { packLabels = {} } = {}) {
  return findings
    .filter((finding) => finding.facts.length || finding.negatives.length)
    .map((finding, index) => {
      const lines = [
        ...finding.facts.map(
          (fact) =>
            `${fact.statement}${fact.value ? ` [${fact.value}${fact.unit ? ` ${fact.unit}` : ''}]` : ''} (Herkunft: ${fact.provenance.source}${fact.provenance.ref ? `, ${fact.provenance.ref}` : ''}; Grundlage: ${fact.basis})`
        ),
        ...finding.negatives.map(
          (negative) =>
            `Gesucht: ${negative.searched}; Reichweite: ${negative.scope}; Ergebnis: ${negative.result}`
        ),
        ...finding.expectations.map((row) => `Erwartet: ${row.what}`),
      ];
      return {
        evidenceId: `MA${index + 1}`,
        source: `micro-agent.${finding.pack}`,
        title: packLabels[finding.pack] || finding.pack,
        retrievalSource: 'micro-agent',
        value: lines.join('\n'),
        metadata: {
          answerOnly: 'micro-agent',
          pack: finding.pack,
          objectId: finding.objectId,
          facts: finding.facts,
          negatives: finding.negatives,
          relations: finding.relations,
        },
      };
    });
}

module.exports = {
  BASES,
  ROLES,
  RELATIONS,
  ORIGINS,
  CONCERN_KIND,
  LIMITS,
  normalizeObject,
  normalizeFinding,
  findingEvidence,
};
