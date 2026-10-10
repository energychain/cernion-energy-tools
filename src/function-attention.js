'use strict';

const { getNeighbors } = require('./function-model');
const { coverageRecords, resolveRecords } = require('./function-activation-records');

function attentionState(saved, settings) {
  const value = {
    turnsSinceRefresh: 0,
    reactivationScore: 0,
    established: false,
    retainFactor: 1,
    inventory: false,
    retired: false,
    allowance: 0,
    allowanceExhausted: false,
    consumedUnits: 0,
    replenishedUnits: 0,
    ...saved,
  };
  if (value.reactivationScore >= settings.establishThreshold) value.established = true;
  if (value.reactivationScore < settings.establishThreshold * settings.hysteresis)
    value.established = false;
  value.halfLifeTurns =
    settings.halfLifeTurns *
    Math.max(value.retainFactor, value.established ? settings.establishedFactor : 1);
  value.relevance = value.inventory
    ? 1
    : Math.pow(0.5, value.turnsSinceRefresh / value.halfLifeTurns);
  value.tier = value.inventory
    ? 'inventory'
    : value.retainFactor > 1
      ? 'retained'
      : value.established
        ? 'established'
        : 'transient';
  if (value.relevance < settings.retireThreshold) value.retired = true;
  return value;
}

function advanceAttention(document, event, model, settings) {
  document.activations = resolveRecords(document.activations, model);
  document.turnKeys ||= [];
  const key = JSON.stringify(
    event.turnRef
      ? [event.actorId, event.conversationId, event.turnRef]
      : [event.actorId, event.conversationId, event.at]
  );
  const fresh = !document.turnKeys.includes(key);
  if (fresh) {
    document.turnKeys.push(key);
    document.turnKeys = document.turnKeys.slice(-settings.turnDedupLimit);
    document.activatingTurns = (document.activatingTurns || 0) + 1;
    document.pendingRefill = true;
  }
  const coverage = coverageRecords(document, model);
  for (const row of document.activations) {
    if (!row.attention) continue;
    let attention = attentionState(row.attention, settings);
    const sources = (row.reason || [])
      .filter((reason) => reason.kind === 'neighbor')
      .map((reason) => reason.functionId);
    const relevantIds = new Set(
      sources.flatMap((id) => [
        id,
        ...getNeighbors(id, {
          model,
          minWeight: 0,
          overlay: document.neighborCorrections || [],
        }).map((edge) => edge.functionId),
      ])
    );
    const actors = new Set(
      coverage
        .filter(
          (record) =>
            relevantIds.has(record.functionId) && record.score >= settings.coverageThreshold
        )
        .map((record) => record.actorId)
    );
    if (fresh && row.responsibility.cet && (!actors.size || actors.has(event.actorId))) {
      attention.turnsSinceRefresh += 1;
      attention.reactivationScore *= Math.pow(0.5, 1 / attention.halfLifeTurns);
    }
    if (
      event.functionIds.includes(row.functionId) ||
      sources.some((id) => event.functionIds.includes(id))
    ) {
      attention.turnsSinceRefresh = 0;
      attention.retired = false;
    }
    row.attention = attentionState(attention, settings);
  }
}

function refillAttention(document, rows, settings) {
  if (!document.pendingRefill) return;
  const eligible = rows.filter((row) => row.responsibility.cet);
  const total = eligible.reduce((sum, row) => sum + row.attention.relevance, 0);
  for (const row of eligible) {
    const attention = row.attention;
    const units = Math.min(
      settings.allowanceCap - attention.allowance,
      (settings.allowancePerTurn * attention.relevance) / total
    );
    attention.allowance += units;
    attention.replenishedUnits += units;
    if (units > 0) attention.allowanceExhausted = false;
  }
  delete document.pendingRefill;
}

function validateAttentionSettings(settings) {
  const positive = ['halfLifeTurns', 'establishThreshold', 'allowanceCap', 'allowancePerTurn'];
  if (
    positive.some((key) => !Number.isFinite(settings[key]) || settings[key] <= 0) ||
    ['retainFactor', 'maxRetainFactor', 'establishedFactor'].some(
      (key) => !Number.isFinite(settings[key]) || settings[key] < 1
    ) ||
    settings.retainFactor > settings.maxRetainFactor ||
    !Number.isInteger(settings.maxNeighborsPerTouch) ||
    settings.maxNeighborsPerTouch < 0 ||
    !Number.isInteger(settings.turnDedupLimit) ||
    settings.turnDedupLimit < 1 ||
    ['retireThreshold', 'hysteresis'].some(
      (key) => !Number.isFinite(settings[key]) || settings[key] <= 0 || settings[key] >= 1
    )
  )
    throw new Error('Invalid attention settings');
}

module.exports = { attentionState, advanceAttention, refillAttention, validateAttentionSettings };
