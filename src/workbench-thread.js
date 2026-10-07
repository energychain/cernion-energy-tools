'use strict';

function maxInputChars() {
  const value = Number(process.env.WORKBENCH_MAX_INPUT_CHARS || 40000);
  return Number.isInteger(value) && value > 0 ? value : 40000;
}

// Repetition alone is not enough: only repeated multi-line trailing blocks
// are removed. Repeated promises in the message body remain evidence.
function prepareThread(raw, budget = 16000) {
  const normalized = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\s*>\s?/gm, '');
  const pieces = normalized.split(/(?=^(?:Von|From):\s|^(?:Am .+ schrieb.*:|On .+ wrote:))/m);
  const messages = pieces.map((piece, index) => {
    const sender =
      piece.match(/^(?:Von|From):\s*(.+)$/m)?.[1] ||
      piece.match(/^(?:Am .+ schrieb.*:|On .+ wrote:)$/m)?.[0] ||
      '';
    const date = piece.match(/^(?:Gesendet|Sent|Date|Datum):\s*(.+)$/m)?.[1] || '';
    const subject = piece.match(/^(?:Betreff|Subject):\s*(.+)$/m)?.[1] || '';
    const body = piece
      .replace(/^(?:Von|From|Gesendet|Sent|Date|Datum|An|To|Betreff|Subject):[^\n]*\n?/gm, '')
      .trim();
    return { index, sender, date, subject, blocks: body.split(/\n\s*\n/).filter(Boolean) };
  });
  const counts = new Map();
  for (const message of messages) {
    for (const block of message.blocks.slice(1)) {
      if (block.split('\n').length < 2 || block.length < 60) continue;
      counts.set(block, (counts.get(block) || 0) + 1);
    }
  }
  const allowance = Math.max(200, Math.floor(budget / Math.max(1, messages.length)));
  const timeline = messages.map((message) => ({
    role: message.sender || 'correspondent',
    date: message.date,
    summary: (() => {
      const footerStart = message.blocks.findIndex(
        (block, index) =>
          index > 0 &&
          (counts.get(block) || 0) >= 2 &&
          (message.blocks.filter((candidate) => candidate === block).length >= 2 ||
            /@|https?:\/\/|\+\d[\d ()-]{6,}/.test(block))
      );
      return message.blocks
        .filter(
          (block, index) => footerStart < 0 || index < footerStart || (counts.get(block) || 0) < 2
        )
        .join('\n\n')
        .slice(0, allowance);
    })(),
    subject: message.subject,
    position: message.index,
  }));
  const time = (value) => {
    const numeric = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:.*?(\d{1,2}):(\d{2}))?/);
    return numeric
      ? Date.UTC(
          Number(numeric[3]),
          Number(numeric[2]) - 1,
          Number(numeric[1]),
          Number(numeric[4] || 0),
          Number(numeric[5] || 0)
        )
      : Date.parse(value);
  };
  timeline.sort((a, b) => {
    const left = time(a.date),
      right = time(b.date);
    return Number.isFinite(left) && Number.isFinite(right) ? left - right : a.position - b.position;
  });
  return {
    text: timeline
      .map((entry) =>
        [
          entry.role === 'correspondent' ? '' : `Von: ${entry.role}`,
          entry.date ? `Gesendet: ${entry.date}` : '',
          entry.subject ? `Betreff: ${entry.subject}` : '',
          entry.summary,
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n')
      .slice(0, budget),
    timeline: messages.some((entry) => entry.sender)
      ? timeline
          .filter((entry) => entry.role !== 'correspondent')
          .map((entry) => ({ ...entry, role: 'correspondent' }))
      : [],
    truncated:
      normalized.length > budget &&
      timeline.reduce((sum, entry) => sum + entry.summary.length, 0) >= budget,
  };
}

function isDocumentInput(message) {
  return (
    prepareThread(message).timeline.length > 0 ||
    /^(?:Mein|Unser) (?:Antwort)?entwurf:/i.test(String(message || '').trim())
  );
}

module.exports = { prepareThread, maxInputChars, isDocumentInput };
