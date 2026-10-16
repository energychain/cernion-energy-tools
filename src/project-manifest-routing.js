'use strict';

const { normalizePhrase, tokens } = require('./function-resolver');
const grammar = new Set(
  'wie hoch viel viele war ist der die das den dem ein eine einer einem und oder von aus zu zum zur im in am an für mit laut bitte welche welcher welches wann was wird wurde hat haben'.split(
    ' '
  )
);
const terms = (value) => [
  ...new Set(
    tokens(value).filter((word) => word.length > 2 && !grammar.has(word) && !/^\d+$/.test(word))
  ),
];
const phrase = (question, name) =>
  terms(name).length > 0 && ` ${normalizePhrase(question)} `.includes(` ${normalizePhrase(name)} `);

// Stored metadata only. Subject AND question-type agreement are required; years/units alone cannot select.
function selectProjectCandidates(candidates, question) {
  const query = new Set(terms(question));
  const ranked = candidates
    .flatMap((candidate) => {
      const corrections = candidate.corrections || [];
      if (corrections.some((item) => item.kind === 'reject' && !item.questionTypeId)) return [];
      const explicit = phrase(question, candidate.title);
      const names = [
        candidate.title,
        ...candidate.manifest.entities.map(
          (item) =>
            corrections.find(
              (correction) =>
                correction.kind === 'entity' && item.sources.includes(correction.nodeId)
            )?.name || item.name
        ),
      ];
      const subject = names.filter((name) => terms(name).length >= 2 && phrase(question, name));
      const types = candidate.manifest.questionTypes.filter(
        (type) =>
          !corrections.some((item) => item.kind === 'reject' && item.questionTypeId === type.id)
      );
      const matches = types
        .map((type) => {
          const words = terms(type.description);
          const overlap = words.filter((word) => query.has(word));
          const subjectWords = new Set(subject.flatMap(terms));
          const distinct = overlap.some((word) => !subjectWords.has(word));
          const score = words.length ? overlap.length / words.length : 0;
          return { type, score, matched: overlap.length >= 2 && distinct && score >= 0.5 };
        })
        .filter((item) => item.matched)
        .sort((a, b) => b.score - a.score || a.type.id.localeCompare(b.type.id));
      if (!explicit && (!subject.length || !matches.length)) return [];
      return [
        {
          ...candidate,
          explicit,
          questionType: matches[0]?.type || null,
          score: explicit ? 2 : matches[0].score,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.projectId.localeCompare(b.projectId));
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.15) return [];
  return ranked.slice(0, 1);
}

module.exports = { selectProjectCandidates };
