'use strict';

const { Utils } = require('moleculer');
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
      if (!(parameters.hubFeatures[kind] || []).includes(ref)) {
        features.set(`${kind}:${ref}`, { kind, ref, weight });
      }
    }
  }
  return features;
}

function similarity(left, right) {
  const union = new Set([...left.keys(), ...right.keys()]);
  const shared = [...left.keys()].filter((key) => right.has(key));
  return union.size ? shared.length / union.size : 0;
}

function aggregate(group, context) {
  const { operations, semanticDomains, serviceEvents, parameters } = context;
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
    functionId: `fn-${domains[0] || `cap-${normalizeDomain(group[0].capability)}`}`,
    label: domains.join(' / ') || group[0].capability,
    sources: [
      ...group.map((cap) => ({ kind: 'capability', ref: cap.capability })),
      ...resolved.map((op) => ({ kind: 'operation', ref: op.action })),
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
  const groups = new Map();
  for (const cap of capabilities) {
    const key = normalizeDomain(cap.domain) || `cap-${normalizeDomain(cap.capability)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cap);
  }
  const result = [...groups.entries()]
    .sort(([a], [b]) => compareCanonicalStrings(a, b))
    .map(([, group]) => group);
  // Complete-link grouping: all original groups must strongly overlap. This
  // prevents a chain of weak bridges from collapsing the whole projection.
  const originalFeatures = result.map((group) =>
    featureMap(aggregate(group, context), context.parameters)
  );
  const members = result.map((_, index) => [index]);
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      if (
        members[i].every((a) =>
          members[j].every(
            (b) =>
              similarity(originalFeatures[a], originalFeatures[b]) >=
              context.parameters.mergeSimilarity
          )
        )
      ) {
        result[i].push(...result[j]);
        members[i].push(...members[j]);
        result.splice(j, 1);
        members.splice(j, 1);
        j--;
      }
    }
  }
  return result;
}

function connectFunctions(functions, parameters) {
  const maps = functions.map((fn) => featureMap(fn, parameters));
  const frequency = new Map();
  for (const features of maps) {
    for (const key of features.keys()) frequency.set(key, (frequency.get(key) || 0) + 1);
  }
  const weights = new Map();
  for (const [key, count] of frequency) {
    const hub =
      functions.length >= parameters.automaticHubMinimumFunctions &&
      count / functions.length >= parameters.automaticHubFrequency;
    weights.set(key, hub ? 0 : Math.log(1 + functions.length / count));
  }
  const automaticHubs = [...weights].filter(([, weight]) => weight === 0).map(([key]) => key);
  for (let i = 0; i < functions.length; i++) {
    for (let j = 0; j < functions.length; j++) {
      if (i === j) continue;
      const evidence = [];
      const union = new Set([...maps[i].keys(), ...maps[j].keys()]);
      let denominator = 0;
      for (const key of union) {
        const feature = maps[i].get(key) || maps[j].get(key);
        denominator += feature.weight * weights.get(key);
      }
      for (const [key, feature] of maps[i]) {
        if (maps[j].has(key) && weights.get(key) > 0) {
          evidence.push({
            kind: 'shared',
            feature: feature.kind,
            ref: feature.ref,
            weight: denominator ? (feature.weight * weights.get(key)) / denominator : 0,
          });
        }
      }
      for (const event of functions[i].events.emits) {
        const listener = functions[j].events.listens.find((pattern) => Utils.match(event, pattern));
        if (listener) {
          evidence.push({
            kind: 'event',
            feature: 'emits-listens',
            ref: event,
            listener,
            weight: parameters.eventWeight,
          });
        }
      }
      for (const target of functions[i].writesTo) {
        if (functions[j].dataSources.includes(target)) {
          // Generic shared stores are hubs here as well, never causal evidence.
          const blocked = Object.values(parameters.hubFeatures).some((refs) =>
            refs.includes(target)
          );
          const automatic = ['writesTo', 'dataSources'].some(
            (kind) => weights.get(`${kind}:${target}`) === 0
          );
          if (!blocked && !automatic)
            evidence.push({
              kind: 'write-read',
              feature: 'writesTo-dataSources',
              ref: target,
              weight: parameters.writeReadWeight,
            });
        }
      }
      const weight = Math.min(
        1,
        evidence.reduce((sum, item) => sum + item.weight, 0)
      );
      if (weight > 0)
        functions[i].neighbors.push({ functionId: functions[j].functionId, weight, evidence });
    }
    functions[i].neighbors.sort(
      (a, b) => b.weight - a.weight || compareCanonicalStrings(a.functionId, b.functionId)
    );
  }
  return automaticHubs.sort(compareCanonicalStrings);
}

function projectFunctionModel({
  capabilities,
  operations,
  semanticDomains = [],
  serviceEvents = {},
  parameters = DEFAULT_PARAMETERS,
  sourceHash = null,
}) {
  const ids = capabilities.map((cap) => cap.capability);
  if (ids.some((id) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new Error('Capability IDs must be nonempty and unique');
  }
  const context = { operations, semanticDomains, serviceEvents, parameters };
  const sorted = capabilities
    .slice()
    .sort((a, b) => compareCanonicalStrings(a.capability, b.capability));
  const functions = groupCapabilities(sorted, context)
    .map((group) => aggregate(group, context))
    .sort((a, b) => compareCanonicalStrings(a.functionId, b.functionId));
  if (new Set(functions.map((fn) => fn.functionId)).size !== functions.length) {
    throw new Error('Function ID collision after normalization');
  }
  const automaticHubs = connectFunctions(functions, parameters);
  const actionSet = new Set(operations.map((op) => op.action));
  const gaps = {
    unassignedCapabilities: [],
    capabilitiesWithoutOperations: sorted
      .filter((cap) => !(cap.preferredActions || []).some((action) => actionSet.has(action)))
      .map((cap) => ({ capability: cap.capability, reason: 'No resolvable preferred action' })),
    unresolvedPreferredActions: sorted.flatMap((cap) =>
      (cap.preferredActions || [])
        .filter((action) => !actionSet.has(action))
        .map((action) => ({ capability: cap.capability, action }))
    ),
    isolatedFunctions: functions
      .filter((fn) => !fn.neighbors.some((edge) => edge.weight >= parameters.minWeight))
      .map((fn) => fn.functionId),
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
      capabilityCount: capabilities.length,
      functionCount: functions.length,
      edgeCount,
      possibleEdges,
      density: possibleEdges ? edgeCount / possibleEdges : 0,
      automaticHubs,
    },
    functions,
    gaps,
  };
}

module.exports = { projectFunctionModel, normalizeDomain, DEFAULT_PARAMETERS };
