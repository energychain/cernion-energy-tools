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
  const tableReads = [];
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
  const scoped = datasets.filter(
    (record) => record.provenance?.projectId === projectId && record.current !== false
  );
  const selectedTables = require('./dataset-variants').expandVariantCandidates(
    scoped.filter((record) =>
      nodes.some((node) => node.kind === 'dataset' && node.ref === record.id)
    ),
    scoped,
    question,
    options.conversationId || ctx.params?.conversationId
  );
  const selectedIds = new Set(selectedTables.map((record) => record.id));
  const expanded = [
    ...nodes.filter(
      (node) =>
        node.kind !== 'dataset' ||
        selectedIds.has(node.ref) ||
        !scoped.some((record) => record.id === node.ref)
    ),
  ];
  for (const node of graph.nodes)
    if (
      node.kind === 'dataset' &&
      selectedIds.has(node.ref) &&
      !expanded.some((entry) => entry.nodeId === node.nodeId)
    )
      expanded.push(node);
  const learned = options.skipLearned
    ? null
    : await require('./workbench-project-skills').useSkill(
        ctx,
        selected,
        question,
        selectedTables,
        objects,
        graph.nodes
      );
  if (learned) {
    const linked = await readLinkedEvidence(ctx, selected, question, options);
    learned.evidence.push(...linked.evidence);
    learned.gaps.push(...linked.gaps);
    learned.trace.push(...linked.trace);
    return learned;
  }
  for (const node of expanded
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
        tableReads.push({ record, result });
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
  const compared = new Set();
  for (const entry of tableReads) {
    if (compared.has(entry.record.id)) continue;
    const peers = tableReads.filter((other) => entry.record.variants?.includes(other.record.id));
    if (!peers.length) continue;
    const reads = [entry, ...peers].sort((a, b) =>
      require('./canonical-order').compareCanonicalStrings(a.record.sheet, b.record.sheet)
    );
    const comparison = require('./dataset-variants').compareDatasetResults(
      reads.map((item) => item.record),
      reads.map((item) => item.result),
      reads
        .slice(1)
        .map((item) =>
          reads[0].result.variantDifferences?.find(
            (difference) => difference.datasetId === item.record.id
          )
        )
    );
    const hit = evidence.find((item) => item.metadata.datasetId === reads[0].record.id);
    if (hit) hit.value += `\n${comparison}`;
    reads.forEach((item) => compared.add(item.record.id));
  }
  if (questionType && !evidence.length && !gaps.length)
    missing('eine aktuelle Tabellen- oder Passagenquelle für diesen Fragetyp');
  if (!gaps.length && tableReads.length && !expanded.some((node) => node.kind === 'section')) {
    options.onSuccessfulPath?.({ selected, question, reads: tableReads });
    if (options.learning !== false)
      require('./project-skill-learning').observe(ctx, selected, question, tableReads);
  }
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

function fromConversation(candidate, conversationId) {
  return Boolean(
    candidate.sourceType &&
    candidate.sourceType !== 'project' &&
    (candidate.provenance?.conversationId === conversationId ||
      candidate.provenance?.refs?.some((ref) => ref.conversationId === conversationId))
  );
}

async function projectManifestAnswer(ctx, question, options = {}) {
  const settings = ctx.broker?.getLocalService?.('project-manifest')?.settings || {};
  options = { catalog: settings.catalog, operations: settings.operations, ...options };
  let candidates = await require('./evidence-endpoint-catalog').projectEvidenceCandidates(
    ctx,
    question
  );
  if (options.minSources > 1 && candidates.length < options.minSources) return null;
  let assessments = [];
  let relatedSourceIds = [];
  const select = (routingQuestion) =>
    require('./dataset-routing').selectProjectCandidates(candidates, routingQuestion, {
      ...settings.routing,
      ...options.routing,
      relatedSourceIds,
      onAssessment: options.onAssessment,
      onRanked: (ranked) => {
        assessments = ranked;
      },
    });
  let selected = select(question);
  let readQuestion = question;
  // 'only' resumes a deferred reference resolution; the deterministic routing already ran once.
  if (options.contextual === 'only' && selected.length >= (options.minSources || 1)) return null;
  if (selected.length < (options.minSources || 1) && options.contextual !== 'skip') {
    const contextual = await require('./tenant-evidence-question').contextualEvidenceQuestion(
      ctx,
      candidates,
      question,
      options.previousEvidence,
      assessments
    );
    if (contextual) {
      candidates = await require('./evidence-endpoint-catalog').projectEvidenceCandidates(
        ctx,
        contextual.question
      );
      candidates = candidates.filter(
        (candidate) =>
          !contextual.subjectMatchedIds.includes(candidate.id) ||
          contextual.sourceIds.includes(candidate.id)
      );
      relatedSourceIds = contextual.sourceIds;
      selected = select(contextual.question);
      readQuestion = contextual.question;
    }
  }
  if (options.contextual === 'only' && readQuestion === question) return null;
  if (
    selected.length < (options.minSources || 1) ||
    (options.requireSourceIds?.length &&
      !selected.some((candidate) => options.requireSourceIds.includes(candidate.sourceId)))
  )
    return null;
  // Uploads of the current conversation already reach the regular turn (documents, roles,
  // person protection); tenant evidence takes over only when a source from elsewhere joins.
  if (
    options.currentConversationId &&
    selected.every((candidate) => fromConversation(candidate, options.currentConversationId))
  )
    return null;
  if (
    selected.some((candidate) => candidate.sourceType !== 'project' && candidate.sourceType) &&
    readQuestion === question &&
    !(await require('./tenant-evidence-question').evidenceContentRequested(ctx, question))
  )
    return null;
  const results = [];
  for (const candidate of selected) {
    // Routing metadata must not become an instruction for the source query.
    const result = await require('./tenant-evidence-sources').readEvidenceSource(
      ctx,
      candidate,
      question,
      { ...options, combinedEvidence: selected.length > 1 }
    );
    if (result) results.push({ ...result, candidate });
  }
  if (
    !results.length ||
    (options.minSources > 1 &&
      results.filter((result) => result.evidence.length).length < options.minSources) ||
    (options.requireSourceIds?.length &&
      !results.some(
        (result) =>
          result.evidence.length && options.requireSourceIds.includes(result.candidate.sourceId)
      ))
  )
    return null;
  const chat = selected.some(
    (candidate) => candidate.sourceType && candidate.sourceType !== 'project'
  );
  if (!chat) {
    const result = results[0];
    const selection = `Ich habe dafür die Projektakte „${result.title}“ herangezogen.`;
    return {
      ...result,
      selection,
      responseText: [
        selection,
        ...result.evidence.map((entry) => entry.value),
        ...result.gaps,
      ].join('\n\n'),
    };
  }
  const evidence = results
    .flatMap((result) => result.evidence)
    .map((entry) => ({
      ...entry,
      metadata: {
        ...entry.metadata,
        sourceLabel:
          entry.metadata.sourceLabel || entry.metadata.filename || entry.metadata.projectTitle,
      },
    }));
  const labels = [
    ...new Set(
      evidence.map(
        (entry) =>
          entry.metadata.sourceLabel || entry.metadata.filename || entry.metadata.projectTitle
      )
    ),
  ];
  const selection = evidence.length
    ? `Ich habe dafür ${evidence
        .map(
          (entry) =>
            `„${entry.metadata.sourceLabel || entry.metadata.filename || entry.metadata.projectTitle}“` +
            (entry.metadata.displayRef
              ? ` aus Fall ${entry.metadata.displayRef}`
              : entry.metadata.conversationId
                ? entry.metadata.conversationId ===
                  (ctx.params?.conversationId || ctx.params?.openWebuiConversationId)
                  ? ' aus diesem Gespräch'
                  : ' aus einem früheren Gespräch'
                : '')
        )
        .join(' und ')} herangezogen.`
    : '';
  const gaps = results.flatMap((result) => result.gaps);
  return {
    evidence,
    gaps,
    trace: results.flatMap((result) => result.trace),
    title: labels.join(' · '),
    selection,
    projectSelections: selected
      .filter((candidate) => candidate.sourceType === 'project')
      .map(({ projectId, questionType }) => ({ projectId, questionTypeId: questionType?.id })),
    tenantSelection: selected
      .filter((candidate) => candidate.sourceType !== 'project')
      .map(({ sourceType, sourceId }) => ({ sourceType, sourceId })),
    responseText: [selection, ...evidence.map((entry) => entry.value), ...gaps]
      .filter(Boolean)
      .join('\n\n'),
  };
}

module.exports = { readProjectEvidence, readLinkedEvidence, projectManifestAnswer, sourceLocation };
