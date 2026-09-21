'use strict';

function listSwitchableRoles(session) {
  return (session?.activeRoleCandidates || session?.heldRoles || []).filter(
    (role) => role.available !== false
  );
}

function getActiveRole(session) {
  return listSwitchableRoles(session).find((role) => role.roleId === session?.activeRoleId) || null;
}

function canSwitchToRole(session, roleId) {
  return listSwitchableRoles(session).some((role) => role.roleId === roleId);
}

function isPlaceholderAgent(actor) {
  return Boolean(actor?.placeholderAgent || actor?.type === 'placeholder-agent');
}

function renderRoleActor(actor) {
  if (!actor) return 'Keine Zuordnung';
  const label = actor.label || actor.displayName || actor.roleId || actor.actorId || 'Rolle';
  return isPlaceholderAgent(actor) ? `Agent ${label}` : label;
}

function filterActionsByRole(actions = [], activeRole) {
  return actions.filter(
    (action) => !Array.isArray(action.roleIds) || action.roleIds.includes(activeRole)
  );
}

module.exports = {
  canSwitchToRole,
  filterActionsByRole,
  getActiveRole,
  isPlaceholderAgent,
  listSwitchableRoles,
  renderRoleActor,
};
