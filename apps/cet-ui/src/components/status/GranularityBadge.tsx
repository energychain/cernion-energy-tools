import { checkForbiddenUserText } from '../../shared/wording-helpers';

export function GranularityBadge({
  granularitaet,
}: {
  granularitaet?: 'aggregat' | 'einzeldatensatz' | string;
}) {
  const label =
    granularitaet === 'einzeldatensatz'
      ? 'Einzeldatensatz: Hash/Ref only'
      : granularitaet === 'aggregat'
        ? 'Aggregat'
        : 'Granularität offen';
  return (
    <span className="status-badge granularity" data-granularitaet={granularitaet}>
      {checkForbiddenUserText(label)}
    </span>
  );
}
