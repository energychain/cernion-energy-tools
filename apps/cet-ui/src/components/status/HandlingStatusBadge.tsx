import { formatVisibleNoAction, checkForbiddenUserText } from '../../shared/wording-helpers';

export function HandlingStatusBadge({
  status,
  actorName,
}: {
  status?: string;
  actorName?: string;
}) {
  const label =
    status === 'visible_no_action'
      ? formatVisibleNoAction({ displayName: actorName })
      : checkForbiddenUserText(status || 'Bearbeitungsstatus offen');
  return <span className="status-badge handling-status">{label}</span>;
}
