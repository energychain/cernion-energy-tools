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
  maxConsequences: 2,
  threshold: 0.3,
  functionWeight: 0.6,
  objectBonus: 0.4,
};

function bestScore(pack, scores) {
  let best = { score: 0, functionId: '' };
  for (const functionId of pack.functionIds || []) {
    const score = scores.get(functionId) || 0;
    if (score > best.score) best = { score, functionId };
  }
  return best;
}

/**
 * @param {object} input
 * @param {Array} input.packs - registry entries with functionIds, expands, concern
 * @param {Array} input.objects - recognized objects (kind, value)
 * @param {Array} input.functionMatches - [{ functionId, score }] from the hybrid resolver
 */
function selectPacks({ packs = [], objects = [], functionMatches = [], options = {} }) {
  const settings = { ...DEFAULTS, ...options };
  const scores = new Map(
    functionMatches.map((match) => [match.functionId, Number(match.score) || 0])
  );
  const kinds = new Set(
    objects.map((object) => object.kind).filter((kind) => kind !== CONCERN_KIND)
  );
  const rated = packs
    .map((pack) => {
      const best = bestScore(pack, scores);
      const objectHit = (pack.expands || []).some((kind) => kinds.has(kind));
      const score = Math.min(
        1,
        settings.functionWeight * best.score + (objectHit ? settings.objectBonus : 0)
      );
      return {
        pack: pack.pack,
        service: pack.service,
        score,
        functionId: best.functionId,
        objectHit,
      };
    })
    .sort((left, right) => right.score - left.score || left.pack.localeCompare(right.pack));
  const selected = rated
    .filter((row) => row.score >= settings.threshold)
    .slice(0, settings.maxPacks);
  // Every recognized object is expanded by the packs that declare its kind, even when the pack
  // is not among the top-scored ones: a named identifier is never left unexpanded.
  const owners = new Map();
  for (const object of objects) {
    if (object.kind === CONCERN_KIND) continue;
    owners.set(
      object.objectId,
      packs.filter((pack) => (pack.expands || []).includes(object.kind)).map((pack) => pack.pack)
    );
  }
  const chosen = new Set(selected.map((row) => row.pack));
  const consequenceScores = new Map();
  for (const row of selected) {
    if (!row.functionId) continue;
    for (const edge of getNeighbors(row.functionId, options.modelOptions || {})) {
      for (const pack of packs) {
        if (chosen.has(pack.pack) || !(pack.functionIds || []).includes(edge.functionId)) continue;
        const value = edge.weight * row.score;
        if (value > (consequenceScores.get(pack.pack) || 0))
          consequenceScores.set(pack.pack, value);
      }
    }
  }
  const consequences = [...consequenceScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, settings.maxConsequences)
    .map(([pack, score]) => ({ pack, score }));
  return { rated, selected, owners: Object.fromEntries(owners), consequences };
}

module.exports = { selectPacks, DEFAULTS };
