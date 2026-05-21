'use strict';

function getNestedValue(record, path) {
  if (!record || !path) return undefined;
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), record);
}

function getFirstDefined(record, paths) {
  for (const path of paths || []) {
    const value = getNestedValue(record, path);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized ? normalized.replace(/\s+/g, ' ') : null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFieldValue(record, mapping, side) {
  const paths = side === 'mastr' ? mapping.mastrPaths : mapping.oepPaths;
  const scale = side === 'mastr' ? mapping.mastrScale || 1 : mapping.oepScale || 1;
  const rawValue = getFirstDefined(record, paths);

  if (rawValue === null) return null;
  if (mapping.type === 'number') {
    const numericValue = normalizeNumber(rawValue);
    return numericValue === null ? null : numericValue * scale;
  }
  return normalizeText(rawValue);
}

function buildFeatureMap(record, fieldMap, side) {
  return fieldMap.reduce((features, mapping) => {
    features[mapping.field] = normalizeFieldValue(record, mapping, side);
    return features;
  }, {});
}

function buildJoinCandidates(features) {
  const name = features.name;
  const city = features.city;
  const postalCode = features.postalCode;
  const capacityKw = features.capacityKw;
  const commissioningYear = features.commissioningYear;
  const latitude = features.latitude;
  const longitude = features.longitude;
  const keys = [];

  if (latitude !== null && longitude !== null && capacityKw !== null) {
    keys.push({
      key: `geo-cap:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(capacityKw)}`,
      score: 100,
    });
  }
  if (postalCode && capacityKw !== null && commissioningYear !== null) {
    keys.push({
      key: `plz-cap-year:${postalCode}:${Math.round(capacityKw)}:${Math.round(commissioningYear)}`,
      score: 90,
    });
  }
  if (postalCode && capacityKw !== null) {
    keys.push({ key: `plz-cap:${postalCode}:${Math.round(capacityKw)}`, score: 80 });
  }
  if (name && capacityKw !== null) {
    keys.push({ key: `name-cap:${name}:${Math.round(capacityKw)}`, score: 75 });
  }
  if (city && capacityKw !== null) {
    keys.push({ key: `city-cap:${city}:${Math.round(capacityKw)}`, score: 65 });
  }
  if (latitude !== null && longitude !== null) {
    keys.push({ key: `geo:${latitude.toFixed(3)}:${longitude.toFixed(3)}`, score: 60 });
  }

  return keys;
}

function getReference(record, features, side) {
  return {
    side,
    id: record?.mastrNummer || record?.mastrNumber || record?.id || record?.name || null,
    name: record?.name || record?.anlagenname || features.name || null,
    city: features.city || null,
    postalCode: features.postalCode || null,
  };
}

function joinByOeoClass(mastrInstallations, oepRows, oeoClass, fieldMap = []) {
  const oepIndex = new Map();
  const oepFeatures = oepRows.map((row) => buildFeatureMap(row, fieldMap, 'oep'));
  const mastrFeatures = mastrInstallations.map((row) => buildFeatureMap(row, fieldMap, 'mastr'));
  const usedOepIndices = new Set();

  oepFeatures.forEach((features, index) => {
    for (const candidate of buildJoinCandidates(features)) {
      const matches = oepIndex.get(candidate.key) || [];
      matches.push({ index, score: candidate.score });
      oepIndex.set(candidate.key, matches);
    }
  });

  const pairs = [];
  const mastrOnly = [];

  mastrInstallations.forEach((mastrRecord, mastrIndex) => {
    const features = mastrFeatures[mastrIndex];
    let bestMatch = null;

    for (const candidate of buildJoinCandidates(features)) {
      const matches = oepIndex.get(candidate.key) || [];
      const available = matches.find((match) => !usedOepIndices.has(match.index));
      if (available) {
        bestMatch = {
          index: available.index,
          matchKey: candidate.key,
          matchScore: Math.max(candidate.score, available.score),
        };
        break;
      }
    }

    if (!bestMatch) {
      mastrOnly.push({
        record: mastrRecord,
        features,
        ref: getReference(mastrRecord, features, 'mastr'),
      });
      return;
    }

    usedOepIndices.add(bestMatch.index);
    pairs.push({
      mastr: mastrRecord,
      oep: oepRows[bestMatch.index],
      mastrFeatures: features,
      oepFeatures: oepFeatures[bestMatch.index],
      matchKey: bestMatch.matchKey,
      matchScore: bestMatch.matchScore,
      matchReasons: [bestMatch.matchKey.split(':')[0]],
      refs: {
        mastr: getReference(mastrRecord, features, 'mastr'),
        oep: getReference(oepRows[bestMatch.index], oepFeatures[bestMatch.index], 'oep'),
      },
    });
  });

  const oepOnly = oepRows
    .map((record, index) => ({ record, features: oepFeatures[index], index }))
    .filter((entry) => !usedOepIndices.has(entry.index))
    .map((entry) => ({
      record: entry.record,
      features: entry.features,
      ref: getReference(entry.record, entry.features, 'oep'),
    }));

  return {
    oeoClass,
    pairs,
    mastrOnly,
    oepOnly,
  };
}

function computeSeverity(mapping, mastrValue, oepValue, absoluteDelta, deltaPct) {
  if (mastrValue === null || oepValue === null) return 'info';
  if (mapping.type === 'string') return mastrValue === oepValue ? 'ok' : 'warning';
  if (absoluteDelta === 0) return 'ok';

  if (mapping.criticalAbs !== undefined && absoluteDelta >= mapping.criticalAbs) return 'critical';
  if (mapping.warningAbs !== undefined && absoluteDelta >= mapping.warningAbs) return 'warning';
  if (deltaPct !== null && mapping.criticalPct !== undefined && deltaPct >= mapping.criticalPct) {
    return 'critical';
  }
  if (deltaPct !== null && mapping.warningPct !== undefined && deltaPct >= mapping.warningPct) {
    return 'warning';
  }
  return 'ok';
}

function computeFieldDeltas(joinedPair, fieldMap = []) {
  return fieldMap.map((mapping) => {
    const mastrValue = joinedPair.mastrFeatures[mapping.field] ?? null;
    const oepValue = joinedPair.oepFeatures[mapping.field] ?? null;
    const numeric = mapping.type === 'number';
    const absoluteDelta =
      numeric && mastrValue !== null && oepValue !== null ? Math.abs(mastrValue - oepValue) : null;
    const deltaPct =
      numeric && absoluteDelta !== null
        ? oepValue === 0
          ? mastrValue === 0
            ? 0
            : null
          : Number(((absoluteDelta / Math.abs(oepValue)) * 100).toFixed(2))
        : null;

    return {
      field: mapping.field,
      oeoProperty: mapping.oeoProperty,
      mastrValue,
      oepValue,
      absoluteDelta: absoluteDelta === null ? null : Number(absoluteDelta.toFixed(4)),
      deltaPct,
      severity: computeSeverity(mapping, mastrValue, oepValue, absoluteDelta, deltaPct),
    };
  });
}

function aggregateDeltas(joinResult, fieldMap = []) {
  const fieldStats = {};
  let capacityDeltaMw = 0;

  for (const pair of joinResult.pairs) {
    const deltas = computeFieldDeltas(pair, fieldMap);
    pair.fieldDeltas = deltas;
    pair.mismatchScore = deltas.reduce((score, delta) => {
      if (delta.severity === 'critical') return score + 3;
      if (delta.severity === 'warning') return score + 1;
      return score;
    }, 0);

    for (const delta of deltas) {
      if (!fieldStats[delta.field]) {
        fieldStats[delta.field] = {
          oeoProperty: delta.oeoProperty,
          mean: null,
          max: null,
          mismatchCount: 0,
          criticalCount: 0,
          samples: 0,
          totalPct: 0,
        };
      }
      const stats = fieldStats[delta.field];
      if (delta.deltaPct !== null) {
        stats.samples += 1;
        stats.totalPct += delta.deltaPct;
        stats.max = stats.max === null ? delta.deltaPct : Math.max(stats.max, delta.deltaPct);
      }
      if (delta.severity !== 'ok') stats.mismatchCount += 1;
      if (delta.severity === 'critical') stats.criticalCount += 1;
    }

    const capacityDelta = deltas.find((delta) => delta.field === 'capacityKw');
    if (capacityDelta?.mastrValue !== null && capacityDelta?.oepValue !== null) {
      capacityDeltaMw += (capacityDelta.mastrValue - capacityDelta.oepValue) / 1000;
    }
  }

  for (const stats of Object.values(fieldStats)) {
    if (stats.samples > 0) {
      stats.mean = Number((stats.totalPct / stats.samples).toFixed(2));
      stats.max = Number((stats.max || 0).toFixed(2));
    }
    delete stats.samples;
    delete stats.totalPct;
  }

  const topMismatches = joinResult.pairs
    .filter((pair) => pair.mismatchScore > 0)
    .sort((left, right) => right.mismatchScore - left.mismatchScore)
    .slice(0, 10)
    .map((pair) => ({
      mismatchScore: pair.mismatchScore,
      matchScore: pair.matchScore,
      matchReasons: pair.matchReasons,
      mastrRef: pair.refs.mastr,
      oepRef: pair.refs.oep,
      deltas: pair.fieldDeltas.filter((delta) => delta.severity !== 'ok'),
    }));

  return {
    matchedPairs: joinResult.pairs.length,
    mastrOnly: joinResult.mastrOnly.length,
    oepOnly: joinResult.oepOnly.length,
    totalUnmatched: joinResult.mastrOnly.length + joinResult.oepOnly.length,
    capacityDeltaMW: Number(capacityDeltaMw.toFixed(4)),
    fieldDeltas: fieldStats,
    topMismatches,
  };
}

module.exports = {
  joinByOeoClass,
  computeFieldDeltas,
  aggregateDeltas,
};
