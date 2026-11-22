'use strict';

/**
 * Provenance check of an answer (micro-agent tier; used by the answer path from Phase 4).
 * Every checkable detail of the answer – a token with a digit: identifiers, dates, amounts,
 * sections – must occur in a source of the turn: the person's message, the conversation, the
 * evidence (micro-agent facts included) or the case view. A detail found nowhere is unsourced:
 * the answer path revises only the sentences that hold it, instead of filtering by patterns.
 *
 * Deterministic and domain-free; a format check, no keyword list.
 */

const EDGE = '„“”"\'`()[]{}<>.,;:!?*|';

// Tokens of a text with surrounding punctuation removed.
function plainTokens(text) {
  return String(text ?? '')
    .split(/\s+/u)
    .map((token) => {
      let start = 0;
      let end = token.length;
      while (start < end && EDGE.includes(token[start])) start++;
      while (end > start && EDGE.includes(token[end - 1])) end--;
      return token.slice(start, end);
    })
    .filter(Boolean);
}

function detailTokens(text) {
  return plainTokens(text).filter((token) => [...token].some((ch) => ch >= '0' && ch <= '9'));
}

function sourceText({ message = '', conversation = [], evidence = [], caseView = null } = {}) {
  return [
    String(message),
    ...conversation.map((turn) => String(turn?.text ?? turn?.content ?? '')),
    ...evidence.map((hit) =>
      [hit.value, ...(hit.metadata?.facts || []).map((fact) => `${fact.statement} ${fact.value}`)]
        .filter(Boolean)
        .join('\n')
    ),
    caseView ? JSON.stringify(caseView) : '',
  ].join('\n');
}

// A sentence ends at a line break or at . ! ? followed by white space or the end; the dots of a
// date or number (20.05.2026) never end one.
function sentences(text) {
  const value = String(text ?? '');
  const parts = [];
  let begin = 0;
  for (let index = 0; index < value.length; index++) {
    const ch = value[index];
    const next = value[index + 1];
    const boundary =
      ch === '\n' || ('.!?'.includes(ch) && (next === undefined || ' \t\n'.includes(next)));
    if (!boundary) continue;
    const part = value.slice(begin, index + 1).trim();
    if (part) parts.push(part);
    begin = index + 1;
  }
  const rest = value.slice(begin).trim();
  if (rest) parts.push(rest);
  return parts;
}

function checkProvenance(answer, sources = {}) {
  const haystack = sourceText(sources);
  const unsourced = [];
  for (const sentence of sentences(answer)) {
    const missing = detailTokens(sentence).filter((token) => !haystack.includes(token));
    if (missing.length) unsourced.push({ sentence, tokens: [...new Set(missing)] });
  }
  return { unsourced, sourced: unsourced.length === 0 };
}

module.exports = { checkProvenance, detailTokens, plainTokens, sentences, sourceText };
