'use strict';
const { normalizeAnchor } = require('./tenant-memory-store');
const { safeCompileRegex } = require('./domain-routes-registry');
const { principal } = require('./domain-router-policy');
const { assertReadObservation } = require('./shared-service-agent-policy');

function atPath(value, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => current?.[key], value);
}
function metadataMatches(column, link, domains) {
  const fields = domains.flatMap((domain) =>
    Object.entries(domain.fieldProfiles || {}).map(([name, field]) => ({
      id: `${domain.id}.${name}`,
      ...field,
    }))
  );
  const field = fields.find((item) => item.id === link.catalogField);
  const names = [...(field?.aliases || []), ...(link.keyFields || [])];
  const named = names.some((name) => normalizeAnchor(name) === normalizeAnchor(column.column.name));
  const classified = link.oeoClasses?.some((value) =>
    (column.column.oeoClasses || []).includes(value)
  );
  const formatted = link.formats?.includes(column.column.format);
  let patterned = false;
  if (link.pattern)
    patterned =
      column.values.length > 0 &&
      column.values.every((value) =>
        safeCompileRegex(link.pattern).test(column.rawValues?.[value] ?? value)
      );
  return Boolean(named || classified || formatted || patterned);
}
async function catalogLinks(ctx, graph, { entries, operations, domains, limits }) {
  const p = principal(ctx);
  let calls = 0;
  for (const entry of entries) {
    const link = entry.graphLink;
    if (!link?.parameter || !link.resultField) continue;
    const operation = operations.find((item) => item.action === entry.action);
    if (
      !operation ||
      operation.consequenceLevel !== 'none' ||
      !Array.isArray(operation.sideEffects) ||
      operation.sideEffects.length ||
      !Array.isArray(operation.writesTo) ||
      operation.writesTo.length
    )
      continue;
    for (const column of graph.columns) {
      if (calls >= limits.calls) return { calls };
      try {
        if (!metadataMatches(column, link, domains)) continue;
      } catch (_error) {
        continue;
      }
      let hits = 0;
      for (const value of column.values.slice(0, limits.samples)) {
        if (calls >= limits.calls) break;
        calls++;
        const params = {
          ...(link.defaults || {}),
          [link.parameter]: column.rawValues?.[value] ?? value,
          tenantId: p.tenantId,
        };
        // The action sees only the original authenticated principal, never worker capabilities.
        const meta = Object.fromEntries(
          ['apiToken', 'authUser', 'tenantId', 'scopes', 'domainsAllowed']
            .filter((key) => ctx.meta[key] !== undefined)
            .map((key) => [key, ctx.meta[key]])
        );
        let timer;
        try {
          const allowed =
            ctx.meta.domainsAllowed ||
            ctx.meta.authUser?.domainsAllowed ||
            ctx.meta.apiToken?.domainsAllowed ||
            [];
          if (
            allowed.length &&
            !(operation.domains || []).some((domain) =>
              allowed.some((value) => normalizeAnchor(value) === normalizeAnchor(domain))
            )
          )
            continue;
          assertReadObservation(
            operation,
            { operations: [entry.action], capabilities: operation.capabilityCandidates || [] },
            { meta },
            params,
            ctx.broker
          );

          const result = await Promise.race([
            ctx.call(entry.action, params, { meta, parentCtx: null, timeout: limits.timeout }),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('Catalog sample timeout')), limits.timeout);
            }),
          ]);
          const rows = atPath(result, link.resultPath);
          const records = Array.isArray(rows)
            ? rows
            : rows && typeof rows === 'object'
              ? [rows]
              : [];
          if (
            records
              .slice(0, 100)
              .some((row) => normalizeAnchor(atPath(row, link.resultField)) === value)
          )
            hits++;
        } catch (_error) {
          /* A failed observation provides no evidence. */
        } finally {
          clearTimeout(timer);
        }
      }
      if (!hits) continue;
      const id = graph.node(
        'external',
        { catalogId: entry.id, action: entry.action },
        [entry.id],
        { action: entry.action, catalogField: link.catalogField },
        {}
      );
      graph.edge(
        column.record.nodeId,
        id,
        'references',
        [
          { kind: 'catalog', score: 0.35, catalogId: entry.id, column: column.column.name },
          { kind: 'observed', score: 0.6, hits, action: entry.action, parameter: link.parameter },
        ],
        'observed'
      );
    }
  }
  return { calls };
}
module.exports = { catalogLinks, metadataMatches };
