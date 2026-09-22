import { checkForbiddenUserText } from '../../shared/wording-helpers';

export function AttentionReasonBadge({ reason }: { reason?: string }) {
  return (
    <span className="status-badge attention-reason">
      {checkForbiddenUserText(reason || 'Aufmerksamkeitsgrund offen')}
    </span>
  );
}
