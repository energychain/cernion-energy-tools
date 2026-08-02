'use strict';

/**
 * Typed reference URIs shared by the inbound MCP server's meta-tools
 * (`cernion://{kind}/{id}`) — see docs/mcp-server.md design principle #2.
 * `search`/`describe` emit these; `execute_read`/`run_receipt`/
 * `prepare_process`/`process_status` accept them back.
 */

const SCHEME = 'cernion';

const KINDS = new Set([
  'operation',
  'capability',
  'receipt',
  'blueprint',
  'recipe',
  'intent',
  'job',
  'hitl',
]);

function buildRef(kind, id) {
  if (!KINDS.has(kind)) {
    throw new Error(`mcp-uri: unknown kind "${kind}"`);
  }
  if (id === undefined || id === null || id === '') {
    throw new Error('mcp-uri: id is required');
  }
  return `${SCHEME}://${kind}/${encodeURIComponent(String(id))}`;
}

/**
 * Parses a `cernion://{kind}/{id}` ref. Returns `null` if `input` isn't a
 * ref at all (callers use this to fall back to treating `input` as a bare
 * id + separately-supplied `kind`).
 */
function parseRef(input) {
  if (typeof input !== 'string') return null;
  const match = /^cernion:\/\/([a-z]+)\/(.+)$/.exec(input.trim());
  if (!match) return null;
  const [, kind, rawId] = match;
  if (!KINDS.has(kind)) return null;
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }
  return { kind, id };
}

module.exports = { buildRef, parseRef, KINDS };
