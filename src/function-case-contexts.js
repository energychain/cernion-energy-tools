'use strict';
const { resolveRecords, coverageRecords } = require('./function-activation-records');
const { getNeighbors, getFunction } = require('./function-model');

function retainCaseContexts(document, event, resolutions, model, settings, freshTurn) {
  const coverage = coverageRecords(document, model);
  document.contexts = resolveRecords(document.contexts || [], model).filter((context) => {
    const scope = new Set([
      context.functionId,
      ...getNeighbors(context.functionId, {
        model,
        minWeight: 0,
        overlay: document.neighborCorrections || [],
      }).map((edge) => edge.functionId),
    ]);
    const actors = coverage
      .filter((row) => scope.has(row.functionId) && row.score >= settings.coverageThreshold)
      .map((row) => row.actorId);
    actors.push(...(context.actors || []).map((actor) => actor.actorId));
    if (freshTurn && (!actors.length || actors.includes(event.actorId))) {
      context.ageTurns = (context.ageTurns || 0) + 1;
      for (const actor of context.actors || []) actor.ageTurns = (actor.ageTurns || 0) + 1;
    }
    context.actors = (context.actors || []).filter(
      (actor) => (actor.ageTurns || 0) < settings.contextRetentionTurns
    );
    return (context.ageTurns || 0) < settings.contextRetentionTurns;
  });
  const groups = new Map();
  for (const context of document.contexts) {
    const recent = groups.get(context.functionId) || [];
    if (!recent.some((item) => item.ref === context.ref)) recent.push(context);
    groups.set(context.functionId, recent.slice(-5));
  }
  document.contexts = [...groups.values()].flat();
  if (!event.context) return;
  for (const { functionId } of resolutions) {
    const previous = document.contexts.find(
      (context) => context.functionId === functionId && context.ref === event.context.ref
    );
    const actors = [
      ...(previous?.actors || []).filter((actor) => actor.actorId !== event.actorId),
      { actorId: event.actorId, ageTurns: 0 },
    ].slice(-5);
    document.contexts = document.contexts.filter(
      (context) => context.functionId !== functionId || context.ref !== event.context.ref
    );
    const recent = [
      ...document.contexts.filter((context) => context.functionId === functionId),
      {
        kind: event.context.kind,
        ref: event.context.ref,
        actors,
        functionId,
        ageTurns: 0,
        modelSourceHash: model.sourceHash,
        capabilities: getFunction(functionId, { model }).capabilities || [],
      },
    ].slice(-5);
    document.contexts = document.contexts
      .filter((context) => context.functionId !== functionId)
      .concat(recent);
  }
}
module.exports = { retainCaseContexts };
