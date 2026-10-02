'use strict';

const { Utils } = require('moleculer');
const { tokenize } = require('../src/operation-capability-index');
const { compareCanonicalStrings } = require('../src/canonical-order');
const DEFAULT_PARAMETERS = require('../function-model.parameters.json');

const unique = (values) => [...new Set(values.filter(Boolean))].sort(compareCanonicalStrings);
const normalizeDomain = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function featureMap(fn, parameters) {
  const features = new Map();
  for (const [kind, weight] of Object.entries(parameters.featureWeights)) {
    for (const ref of fn[kind] || []) {
      if (
        !(parameters.hubFeatures[kind] || []).includes(ref) &&
        !(
          ['operations', 'declaredActions'].includes(kind) &&
          parameters.placeholderServices.includes(ref.split('.')[0])
        )
      ) {
        features.set(`${kind}:${ref}`, { kind, ref, weight });
      }
    }
  }
  return features;
}

function featureRarity(maps, parameters) {
  const frequency = new Map();
  for (const features of maps) {
    for (const key of features.keys()) frequency.set(key, (frequency.get(key) || 0) + 1);
  }
  const rarity = new Map();
  for (const [key, count] of frequency) {
    const hub =
      maps.length >= parameters.automaticHubMinimumFunctions &&
      count / maps.length >= parameters.automaticHubFrequency;
    rarity.set(key, hub ? 0 : Math.log(1 + maps.length / count) / Math.log(1 + maps.length));
  }
  return rarity;
}

function similarity(left, right, rarity, parameters) {
  let leftWeight = 0;
  let rightWeight = 0;
  let sharedWeight = 0;
  const structural = new Set();
  for (const [key, feature] of left) {
    const weight = feature.weight * rarity.get(key);
    leftWeight += weight;
    if (right.has(key)) {
      sharedWeight += weight;
      if (weight > 0 && !parameters.groupingExcludedFeatures.includes(feature.kind))
        structural.add(feature.ref);
    }
  }
  for (const [key, feature] of right) rightWeight += feature.weight * rarity.get(key);
  if (structural.size < parameters.minimumSharedFeatures) return 0;
  const denominator = Math.min(leftWeight, rightWeight);
  return denominator ? sharedWeight / denominator : 0;
}

function aggregate(group, context) {
  const {
    operations,
    semanticDomains,
    serviceEvents,
    parameters,
    availableActions,
    sourceActions,
  } = context;
  const actions = unique(group.flatMap((cap) => cap.preferredActions || []));
  const resolved = operations
    .filter((op) => actions.includes(op.action))
    .sort((a, b) => compareCanonicalStrings(a.action, b.action));
  const services = unique(resolved.map((op) => op.service));
  const domains = unique(group.map((cap) => normalizeDomain(cap.domain)));
  const semantics = semanticDomains.filter((domain) =>
    domains.includes(normalizeDomain(domain.id))
  );
  const fn = {
    functionId: `fn-${normalizeDomain(group[0].capability)}`,
    label: group[0].label || group[0].capability,
    sources: [
      ...group.map((cap) => ({ kind: 'capability', ref: cap.capability })),
      ...resolved.map((op) => ({ kind: 'operation', ref: op.action })),
      ...sourceActions
        .filter(
          (entry) =>
            actions.includes(entry.action) ||
            (entry.aliases || []).some((alias) => actions.includes(alias))
        )
        .flatMap((entry) => entry.sources.map((ref) => ({ kind: 'service', ref }))),
      ...semantics.map((domain) => ({ kind: 'semantic-domain', ref: domain.id })),
      ...services.flatMap((service) =>
        (serviceEvents[service]?.sources || []).map((ref) => ({ kind: 'service', ref }))
      ),
    ],
    capabilities: unique(group.map((cap) => cap.capability)),
    operations: unique(resolved.map((op) => op.action)),
    dataSources: unique(resolved.flatMap((op) => op.dataSources || [])),
    entityTypes: unique(resolved.flatMap((op) => op.entityTypes || [])),
    writesTo: unique(resolved.flatMap((op) => op.writesTo || [])),
    services,
    declaredActions: actions.filter((action) => availableActions.has(action)),
    keywords: unique(group.flatMap((cap) => (cap.keywords || []).map(normalizeDomain))),
    keywordTokens: unique(
      group
        .flatMap((cap) => (cap.keywords || []).flatMap(tokenize))
        .filter((token) => token.length >= parameters.keywordTokenMinimumLength)
    ),
    inputs: unique(group.flatMap((cap) => (cap.requiredInputs || []).map((input) => input.name))),
    domains,
    departments: unique(semantics.map((domain) => domain.department)),
    events: {
      emits: unique(services.flatMap((service) => serviceEvents[service]?.emits || [])),
      listens: unique(services.flatMap((service) => serviceEvents[service]?.listens || [])),
    },
    consequenceLevels: {},
    neighbors: [],
    derivation: { version: parameters.version, generatedAt: parameters.generatedAt },
  };
  for (const op of resolved) {
    const level = op.consequenceLevel || 'unknown';
    fn.consequenceLevels[level] = (fn.consequenceLevels[level] || 0) + 1;
  }
  fn.sources = [
    ...new Map(fn.sources.map((source) => [`${source.kind}:${source.ref}`, source])).values(),
  ].sort((a, b) => compareCanonicalStrings(`${a.kind}:${a.ref}`, `${b.kind}:${b.ref}`));
  return fn;
}

function groupCapabilities(capabilities, context) {
  const maps = capabilities.map((cap) =>
    featureMap(aggregate([cap], context), {
      ...context.parameters,
      featureWeights: context.parameters.groupingFeatureWeights,
    })
  );
  const rarity = featureRarity(maps, context.parameters);
  const pairScores = maps.map((left) =>
    maps.map((right) => similarity(left, right, rarity, context.parameters))
  );
  const groups = capabilities.map((_, index) => [index]);
  // Deterministic complete-link agglomeration from individual capabilities.
  // Overlap uses the smaller weighted feature mass; every cross-pair must pass.
  while (true) {
    let best = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const score = Math.min(...groups[i].flatMap((a) => groups[j].map((b) => pairScores[a][b])));
        if (score >= context.parameters.mergeSimilarity && (!best || score > best.score))
          best = { i, j, score };
      }
    }
    if (!best) break;
    groups[best.i].push(...groups[best.j]);
    groups[best.i].sort((a, b) => a - b);
    groups.splice(best.j, 1);
  }
  return groups.map((group) => group.map((index) => capabilities[index]));
}

function causalFeatureMap(fn, parameters) {
  const features = featureMap(fn, parameters);
  for (const ref of unique([...fn.events.emits, ...fn.events.listens])) {
    features.set(`events:${ref}`, { kind: 'events', ref, weight: parameters.eventWeight });
  }
  for (const ref of unique([...fn.writesTo, ...fn.dataSources])) {
    features.set(`resources:${ref}`, {
      kind: 'resources',
      ref,
      weight: parameters.writeReadWeight,
    });
  }
  return features;
}

function selectNeighborhoods(functions, parameters) {
  const limit =
    functions.length < parameters.degreeBudgetMinimumFunctions
      ? Math.max(0, functions.length - 1)
      : Math.floor(parameters.maxDegreeFraction * functions.length);
  const peers = new Map(functions.map((fn) => [fn.functionId, new Map()]));
  for (const fn of functions)
    for (const edge of fn.neighbors) {
      if (edge.weight < parameters.minWeight) continue;
      for (const [from, to] of [
        [fn.functionId, edge.functionId],
        [edge.functionId, fn.functionId],
      ]) {
        peers.get(from).set(to, Math.max(peers.get(from).get(to) || 0, edge.weight));
      }
    }
  const retained = new Map(
    [...peers].map(([id, candidates]) => [
      id,
      new Set(
        [...candidates]
          .sort(([a, weightA], [b, weightB]) => weightB - weightA || compareCanonicalStrings(a, b))
          .slice(0, limit)
          .map(([peer]) => peer)
      ),
    ])
  );
  let prunedEdgeCount = 0;
  const budgetIsolatedFunctionIds = [];
  for (const fn of functions) {
    const hadCandidate = fn.neighbors.some((edge) => edge.weight >= parameters.minWeight);
    fn.neighbors = fn.neighbors.filter((edge) => {
      if (edge.weight < parameters.minWeight) return true;
      const keep =
        retained.get(fn.functionId).has(edge.functionId) &&
        retained.get(edge.functionId).has(fn.functionId);
      if (!keep) prunedEdgeCount++;
      return keep;
    });
    if (hadCandidate && !fn.neighbors.some((edge) => edge.weight >= parameters.minWeight))
      budgetIsolatedFunctionIds.push(fn.functionId);
  }
  return { prunedEdgeCount, degreeLimit: limit, budgetIsolatedFunctionIds };
}

function connectFunctions(functions, parameters) {
  const maps = functions.map((fn) => causalFeatureMap(fn, parameters));
  const rarity = featureRarity(maps, parameters);
  const automaticHubs = [...rarity].filter(([, weight]) => weight === 0).map(([key]) => key);
  for (let i = 0; i < functions.length; i++) {
    for (let j = 0; j < functions.length; j++) {
      if (i === j) continue;
      const evidence = [];
      function contribute(kind, feature, ref, strength, extra = {}) {
        const key = `${feature}:${ref}`;
        const factor = Math.min(rarity.get(key) || 0, extra.listenerRarity ?? 1);
        const blocked = Object.values(parameters.hubFeatures).some((refs) => refs.includes(ref));
        if (!factor || blocked) return;
        const weight = parameters.maxEvidenceContribution * Math.min(1, strength) * factor;
        if (weight > 0) evidence.push({ kind, feature, ref, weight, ...extra });
      }
      for (const [key, feature] of maps[i]) {
        if (maps[j].has(key) && !['events', 'resources'].includes(feature.kind)) {
          contribute('shared', feature.kind, feature.ref, parameters.sharedWeight * feature.weight);
        }
      }
      for (const event of functions[i].events.emits) {
        const listener = functions[j].events.listens.find((pattern) => Utils.match(event, pattern));
        if (listener) {
          const factor = Math.min(
            rarity.get(`events:${event}`) || 0,
            rarity.get(`events:${listener}`) || 0
          );
          contribute('event', 'events', event, parameters.eventWeight, {
            listener,
            listenerRarity: factor,
          });
        }
      }
      for (const target of functions[i].writesTo) {
        if (functions[j].dataSources.includes(target))
          contribute('write-read', 'resources', target, parameters.writeReadWeight);
      }
      // Several representations of the same ref cannot masquerade as multiple
      // independent features (e.g. shared data source plus write/read target).
      const byRef = new Map();
      for (const item of evidence) {
        const existing = byRef.get(item.ref);
        if (
          !existing ||
          item.weight > existing.weight ||
          (item.weight === existing.weight && item.kind !== 'shared')
        )
          byRef.set(item.ref, item);
      }
      const independent = [...byRef.values()];
      const weight = Math.min(
        1,
        independent.reduce((sum, item) => sum + item.weight, 0)
      );
      if (weight > 0)
        functions[i].neighbors.push({
          functionId: functions[j].functionId,
          weight,
          evidence: independent,
        });
    }
    functions[i].neighbors.sort(
      (a, b) => b.weight - a.weight || compareCanonicalStrings(a.functionId, b.functionId)
    );
  }
  const candidateDegree = summarizeFunctions(functions, parameters).degree;
  const selection = selectNeighborhoods(functions, parameters);
  return {
    automaticHubs: automaticHubs.sort(compareCanonicalStrings),
    candidateDegree,
    ...selection,
  };
}

function summarizeFunctions(functions, parameters) {
  const capabilityDistribution = {};
  for (const fn of functions) {
    const size = fn.capabilities.length;
    capabilityDistribution[size] = (capabilityDistribution[size] || 0) + 1;
  }
  const degrees = functions
    .map((fn) => fn.neighbors.filter((edge) => edge.weight >= parameters.minWeight).length)
    .sort((a, b) => a - b);
  const middle = Math.floor(degrees.length / 2);
  return {
    capabilitiesPerFunction: capabilityDistribution,
    singleCapabilityFraction: functions.length
      ? (capabilityDistribution[1] || 0) / functions.length
      : 0,
    crossDomainFunctionCount: functions.filter((fn) => fn.domains.length > 1).length,
    degree: {
      minimum: degrees[0] || 0,
      median: !degrees.length
        ? 0
        : degrees.length % 2
          ? degrees[middle]
          : (degrees[middle - 1] + degrees[middle]) / 2,
      maximum: degrees.at(-1) || 0,
      isolatedFraction: functions.length
        ? degrees.filter((degree) => degree === 0).length / functions.length
        : 0,
    },
  };
}

function projectFunctionModel({
  capabilities,
  operations,
  semanticDomains = [],
  serviceEvents = {},
  parameters = DEFAULT_PARAMETERS,
  sourceHash = null,
  sourceActions = [],
}) {
  const ids = capabilities.map((cap) => cap.capability);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new Error('Capability IDs must be nonempty and unique');
  }
  if (!(
    parameters.maxEvidenceContribution > 0 &&
    parameters.maxEvidenceContribution < parameters.minWeight
  ))
    throw new Error('Evidence contribution must be below minWeight');
  const availableActions = new Set(
    [
      ...operations.map((op) => op.action),
      ...sourceActions.flatMap((entry) => [entry.action, ...(entry.aliases || [])]),
    ].filter(Boolean)
  );
  const context = {
    operations,
    semanticDomains,
    serviceEvents,
    parameters,
    availableActions,
    sourceActions,
  };
  const sorted = capabilities
    .slice()
    .sort((a, b) => compareCanonicalStrings(a.capability, b.capability));
  const functions = groupCapabilities(sorted, context)
    .map((group) => aggregate(group, context))
    .sort((a, b) => compareCanonicalStrings(a.functionId, b.functionId));
  if (new Set(functions.map((fn) => fn.functionId)).size !== functions.length) {
    throw new Error('Function ID collision after normalization');
  }
  const neighborhood = connectFunctions(functions, parameters);
  const actionSet = new Set(operations.map((op) => op.action));
  const gaps = {
    unassignedCapabilities: [],
    capabilitiesWithoutOperations: sorted
      .filter((cap) => !(cap.preferredActions || []).some((action) => actionSet.has(action)))
      .map((cap) => ({ capability: cap.capability, reason: 'No resolvable preferred action' })),
    unresolvedPreferredActions: sorted.flatMap((cap) =>
      (cap.preferredActions || [])
        .filter((action) => !actionSet.has(action))
        .map((action) => {
          const source = sourceActions.find(
            (entry) => entry.action === action || (entry.aliases || []).includes(action)
          );
          const indexEntry =
            source && operations.find((op) => op.operationId === source.operationId);
          const reason = !source
            ? 'Action does not exist in source'
            : indexEntry && !indexEntry.action
              ? 'Action exists in source; index entry has no action'
              : indexEntry
                ? 'Action exists in source; preferred reference differs from index action'
                : 'Action exists in source; no matching index entry';
          return {
            capability: cap.capability,
            action,
            reason,
            ...(source ? { sources: source.sources } : {}),
          };
        })
    ),
    isolatedFunctions: functions
      .filter((fn) => !fn.neighbors.some((edge) => edge.weight >= parameters.minWeight))
      .map((fn) => ({
        functionId: fn.functionId,
        reason: neighborhood.budgetIsolatedFunctionIds.includes(fn.functionId)
          ? 'No peer retained by mutual neighborhood budget'
          : !fn.operations.length
            ? 'No resolvable operations'
            : !fn.neighbors.length
              ? 'No non-hub shared or causal features'
              : 'Insufficient independent evidence at default threshold',
        strongestWeight: fn.neighbors[0]?.weight || 0,
      })),
    placeholderOnlyFunctions: functions
      .filter(
        (fn) =>
          fn.services.length &&
          fn.services.every((service) => parameters.placeholderServices.includes(service))
      )
      .map((fn) => fn.functionId),
    functionsWithoutEvents: functions
      .filter((fn) => !fn.events.emits.length && !fn.events.listens.length)
      .map((fn) => fn.functionId),
    functionsWithoutListeners: functions
      .filter((fn) => !fn.events.listens.length)
      .map((fn) => fn.functionId),
    unresolvedStaticEvents: Object.entries(serviceEvents).flatMap(([service, entry]) =>
      (entry.unresolved || []).map((ref) => ({ service, ref }))
    ),
    overrides: [],
  };
  gaps.actionsWithMissingIndexAction = gaps.unresolvedPreferredActions.filter(
    (entry) => entry.reason === 'Action exists in source; index entry has no action'
  );
  gaps.actionsNotInSource = gaps.unresolvedPreferredActions.filter(
    (entry) => entry.reason === 'Action does not exist in source'
  );
  gaps.actionsWithoutIndexEntry = gaps.unresolvedPreferredActions.filter(
    (entry) => entry.reason === 'Action exists in source; no matching index entry'
  );
  gaps.actionReferenceMismatches = gaps.unresolvedPreferredActions.filter(
    (entry) =>
      entry.reason === 'Action exists in source; preferred reference differs from index action'
  );
  const edgeCount = functions.reduce(
    (sum, fn) => sum + fn.neighbors.filter((edge) => edge.weight >= parameters.minWeight).length,
    0
  );
  const possibleEdges = functions.length * (functions.length - 1);
  return {
    schemaVersion: 'cernion.functionModel.v1',
    generator: 'scripts/generate-function-model.js',
    sourceHash,
    parameters,
    statistics: {
      indexOperationCount: operations.length,
      indexOperationsWithoutAction: operations.filter((op) => !op.action).length,
      capabilityCount: capabilities.length,
      functionCount: functions.length,
      edgeCount,
      possibleEdges,
      density: possibleEdges ? edgeCount / possibleEdges : 0,
      ...neighborhood,
      ...summarizeFunctions(functions, parameters),
    },
    functions,
    gaps,
  };
}

module.exports = { projectFunctionModel, normalizeDomain, DEFAULT_PARAMETERS };
