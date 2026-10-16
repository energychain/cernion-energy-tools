'use strict';

const Ajv = require('ajv');
const { projectRoutingSources } = require('./project-manifest-metadata');

// Keep schema validation strict after removing unsupported claims and references.
function sanitizeContent(content, nodes, schema, diagnostics) {
  const ids = new Set(nodes.map((node) => node.nodeId));
  const ajv = new Ajv({ allErrors: true });
  const clean = (item, definition) => {
    const refs = Array.isArray(item?.sources) ? item.sources : [];
    diagnostics.discardedReferences += refs.filter((id) => !ids.has(id)).length;
    const result = { ...item, sources: [...new Set(refs.filter((id) => ids.has(id)))] };
    if (!ajv.validate(definition, result)) {
      diagnostics.discardedClaims++;
      return null;
    }
    return result;
  };
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, definition]) => [
      key,
      key === 'summary'
        ? clean(content?.summary, definition)
        : (Array.isArray(content?.[key]) ? content[key] : [])
            .slice(0, 100)
            .map((item) => clean(item, definition.items))
            .filter(Boolean)
            .filter(
              (item, index, items) =>
                key !== 'questionTypes' ||
                items.findIndex((other) => other.id === item.id) === index
            ),
    ])
  );
}

function minimalContent(project, nodes, datasets) {
  if (!nodes.length) return null;
  const bounded = (value) => String(value || '').slice(0, 1000);
  const sources = projectRoutingSources(nodes, datasets, project.projectId).slice(0, 100);
  return {
    summary: { text: bounded(project.title || 'Projektakte'), sources: [nodes[0].nodeId] },
    entities: nodes
      .filter((node) => node.kind === 'entity')
      .flatMap((node) =>
        (node.labels || []).filter(Boolean).map((name) => ({
          name: bounded(name),
          kind: 'subject',
          sources: [node.nodeId],
        }))
      )
      .slice(0, 100),
    timeRanges: sources
      .filter((source) => source.period?.from && source.period?.to)
      .map((source) => ({
        from: bounded(source.period.from),
        to: bounded(source.period.to),
        sources: [source.nodeId],
      })),
    questionTypes: sources.map((source, index) => ({
      id: `read-${index + 1}`,
      description: bounded(
        [
          ...source.names,
          ...source.columns.map((column) => column.name),
          ...Object.values(source.units),
          source.period?.from,
          source.period?.to,
        ]
          .filter(Boolean)
          .join(' · ') || 'Quelle lesen'
      ),
      inputs: [],
      skillRefs: [],
      sources: [source.nodeId],
    })),
    externalLinks: [],
  };
}

function assembleManifest(content, project, records, version, catalog = []) {
  if (!content) return null;
  const { validateManifest, externalLinks, contentSchema } = require('./project-manifest');
  const nodes = records.filter((record) => record.recordType === 'node');
  const ids = new Set(nodes.map((node) => node.nodeId));
  const ajv = new Ajv();
  const links = externalLinks(records, catalog)
    .filter(
      (link) =>
        link.sources.every((id) => ids.has(id)) &&
        ajv.validate(contentSchema.properties.externalLinks.items, link)
    )
    .slice(0, 100);
  return validateManifest(
    {
      ...content,
      externalLinks: links,
      projectId: project.projectId,
      version,
      generatedAt: new Date().toISOString(),
    },
    nodes
  );
}

module.exports = { sanitizeContent, minimalContent, assembleManifest };
