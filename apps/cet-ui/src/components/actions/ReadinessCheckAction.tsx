export function ReadinessCheckAction({
  label = 'Readiness prüfen',
  blockedReason,
}: {
  label?: string;
  blockedReason?: string;
}) {
  return (
    <button type="button" disabled={Boolean(blockedReason)} title={blockedReason || 'CET-intern'}>
      {label}
    </button>
  );
}
