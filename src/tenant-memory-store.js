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
  if (parenthesized)
    return { value: anchorParts(parenthesized[1]).value, qualifier: parenthesized[2].trim() };
  const { prepositions, articles } = anchorSyntax();
  const tokens = original.split(/\s+/u);
  const boundary = tokens.findLastIndex(
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
// Parse the literal evidence with case and sentence boundaries. Grammar,
// morphology and structural identifiers replace any subject/place vocabulary.
function referenceAnchors(basis) {
  const text = String(basis || '');
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:[-_/][\p{L}\p{N}]+)*/gu)];
  const { prepositions, articles } = anchorSyntax();
  const result = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!prepositions.includes(normalizeAnchor(tokens[i][0]))) continue;
    const prefix = text.slice(0, tokens[i].index);
    let start = i + 1;
    while (start < tokens.length && articles.includes(normalizeAnchor(tokens[start][0]))) start++;
    if (start >= tokens.length) continue;
    let end = start;
    const isId = (word) => /\d/u.test(word) && !/^\d{1,4}$/u.test(word);
    while (end < tokens.length && (/^\p{Lu}/u.test(tokens[end][0]) || isId(tokens[end][0]))) {
      if (
        end > start &&
        /[:,.!?;()\[\]—–\n-]/u.test(
          text.slice(tokens[end - 1].index + tokens[end - 1][0].length, tokens[end].index)
        )
      )
        break;
      end++;
    }
    if (end === start) continue;
    const identifier = tokens.slice(start, end).find((token) => isId(token[0]));
    const value = identifier
      ? identifier[0]
      : tokens
          .slice(start, end)
          .map((token) => token[0])
          .join(' ');
    if (
      !identifier &&
      (articles.includes(normalizeAnchor(tokens[end]?.[0])) ||
        /(?:ung|heit|keit|schaft|tion|ität)$/u.test(value) ||
        new RegExp(`(?:^|\\s)${normalizeAnchor(value)}(?:\\s|$)`, 'u').test(
          normalizeAnchor(prefix)
        ))
    )
      continue;
    result.push({ value, prefix });
  }
  return result;
}
function groundedAnchors(anchors = [], basis = '', facts = [], corpus = facts) {
  const references = referenceAnchors(basis);
  const words = ` ${normalizeAnchor(basis)} `;
  const known = facts.flatMap((fact) => (fact.anchors || []).map(qualifiedAnchor));
  const structural = [
    ...String(basis).matchAll(
      /(?:^|[\s.!?])([\p{Lu}][\p{L}\p{N}]*)-[\p{Lu}][\p{L}]+|\p{L}[ \t]+([\p{Lu}][\p{L}\p{N}]*)\s*:/gu
    ),
  ].map((match) => match[1] || match[2]);
  const matches = [...known.map((anchor) => anchor.value), ...structural].filter((value) =>
    words.includes(` ${normalizeAnchor(value)} `)
  );
  for (const value of weightedAnchors(matches, corpus))
    if (!references.some((ref) => normalizeAnchor(ref.value) === normalizeAnchor(value)))
      references.push({ value, prefix: '' });
  const normalized = anchors
    .map((anchor) => {
      let qualified = qualifiedAnchor(anchor);
      const extended =
        !references.some(
          (item) => normalizeAnchor(item.value) === normalizeAnchor(qualified.value)
        ) &&
        references.find((item) =>
          normalizeAnchor(qualified.value).startsWith(`${normalizeAnchor(item.value)} `)
        );
      if (extended) qualified = { ...qualified, value: extended.value, aliases: [] };
      const reference = references.find((item) =>
        ` ${normalizeAnchor(item.prefix)} `.endsWith(` ${normalizeAnchor(qualified.value)} `)
      );
      if (reference)
        qualified = {
          ...qualified,
          value: reference.value,
          qualifier: qualified.value,
          aliases: [],
        };
      else {
        const aliasReference = references.find((item) =>
          qualified.aliases.some((alias) => normalizeAnchor(alias) === normalizeAnchor(item.value))
        );
        if (aliasReference) qualified = { ...qualified, value: aliasReference.value };
      }
      return qualified.qualifier && !qualifiedMention(qualified, basis)
        ? { ...qualified, qualifier: '' }
        : qualified;
    })
    .filter(
      (anchor) =>
        !references.length ||
        anchorKeys(anchor).some((key) =>
          ` ${normalizeAnchor(basis)} `.includes(` ${JSON.parse(key)[0]} `)
        )
    );
  for (const reference of references) {
    if (
      !normalized.some((anchor) =>
        anchorKeys(anchor).some((key) => JSON.parse(key)[0] === normalizeAnchor(reference.value))
      )
    )
      normalized.push({ value: reference.value, qualifier: '', aliases: [] });
  }
  const seen = new Set();
  return normalized.filter((anchor) => {
    const identity = JSON.stringify(anchorKeys(anchor));
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
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
// Internal aggregate input: tenant-scoped reads only, never exposed as evidence.
async function frequencyCorpus(ctx, p) {
  const objects = ctx.broker?.getLocalService('object-store');
  if (!objects?.db) return query(ctx, p, { 'payload.type': 'tenant_memory_fact' });
  const authenticated = require('./domain-router-policy').principal(ctx);
  if (authenticated.tenantId !== p.tenantId) deny('Tenant mismatch');
  const facts = [];
  for (let skip = 0; ; skip += 1000) {
    const page = await objects.db.find({
      selector: { ns: namespace(p), 'payload.type': 'tenant_memory_fact' },
      limit: 1000,
      skip,
    });
    facts.push(...page.docs.map((doc) => doc.payload));
    if (page.docs.length < 1000) return facts;
  }
}
// One tenant-wide document-frequency rule for both literal candidates and relations.
function weightedAnchors(values, facts) {
  const valid = facts.filter((fact) => active(fact));
  const documents = valid.map((fact) => ({
    words: ` ${normalizeAnchor([fact.message, fact.basis, fact.text].filter(Boolean).join(' '))} `,
    bases: new Set((fact.anchorKeys || []).map((key) => JSON.parse(key)[0])),
  }));
  return [...new Set(values)].filter((value) => {
    const base = normalizeAnchor(value);
    if (!base) return false;
    const df = documents.filter(
      (doc) => doc.bases.has(base) || doc.words.includes(` ${base} `)
    ).length;
    return Math.log((valid.length + 4) / (df + 1)) >= Math.log(2);
  });
}
// Expand only by copying a continuous literal sentence/paragraph span.
function literalBasis(basis, message, anchors) {
  const original = String(message || basis || '');
  const bases = anchors.flatMap(anchorKeys).map((key) => JSON.parse(key)[0]);
  if (bases.every((base) => ` ${normalizeAnchor(basis)} `.includes(` ${base} `))) return basis;
  const index = original.indexOf(basis);
  if (index < 0) return original;
  const boundaries = [
    0,
    ...[...original.matchAll(/[.!?]\s+|\n\s*\n/gu)].map((match) => match.index + match[0].length),
    original.length,
  ];
  let start = boundaries.filter((offset) => offset <= index).at(-1);
  let end = boundaries.find((offset) => offset >= index + basis.length);
  while (
    !bases.every((base) => ` ${normalizeAnchor(original.slice(start, end))} `.includes(` ${base} `))
  ) {
    if (start === 0 && end === original.length) break;
    start = boundaries[boundaries.indexOf(start) - 1] ?? 0;
    end = boundaries[boundaries.indexOf(end) + 1] ?? original.length;
  }
  return original.slice(start, end).trim();
}
function candidates(fact, facts, corpus = facts) {
  const valid = facts.filter((item) => active(item));
  // Shared objects can connect statements about different subjects. Qualifiers
  // constrain explicit questions, not the relationship candidate search.
  const keys = (item) => [...new Set(item.anchorKeys.map((key) => JSON.parse(key)[0]))];
  const strong = new Set(weightedAnchors(keys(fact), corpus).map(normalizeAnchor));
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
// A recipient-specific summary, never an unassessed pair of raw statements.
async function relationNotice(ctx, p, id, actorId) {
  const relation = (await get(ctx, p, id)).payload;
  if (relation.type !== 'tenant_memory_relation' || !relation.reason?.trim()) return '';
  const facts = await Promise.all(
    relation.factIds.map(async (ref) => (await get(ctx, p, ref)).payload)
  );
  if (!facts.every((fact) => active(fact))) return '';
  const own = facts.find((fact) => fact.person.actorId === actorId);
  const other = facts.find((fact) => fact.person.actorId !== actorId);
  if (!own || !other) return '';
  const shared = own.anchors
    .map(qualifiedAnchor)
    .find((anchor) =>
      other.anchorKeys.some((key) => JSON.parse(key)[0] === normalizeAnchor(anchor.value))
    );
  if (!shared) return '';
  const date = (fact) =>
    new Date(fact.at).toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  const label = humanFunctionLabel(other.person.functionLabel);
  const refs = (relation.evidence || []).map((hit) => hit.source).filter(Boolean);
  const reason =
    relation.reason
      .replace(/\s+Unsicherheit:\s*\d+ %\.$/u, '')
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => sentence.replace(/[.!?]+$/u, ''))
      .join('; ') +
    '.' +
    (refs.length ? ` Quelle: ${[...new Set(refs)].join('; ')}.` : '');
  return `Zu ${shared.value} gibt es etwas Neues: ${other.person.name}${label ? ` (${label})` : ''} hat am ${date(other)} festgehalten: „${other.text}“. Das hängt mit deiner Aussage vom ${date(own)} zusammen: ${reason}`;
}
module.exports = {
  namespace,
  key,
  normalizeAnchor,
  qualifiedAnchor,
  anchorKeys,
  anchorSyntax,
  referenceAnchors,
  groundedAnchors,
  weightedAnchors,
  frequencyCorpus,
  literalBasis,
  relationNotice,
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
