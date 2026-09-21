'use strict';

const {
  RC2_ROLE_IDS,
  buildReferenceTenantFixture,
  resolveRoleActors,
  resolvePlaceholderAgentForRole,
} = require('../src/cet-ui-rc2/fixtures/reference-tenant');

describe('CET UI RC2 tenant role and placeholder-agent fixture', () => {
  test('models users as belonging to exactly one tenant with multiple roles', () => {
    const fixture = buildReferenceTenantFixture();
    const user = fixture.users.find((candidate) => candidate.id === 'user-mako-1');

    expect(user.tenantId).toBe(fixture.tenant.id);
    expect(user.roleIds).toEqual(
      expect.arrayContaining([RC2_ROLE_IDS.MARKTKOMMUNIKATION, RC2_ROLE_IDS.MANDANTENADMIN])
    );
    expect(user.tenantIds).toBeUndefined();
  });

  test('allows two human users to share the Marktkommunikation role', () => {
    const fixture = buildReferenceTenantFixture();
    const actors = resolveRoleActors(fixture, {
      tenantId: fixture.tenant.id,
      roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
    });

    expect(actors.filter((actor) => actor.kind === 'human').map((actor) => actor.id)).toEqual([
      'user-mako-1',
      'user-mako-2',
    ]);
  });

  test('resolves an empty role to a same-tenant placeholder agent that may take HITLs', () => {
    const fixture = buildReferenceTenantFixture();
    const actors = resolveRoleActors(fixture, {
      tenantId: fixture.tenant.id,
      roleId: RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG,
    });
    const placeholder = resolvePlaceholderAgentForRole(fixture, {
      tenantId: fixture.tenant.id,
      roleId: RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG,
    });

    expect(actors).toEqual([placeholder]);
    expect(placeholder).toMatchObject({
      kind: 'placeholder-agent',
      tenantId: fixture.tenant.id,
      roleIds: [RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG],
      canHandleHitl: true,
    });
  });

  test('returns not found for cross-tenant role resolution', () => {
    const fixture = buildReferenceTenantFixture();

    expect(
      resolveRoleActors(fixture, {
        tenantId: 'anderer-mandant',
        roleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
      })
    ).toEqual([]);
    expect(
      resolvePlaceholderAgentForRole(fixture, {
        tenantId: 'anderer-mandant',
        roleId: RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG,
      })
    ).toBeNull();
  });
});
