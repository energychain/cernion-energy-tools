'use strict';

/**
 * Expanders of the pack "wissen" (Unternehmenswissen, micro-agent tier, Phase 1).
 *
 * Read sources (each checked in operation-capability-index.json and in its handler):
 * - `vdmi.list` (`data_read`, `writesTo: []`, `sideEffects: []`): the tenant's responsibility
 *   matrices; a PouchDB prefix read filtered to `ctx.meta.tenantId`.
 * - `governance-cards.listCards` (`data_read`, `writesTo: []`, `sideEffects: []`): the tenant's
 *   governance items; a PouchDB find on `{ type, tenantId }` of the authenticated principal.
 * - `personal-agent.collectWorkbenchEvidence` restricted to the source `knowledge-rag`: the
 *   lookup the knowledge loop and the turn prefetch already use. It applies the tenant's source
 *   access and the relevance filter; `knowledge-rag.query` runs as an internal call
 *   (`$gateway: false`), so no job record is written, and searches the tenant's index namespace.
 *
 * - `knowledge-gateway.searchReadOnly`: the released company knowledge bases with the gateway's
 *   access checks, without the citation records the public `search` stores.
 *
 * Not used, because they write: `tenant-memory-policy.list`/`glossary` write an audit entry
 * per call and are restricted to tenant administrators. `company` is a registry of market partner
 * groupings without a tenant field, so it is no source of the tenant's own knowledge.
 *
 * Tenant boundary: an expander reads only when the authenticated tenant (`ctx.meta.tenantId`) is
 * set and matches the turn's tenant, and keeps only records that carry that tenant.
 * Facts carry the source action as provenance; a quote is always a literal passage of the record
 * or document the source returned. No model is used: matching is a normalized literal comparison.
 */

const PACK = 'wissen';
const MATRICES = 'vdmi.list';
const CARDS = 'governance-cards.listCards';
const KNOWLEDGE = 'personal-agent.collectWorkbenchEvidence';
const KNOWLEDGE_SOURCE = 'knowledge-rag';
// Released company knowledge bases, read without citation records (Knowledge Gateway).
const GATEWAY = 'knowledge-gateway.searchReadOnly';
const GATEWAY_TOP_K = 4;
// Passages of the company's knowledge reach the answer in their wording: a gateway hit as its
// whole section (a process card with stations, roles and artefacts is read as one), other hits
// as their passage.
const SECTION_FACTS = 3;
const PASSAGE_MAX = 6000;
const HIT_PASSAGE_MAX = 1500;
// The second query asks for the company's way of working on such a case, so a general method
// (role projection, evidence and approval rules) is found next to the case-specific card.
const METHOD_QUERY = (concern) =>
  `Wie arbeiten wir bei einem solchen Fall: Vorgehen, Stationen, Rollen und Zuständigkeiten, Nachweise und Freigabegrenzen. Fall: ${concern}`;

const CALL_TIMEOUT_MS = 2500;
const DEFAULT_BUDGET_MS = 4000;
const BUDGET_RESERVE_MS = 300;
const MATRIX_LIMIT = 200;
const CARD_LIMIT = 100;
const TASK_FACTS = 8;
const CARD_FACTS = 5;
const DOCUMENT_FACTS = 4;
const CONCERN_FACTS = 3;
const QUOTE_MAX = 300;
const QUOTE_BEFORE = 100;
const MIN_PHRASE = 3;
// Regex fragments for literalPassage: a letter or digit, and a run of anything else.
const LETTER_OR_DIGIT = String.raw`[\p{L}\p{N}]`;
const NON_LETTER_RUN = String.raw`[^\p{L}\p{N}]+`;

const RACI_FIELDS = ['verantwortlich', 'durchfuehrend', 'mitwirkend', 'information'];
const RACI_LABELS = {
  verantwortlich: 'verantwortlich',
  durchfuehrend: 'durchführend',
  mitwirkend: 'mitwirkend',
  information: 'zu informieren',
};
const CLOSED_CARD_STATUSES = new Set(['closed', 'completed']);

const SCOPE = {
  matrices: 'Verantwortungsmatrizen (VDMI) des Mandanten, Aufgaben mit ihren Rollen',
  matrixEvidence: 'Verantwortungsmatrizen (VDMI) des Mandanten, geforderte Nachweise der Aufgaben',
  cardsOwner: 'Governance-Vorgänge des Mandanten, Feld zuständige Rolle',
  cardsEvidence: 'Governance-Vorgänge des Mandanten, Titel und hinterlegte Nachweise',
  knowledge:
    'Wissensbasis (knowledge-rag) des Mandanten über die Wissensschleife, beste relevante Treffer',
};

const text = (value) => String(value ?? '');
const clip = (value, max = QUOTE_MAX) => text(value).slice(0, max);

// ── Literal matching (format normalization only, no word lists) ──────────────────────────────
// Letters and digits in lower case, every other character a single space: "DSO_GATEKEEPER",
// "DSO-Gatekeeper" and "dso gatekeeper" compare equal. Role ids may carry the fixed prefix ROLE_.
function normalize(value) {
  return text(value)
    .toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeRole(value) {
  const normalized = normalize(value);
  return normalized.startsWith('role ') ? normalized.slice(5) : normalized;
}

// One phrase contains the other as whole words.
function phraseMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_PHRASE && ` ${longer} `.includes(` ${shorter} `);
}

function actorId(actor) {
  if (typeof actor === 'string') return actor.trim();
  if (actor && typeof actor === 'object') return text(actor.actorId || actor.actorRef).trim();
  return '';
}

// A verbatim passage of `source` around the first occurrence of `phrase` (case-insensitive), or
// null when the phrase does not occur. The words are letters and digits only, so the pattern
// built from them needs no escaping.
function literalPassage(source, phrase) {
  const raw = text(source);
  const words = normalize(phrase).split(' ').filter(Boolean);
  if (!words.length) return null;
  // The words of the phrase in order, separated only by non-letters ("Test Gatekeeper" finds
  // "TEST_GATEKEEPER"); the passage itself is cut from the source text unchanged.
  const match = new RegExp(
    `(?<!${LETTER_OR_DIGIT})${words.join(NON_LETTER_RUN)}(?!${LETTER_OR_DIGIT})`,
    'iu'
  ).exec(raw);
  if (!match) return null;
  const start = Math.max(0, match.index - QUOTE_BEFORE);
  return raw.slice(start, start + QUOTE_MAX).trim();
}

// ── Bounded, read-only calls ─────────────────────────────────────────────────────────────────
function callTimeout(ctx) {
  const budget = Number(ctx?.params?.budget?.timeoutMs) || DEFAULT_BUDGET_MS;
  return Math.max(50, Math.min(CALL_TIMEOUT_MS, budget - BUDGET_RESERVE_MS));
}

// Moleculer merges a sub-call's meta back into the calling context; a call goes through a
// shadow context, so the source selection set here never reaches the turn's context.
async function read(ctx, action, params, options = {}) {
  const shadow = Object.create(ctx);
  shadow.meta = { ...ctx.meta };
  try {
    return {
      ok: true,
      value: await shadow.call(action, params, { timeout: callTimeout(ctx), ...options }),
    };
  } catch (error) {
    return { ok: false, error: error?.type || error?.name || 'error' };
  }
}

// The authenticated tenant, only when it matches the turn's tenant.
function tenantOf(ctx, context = {}) {
  const tenant = text(ctx?.meta?.tenantId).trim();
  if (!tenant) return null;
  if (context.tenantId && context.tenantId !== tenant) return null;
  return tenant;
}

// Confidence tiers: a direct match, other facts only, nothing found.
function tieredConfidence(direct, anyFacts) {
  if (direct) return 0.8;
  if (anyFacts) return 0.6;
  return 0.2;
}

function noTenant() {
  return {
    openQuestions: [
      {
        question:
          'Der Mandant der Anfrage ist nicht eindeutig; Unternehmenswissen wurde nicht gelesen.',
        resolves: 'authentifizierter Mandant der Unterhaltung',
      },
    ],
    confidence: 0,
  };
}

// A source that could not be read is reported with its scope, never as "nothing found".
function negative(searched, scope, result) {
  return { searched: clip(searched), scope, result: result.ok ? 'no_hit' : 'unavailable' };
}

async function readMatrices(ctx, tenant) {
  const result = await read(ctx, MATRICES, { limit: MATRIX_LIMIT });
  const items = result.ok && Array.isArray(result.value?.items) ? result.value.items : [];
  return { ...result, items: items.filter((matrix) => matrix?.tenantId === tenant) };
}

async function readCards(ctx, tenant) {
  const result = await read(ctx, CARDS, { limit: CARD_LIMIT });
  const items = result.ok && Array.isArray(result.value?.items) ? result.value.items : [];
  return { ...result, items: items.filter((card) => card?.tenantId === tenant) };
}

// The knowledge loop's own lookup, restricted to knowledge-rag. A prefetched result of the turn
// is not reused, since it answers another query.
async function readKnowledge(ctx, query) {
  const concern = clip(query, 600);
  const [result, gateway] = await Promise.all([
    read(
      ctx,
      KNOWLEDGE,
      { situation: { concern, situation: '', hypotheses: [], retrievalTerms: [concern] } },
      {
        meta: {
          workbenchEvidenceSources: [KNOWLEDGE_SOURCE],
          workbenchPrefetchedKnowledge: null,
          workbenchToolsManaged: true,
        },
      }
    ),
    readGateways(ctx, concern),
  ]);
  if (!result.ok) return { ...result, hits: gateway, ok: gateway.length > 0 };
  const status = (result.value?.trace || []).find((entry) => entry?.source === KNOWLEDGE_SOURCE);
  const hits = (result.value?.evidence || []).filter(
    (hit) => hit && (hit.retrievalSource || KNOWLEDGE_SOURCE) === KNOWLEDGE_SOURCE
  );
  // Skipped (source not released for the tenant), timed out or unavailable: not searched.
  const searched = !status || ['available', 'missing'].includes(status.status);
  return {
    ok: searched || gateway.length > 0,
    hits: [...gateway, ...(searched ? hits : [])],
    error: searched ? null : status.status,
  };
}

// The company's released knowledge bases: the gateway checks access before and after retrieval.
// The concern and the way of working on it, each section once.
async function readGateways(ctx, concern) {
  const lists = await Promise.all([
    readGateway(ctx, concern),
    readGateway(ctx, METHOD_QUERY(concern)),
  ]);
  // Interleaved, so the best hit of the method query is not crowded out by the concern's.
  const interleaved = [];
  for (let index = 0; index < GATEWAY_TOP_K; index++)
    for (const list of lists) if (list[index]) interleaved.push(list[index]);
  const seen = new Set();
  return interleaved.filter((hit) => {
    const key = `${hit.metadata.hitId}\u0000${hit.metadata.sectionTitle || hit.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readGateway(ctx, query) {
  const result = await read(ctx, GATEWAY, {
    question: query,
    topK: GATEWAY_TOP_K,
    wholeSections: true,
  });
  if (!result.ok) return [];
  return (result.value?.results || []).map((item) => ({
    section: Boolean(item.location?.section),
    source: text(item.title || 'Wissensbasis'),
    value: text(item.content),
    provenanceSource: GATEWAY,
    metadata: {
      documentTitle: text(item.title),
      sectionTitle: text(item.location?.section),
      hitId: text(item.documentId),
    },
  }));
}

// The collector appends "· Dokumenttyp: …" and "· Score: …" to the passage; the passage is the
// document text as the source returned it.
function hitText(hit) {
  let value = text(hit?.value);
  for (const marker of [' · Score: ', ' · Dokumenttyp: ']) {
    const index = value.lastIndexOf(marker);
    if (index >= 0) value = value.slice(0, index);
  }
  return value.trim();
}

function hitTitle(hit) {
  return text(
    hit?.metadata?.documentTitle || hit?.metadata?.sectionTitle || hit?.source || 'Wissensbasis'
  ).slice(0, 160);
}

function hitRef(hit) {
  return [hit?.metadata?.hitId || hit?.metadata?.documentTitle, hit?.metadata?.sectionTitle]
    .filter(Boolean)
    .join(' / ')
    .slice(0, 200);
}

function knowledgeFact(hit, statement, quote, role = 'explanation', passage = '') {
  return {
    statement,
    value: hitTitle(hit),
    role,
    basis: 'source',
    provenance: {
      source: hit.provenanceSource || `${KNOWLEDGE}:${KNOWLEDGE_SOURCE}`,
      ref: hitRef(hit),
      quote: clip(quote),
    },
    ...(passage ? { passage } : {}),
  };
}

// ── Records of the responsibility matrices and governance items ──────────────────────────────
// The first RACI field of `task` naming the wanted role, with the matching actor, or null.
function raciMatch(task, wanted) {
  for (const field of RACI_FIELDS) {
    const actor = (Array.isArray(task[field]) ? task[field] : [])
      .map(actorId)
      .find((id) => phraseMatch(normalizeRole(id), wanted));
    if (actor) return { field, actor };
  }
  return null;
}

function roleTasks(matrices, mention) {
  const wanted = normalizeRole(mention);
  const rows = [];
  for (const matrix of matrices) {
    for (const task of Array.isArray(matrix.tasks) ? matrix.tasks : []) {
      const match = raciMatch(task, wanted);
      if (match) rows.push({ matrix, task, ...match });
    }
  }
  return rows;
}

function documentRequirements(task) {
  return (Array.isArray(task.evidenceRequirements) ? task.evidenceRequirements : []).filter(
    (requirement) => requirement?.label && text(requirement.type || 'document') === 'document'
  );
}

function tasksRequiring(matrices, mention) {
  const wanted = normalize(mention);
  const rows = [];
  for (const matrix of matrices) {
    for (const task of Array.isArray(matrix.tasks) ? matrix.tasks : []) {
      const requirement = (
        Array.isArray(task.evidenceRequirements) ? task.evidenceRequirements : []
      ).find((entry) => phraseMatch(normalize(entry?.label), wanted));
      if (requirement) rows.push({ matrix, task, requirement });
    }
  }
  return rows;
}

function taskName(task) {
  return text(task.taskName || task.taskId || 'Aufgabe').slice(0, 160);
}

function taskRef(matrix, task) {
  return `${text(matrix.id)}:${text(task.taskId)}`.slice(0, 200);
}

function cardDeadlineFacts(card, objectId) {
  if (!card.deadline) return { facts: [], expectations: [] };
  const factId = `${PACK}-${objectId}-card-${text(card.cardId).slice(0, 40)}-deadline`;
  return {
    facts: [
      {
        factId,
        statement: `Frist des Governance-Vorgangs „${clip(card.title, 160)}“: ${card.deadline}.`,
        value: text(card.deadline),
        role: 'deadline',
        basis: 'source',
        provenance: { source: CARDS, ref: text(card.cardId), quote: `deadline: ${card.deadline}` },
      },
    ],
    expectations: [
      {
        what: `Bearbeitung des Governance-Vorgangs „${clip(card.title, 160)}“ durch ${text(card.ownerRole) || 'die zuständige Rolle'}`,
        dueFactId: factId,
        basis: 'source',
      },
    ],
  };
}

function cardFact(card, statement) {
  return {
    statement,
    value: clip(card.title, 160),
    role: 'status',
    basis: 'source',
    provenance: {
      source: CARDS,
      ref: text(card.cardId),
      quote: clip(
        [
          `title: ${text(card.title)}`,
          `ownerRole: ${text(card.ownerRole)}`,
          `status: ${text(card.status)}`,
        ].join('; ')
      ),
    },
  };
}

function evidenceRefMatches(card, mention) {
  const wanted = normalize(mention);
  return (Array.isArray(card.evidenceRefs) ? card.evidenceRefs : []).find(
    (ref) =>
      phraseMatch(normalize(ref?.label), wanted) || phraseMatch(normalize(ref?.evidenceId), wanted)
  );
}

// ── Expanders ────────────────────────────────────────────────────────────────────────────────
// A role, function, department or board: where the tenant's matrices name it, which governance
// items it owns, and which released documents name it literally.
async function expandRole(ctx, object, context = {}) {
  const tenant = tenantOf(ctx, context);
  if (!tenant) return noTenant();
  const mention = object.value;
  const [matrices, cards, knowledge] = await Promise.all([
    readMatrices(ctx, tenant),
    readCards(ctx, tenant),
    readKnowledge(ctx, mention),
  ]);
  const facts = [];
  const relations = [];
  const expectations = [];
  const negatives = [];

  const tasks = roleTasks(matrices.items, mention).slice(0, TASK_FACTS);
  for (const { matrix, task, field, actor } of tasks) {
    facts.push({
      statement: `${actor} ist in der Verantwortungsmatrix „${clip(matrix.name || matrix.id, 120)}“ bei der Aufgabe „${taskName(task)}“ ${RACI_LABELS[field]}.`,
      value: taskName(task),
      role: 'classification',
      basis: 'source',
      provenance: { source: MATRICES, ref: taskRef(matrix, task), quote: `${field}: ${actor}` },
    });
    for (const requirement of documentRequirements(task)) {
      relations.push({ from: mention, rel: 'expects', to: clip(requirement.label, 160) });
    }
  }
  if (!tasks.length) negatives.push(negative(mention, SCOPE.matrices, matrices));

  const owned = cards.items
    .filter((card) => !CLOSED_CARD_STATUSES.has(card.status))
    .filter((card) => phraseMatch(normalizeRole(card.ownerRole), normalizeRole(mention)))
    .slice(0, CARD_FACTS);
  for (const card of owned) {
    facts.push(
      cardFact(
        card,
        `Offener Governance-Vorgang „${clip(card.title, 160)}“ liegt bei ${card.ownerRole} (Status ${text(card.status) || 'unbekannt'}).`
      )
    );
    const deadline = cardDeadlineFacts(card, object.objectId);
    facts.push(...deadline.facts);
    expectations.push(...deadline.expectations);
  }
  if (!owned.length) negatives.push(negative(mention, SCOPE.cardsOwner, cards));

  const naming = knowledge.hits
    .map((hit) => ({ hit, quote: literalPassage(hitText(hit), mention) }))
    .filter((row) => row.quote)
    .slice(0, DOCUMENT_FACTS);
  for (const { hit, quote } of naming) {
    facts.push(knowledgeFact(hit, `Die Unterlage „${hitTitle(hit)}“ nennt ${mention}.`, quote));
    relations.push({ from: mention, rel: 'refers_to', to: hitTitle(hit) });
  }
  if (!naming.length) negatives.push(negative(mention, SCOPE.knowledge, knowledge));

  return {
    facts,
    relations,
    expectations,
    negatives,
    openQuestions: facts.length
      ? []
      : [
          {
            question: `Unter welcher Bezeichnung führt das Unternehmen „${clip(mention, 120)}“?`,
            resolves: 'Zuordnung der Rolle zu Verantwortungsmatrix und Governance-Vorgängen',
          },
        ],
    confidence: tieredConfidence(tasks.length > 0, facts.length > 0),
  };
}

// An internal document, policy, minutes or resolution: whether released knowledge contains it,
// which governance items cite it as evidence, and which tasks require it (and who owns them).
async function expandDocument(ctx, object, context = {}) {
  const tenant = tenantOf(ctx, context);
  if (!tenant) return noTenant();
  const mention = object.value;
  const [matrices, cards, knowledge] = await Promise.all([
    readMatrices(ctx, tenant),
    readCards(ctx, tenant),
    readKnowledge(ctx, mention),
  ]);
  const finding = { facts: [], relations: [], expectations: [], negatives: [], openQuestions: [] };
  const wanted = normalize(mention);

  const found = documentKnowledgeHits(knowledge, mention, wanted);
  mergeDocumentPart(finding, documentKnowledgePart(found, mention, knowledge));
  mergeDocumentPart(finding, documentCardsPart(cards, mention, wanted, object.objectId));
  mergeDocumentPart(finding, documentTasksPart(matrices, mention));

  // The released knowledge bases of the Knowledge Gateway have no read-only search (a search
  // stores citations), so they are named as not searched instead of reported as "not found".
  if (!found.length)
    finding.openQuestions.push({
      question: `Liegt „${clip(mention, 120)}“ in einer freigegebenen Wissensbasis des Knowledge Gateway?`,
      resolves: 'Die freigegebenen Wissensbasen wurden nicht durchsucht (kein lesender Suchweg).',
    });

  return {
    ...finding,
    confidence: tieredConfidence(
      found.some((row) => row.titled),
      finding.facts.length > 0
    ),
  };
}

function mergeDocumentPart(target, part) {
  for (const key of ['facts', 'relations', 'expectations', 'negatives'])
    target[key].push(...(part[key] || []));
}

// Knowledge hits that contain the document: by title or by a literal passage.
function documentKnowledgeHits(knowledge, mention, wanted) {
  return knowledge.hits
    .map((hit) => {
      const titled = phraseMatch(normalize(hitTitle(hit)), wanted);
      const quote = literalPassage(hitText(hit), mention) || (titled ? clip(hitText(hit)) : null);
      return { hit, titled, quote };
    })
    .filter((row) => row.quote)
    .slice(0, DOCUMENT_FACTS);
}

function documentKnowledgePart(found, mention, knowledge) {
  const facts = found.map(({ hit, titled, quote }) =>
    knowledgeFact(
      hit,
      titled
        ? `Die Unterlage „${hitTitle(hit)}“ liegt in der Wissensbasis vor.`
        : `Die Unterlage „${hitTitle(hit)}“ erwähnt „${clip(mention, 120)}“.`,
      quote,
      titled ? 'reference' : 'explanation'
    )
  );
  const negatives = found.length ? [] : [negative(mention, SCOPE.knowledge, knowledge)];
  return { facts, negatives };
}

function citingCardStatement(card, citedAsEvidence) {
  const title = clip(card.title, 160);
  const status = text(card.status) || 'unbekannt';
  return citedAsEvidence
    ? `Die Unterlage ist als Nachweis im Governance-Vorgang „${title}“ hinterlegt (Status ${status}).`
    : `Governance-Vorgang „${title}“ (Status ${status}).`;
}

// One governance item citing the document: its facts, relations and open deadline.
function citingCardPart(card, ref, mention, objectId) {
  const facts = [cardFact(card, citingCardStatement(card, ref))];
  const relations = [];
  const expectations = [];
  if (card.closureRationale)
    facts.push({
      statement: `Abschlussbegründung des Governance-Vorgangs „${clip(card.title, 160)}“.`,
      value: clip(card.closureRationale),
      role: 'explanation',
      basis: 'source',
      provenance: { source: CARDS, ref: text(card.cardId), quote: clip(card.closureRationale) },
    });
  relations.push({ from: mention, rel: 'refers_to', to: clip(card.title, 160) });
  if (card.ownerRole)
    relations.push({ from: mention, rel: 'belongs_to', to: text(card.ownerRole) });
  if (!CLOSED_CARD_STATUSES.has(card.status)) {
    const deadline = cardDeadlineFacts(card, objectId);
    facts.push(...deadline.facts);
    expectations.push(...deadline.expectations);
  }
  return { facts, relations, expectations };
}

function documentCardsPart(cards, mention, wanted, objectId) {
  const citing = cards.items
    .map((card) => ({ card, ref: evidenceRefMatches(card, mention) }))
    .filter(({ card, ref }) => ref || phraseMatch(normalize(card.title), wanted))
    .slice(0, CARD_FACTS);
  const part = { facts: [], relations: [], expectations: [], negatives: [] };
  for (const { card, ref } of citing)
    mergeDocumentPart(part, citingCardPart(card, ref, mention, objectId));
  if (!citing.length) part.negatives.push(negative(mention, SCOPE.cardsEvidence, cards));
  return part;
}

function requiredTaskFact(matrix, task, requirement, owners) {
  const ownerNote = owners.length ? `; verantwortlich: ${owners.join(', ')}` : '';
  return {
    statement: `Die Aufgabe „${taskName(task)}“ der Verantwortungsmatrix „${clip(matrix.name || matrix.id, 120)}“ verlangt „${clip(requirement.label, 160)}“ als Nachweis${ownerNote}.`,
    value: clip(requirement.label, 160),
    role: 'reference',
    basis: 'source',
    provenance: {
      source: MATRICES,
      ref: taskRef(matrix, task),
      quote: clip(`evidenceRequirements: ${text(requirement.label)}`),
    },
  };
}

function documentTasksPart(matrices, mention) {
  const required = tasksRequiring(matrices.items, mention).slice(0, TASK_FACTS);
  const facts = [];
  const relations = [];
  for (const { matrix, task, requirement } of required) {
    const owners = (Array.isArray(task.verantwortlich) ? task.verantwortlich : [])
      .map(actorId)
      .filter(Boolean);
    facts.push(requiredTaskFact(matrix, task, requirement, owners));
    for (const owner of owners) relations.push({ from: mention, rel: 'belongs_to', to: owner });
  }
  const negatives = required.length ? [] : [negative(mention, SCOPE.matrixEvidence, matrices)];
  return { facts, relations, negatives };
}

// The question itself: the best relevant passages of the tenant's released knowledge. During the
// consequence check (`context.consequenceOf`), the reason of the other area joins the query.
async function expandConcern(ctx, object, context = {}) {
  const tenant = tenantOf(ctx, context);
  if (!tenant) return noTenant();
  const consequence = text(context.consequenceOf).trim();
  const query = [object.value, consequence].filter(Boolean).join(' ');
  const knowledge = await readKnowledge(ctx, query);
  const sections = knowledge.hits.filter((hit) => hit.section).slice(0, SECTION_FACTS);
  const passages = knowledge.hits.filter((hit) => !hit.section).slice(0, CONCERN_FACTS);
  const facts = [...sections, ...passages]
    .map((hit) => ({ hit, passage: hitText(hit) }))
    .filter((row) => row.passage)
    .map(({ hit, passage }) => {
      const where = hit.section
        ? `Abschnitt „${hit.metadata.sectionTitle}“ aus „${hitTitle(hit)}“`
        : `„${hitTitle(hit)}“`;
      return knowledgeFact(
        hit,
        consequence
          ? `Unternehmenswissen zur Folge aus einem anderen Bereich: ${where}.`
          : `Unternehmenswissen zur Frage: ${where}.`,
        clip(passage),
        'explanation',
        passage.slice(0, hit.section ? PASSAGE_MAX : HIT_PASSAGE_MAX)
      );
    });
  return {
    facts,
    relations: facts.map((fact) => ({ from: 'concern', rel: 'answers', to: fact.value })),
    negatives: facts.length
      ? []
      : [
          negative(
            query,
            consequence
              ? `${SCOPE.knowledge}; Folgenprüfung: ${clip(consequence, 120)}`
              : SCOPE.knowledge,
            knowledge
          ),
        ],
    confidence: facts.length ? 0.5 : 0.1,
  };
}

// ── Playbooks: fixed dependencies of the area ────────────────────────────────────────────────
// A task of the matrix requires a document → that document. A document is evidence of a task or
// governance item owned by a role → that role.
const relationTargets = (finding, rel) => [
  ...new Set(
    (finding?.relations || []).filter((row) => row.rel === rel && row.to).map((row) => row.to)
  ),
];

const playbooks = [
  {
    from: 'org.role',
    next: (finding) =>
      relationTargets(finding, 'expects')
        .slice(0, 2)
        .map((label) => ({ kind: 'org.document', value: label, label })),
  },
  {
    from: 'org.document',
    next: (finding) =>
      relationTargets(finding, 'belongs_to')
        .slice(0, 2)
        .map((role) => ({ kind: 'org.role', value: role, label: role })),
  },
];

module.exports = {
  expanders: {
    'org.role': expandRole,
    'org.document': expandDocument,
    concern: expandConcern,
  },
  playbooks,
  // Exposed for tests.
  internals: { normalize, normalizeRole, phraseMatch, literalPassage, hitText },
};
