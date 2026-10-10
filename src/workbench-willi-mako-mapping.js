'use strict';

const { Errors } = require('moleculer');
const { cleanString } = require('./workbench-contract');

const PROVIDER = 'willi-mako';
const DEFAULT_SENSITIVITY = 'tenant_internal';

const ROLE_PROFILE_DEFAULTS = {
  normal_user: {
    roles: ['ROLE_MARKET_COMMUNICATION'],
    sensitivityClearance: [DEFAULT_SENSITIVITY],
    description: 'Willi-MaKo tenant user mapped to MaKo workbench role.',
  },
  mandant_admin: {
    roles: ['ROLE_MARKET_COMMUNICATION', 'ROLE_TENANT_ADMIN'],
    sensitivityClearance: [DEFAULT_SENSITIVITY, 'restricted'],
    description: 'Willi-MaKo mandant admin mapped to tenant-scoped CET administration.',
  },
  staff: {
    roles: ['ROLE_SUPPORT_READONLY'],
    sensitivityClearance: [DEFAULT_SENSITIVITY],
    description: 'Willi-MaKo staff support marker; never grants CET cross-tenant access by itself.',
  },
  external_advisor: {
    roles: ['ROLE_EXTERNAL_ADVISOR_LIMITED'],
    sensitivityClearance: [DEFAULT_SENSITIVITY],
    description: 'Limited external advisor projection for Willi-MaKo evidence review.',
  },
};

const ALLOWED_CET_ROLES = new Set([
  'ROLE_MARKET_COMMUNICATION',
  'ROLE_EDM',
  'ROLE_METERING_MSB',
  'ROLE_MARKET_MASTER_DATA',
  'ROLE_TENANT_ADMIN',
  'ROLE_EXTERNAL_ADVISOR_LIMITED',
  'ROLE_SUPPORT_READONLY',
  'ROLE_UTILITY_HQ',
]);

const ALLOWED_CLEARANCE = new Set([
  'public',
  DEFAULT_SENSITIVITY,
  'restricted',
  'highly_sensitive',
]);

function clientError(message, code = 422, type = 'WORKBENCH_WILLI_MAPPING_INVALID') {
  throw new Errors.MoleculerClientError(message, code, type);
}

function cleanEmail(value) {
  const text = cleanString(value, 'externalEmailNorm', { max: 320 });
  return text ? text.toLowerCase() : undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueAllowed(values, allowed, field) {
  const result = [
    ...new Set(asArray(values).map((v) => cleanString(String(v), field, { max: 120 }))),
  ].filter(Boolean);
  for (const value of result) {
    if (!allowed.has(value)) clientError(`Unsupported ${field}: ${value}`);
  }
  return result;
}

function normalizeRoleProfile(value = 'normal_user') {
  const profile = cleanString(value, 'williRoleProfile', { max: 80 }) || 'normal_user';
  if (!ROLE_PROFILE_DEFAULTS[profile]) clientError('Unsupported Willi-MaKo role profile');
  return profile;
}

function defaultRoleAlignment(profile) {
  const normalized = normalizeRoleProfile(profile);
  return {
    provider: PROVIDER,
    williRoleProfile: normalized,
    roles: [...ROLE_PROFILE_DEFAULTS[normalized].roles],
    sensitivityClearance: [...ROLE_PROFILE_DEFAULTS[normalized].sensitivityClearance],
    description: ROLE_PROFILE_DEFAULTS[normalized].description,
    status: 'default',
  };
}

function safeRoleAlignment(alignment) {
  if (!alignment) return null;
  return {
    provider: PROVIDER,
    cetTenantId: alignment.cetTenantId || null,
    williRoleProfile: alignment.williRoleProfile,
    roles: alignment.roles || [],
    sensitivityClearance: alignment.sensitivityClearance || [],
    description: alignment.description || null,
    enabled: alignment.enabled !== false,
    status: alignment.status || 'tenant',
    createdAt: alignment.createdAt,
    updatedAt: alignment.updatedAt,
  };
}

function normalizeRoleAlignmentInput(input = {}, { tenantId, actorId } = {}) {
  const profile = normalizeRoleProfile(
    input.williRoleProfile || input.roleProfile || input.williRole
  );
  const fallback = defaultRoleAlignment(profile);
  const roles = input.roles
    ? uniqueAllowed(input.roles, ALLOWED_CET_ROLES, 'role')
    : fallback.roles;
  const sensitivityClearance = input.sensitivityClearance
    ? uniqueAllowed(input.sensitivityClearance, ALLOWED_CLEARANCE, 'sensitivityClearance')
    : fallback.sensitivityClearance;
  return {
    provider: PROVIDER,
    cetTenantId: cleanString(input.cetTenantId || tenantId, 'cetTenantId', { required: true }),
    williRoleProfile: profile,
    roles,
    sensitivityClearance,
    description: cleanString(input.description || fallback.description, 'description', {
      max: 1000,
    }),
    enabled: input.enabled !== false,
    updatedBy: actorId || null,
  };
}

function normalizeWilliMappingInput(input = {}, { tenantId, actorId } = {}, roleAlignment) {
  const williRoleProfile = normalizeRoleProfile(
    input.williRoleProfile || input.roleProfile || input.williRole || 'normal_user'
  );
  const resolvedRoleAlignment = roleAlignment || defaultRoleAlignment(williRoleProfile);
  const williMandantId = cleanString(
    input.williMandantId || input.externalOrgId,
    'williMandantId',
    {
      required: true,
    }
  );
  const williUserId = cleanString(input.williUserId || input.externalUserId, 'williUserId', {
    max: 500,
  });
  const externalEmailNorm = cleanEmail(input.externalEmailNorm || input.email || input.emailNorm);
  if (!williUserId && !externalEmailNorm) {
    clientError('williUserId or externalEmailNorm required');
  }
  return {
    provider: PROVIDER,
    williMandantId,
    externalOrgId: williMandantId,
    williUserId: williUserId || null,
    externalUserId: williUserId || null,
    externalEmailNorm: externalEmailNorm || null,
    cetTenantId: cleanString(input.cetTenantId || tenantId, 'cetTenantId', { required: true }),
    cetActorId: cleanString(input.cetActorId || input.actorId || actorId, 'cetActorId', {
      required: true,
    }),
    roles: input.roles
      ? uniqueAllowed(input.roles, ALLOWED_CET_ROLES, 'role')
      : resolvedRoleAlignment.roles || [],
    sensitivityClearance: input.sensitivityClearance
      ? uniqueAllowed(input.sensitivityClearance, ALLOWED_CLEARANCE, 'sensitivityClearance')
      : resolvedRoleAlignment.sensitivityClearance || [DEFAULT_SENSITIVITY],
    williRoleProfile,
    isWilliStaff:
      input.isWilliStaff === true || input.staff === true || williRoleProfile === 'staff',
    williSessionId: cleanString(input.williSessionId, 'williSessionId'),
    cetCaseId: cleanString(input.cetCaseId, 'cetCaseId'),
    enabled: input.enabled !== false,
    createdBy: actorId || null,
    updatedBy: actorId || null,
  };
}

function safeWilliMapping(mapping) {
  if (!mapping) return null;
  return {
    provider: PROVIDER,
    williMandantId: mapping.williMandantId,
    externalOrgId: mapping.externalOrgId || mapping.williMandantId,
    williUserId: mapping.williUserId || null,
    externalUserId: mapping.externalUserId || mapping.williUserId || null,
    externalEmailNorm: mapping.externalEmailNorm || null,
    cetTenantId: mapping.cetTenantId,
    cetActorId: mapping.cetActorId,
    roles: mapping.roles || [],
    sensitivityClearance: mapping.sensitivityClearance || [],
    williRoleProfile: mapping.williRoleProfile || 'normal_user',
    isWilliStaff: !!mapping.isWilliStaff,
    williSessionId: mapping.williSessionId || null,
    cetCaseId: mapping.cetCaseId || null,
    enabled: mapping.enabled !== false,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  };
}

module.exports = {
  PROVIDER,
  ROLE_PROFILE_DEFAULTS,
  normalizeRoleAlignmentInput,
  normalizeWilliMappingInput,
  defaultRoleAlignment,
  safeRoleAlignment,
  safeWilliMapping,
};
