'use strict';

const { compareCanonicalStrings } = require('./canonical-order');
const { resolveFunctionId } = require('./function-model');

const JOURNAL_KINDS = Object.freeze([
  'observed',
  'decided',
  'proposed',
  'awaiting',
  'corrected',
  'woke',
  'slept',
  'created',
  'retired',
]);

function compareEntries(a, b) {
  return (
    compareCanonicalStrings(a.at, b.at) ||
    (a.position || 0) - (b.position || 0) ||
    compareCanonicalStrings(a.entryId, b.entryId)
  );
}

function resolveEntries(entries, model) {
  return entries
    .flatMap((entry) =>
      resolveFunctionId(entry.functionId, { model }).map(({ functionId }) => ({
        ...entry,
        functionId,
      }))
    )
    .sort(compareEntries);
}

// Identity references close expectations/proposals without changing their original records.
function settleOpenEntries(refs, awaiting, proposals) {
  for (const ref of refs) {
    if (ref?.kind !== 'journal') continue;
    awaiting.delete(ref.id);
    proposals.delete(ref.id);
  }
}

function computeJournalDigest(entries, functionId, tenantId) {
  const ordered = entries.filter((entry) => entry.functionId === functionId).sort(compareEntries);
  const awaiting = new Map();
  const proposals = new Map();
  const decisions = [];
  let status = { state: 'latent', responsibility: { humans: [], cet: false }, agents: [] };
  const agents = new Map();
  for (const entry of ordered) {
    if (entry.activation) status = { ...status, ...entry.activation };
    if (entry.lifecycle && entry.agentId) agents.set(entry.agentId, entry.lifecycle);
    if (entry.kind === 'awaiting') awaiting.set(entry.entryId, entry);
    if (entry.kind === 'proposed') proposals.set(entry.entryId, entry);
    if (['decided', 'corrected'].includes(entry.kind)) {
      decisions.push(entry);
      settleOpenEntries(entry.refs, awaiting, proposals);
    }
  }
  status.agents = [...agents]
    .sort(([a], [b]) => compareCanonicalStrings(a, b))
    .map(([agentId, lifecycle]) => ({ agentId, lifecycle }));
  return {
    schemaVersion: 1,
    tenantId,
    functionId,
    status,
    openExpectations: [...awaiting.values()],
    lastDecisions: decisions.slice(-10),
    openProposals: [...proposals.values()],
    entryCount: ordered.length,
    lastEntryAt: ordered.at(-1)?.at || null,
  };
}

module.exports = { JOURNAL_KINDS, compareEntries, resolveEntries, computeJournalDigest };
