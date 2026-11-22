'use strict';

/**
 * Responsibility without an up-front domain choice (micro-agent tier, Phase 0). A colleague does
 * not first ask which department a question belongs to: the packs that answer follow from what
 * the person mentions (recognized objects) and from the concern, scored against the function
 * model (lexical and embedding similarity, graded, no keyword gate). Neighbours of the matched
 * functions in the function graph name the packs a consequence check should ask.
 */

const { getNeighbors } = require('../function-model');
const { CONCERN_KIND } = require('./contract');

const DEFAULTS = {
  maxPacks: 3,
  maxConsequences: 3,
  threshold: 0.3,
  functionWeight: 0.6,
  objectBonus: 0.4,
  relativeShare: 0.8,
  areaWeight: 0.7,
  consequenceRelevance: 0.4,
  functionWeightWithArea: 0.2,
};

function bestScore(pack, scores) {
  let best = { score: 0, functionId: '' };
  for (const functionId of pack.functionIds || []) {
    const score = scores.get(functionId) || 0;
    if (score > best.score) best = { score, functionId };
  }
  return best;
}

// The object bonus follows the recognition's confidence: a format match counts fully, a
// semantic mention of the model only in part.
function kindConfidenceOf(objects) {
  const kindConfidence = new Map();
  for (const object of objects) {
    if (object.kind === CONCERN_KIND) continue;
    const confidence = Number(object.confidence ?? 1);
    kindConfidence.set(object.kind, Math.max(kindConfidence.get(object.kind) || 0, confidence));
  }
  return kindConfidence;
}

function ratePack(pack, { scores, kindConfidence, areaRelevance, settings }) {
  const best = bestScore(pack, scores);
  const objectConfidence = Math.max(
    0,
    ...(pack.expands || []).map((kind) => kindConfidence.get(kind) || 0)
  );
  const objectHit = objectConfidence > 0;
  // The semantic judgement of the area (graded) carries most weight when present; the
  // function model stays as the second signal, the recognized objects as the third.
  const judged = Object.hasOwn(areaRelevance, pack.pack);
  const semantic = judged
    ? settings.areaWeight * areaRelevance[pack.pack] + settings.functionWeightWithArea * best.score
    : settings.functionWeight * best.score;
  const score = Math.min(1, semantic + settings.objectBonus * objectConfidence);
  return {
    pack: pack.pack,
    service: pack.service,
    score,
    functionId: best.functionId,
    objectHit,
  };
}

// Every recognized object is expanded by the packs that declare its kind, even when the pack
// is not among the top-scored ones: a named identifier is never left unexpanded.
function objectOwners(objects, packs) {
  const owners = new Map();
  for (const object of objects) {
    if (object.kind === CONCERN_KIND) continue;
    owners.set(
      object.objectId,
      packs.filter((pack) => (pack.expands || []).includes(object.kind)).map((pack) => pack.pack)
    );
  }
  return owners;
}

// Packs not yet chosen that own the neighbour function keep the strongest weighted score.
function addEdgeConsequences(consequenceScores, { edge, row, chosen, packs }) {
  for (const pack of packs) {
    if (chosen.has(pack.pack) || !(pack.functionIds || []).includes(edge.functionId)) continue;
    const value = edge.weight * row.score;
    if (value > (consequenceScores.get(pack.pack) || 0)) consequenceScores.set(pack.pack, value);
  }
}

function addNeighbourConsequences(consequenceScores, { selected, chosen, packs, modelOptions }) {
  for (const row of selected) {
    if (!row.functionId) continue;
    for (const edge of getNeighbors(row.functionId, modelOptions))
      addEdgeConsequences(consequenceScores, { edge, row, chosen, packs });
  }
}

// Areas the semantic judgement sees as substantially touched but not answering (a direct
// consequence) are consequence candidates too, next to the graph neighbours.
function addAreaConsequences(consequenceScores, { areaRelevance, chosen, packs, settings }) {
  for (const [pack, relevance] of Object.entries(areaRelevance)) {
    if (chosen.has(pack) || relevance < settings.consequenceRelevance) continue;
    if (!packs.some((entry) => entry.pack === pack)) continue;
    consequenceScores.set(pack, Math.max(consequenceScores.get(pack) || 0, relevance));
  }
}

/**
 * @param {object} input
 * @param {Array} input.packs - registry entries with functionIds, expands, concern
 * @param {Array} input.objects - recognized objects (kind, value)
 * @param {Array} input.functionMatches - [{ functionId, score }] from the hybrid resolver
 */
function selectPacks({
  packs = [],
  objects = [],
  functionMatches = [],
  areaRelevance = {},
  options = {},
}) {
  const settings = { ...DEFAULTS, ...options };
  const scores = new Map(
    functionMatches.map((match) => [match.functionId, Number(match.score) || 0])
  );
  const kindConfidence = kindConfidenceOf(objects);
  const rated = packs
    .map((pack) => ratePack(pack, { scores, kindConfidence, areaRelevance, settings }))
    .sort((left, right) => right.score - left.score || left.pack.localeCompare(right.pack));
  // Graded and relative: a pack answers when it clears the threshold and stays close to the best
  // one, so a clearly responsible area is not diluted by weaker ones.
  const top = rated[0]?.score || 0;
  const selected = rated
    .filter((row) => row.score >= settings.threshold && row.score >= top * settings.relativeShare)
    .slice(0, settings.maxPacks);
  const owners = objectOwners(objects, packs);
  const chosen = new Set(selected.map((row) => row.pack));
  const consequenceScores = new Map();
  addNeighbourConsequences(consequenceScores, {
    selected,
    chosen,
    packs,
    modelOptions: options.modelOptions || {},
  });
  addAreaConsequences(consequenceScores, { areaRelevance, chosen, packs, settings });
  const consequences = [...consequenceScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, settings.maxConsequences)
    .map(([pack, score]) => ({ pack, score }));
  return { rated, selected, owners: Object.fromEntries(owners), consequences };
}

module.exports = { selectPacks, DEFAULTS };
