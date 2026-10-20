'use strict';

// Source adapters share generation, scoring, correction dispatch and answering.
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
  // Legacy sessions lack derivation metadata: suppress duplicate candidates for their uploads.
  const uploads = candidates.filter((candidate) =>
    ['document', 'dataset'].includes(candidate.sourceType)
  );
  return candidates.filter(
    (candidate) =>
      candidate.sourceType !== 'case' ||
      candidate.provenance.uploadBacked === false ||
      !uploads.some((upload) =>
        [...(upload.provenance?.refs || []), upload.provenance || {}].some(
          (ref) =>
            (ref.caseId && ref.caseId === candidate.provenance.caseId) ||
            (ref.conversationId &&
              candidate.provenance.refs?.some(
                (origin) => origin.conversationId === ref.conversationId
              ))
        )
      )
  );
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
for (const type of ['case', 'memory'])
  registerEvidenceSource({
    type,
    service: 'workbench',
    correctionAction: 'workbench.evidenceCorrect',
    candidates: (ctx, question) =>
      require('./tenant-evidence-sessions').sessionCandidates(ctx, question, type),
    read: (ctx, selected) =>
      require('./tenant-evidence-sessions').readSessionEvidence(ctx, selected),
  });
module.exports = {
  registerEvidenceSource,
  evidenceCandidates,
  readEvidenceSource,
  evidenceCorrectionAction,
};
