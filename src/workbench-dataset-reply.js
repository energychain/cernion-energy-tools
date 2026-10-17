'use strict';

async function datasetTurnReply(service, p, envelope, pending, result) {
  service.logger.info('Workbench turn phases and sources', {
    phaseTimes: { answerMs: result.answerMs || 0 },
    sources: result.sources || [],
  });
  await require('./workbench-conversation').saveTurn(service.conversationsDb, p, envelope, {
    tenantMemoryFactIds: [],
    ...(result.datasetIds?.length
      ? {
          datasetContext: {
            datasetIds: [
              ...new Set([...(pending?.datasetContext?.datasetIds || []), ...result.datasetIds]),
            ],
            selectionDatasetIds: result.selectionDatasetIds || [],
            lastDatasetId: result.datasetIds.length === 1 ? result.datasetIds[0] : undefined,
          },
        }
      : {}),
  });
  return {
    state: 'assistance',
    nonBinding: true,
    responseText: result.responseText,
    sources: result.sources || [],
    phaseTimes: { answerMs: result.answerMs || 0 },
  };
}

module.exports = { datasetTurnReply };
