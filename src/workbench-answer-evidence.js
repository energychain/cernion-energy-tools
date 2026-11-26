'use strict';

const { normalizePhrase } = require('./function-resolver');
const { scrubPromptText } = require('./prompt-scrubber');

function words(text) {
  return normalizePhrase(text).match(/[\p{L}\p{N}]{4,}/gu) || [];
}

// Evidence budget per answer (AP4): more passages and longer windows than the former five
// passages of 500 characters, bounded in total; fallback listings pass a smaller window.
const MAX_PASSAGES = 10;
const TOTAL_CHARS = 12000;
// Material whose structure carries the meaning (a company method with stations, roles and
// artefacts; marked keepWhole by its producer) is passed whole up to this cap, outside the budget.
const WHOLE_CHARS = 11000;
const keptWhole = (hit) =>
  ['dataset.query', 'cases'].includes(hit.source) || hit.metadata?.keepWhole === true;

// Dataset and case results keep their own cap, material marked whole its cap; every other
// passage is the best-matching window.
function passageValue(hit, value, best, limit) {
  if (['dataset.query', 'cases'].includes(hit.source)) return value.slice(0, 12000);
  if (hit.metadata?.keepWhole === true) return value.slice(0, WHOLE_CHARS);
  return value.slice(best, best + limit);
}

// What a piece of evidence can back, by its source: general domain knowledge explains rules,
// terms and examples but never states a fact of this case (conversation pack: a real regulatory
// file taken for the case document, a statute obligation applied to the case, a dashboard status
// of another object cited for the subject). Classified by source, never by wording.
// knowledge-rag itself is tenant-scoped (it may hold the company's own documents): not general.
const GENERAL_SOURCES = new Set(['willi-mako', 'knowledge-rag-federated']);
const COMPANY_SOURCES = new Set(['knowledge-gateway', 'tenant-memory']);
const SYSTEM_SOURCES = new Set(['capability-read', 'micro-agent']);
const EVIDENCE_CLASSES = {
  general: 'Allgemeines Fachwissen',
  company: 'Unternehmenswissen',
  system: 'Systemabfrage',
};

function evidenceClass(hit) {
  const names = [hit?.metadata?.answerOnly, hit?.retrievalSource, hit?.source].filter(Boolean);
  if (names.some((name) => GENERAL_SOURCES.has(name))) return EVIDENCE_CLASSES.general;
  if (hit?.metadata?.pack === 'wissen' || names.some((name) => COMPANY_SOURCES.has(name)))
    return EVIDENCE_CLASSES.company;
  if (names.some((name) => SYSTEM_SOURCES.has(name))) return EVIDENCE_CLASSES.system;
  return '';
}

// A hit that can stand as the source of a rule: a listed knowledge source with a section or URL,
// or the company's own knowledge (its method and documents; pack wissen carries no section field).
// Without this, company-backed statements got the unsourced-assumption label (pack judges).
const CITED_SOURCES = new Set([
  'knowledge-rag',
  'knowledge-rag-federated',
  'knowledge-gateway',
  'willi-mako',
]);
function citableSource(hit) {
  if (evidenceClass(hit) === EVIDENCE_CLASSES.company) return true;
  return (
    CITED_SOURCES.has(hit?.retrievalSource || hit?.source) &&
    Boolean(hit?.metadata?.sectionId || hit?.metadata?.url)
  );
}

function prepareAnswerEvidence(evidence, situation, limit = 1500) {
  let remaining = TOTAL_CHARS;
  const wanted = new Set(words([situation.concern, ...(situation.retrievalTerms || [])].join(' ')));
  const documents = new Set(),
    texts = new Set();
  return evidence
    .map((hit, index) => {
      const value = String(hit.value || hit.summary || '');
      const tokens = words(value);
      const overlap = [...wanted].filter((word) => tokens.includes(word)).length;
      const metadata = hit.metadata || {};
      const score = Number(metadata.score ?? hit.score ?? 0);
      return { hit, value, overlap, score: Number.isFinite(score) ? score : 0, index };
    })
    .sort((a, b) => b.overlap - a.overlap || b.score - a.score || a.index - b.index)
    .filter(({ hit, value }) => {
      const metadata = hit.metadata || {};
      const document = metadata.sourceId || metadata.hitId || hit.url;
      const section = metadata.sectionId || '';
      const key = document ? `${hit.source}:${document}:${section}` : null;
      const text = normalizePhrase(value);
      if (!text || texts.has(text) || (key && documents.has(key))) return false;
      texts.add(text);
      if (key) documents.add(key);
      return true;
    })
    .slice(0, MAX_PASSAGES)
    .filter(({ hit }) => {
      // The budget bounds ordinary passages; dataset and case results keep their own cap.
      if (keptWhole(hit)) return true;
      if (remaining <= 0) return false;
      remaining -= limit;
      return true;
    })
    .map(({ hit, value }) => {
      let best = 0,
        bestScore = -1;
      for (let offset = 0; offset < value.length; offset += Math.max(1, Math.floor(limit / 3))) {
        const found = new Set(words(value.slice(offset, offset + limit)));
        const score = [...wanted].filter((word) => found.has(word)).length;
        if (score > bestScore) {
          best = offset;
          bestScore = score;
        }
      }
      return {
        evidenceId: hit.evidenceId,
        source: hit.source,
        title: readableSourceTitle(hit),
        ...(evidenceClass(hit) ? { basis: evidenceClass(hit) } : {}),
        // Material from another conversation or case (conversation scope) names its origin.
        ...(hit.metadata?.scopeOrigin ? { origin: hit.metadata.scopeOrigin } : {}),
        value: passageValue(hit, value, best, limit),
      };
    });
}

function copiesEvidence(text, evidence) {
  const candidate = normalizePhrase(text);
  if (candidate.length < 80) return false;
  return evidence.some((hit) => {
    const original = normalizePhrase(hit.value || '');
    if (original.includes(candidate)) return true;
    if (candidate.length < 121) return false;
    for (let index = 0; index <= candidate.length - 121; index++) {
      if (original.includes(candidate.slice(index, index + 121))) return true;
    }
    return false;
  });
}

function safeSituationText(value, limit = 120) {
  const text = scrubPromptText(String(value || ''))
    .replace(/\[?(?:[A-Z]+-MASKED|MASKED-[\w-]+)\]?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/bestätig|zustimm|ablehn/i.test(text)) return '';
  if (text.length <= limit) return text;
  const shortened = text.slice(0, limit - 1).trimEnd();
  const boundary = shortened.lastIndexOf(' ');
  return `${boundary > limit * 0.6 ? shortened.slice(0, boundary) : shortened}…`;
}

function situationReference(situation) {
  const { displayIdentifier, completeReference } = require('./workbench-identifiers');
  const facts = [situation.concern, situation.situation].filter(Boolean).join(' ');
  return (situation.identifiers || [])
    .filter(displayIdentifier)
    .filter((entry) => !facts.includes(entry.value) || completeReference(facts, entry.value))
    .filter((entry) => !/[\n\r]/u.test(entry.kind))
    .slice(0, 3)
    .map((entry) => {
      // Omit references that would be scrubbed or shortened, never list a fragment.
      const value = safeSituationText(entry.value, 256);
      return value === entry.value ? `${safeSituationText(entry.kind, 60)}: ${value}` : '';
    })
    .filter(Boolean)
    .join(', ');
}

function readableSourceTitle(hit) {
  const metadata = hit.metadata || {};
  const candidates = [
    metadata.documentTitle,
    metadata.sourceTitle,
    metadata.documentName,
    metadata.document?.title,
    metadata.source?.title,
    metadata.title,
    hit.documentTitle,
    hit.sourceTitle,
    hit.title,
  ];
  const clean = (value) =>
    scrubPromptText(String(value || ''))
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, '')
      .replace(/\[?(?:[A-Z]+-MASKED|MASKED-[\w-]+)\]?/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  for (const candidate of candidates) {
    // Technical references are not document titles, even with their extension removed.
    if (
      !candidate ||
      /^(?:okay|ok\b|hier\b|gerne\b|natürlich\b|klar\b|ich\b|dies(?:e|er|es)\b|das ist\b)/iu.test(
        String(candidate).trim()
      ) ||
      /^(?:[a-z]\)|\d+[.)]\s)|^[a-zäöü].*,/u.test(String(candidate)) ||
      // A Markdown heading at the start is passage text, not a document title (pack CROSS-002:
      // "Quellen: ### 9. … im Detail Die …-Nachricht dient …").
      /^#{1,6}\s/u.test(String(candidate).trim()) ||
      (candidate === hit.title &&
        !metadata.title &&
        !metadata.documentTitle &&
        String(hit.value || hit.summary || '').startsWith(String(candidate))) ||
      /^(?:[\w-]+\s+)?E[_-]?\d+(?:\.[a-z\d]{1,8})?$|^[0-9a-f-]{16,}(?:\.[a-z\d]{1,8})?$|[/\\]/iu.test(
        candidate
      ) ||
      (candidate !== metadata.documentName && /\.[a-z][a-z0-9]{0,7}(?:$|\s)/iu.test(candidate))
    )
      continue;
    const title = clean(candidate);
    if (
      title &&
      !/^[0-9a-f-]{16,}$/iu.test(title) &&
      ![
        hit.source,
        hit.retrievalSource,
        'Wissensquelle',
        ...require('./workbench-knowledge-sources.json').sources.map((source) => source.id),
      ]
        .filter(Boolean)
        .some((source) => title.toLocaleLowerCase() === String(source).toLocaleLowerCase())
    )
      return title.slice(0, 160);
  }
  return '';
}

// A lookup that found nothing (a working finding with negatives only) is no source of the answer.
const foundNothing = (hit) =>
  Boolean(hit?.metadata?.answerOnly) &&
  Array.isArray(hit.metadata.facts) &&
  hit.metadata.facts.length === 0;

function sourceLine(evidence) {
  const labels = [
    ...new Set(
      evidence
        .filter((hit) => hit.retrievalSource !== 'capability-read' && !foundNothing(hit))
        .map((hit) => {
          const title = readableSourceTitle(hit);
          if (!title) return '';
          const sectionId = hit.metadata?.sectionId || hit.sectionId;
          const section =
            hit.metadata?.sectionTitle ||
            hit.sectionTitle ||
            (/^(?:Abschnitt|Kapitel|Seite|Section|Chapter|Page)\s+\S/iu.test(sectionId || '')
              ? sectionId
              : '');
          const readableSection = readableSourceTitle({ title: section });
          return [title, readableSection].filter(Boolean).join(' · ');
        })
        .filter(Boolean)
    ),
  ];
  return labels.length ? `Quellen: ${labels.join('; ')}` : '';
}

module.exports = {
  EVIDENCE_CLASSES,
  evidenceClass,
  citableSource,
  prepareAnswerEvidence,
  copiesEvidence,
  safeSituationText,
  situationReference,
  sourceLine,
  readableSourceTitle,
};
