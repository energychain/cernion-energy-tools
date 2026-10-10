'use strict';

const { fileError, fileId } = require('./file-channel-policy');
const { loadDocuments } = require('./workbench-document');
function fileReferences(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 16)
    fileError('Höchstens 16 Dateireferenzen pro Anfrage.');
  return value.map((ref) => {
    if (!ref || typeof ref !== 'object') fileError('Ungültige Dateireferenz.');
    return {
      fileId: fileId(ref.fileId),
      hash: ref.hash,
      name: ref.name,
      mimeType: ref.mimeType,
      size: ref.size,
    };
  });
}
async function loadReferencedDocuments(ctx, envelope, meta) {
  const refs = envelope.fileRefs || [];
  if (refs.length) {
    const documents = [];
    for (const ref of refs) {
      const document = await ctx.call('files.read', { fileId: ref.fileId }, { meta });
      for (const key of ['hash', 'name', 'mimeType', 'size'])
        if (ref[key] != null && ref[key] !== document.reference[key])
          fileError('Dateireferenz stimmt nicht mit dem Original überein.');
      documents.push(document);
    }
    // Reference path prefers the original. The uninstalled-filter path never enters here.
    if (
      documents.reduce((sum, doc) => sum + doc.text.length, 0) >
      Number(process.env.WORKBENCH_DOCUMENT_MAX_CHARS || 4000000)
    )
      fileError('Dokumente überschreiten gemeinsam das Textbudget.', 413);
    envelope.documents = documents;
  }
}
async function prepareFileTurn(service, ctx, p, envelope, meta) {
  await loadReferencedDocuments(ctx, envelope, meta);
  const match = envelope.userRequest.match(
    /^(?:lösche|loesche)\s+(?:die\s+)?datei\s+([a-f0-9]{64})[.!]?$/i
  );
  if (match) {
    const result = await ctx.call('files.remove', { fileId: match[1] }, { meta });
    return {
      state: 'assistance',
      nonBinding: true,
      responseText: `Datei ${result.fileId} gelöscht; vorhandene Download-Links sind ungültig.`,
    };
  }
  if (
    /^(?:exportiere|export)\s+(?:die\s+)?(?:fallunterlagen|dokumente)\s+(?:als\s+)?txt[.!]?$/i.test(
      envelope.userRequest
    )
  ) {
    const conversation = await service.store.resolveConversation(
      { tenantId: p.tenantId, client: envelope.channel, conversationId: envelope.conversationId },
      { optional: true }
    );
    const caseId = conversation?.cetCaseId;
    if (!caseId) fileError('Für den Export fehlt ein zugeordneter Fall.');
    await service.broker.getLocalService('domain-router').loadCase(p, caseId);
    const docs = await loadDocuments(service.store, {
      tenantId: p.tenantId,
      caseId,
      clearance: p.clearance,
    });
    if (!docs.length) fileError('Keine zugänglichen Fallunterlagen zum Export vorhanden.');
    const content = docs.map((doc) => `${doc.name}\n\n${doc.text}`).join('\n\n');
    // Preserve all source clearance requirements in the generated file.
    const evidence = await service.store.listEvidence({ tenantId: p.tenantId, caseId });
    const levels = ['public', 'tenant_internal', 'restricted', 'highly_sensitive'];
    const requiredClearance = [
      ...new Set(
        evidence
          .filter((entry) => docs.some((doc) => doc.evidenceId === entry.evidenceId))
          .flatMap((entry) => [
            entry.sensitivityLevel,
            ...(entry.extracts?.document?.original?.requiredClearance || []),
          ])
          .filter((level) => ['restricted', 'highly_sensitive'].includes(level))
      ),
    ].sort((a, b) => a.localeCompare(b));
    const sensitivityLevel =
      levels[
        Math.max(
          1,
          ...evidence
            .filter((entry) => docs.some((doc) => doc.evidenceId === entry.evidenceId))
            .map((entry) => levels.indexOf(entry.sensitivityLevel))
        )
      ];
    const file = await ctx.call(
      'files.publish',
      {
        name: 'Fallunterlagen.txt',
        contentBase64: Buffer.from(content).toString('base64'),
        caseId,
        sensitivityLevel,
        requiredClearance,
      },
      { meta }
    );
    return {
      state: 'assistance',
      nonBinding: true,
      responseText: file.responseText,
      files: [file],
      cetCaseId: caseId,
    };
  }
  return null;
}
module.exports = { fileReferences, prepareFileTurn };
