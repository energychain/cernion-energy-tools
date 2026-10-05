'use strict';

const { createHash } = require('node:crypto');
const { resolveFunctionId } = require('./function-model');
const { compareCanonicalStrings } = require('./canonical-order');

function noticeKey(source, event) {
  return createHash('sha256')
    .update(JSON.stringify([source, event]))
    .digest('hex');
}

function resolvedNotice(item, model) {
  const candidates = resolveFunctionId(item.functionId, { model });
  const matches =
    item.modelSourceHash === model.sourceHash
      ? candidates.filter((candidate) => candidate.functionId === item.functionId)
      : candidates;
  // A split cannot silently retarget an object reference.
  return matches.length === 1 ? { ...item, functionId: matches[0].functionId } : null;
}

function noticeText(item, model) {
  const label = model.functions.find((fn) => fn.functionId === item.functionId)?.label || '';
  const clean = String(label)
    .replace(/[\u0000-\u001f]/g, ' ')
    .slice(0, 180);
  const text = {
    proposal: 'Neuer Vorschlag',
    signal: `Signal: ${item.state}`,
    responsibility: item.cet ? 'CET übernimmt Verantwortung' : 'CET gibt Verantwortung ab',
    tier: item.tier === 'inventory' ? 'Jetzt im Inventar' : 'Jetzt eingesessen',
  }[item.kind];
  return `${item.ref}: ${text} – ${clean}.`;
}

function renderNoticeBlock(items, remaining = 0, model) {
  if (!items.length) return '';
  const groups = new Map();
  for (const item of items) {
    const values = groups.get(item.functionId) || [];
    values.push(noticeText(item, model));
    groups.set(item.functionId, values);
  }
  const lines = [...groups.values()].map((values) => values.join(' '));
  if (remaining) lines.push(`Und ${remaining} weitere – frag: „Was gibt es Neues?“`);
  return `Hinweise für dich:\n${lines.join('\n')}`;
}

function eligibleNotices(doc, model) {
  return doc.queue
    .filter((item) => doc.turn - item.turn < doc.expireAfterTurns)
    .map((item) => resolvedNotice(item, model))
    .filter(Boolean)
    .filter(
      (item) =>
        doc.preference === 'all' ||
        (doc.preference === 'proposals_only' && item.kind === 'proposal')
    )
    .sort((a, b) => a.sequence - b.sequence || compareCanonicalStrings(a.ref, b.ref));
}

function noticeDeliveryOptions(ctx, tools) {
  if (!ctx.broker?.getLocalService?.('notices')) return [];
  return [
    {
      meta: {
        ...ctx.meta,
        sharedServiceNoticesDefer: true,
        sharedServiceNoticesStructured: !!ctx.params.response_format || tools.length > 0,
      },
    },
  ];
}

function prependNotice(result, content) {
  return result.noticeBlock && !content.startsWith(result.noticeBlock)
    ? `${result.noticeBlock}\n\n${content}`
    : content;
}

module.exports = {
  noticeDeliveryOptions,
  prependNotice,
  noticeKey,
  resolvedNotice,
  noticeText,
  renderNoticeBlock,
  eligibleNotices,
};
