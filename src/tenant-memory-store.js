'use strict';

const { writeCapability } = require('./tenant-memory-write-policy');
const { createHash } = require('node:crypto');
const { visible, deny } = require('./domain-router-policy');
const { normalizePhrase } = require('./function-resolver');
const { validateTenantId } = require('./tenant-context');

function namespace(p) {
  validateTenantId(p.tenantId);
  return `tenant:${p.tenantId}:workbench_facts`;
}
function key(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
function normalizeAnchor(value) {
  return normalizePhrase(String(value || ''))
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}
function anchorSyntax() {
  const words = (name, fallback) =>
    [...new Set((process.env[name] || fallback).split(',').map(normalizeAnchor))].filter(Boolean);
  return {
    prepositions: words(
      'TENANT_MEMORY_ANCHOR_PREPOSITIONS',
      'in,im,an,am,auf,bei,mit,zu,zum,zur,von,vom,für,über,unter,vor,nach,aus'
    ),
    articles: words(
      'TENANT_MEMORY_ANCHOR_ARTICLES',
      'der,die,das,den,dem,des,ein,eine,einer,einem,einen,eines'
    ),
  };
}
function anchorParts(value) {
  const original = String(value || '').trim();
  const parenthesized = original.match(/^(.+?)\s*\(([^()]+)\)$/);
  if (parenthesized) return { value: parenthesized[1].trim(), qualifier: parenthesized[2].trim() };
  const { prepositions, articles } = anchorSyntax();
  const tokens = original.split(/\s+/u);
  const boundary = tokens.findIndex(
    (token, index) =>
      index > 0 && index < tokens.length - 1 && prepositions.includes(normalizeAnchor(token))
  );
  if (boundary < 0) return { value: original, qualifier: '' };
  const trimArticles = (parts) => {
    while (parts.length && articles.includes(normalizeAnchor(parts[0]))) parts.shift();
    return parts.join(' ');
  };
  const qualifier = trimArticles(tokens.slice(0, boundary));
  const base = trimArticles(tokens.slice(boundary + 1));
  return qualifier && base ? { value: base, qualifier } : { value: original, qualifier: '' };
}
function qualifiedAnchor(anchor) {
  const parts = anchorParts(anchor.value);
  const qualifier = parts.qualifier || anchor.qualifier || '';
  const aliases = (anchor.aliases || [])
    .map((alias) => {
      const parsed = anchorParts(alias);
      if (parsed.qualifier && normalizeAnchor(parsed.qualifier) !== normalizeAnchor(qualifier))
        return '';
      return normalizeAnchor(parsed.value) === normalizeAnchor(`${qualifier} ${parts.value}`)
        ? parts.value
        : parsed.value;
    })
    .filter(Boolean);
  return { ...anchor, ...parts, qualifier, aliases: [...new Set(aliases)] };
}
function anchorKeys(anchor) {
  anchor = qualifiedAnchor(anchor);
  const qualifier = normalizeAnchor(anchor.qualifier);
  return [...new Set([anchor.value, ...(anchor.aliases || [])].map(normalizeAnchor))]
    .filter(Boolean)
    .map((base) => JSON.stringify([base, qualifier]));
}
function qualifiedMention(anchor, message) {
  const normalized = qualifiedAnchor(anchor);
  const qualifier = normalizeAnchor(normalized.qualifier);
  if (!qualifier) return true;
  const words = ` ${normalizeAnchor(message)} `;
  const { prepositions, articles } = anchorSyntax();
  return [normalized.value, ...normalized.aliases].some((name) => {
    const base = normalizeAnchor(name);
    if (words.includes(` ${base} ${qualifier} `) || words.includes(` ${qualifier} ${base} `))
      return true;
    return prepositions.some((prep) =>
      ['', ...articles].some((article) =>
        words.includes(` ${qualifier} ${prep} ${article ? `${article} ` : ''}${base} `)
      )
    );
  });
}
function humanFunctionLabel(value) {
  const label = typeof value === 'string' ? value.trim() : '';
  if (
    !label ||
    label.length > 80 ||
    /[()[\]{}\n]/u.test(label) ||
    label === 'Funktion nicht angegeben'
  )
    return '';
  if (
    require('./workbench-tool-answer').internalToolText(label) ||
    /\b(?:chain|processing|workflow|decision|blocked|follow[ -]?up|handover)\b/iu.test(label)
  )
    return '';
  const normalized = normalizeAnchor(label);
  return require('./function-model')
    .getFunctionModel()
    .functions.some((fn) =>
      [fn.functionId, fn.label, fn.displayLabel].some(
        (name) => name && normalizeAnchor(name) === normalized
      )
    )
    ? ''
    : label;
}
function compactEvidence(hits = []) {
  const seen = new Set();
  const excerpt = (value) => {
    const text = String(value || '')
      .replace(/\s+/gu, ' ')
      .trim();
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  };
  return hits
    .map((hit) => ({ ...hit, value: excerpt(hit.value) }))
    .filter((hit) => {
      const identity = JSON.stringify([
        hit.source,
        hit.url || hit.metadata?.url || '',
        hit.metadata?.workbenchDocument || hit.metadata?.key || '',
        hit.value,
      ]);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}
function active(fact, now = Date.now()) {
  return fact.status === 'valid' && (!fact.expiresAt || Date.parse(fact.expiresAt) > now);
}
async function query(ctx, p, selector = {}) {
  const docs = [];
  for (let skip = 0; ; skip += 1000) {
    const page = await ctx.call('object-store.query', {
      namespace: namespace(p),
      selector,
      limit: 1000,
      skip,
    });
    docs.push(...page.docs.map((doc) => doc.payload).filter((item) => visible(p, item)));
    if (page.docs.length < 1000) return docs;
  }
}
async function byBase(ctx, p, base) {
  const prefix = JSON.stringify([normalizeAnchor(base)]).slice(0, -1) + ',';
  return query(ctx, p, {
    'payload.type': 'tenant_memory_fact',
    'payload.anchorKeys': { $elemMatch: { $gte: prefix, $lt: prefix + '\uffff' } },
  });
}
async function get(ctx, p, id) {
  const doc = await ctx.call('object-store.get', { namespace: namespace(p), key: id });
  if (!visible(p, doc.payload)) deny('Statement not accessible');
  return doc;
}
async function put(ctx, p, payload, rev) {
  if (!visible(p, payload)) deny('Statement not accessible');
  return ctx.call(
    'object-store.put',
    {
      namespace: namespace(p),
      key: payload.id,
      payload,
      ...(rev ? { _rev: rev } : {}),
    },
    { meta: { tenantMemoryWrite: writeCapability } }
  );
}
async function mutate(ctx, p, id, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await get(ctx, p, id);
    const payload = change(structuredClone(doc.payload));
    if (!payload || JSON.stringify(payload) === JSON.stringify(doc.payload)) return doc.payload;
    try {
      return (await put(ctx, p, payload, doc._rev)).payload;
    } catch (error) {
      if (error.code !== 409 || attempt === 3) throw error;
    }
  }
}
function candidates(fact, facts) {
  const valid = facts.filter((item) => active(item));
  // Shared objects can connect statements about different subjects. Qualifiers
  // constrain explicit questions, not the relationship candidate search.
  const keys = (item) => [...new Set(item.anchorKeys.map((key) => JSON.parse(key)[0]))];
  const frequency = new Map();
  for (const item of valid)
    for (const anchor of keys(item)) frequency.set(anchor, (frequency.get(anchor) || 0) + 1);
  const strong = new Set(
    keys(fact).filter(
      (anchor) => Math.log((valid.length + 4) / ((frequency.get(anchor) || 0) + 1)) >= Math.log(2)
    )
  );
  return valid.filter(
    (item) => item.id !== fact.id && keys(item).some((anchor) => strong.has(anchor))
  );
}

function ambiguous(anchors, facts) {
  for (const anchor of anchors.map(qualifiedAnchor).filter((item) => !item.qualifier)) {
    const base = normalizeAnchor(anchor.value);
    const variants = new Set(
      facts
        .flatMap((fact) => fact.anchors || [])
        .map(qualifiedAnchor)
        .filter((item) => normalizeAnchor(item.value) === base && item.qualifier)
        .map((item) => item.qualifier)
    );
    if (variants.size > 1) return { value: anchor.value, variants: [...variants] };
  }
  return null;
}
function source(fact) {
  const date = new Date(fact.at).toLocaleDateString('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const functionLabel = humanFunctionLabel(fact.person.functionLabel);
  return `${fact.person.name} (${[functionLabel, date].filter(Boolean).join(', ')})`;
}
function factText(fact) {
  const labels = {
    valid: 'gültig',
    corrected: 'korrigiert',
    revoked: 'widerrufen',
    expired: 'abgelaufen',
    deleted: 'gelöscht',
  };
  const checking =
    fact.checking === 'failed'
      ? ` Prüfung fehlgeschlagen: ${fact.checkingFailure?.message || 'Versuchsgrenze erreicht'}.`
      : fact.checking === 'pending'
        ? ' Prüfung ausstehend.'
        : '';
  return `${source(fact)}${fact.documentSource ? `; Quelle: ${fact.documentSource.title}, Version ${fact.documentSource.version}, ${fact.documentSource.location}` : ''}: „${fact.text}“ (${labels[active(fact) ? 'valid' : fact.status === 'valid' ? 'expired' : fact.status]}).${checking}`;
}
async function relationText(ctx, p, id, { includeFacts = true } = {}) {
  const relation = (await get(ctx, p, id)).payload;
  if (relation.type === 'tenant_memory_fact')
    return active(relation) ? (relation.plausibility || []).join('\n') : '';
  if (relation.type !== 'tenant_memory_relation') return '';
  const facts = await Promise.all(
    relation.factIds.map(async (ref) => (await get(ctx, p, ref)).payload)
  );
  if (!facts.every((fact) => active(fact))) return '';
  const references = (relation.evidence || [])
    .map((hit) => `${hit.source}${hit.url ? ` (${hit.url})` : ''}`)
    .join('; ');
  // A rejected or lower-priority question must never remove the evidence and connection.
  return [
    ...(includeFacts ? facts.map(factText) : []),
    relation.reason,
    relation.question,
    references ? `Quelle: ${references}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
module.exports = {
  namespace,
  key,
  normalizeAnchor,
  qualifiedAnchor,
  anchorKeys,
  anchorSyntax,
  qualifiedMention,
  humanFunctionLabel,
  compactEvidence,
  active,
  query,
  byBase,
  get,
  put,
  mutate,
  candidates,
  ambiguous,
  source,
  factText,
  relationText,
};
