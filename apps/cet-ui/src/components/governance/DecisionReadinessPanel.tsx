export function DecisionReadinessPanel({
  state = 'DRL offen',
  reason,
}: {
  state?: string;
  reason?: string;
}) {
  return (
    <section className="decision-readiness-panel">
      <h3>Decision Readiness</h3>
      <p>{state}</p>
      <p>{reason || 'Readiness wird aus Evidenz, Rolle und No-Call-Guard abgeleitet.'}</p>
    </section>
  );
}
