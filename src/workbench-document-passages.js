'use strict';

// Lines are anchored inside server-derived chapter/page spans, never across their boundaries.
function passageLines(text, spans) {
  const lines = [];
  for (const span of spans) {
    const content = text.slice(span.start, span.end);
    for (const match of content.matchAll(/[^\r\n]+/gu)) {
      const quote = match[0].trim();
      if (!quote) continue;
      const start = span.start + match.index + match[0].indexOf(quote);
      lines.push({ ...span, start, end: start + quote.length, quote, line: lines.length + 1 });
    }
  }
  return lines;
}

function mappedPassages(mapped, lines) {
  const references =
    mapped.citations ||
    ['claims', 'assumptions', 'numbers', 'measures', 'schedule']
      .flatMap((key) => mapped[key])
      .map((quote) => ({ quote }));
  const found = new Map();
  for (const reference of references) {
    const quote = reference.quote.trim();
    if (!quote) continue;
    const candidates = lines.filter(
      (line) =>
        (reference.line == null || reference.line === line.line) && line.quote.includes(quote)
    );
    // An unanchored repeated quote is ambiguous. Never guess its first occurrence.
    if (candidates.length !== 1) continue;
    const line = candidates[0];
    const start = line.start + line.quote.indexOf(quote);
    found.set(`${start}:${quote.length}`, { ...line, start, end: start + quote.length, quote });
  }
  return [...found.values()];
}

function citationMatches(finding, location) {
  const numbers = String(finding).match(/\d+(?:[.,]\d+)*/gu) || [];
  const quotedNumbers = location.quote.match(/\d+(?:[.,]\d+)*/gu) || [];
  if (numbers.length) return numbers.some((number) => quotedNumbers.includes(number));
  const tokens = finding.toLocaleLowerCase().match(/[\p{L}]{5,}/gu) || [];
  return tokens.some((token) => location.quote.toLocaleLowerCase().includes(token));
}

function summarizePassages(lines, limit = 8) {
  // Ignore variable row labels/numbers when counting otherwise identical boilerplate.
  const key = (quote) =>
    quote.replace(/^(?:Abschnitt \d+-\d+:|\d+[.)])\s*/u, '').replace(/\s+/gu, ' ');
  const counts = new Map();
  for (const line of lines) counts.set(key(line.quote), (counts.get(key(line.quote)) || 0) + 1);
  const seen = new Set();
  let repeated = 0;
  const selected = [];
  for (const line of lines) {
    if (/^(?:Kapitel|Chapter|Seite|Page)\s+\d+\b/iu.test(line.quote)) continue;
    const fingerprint = key(line.quote);
    if (counts.get(fingerprint) > 2) {
      repeated++;
      continue;
    }
    if (seen.has(line.quote)) continue;
    seen.add(line.quote);
    selected.push(line);
  }
  const substantive = selected;
  return {
    selected: substantive.slice(0, limit),
    repeated,
    omitted: Math.max(0, selected.length - limit),
  };
}

module.exports = { passageLines, mappedPassages, citationMatches, summarizePassages };
