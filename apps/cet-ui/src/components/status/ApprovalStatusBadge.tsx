import { formatApprovalStatus } from '../../shared/wording-helpers';

export function ApprovalStatusBadge({
  status,
  actor,
}: {
  status?: string;
  actor?: { displayName?: string; label?: string; id?: string };
}) {
  return (
    <span className="status-badge approval-status">{formatApprovalStatus({ status, actor })}</span>
  );
}
