export type ActorBadgeProps = {
  label?: string;
  displayName?: string;
  roleId?: string;
  placeholderAgent?: boolean;
  type?: string;
};

export function ActorBadge({
  label,
  displayName,
  roleId,
  placeholderAgent,
  type,
}: ActorBadgeProps) {
  const isAgent = placeholderAgent || type === 'placeholder-agent';
  return (
    <span className="identity-badge actor-badge">
      {isAgent ? 'Platzhalter-Agent' : 'Person'}: {label || displayName || roleId || 'Akteur offen'}
    </span>
  );
}

export const RoleActorLine = ActorBadge;
