'use strict';

// This parser identifies transport boundaries, never instructions inside evidence.
function parseOpenWebUIContext(input) {
  const raw = String(input || '');
  const documents = [];
  const contextStart = raw.search(/<context\b[^>]*>/i);
  const sourceStart = raw.search(/<source\b[^>]*>/i);
  const boundary = contextStart >= 0 ? contextStart : sourceStart;
  if (boundary < 0) {
    const query = raw.match(/<user_query\b[^>]*>([\s\S]*?)(?:<\/user_query\s*>|$)/i);
    return { question: query ? query[1].trim() : raw.trim(), documents };
  }
  const prefix = raw.slice(0, boundary).trim();
  const contextOpen = raw.slice(boundary).match(/^<context\b[^>]*>/i);
  const start = boundary + (contextOpen?.[0].length || 0);
  const contextClose = [...raw.matchAll(/<\/context\s*>/gi)].at(-1);
  // A user_query inside a source is evidence, not an outer user request.
  const sourceClose = [...raw.matchAll(/<\/source\s*>/gi)].at(-1);
  const end =
    contextClose && contextClose.index >= start
      ? contextClose.index
      : sourceClose && sourceClose.index >= start
        ? sourceClose.index + sourceClose[0].length
        : raw.length;
  const body = raw.slice(start, end);
  const sourcePattern = /<source\b([^>]*)>([\s\S]*?)(?:<\/source\s*>|(?=<source\b)|$)/gi;
  let match;
  while ((match = sourcePattern.exec(body))) {
    const attributes = {};
    for (const attr of match[1].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4];
    }
    documents.push({
      id: attributes.id || null,
      name: attributes.name || attributes.filename || `Dokument ${documents.length + 1}`,
      text: match[2].replace(/<\/context\s*>\s*$/i, ''),
    });
  }
  if (!documents.length && body.trim()) documents.push({ id: null, name: 'Dokument', text: body });
  const tail = raw.slice(end).replace(/^<\/context\s*>/i, '');
  const query = tail.match(/<user_query\b[^>]*>([\s\S]*?)(?:<\/user_query\s*>|$)/i);
  const prefixQuery = prefix.match(/<user_query\b[^>]*>([\s\S]*?)(?:<\/user_query\s*>|$)/i);
  return {
    question: (query ? query[1] : prefixQuery ? prefixQuery[1] : prefix || tail).trim(),
    documents,
  };
}

module.exports = { parseOpenWebUIContext };
