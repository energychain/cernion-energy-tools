import { labelProjectionStatus } from '../../shared/wording-helpers';

export function NotProjectedBadge() {
  const label = labelProjectionStatus('nicht_projiziert');
  return (
    <span className="status-badge not-projected" aria-label="Nicht projiziert">
      {label}
    </span>
  );
}
