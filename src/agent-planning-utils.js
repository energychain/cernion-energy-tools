/**
 * Shared planning utilities used by agent-like planners.
 *
 * Keeps planner normalization/catalogue logic in one place so additive
 * services (e.g. capability-broker) can reuse the same behavior.
 */

/**
 * Build a compact service catalogue from a Moleculer service list.
 *
 * @param {Array<object>} services
 * @returns {Array<object>}
 */
function buildServiceCatalogue(services) {
  const catalogue = [];
  const skipServices = new Set([
    'api',
    '$node',
    'agent',
    'edm',
    'edm-validation',
    'edm-messkonzept',
    'edm-virtual',
    'mscons-import',
    'slp',
    'mastr-monitor',
    'company',
    'grid-connection',
    'energy-sharing',
    'energy-sharing-allocation',
    'mastr-quality',
    'redispatch-expost',
    'settlement',
    'bilanzkreis',
    'forecast-engine',
    'flex',
    'znp',
    'object-store',
    'cookbook',
    'capability-broker',
    'mcp-server',
  ]);

  for (const svc of services) {
    if (!svc?.name || svc.name.startsWith('$') || skipServices.has(svc.name)) continue;
    if (!svc.actions) continue;

    for (const actionName of Object.keys(svc.actions)) {
      const action = svc.actions[actionName];
      const shortName = actionName.includes('.') ? actionName.split('.').pop() : actionName;
      const restPath = action.rest
        ? typeof action.rest === 'string'
          ? action.rest
          : `${action.rest.method} ${action.rest.path}`
        : null;

      if (!restPath) continue;

      const paramDefs = action.params
        ? Object.entries(action.params).map(([k, v]) => {
            if (Array.isArray(v)) {
              const types = v
                .map((r) => (typeof r === 'object' && r.type ? r.type : 'any'))
                .join('|');
              return `${k}?: ${types}`;
            }
            const t = typeof v === 'string' ? v : v.type || 'string';
            const opt = typeof v === 'object' && v.optional ? '?' : '';
            const enumVals =
              typeof v === 'object' && Array.isArray(v.values) ? `[${v.values.join('|')}]` : '';
            const dflt = typeof v === 'object' && v.default !== undefined ? `=${v.default}` : '';
            return `${k}${opt}: ${t}${enumVals}${dflt}`;
          })
        : [];

      const rawDesc = action.openapi?.description || '';
      const descDetail = rawDesc.split(/\n/)[0].replace(/\*\*/g, '').slice(0, 160);

      catalogue.push({
        serviceName: svc.name,
        actionName: `${svc.name}.${shortName}`,
        rest: restPath,
        description: action.openapi?.summary || action.description || shortName,
        descriptionDetail: descDetail,
        params: paramDefs,
      });
    }
  }
  return catalogue;
}

/**
 * Normalize a planner response so each step has action/params/description.
 *
 * @param {object} plan
 * @returns {object}
 */
function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) return plan;
  plan.steps = plan.steps.map((step) => ({
    ...step,
    action: step.action || step.useTool || step.tool || step.service || '',
    params: step.params || step.args || step.inputs || step.input || {},
    description: step.description || step.label || step.name || '',
  }));
  return plan;
}

module.exports = {
  buildServiceCatalogue,
  normalizePlan,
};
