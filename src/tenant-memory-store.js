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
function qualifiedAnchor(anchor) {
  const match = String(anchor.value).match(/^(.+?)\s*\(([^()]+)\)$/);
  return match && !anchor.qualifier
    ? { ...anchor, value: match[1].trim(), qualifier: match[2].trim() }
    : anchor;
}
function anchorKeys(anchor) {
  anchor = qualifiedAnchor(anchor);
  const qualifier = normalizeAnchor(anchor.qualifier);
  return [...new Set([anchor.value, ...(anchor.aliases || [])].map(normalizeAnchor))]
    .filter(Boolean)
    .map((base) => JSON.stringify([base, qualifier]));
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
    if (!payload) return doc.payload;
    try {
      return (await put(ctx, p, payload, doc._rev)).payload;
    } catch (error) {
      if (error.code !== 409 || attempt === 3) throw error;
    }
  }
}
function candidates(fact, facts) {
  const valid = facts.filter((item) => active(item));
  // Resolve a bare base to its sole tenant qualifier, retaining separation when variants exist.
  const variants = new Map();
  for (const item of valid)
    for (const key of item.anchorKeys) {
      const [base, qualifier] = JSON.parse(key);
      if (qualifier) {
        if (!variants.has(base)) variants.set(base, new Set());
        variants.get(base).add(qualifier);
      }
    }
  const keys = (item) => [
    ...new Set(
      item.anchorKeys.map((key) => {
        const [base, qualifier] = JSON.parse(key);
        const choices = variants.get(base);
        return JSON.stringify([base, qualifier || (choices?.size === 1 ? [...choices][0] : '')]);
      })
    ),
  ];
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
  return `${fact.person.name} (${fact.person.functionLabel || fact.person.roles.join(', ')}, ${fact.at})`;
}
function factText(fact) {
  const labels = {
    valid: 'gültig',
    corrected: 'korrigiert',
    revoked: 'widerrufen',
    expired: 'abgelaufen',
    deleted: 'gelöscht',
  };
  return `${source(fact)}: „${fact.text}“ (${labels[active(fact) ? 'valid' : fact.status === 'valid' ? 'expired' : fact.status]}).`;
}
async function relationText(ctx, p, id) {
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
  return `${facts.map(factText).join(' ')} ${relation.reason} ${relation.question || ''}${references ? ` Quelle: ${references}.` : ''}`.trim();
}
module.exports = {
  namespace,
  key,
  normalizeAnchor,
  qualifiedAnchor,
  anchorKeys,
  active,
  query,
  get,
  put,
  mutate,
  candidates,
  ambiguous,
  source,
  factText,
  relationText,
};
