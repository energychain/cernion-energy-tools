'use strict';

const { compareCanonicalStrings: compare } = require('./canonical-order');
const { getNeighbors } = require('./function-model');
const { resolveRecords, coverageRecords } = require('./function-activation-records');
const { attentionState } = require('./function-attention');

function activationRows(document, model, settings, now) {
  const touches = resolveRecords(document.touches, model).filter(
    (record) => record.confidence >= settings.minTouchConfidence
  );
  // Ambiguous prior coverage does not establish coverage of each successor.
  const coverage = coverageRecords(document, model);
  const activity = resolveRecords(document.activity, model);
  const previous = resolveRecords(document.activations || [], model);
  const live = (at) =>
    at != null && now - Date.parse(at) >= 0 && now - Date.parse(at) <= settings.restWindowMs;
  const rows = model.functions.map(({ functionId }) => {
    const saved = previous.filter((record) => record.functionId === functionId);
    const current = touches.filter((record) => record.functionId === functionId);
    const touchedAt =
      [...current.map((record) => record.at), ...saved.map((record) => record.touchedAt)]
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
      touchedBy: [
        ...new Set([
          ...current.map((record) => record.actorId),
          ...saved.flatMap((record) => record.touchedBy || []),
        ]),
      ].sort(compare),
      responsibility: { humans, cet: false },
      reason: touchedAt ? [{ kind: 'touched', at: touchedAt }] : [],
      ...(saved.find((item) => item.attention)
        ? { attention: attentionState(saved.find((item) => item.attention).attention, settings) }
        : {}),
    };
  });
  const byId = new Map(rows.map((row) => [row.functionId, row]));
  const candidates = new Map();
  for (const source of rows.filter((row) => row.touchedAt)) {
    const edges = getNeighbors(source.functionId, {
      model,
      minWeight: settings.minWeight,
      overlay: document.neighborCorrections || [],
    })
      .sort((a, b) => b.weight - a.weight || compare(a.functionId, b.functionId))
      .slice(0, settings.maxNeighborsPerTouch);
    for (const edge of edges) {
      const target = byId.get(edge.functionId);
      if (!target || target.functionId === source.functionId || target.responsibility.humans.length)
        continue;
      const lastActivity = activity
        .filter((record) => record.functionId === target.functionId)
        .map((record) => record.at)
        .filter(Boolean)
        .sort(compare)
        .at(-1);
      if (!live(source.touchedAt) && !live(lastActivity) && !target.attention?.inventory) continue;
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
  const preferences = [
    ...new Map(
      resolveRecords(document.responsibilityCorrections || [], model).map((row) => [
        row.functionId,
        row,
      ])
    ).values(),
  ];
  for (const pref of preferences) {
    if (!pref.cet) candidates.delete(pref.functionId);
  }
  const ranked = [...candidates].sort(
    (a, b) =>
      Number(preferences.findLast((p) => p.functionId === b[0])?.cet === true) -
        Number(preferences.findLast((p) => p.functionId === a[0])?.cet === true) ||
      Math.max(...b[1].map((reason) => reason.weight)) -
        Math.max(...a[1].map((reason) => reason.weight)) ||
      compare(a[0], b[0])
  );
  const budget = Object.hasOwn(settings.tenantBudgets, document.tenantId)
    ? settings.tenantBudgets[document.tenantId]
    : settings.tenantBudget;
  let selected = 0;
  ranked.forEach(([functionId, reasons]) => {
    const row = byId.get(functionId);
    row.reason.push(...reasons);
    if (row.attention?.retired) {
      row.state = 'dormant';
      row.reason.push({ kind: 'attention_retired' });
    } else if (selected < budget) {
      selected += 1;
      row.state = 'active';
      row.responsibility.cet = true;
      row.attention = attentionState(row.attention, settings);
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
    const summaries = previous
      .filter((entry) => entry.functionId === row.functionId)
      .flatMap((entry) => entry.reason || [])
      .filter((entry) => entry.kind === 'handoff');
    const latest = [
      ...summaries,
      ...handoff.map(({ kind, actorId, at }) => ({ kind, actorId, at })),
    ]
      .sort((a, b) => compare(a.at, b.at))
      .at(-1);
    if (latest) row.reason.push(latest);
  }
  return rows.sort((a, b) => compare(a.functionId, b.functionId));
}

module.exports = { activationRows, resolveRecords, coverageRecords };
