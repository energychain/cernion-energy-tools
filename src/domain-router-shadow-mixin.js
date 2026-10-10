'use strict';

// Explicit opt-in only. Existing PA decisions and response contracts remain unchanged.
async function beforeRouterShadow(ctx) {
  const envelope = ctx.params.taskEnvelope || ctx.params.context?.taskEnvelope;
  const cetCaseId = ctx.params.cetCaseId || ctx.params.context?.cetCaseId || envelope?.cetCaseId;
  if (!envelope && !cetCaseId) return;
  try {
    const result = await ctx.call(`domain-router.${cetCaseId ? 'continue' : 'classify'}`, {
      ...envelope,
      cetCaseId,
      userRequest: ctx.params.question || ctx.params.message || envelope?.userRequest,
      agentSessionId: ctx.params.sessionId || envelope?.agentSessionId,
    });
    ctx.meta.domainRouterShadow = {
      cetCaseId: result.cetCaseId,
      caseStateVersion: result.caseStateVersion,
      transition: result.transition,
      requiredClarifications: result.requiredClarifications,
    };
  } catch (error) {
    ctx.meta.domainRouterShadow = { unavailable: true, reason: error.type || 'router_unavailable' };
  }
}
async function afterRouterShadow(ctx, result) {
  const shadow = ctx.meta.domainRouterShadow;
  if (!shadow?.cetCaseId) return result;
  try {
    if (result?.jobId) {
      await ctx.call('domain-router.trackJob', {
        cetCaseId: shadow.cetCaseId,
        jobId: result.jobId,
      });
    } else {
      await ctx.call('domain-router.ingestUpdate', {
        cetCaseId: shadow.cetCaseId,
        kind: 'async_result',
        version: String(result?.dossierId || `${ctx.id}:${shadow.caseStateVersion}`),
        payloadRef: result?.dossierId || ctx.params.sessionId,
      });
    }
  } catch (error) {
    this.logger.debug('Domain router shadow completion unavailable', error.type);
  }
  return result;
}
module.exports = {
  hooks: {
    before: {
      askCernionAgent: beforeRouterShadow,
      answerDossier: beforeRouterShadow,
      chat: beforeRouterShadow,
    },
    after: {
      askCernionAgent: afterRouterShadow,
      answerDossier: afterRouterShadow,
      chat: afterRouterShadow,
    },
  },
};
