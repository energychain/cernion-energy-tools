'use strict';

const { normalizePhrase, tokens, createCompoundTokenizer } = require('./function-resolver');
const grammar = new Set(
  'wie hoch viel viele war ist der die das den dem ein eine einer einem und oder von aus zu zum zur im in am an für mit laut bitte welche welcher welches wann was wird wurde hat haben'.split(
    ' '
  )
);
const normalize = (value) =>
  normalizePhrase(String(value || '').replace(/[ßẞ]/gu, 'ss'))
    .replace(/ae/gu, 'a')
    .replace(/oe/gu, 'o')
    .replace(/ue/gu, 'u');
const stem = (word) => {
  const base = word.replace(/(?:ern|em|en|er|es|e|n|s)$/u, '');
  return base.length >= 4 ? base.replace(/lich$/u, '') || base : word;
};
const terms = (value) => [
  ...new Set(
    tokens(normalize(value), { includeGeneric: true })
      .filter((word) => word.length > 2 && !grammar.has(word) && !/^\d+$/u.test(word))
      .map(stem)
  ),
];
const phrase = (question, name) =>
  terms(name).length > 0 && ` ${normalize(question)} `.includes(` ${normalize(name)} `);
const corrected = (item, corrections) =>
  corrections.find(
    (correction) =>
      correction.kind === 'entity' && (item.sources || [item.nodeId]).includes(correction.nodeId)
  )?.name || item.name;

function thresholds(options) {
  const defaults = {
    minScore: 0.75,
    minMargin: 0.15,
    minSubjectCoverage: 1,
    minContentCoverage: 0.5,
  };
  return Object.fromEntries(
    Object.entries(defaults).map(([name, fallback]) => {
      const value = options[name] ?? fallback;
      if (!Number.isFinite(value) || value < 0 || value > 1)
        throw new Error(`Invalid project routing ${name}`);
      return [name, value];
    })
  );
}

function scoreCandidate(candidate, question, bounds) {
  const corrections = candidate.corrections || [];
  if (corrections.some((item) => item.kind === 'reject' && !item.questionTypeId))
    return { candidate, score: 0, reason: 'corrected', eligible: false };
  const types = candidate.manifest.questionTypes.filter(
    (type) => !corrections.some((item) => item.kind === 'reject' && item.questionTypeId === type.id)
  );
  const sources = candidate.routingSources || [];
  const metadata = Array.isArray(candidate.routingSources);
  const names = [
    candidate.title,
    ...candidate.manifest.entities.map((item) => corrected(item, corrections)),
    ...sources.flatMap((source) => [
      ...source.names.map((name) => name.replace(/\.[a-z0-9]+$/iu, '')),
      ...source.anchors.map((item) => corrected(item, corrections)),
    ]),
  ];
  const vocabulary = new Set(
    [
      ...names,
      ...types.map((type) => type.description),
      ...sources.flatMap((source) => source.columns.map((column) => column.name)),
    ].flatMap(terms)
  );
  const split = createCompoundTokenizer(vocabulary, { includeGeneric: true });
  const query = new Set(terms([...split(normalize(question))].join(' ')));
  const coverage = (words) =>
    words.length ? words.filter((word) => query.has(word)).length / words.length : 0;
  const subject = (name) => {
    const words = terms(name);
    const reference =
      /^(?:\d{6,}|[\p{L}\p{N}]+[-_:][\p{L}\p{N}_:-]+)$/u.test(String(name)) &&
      require('./workbench-codes').exactToken(String(question), String(name));
    const score = coverage(words);
    return reference || (words.length >= 2 && score >= bounds.minSubjectCoverage)
      ? {
          name,
          words,
          score: reference ? 1 : score,
          key: reference
            ? `id:${normalize(name)}`
            : [...words].sort((a, b) => a.localeCompare(b)).join(' '),
        }
      : null;
  };
  const subjects = names.map(subject).filter(Boolean);
  const subjectScore = subjects.length ? Math.max(...subjects.map((item) => item.score)) : 0;
  const subjectWords = new Set(subjects.flatMap((item) => item.words));
  const explicit = phrase(question, candidate.title);
  const lexical = types
    .map((type) => {
      const words = terms(type.description);
      const overlap = words.filter((word) => query.has(word));
      return {
        type,
        score: coverage(words),
        matched:
          overlap.length >= 2 &&
          overlap.some((word) => !subjectWords.has(word)) &&
          coverage(words) >= bounds.minContentCoverage,
      };
    })
    .filter((item) => item.matched)
    .sort((a, b) => b.score - a.score || a.type.id.localeCompare(b.type.id));
  const matchedSources = sources
    .map((source) => {
      const fields =
        source.kind === 'dataset' ? source.columns.map((column) => column.name) : source.names;
      const localNames = [
        candidate.title,
        ...source.names.map((name) => name.replace(/\.[a-z0-9]+$/iu, '')),
        ...source.anchors.map((item) => corrected(item, corrections)),
        ...candidate.manifest.entities
          .filter((item) =>
            item.sources.some((nodeId) => (source.nodeIds || [source.nodeId]).includes(nodeId))
          )
          .map((item) => corrected(item, corrections)),
      ];
      const subjectMatches = localNames.some((name) => subject(name));
      const contentScore = Math.max(
        0,
        ...(source.kind === 'section'
          ? lexical
              .filter((item) =>
                item.type.sources.some((nodeId) =>
                  (source.nodeIds || [source.nodeId]).includes(nodeId)
                )
              )
              .map((item) => item.score)
          : []),
        ...fields.map((field) =>
          coverage(
            terms(field).filter(
              (word) =>
                !subjectWords.has(word) &&
                !terms(Object.values(source.units).join(' ')).includes(word)
            )
          )
        )
      );
      return { source, contentScore, subjectMatches };
    })
    .filter(
      (item) =>
        (explicit || item.subjectMatches) &&
        item.contentScore >= bounds.minContentCoverage &&
        item.contentScore > 0
    )
    .sort((a, b) => b.contentScore - a.contentScore);
  const linked = types.filter((type) =>
    matchedSources.some((item) =>
      (item.source.nodeIds || [item.source.nodeId]).some((nodeId) => type.sources.includes(nodeId))
    )
  );
  const type = metadata
    ? lexical.find((item) => linked.includes(item.type))?.type || linked[0]
    : lexical[0]?.type;
  const questionType = type && {
    ...type,
    sources: [
      ...new Set([
        ...type.sources,
        ...matchedSources
          .filter((item) =>
            (item.source.nodeIds || [item.source.nodeId]).some((nodeId) =>
              type.sources.includes(nodeId)
            )
          )
          .map((item) => item.source.nodeId),
      ]),
    ],
  };
  const contentScore = matchedSources[0]?.contentScore || 0;
  const years = question.match(/\b20\d{2}\b/gu) || [];
  const periodMatch =
    years.length > 0 &&
    matchedSources.some(({ source }) =>
      years.every(
        (year) =>
          Number(year) >= Number(String(source.period?.from).slice(0, 4)) &&
          Number(year) <= Number(String(source.period?.to).slice(0, 4))
      )
    );
  const score = explicit
    ? 2
    : metadata
      ? 0.45 * subjectScore + 0.45 * contentScore + (periodMatch ? 0.1 : 0)
      : lexical[0]?.score || 0;
  const reason = !types.length
    ? candidate.manifest.questionTypes.length
      ? 'corrected'
      : 'no_question_type'
    : !explicit && !subjects.length
      ? 'no_subject'
      : !explicit && !questionType
        ? 'no_content'
        : !explicit && score < bounds.minScore
          ? 'below_threshold'
          : 'selected';
  return {
    candidate,
    score,
    subjectScore,
    subjectKeys: sources
      .flatMap((source) => [
        ...source.names.map((name) => name.replace(/\.[a-z0-9]+$/iu, '')),
        ...source.anchors.map((anchor) => corrected(anchor, corrections)),
      ])
      .map(subject)
      .filter(Boolean)
      .map((item) => item.key),
    contentScore,
    periodMatch,
    explicit,
    questionType: questionType || null,
    reason,
    eligible: reason === 'selected',
  };
}

// Descriptions and deterministic metadata are candidates, never answer evidence.
function selectProjectCandidates(candidates, question, options = {}) {
  const bounds = thresholds(options);
  const maxSources = options.maxSources ?? 8;
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 8)
    throw new Error('Invalid evidence routing maxSources');
  const ranked = candidates
    .map((candidate) => scoreCandidate(candidate, String(question || ''), bounds))
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        b.score - a.score ||
        a.candidate.projectId.localeCompare(b.candidate.projectId)
    );
  const best = ranked[0];
  // Complementary source records with the same matched subject form one candidate group.
  // Competing subjects still require the configured relevance margin.
  const complementary = (item) =>
    Boolean(
      best?.candidate.sourceType &&
      item.candidate.sourceType &&
      (best.candidate.sourceType !== 'project' || item.candidate.sourceType !== 'project') &&
      item.subjectKeys?.some((key) => best.subjectKeys?.includes(key))
    );
  const next = ranked.find(
    (item, index) =>
      index > 0 && !complementary(item) && ['selected', 'below_threshold'].includes(item.reason)
  );
  const margin = best ? best.score - (next?.score || 0) : 0;
  const reason = !best
    ? 'no_candidates'
    : best.eligible && next && margin < bounds.minMargin
      ? 'ambiguous'
      : best.reason;
  options.onAssessment?.({
    candidateCount: candidates.length,
    bestProjectId: best?.candidate.projectId || null,
    score: Number((best?.score || 0).toFixed(4)),
    margin: Number(margin.toFixed(4)),
    subjectScore: best?.subjectScore || 0,
    contentScore: best?.contentScore || 0,
    periodMatch: best?.periodMatch || false,
    reason,
    thresholds: bounds,
    ...(best?.candidate.generation ? { generation: best.candidate.generation } : {}),
  });
  return reason === 'selected'
    ? ranked
        .filter((item, index) => item.eligible && (index === 0 || complementary(item)))
        .slice(0, maxSources)
        .map((item) => ({
          ...item.candidate,
          explicit: item.explicit,
          questionType: item.questionType,
          score: item.score,
        }))
    : [];
}

module.exports = { selectProjectCandidates };
