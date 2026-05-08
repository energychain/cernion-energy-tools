'use strict';

const { hasRole, mapRolesFromLegacyToken, mapRolesFromClaims } = require('../src/auth/rbac');

describe('auth rbac helpers', () => {
  test('maps legacy full-access token to transition roles', () => {
    const roles = mapRolesFromLegacyToken('full-access', ['vnb-monitor']);
    expect(hasRole(roles, 'full-access')).toBe(true);
    expect(hasRole(roles, 'hitl-approver')).toBe(true);
  });

  test('maps legacy read-only token without approver role', () => {
    const roles = mapRolesFromLegacyToken('read-only');
    expect(hasRole(roles, 'read-only')).toBe(true);
    expect(hasRole(roles, 'hitl-approver')).toBe(false);
  });

  test('maps claims via groupRoleMap', () => {
    const roles = mapRolesFromClaims(
      {
        sub: 'user-1',
        groups: ['cernion-approver'],
      },
      {
        'cernion-approver': 'hitl-approver',
      }
    );

    expect(hasRole(roles, 'hitl-approver')).toBe(true);
  });
});
