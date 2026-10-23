'use strict';

const conversation = require('./workbench-conversation');
const assessments = new WeakMap();

function projectManifestTrace(ctx, reply) {
  const assessment = assessments.get(ctx);
  assessments.delete(ctx);
  return assessment
    ? { ...reply, metadata: { ...reply.metadata, projectRouting: assessment } }
    : reply;
}

async function projectManifestTurn(service, ctx, { p, envelope, pending, meta }) {
  if (
    (!ctx.broker.getLocalService('project-manifest') &&
      !ctx.broker.getLocalService('dataset')?.schema?.actions?.evidenceCandidates &&
      !ctx.broker.getLocalService('knowledge-rag')?.schema?.actions?.documentEvidenceCandidates &&
      !ctx.broker.getLocalService('workbench')?.store) ||
    (envelope.documents?.length && !envelope.tenantEvidenceReady) ||
    (envelope.datasetIds?.length && !envelope.tenantEvidenceReady) ||
    require('./workbench-thread').isDocumentInput(envelope.userRequest)
  )
    return null;
  const safe = Object.assign(Object.create(ctx), {
    meta,
    call: (name, params, options) =>
      ctx.call(name, params, { ...options, meta: { ...meta, ...options?.meta } }),
  });
  const skillReply = await require('./project-skill-turn').projectSkillTurn(service, safe, {
    p,
    envelope,
    pending,
  });
  if (skillReply) return skillReply;
  const evidenceCorrection = await require('./workbench-tenant-evidence').correctSelection(
    service,
    safe,
    { p, envelope, pending }
  );
  if (evidenceCorrection) return evidenceCorrection;
  if (
    pending?.projectSelection &&
    /^(?:(?:das (?:ist|war) (?:die )?)?falsche akte[.!\s]*|(?:der )?fragetyp (?:ist )?falsch[.!\s]*)$/iu.test(
      envelope.userRequest
    )
  ) {
    const type = /fragetyp/iu.test(envelope.userRequest);
    const correction = {
      projectId: pending.projectSelection.projectId,
      kind: 'reject',
      ...(type ? { questionTypeId: pending.projectSelection.questionTypeId } : {}),
    };
    await safe.call('shared-service-learning.apply', { target: 'projectManifest', correction });
    await conversation.saveTurn(service.conversationsDb, p, envelope, {
      projectSelection: null,
      retrieval: { evidence: [], trace: [], toolTrace: [] },
    });
    return {
      state: 'assistance',
      nonBinding: true,
      responseText: type
        ? 'Die Korrektur ist gespeichert. Diesen Fragetyp ziehe ich für dich künftig nicht mehr aus dieser Akte heran.'
        : 'Die Korrektur ist gespeichert. Diese Akte ziehe ich für dich künftig nicht mehr automatisch heran.',
      sources: [],
    };
  }
  const result = await require('./project-manifest-evidence').projectManifestAnswer(
    safe,
    envelope.userRequest,
    {
      routing: service.settings?.tenantEvidenceRouting,
      requireSourceIds: envelope.tenantEvidenceReady
        ? envelope.evidenceSourceIds || envelope.datasetIds
        : [],
      minSources: envelope.tenantEvidenceMinSources,
      contextual: envelope.contextualEvidence,
      currentConversationId: envelope.conversationId,
      previousEvidence: {
        selection: pending?.tenantEvidenceSelection,
        question: pending?.tenantEvidenceQuestion,
      },
      onAssessment: (assessment) => assessments.set(ctx, assessment),
    }
  );
  if (!result) return null;
  // Learned-check results are phrased like every other project answer (number-checked prose);
  // only the naming of the check stays deterministic.
  const prose = await require('./project-manifest-prose').projectManifestProse(
    result,
    envelope.userRequest,
    {
      tenantId: p.tenantId,
      logger: service.logger,
      internalContext: [pending?.situation?.concern, pending?.situation?.situation].filter(Boolean),
    }
  );
  const answer = result.learnedSkill
    ? {
        ...prose,
        responseText: `${prose.responseText}\n\nBerechnet nach meinem gelernten Check ‚${result.learnedSkill.title}‘.`,
      }
    : prose;
  const caseProposal = result.tenantSelection
    ? require('./workbench-tenant-evidence').caseProposal(result.evidence)
    : null;
  if (caseProposal)
    answer.responseText += `\n\nDas Material passt zu Fall ${caseProposal.displayRef}. Du kannst diesen Fall fortsetzen; die Quellenwahl lässt sich mit „passt nicht“ korrigieren.`;
  await conversation.saveTurn(service.conversationsDb, p, envelope, {
    tenantMemoryFactIds: [],
    projectSkillSelection: result.learnedSkill
      ? { projectId: result.projectId, skillId: result.learnedSkill.skillId }
      : null,
    tenantEvidenceSelection: result.tenantSelection || null,
    tenantEvidenceQuestion: envelope.userRequest.slice(0, 2000),
    tenantEvidenceProjectSelections: result.projectSelections || [],
    projectSelection: result.projectId
      ? { projectId: result.projectId, questionTypeId: result.questionTypeId }
      : null,
    retrieval: {
      evidence: result.evidence,
      trace: [
        ...(assessments.has(ctx)
          ? [{ source: 'project-manifest.routing', ...assessments.get(ctx) }]
          : []),
        ...result.trace,
      ],
      toolTrace: [],
    },
    evidenceRetrievedAt: Date.now(),
    lastAnswer: answer.responseText.slice(0, 600),
    lastConversationShape: 'knowledge',
  });
  return {
    state: 'assistance',
    nonBinding: true,
    ...answer,
    evidence: result.evidence,
    learnedSkill: result.learnedSkill,
    gaps: result.gaps,
    ...(result.projectId
      ? { projectSelection: { projectId: result.projectId, questionTypeId: result.questionTypeId } }
      : {}),
    ...(result.tenantSelection ? { tenantEvidenceSelection: result.tenantSelection } : {}),
    ...(caseProposal ? { caseProposal } : {}),
    sources: result.evidence.map((entry) => ({
      source: entry.source,
      status: 'available',
      called: true,
    })),
  };
}

async function supplementDatasetAnswer(service, ctx, input, result) {
  const ids = [
    ...new Set(
      [
        ...(result.evidence || [])
          .filter((entry) => entry.source === 'dataset.query')
          .map((entry) => entry.metadata?.datasetId),
        ...(result.datasetId &&
        Number.isInteger(result.rowCount) &&
        !['unavailable', 'unusable'].includes(result.status)
          ? [result.datasetId]
          : []),
        ...(result.sources?.some(
          (source) => source.source === 'dataset.query' && source.status === 'available'
        )
          ? result.datasetIds || []
          : []),
      ].filter(Boolean)
    ),
  ];
  if (!ids.length) return null;
  const reply = await projectManifestTurn(service, ctx, {
    ...input,
    envelope: {
      ...input.envelope,
      tenantEvidenceReady: true,
      evidenceSourceIds: ids,
      tenantEvidenceMinSources: 2,
    },
  });
  if (!reply) return null;
  const receipts = input.envelope.datasetConfirmations || [];
  return { ...reply, responseText: [reply.responseText, ...receipts].filter(Boolean).join('\n\n') };
}

module.exports = { projectManifestTurn, projectManifestTrace, supplementDatasetAnswer };
