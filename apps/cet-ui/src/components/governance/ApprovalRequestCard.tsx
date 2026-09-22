import { ApprovalStatusBadge } from '../status/ApprovalStatusBadge';

export function ApprovalRequestCard({
  status = 'angefordert',
  roleId,
}: {
  status?: string;
  roleId?: string;
}) {
  return (
    <article className="approval-request-card">
      <h3>Freigabeanforderung</h3>
      <ApprovalStatusBadge status={status} />
      <p>{roleId || 'Rolle offen'}</p>
    </article>
  );
}
