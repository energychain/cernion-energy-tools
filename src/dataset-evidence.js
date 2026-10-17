'use strict';

const descriptor = require('./tenant-evidence-descriptor');
const { principal, deny } = require('./domain-router-policy');
const { correctionPrincipal } = require('./shared-service-learning');

async function mutateEvidence(service, tenantId, task) {
  const previous = service.datasetQueues.get(tenantId) || Promise.resolve();
  const work = previous.catch(() => {}).then(task);
  service.datasetQueues.set(tenantId, work);
  try {
    return await work;
  } finally {
    if (service.datasetQueues.get(tenantId) === work) service.datasetQueues.delete(tenantId);
  }
}

const mixin = {
  actions: {
    evidenceCandidates: {
      visibility: 'protected',
      params: { question: { type: 'string', optional: true, max: 32000 } },
      async handler(ctx) {
        const p = principal(ctx);
        return mutateEvidence(this, p.tenantId, async () => {
          const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
          const result = [];
          for (const row of records.filter(
            (item) =>
              !item.provenance?.projectId && item.current !== false && !item.quality?.unusable
          )) {
            if ((await require('./tenant-evidence-read').chatEvidenceOrigin(ctx, row)).inaccessible)
              continue;
            if (!row.evidenceAnchors && !row.structuredFormat) {
              try {
                row.evidenceAnchors = require('./tenant-evidence-anchors').storedTableAnchors(
                  this,
                  p,
                  row
                );
              } catch (_error) {
                continue;
              }
            }
            if (descriptor.needsDescriptor('dataset', row, ctx.params.question, p.actorId)) {
              row.evidenceDescriptor = require('./tenant-evidence-background').availableDescriptor(
                'dataset',
                row
              );
              await ctx.call('datapoint.datasetCatalog', { operation: 'put', record: row });
            }
            result.push(descriptor.evidenceCandidate('dataset', row, p.actorId));
          }
          return result;
        });
      },
    },
    evidenceCorrect: {
      visibility: 'protected',
      params: {
        correction: 'object',
        tenantId: 'string',
        actorId: 'string',
        correctionId: 'string',
        at: 'string',
        sequence: { type: 'number', integer: true, min: 0, optional: true },
      },
      async handler(ctx) {
        correctionPrincipal(ctx.params, ctx.meta);
        const correction = descriptor.validateEvidenceCorrection(ctx.params.correction);
        if (correction.sourceType !== 'dataset') deny('Wrong evidence source');
        const p = principal(ctx);
        return mutateEvidence(this, p.tenantId, async () => {
          const rows = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
          const row = rows.find(
            (item) =>
              item.id === correction.sourceId &&
              !item.provenance?.projectId &&
              item.current !== false
          );
          if (
            !row ||
            (await require('./tenant-evidence-read').chatEvidenceOrigin(ctx, row)).inaccessible
          )
            deny('Evidence not accessible');
          await ctx.call('datapoint.datasetCatalog', {
            operation: 'put',
            record: descriptor.correctedEvidence(row, ctx.params),
          });
          return { corrected: true };
        });
      },
    },
  },
};
module.exports = { mixin, mutateEvidence };
