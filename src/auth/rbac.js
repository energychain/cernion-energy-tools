'use strict';

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase();
}

function uniqueRoles(roles) {
  return [...new Set((roles || []).map(normalizeRole).filter(Boolean))];
}

function hasRole(roles, role) {
  const target = normalizeRole(role);
  return uniqueRoles(roles).includes(target);
}

function mapRolesFromLegacyToken(scope, scopes = []) {
  const normalizedScope = String(scope || '').trim().toLowerCase();
  if (normalizedScope === 'full-access') {
    // Transition mapping for Issue 17.
    return uniqueRoles(['full-access', 'hitl-approver', ...(scopes || [])]);
  }
  return uniqueRoles(['read-only', ...(scopes || [])]);
}

function mapRolesFromClaims(claims, groupRoleMap = {}) {
  const data = claims && typeof claims === 'object' ? claims : {};
  const roles = new Set();
  const groups = Array.isArray(data.groups) ? data.groups : [];

  const claimRoles = Array.isArray(data.roles) ? data.roles : [];
  for (const role of claimRoles) {
    const normalizedRole = normalizeRole(role);
    if (normalizedRole) roles.add(normalizedRole);
  }

  for (const group of groups) {
    const mapped = groupRoleMap[String(group || '').trim()];
    if (Array.isArray(mapped)) {
      for (const role of mapped) {
        const normalizedRole = normalizeRole(role);
        if (normalizedRole) roles.add(normalizedRole);
      }
    } else if (typeof mapped === 'string') {
      const normalizedRole = normalizeRole(mapped);
      if (normalizedRole) roles.add(normalizedRole);
    }
  }

  if (roles.size === 0) roles.add('read-only');
  return [...roles];
}

module.exports = {
  hasRole,
  mapRolesFromLegacyToken,
  mapRolesFromClaims,
};
