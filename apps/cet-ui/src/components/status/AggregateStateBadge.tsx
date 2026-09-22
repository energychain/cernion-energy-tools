import { labelAggregationState } from '../../shared/wording-helpers';

export function AggregateStateBadge({ state }: { state?: string | null }) {
  return <span className="status-badge aggregate-state">{labelAggregationState(state)}</span>;
}
