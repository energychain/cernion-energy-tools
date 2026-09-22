export function HitlGatePanel({
  required = true,
  reason = 'Fachliche Freigabe erforderlich',
}: {
  required?: boolean;
  reason?: string;
}) {
  return (
    <section className="hitl-gate-panel">
      <h3>HITL Gate</h3>
      <p>{required ? reason : 'Keine HITL-Anforderung projiziert'}</p>
    </section>
  );
}
