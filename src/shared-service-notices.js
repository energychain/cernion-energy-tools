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
  if (['memory', 'quota'].includes(item.kind)) return item;
  const candidates = resolveFunctionId(item.functionId, { model });
  const matches =
    item.modelSourceHash === model.sourceHash
      ? candidates.filter((candidate) => candidate.functionId === item.functionId)
      : candidates;
  // A split cannot silently retarget an object reference.
  return matches.length === 1 ? { ...item, functionId: matches[0].functionId } : null;
}

function noticeText(item, _model) {
  if (['memory', 'quota'].includes(item.kind)) return item.text || '';
  // Status transitions without case content are not useful notifications.
  return typeof item.text === 'string' ? item.text.trim() : '';
}

function renderNoticeBlock(items, remaining = 0, model) {
  const lines = [...new Set(items.map((item) => noticeText(item, model)).filter(Boolean))];
  if (!lines.length) return '';
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
        ['memory', 'proposal', 'gap', 'signal'].includes(item.kind) || noticeText(item, model)
    )
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
