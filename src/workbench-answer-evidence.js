'use strict';

const { normalizePhrase } = require('./function-resolver');
const { scrubPromptText, isSensitiveField } = require('./prompt-scrubber');

function words(text) {
  return normalizePhrase(text).match(/[\p{L}\p{N}]{4,}/gu) || [];
}

function prepareAnswerEvidence(evidence, situation, limit = 500) {
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
    .slice(0, 5)
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
        title: hit.title || hit.metadata?.title || hit.metadata?.sourceId || hit.metadata?.hitId,
        value: value.slice(best, best + limit),
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
  return (situation.identifiers || [])
    .filter((entry) => !isSensitiveField(entry.kind) && !/@|\n/.test(entry.value || ''))
    .slice(0, 3)
    .map((entry) => safeSituationText(entry.value, 60))
    .filter(Boolean)
    .join(', ');
}

function sourceLine(evidence) {
  const labels = [
    ...new Set(
      evidence
        .map((hit) => {
          const title = hit.title || hit.metadata?.title;
          const section = hit.metadata?.sectionId || hit.sectionId;
          const label = [title || hit.source, section]
            .filter(Boolean)
            .join(' · ')
            .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '');
          return scrubPromptText(label)
            .replace(/\[?(?:[A-Z]+-MASKED|MASKED-[\w-]+)\]?/g, '')
            .slice(0, 160)
            .trim();
        })
        .filter(Boolean)
    ),
  ];
  return labels.length ? `Quellen: ${labels.join('; ')}` : '';
}

module.exports = {
  prepareAnswerEvidence,
  copiesEvidence,
  safeSituationText,
  situationReference,
  sourceLine,
};
