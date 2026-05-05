'use strict';

function normalizeMode(mode) {
  const value = String(mode || 'paragraph').trim().toLowerCase();
  if (['paragraph', 'markdown-section', 'fixed-window', 'semantic'].includes(value)) {
    return value;
  }
  return 'paragraph';
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

function splitParagraph(text) {
  return normalizeText(text)
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitMarkdownSections(text) {
  const source = normalizeText(text);
  const lines = source.split('\n');
  const sections = [];

  let heading = '';
  let buffer = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (!body && !heading) return;
    sections.push([heading, body].filter(Boolean).join('\n\n').trim());
    buffer = [];
  };

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line.trim())) {
      flush();
      heading = line.trim();
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections.filter(Boolean);
}

function splitFixedWindow(text, options = {}) {
  const source = normalizeText(text).trim();
  if (!source) return [];

  const windowSize = Number(options.windowSize || 1000);
  const overlap = Number(options.overlap || 120);
  const safeWindow = Number.isFinite(windowSize) && windowSize >= 200 ? Math.floor(windowSize) : 1000;
  const safeOverlap =
    Number.isFinite(overlap) && overlap >= 0 && overlap < safeWindow
      ? Math.floor(overlap)
      : 120;

  const chunks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const end = Math.min(source.length, cursor + safeWindow);
    const chunk = source.slice(cursor, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= source.length) break;
    cursor = Math.max(end - safeOverlap, cursor + 1);
  }
  return chunks;
}

function splitSemantic(text, options = {}) {
  const source = normalizeText(text).trim();
  if (!source) return [];

  const maxChars = Number(options.maxChars || 900);
  const safeMax = Number.isFinite(maxChars) && maxChars >= 200 ? Math.floor(maxChars) : 900;
  const sentences = source
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.some((sentence) => sentence.length > safeMax)) {
    return splitFixedWindow(source, { windowSize: safeMax, overlap: Math.floor(safeMax * 0.12) });
  }

  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    if ((current + ' ' + sentence).length <= safeMax) {
      current = `${current} ${sentence}`.trim();
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) chunks.push(current);

  if (chunks.length === 0) {
    return splitFixedWindow(source, { windowSize: safeMax, overlap: Math.floor(safeMax * 0.12) });
  }

  return chunks;
}

function chunkText(text, config = {}) {
  const mode = normalizeMode(config.mode);

  if (mode === 'markdown-section') return splitMarkdownSections(text);
  if (mode === 'fixed-window') return splitFixedWindow(text, config);
  if (mode === 'semantic') return splitSemantic(text, config);
  return splitParagraph(text);
}

module.exports = {
  chunkText,
  normalizeMode,
};
