import { RoleProjectionBadge } from '../identity/ActiveRoleBadge';
import { DecisionReadinessPanel } from '../governance/DecisionReadinessPanel';

export function VorgangCard({
  title,
  roleId,
  readiness,
}: {
  title?: string;
  roleId?: string;
  readiness?: string;
}) {
  return (
    <article className="vorgang-card">
      <h3>{title || 'Vorgang'}</h3>
      <RoleProjectionBadge roleId={roleId} />
      <DecisionReadinessPanel state={readiness} />
    </article>
  );
}
