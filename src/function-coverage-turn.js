'use strict';

const { principal } = require('./domain-router-policy');
const { classifyWorkbenchIntent } = require('./workbench-intent-router');
const { reference } = require('./function-coverage');
const defaults = require('./function-coverage-config.json');
const observations = new WeakMap();

function addFact(facts, kind, id) {
  if (typeof id !== 'string' || facts[kind].has(id)) return;
  if (facts[kind].size < facts.limit) facts[kind].add(id);
  else facts.overflow++;
}

function collect(result, facts) {
  if (!result || typeof result !== 'object') return;
  // Router proposals are not evidence of selected or executed work.
  for (const value of result.selectedCapabilities || []) {
    addFact(facts, 'capabilities', typeof value === 'string' ? value : value?.capability);
  }
}

function before(ctx) {
  // Delegated requests are observed by Workbench, once.
  if (
    ctx.action?.name === 'openai-compatible.chatCompletions' &&
    ctx.params.model === 'cernion-governance-assistant'
  )
    return;
  const service = ctx.broker.getLocalService('function-coverage');
  const facts = {
    capabilities: new Set(),
    operations: new Set(),
    call: ctx.call,
    limit: service?.config.maxInputSignalsPerTurn || defaults.maxInputSignalsPerTurn,
    overflow: 0,
    skipCoverage:
      ctx.action?.name === 'workbench.query' && ctx.params.intentMode === 'system_activity_query',
  };
  observations.set(ctx, facts);
  ctx.call = async (...args) => {
    const result = await facts.call.apply(ctx, args);
    try {
      addFact(facts, 'operations', args[0]);
      collect(result, facts);
      if (args[2]?.meta) facts.meta = args[2].meta;
    } catch {
      ctx.broker.logger.warn('Coverage observation failed');
    }
    return result;
  };
}

function mapped(ctx, meta) {
  const facts = observations.get(ctx);
  if (facts) facts.noticeMeta = meta;
}

function release(ctx) {
  const facts = observations.get(ctx);
  if (facts) ctx.call = facts.call;
  observations.delete(ctx);
  return facts;
}

function after(ctx, result) {
  const facts = release(ctx);
  if (!facts) return result;
  if (!ctx.broker.getLocalService('notices')) return recordAfter(ctx, result, facts);
  return attachNotices(ctx, result, facts).then((reply) => recordAfter(ctx, reply, facts));
}

function recordAfter(ctx, result, facts) {
  if (facts.skipCoverage) return result;
  try {
    collect(result, facts);
    const meta = facts.noticeMeta || facts.meta || ctx.meta;
    const service = ctx.broker.getLocalService('function-coverage');
    if (!service) return result;
    if (unmappedServiceTurn(ctx, facts)) return result;
    const p = principal({ meta }, ctx.params);
    if (service.pendingTurns >= service.config.maxPendingTurns) {
      service.droppedTurns = Math.min(1000000, service.droppedTurns + 1);
      return result;
    }
    const metadata =
      ctx.action?.name === 'openai-compatible.chatCompletions' ? ctx.params.metadata || {} : {};
    const latest = ctx.params.messages?.findLast((message) => message.role === 'user')?.content;
    const mode =
      ctx.params.intentMode ||
      classifyWorkbenchIntent(ctx.params.message || (typeof latest === 'string' ? latest : ''), {
        cetCaseId: ctx.params.cetCaseId,
      });
    if (mode === 'correction') return result;
    service.pendingTurns++;
    const input = {
      tenantId: p.tenantId,
      actorId: p.actorId,
      sourceType: 'completed_turn',
      sourceRef: reference(
        ctx.params.requestId ||
          metadata.requestId ||
          ctx.params.correlationId ||
          metadata.correlationId ||
          ctx.requestID
      ),
      conversationId:
        ctx.params.openWebuiConversationId ||
        ctx.params.conversationId ||
        metadata.openWebuiConversationId ||
        metadata.conversationId ||
        metadata.sessionId ||
        ctx.requestID,
      signalClass:
        ctx.params.attachments?.length || ctx.params.evidenceRefs?.length
          ? 'evidence_attachment'
          : mode,
      capabilities: [...facts.capabilities],
      operations: [...facts.operations],
      observationOverflow: facts.overflow,
      ...(result.cetCaseId || ctx.params.cetCaseId || metadata.cetCaseId
        ? {
            context: {
              kind: 'case',
              ref: result.cetCaseId || ctx.params.cetCaseId || metadata.cetCaseId,
            },
          }
        : {}),
    };
    void service.actions
      .recordTouch(input, { meta })
      .catch(() => service.logger.warn('Coverage recording failed'))
      .finally(() => {
        service.pendingTurns--;
      });
  } catch {
    ctx.broker.logger.warn('Coverage observation failed');
  }
  return result;
}

async function attachNotices(ctx, result, facts) {
  if (!ctx.broker.getLocalService('notices')) return result;
  // Governance completions delegate once; Workbench uses the mapped principal.
  if (ctx.action?.name === 'openai-compatible.chatCompletions') return result;
  try {
    const meta = facts.noticeMeta || facts.meta || ctx.meta;
    const p = principal({ meta });
    const fullQueue = result.state === 'notices';
    const notice = await ctx.call(
      'notices.completeTurn',
      {
        tenantId: p.tenantId,
        actorId: p.actorId,
        turnRef: reference(ctx.params.requestId || ctx.params.correlationId || ctx.requestID),
        structured:
          !!meta.sharedServiceNoticesStructured ||
          !!ctx.params.response_format ||
          !!result.tool_calls ||
          !!result.toolCalls ||
          !!result.structuredOutput,
        fullQueue,
      },
      { meta, timeout: 1500 }
    );
    if (fullQueue) return { ...result, noticeQueue: notice, noticeBlock: notice.block };
    if (!notice.block) return result;
    if (meta.sharedServiceNoticesDefer) return { ...result, noticeBlock: notice.block };
    if (typeof result.responseText === 'string')
      return { ...result, responseText: `${notice.block}\n\n${result.responseText}` };
    if (typeof result.reply === 'string')
      return { ...result, reply: `${notice.block}\n\n${result.reply}` };
    return { ...result, noticeBlock: notice.block };
  } catch (error) {
    const service = ctx.broker.getLocalService('notices');
    service.failures = Math.min(1000000, service.failures + 1);
    ctx.broker.logger.warn('Notice attachment failed', { errorClass: error.type || error.name });
    return result.state === 'notices'
      ? { ...result, state: 'notices_unavailable', noticeQueue: null }
      : result;
  }
}

function unmappedServiceTurn(ctx, facts) {
  const meta = facts.noticeMeta || facts.meta || ctx.meta;
  const auth = meta.authUser || meta.apiToken || {};
  const service = ctx.broker.getLocalService('function-coverage');
  if (
    service &&
    !meta.workbenchMappedActor &&
    (auth.actorType === 'service' || (!meta.authUser && meta.apiToken && !auth.userId))
  ) {
    service.unmappedServiceTurns = Math.min(1000000, (service.unmappedServiceTurns || 0) + 1);
    service.logger.warn('Coverage skipped: service identity has no Workbench mapping');
    return true;
  }
  return false;
}

function error(ctx, failure) {
  const facts = release(ctx);
  if (facts) unmappedServiceTurn(ctx, facts);
  throw failure;
}

module.exports = { before, after, error, collect, mapped };
