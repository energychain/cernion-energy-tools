export type ActiveRoleBadgeProps = { roleId?: string; label?: string; influenceRights?: string[] };

export function ActiveRoleBadge({ roleId, label, influenceRights = [] }: ActiveRoleBadgeProps) {
  return (
    <span
      className="identity-badge active-role-badge"
      data-role-id={roleId}
      title={influenceRights.join(', ')}
    >
      Rollenperspektive: {label || roleId || 'Rolle offen'}
    </span>
  );
}

export const RoleProjectionBadge = ActiveRoleBadge;
