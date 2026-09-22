import { checkForbiddenUserText } from '../../shared/wording-helpers';

export function SafetyMarker({ marker = 'No-Call Guard aktiv' }: { marker?: string }) {
  return <span className="status-badge safety-marker">{checkForbiddenUserText(marker)}</span>;
}
