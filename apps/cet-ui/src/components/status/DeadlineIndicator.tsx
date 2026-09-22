import { checkForbiddenUserText } from '../../shared/wording-helpers';

export function DeadlineIndicator({
  deadline,
  critical,
}: {
  deadline?: string;
  critical?: boolean;
}) {
  return (
    <span className={critical ? 'status-badge deadline critical' : 'status-badge deadline'}>
      {checkForbiddenUserText(deadline ? `Frist: ${deadline}` : 'Keine Frist projiziert')}
    </span>
  );
}
