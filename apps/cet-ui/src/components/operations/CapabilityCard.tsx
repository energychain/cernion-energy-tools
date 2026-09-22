import { RiskClassBadge } from './RiskClassBadge';

export function CapabilityCard({
  id,
  label,
  riskClass,
}: {
  id: string;
  label?: string;
  riskClass?: string;
}) {
  return (
    <article className="capability-card">
      <h3>{label || id}</h3>
      <RiskClassBadge riskClass={riskClass} />
    </article>
  );
}
