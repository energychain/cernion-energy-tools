'use strict';

// Released tenant knowledge bases (Knowledge Gateway) as a source of the workbench turn (AP4).
// The gateway checks the person's access before retrieval and again before a result leaves it;
// without base ids it searches the bases released for chat. Hits keep their citation.

const MAX_CONTENT = 1500;

async function collectGatewayKnowledge(ctx, { question, maxEvidence = 5, timeoutMs } = {}) {
  if (!ctx.broker?.getLocalService?.('knowledge-gateway'))
    return { source: 'knowledge-gateway', status: 'skipped', hits: [], trace: {} };
  const result = await ctx.call(
    'knowledge-gateway.search',
    { question: String(question || '').slice(0, 600), topK: Math.min(8, maxEvidence + 3) },
    { meta: ctx.meta, ...(timeoutMs ? { timeout: timeoutMs } : {}) }
  );
  const hits = (result?.results || []).map((item) => ({
    source: String(item.title || item.source?.name || 'Wissensbasis').slice(0, 160),
    value: String(item.content || '').slice(0, MAX_CONTENT),
    metadata: {
      sourceId: item.documentId,
      sectionId: item.location?.section || `chunk-${item.location?.chunkIndex ?? 0}`,
      documentTitle: item.title || null,
      sectionTitle: item.location?.section || null,
      citationId: item.citationId,
      knowledgeBaseId: item.knowledgeBaseId,
      score: item.score,
      sha256: item.source?.sha256,
    },
  }));
  return {
    source: 'knowledge-gateway',
    status: hits.length ? 'available' : 'missing',
    hits,
    trace: { queryId: result?.queryId, hitCount: hits.length },
  };
}

module.exports = { collectGatewayKnowledge };
