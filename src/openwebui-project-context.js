'use strict';

const { createHash } = require('node:crypto');

async function excludeProjectContext(service, ctx, envelope, meta) {
  if (!envelope.documents?.length || !service.broker.getLocalService('project-bundle')) return;
  const receipts = await ctx.call(
    'project-bundle.receipts',
    { conversationId: envelope.conversationId },
    { meta }
  );
  const verified = [];
  for (const projectId of new Set(receipts.map((r) => r.projectId))) {
    let objects;
    try {
      objects = await ctx.call('project-upload.objects', { projectId }, { meta });
    } catch (error) {
      if ([403, 404].includes(error.code)) continue;
      throw error;
    }
    verified.push(
      ...receipts.filter(
        (receipt) =>
          receipt.projectId === projectId &&
          objects.some(
            (object) =>
              object.uploadId === receipt.uploadId &&
              object.hash === receipt.hash &&
              object.status === 'received'
          )
      )
    );
  }
  envelope.documents = envelope.documents.filter((doc) => {
    const textHash = createHash('sha256').update(doc.text.trim()).digest('hex');
    return !verified.some(
      (r) =>
        r.textHash === textHash &&
        (doc.originalHash ? doc.originalHash === r.hash : Boolean(doc.id) && doc.id === r.sourceId)
    );
  });
}
module.exports = { excludeProjectContext };
