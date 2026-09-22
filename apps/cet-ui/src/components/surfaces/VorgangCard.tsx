import type { ReactNode } from 'react';
import { RoleProjectionBadge } from '../identity/ActiveRoleBadge';
import { DecisionReadinessPanel } from '../governance/DecisionReadinessPanel';

export function VorgangCard({
  title,
  roleId,
  readiness,
  children,
}: {
  title?: string;
  roleId?: string;
  readiness?: string;
  children?: ReactNode;
}) {
  return (
    <article className="vorgang-card">
      <h3>{title || 'Vorgang'}</h3>
      <RoleProjectionBadge roleId={roleId} />
      <DecisionReadinessPanel state={readiness} />
      {children}
    </article>
  );
}
