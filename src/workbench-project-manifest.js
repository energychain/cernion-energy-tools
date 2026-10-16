'use strict';

const conversation = require('./workbench-conversation');

async function projectManifestTurn(service, ctx, { p, envelope, pending, meta }) {
  if (
    !ctx.broker.getLocalService('project-manifest') ||
    envelope.documents?.length ||
    envelope.datasetIds?.length
  )
    return null;
  const safe = Object.assign(Object.create(ctx), {
    meta,
    call: (name, params, options) =>
      ctx.call(name, params, { ...options, meta: { ...meta, ...options?.meta } }),
  });
  if (
    pending?.projectSelection &&
    /^(?:das (?:ist|war) (?:die )?)?falsche akte[.!\s]*$|^(?:der )?fragetyp (?:ist )?falsch[.!\s]*$/iu.test(
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
    envelope.userRequest
  );
  if (!result) return null;
  const answer = await require('./project-manifest-prose').projectManifestProse(
    result,
    envelope.userRequest,
    { tenantId: p.tenantId, logger: service.logger }
  );
  await conversation.saveTurn(service.conversationsDb, p, envelope, {
    tenantMemoryFactIds: [],
    projectSelection: { projectId: result.projectId, questionTypeId: result.questionTypeId },
    retrieval: { evidence: result.evidence, trace: result.trace, toolTrace: [] },
    evidenceRetrievedAt: Date.now(),
    lastAnswer: answer.responseText.slice(0, 600),
    lastConversationShape: 'knowledge',
  });
  return {
    state: 'assistance',
    nonBinding: true,
    ...answer,
    evidence: result.evidence,
    gaps: result.gaps,
    projectSelection: { projectId: result.projectId, questionTypeId: result.questionTypeId },
    sources: result.evidence.map((entry) => ({
      source: entry.source,
      status: 'available',
      called: true,
    })),
  };
}

module.exports = { projectManifestTurn };
