'use strict';

const { Errors } = require('moleculer');
const { mapRolesFromLegacyToken } = require('./rbac');

// Explicit energy-role allowlist. Scope names and role-like arbitrary strings
// cannot grant energy privileges. HQ and platform roles need audited support issuance.
const TOKEN_ROLES = Object.freeze([
  'ROLE_USER',
  'ROLE_TENANT_ADMIN',
  'ROLE_ADMIN',
  'ROLE_UTILITY_HQ',
  'ROLE_PROCESS_OWNER',
  'ROLE_MARKET_COMMUNICATION',
  'ROLE_MARKET_MASTER_DATA',
  'ROLE_EDM',
  'ROLE_METERING_MSB',
  'ROLE_EXTERNAL_ADVISOR_LIMITED',
  'ROLE_SUPPORT_READONLY',
  'ROLE_NETZPLANUNG',
  'ROLE_NETZBETRIEB',
  'ROLE_NETZFUEHRUNG',
  'ROLE_NETZSTRATEGIE',
  'ROLE_ANSCHLUSSWESEN',
  'ROLE_GRID_CONNECTION',
  'ROLE_GRID_OPERATIONS',
  'ROLE_GRID_PLANNING',
  'ROLE_GRID_OPERATOR',
  'ROLE_ASSET_MANAGEMENT',
  'ROLE_ASSET_PLANNING',
  'ROLE_MANAGEMENT',
  'ROLE_MANAGEMENT_READ',
  'ROLE_CONTROLLING',
  'ROLE_FINANCE',
  'ROLE_BILLING',
  'ROLE_COMPLIANCE',
  'ROLE_REGULATORY',
  'ROLE_CUSTOMER_SERVICE',
  'ROLE_LIEFERANT',
  'ROLE_VNB',
  'ROLE_DV',
]);
const SUPPORT_ROLES = Object.freeze(['ROLE_ADMIN', 'ROLE_UTILITY_HQ']);

function invalid(message) {
  throw new Errors.MoleculerClientError(message, 422, 'INVALID_TOKEN_ROLE');
}

function validateRoles(values = [], { support = false } = {}) {
  if (!Array.isArray(values)) invalid('roles must be an array.');
  const roles = [...new Set(values)];
  for (const role of roles) {
    if (!TOKEN_ROLES.includes(role)) invalid(`Unsupported token role: ${role}.`);
    if (SUPPORT_ROLES.includes(role) && !support)
      invalid(`${role} requires audited --support issuance.`);
  }
  return roles;
}

function validateTokenIdentity({ gateway = false, client, roles = [], support = false }) {
  const validated = validateRoles(roles, { support });
  if (gateway && roles.length) invalid('--gateway and --roles are mutually exclusive.');
  if (gateway && client !== 'open-webui') invalid('Gateway client must be open-webui.');
  if (!gateway && client) invalid('--client requires --gateway.');
  return validated;
}

function rolesFromToken(token) {
  if (token.type === 'gateway') return [];
  return [
    ...new Set([...mapRolesFromLegacyToken(token.scope, token.scopes), ...(token.roles || [])]),
  ];
}

function gatewayForbidden() {
  throw new Errors.MoleculerClientError(
    'Dieser Verbindungsschlüssel ist nur für den Governance-Assistenten freigegeben.',
    403,
    'GATEWAY_TOKEN_FORBIDDEN'
  );
}

module.exports = {
  TOKEN_ROLES,
  SUPPORT_ROLES,
  validateRoles,
  validateTokenIdentity,
  rolesFromToken,
  gatewayForbidden,
};
