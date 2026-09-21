'use strict';

const RC2_ROLE_IDS = Object.freeze({
  MARKTKOMMUNIKATION: 'RC2_ROLE_MARKTKOMMUNIKATION',
  ABTEILUNGSLEITUNG: 'RC2_ROLE_ABTEILUNGSLEITUNG',
  REGULIERUNG: 'RC2_ROLE_REGULIERUNG',
  NETZPLANUNG: 'RC2_ROLE_NETZPLANUNG',
  GESCHAEFTSFUEHRUNG: 'RC2_ROLE_GESCHAEFTSFUEHRUNG',
  MANDANTENADMIN: 'RC2_ROLE_MANDANTENADMIN',
});

const TENANT_ID = 'rc2-stadtwerk-a';

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function buildReferenceTenantFixture() {
  return {
    tenant: {
      id: TENANT_ID,
      label: 'RC2 Stadtwerk A',
    },
    roles: [
      { id: RC2_ROLE_IDS.MARKTKOMMUNIKATION, label: 'Marktkommunikation' },
      { id: RC2_ROLE_IDS.ABTEILUNGSLEITUNG, label: 'Abteilungsleitung' },
      { id: RC2_ROLE_IDS.REGULIERUNG, label: 'Regulierung' },
      { id: RC2_ROLE_IDS.NETZPLANUNG, label: 'Netzplanung' },
      { id: RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG, label: 'Geschäftsführung' },
      { id: RC2_ROLE_IDS.MANDANTENADMIN, label: 'Mandantenadministration' },
    ],
    users: [
      {
        kind: 'human',
        id: 'user-mako-1',
        tenantId: TENANT_ID,
        displayName: 'Mako Person 1',
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION, RC2_ROLE_IDS.MANDANTENADMIN],
      },
      {
        kind: 'human',
        id: 'user-mako-2',
        tenantId: TENANT_ID,
        displayName: 'Mako Person 2',
        roleIds: [RC2_ROLE_IDS.MARKTKOMMUNIKATION],
      },
      {
        kind: 'human',
        id: 'user-department-head',
        tenantId: TENANT_ID,
        displayName: 'Abteilungsleitung Beispiel',
        roleIds: [RC2_ROLE_IDS.ABTEILUNGSLEITUNG],
      },
      {
        kind: 'human',
        id: 'user-grid-planning',
        tenantId: TENANT_ID,
        displayName: 'Netzplanung Beispiel',
        roleIds: [RC2_ROLE_IDS.NETZPLANUNG],
      },
    ],
    placeholderAgents: [
      {
        kind: 'placeholder-agent',
        id: 'placeholder-gf-rc2-stadtwerk-a',
        tenantId: TENANT_ID,
        displayName: 'Platzhalter-Agent Geschäftsführung',
        roleIds: [RC2_ROLE_IDS.GESCHAEFTSFUEHRUNG],
        personaType: 'specialized-agent',
        canHandleHitl: true,
      },
    ],
  };
}

function hasRole(actor, tenantId, roleId) {
  return actor.tenantId === tenantId && (actor.roleIds || []).includes(roleId);
}

function resolvePlaceholderAgentForRole(fixture, { tenantId, roleId }) {
  const source = fixture || buildReferenceTenantFixture();
  const match = source.placeholderAgents.find((agent) => hasRole(agent, tenantId, roleId));
  return match ? clone(match) : null;
}

function resolveRoleActors(fixture, { tenantId, roleId }) {
  const source = fixture || buildReferenceTenantFixture();
  const humans = source.users.filter((user) => hasRole(user, tenantId, roleId));
  if (humans.length > 0) return clone(humans);
  const placeholder = resolvePlaceholderAgentForRole(source, { tenantId, roleId });
  return placeholder ? [placeholder] : [];
}

module.exports = {
  RC2_ROLE_IDS,
  buildReferenceTenantFixture,
  resolvePlaceholderAgentForRole,
  resolveRoleActors,
};
