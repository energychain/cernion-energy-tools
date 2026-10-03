'use strict';

const fs = require('fs');
const path = require('path');
const { parseSync, traverse } = require('@babel/core');
const { extractServiceActions } = require('./function-model-sources');

// Read declarations, never execute service modules or start a broker.
function loadActionResolution(root) {
  const sources = new Map();
  const actions = [];
  for (const file of fs.readdirSync(path.join(root, 'services')).sort()) {
    if (file.endsWith('.service.js'))
      actions.push(...extractServiceActions(path.join(root, 'services', file), sources, root));
  }
  const byReference = new Map();
  const byOperationId = new Map();
  for (const entry of actions) {
    for (const ref of [entry.action, ...(entry.aliases || [])]) byReference.set(ref, entry);
    if (!byOperationId.has(entry.operationId)) byOperationId.set(entry.operationId, new Set());
    byOperationId.get(entry.operationId).add(entry.action);
    const exportedId = entry.operationId.replace(/\./g, '_');
    if (!byOperationId.has(exportedId)) byOperationId.set(exportedId, new Set());
    byOperationId.get(exportedId).add(entry.action);
  }
  const routes = new Map();
  const ast = parseSync(fs.readFileSync(path.join(root, 'services/api.service.js'), 'utf8'), {
    configFile: false,
    babelrc: false,
  });
  const key = (property) => property.key?.name || property.key?.value;
  const routeKey = (method, url) =>
    `${method.toUpperCase()} ${url.replace(/:([\w]+)/g, '{$1}').replace(/\/+$/, '') || '/'}`;
  traverse(ast, {
    ObjectExpression({ node }) {
      const aliases = node.properties.find((property) => key(property) === 'aliases')?.value;
      const prefix = node.properties.find((property) => key(property) === 'path')?.value;
      if (aliases?.type !== 'ObjectExpression' || prefix?.type !== 'StringLiteral') return;
      for (const property of aliases.properties) {
        const match = String(key(property) || '').match(/^([A-Z]+)\s+(.+)$/);
        if (!match) continue;
        const definition = property.value;
        const target =
          definition?.type === 'StringLiteral'
            ? definition.value
            : definition?.properties?.find((item) => key(item) === 'action')?.value?.value;
        const fullPath = `${prefix.value.replace(/\/$/, '')}/${match[2].replace(/^\//, '')}`;
        const ref = routeKey(match[1], fullPath);
        if (!routes.has(ref)) routes.set(ref, new Set());
        routes.get(ref).add(typeof target === 'string' ? target : null);
      }
    },
  });
  return { byReference, byOperationId, routes, routeKey };
}

function resolveOperationAction(operation, resolution) {
  const { byReference, byOperationId, routes, routeKey } = resolution;
  const aliases = [`${operation.method} ${operation.path}`, ...(operation.aliases || [])];
  const targets = new Set();
  for (const alias of aliases) {
    const separator = alias.indexOf(' ');
    const ref = routeKey(alias.slice(0, separator), alias.slice(separator + 1));
    for (const target of routes.get(ref) || []) targets.add(target);
  }
  if (targets.size) {
    if (targets.size !== 1)
      return { action: null, actionResolutionReason: 'conflicting_or_dynamic_route_aliases' };
    const [target] = targets;
    if (!target)
      return { action: null, actionResolutionReason: 'route_alias_has_no_static_action' };
    if (!byReference.has(target))
      return { action: null, actionResolutionReason: `route_action_not_declared: ${target}` };
    return { action: target, actionResolutionReason: null };
  }
  const candidates = byOperationId.get(operation.operationId) || new Set();
  if (candidates.size === 1) return { action: [...candidates][0], actionResolutionReason: null };
  if (candidates.size > 1)
    return { action: null, actionResolutionReason: 'ambiguous_declared_operation_id' };
  return { action: null, actionResolutionReason: 'no_static_route_or_action_declaration' };
}

function actionCoverage(entries) {
  const unresolvedActions = entries
    .filter((entry) => !entry.action)
    .map(({ operationId, method, path: url, actionResolutionReason }) => ({
      operationId,
      method,
      path: url,
      reason: actionResolutionReason,
    }));
  return {
    resolvedActionCount: entries.length - unresolvedActions.length,
    unresolvedActionCount: unresolvedActions.length,
    unresolvedActions,
  };
}

module.exports = { loadActionResolution, resolveOperationAction, actionCoverage };
