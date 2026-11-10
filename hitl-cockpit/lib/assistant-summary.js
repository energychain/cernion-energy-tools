'use strict';

const SENSITIVE =
  /(?:\bt\W*w\W*l\b|twl[\s_.\-/]*netze|private[\s_.\-/]*(?:board|lane|room|id|metadata|quarantine)?|\brestricted\b|mixed[\s_.\-/]*sensitive)\b[^.!?\n]*/giu;
const CREDENTIAL =
  /\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|password|secret|cookie|session[_-]?(?:id|token)|token)\b\s*(?:[:=/]|\bis\b)\s*[^\s,;]+/giu;
const BEARER = /\bbearer\s+[A-Za-z0-9._~+/=-]+/giu;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu;

function sanitizeSummaryText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(CREDENTIAL, '[REDACTED]')
    .replace(BEARER, '[REDACTED]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(SENSITIVE, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_=-]{32,}\b/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidates(messages, expression) {
  const result = [];
  for (const message of messages) {
    const text = sanitizeSummaryText(message && message.content);
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
      if (expression.test(sentence) && !result.includes(sentence)) result.push(sentence);
    }
  }
  return result;
}

function fitSections(sections, requestedMaxChars) {
  const fallbackLines = sections.map(([label]) => `${label}: —`);
  const minimum = fallbackLines.join('\n').length;
  const maxChars = Math.max(minimum, Math.min(Number(requestedMaxChars) || 1200, 4000));
  const lines = [...fallbackLines];
  for (let index = 0; index < sections.length; index += 1) {
    const [label, items] = sections[index];
    if (!items.length) continue;
    for (const content of [items.join(' | '), items[0]]) {
      const candidate = `${label}: ${content}`;
      const next = [...lines];
      next[index] = candidate;
      if (next.join('\n').length <= maxChars) {
        lines[index] = candidate;
        break;
      }
    }
  }
  return lines.join('\n');
}

function buildAssistantSummary(messages, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const goals = candidates(source, /\b(?:ziel|goal|erreichen|ergebnis)\b/i).slice(-3);
  const decisions = candidates(
    source,
    /\b(?:entscheidung|entschieden|beschlossen|wir beginnen|we choose)\b/i
  ).slice(-3);
  const tasks = candidates(
    source,
    /\b(?:aufgabe|aufgaben|assignment|todo|zuständig|verantwortlich|nächste[rs]? schritt)\b/i
  ).slice(-3);
  const evidence = candidates(
    source,
    /\b(?:evidenz|beleg|belegt|nachweis|quelle|evidence|test(?:s|fall)?)\b/i
  ).slice(-3);
  const questions = candidates(source, /\?|\b(?:offene frage|unklar|zu klären|klaeren)\b/i).slice(
    -3
  );
  return fitSections(
    [
      ['Ziele', goals],
      ['Entscheidungen', decisions],
      ['Offene Aufgaben', tasks],
      ['Evidenz', evidence],
      ['Offene Fragen', questions],
    ],
    options.maxChars
  );
}

module.exports = { buildAssistantSummary, sanitizeSummaryText };
