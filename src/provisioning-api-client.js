'use strict';

const { required, optional } = require('../scripts/provisioning-cli-utils');

function apiMappingBroker(args) {
  const token = required(args, 'token');
  const base = new URL(optional(args, 'url', 'http://127.0.0.1:3000'));
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('Invalid --url.');
  const routes = {
    'workbench.admin.tenantMappings.create': ['POST', '/api/workbench/admin/tenant-mappings'],
    'workbench.admin.userMappings.create': ['POST', '/api/workbench/admin/user-mappings'],
    'workbench.admin.mappings.list': ['GET', '/api/workbench/admin/mappings'],
  };
  return {
    remote: true,
    async call(action, params) {
      const route = routes[action];
      if (!route) throw new Error('Unsupported provisioning action.');
      const [method, pathname] = route;
      const url = new URL(pathname, base);
      if (method === 'GET')
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
      const response = await fetch(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(params) } : {}),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.message || result.error?.message || `Provisioning API returned ${response.status}.`
        );
      return result;
    },
  };
}

module.exports = { apiMappingBroker };
