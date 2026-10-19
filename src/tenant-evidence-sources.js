'use strict';

// Phase B adds source adapters here; generation, scoring and answering remain shared.
const sources = new Map();
function registerEvidenceSource(source) {
  if (
    !source?.type ||
    !source.service ||
    typeof source.candidates !== 'function' ||
    typeof source.read !== 'function'
  )
    throw new Error('Invalid evidence source adapter');
  if (sources.has(source.type)) throw new Error('Duplicate evidence source adapter');
  sources.set(source.type, Object.freeze({ ...source }));
}
async function evidenceCandidates(ctx, question) {
  const candidates = [];
  for (const source of sources.values()) {
    const service = ctx.broker?.getLocalService?.(source.service);
    if (!service || (source.action && !service.schema?.actions?.[source.action])) continue;
    candidates.push(...(await source.candidates(ctx, question)));
  }
  return candidates;
}
function evidenceCorrectionAction(type) {
  return sources.get(type)?.correctionAction || null;
}
async function readEvidenceSource(ctx, selected, question, options) {
  const source = sources.get(selected.sourceType || 'project');
  return source ? source.read(ctx, selected, question, options) : null;
}
registerEvidenceSource({
  type: 'project',
  service: 'project-manifest',
  candidates: async (ctx) =>
    (await ctx.call('project-manifest.candidates', {})).map((candidate) => ({
      ...candidate,
      sourceType: 'project',
    })),
  read: (ctx, selected, question, options) =>
    require('./project-manifest-evidence').readProjectEvidence(ctx, selected, question, options),
});
for (const [type, service, action] of [
  ['document', 'knowledge-rag', 'documentEvidenceCandidates'],
  ['dataset', 'dataset', 'evidenceCandidates'],
])
  registerEvidenceSource({
    type,
    service,
    action,
    correctionAction:
      type === 'document' ? 'knowledge-rag.documentEvidenceCorrect' : 'dataset.evidenceCorrect',
    candidates: (ctx, question) => ctx.call(`${service}.${action}`, { question: question || '' }),
    read: (ctx, selected, question, options) =>
      require('./tenant-evidence-read').readChatEvidence(ctx, selected, question, options),
  });
module.exports = {
  registerEvidenceSource,
  evidenceCandidates,
  readEvidenceSource,
  evidenceCorrectionAction,
};
