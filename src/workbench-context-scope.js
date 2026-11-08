'use strict';

// Conversation scope of an answer (TWL CTX-01, operator decision of 2026-11-08): an answer uses
// the active conversation, its case and the material attached in it. Other cases and documents
// stored from other conversations enter only when the person asks for knowledge beyond this
// conversation (contextScope, stored knowledge or case search in the understanding) or names a
// reference that occurs in that material; they then carry their origin. Team memory is already selected by the subjects
// (anchors) the message names and states its author, so it is not filtered again here.

const { referenceCandidates } = require('./workbench-identifier-context');

const OTHER_CONVERSATION = 'aus anderem Gespräch';
const OTHER_CASE = 'aus anderem Fall';

function explicitTenantRequest(situation = {}) {
  return Boolean(situation?.selfKnowledge?.requested || situation?.caseSearch?.requested);
}

// The understanding judges whether the question needs knowledge beyond this conversation.
function tenantScope(situation = {}) {
  return explicitTenantRequest(situation) || situation?.contextScope === 'tenant';
}

function sharesReference(text, references) {
  if (!references.size) return false;
  const value = String(text || '');
  if (referenceCandidates({ text: value }).some((reference) => references.has(reference)))
    return true;
  // Named identifiers of the understanding may contain spaces or no digit (e.g. object names).
  const lower = value.toLowerCase();
  return [...references].some(
    (reference) => reference.length >= 4 && lower.includes(reference.toLowerCase())
  );
}

// null: the hit belongs to this conversation or is not conversation material (e.g. curated
// knowledge base, tools, regulation); otherwise the origin label of foreign material.
function foreignOrigin(hit, { conversationId, caseId }) {
  const metadata = hit?.metadata || {};
  if (hit?.retrievalSource === 'tenant-memory' || hit?.source === 'tenant-memory') return null;
  if (hit?.source === 'related_case')
    return caseId && metadata.cetCaseId === caseId ? null : OTHER_CASE;
  if (metadata.conversationState) return null;
  if (Array.isArray(metadata.documentRefs)) {
    const refs = metadata.documentRefs;
    if (!refs.length) return null;
    const own = refs.some(
      (ref) =>
        (conversationId && ref?.conversationId === conversationId) ||
        (caseId && ref?.caseId === caseId)
    );
    return own ? null : OTHER_CONVERSATION;
  }
  return null;
}

// Source name and content stay as they are (citations, passages and grounding use them); the
// origin travels as metadata into the answer evidence.
function labelled(hit, origin) {
  return { ...hit, metadata: { ...hit.metadata, scopeOrigin: origin } };
}

/**
 * Keeps conversation material; foreign material only on an explicit tenant request or a
 * reference shared with the message, labelled with its origin.
 */
function scopeEvidence(evidence = [], { conversationId, caseId, message, situation } = {}) {
  const explicit = tenantScope(situation);
  const references = new Set([
    ...referenceCandidates({ text: String(message || '') }),
    ...(situation?.identifiers || []).map((entry) => String(entry?.value || '').trim()),
  ]);
  references.delete('');
  const kept = [];
  const withheld = [];
  for (const hit of evidence) {
    const origin = foreignOrigin(hit, { conversationId, caseId });
    if (!origin) kept.push(hit);
    else if (explicit || sharesReference(hit.value, references)) kept.push(labelled(hit, origin));
    else withheld.push(hit);
  }
  return { evidence: kept, withheld: withheld.length };
}

module.exports = {
  OTHER_CASE,
  OTHER_CONVERSATION,
  explicitTenantRequest,
  tenantScope,
  foreignOrigin,
  scopeEvidence,
  sharesReference,
};
