export function RiskClassBadge({ riskClass }: { riskClass?: string }) {
  return (
    <span className="risk-class-badge" data-risk-class={riskClass}>
      riskClass: {riskClass || 'offen'}
    </span>
  );
}
