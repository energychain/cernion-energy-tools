'use strict';

function caseProposal(evidence) {
  const origins = evidence.map((entry) => entry.metadata).filter((meta) => meta?.caseId);
  const ids = new Set(origins.map((meta) => meta.caseId));
  return ids.size === 1
    ? { cetCaseId: origins[0].caseId, displayRef: origins[0].displayRef }
    : null;
}
async function correctSelection(service, ctx, { p, envelope, pending }) {
  if (
    !pending?.tenantEvidenceSelection?.length ||
    !/^(?:das )?passt nicht[.!\s]*$/iu.test(envelope.userRequest)
  )
    return null;
  for (const selection of pending.tenantEvidenceSelection)
    await ctx.call('shared-service-learning.apply', {
      target: 'tenantEvidence',
      correction: { ...selection, kind: 'reject' },
    });
  for (const selection of pending.tenantEvidenceProjectSelections || [])
    await ctx.call('shared-service-learning.apply', {
      target: 'projectManifest',
      correction: { projectId: selection.projectId, kind: 'reject' },
    });
  await require('./workbench-conversation').saveTurn(service.conversationsDb, p, envelope, {
    tenantEvidenceSelection: null,
    tenantEvidenceProjectSelections: [],
    projectSelection: null,
    retrieval: { evidence: [], trace: [], toolTrace: [] },
    lastAnswer: '',
  });
  return {
    state: 'assistance',
    nonBinding: true,
    sources: [],
    responseText:
      'Die Korrektur ist gespeichert. Diese Bestandteile ziehe ich für dich künftig nicht mehr automatisch heran.',
  };
}

async function uploadCaseProposal(service, ctx, { p, envelope, sourceIds }) {
  let candidates = await require('./evidence-endpoint-catalog').projectEvidenceCandidates(ctx);
  const current = candidates.filter((candidate) => sourceIds.includes(candidate.sourceId));
  if (!current.length || current.length > 8) return null;
  const question = current
    .flatMap((candidate) => [
      candidate.title,
      ...candidate.routingSources.flatMap((source) => [
        ...source.names,
        ...source.anchors.map((anchor) => anchor.name),
        ...source.columns.map((column) => column.name),
      ]),
    ])
    .join(' ')
    .slice(0, 32000);
  const settings = ctx.broker.getLocalService('project-manifest')?.settings?.routing || {};
  const select = () =>
    require('./dataset-routing').selectProjectCandidates(candidates, question, {
      ...settings,
      ...service.settings?.tenantEvidenceRouting,
    });
  let selected = select();
  if (selected.some((candidate) => !sourceIds.includes(candidate.sourceId))) {
    candidates = await require('./evidence-endpoint-catalog').projectEvidenceCandidates(
      ctx,
      question
    );
    selected = select();
  }
  if (!selected.some((candidate) => sourceIds.includes(candidate.sourceId))) return null;
  const origins = [];
  for (const candidate of selected.filter((candidate) => !sourceIds.includes(candidate.sourceId))) {
    if (!candidate.provenance) continue;
    const origin = await require('./tenant-evidence-read').chatEvidenceOrigin(ctx, {
      provenance: candidate.provenance,
      refs: candidate.provenance.refs,
    });
    if (origin.caseId && !origin.inaccessible) origins.push(origin);
  }
  const proposal = caseProposal(origins.map((metadata) => ({ metadata })));
  if (!proposal) return null;
  const selection = selected
    .filter((candidate) => candidate.sourceType !== 'project')
    .map(({ sourceType, sourceId }) => ({ sourceType, sourceId }));
  const projectSelections = selected
    .filter((candidate) => candidate.sourceType === 'project')
    .map(({ projectId }) => ({ projectId }));
  await require('./workbench-conversation').saveTurn(service.conversationsDb, p, envelope, {
    tenantEvidenceSelection: selection,
    tenantEvidenceProjectSelections: projectSelections,
  });
  return {
    caseProposal: proposal,
    text: `Der neue Upload passt zu Fall ${proposal.displayRef}. Du kannst diesen Fall fortsetzen; die Wahl lässt sich mit „passt nicht“ korrigieren.`,
  };
}
module.exports = { caseProposal, correctSelection, uploadCaseProposal };
