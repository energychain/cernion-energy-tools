'use strict';

const { compareCanonicalStrings: compare } = require('./canonical-order');
const { getNeighbors, resolveFunctionId } = require('./function-model');

function resolveRecords(records, model) {
  return records.flatMap((record) => {
    const successors = resolveFunctionId(record.functionId, { model });
    const resolved = successors.filter(({ functionId }) => {
      if (record.modelSourceHash && record.modelSourceHash === model.sourceHash)
        return functionId === record.functionId;
      if (!record.capabilities?.length) return true;
      return model.functions
        .find((fn) => fn.functionId === functionId)
        ?.capabilities?.some((id) => record.capabilities.includes(id));
    });
    return resolved.map(({ functionId }) => ({ ...record, functionId }));
  });
}

function coverageRecords(document, model) {
  const byActor = new Map();
  for (const record of [...document.coverage].sort(
    (a, b) => (a.sequence || 0) - (b.sequence || 0)
  )) {
    const resolved = resolveRecords([record], model);
    if (resolved.length !== 1) continue;
    const [entry] = resolved;
    byActor.set(JSON.stringify([entry.functionId, entry.actorId]), entry);
  }
  return [...byActor.values()];
}

function activationRows(document, model, settings, now) {
  const touches = resolveRecords(document.touches, model);
  // Ambiguous prior coverage does not establish coverage of each successor.
  // Ambiguous prior coverage does not establish coverage of each successor.
  const coverage = coverageRecords(document, model);
  const activity = resolveRecords(document.activity, model);
  const previous = resolveRecords(document.activations || [], model);
  const live = (at) =>
    at != null && now - Date.parse(at) >= 0 && now - Date.parse(at) <= settings.restWindowMs;
  const rows = model.functions.map(({ functionId }) => {
    const current = touches.filter((record) => record.functionId === functionId);
    const touchedAt =
      current
        .map((record) => record.at)
        .filter(Boolean)
        .sort(compare)
        .at(-1) || null;
    const lastActivity = activity
      .filter((record) => record.functionId === functionId)
      .map((record) => record.at)
      .filter(Boolean)
      .sort(compare)
      .at(-1);
    const humans = [
      ...new Set(
        coverage
          .filter(
            (record) =>
              record.functionId === functionId && record.score >= settings.coverageThreshold
          )
          .map((record) => record.actorId)
      ),
    ].sort(compare);
    const wasActive = previous.some(
      (record) => record.functionId === functionId && record.state !== 'latent'
    );
    const state =
      live(touchedAt) || (touchedAt && live(lastActivity))
        ? 'active'
        : touchedAt || wasActive
          ? 'dormant'
          : 'latent';
    return {
      tenantId: document.tenantId,
      functionId,
      state,
      touchedAt,
      touchedBy: [...new Set(current.map((record) => record.actorId))].sort(compare),
      responsibility: { humans, cet: false },
      reason: touchedAt ? [{ kind: 'touched', at: touchedAt }] : [],
    };
  });
  const byId = new Map(rows.map((row) => [row.functionId, row]));
  const candidates = new Map();
  for (const source of rows.filter((row) => row.touchedAt)) {
    for (const edge of getNeighbors(source.functionId, { model, minWeight: settings.minWeight })) {
      const target = byId.get(edge.functionId);
      if (!target || target.functionId === source.functionId || target.responsibility.humans.length)
        continue;
      const lastActivity = activity
        .filter((record) => record.functionId === target.functionId)
        .map((record) => record.at)
        .filter(Boolean)
        .sort(compare)
        .at(-1);
      if (!live(source.touchedAt) && !live(lastActivity)) continue;
      const reasons = candidates.get(target.functionId) || [];
      reasons.push({
        kind: 'neighbor',
        functionId: source.functionId,
        weight: edge.weight,
        evidence: edge.evidence,
      });
      candidates.set(target.functionId, reasons);
    }
  }
  const ranked = [...candidates].sort(
    (a, b) =>
      Math.max(...b[1].map((reason) => reason.weight)) -
        Math.max(...a[1].map((reason) => reason.weight)) || compare(a[0], b[0])
  );
  const budget = Object.hasOwn(settings.tenantBudgets, document.tenantId)
    ? settings.tenantBudgets[document.tenantId]
    : settings.tenantBudget;
  ranked.forEach(([functionId, reasons], index) => {
    const row = byId.get(functionId);
    row.reason.push(...reasons);
    if (index < budget) {
      row.state = 'active';
      row.responsibility.cet = true;
    } else row.reason.push({ kind: 'budget_deferred', budget });
  });
  for (const row of rows) {
    if (
      row.state === 'dormant' &&
      !row.responsibility.humans.length &&
      !row.reason.some((entry) => entry.kind === 'budget_deferred')
    )
      row.reason.push({ kind: 'rest', restWindowMs: settings.restWindowMs });
    const handoff = resolveRecords(
      document.history.filter((entry) => entry.kind === 'handoff'),
      model
    ).filter((entry) => entry.functionId === row.functionId);
    row.reason.push(...handoff.map(({ kind, actorId, at }) => ({ kind, actorId, at })));
  }
  return rows.sort((a, b) => compare(a.functionId, b.functionId));
}

module.exports = { activationRows, resolveRecords };
