export type RoleOption = {
  roleId: string;
  label?: string;
  available?: boolean;
  placeholderAgent?: boolean;
};

export type RoleSelectorProps = {
  activeRoleId?: string;
  roles?: RoleOption[];
  onChange?: (roleId: string) => void;
};

export function RoleSelector({ activeRoleId, roles = [], onChange }: RoleSelectorProps) {
  const allowedRoles = roles.filter((role) => role.available !== false);
  return (
    <label className="role-selector">
      Rollenperspektive
      <select
        value={activeRoleId || ''}
        onChange={(event) => onChange?.(event.target.value)}
        aria-label="Rollenperspektive"
      >
        {allowedRoles.map((role) => (
          <option key={role.roleId} value={role.roleId}>
            {role.label || role.roleId}
            {role.placeholderAgent ? ' · Platzhalter-Agent' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
