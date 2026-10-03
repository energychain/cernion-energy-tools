'use strict';

const { principal } = require('./domain-router-policy');
const { classifyWorkbenchIntent } = require('./workbench-intent-router');
const { reference } = require('./function-coverage');
const defaults = require('./function-coverage-config.json');
const observations = new WeakMap();

function collect(result, facts) {
  if (!result || typeof result !== 'object') return;
  for (const value of [
    ...(typeof result.capability === 'string' ? [result.capability] : []),
    ...(result.candidateCapabilities || []),
    ...(result.selectedCapabilities || []),
    ...(result.recommendedCapabilities || []),
  ]) {
    const id = typeof value === 'string' ? value : value?.capability;
    if (typeof id === 'string' && facts.capabilities.size < defaults.maxSignalsPerTurn)
      facts.capabilities.add(id);
  }
  for (const value of result.operationCandidates || []) {
    const id = typeof value === 'string' ? value : value?.action || value?.operationId;
    if (typeof id === 'string' && facts.operations.size < defaults.maxSignalsPerTurn)
      facts.operations.add(id);
  }
}

function before(ctx) {
  // Delegated requests are observed by Workbench, once.
  if (
    ctx.action?.name === 'openai-compatible.chatCompletions' &&
    ctx.params.model === 'cernion-governance-assistant'
  )
    return;
  const facts = { capabilities: new Set(), operations: new Set(), call: ctx.call };
  observations.set(ctx, facts);
  ctx.call = async (...args) => {
    const result = await facts.call.apply(ctx, args);
    try {
      if (facts.operations.size < defaults.maxSignalsPerTurn) facts.operations.add(args[0]);
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
