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

function release(ctx) {
  const facts = observations.get(ctx);
  if (facts) ctx.call = facts.call;
  observations.delete(ctx);
  return facts;
}

function after(ctx, result) {
  const facts = release(ctx);
  if (!facts) return result;
  try {
    collect(result, facts);
    const meta = facts.meta || ctx.meta;
    const p = principal({ meta }, ctx.params);
    const service = ctx.broker.getLocalService('function-coverage');
    if (!service) return result;
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

function error(ctx, failure) {
  release(ctx);
  throw failure;
}

module.exports = { before, after, error, collect };
