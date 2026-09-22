export function SinceLastAccessNotice({ summary }: { summary?: string }) {
  return (
    <p className="since-last-access">
      Seit dem letzten Zugriff: {summary || 'keine neue projizierte Änderung'}
    </p>
  );
}
