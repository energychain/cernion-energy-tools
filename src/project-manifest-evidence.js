'use strict';

const { principal } = require('./domain-router-policy');
const { normalizePhrase } = require('./function-resolver');
const { assertReadObservation } = require('./shared-service-agent-policy');

function sourceLocation(location) {
  return (
    Object.entries(location || {})
      .filter(([, value]) => value != null)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ') || 'gesamte Datei'
  );
}

function projectReadQuestion(question, selected, options) {
  let part = String(question);
  const catalog = options.catalog || [
    ...require('./evidence-endpoint-catalog').EVIDENCE_ENDPOINT_CATALOG,
    ...require('./evidence-endpoint-catalog').PROJECT_GRAPH_ENDPOINTS,
  ];
  const operations =
    options.operations ||
    require('./operation-capability-index').loadOperationCapabilityIndex().operations;
  const labels = selected.manifest.externalLinks.flatMap((link) => {
    const entry = catalog.find((entry) => entry.id === link.endpointId);
    const endpoint =
      entry &&
      require('./project-manifest-catalog').describeProjectEndpoint(
        entry,
        operations.find((operation) => operation.action === entry.action)
      );
    return endpoint
      ? [
          endpoint.id,
          endpoint.label,
          require('./tool-display').catalog[endpoint.action]?.source,
        ].filter(Boolean)
      : [];
  });
  if (!labels.some((label) => part.toLocaleLowerCase().includes(label.toLocaleLowerCase())))
    return part;
  part = part.split(/[?;\n]/u)[0];
  for (const label of labels) {
    const at = part.toLocaleLowerCase().indexOf(label.toLocaleLowerCase());
    if (at < 0) continue;
    const prefix = part.slice(0, at);
    const join = [...prefix.matchAll(/\b(?:und|sowie|zusätzlich|ergaenze|ergänze|plus)\b/giu)].at(
      -1
    );
    part = join ? prefix.slice(0, join.index) : part.slice(0, at) + part.slice(at + label.length);
  }
  return part.trim();
}

async function readProjectEvidence(ctx, selected, question, options = {}) {
  const { projectId, title, questionType } = selected;
  const project = await ctx.call('project-file.get', { projectId });
  if (!['ready', 'degraded'].includes(project.lifecycle) || project.deletion) return null;
  const evidence = [],
    gaps = [],
    trace = [];
  const missing = (detail) => gaps.push(`Für „${question}“ fehlt ${detail}.`);
  if (!questionType) missing('ein passender belegter Fragetyp in dieser Akte');
  const graph = await ctx.call('project-graph.nodes', { projectId, limit: 1000 });
  if (graph.truncated) {
    missing('eine vollständige Graphsicht innerhalb des Lesebudgets');
    return { evidence, gaps, trace, projectId, title };
  }
  const nodes = graph.nodes.filter((node) => questionType?.sources.includes(node.nodeId));
  const objects = await ctx.call('project-upload.objects', { projectId });
  const datasets = nodes.some((node) => node.kind === 'dataset')
    ? await ctx.call('datapoint.datasetCatalog', { operation: 'list' })
    : [];
  for (const node of nodes
    .filter((entry) => ['dataset', 'section'].includes(entry.kind))
    .slice(0, 8)) {
    const object = objects.find(
      (entry) =>
        entry.objectId === node.provenance.objectId && entry.extraction?.status === 'extracted'
    );
    if (!object || (node.provenance.hash && object.hash !== node.provenance.hash)) {
      missing('eine aktuelle Originalversion zur Fundstelle');
      continue;
    }
    try {
      let value, datasetId;
      if (node.kind === 'dataset') {
        const record = datasets.find(
          (entry) =>
            entry.id === node.ref &&
            entry.provenance?.projectId === projectId &&
            entry.provenance?.objectId === object.objectId &&
            entry.hash === object.hash &&
            entry.derivation?.version === object.derivation?.version &&
            entry.current !== false
        );
        if (
          !record ||
          JSON.stringify(record.columns.map(({ name, type }) => ({ name, type }))) !==
            JSON.stringify(node.attributes.columns.map(({ name, type }) => ({ name, type })))
        ) {
          missing('eine aktuelle freigegebene Tabelle mit passendem Schema');
          continue;
        }
        const result = await ctx.call('dataset.query', {
          id: record.id,
          question: projectReadQuestion(question, selected, options),
        });
        if (
          result.status === 'unavailable' ||
          result.status === 'unusable' ||
          !result.datasetId ||
          result.rowCount === 0
        ) {
          missing(
            result.responseText || 'ein Abfrageergebnis für die angefragte Größe und den Zeitraum'
          );
          continue;
        }
        value = result.responseText;
        datasetId = record.id;
      } else {
        const document = await ctx.call('knowledge-rag.documentGet', { id: node.ref });
        if (
          document.provenance?.projectId !== projectId ||
          document.provenance?.objectId !== object.objectId ||
          !object.derivation.documents.includes(document.id)
        ) {
          missing('eine aktuelle autorisierte Passage');
          continue;
        }
        value = String(document.text || '').slice(0, 12000);
        if (!value.trim()) {
          missing('der Text der referenzierten Passage');
          continue;
        }
      }
      const origin = {
        filename: object.name,
        location: node.provenance.location,
        hash: object.hash,
        objectId: object.objectId,
        nodeId: node.nodeId,
      };
      evidence.push({
        source: node.kind === 'dataset' ? 'dataset.query' : 'knowledge-rag.documentGet',
        value: `Aus Projektakte „${title}“: ${value}\nDatei: ${origin.filename}; Fundstelle: ${sourceLocation(origin.location)}; Hash: ${origin.hash}.`,
        metadata: {
          tenantId: principal(ctx).tenantId,
          projectId,
          projectTitle: title,
          datasetId,
          ...origin,
          evidenceQuality: 'validated',
        },
      });
    } catch (_error) {
      missing(
        `der autorisierte Lesezugriff auf „${object.name}“ (${sourceLocation(node.provenance.location)})`
      );
    }
  }
  if (questionType && !evidence.length && !gaps.length)
    missing('eine aktuelle Tabellen- oder Passagenquelle für diesen Fragetyp');
  const linked = await readLinkedEvidence(ctx, selected, question, options);
  evidence.push(...linked.evidence);
  gaps.push(...linked.gaps);
  trace.push(...linked.trace);
  return { evidence, gaps, trace, projectId, title, questionTypeId: questionType?.id };
}

async function readLinkedEvidence(ctx, selected, question, options) {
  const catalog = options.catalog || [
    ...require('./evidence-endpoint-catalog').EVIDENCE_ENDPOINT_CATALOG,
    ...require('./evidence-endpoint-catalog').PROJECT_GRAPH_ENDPOINTS,
  ];
  const operations =
    options.operations ||
    require('./operation-capability-index').loadOperationCapabilityIndex().operations;
  const evidence = [],
    gaps = [],
    trace = [];
  for (const link of selected.manifest.externalLinks.slice(0, 4)) {
    const entry = catalog.find((entry) => entry.id === link.endpointId);
    const operation = operations.find((operation) => operation.action === entry?.action);
    const endpoint =
      entry && require('./project-manifest-catalog').describeProjectEndpoint(entry, operation);
    // A link offers an endpoint; it does not mean that every question requests that source.
    if (
      !endpoint ||
      ![
        endpoint.id,
        endpoint.label,
        require('./tool-display').catalog[endpoint.action]?.source,
        ...(endpoint.evidenceTypeSignals || []),
      ]
        .filter(Boolean)
        .some((name) => ` ${normalizePhrase(question)} `.includes(` ${normalizePhrase(name)} `))
    )
      continue;
    const missing = (detail) => gaps.push(`Aus ${endpoint.label || endpoint.id} fehlt ${detail}.`);
    if (
      !operation ||
      operation.consequenceLevel !== 'none' ||
      !Array.isArray(operation.sideEffects) ||
      operation.sideEffects.length ||
      !Array.isArray(operation.writesTo) ||
      operation.writesTo.length
    ) {
      missing('eine freigegebene Leseaktion');
      continue;
    }
    try {
      // Only current graph relations may bind keys. Manifest values never become parameters.
      const source = link.sources[0];
      const resolved = await ctx.call('project-graph.neighbors', {
        projectId: selected.projectId,
        nodeId: source,
        relation: 'references',
        limit: 1000,
      });
      const external = resolved.nodes.find(
        (node) =>
          node.kind === 'external' &&
          node.ref.catalogId === endpoint.id &&
          node.ref.action === endpoint.action
      );
      if (
        !external ||
        !resolved.edges.some(
          (edge) => edge.to === external.nodeId && edge.from === source && edge.weight >= 0.6
        )
      )
        throw new Error('Missing current relation');
      const parameter = endpoint.graphLink?.parameter;
      if (!parameter) throw new Error('Missing catalog parameter');
      const key = await readJoinKey(
        ctx,
        selected.projectId,
        resolved.nodes.find((node) => node.nodeId === source),
        link.joinKeys
      );
      if (key == null) {
        missing(`ein eindeutiger abgefragter Schlüssel für „${parameter}“`);
        continue;
      }
      const p = principal(ctx);
      const input = {
        ...(endpoint.graphLink.defaults || {}),
        [parameter]: key,
        tenantId: p.tenantId,
      };
      const meta = Object.fromEntries(
        ['apiToken', 'authUser', 'tenantId', 'scopes', 'domainsAllowed']
          .filter((name) => ctx.meta[name] !== undefined)
          .map((name) => [name, ctx.meta[name]])
      );
      const allowed =
        meta.domainsAllowed || meta.apiToken?.domainsAllowed || meta.authUser?.domainsAllowed || [];
      if (
        allowed.length &&
        !(operation.domains || []).some((domain) =>
          allowed.some((name) => normalizePhrase(name) === normalizePhrase(domain))
        )
      )
        throw new Error('Domain not allowed');
      assertReadObservation(
        operation,
        { operations: [endpoint.action], capabilities: operation.capabilityCandidates || [] },
        { meta },
        input,
        ctx.broker
      );
      const result = await require('./workbench-capability-loop').withinToolBudget(
        () =>
          ctx.call(endpoint.action, input, { meta, parentCtx: null, retries: 0, timeout: 3000 }),
        3000
      );
      if (!result || result.success === false || Buffer.byteLength(JSON.stringify(result)) > 32000)
        throw new Error('Missing bounded result');
      const safeResult = require('./workbench-capability-loop').safeOutput(result, p.tenantId);
      const rows = String(endpoint.graphLink.resultPath || '')
        .split('.')
        .filter(Boolean)
        .reduce((value, name) => value?.[name], safeResult);
      if (rows == null || (Array.isArray(rows) && !rows.length))
        throw new Error('Empty catalog result');
      const atPath = (row) =>
        String(endpoint.graphLink.resultField || '')
          .split('.')
          .filter(Boolean)
          .reduce((value, name) => value?.[name], row);
      const matched = (Array.isArray(rows) ? rows : [rows]).filter(
        (row) => normalizePhrase(atPath(row)) === normalizePhrase(key)
      );
      if (!matched.length) throw new Error('Catalog result key mismatch');
      evidence.push({
        source: endpoint.action,
        value: `Aus ${endpoint.label || endpoint.id}: ${JSON.stringify(Array.isArray(rows) ? matched : matched[0])}`,
        metadata: {
          tenantId: p.tenantId,
          projectId: selected.projectId,
          sourceLabel: endpoint.label || endpoint.id,
          parameters: input,
          evidenceQuality: 'validated',
        },
      });
      trace.push({ source: endpoint.action, status: 'available', called: true });
    } catch (_error) {
      missing('ein aktuelles, autorisiertes Abfrageergebnis mit belegtem Schlüssel');
      trace.push({ source: endpoint.action, status: 'unavailable', called: false });
    }
  }
  return { evidence, gaps, trace };
}

async function readJoinKey(ctx, projectId, node, keys) {
  if (node?.kind !== 'dataset' || keys.length !== 1) return null;
  const records = await ctx.call('datapoint.datasetCatalog', { operation: 'list' });
  const record = records.find(
    (item) =>
      item.id === node.ref &&
      item.provenance?.projectId === projectId &&
      item.hash === node.provenance.hash &&
      item.current !== false
  );
  if (!record || !record.columns.some((column) => column.name === keys[0] && !column.sensitive))
    return null;
  const result = await ctx.call('dataset.query', {
    id: record.id,
    plan: {
      sources: [{ alias: 'source', sourceId: record.id }],
      operations: [
        { op: 'aggregate', groupBy: keys, metrics: [{ fn: 'count', as: 'matches' }] },
        { op: 'limit', count: 2 },
      ],
    },
  });
  if (result.status === 'unavailable' || result.result?.length !== 1) return null;
  return result.result[0][keys[0]] ?? null;
}

async function projectManifestAnswer(ctx, question, options = {}) {
  if (!ctx.broker?.getLocalService?.('project-manifest')) return null;
  const settings = ctx.broker.getLocalService('project-manifest').settings;
  options = { catalog: settings.catalog, operations: settings.operations, ...options };
  const candidates = await require('./evidence-endpoint-catalog').projectEvidenceCandidates(ctx);
  const selected = require('./dataset-routing').selectProjectCandidates(candidates, question)[0];
  if (!selected) return null;
  const result = await readProjectEvidence(ctx, selected, question, options);
  if (!result) return null;
  return {
    ...result,
    selection: `Ich habe dafür die Projektakte „${result.title}“ herangezogen.`,
    responseText: [
      `Ich habe dafür die Projektakte „${result.title}“ herangezogen.`,
      ...result.evidence.map((entry) => entry.value),
      ...result.gaps,
    ].join('\n\n'),
  };
}

module.exports = { readProjectEvidence, readLinkedEvidence, projectManifestAnswer, sourceLocation };
